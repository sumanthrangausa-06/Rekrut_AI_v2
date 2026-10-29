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
const { enqueueDiarizationForRecording } = require('../../lib/diarizationEnqueue');
const crypto = require('node:crypto');

const router = express.Router();

// #1619 (reviewer BLOCK on PR #1623): whisperResult is built by several
// provider writers the route does not control, and some stamp
// `confidence: 0` as their default for "no confidence reported"
// (Cartesia, NIM, ai-provider's Deepgram path). So 0 here is provider
// garbage, not a measurement — only a finite value in (0, 1] is a real
// measured confidence; missing/0/negative/>1/NaN all become null (the
// honest not-recorded state), never a fabricated number.
function recordedConfidence(value) {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1
		? value
		: null;
}

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

	// Phase 1 (#322, Task 4): session-linked recordings (AI screening /
	// AI interview) have no interview_event — access is governed by the
	// interview session: the candidate owns it; recruiters are company-scoped.
	if (recording.interview_session_id) {
		const sessRes = await pool.query('SELECT * FROM interview_sessions WHERE id = $1', [
			recording.interview_session_id,
		]);
		const session = sessRes.rows[0];
		if (!session) return { canAccess: false, recording: null, isRecruiter: false };

		const isCandidate = Number(session.candidate_id) === Number(user.id);
		const isRecruiter =
			user.role === 'admin' ||
			(isRecruiterRole(user.role) && Number(session.company_id) === Number(user.company_id));
		return {
			canAccess: isCandidate || isRecruiter,
			recording,
			session,
			isRecruiter,
			isCandidate,
		};
	}

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
					// #1914 (S-D12, §7): labelling state beside recording
					// state on management surfaces. NULL = feature not
					// applicable / never queued — the client renders
					// nothing, exactly as before this field existed.
					// Privacy delta (final): the raw value is operator-only
					// on EVERY user surface — this route's permission gate
					// (interviews:read) is grantable via RBAC to accounts
					// outside the operator class, so non-recruiter-side
					// viewers receive the §5.1 folded value here too,
					// exactly as on the detail payload.
					diarization_status: isRecruiterRole(user.role)
						? (r.diarization_status ?? null)
						: ['failed', 'unavailable'].includes(r.diarization_status)
							? 'unavailable'
							: (r.diarization_status ?? null),
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

			const { canAccess, recording, isRecruiter } = await canAccessRecording(recordingId, user);
			if (!canAccess) {
				return res.status(403).json({ error: 'Not authorized' });
			}

			// Fetch transcript summary — #802: purged tombstones (text =
			// '[purged]', written by euComplianceService) are absent content,
			// never counted as live segments.
			const transcriptRes = await pool.query(
				`SELECT COUNT(*) as segment_count, MAX(created_at) as last_transcript_at
				 FROM interview_transcripts WHERE recording_id = $1
				 AND text IS DISTINCT FROM '[purged]'`,
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
				// #1914 (S-D12, §7 + privacy BLOCK fix): this payload is
				// dual-audience — candidates can read their own recording
				// detail. Raw diarization_status is an operator value:
				// only recruiter-side/admin viewers receive it. Everyone
				// else gets the §5.1/§6.3 folded value — 'failed' and
				// 'unavailable' both read 'unavailable', so a candidate's
				// consent posture is never signalled by the distinction.
				diarization_status: isRecruiterRole(user.role)
					? (recording.diarization_status ?? null)
					: ['failed', 'unavailable'].includes(recording.diarization_status)
						? 'unavailable'
						: (recording.diarization_status ?? null),
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

			// GAP-A2 (#1130, R-6): marked (.enc) recordings are served ONLY
			// via this decrypt-proxy — no direct URL, no fallback on
			// decrypt failure (that would be a downgrade path). Access was
			// checked above (canAccessRecording) BEFORE any decrypt;
			// decryption uses the existing DEK only, in memory, no-store.
			// Destroyed-DEK/tamper and storage failures are indistinct
			// (#1200: raw S3 failures from the decrypt path propagate
			// uncoded and land on the 403 below — no distinct storage
			// signal. Only CONFIG_ERROR, which this path genuinely
			// produces when RECORDING_STORAGE_* is unset, is a 503.)
			if (livekitService.isEncryptedRecording(recording, storagePath)) {
				let plaintext = null;
				try {
					plaintext = await livekitService.fetchDecryptedRecording(recording);
					res.set('Content-Type', 'video/mp4');
					res.set('Content-Length', String(plaintext.length));
					res.set('Cache-Control', 'no-store');
					res.set('Content-Disposition', 'inline');
					return res.send(plaintext);
				} catch (decryptErr) {
					if (decryptErr.code === 'NOT_FOUND') {
						return res.status(404).json({ error: 'Recording not found' });
					}
					if (decryptErr.code === 'RECORDING_TOO_LARGE') {
						return res.status(413).json({ error: 'Recording too large' });
					}
					if (decryptErr.code === 'CONFIG_ERROR') {
						return res.status(503).json({ error: 'Recording temporarily unavailable' });
					}
					return res.status(403).json({ error: 'Recording access denied' });
				} finally {
					// #1200: zero the decrypted plaintext after use (DEK
					// zeroing habit; best-effort — JS GC may copy buffers).
					if (plaintext) plaintext.fill(0);
				}
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

			// Mark as processing — scoped to completed rows (R-5/C8): the
			// status resets below are likewise scoped to 'processing', so
			// they can never resurrect a quarantined/non-completed
			// recording to 'completed'.
			const claim = await pool.query(
				`UPDATE interview_recordings SET status = 'processing', updated_at = NOW() WHERE id = $1 AND status = 'completed'`,
				[recordingId],
			);
			// #1202: a concurrent transcribe may have already claimed this
			// recording — if the claim matched 0 rows, bail instead of
			// downloading and inserting a duplicate transcript.
			if (claim.rowCount === 0) {
				return res.status(409).json({ error: 'Transcription already in progress' });
			}

			// Download audio. GAP-A2 (#1130, R-6): .enc recordings decrypt
			// in memory via the DEK path (shared cap, no temp plaintext,
			// never downloadRecordingAudio's unauthenticated
			// constructed-URL fetch); legacy plaintext keeps that path.
			const audioBuffer = livekitService.isEncryptedRecording(recording, storagePath)
				? await livekitService.fetchDecryptedRecording(recording).catch(() => null)
				: await livekitService.downloadRecordingAudio(storagePath);
			if (!audioBuffer) {
				await pool.query(
					`UPDATE interview_recordings SET status = 'completed', updated_at = NOW() WHERE id = $1 AND status = 'processing'`,
					[recordingId],
				);
				return res.status(500).json({ error: 'Failed to download recording audio' });
			}

			// Convert to base64 for Whisper
			const audioBase64 = `data:audio/mp4;base64,${audioBuffer.toString('base64')}`;

			// Call Whisper transcription — with the S-D01 segment contract
			// (#1903): requireSegments makes segment-less legs continue the
			// cascade and an all-segment-less cascade return null, so a
			// result here always carries timed segments (or is null).
			const whisperResult = await transcribeAudioWithWhisper(audioBase64, {
				subscriptionId: user.subscription_id,
				requireSegments: true,
			});

			if (!whisperResult?.text) {
				await pool.query(
					`UPDATE interview_recordings SET status = 'completed', updated_at = NOW() WHERE id = $1 AND status = 'processing'`,
					[recordingId],
				);
				return res.status(500).json({ error: 'Transcription failed' });
			}

			// S-D02 (#1904, Architecture §3.1): store ONE ROW PER SEGMENT
			// with real timestamps, replacing the previous generation
			// atomically. The old segments AND any diarization artefacts
			// for the recording are deleted in the SAME transaction as
			// the new insert, so old labels can never sit on new text
			// and a failed swap leaves the old generation untouched.
			// speaker_identity stays 'unknown' — labels are composed at
			// read time (S-D09), never stored here.
			const segments = Array.isArray(whisperResult.segments) ? whisperResult.segments : [];
			if (segments.length === 0) {
				// requireSegments guarantees segments on a win; treat a
				// segment-less result as an honest transcription failure
				// rather than reviving the whole-recording single row.
				await pool.query(
					`UPDATE interview_recordings SET status = 'completed', updated_at = NOW() WHERE id = $1 AND status = 'processing'`,
					[recordingId],
				);
				return res.status(500).json({ error: 'Transcription failed' });
			}

			const client = await pool.connect();
			try {
				await client.query('BEGIN');
				await client.query(`DELETE FROM diarization_runs WHERE recording_id = $1`, [
					recordingId,
				]);
				await client.query(
					`DELETE FROM recording_speaker_mappings WHERE recording_id = $1`,
					[recordingId],
				);
				await client.query(`DELETE FROM transcript_speaker_audit WHERE recording_id = $1`, [
					recordingId,
				]);
				await client.query(`DELETE FROM diarization_jobs WHERE recording_id = $1`, [
					recordingId,
				]);
				// transcript_highlights rows die with their segments
				// (transcript_id ON DELETE CASCADE, migration 128).
				await client.query(`DELETE FROM interview_transcripts WHERE recording_id = $1`, [
					recordingId,
				]);
				for (const seg of segments) {
					await client.query(
						`INSERT INTO interview_transcripts
						 (recording_id, speaker_identity, text, start_time_ms, end_time_ms, confidence)
						 VALUES ($1, $2, $3, $4, $5, $6)`,
						[
							recordingId,
							'unknown',
							seg.text,
							Math.round(seg.start_s * 1000),
							Math.round(seg.end_s * 1000),
							recordedConfidence(whisperResult.confidence),
						],
					);
				}
				// Completion flips in the same transaction; the
				// diarization timeline resets with its artefacts (the
				// next generation's job is S-D04's enqueue, not this
				// story's). Scoped to 'processing' per the R-5 pattern.
				await client.query(
					`UPDATE interview_recordings
					 SET status = 'completed', diarization_status = NULL,
					     diarization_updated_at = NOW(), updated_at = NOW()
					 WHERE id = $1 AND status = 'processing'`,
					[recordingId],
				);
				await client.query('COMMIT');
			} catch (txErr) {
				await client.query('ROLLBACK').catch(() => {});
				throw txErr;
			} finally {
				client.release();
			}

			// S-D04 (#1906, Architecture §3.1 step 3 / §6.1 BR-1): after
			// the segment insert commits, enqueue a diarization job —
			// only when the feature is enabled AND the recording is
			// event-linked (the human-interview path; session-linked
			// AI-led recordings are out of scope). With the flag off
			// nothing is enqueued and the transcript behaves exactly as
			// before this feature (AC-1). Best-effort: enqueue is a DB
			// insert after the response's work is done — a failure here
			// must never fail the transcription (FR-D07: response shape
			// and timing unchanged).
			// S-D19 (#1956, §7.2, security S-7): the enqueue step is a
			// third check — lib/diarizationEnqueue evaluates the panel
			// leg and SUPPRESSES the enqueue (no job row, state folded
			// to 'unavailable') when a panel block already stands.
			try {
				await enqueueDiarizationForRecording(recordingId);
			} catch (enqErr) {
				console.error('[recordings] diarization enqueue failed:', enqErr.message);
			}

			res.json({
				success: true,
				transcript: {
					text: whisperResult.text,
					duration_ms: (recording.duration_seconds || 0) * 1000,
					confidence: recordedConfidence(whisperResult.confidence),
				},
			});
		} catch (err) {
			console.error('[recordings] Transcribe error:', err.message);
			// Always reset status on error
			try {
				await pool.query(
					`UPDATE interview_recordings SET status = 'completed', updated_at = NOW() WHERE id = $1 AND status = 'processing'`,
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

			const { canAccess, recording, isRecruiter } = await canAccessRecording(recordingId, user);
			if (!canAccess) {
				return res.status(403).json({ error: 'Not authorized' });
			}

			// S-D09 (#1911, §3.8/§5.1): a recording is post-feature iff it
			// carries diarization state. Legacy recordings take the exact
			// pre-S-D09 query and response shape (AC-1 byte-identical);
			// post-feature recordings additionally select speaker_number
			// for the composition below.
			const isPostFeature = recording.diarization_status != null;

			// #802: purged tombstones render as absence — never serialise
			// the '[purged]' sentinel to clients.
			const transcriptRes = await pool.query(
				isPostFeature
					? `SELECT id, speaker_identity, text, start_time_ms, end_time_ms, confidence, created_at, speaker_number
						 FROM interview_transcripts
						 WHERE recording_id = $1
						 AND text IS DISTINCT FROM '[purged]'
						 ORDER BY start_time_ms`
					: `SELECT id, speaker_identity, text, start_time_ms, end_time_ms, confidence, created_at
						 FROM interview_transcripts
						 WHERE recording_id = $1
						 AND text IS DISTINCT FROM '[purged]'
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

			// S-D09 (#1911, §3.8/§5.1): compose speaker labels for
			// post-feature recordings. Names come ONLY from
			// recording_speaker_mappings (Rex ruling 1 / C1) — never from
			// participant-list ordering and never from
			// diarization_runs.proposed_mapping, which is never returned.
			// Coverage is per segment (Rex ruling 2 / C4):
			// diarization_covered ≡ speaker_number IS NOT NULL;
			// coverage_end_ms is run provenance and is not read here.
			// No share / count / confidence / percentage field is added
			// anywhere below (AC-5, FR-D13/D14/D21).
			let diarization = null;
			const labelBySpeaker = new Map();
			if (isPostFeature) {
				const mapRes = await pool.query(
					`SELECT m.speaker_number, m.participant_user_id, m.participant_role,
					        m.state, u.name AS participant_name
					 FROM recording_speaker_mappings m
					 LEFT JOIN users u ON u.id = m.participant_user_id
					 WHERE m.recording_id = $1
					 ORDER BY m.speaker_number`,
					[recordingId],
				);
				const labelFor = (row) => {
					if (row.participant_user_id != null && row.participant_name) {
						const roleLabel = row.participant_role === 'candidate' ? 'Candidate' : 'Interviewer';
						return `${roleLabel} — ${row.participant_name}`;
					}
					// Unassigned (incl. capped panel speakers, C2) or a
					// participant whose user no longer resolves (erasure
					// SET NULL) — never a guessed name (FR-D09).
					return `Speaker ${row.speaker_number + 1}`;
				};
				for (const row of mapRes.rows) {
					labelBySpeaker.set(row.speaker_number, labelFor(row));
				}

				let mappingState = null;
				if (mapRes.rows.length > 0) {
					if (mapRes.rows.some((r) => r.state === 'corrected')) mappingState = 'corrected';
					else if (mapRes.rows.some((r) => r.state === 'confirmed')) mappingState = 'confirmed';
					else mappingState = 'proposed';
				}

				// Corrected-by line (§3.8/FR-D11): the latest CORRECTION's
				// actor — audit rows with action 'correct' or 'unassign'
				// only (PR #1936 privacy review F-1). A 'confirm' row must
				// never publish its actor as the corrector, and a later
				// confirm must not replace the true corrector. S-D10 writes
				// these rows; an actor who no longer resolves leaves both
				// fields honestly null.
				let correctedBy = null;
				let correctedAt = null;
				const auditRes = await pool.query(
					`SELECT a.created_at, u.name AS actor_name
					 FROM transcript_speaker_audit a
					 LEFT JOIN users u ON u.id = a.actor_user_id
					 WHERE a.recording_id = $1
					 AND a.action IN ('correct', 'unassign')
					 ORDER BY a.created_at DESC, a.id DESC
					 LIMIT 1`,
					[recordingId],
				);
				if (auditRes.rows.length > 0 && auditRes.rows[0].actor_name) {
					correctedBy = auditRes.rows[0].actor_name;
					correctedAt = auditRes.rows[0].created_at;
				}

				diarization = {
					// §5.1/§5.5: failure and consent-unavailable both
					// surface as 'unavailable'; reasons are never exposed.
					status: ['failed', 'unavailable'].includes(recording.diarization_status)
						? 'unavailable'
						: recording.diarization_status,
					mapping_state: mappingState,
					corrected_by: correctedBy,
					corrected_at: correctedAt,
					speakers: mapRes.rows.map((row) => ({
						speaker_number: row.speaker_number,
						label: labelFor(row),
						assigned: row.participant_user_id != null && !!row.participant_name,
					})),
				};
			}

			// Candidates cannot see internal notes — filter them out
			const safeSegments = segments.map((s) => {
				if (!isPostFeature) {
					return {
						id: s.id,
						speaker_identity: s.speaker_identity,
						text: s.text,
						start_time_ms: s.start_time_ms,
						end_time_ms: s.end_time_ms,
						confidence: s.confidence,
						created_at: s.created_at,
						...(isRecruiter && s.highlights ? { highlights: s.highlights } : {}),
					};
				}
				const covered = s.speaker_number != null;
				return {
					id: s.id,
					// Covered: composed label (mapping name or "Speaker N").
					// Uncovered: the stored value stays in the payload, but
					// diarization_covered: false tells the client to render
					// NO speaker heading (§3.8) — never guess from the string.
					speaker_identity: covered
						? (labelBySpeaker.get(s.speaker_number) ?? `Speaker ${s.speaker_number + 1}`)
						: s.speaker_identity,
					speaker_number: s.speaker_number,
					diarization_covered: covered,
					text: s.text,
					start_time_ms: s.start_time_ms,
					end_time_ms: s.end_time_ms,
					confidence: s.confidence,
					created_at: s.created_at,
					...(isRecruiter && s.highlights ? { highlights: s.highlights } : {}),
				};
			});

			res.json({
				success: true,
				transcript: {
					recording_id: recordingId,
					segment_count: safeSegments.length,
					segments: safeSegments,
					...(isPostFeature ? { diarization } : {}),
				},
			});
		} catch (err) {
			console.error('[recordings] Transcript get error:', err.message);
			res.status(500).json({ error: 'Failed to fetch transcript' });
		}
	},
);

// ─── S-D10 (#1912, §5.2/§5.3): speaker mapping editor ────────────────────

const { participantsFromEvent, participantsFromFrozenSet } = require('../../lib/speakerMapping');

/**
 * §13 item 7 (S-D19, #1956; security S-4): the mapping-correction
 * participant source is the recording's FROZEN set ∪ candidate ∪
 * recruiter, as frozen at recording creation — not the event's current
 * lists. A user added to the event afterwards is not assignable to a
 * recording they were never a captured speaker on; an assignee valid
 * when the recording was made stays valid. Pre-299 recordings carry
 * no freeze (null) and keep the legacy event source.
 */
function mappingParticipantRefs(recording, event) {
	return participantsFromFrozenSet(recording, event) ?? participantsFromEvent(event || null);
}

/**
 * Corrector gate (§5.2): the recruiter of record, a panel interviewer of
 * record, or an admin — derived EXPLICITLY, never by subtracting the
 * candidate from canAccessRecording. Access there is company-scoped
 * (any same-company recruiter may VIEW), which is wider than §5.2's
 * corrector set on both branches (PR #1937 review BLOCK-1): viewing is
 * not correcting. A session-linked recording has no event, hence no
 * recruiter/panel of record — only an admin corrects it. Candidates
 * never correct — their route is "raise it with the hiring team"
 * (PRD §7). Returns null when the caller may not correct.
 */
async function correctorAccess(recordingId, user) {
	const access = await canAccessRecording(recordingId, user);
	if (!access.canAccess || access.isCandidate) return null;
	if (user.role === 'admin') return access;
	if (!access.event) return null;
	const isOfRecord = access.event.recruiter_id === user.id;
	const isPanel = (access.event.panel_member_ids || []).includes(user.id);
	return isOfRecord || isPanel ? access : null;
}

/**
 * The §5.2 editor payload, shared by GET /:id/speakers and the PUT
 * response. Names come only from recording_speaker_mappings + users —
 * the same source the transcript read composes from (S-D09 C1) — and no
 * diarization-derived quantity is exposed (§5.1 fence).
 */
async function speakerEditorPayload(recordingId, event, recording) {
	const mapRes = await pool.query(
		`SELECT m.speaker_number, m.participant_user_id, m.participant_role,
		        m.state, u.name AS participant_name
		 FROM recording_speaker_mappings m
		 LEFT JOIN users u ON u.id = m.participant_user_id
		 WHERE m.recording_id = $1
		 ORDER BY m.speaker_number`,
		[recordingId],
	);

	// Sample turn (§5.2): each speaker's longest segment — the most
	// identifying words — earliest start on ties.
	const sampleRes = await pool.query(
		`SELECT DISTINCT ON (speaker_number) speaker_number, text, start_time_ms
		 FROM interview_transcripts
		 WHERE recording_id = $1 AND speaker_number IS NOT NULL
		   AND text IS DISTINCT FROM '[purged]'
		 ORDER BY speaker_number, (end_time_ms - start_time_ms) DESC, start_time_ms ASC`,
		[recordingId],
	);
	const sampleBySpeaker = new Map(sampleRes.rows.map((r) => [r.speaker_number, r]));

	// Correction history summary — same rule as the transcript read
	// (S-D09, PR #1936 F-1): latest 'correct'/'unassign' row only.
	let correctedBy = null;
	let correctedAt = null;
	const auditRes = await pool.query(
		`SELECT a.created_at, u.name AS actor_name
		 FROM transcript_speaker_audit a
		 LEFT JOIN users u ON u.id = a.actor_user_id
		 WHERE a.recording_id = $1
		 AND a.action IN ('correct', 'unassign')
		 ORDER BY a.created_at DESC, a.id DESC
		 LIMIT 1`,
		[recordingId],
	);
	if (auditRes.rows.length > 0 && auditRes.rows[0].actor_name) {
		correctedBy = auditRes.rows[0].actor_name;
		correctedAt = auditRes.rows[0].created_at;
	}

	let mappingState = null;
	if (mapRes.rows.length > 0) {
		if (mapRes.rows.some((r) => r.state === 'corrected')) mappingState = 'corrected';
		else if (mapRes.rows.some((r) => r.state === 'confirmed')) mappingState = 'confirmed';
		else mappingState = 'proposed';
	}

	// Assignment options: the recording's participants — the FROZEN
	// set (§13 item 7, S-4) when the recording carries a freeze, else
	// the event's current lists (legacy pre-299 rows).
	const participantRefs = mappingParticipantRefs(recording, event);
	let participants = [];
	if (participantRefs.length > 0) {
		const nameRes = await pool.query(`SELECT id, name FROM users WHERE id = ANY($1::int[])`, [
			participantRefs.map((p) => p.userId),
		]);
		const nameById = new Map(nameRes.rows.map((r) => [r.id, r.name]));
		participants = participantRefs.map((p) => ({
			user_id: p.userId,
			role: p.role,
			name: nameById.get(p.userId) ?? null,
		}));
	}

	return {
		speakers: mapRes.rows.map((row) => {
			const sample = sampleBySpeaker.get(row.speaker_number);
			return {
				speaker_number: row.speaker_number,
				participant_user_id: row.participant_user_id,
				participant_role: row.participant_role,
				participant_name: row.participant_name,
				state: row.state,
				sample_turn: sample
					? { text: sample.text, start_time_ms: Number(sample.start_time_ms) }
					: null,
			};
		}),
		participants,
		mapping_state: mappingState,
		corrected_by: correctedBy,
		corrected_at: correctedAt,
	};
}

router.get(
	'/:id/speakers',
	authMiddleware,
	[param('id').isInt({ min: 1 }).withMessage('Valid recording ID required')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const recordingId = parseInt(req.params.id, 10);
			const access = await correctorAccess(recordingId, req.user);
			if (!access) {
				return res.status(403).json({ error: 'Not authorized' });
			}
			const payload = await speakerEditorPayload(recordingId, access.event, access.recording);
			res.json({ success: true, ...payload });
		} catch (err) {
			console.error('[recordings] Speakers get error:', err.message);
			res.status(500).json({ error: 'Failed to fetch speakers' });
		}
	},
);

router.put(
	'/:id/speakers/mapping',
	authMiddleware,
	[param('id').isInt({ min: 1 }).withMessage('Valid recording ID required')],
	handleValidationErrors,
	async (req, res) => {
		const recordingId = parseInt(req.params.id, 10);
		const actorId = req.user.id;
		try {
			const access = await correctorAccess(recordingId, req.user);
			if (!access) {
				return res.status(403).json({ error: 'Not authorized' });
			}
			// §5.5: nothing to correct until labelling is complete.
			if (access.recording.diarization_status !== 'complete') {
				return res
					.status(409)
					.json({ error: 'Speaker labelling is not complete for this recording' });
			}

			const assignments = req.body?.assignments;
			if (!Array.isArray(assignments) || assignments.length === 0) {
				return res.status(400).json({ error: 'assignments must be a non-empty array' });
			}
			const seenSpeakers = new Set();
			for (const a of assignments) {
				if (!a || !Number.isInteger(a.speaker_number)) {
					return res.status(400).json({ error: 'each assignment needs an integer speaker_number' });
				}
				if (seenSpeakers.has(a.speaker_number)) {
					return res.status(400).json({ error: `duplicate speaker_number ${a.speaker_number}` });
				}
				seenSpeakers.add(a.speaker_number);
				if (a.participant_user_id !== null && !Number.isInteger(a.participant_user_id)) {
					return res
						.status(400)
						.json({ error: 'participant_user_id must be an integer or null' });
				}
			}

			// §5.3 validation is fail-closed — the control that keeps a
			// wrong name out of the transcript (PR #1936 F-2 note). Every
			// check runs before any write; the write itself is one
			// transaction, so a rejection can never partially land.
			// S-D19 (§13 item 7, S-4): the participant source is the
			// recording's FROZEN set, not the event's current lists.
			const participantRefs = mappingParticipantRefs(access.recording, access.event);
			const roleByUserId = new Map(participantRefs.map((p) => [p.userId, p.role]));

			const client = await pool.connect();
			try {
				await client.query('BEGIN');
				const curRes = await client.query(
					`SELECT speaker_number, participant_user_id, state
					 FROM recording_speaker_mappings
					 WHERE recording_id = $1
					 ORDER BY speaker_number
					 FOR UPDATE`,
					[recordingId],
				);
				const current = new Map(curRes.rows.map((r) => [r.speaker_number, r]));

				for (const a of assignments) {
					if (!current.has(a.speaker_number)) {
						await client.query('ROLLBACK');
						return res
							.status(400)
							.json({ error: `speaker_number ${a.speaker_number} does not exist for this recording` });
					}
					if (a.participant_user_id !== null && !roleByUserId.has(a.participant_user_id)) {
						await client.query('ROLLBACK');
						return res
							.status(400)
							.json({ error: 'participant_user_id is not a participant of this recording' });
					}
				}

				// Resulting full mapping (listed speakers overridden,
				// unlisted untouched): one participant, one voice.
				const resulting = new Map(
					curRes.rows.map((r) => [r.speaker_number, r.participant_user_id]),
				);
				for (const a of assignments) resulting.set(a.speaker_number, a.participant_user_id);
				const claimedBy = new Map();
				for (const [speakerNumber, userId] of resulting) {
					if (userId === null) continue;
					if (claimedBy.has(userId)) {
						await client.query('ROLLBACK');
						return res
							.status(400)
							.json({ error: 'a participant can be assigned to only one speaker' });
					}
					claimedBy.set(userId, speakerNumber);
				}

				const changes = assignments.filter(
					(a) => current.get(a.speaker_number).participant_user_id !== a.participant_user_id,
				);

				if (changes.length === 0) {
					// Acceptance (AC-4): re-PUTting the proposal unchanged
					// while every row is still 'proposed' records the
					// confirmation. Rows still 'proposed' hold the proposal
					// by construction — only this endpoint mutates them,
					// and it never leaves a changed row 'proposed'. Any
					// other identical re-PUT is a pure no-op (§5.3).
					const allProposed =
						curRes.rows.length > 0 && curRes.rows.every((r) => r.state === 'proposed');
					const coversAll = assignments.length === curRes.rows.length;
					if (allProposed && coversAll) {
						for (const row of curRes.rows) {
							await client.query(
								`UPDATE recording_speaker_mappings
								 SET state = 'confirmed', updated_by = $1, updated_at = NOW()
								 WHERE recording_id = $2 AND speaker_number = $3`,
								[actorId, recordingId, row.speaker_number],
							);
							await client.query(
								`INSERT INTO transcript_speaker_audit
								   (recording_id, speaker_number, from_user_id, to_user_id, actor_user_id, action)
								 VALUES ($1, $2, $3, $3, $4, 'confirm')`,
								[recordingId, row.speaker_number, row.participant_user_id, actorId],
							);
						}
					}
					await client.query('COMMIT');
				} else {
					// First correction ever for this recording? (HA-3 daily
					// count moves once per corrected recording.)
					const priorRes = await client.query(
						`SELECT COUNT(*)::int AS n FROM transcript_speaker_audit
						 WHERE recording_id = $1 AND action IN ('correct', 'unassign')`,
						[recordingId],
					);
					for (const a of changes) {
						const fromUserId = current.get(a.speaker_number).participant_user_id;
						await client.query(
							`UPDATE recording_speaker_mappings
							 SET participant_user_id = $1, participant_role = $2,
							     state = 'corrected', updated_by = $3, updated_at = NOW()
							 WHERE recording_id = $4 AND speaker_number = $5`,
							[
								a.participant_user_id,
								a.participant_user_id === null
									? null
									: roleByUserId.get(a.participant_user_id),
								actorId,
								recordingId,
								a.speaker_number,
							],
						);
						await client.query(
							`INSERT INTO transcript_speaker_audit
							   (recording_id, speaker_number, from_user_id, to_user_id, actor_user_id, action)
							 VALUES ($1, $2, $3, $4, $5, $6)`,
							[
								recordingId,
								a.speaker_number,
								fromUserId,
								a.participant_user_id,
								actorId,
								a.participant_user_id === null ? 'unassign' : 'correct',
							],
						);
					}
					if (priorRes.rows[0].n === 0) {
						await client.query(
							`INSERT INTO diarization_metrics_daily (date, labelled_count, corrected_count)
							 VALUES (CURRENT_DATE, 0, 1)
							 ON CONFLICT (date) DO UPDATE
							 SET corrected_count = diarization_metrics_daily.corrected_count + 1`,
						);
					}
					await client.query('COMMIT');
				}
			} catch (txErr) {
				await client.query('ROLLBACK').catch(() => {});
				throw txErr;
			} finally {
				client.release();
			}

			const payload = await speakerEditorPayload(recordingId, access.event, access.recording);
			res.json({ success: true, ...payload });
		} catch (err) {
			console.error('[recordings] Speaker mapping put error:', err.message);
			res.status(500).json({ error: 'Failed to save speaker mapping' });
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
			.isIn(['explicit', 'implicit', 'withdrawn'])
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

			// Task 6 (#323): consent withdrawal stops capture mid-session — stop the
			// session's room egress (best-effort). The recording row is kept per
			// the Phase 1 retention policy; only capture stops, mirroring the
			// frame-capture gate (Phase 1 blocks capture, it does not delete).
			if (consentType === 'withdrawn' && recording.interview_session_id) {
				try {
					await livekitService.stopSessionEgress(recording.interview_session_id);
				} catch (stopErr) {
					console.error('[recordings] egress stop on consent withdrawal failed:', stopErr.message);
				}
			}

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
