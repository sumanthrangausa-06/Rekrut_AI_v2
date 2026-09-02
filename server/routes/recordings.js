// =============================================================================
// Interview Recording Routes — REST API for recording, playback & AI transcript
// Issue #126
// =============================================================================
//
// Endpoints:
//   POST   /api/interviews/recordings/start              — start recording
//   POST   /api/interviews/recordings/:id/stop           — stop recording
//   GET    /api/interviews/recordings                    — list recordings (recruiter)
//   GET    /api/interviews/recordings/:id                — get recording details
//   GET    /api/interviews/recordings/:id/playback       — playback URL
//   POST   /api/interviews/recordings/:id/transcribe     — trigger AI transcription
//   GET    /api/interviews/recordings/:id/transcript     — get full transcript
//   POST   /api/interviews/recordings/:id/consent        — record consent
//   POST   /api/interviews/recordings/transcript/:segmentId/highlight — add highlight
//
// Auth: authMiddleware + role checks
// Rate limiting: strict for start/stop endpoints
// =============================================================================

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authMiddleware } = require('../../lib/auth');
const { requirePermission } = require('../../middleware/rbac');
const { rateLimits, createRateLimit } = require('../../lib/distributed-rate-limiter');
const livekitService = require('../services/livekit');
const { transcribeAudioWithWhisper } = require('../../lib/polsia-ai');
const pool = require('../../lib/db');
const crypto = require('node:crypto');

const router = express.Router();

function handleValidationErrors(req, res, next) {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({
			error: 'Validation failed',
			details: errors.array().map((e) => ({
				// @ts-expect-error express-validator type mismatch
				field: e.path || e.param || 'unknown',
				message: e.msg,
			})),
		});
	}
	next();
}

function isRecruiterRole(role) {
	return ['recruiter', 'hiring_manager', 'employer', 'admin'].includes(role);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Verify user can access a recording. Recruiters see their company's recordings;
 * candidates see only their own interview recordings.
 */
async function canAccessRecording(recordingId, user) {
	const recording = await livekitService.findRecordingById(recordingId);
	if (!recording) return { canAccess: false, recording: null, isRecruiter: false };

	const eventRes = await pool.query(
		`SELECT ie.*, u.company_id as recruiter_company_id
		 FROM interview_events ie
		 LEFT JOIN users u ON ie.recruiter_id = u.id
		 WHERE ie.id = $1`,
		[recording.interview_event_id],
	);
	const event = eventRes.rows[0];
	if (!event) return { canAccess: false, recording: null, isRecruiter: false };

	const isRec = isRecruiterRole(user.role);
	const isOwner =
		isRec && (event.recruiter_id === user.id || event.recruiter_company_id === user.company_id);
	const isCandidate = event.candidate_id === user.id;
	const isPanel = (event.panel_member_ids || []).includes(user.id);
	const isAdmin = user.role === 'admin';

	return {
		canAccess: isOwner || isCandidate || isPanel || isAdmin,
		recording,
		event,
		isRecruiter: isOwner || isAdmin,
		isCandidate,
	};
}

/**
 * Check if all participants have consented to recording.
 */
async function _checkAllConsented(recordingId) {
	const recording = await livekitService.findRecordingById(recordingId);
	if (!recording) return { allConsented: false, missing: [] };

	const eventRes = await pool.query(
		`SELECT candidate_id, recruiter_id, panel_member_ids FROM interview_events WHERE id = $1`,
		[recording.interview_event_id],
	);
	const event = eventRes.rows[0];
	if (!event) return { allConsented: false, missing: [] };

	const participantIds = [
		event.candidate_id,
		event.recruiter_id,
		...(event.panel_member_ids || []),
	];
	const uniqueIds = [...new Set(participantIds)].filter(Boolean);

	const consentRes = await pool.query(
		`SELECT user_id FROM recording_consent WHERE recording_id = $1 AND consent_type != 'withdrawn'`,
		[recordingId],
	);
	const consentedIds = new Set(consentRes.rows.map((r) => r.user_id));
	const missing = uniqueIds.filter((id) => !consentedIds.has(id));

	return { allConsented: missing.length === 0, missing, participantIds: uniqueIds };
}

/**
 * Generate a time-limited signed playback token.
 */
function generatePlaybackToken(recordingId, userId, expiresInSeconds = 300) {
	const secret = process.env.JWT_SECRET;
	if (!secret) return null;
	const payload = {
		recordingId,
		userId,
		iat: Math.floor(Date.now() / 1000),
		exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
	};
	return (
		Buffer.from(JSON.stringify(payload)).toString('base64url') +
		'.' +
		crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('base64url')
	);
}

/**
 * Verify a playback token.
 */
function _verifyPlaybackToken(token) {
	const secret = process.env.JWT_SECRET;
	if (!secret || !token) return null;
	try {
		const [payloadB64, sig] = token.split('.');
		const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
		const expectedSig = crypto
			.createHmac('sha256', secret)
			.update(JSON.stringify(payload))
			.digest('base64url');
		if (sig !== expectedSig) return null;
		if (payload.exp < Math.floor(Date.now() / 1000)) return null;
		return payload;
	} catch (_e) {
		return null;
	}
}

// ─── POST /api/interviews/recordings/start ────────────────────────────────

router.post(
	'/start',
	authMiddleware,
	requirePermission('interviews:schedule'),
	createRateLimit({ windowMs: 60 * 1000, max: 5, keyPrefix: 'recording-start' }),
	[body('room_id').isInt({ min: 1 }).withMessage('Valid room_id required')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const { room_id: roomId } = req.body;
			const user = req.user;

			// Verify room exists and user owns the interview
			const room = await livekitService.findRoomById(roomId);
			if (!room) {
				return res.status(404).json({ error: 'Room not found' });
			}

			const eventRes = await pool.query(
				`SELECT ie.*, u.company_id as recruiter_company_id
				 FROM interview_events ie
				 LEFT JOIN users u ON ie.recruiter_id = u.id
				 WHERE ie.id = $1`,
				[room.interview_event_id],
			);
			const event = eventRes.rows[0];
			if (!event) {
				return res.status(404).json({ error: 'Interview event not found' });
			}

			if (
				user.role !== 'admin' &&
				event.recruiter_id !== user.id &&
				event.recruiter_company_id !== user.company_id
			) {
				return res.status(403).json({ error: 'Not authorized to record this interview' });
			}

			// Check if there's already an active recording
			const existing = await livekitService.findActiveRecordingByRoomId(roomId);
			if (existing) {
				return res.status(409).json({
					error: 'Recording already in progress',
					recording: { id: existing.id, status: existing.status, started_at: existing.started_at },
				});
			}

			// Check consent for all participants
			const consentCheck = await (async () => {
				const participantIds = [
					event.candidate_id,
					event.recruiter_id,
					...(event.panel_member_ids || []),
				];
				const uniqueIds = [...new Set(participantIds)].filter(Boolean);
				// Check if a recording record already exists (from a previous start attempt)
				const prevRecordings = await pool.query(
					`SELECT id FROM interview_recordings WHERE room_id = $1 ORDER BY created_at DESC LIMIT 1`,
					[roomId],
				);
				if (prevRecordings.rows.length > 0) {
					const recId = prevRecordings.rows[0].id;
					const consentRes = await pool.query(
						`SELECT user_id FROM recording_consent WHERE recording_id = $1 AND consent_type != 'withdrawn'`,
						[recId],
					);
					const consentedIds = new Set(consentRes.rows.map((r) => r.user_id));
					const missing = uniqueIds.filter((id) => !consentedIds.has(id));
					return { allConsented: missing.length === 0, missing };
				}
				// No previous recording — need fresh consent from all
				return { allConsented: false, missing: uniqueIds };
			})();

			if (!consentCheck.allConsented) {
				return res.status(403).json({
					error: 'Consent required from all participants before recording',
					code: 'CONSENT_REQUIRED',
					missingConsentFrom: consentCheck.missing,
				});
			}

			// Start LiveKit Egress recording
			const egress = await livekitService.startRoomRecording(room.room_name);

			// Persist recording record
			const record = await livekitService.createRecordingRecord({
				interviewEventId: room.interview_event_id,
				roomId,
				egressId: egress.egressId,
			});

			res.status(201).json({
				success: true,
				recording: {
					id: record.id,
					status: 'recording',
					started_at: record.started_at,
					room_id: record.room_id,
				},
			});
		} catch (err) {
			console.error('[recordings] Start error:', err.message);
			if (err.message.includes('not configured')) {
				return res.status(503).json({ error: 'Recording service not configured' });
			}
			res.status(500).json({ error: 'Failed to start recording' });
		}
	},
);

// ─── POST /api/interviews/recordings/:id/stop ─────────────────────────────

router.post(
	'/:id/stop',
	authMiddleware,
	requirePermission('interviews:schedule'),
	createRateLimit({ windowMs: 60 * 1000, max: 5, keyPrefix: 'recording-stop' }),
	[param('id').isInt({ min: 1 }).withMessage('Valid recording ID required')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const recordingId = parseInt(req.params.id, 10);
			const user = req.user;

			const { canAccess, recording, isRecruiter } = await canAccessRecording(recordingId, user);
			if (!canAccess) {
				return res.status(403).json({ error: 'Not authorized' });
			}
			if (!isRecruiter) {
				return res.status(403).json({ error: 'Only recruiters can stop recordings' });
			}

			if (recording.status !== 'recording') {
				return res.status(400).json({ error: `Recording is already ${recording.status}` });
			}

			// Stop LiveKit Egress
			const _egressInfo = await livekitService.stopRoomRecording(recording.livekit_egress_id);

			// Poll briefly for completed file info (non-blocking, best effort)
			let fileLocation = null;
			let fileSize = null;
			let durationSeconds = null;
			try {
				// Wait up to 5s for Egress to finalize
				for (let i = 0; i < 5; i++) {
					await new Promise((r) => setTimeout(r, 1000));
					const info = await livekitService.getEgressInfo(recording.livekit_egress_id);
					if (info && info.status === 'EGRESS_COMPLETE' && info.fileResults?.length > 0) {
						fileLocation = info.fileResults[0].location;
						fileSize = info.fileResults[0].size || null;
						// Estimate duration from started_at to stopped_at
						durationSeconds = recording.started_at
							? Math.round((Date.now() - new Date(recording.started_at).getTime()) / 1000)
							: null;
						break;
					}
					if (info && info.status === 'EGRESS_FAILED') {
						throw new Error('Egress failed');
					}
				}
			} catch (pollErr) {
				console.warn('[recordings] Egress poll error:', pollErr.message);
			}

			if (fileLocation) {
				await livekitService.completeRecordingRecord(
					recordingId,
					fileLocation,
					durationSeconds,
					fileSize,
				);
			} else {
				await livekitService.failRecordingRecord(
					recordingId,
					'Egress did not provide file location',
				);
			}

			const updated = await livekitService.findRecordingById(recordingId);
			res.json({
				success: true,
				recording: {
					id: updated.id,
					status: updated.status,
					stopped_at: updated.stopped_at,
					duration_seconds: updated.duration_seconds,
					file_size_bytes: updated.file_size_bytes,
				},
			});
		} catch (err) {
			console.error('[recordings] Stop error:', err.message);
			res.status(500).json({ error: 'Failed to stop recording' });
		}
	},
);

// ─── GET /api/interviews/recordings ───────────────────────────────────────

router.get(
	'/',
	authMiddleware,
	requirePermission('interviews:read'),
	rateLimits.standard,
	[query('event_id').isInt({ min: 1 }).withMessage('Valid event_id required')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const eventId = parseInt(req.query.event_id, 10);
			const user = req.user;

			// Verify event access
			const eventRes = await pool.query(
				`SELECT ie.*, u.company_id as recruiter_company_id
				 FROM interview_events ie
				 LEFT JOIN users u ON ie.recruiter_id = u.id
				 WHERE ie.id = $1`,
				[eventId],
			);
			const event = eventRes.rows[0];
			if (!event) {
				return res.status(404).json({ error: 'Interview event not found' });
			}
			if (
				user.role !== 'admin' &&
				event.recruiter_id !== user.id &&
				event.recruiter_company_id !== user.company_id
			) {
				return res.status(403).json({ error: 'Not authorized' });
			}

			const recordings = await livekitService.listRecordingsByEventId(eventId);
			res.json({
				success: true,
				recordings: recordings.map((r) => ({
					id: r.id,
					status: r.status,
					started_at: r.started_at,
					stopped_at: r.stopped_at,
					duration_seconds: r.duration_seconds,
					file_size_bytes: r.file_size_bytes,
					file_format: r.file_format,
					retention_expires_at: r.retention_expires_at,
					created_at: r.created_at,
				})),
			});
		} catch (err) {
			console.error('[recordings] List error:', err.message);
			res.status(500).json({ error: 'Failed to list recordings' });
		}
	},
);

// ─── GET /api/interviews/recordings/:id ───────────────────────────────────

router.get(
	'/:id',
	authMiddleware,
	[param('id').isInt({ min: 1 }).withMessage('Valid recording ID required')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const recordingId = parseInt(req.params.id, 10);
			const user = req.user;

			const { canAccess, recording, isRecruiter } = await canAccessRecording(
				recordingId,
				user,
			);
			if (!canAccess) {
				return res.status(403).json({ error: 'Not authorized' });
			}

			// Fetch transcript summary
			const transcriptRes = await pool.query(
				`SELECT COUNT(*) as segment_count, MAX(created_at) as last_transcript_at
				 FROM interview_transcripts WHERE recording_id = $1`,
				[recordingId],
			);
			const transcriptSummary = transcriptRes.rows[0];

			// Fetch consent records
			const consentRes = await pool.query(
				`SELECT rc.user_id, rc.consented_at, rc.consent_type, u.name, u.email
				 FROM recording_consent rc
				 JOIN users u ON rc.user_id = u.id
				 WHERE rc.recording_id = $1`,
				[recordingId],
			);

			const result = {
				id: recording.id,
				status: recording.status,
				started_at: recording.started_at,
				stopped_at: recording.stopped_at,
				duration_seconds: recording.duration_seconds,
				file_size_bytes: recording.file_size_bytes,
				file_format: recording.file_format,
				retention_expires_at: recording.retention_expires_at,
				created_at: recording.created_at,
				updated_at: recording.updated_at,
				transcript: {
					segment_count: parseInt(transcriptSummary.segment_count, 10),
					last_transcript_at: transcriptSummary.last_transcript_at,
				},
				consent: consentRes.rows,
			};

			// Only recruiters see internal notes/highlights summary
			if (isRecruiter) {
				const highlightRes = await pool.query(
					`SELECT COUNT(*) as highlight_count
					 FROM transcript_highlights th
					 JOIN interview_transcripts it ON th.transcript_id = it.id
					 WHERE it.recording_id = $1`,
					[recordingId],
				);
				result.recruiter_notes = {
					highlight_count: parseInt(highlightRes.rows[0].highlight_count, 10),
				};
			}

			res.json({ success: true, recording: result });
		} catch (err) {
			console.error('[recordings] Get error:', err.message);
			res.status(500).json({ error: 'Failed to fetch recording' });
		}
	},
);

// ─── GET /api/interviews/recordings/:id/playback ──────────────────────────

router.get(
	'/:id/playback',
	authMiddleware,
	[param('id').isInt({ min: 1 }).withMessage('Valid recording ID required')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const recordingId = parseInt(req.params.id, 10);
			const user = req.user;

			const { canAccess, recording } = await canAccessRecording(recordingId, user);
			if (!canAccess) {
				return res.status(403).json({ error: 'Not authorized' });
			}

			if (recording.status !== 'completed') {
				return res.status(400).json({ error: 'Recording not available for playback' });
			}

			// Decrypt storage path
			const storagePath = livekitService.decryptStoragePath(recording);
			if (!storagePath) {
				return res.status(404).json({ error: 'Recording file not found' });
			}

			// Generate signed playback token
			const token = generatePlaybackToken(recordingId, user.id, 300); // 5 minutes
			if (!token) {
				return res.status(500).json({ error: 'Failed to generate playback token' });
			}

			// Build a playback URL: either direct S3/R2 URL or proxied
			let playbackUrl = storagePath;
			if (!storagePath.startsWith('http')) {
				// Construct URL from endpoint + bucket + path
				const endpoint = process.env.RECORDING_STORAGE_ENDPOINT;
				const bucket = process.env.RECORDING_STORAGE_BUCKET;
				if (endpoint && bucket) {
					playbackUrl = `${endpoint.replace(/\/$/, '')}/${bucket}/${storagePath}`;
				}
			}

			res.json({
				success: true,
				playback: {
					url: playbackUrl,
					token,
					expires_in: 300,
					recording_id: recordingId,
				},
			});
		} catch (err) {
			console.error('[recordings] Playback error:', err.message);
			res.status(500).json({ error: 'Failed to generate playback URL' });
		}
	},
);

// ─── POST /api/interviews/recordings/:id/transcribe ───────────────────────

router.post(
	'/:id/transcribe',
	authMiddleware,
	requirePermission('interviews:schedule'),
	rateLimits.ai,
	[param('id').isInt({ min: 1 }).withMessage('Valid recording ID required')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const recordingId = parseInt(req.params.id, 10);
			const user = req.user;

			const { canAccess, recording, isRecruiter } = await canAccessRecording(recordingId, user);
			if (!canAccess || !isRecruiter) {
				return res.status(403).json({ error: 'Not authorized' });
			}

			if (recording.status !== 'completed') {
				return res.status(400).json({ error: 'Recording must be completed before transcription' });
			}

			// Decrypt storage path and download audio
			const storagePath = livekitService.decryptStoragePath(recording);
			if (!storagePath) {
				return res.status(404).json({ error: 'Recording file not found' });
			}

			// Mark as processing
			await pool.query(
				`UPDATE interview_recordings SET status = 'processing', updated_at = NOW() WHERE id = $1`,
				[recordingId],
			);

			// Download audio
			const audioBuffer = await livekitService.downloadRecordingAudio(storagePath);
			if (!audioBuffer) {
				await pool.query(
					`UPDATE interview_recordings SET status = 'completed', updated_at = NOW() WHERE id = $1`,
					[recordingId],
				);
				return res.status(500).json({ error: 'Failed to download recording audio' });
			}

			// Convert to base64 for Whisper
			const audioBase64 = `data:audio/mp4;base64,${audioBuffer.toString('base64')}`;

			// Call Whisper transcription
			const whisperResult = await transcribeAudioWithWhisper(audioBase64, {
				subscriptionId: user.subscription_id,
			});

			if (!whisperResult?.text) {
				await pool.query(
					`UPDATE interview_recordings SET status = 'completed', updated_at = NOW() WHERE id = $1`,
					[recordingId],
				);
				return res.status(500).json({ error: 'Transcription failed' });
			}

			// Store transcript segments
			// Whisper returns text; we store it as a single segment with the whole text
			// For speaker attribution, we use a placeholder since Whisper doesn't do diarization
			await pool.query(
				`INSERT INTO interview_transcripts
				 (recording_id, speaker_identity, text, start_time_ms, end_time_ms, confidence)
				 VALUES ($1, $2, $3, $4, $5, $6)`,
				[
					recordingId,
					'unknown', // Speaker diarization not available in basic Whisper
					whisperResult.text,
					0,
					(recording.duration_seconds || 0) * 1000,
					whisperResult.confidence || 0.85,
				],
			);

			// Mark as completed again
			await pool.query(
				`UPDATE interview_recordings SET status = 'completed', updated_at = NOW() WHERE id = $1`,
				[recordingId],
			);

			res.json({
				success: true,
				transcript: {
					text: whisperResult.text,
					duration_ms: (recording.duration_seconds || 0) * 1000,
					confidence: whisperResult.confidence || 0.85,
				},
			});
		} catch (err) {
			console.error('[recordings] Transcribe error:', err.message);
			// Always reset status on error
			try {
				await pool.query(
					`UPDATE interview_recordings SET status = 'completed', updated_at = NOW() WHERE id = $1`,
					[parseInt(req.params.id, 10)],
				);
			} catch (_e) {
				/* ignore */
			}
			res.status(500).json({ error: 'Failed to transcribe recording' });
		}
	},
);

// ─── GET /api/interviews/recordings/:id/transcript ────────────────────────

router.get(
	'/:id/transcript',
	authMiddleware,
	[param('id').isInt({ min: 1 }).withMessage('Valid recording ID required')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const recordingId = parseInt(req.params.id, 10);
			const user = req.user;

			const { canAccess, isRecruiter } = await canAccessRecording(recordingId, user);
			if (!canAccess) {
				return res.status(403).json({ error: 'Not authorized' });
			}

			const transcriptRes = await pool.query(
				`SELECT id, speaker_identity, text, start_time_ms, end_time_ms, confidence, created_at
				 FROM interview_transcripts
				 WHERE recording_id = $1
				 ORDER BY start_time_ms`,
				[recordingId],
			);

			const segments = transcriptRes.rows;

			// Enrich with highlights for recruiters
			if (isRecruiter && segments.length > 0) {
				const segmentIds = segments.map((s) => s.id);
				const highlightRes = await pool.query(
					`SELECT th.*, u.name as created_by_name
					 FROM transcript_highlights th
					 JOIN users u ON th.user_id = u.id
					 WHERE th.transcript_id = ANY($1)
					 ORDER BY th.created_at DESC`,
					[segmentIds],
				);
				const highlightsBySegment = highlightRes.rows.reduce((map, h) => {
					if (!map[h.transcript_id]) map[h.transcript_id] = [];
					map[h.transcript_id].push({
						id: h.id,
						note: h.note,
						created_by: h.created_by_name,
						created_at: h.created_at,
					});
					return map;
				}, {});

				for (const seg of segments) {
					// @ts-expect-error
					seg.highlights = highlightsBySegment[seg.id] || [];
				}
			}

			// Candidates cannot see internal notes — filter them out
			const safeSegments = segments.map((s) => ({
				id: s.id,
				speaker_identity: s.speaker_identity,
				text: s.text,
				start_time_ms: s.start_time_ms,
				end_time_ms: s.end_time_ms,
				confidence: s.confidence,
				created_at: s.created_at,
				...(isRecruiter && s.highlights ? { highlights: s.highlights } : {}),
			}));

			res.json({
				success: true,
				transcript: {
					recording_id: recordingId,
					segment_count: safeSegments.length,
					segments: safeSegments,
				},
			});
		} catch (err) {
			console.error('[recordings] Transcript get error:', err.message);
			res.status(500).json({ error: 'Failed to fetch transcript' });
		}
	},
);

// ─── POST /api/interviews/recordings/:id/consent ──────────────────────────

router.post(
	'/:id/consent',
	authMiddleware,
	[
		param('id').isInt({ min: 1 }).withMessage('Valid recording ID required'),
		body('consent_type')
			.optional()
			.isIn(['explicit', 'implicit'])
			.withMessage('Invalid consent_type'),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const recordingId = parseInt(req.params.id, 10);
			const user = req.user;
			const consentType = req.body.consent_type || 'explicit';

			const { canAccess, recording } = await canAccessRecording(recordingId, user);
			if (!canAccess) {
				return res.status(403).json({ error: 'Not authorized' });
			}

			if (recording.status === 'deleted') {
				return res.status(400).json({ error: 'Cannot consent to a deleted recording' });
			}

			// Upsert consent
			await pool.query(
				`INSERT INTO recording_consent (recording_id, user_id, consented_at, consent_type, ip_address, user_agent)
				 VALUES ($1, $2, NOW(), $3, $4, $5)
				 ON CONFLICT (recording_id, user_id)
				 DO UPDATE SET
				   consented_at = EXCLUDED.consented_at,
				   consent_type = EXCLUDED.consent_type,
				   ip_address = EXCLUDED.ip_address,
				   user_agent = EXCLUDED.user_agent`,
				[
					recordingId,
					user.id,
					consentType,
					req.ip || req.connection?.remoteAddress || null,
					req.headers['user-agent'] || null,
				],
			);

			res.json({
				success: true,
				message: 'Consent recorded',
				consent: {
					recording_id: recordingId,
					user_id: user.id,
					consent_type: consentType,
					consented_at: new Date().toISOString(),
				},
			});
		} catch (err) {
			console.error('[recordings] Consent error:', err.message);
			res.status(500).json({ error: 'Failed to record consent' });
		}
	},
);

// ─── POST /api/interviews/recordings/transcript/:segmentId/highlight ──────

router.post(
	'/transcript/:segmentId/highlight',
	authMiddleware,
	requirePermission('interviews:schedule'),
	rateLimits.standard,
	[
		param('segmentId').isInt({ min: 1 }).withMessage('Valid segment ID required'),
		body('note')
			.isString()
			.trim()
			.isLength({ min: 1, max: 2000 })
			.withMessage('Note required (1-2000 chars)'),
		body('timestamp_ms').optional().isInt({ min: 0 }).withMessage('Invalid timestamp_ms'),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const segmentId = parseInt(req.params.segmentId, 10);
			const { note, timestamp_ms } = req.body;
			const user = req.user;

			// Verify the transcript segment exists and user has access to its recording
			const segRes = await pool.query(
				`SELECT it.recording_id, ir.interview_event_id
				 FROM interview_transcripts it
				 JOIN interview_recordings ir ON it.recording_id = ir.id
				 WHERE it.id = $1`,
				[segmentId],
			);
			if (segRes.rows.length === 0) {
				return res.status(404).json({ error: 'Transcript segment not found' });
			}
			const { interview_event_id: eventId } = segRes.rows[0];

			// Verify recruiter access to this interview event
			const eventRes = await pool.query(
				`SELECT ie.recruiter_id, u.company_id as recruiter_company_id
				 FROM interview_events ie
				 LEFT JOIN users u ON ie.recruiter_id = u.id
				 WHERE ie.id = $1`,
				[eventId],
			);
			const event = eventRes.rows[0];
			if (!event) {
				return res.status(404).json({ error: 'Interview event not found' });
			}
			if (
				user.role !== 'admin' &&
				event.recruiter_id !== user.id &&
				event.recruiter_company_id !== user.company_id
			) {
				return res
					.status(403)
					.json({ error: 'Not authorized to add highlights to this recording' });
			}

			const result = await pool.query(
				`INSERT INTO transcript_highlights (transcript_id, user_id, note, highlight_timestamp_ms, created_at, updated_at)
				 VALUES ($1, $2, $3, $4, NOW(), NOW())
				 RETURNING *`,
				[segmentId, user.id, note, timestamp_ms || null],
			);

			res.status(201).json({
				success: true,
				highlight: {
					id: result.rows[0].id,
					transcript_id: segmentId,
					note: result.rows[0].note,
					highlight_timestamp_ms: result.rows[0].highlight_timestamp_ms,
					created_at: result.rows[0].created_at,
				},
			});
		} catch (err) {
			console.error('[recordings] Highlight error:', err.message);
			res.status(500).json({ error: 'Failed to add highlight' });
		}
	},
);

module.exports = router;
