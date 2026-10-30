const express = require('express');
const pool = require('../lib/db');
const { authMiddleware, requireRole } = require('../lib/auth');
const { rateLimits, distributedRateLimiter } = require('../lib/distributed-rate-limiter');
const panelLabelling = require('../lib/panelLabelling'); // S-D18 (#1955) BR-7 capture
const calendarService = require('../server/services/calendar-service');
const livekitService = require('../server/services/livekit'); // Issue #124
const { ensureGoverningSession } = require('../lib/governingSession'); // #1925 (ADR-D06)
const consentService = require('../lib/consentService'); // #1925 (ADR-D06 §4.4)
const { body, param, validationResult } = require('express-validator');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function handleValidationErrors(req, res, next) {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({
			error: 'Validation failed',
			// @ts-expect-error express-validator type mismatch
			details: errors
				.array()
				.map((e) => ({ field: e.param || e.path || 'unknown', message: e.msg })),
		});
	}
	next();
}

function isRecruiter(role) {
	return ['recruiter', 'hiring_manager', 'employer', 'admin'].includes(role);
}

/**
 * Convert a UTC timestamptz to a local ISO string in the given timezone.
 * Falls back to UTC if timezone is invalid.
 */
function toLocalIso(utcDate, timezone) {
	try {
		return new Date(utcDate).toLocaleString('en-US', {
			timeZone: timezone || 'UTC',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		});
	} catch (_e) {
		return new Date(utcDate).toISOString();
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/interviews — List interview events (role-based)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/', authMiddleware, async (req, res) => {
	try {
		const user = req.user;
		const { status, limit = 50, offset = 0 } = req.query;
		const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
		const offsetNum = parseInt(offset, 10) || 0;

		let sql = `
				SELECT
					ie.id,
					ie.job_application_id,
					ie.recruiter_id,
					ie.candidate_id,
					ie.panel_member_ids,
					ie.scheduled_at,
					ie.duration_minutes,
					ie.timezone,
					ie.status,
					ie.calendar_event_ids,
					ie.livekit_room_url,
					ie.meeting_link,
					ie.notes,
					ie.created_at,
					ie.updated_at,
					u.name as candidate_name,
					u.email as candidate_email,
					r.name as recruiter_name,
					r.email as recruiter_email,
					j.title as job_title
				FROM interview_events ie
				LEFT JOIN users u ON ie.candidate_id = u.id
				LEFT JOIN users r ON ie.recruiter_id = r.id
				LEFT JOIN job_applications ja ON ie.job_application_id = ja.id
				LEFT JOIN jobs j ON ja.job_id = j.id
			`;
		const params = [];
		const conditions = [];

		if (isRecruiter(user.role)) {
			// Recruiters see events where they are the recruiter OR
			// events for candidates in their company
			conditions.push(`(ie.recruiter_id = $${params.length + 1} OR ie.candidate_id IN (
					SELECT id FROM users WHERE company_id = $${params.length + 2}
				))`);
			params.push(user.id, user.company_id || 0);
		} else {
			// Candidates see only their own events
			conditions.push(`ie.candidate_id = $${params.length + 1}`);
			params.push(user.id);
		}

		if (status) {
			conditions.push(`ie.status = $${params.length + 1}`);
			params.push(status);
		}

		if (conditions.length > 0) {
			sql += ` WHERE ${conditions.join(' AND ')}`;
		}

		sql += ` ORDER BY ie.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
		params.push(limitNum, offsetNum);

		const result = await pool.query(sql, params);

		// Enrich with proposed slots for each event
		const events = await Promise.all(
			result.rows.map(async (evt) => {
				const slotsRes = await pool.query(
					`SELECT * FROM proposed_slots WHERE interview_event_id = $1 ORDER BY slot_start`,
					[evt.id],
				);
				return {
					...evt,
					scheduled_at_local: evt.scheduled_at ? toLocalIso(evt.scheduled_at, evt.timezone) : null,
					proposed_slots: slotsRes.rows.map((s) => ({
						...s,
						slot_start_local: toLocalIso(s.slot_start, s.timezone),
						slot_end_local: toLocalIso(s.slot_end, s.timezone),
					})),
				};
			}),
		);

		res.json({ success: true, events, count: events.length });
	} catch (err) {
		console.error('[interview-events] List error:', err.message, err.stack);
		res.status(500).json({ error: 'Failed to list interview events' });
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interviews — Create a new interview event with proposed slots
// ─────────────────────────────────────────────────────────────────────────────

router.post(
	'/',
	authMiddleware,
	requireRole('recruiter', 'hiring_manager', 'employer', 'admin'),
	rateLimits.ai,
	[
		body('job_application_id').isInt({ min: 1 }).withMessage('Valid job_application_id required'),
		body('candidate_id').isInt({ min: 1 }).withMessage('Valid candidate_id required'),
		body('duration_minutes')
			.optional()
			.isInt({ min: 15, max: 480 })
			.withMessage('Duration must be 15-480 minutes'),
		body('timezone')
			.optional()
			.isString()
			.trim()
			.isLength({ min: 1, max: 100 })
			.withMessage('Timezone required'),
		body('proposed_slots')
			.isArray({ min: 1, max: 10 })
			.withMessage('At least 1 and at most 10 proposed slots required'),
		body('proposed_slots.*.slot_start')
			.isISO8601()
			.withMessage('Each slot must have a valid ISO8601 start time'),
		body('proposed_slots.*.slot_end')
			.isISO8601()
			.withMessage('Each slot must have a valid ISO8601 end time'),
		body('panel_member_ids').optional().isArray().withMessage('panel_member_ids must be an array'),
		body('notes').optional().trim().isLength({ max: 2000 }).withMessage('Notes too long'),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const recruiterId = req.user.id;
			const {
				job_application_id,
				candidate_id,
				duration_minutes = 60,
				timezone = 'UTC',
				proposed_slots,
				panel_member_ids = [],
				notes,
			} = req.body;

			// Verify the job application exists and belongs to recruiter's company
			const jaCheck = await pool.query(
				`SELECT ja.*, j.company_id as job_company_id
				 FROM job_applications ja
				 JOIN jobs j ON ja.job_id = j.id
				 WHERE ja.id = $1 AND ja.candidate_id = $2`,
				[job_application_id, candidate_id],
			);
			if (jaCheck.rows.length === 0) {
				return res.status(404).json({ error: 'Job application not found' });
			}
			const jobApp = jaCheck.rows[0];

			// Recruiters can only create interviews for their own company
			if (req.user.role !== 'admin' && jobApp.job_company_id !== req.user.company_id) {
				return res.status(403).json({ error: 'Not authorized for this job application' });
			}

			// Validate panel members are users in the same company
			if (panel_member_ids.length > 0) {
				const pmCheck = await pool.query(
					`SELECT id FROM users WHERE id = ANY($1) AND company_id = $2`,
					[panel_member_ids, req.user.company_id || 0],
				);
				if (pmCheck.rows.length !== panel_member_ids.length) {
					return res
						.status(400)
						.json({ error: 'One or more panel members are invalid or not in your company' });
				}
			}

			// Create interview event + its governing session + proposed
			// slots in ONE transaction (#1925, ADR-D06 §4.1): the event's
			// own session (type 'human', biometric_collection:false —
			// consent starts refused-by-default) is created via
			// SessionService.create and linked on the event row, so the
			// diarization consent gate has a session to check for this
			// interview. If any leg fails, none of it lands.
			const client = await pool.connect();
			let event;
			try {
				await client.query('BEGIN');
				const eventResult = await client.query(
					`INSERT INTO interview_events
					 (job_application_id, recruiter_id, candidate_id, panel_member_ids, duration_minutes, timezone, status, notes, created_at, updated_at)
					 VALUES ($1, $2, $3, $4, $5, $6, 'proposed', $7, NOW(), NOW())
					 RETURNING *`,
					[
						job_application_id,
						recruiterId,
						candidate_id,
						panel_member_ids,
						duration_minutes,
						timezone,
						notes || null,
					],
				);
				event = eventResult.rows[0];

				const governingSessionId = await ensureGoverningSession(event, {
					callerRole: req.user.role,
					executor: client,
				});
				event = { ...event, interview_session_id: governingSessionId };

				// Build multi-row insert for the proposed slots
				const batchSize = 10;
				for (let i = 0; i < proposed_slots.length; i += batchSize) {
					const batch = proposed_slots.slice(i, i + batchSize);
					const placeholders = batch
						.map(
							(_, idx) =>
								`($${idx * 6 + 1}, $${idx * 6 + 2}, $${idx * 6 + 3}, $${idx * 6 + 4}, $${idx * 6 + 5}, $${idx * 6 + 6})`,
						)
						.join(', ');
					const batchParams = batch.flatMap((s) => [
						event.id,
						recruiterId,
						new Date(s.slot_start),
						new Date(s.slot_end),
						timezone,
						'offered',
					]);
					await client.query(
						`INSERT INTO proposed_slots (interview_event_id, proposed_by, slot_start, slot_end, timezone, status)
						 VALUES ${placeholders}`,
						batchParams,
					);
				}

				await client.query('COMMIT');
			} catch (txErr) {
				await client.query('ROLLBACK').catch(() => {});
				throw txErr;
			} finally {
				client.release();
			}

			res.status(201).json({
				success: true,
				event: {
					...event,
					proposed_slots: proposed_slots.map((s) => ({
						...s,
						slot_start_local: toLocalIso(s.slot_start, timezone),
						slot_end_local: toLocalIso(s.slot_end, timezone),
					})),
				},
			});
		} catch (err) {
			console.error('[interview-events] Create error:', err.message, err.stack);
			res.status(500).json({ error: 'Failed to create interview event' });
		}
	},
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interviews/:id/biometric-consent — candidate records their
// biometric consent decision FOR THIS INTERVIEW (#1925, ADR-D06 §4.4)
// ─────────────────────────────────────────────────────────────────────────────
//
// Server-side capture contract for the event flow: the decision is
// recorded with consentService.recordConsent against the event's
// GOVERNING session only — never a sibling session — and recordConsent
// itself performs the existing S-070 propagation (a grant sets the
// governing session's config.biometric_collection=true; a decline
// leaves it false and records the never-granted receipt). The current
// consent text for the candidate to read is the existing
// GET /api/consent/texts/biometric (v1.2+, diarization-disclosing).
//
// GAP (recorded, not hidden): the join-screen UI surface that presents
// this capture in the client is a separate, larger client build — see
// the #1925 build log. This endpoint is the contract it will call.

router.post(
	'/:id/biometric-consent',
	authMiddleware,
	[
		param('id').isInt({ min: 1 }).withMessage('Valid interview ID required'),
		body('accepted').isBoolean().withMessage('accepted must be a boolean'),
		body('locale').optional().isIn(['en', 'hi']).withMessage('Invalid locale'),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const eventId = parseInt(req.params.id, 10);
			const eventRes = await pool.query('SELECT * FROM interview_events WHERE id = $1', [eventId]);
			if (eventRes.rows.length === 0) {
				return res.status(404).json({ error: 'Interview event not found' });
			}
			const event = eventRes.rows[0];

			// Only the event's own candidate may record consent for it.
			if (event.candidate_id !== req.user.id) {
				return res.status(403).json({ error: 'Only the candidate can record consent for this interview' });
			}

			// #1950 M5: per-(user,event) rate limit, consistent with the
			// BR-7 labelling-consent capture in this file (same limiter,
			// same window/cap, same uniform 429 shape) — without it the
			// event's own candidate could grow the consent/audit tables
			// unboundedly. checkLimit fails open on limiter-store error
			// (inherited, as with the panel capture): the limiter is
			// anti-abuse, the consent checks below stay fail-closed.
			const rl = await distributedRateLimiter.checkLimit(
				`biometric-consent:${req.user.id}:${eventId}`,
				60 * 1000,
				10,
			);
			if (!rl.allowed) {
				return res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMITED' });
			}

			if (!event.interview_session_id) {
				return res
					.status(409)
					.json({ error: 'This interview has no governing session yet', code: 'NO_GOVERNING_SESSION' });
			}

			// S-011 ownership guard: the governing session must belong
			// to this candidate (prevents receipt planting).
			await consentService.assertSessionOwnership(event.interview_session_id, req.user.id);

			const receipt = await consentService.recordConsent({
				sessionId: event.interview_session_id,
				candidateId: req.user.id,
				type: 'biometric',
				accepted: req.body.accepted,
				locale: req.body.locale || 'en',
				ipAddress: req.ip,
			});

			res.status(201).json({
				success: true,
				governing_session_id: event.interview_session_id,
				accepted: req.body.accepted,
				receipt_id: receipt.id,
			});
		} catch (err) {
			console.error('[interview-events] Biometric consent capture error:', err.message);
			res.status(400).json({ error: err.message });
		}
	},
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/interviews/:id — Get interview event details
// ─────────────────────────────────────────────────────────────────────────────

router.get(
	'/:id',
	authMiddleware,
	// #1220: a non-numeric single segment is not an interview-event id at
	// all — it is a literal route owned by a router mounted after this one
	// (e.g. GET /history in routes/interviews.js). The isInt validator below
	// 400s without calling next(), so without this fall-through those routes
	// are unreachable. Numeric segments (incl. '0', which isInt{min:1} then
	// rejects as today) stay on the validator path unchanged.
	(req, _res, next) => (/^\d+$/.test(req.params.id) ? next() : next('router')),
	[param('id').isInt({ min: 1 }).withMessage('Valid interview ID required')],
	handleValidationErrors,
	async (req, res, next) => {
		try {
			const eventId = parseInt(req.params.id, 10);
			const user = req.user;

			const result = await pool.query(
				`SELECT
					ie.*,
					u.name as candidate_name,
					u.email as candidate_email,
					r.name as recruiter_name,
					r.email as recruiter_email,
					j.title as job_title
				 FROM interview_events ie
				 LEFT JOIN users u ON ie.candidate_id = u.id
				 LEFT JOIN users r ON ie.recruiter_id = r.id
				 LEFT JOIN job_applications ja ON ie.job_application_id = ja.id
				 LEFT JOIN jobs j ON ja.job_id = j.id
				 WHERE ie.id = $1`,
				[eventId],
			);

			if (result.rows.length === 0) {
				// Not found in interview_events — fall through to mock interview handler
				return next();
			}

			const event = result.rows[0];

			// Authorization: recruiter sees their own company's events, candidate sees own
			const canAccess =
				event.candidate_id === user.id ||
				event.recruiter_id === user.id ||
				(event.panel_member_ids || []).includes(user.id) ||
				(isRecruiter(user.role) && event.recruiter_id === user.id);

			if (!canAccess) {
				return res.status(403).json({ error: 'Not authorized to view this interview' });
			}

			// Fetch proposed slots
			const slotsRes = await pool.query(
				`SELECT * FROM proposed_slots WHERE interview_event_id = $1 ORDER BY slot_start`,
				[eventId],
			);

			res.json({
				success: true,
				interview: {
					...event,
					scheduled_at_local: event.scheduled_at
						? toLocalIso(event.scheduled_at, event.timezone)
						: null,
					proposed_slots: slotsRes.rows.map((s) => ({
						...s,
						slot_start_local: toLocalIso(s.slot_start, s.timezone),
						slot_end_local: toLocalIso(s.slot_end, s.timezone),
					})),
				},
			});
		} catch (err) {
			console.error('[interview-events] Get error:', err.message);
			res.status(500).json({ error: 'Failed to fetch interview event' });
		}
	},
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interviews/:id/book — Candidate selects a slot and confirms
// ─────────────────────────────────────────────────────────────────────────────

router.post(
	'/:id/book',
	authMiddleware,
	[
		param('id').isInt({ min: 1 }).withMessage('Valid interview ID required'),
		body('slot_id').isInt({ min: 1 }).withMessage('Valid slot_id required'),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const eventId = parseInt(req.params.id, 10);
			const { slot_id } = req.body;
			const user = req.user;

			// Fetch event
			const eventRes = await pool.query('SELECT * FROM interview_events WHERE id = $1', [eventId]);
			if (eventRes.rows.length === 0) {
				return res.status(404).json({ error: 'Interview event not found' });
			}
			const event = eventRes.rows[0];

			// Only the candidate can book their own interview
			if (event.candidate_id !== user.id) {
				return res.status(403).json({ error: 'Only the candidate can book this interview' });
			}

			if (event.status !== 'proposed') {
				return res.status(400).json({ error: `Interview is already ${event.status}` });
			}

			// Fetch the slot
			const slotRes = await pool.query(
				`SELECT * FROM proposed_slots WHERE id = $1 AND interview_event_id = $2 AND status = 'offered'`,
				[slot_id, eventId],
			);
			if (slotRes.rows.length === 0) {
				return res.status(400).json({ error: 'Slot not found or no longer available' });
			}
			const slot = slotRes.rows[0];

			// Mark slot as accepted, others as expired
			await pool.query('BEGIN');
			try {
				await pool.query(
					`UPDATE proposed_slots SET status = 'accepted', candidate_response_at = NOW() WHERE id = $1`,
					[slot_id],
				);
				await pool.query(
					`UPDATE proposed_slots SET status = 'expired' WHERE interview_event_id = $1 AND id != $2`,
					[eventId, slot_id],
				);

				// Confirm the interview event
				await pool.query(
					`UPDATE interview_events
					 SET scheduled_at = $1, status = 'confirmed', updated_at = NOW()
					 WHERE id = $2`,
					[slot.slot_start, eventId],
				);

				await pool.query('COMMIT');
			} catch (txErr) {
				await pool.query('ROLLBACK');
				throw txErr;
			}

			// Re-fetch the updated event
			const updatedEventRes = await pool.query('SELECT * FROM interview_events WHERE id = $1', [
				eventId,
			]);
			const updatedEvent = updatedEventRes.rows[0];

			// Create calendar events on all attendees' calendars
			let calendarEventIds = {};
			try {
				calendarEventIds = await calendarService.createMultiAttendeeEvents(updatedEvent);
				if (Object.keys(calendarEventIds).length > 0) {
					await pool.query(`UPDATE interview_events SET calendar_event_ids = $1 WHERE id = $2`, [
						JSON.stringify(calendarEventIds),
						eventId,
					]);
				}
			} catch (calErr) {
				console.error('[interview-events] Calendar sync failed (non-blocking):', calErr.message);
			}

			// Issue #124: Auto-create LiveKit room when interview is confirmed
			try {
				await livekitService.autoCreateRoomForInterview(eventId);
			} catch (lkErr) {
				console.error(
					'[interview-events] LiveKit room auto-create failed (non-blocking):',
					lkErr.message,
				);
			}

			res.json({
				success: true,
				message: 'Interview confirmed',
				interview: {
					...updatedEvent,
					calendar_event_ids: calendarEventIds,
					scheduled_at_local: toLocalIso(updatedEvent.scheduled_at, updatedEvent.timezone),
				},
			});
		} catch (err) {
			console.error('[interview-events] Book error:', err.message, err.stack);
			res.status(500).json({ error: 'Failed to book interview' });
		}
	},
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interviews/:id/reschedule — Reschedule to a new slot
// ─────────────────────────────────────────────────────────────────────────────

router.post(
	'/:id/reschedule',
	authMiddleware,
	[
		param('id').isInt({ min: 1 }).withMessage('Valid interview ID required'),
		body('slot_id').optional().isInt({ min: 1 }).withMessage('Valid slot_id required'),
		body('new_scheduled_at').optional().isISO8601().withMessage('Valid ISO8601 datetime required'),
		body('reason').optional().trim().isLength({ max: 500 }).withMessage('Reason too long'),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const eventId = parseInt(req.params.id, 10);
			const { slot_id, new_scheduled_at, reason } = req.body;
			const user = req.user;

			const eventRes = await pool.query('SELECT * FROM interview_events WHERE id = $1', [eventId]);
			if (eventRes.rows.length === 0) {
				return res.status(404).json({ error: 'Interview event not found' });
			}
			const event = eventRes.rows[0];

			// Authorization: recruiter can reschedule any time; candidate can only reschedule their own
			const isRec = isRecruiter(user.role);
			if (!isRec && event.candidate_id !== user.id) {
				return res.status(403).json({ error: 'Not authorized to reschedule this interview' });
			}

			if (event.status === 'cancelled') {
				return res.status(400).json({ error: 'Cannot reschedule a cancelled interview' });
			}

			let newScheduledAt;
			if (slot_id) {
				// Use an existing proposed slot
				const slotRes = await pool.query(
					`SELECT * FROM proposed_slots WHERE id = $1 AND interview_event_id = $2`,
					[slot_id, eventId],
				);
				if (slotRes.rows.length === 0) {
					return res.status(400).json({ error: 'Slot not found' });
				}
				newScheduledAt = slotRes.rows[0].slot_start;
				await pool.query(
					`UPDATE proposed_slots SET status = 'accepted', candidate_response_at = NOW() WHERE id = $1`,
					[slot_id],
				);
			} else if (new_scheduled_at) {
				// Direct reschedule to a new time (recruiter-only or with candidate consent)
				newScheduledAt = new Date(new_scheduled_at);
				// Add a new proposed slot record for audit
				await pool.query(
					`INSERT INTO proposed_slots (interview_event_id, proposed_by, slot_start, slot_end, timezone, status)
					 VALUES ($1, $2, $3, $4, $5, 'accepted')`,
					[
						eventId,
						user.id,
						newScheduledAt,
						new Date(newScheduledAt.getTime() + event.duration_minutes * 60000),
						event.timezone,
					],
				);
			} else {
				return res.status(400).json({ error: 'Either slot_id or new_scheduled_at is required' });
			}

			// Update the interview event
			await pool.query(
				`UPDATE interview_events
				 SET scheduled_at = $1, status = 'rescheduled', updated_at = NOW()
				 WHERE id = $2`,
				[newScheduledAt, eventId],
			);

			// Re-fetch updated event
			const updatedRes = await pool.query('SELECT * FROM interview_events WHERE id = $1', [
				eventId,
			]);
			const updatedEvent = updatedRes.rows[0];

			// Update calendar events across all attendees
			let calendarEventIds = event.calendar_event_ids || {};
			try {
				calendarEventIds = await calendarService.updateMultiAttendeeEvents(updatedEvent);
				await pool.query(`UPDATE interview_events SET calendar_event_ids = $1 WHERE id = $2`, [
					JSON.stringify(calendarEventIds),
					eventId,
				]);
			} catch (calErr) {
				console.error('[interview-events] Calendar update failed (non-blocking):', calErr.message);
			}

			res.json({
				success: true,
				message: 'Interview rescheduled',
				reason: reason || null,
				interview: {
					...updatedEvent,
					calendar_event_ids: calendarEventIds,
					scheduled_at_local: toLocalIso(updatedEvent.scheduled_at, updatedEvent.timezone),
				},
			});
		} catch (err) {
			console.error('[interview-events] Reschedule error:', err.message, err.stack);
			res.status(500).json({ error: 'Failed to reschedule interview' });
		}
	},
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interviews/:id/cancel — Cancel interview and delete calendar events
// ─────────────────────────────────────────────────────────────────────────────

router.post(
	'/:id/cancel',
	authMiddleware,
	[
		param('id').isInt({ min: 1 }).withMessage('Valid interview ID required'),
		body('reason').optional().trim().isLength({ max: 500 }).withMessage('Reason too long'),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const eventId = parseInt(req.params.id, 10);
			const { reason } = req.body;
			const user = req.user;

			const eventRes = await pool.query('SELECT * FROM interview_events WHERE id = $1', [eventId]);
			if (eventRes.rows.length === 0) {
				return res.status(404).json({ error: 'Interview event not found' });
			}
			const event = eventRes.rows[0];

			// Authorization: recruiter or candidate can cancel
			const canCancel =
				(isRecruiter(user.role) && event.recruiter_id === user.id) ||
				event.candidate_id === user.id;

			if (!canCancel) {
				return res.status(403).json({ error: 'Not authorized to cancel this interview' });
			}

			if (event.status === 'cancelled') {
				return res.status(400).json({ error: 'Interview is already cancelled' });
			}

			// Delete calendar events from all connected calendars
			try {
				if (event.calendar_event_ids && Object.keys(event.calendar_event_ids).length > 0) {
					await calendarService.deleteMultiAttendeeEvents(event);
				}
			} catch (calErr) {
				console.error('[interview-events] Calendar delete failed (non-blocking):', calErr.message);
			}

			// Update status
			await pool.query(
				`UPDATE interview_events
				 SET status = 'cancelled', calendar_event_ids = NULL, updated_at = NOW()
				 WHERE id = $1`,
				[eventId],
			);

			// Expire all proposed slots
			await pool.query(
				`UPDATE proposed_slots SET status = 'expired' WHERE interview_event_id = $1`,
				[eventId],
			);

			res.json({
				success: true,
				message: 'Interview cancelled',
				reason: reason || null,
			});
		} catch (err) {
			console.error('[interview-events] Cancel error:', err.message, err.stack);
			res.status(500).json({ error: 'Failed to cancel interview' });
		}
	},
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interviews/:id/slots — Add new proposed slots (recruiter only)
// ─────────────────────────────────────────────────────────────────────────────

router.post(
	'/:id/slots',
	authMiddleware,
	requireRole('recruiter', 'hiring_manager', 'employer', 'admin'),
	[
		param('id').isInt({ min: 1 }).withMessage('Valid interview ID required'),
		body('slots').isArray({ min: 1, max: 10 }).withMessage('1-10 slots required'),
		body('slots.*.slot_start').isISO8601().withMessage('Valid ISO8601 start required'),
		body('slots.*.slot_end').isISO8601().withMessage('Valid ISO8601 end required'),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const eventId = parseInt(req.params.id, 10);
			const { slots } = req.body;
			const user = req.user;

			const eventRes = await pool.query('SELECT * FROM interview_events WHERE id = $1', [eventId]);
			if (eventRes.rows.length === 0) {
				return res.status(404).json({ error: 'Interview event not found' });
			}
			const event = eventRes.rows[0];

			if (event.recruiter_id !== user.id && user.role !== 'admin') {
				return res.status(403).json({ error: 'Not authorized' });
			}

			if (event.status === 'cancelled') {
				return res.status(400).json({ error: 'Cannot add slots to a cancelled interview' });
			}

			const inserted = [];
			for (const s of slots) {
				const r = await pool.query(
					`INSERT INTO proposed_slots (interview_event_id, proposed_by, slot_start, slot_end, timezone, status)
					 VALUES ($1, $2, $3, $4, $5, 'offered')
					 RETURNING *`,
					[eventId, user.id, new Date(s.slot_start), new Date(s.slot_end), event.timezone],
				);
				inserted.push(r.rows[0]);
			}

			// If the interview was already confirmed, revert to proposed status
			if (event.status === 'confirmed' || event.status === 'rescheduled') {
				await pool.query(
					`UPDATE interview_events SET status = 'proposed', scheduled_at = NULL, updated_at = NOW() WHERE id = $1`,
					[eventId],
				);
			}

			res.json({
				success: true,
				slots: inserted.map((s) => ({
					...s,
					slot_start_local: toLocalIso(s.slot_start, s.timezone),
					slot_end_local: toLocalIso(s.slot_end, s.timezone),
				})),
			});
		} catch (err) {
			console.error('[interview-events] Add slots error:', err.message);
			res.status(500).json({ error: 'Failed to add proposed slots' });
		}
	},
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interviews/events/:eventId/labelling-consent — S-D18 (#1955)
// BR-7 own-agreement capture (design §5.2 as amended by STOP 1 on #1955):
// room-bound + authenticated, caller's own decision only, append-only
// INSERT, 404 before any validation detail, foreign user_id rejected +
// audited, insert + audit + notification in ONE transaction.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/events/:eventId/labelling-consent', authMiddleware, async (req, res) => {
	const notFound = () => res.status(404).json({ error: 'Not found' });
	const auditDenied = async (outcome, decision) => {
		try {
			// #1961 item 3: denied-path auditing runs BEFORE the capture
			// rate-limit check below, so without a cap an authenticated
			// user could grow compliance_audit_trail unboundedly with
			// 404/403 spam (the rate_limited outcome itself is audited
			// through here too). Cheap cap on the AUDIT WRITE ONLY
			// (existing limiter infra; the denial response — status,
			// body, shape — is unchanged): the first 20 denied attempts
			// per user PER OUTCOME per minute are audited, further ones
			// are answered but not written. Per-outcome keying (security
			// review, #1961) keeps a not_found flood from masking the
			// high-value foreign_user_id_rejected signal; outcomes are a
			// fixed set of 7, so growth stays bounded (≤140/min/user).
			// checkLimit fails open on DB error — deliberately inherited:
			// if the limiter's store is down, auditing continues (audit
			// preservation beats the cap; the cap is anti-abuse only).
			const cap = await distributedRateLimiter.checkLimit(
				`panel-labelling-denied-audit:${req.user.id}:${outcome}`,
				60 * 1000,
				20,
			);
			if (!cap.allowed) {
				// Response-silent, NOT observability-silent (security review).
				console.warn(
					`[interview-events] labelling-consent denied-audit cap reached for user ${req.user.id} outcome ${outcome} — audit write skipped`,
				);
				return;
			}
			await panelLabelling.writePanelAudit(pool, {
				eventId: parseInt(req.params.eventId, 10) || 0,
				actorId: req.user.id,
				actorRole: req.user.role,
				outcome,
				decision: decision ?? null,
			});
		} catch (auditErr) {
			console.error('[interview-events] labelling-consent audit failed:', auditErr.message);
		}
	};
	try {
		const eventId = parseInt(req.params.eventId, 10);
		const user = req.user;
		const body = req.body || {};
		const roomId = Number(body.room_id);

		// 404 ordering before all validation detail (security condition):
		// nonexistent event, no room access, wrong-event room, and inactive
		// room are indistinguishable. No admin bypass.
		if (!Number.isInteger(eventId) || eventId < 1 || !Number.isInteger(roomId) || roomId < 1) {
			await auditDenied('not_found', body.decision);
			return notFound();
		}
		const room = await livekitService.findRoomById(roomId);
		if (!room || room.status !== 'active') {
			await auditDenied('not_found', body.decision);
			return notFound();
		}
		const access = await livekitService.validateRoomAccess(roomId, user.id);
		if (!access.isParticipant || !access.event || Number(access.event.id) !== eventId) {
			await auditDenied('not_found', body.decision);
			return notFound();
		}
		// The candidate is a known participant in the wrong flow (privacy C-6).
		if (access.role === 'candidate') {
			await auditDenied('candidate_forbidden', body.decision);
			return res.status(403).json({ error: 'Candidates use the biometric consent flow' });
		}
		if (access.role !== 'recruiter' && access.role !== 'panel') {
			await auditDenied('not_found', body.decision);
			return notFound();
		}

		// Per-(user,event) rate limit, stricter than the generic preset;
		// uniform 429 (STOP 1 — existing checkLimit, no new infrastructure).
		const rl = await distributedRateLimiter.checkLimit(
			`panel-labelling:${user.id}:${eventId}`,
			60 * 1000,
			10,
		);
		if (!rl.allowed) {
			await auditDenied('rate_limited', body.decision);
			return res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMITED' });
		}

		// Foreign user_id: rejected and audit-logged (security BLOCK-2) —
		// never ignored, never recorded for someone else.
		if (body.user_id != null && Number(body.user_id) !== Number(user.id)) {
			await auditDenied('foreign_user_id_rejected', body.decision);
			return res.status(400).json({ error: 'user_id must be the caller' });
		}

		const decision = body.decision;
		if (!['granted', 'declined', 'withdrawn'].includes(decision)) {
			await auditDenied('invalid_decision', decision);
			return res.status(400).json({ error: 'Invalid decision' });
		}

		// A first-ever withdrawn is rejected: there is nothing to withdraw.
		const prior = await panelLabelling.getOwnDecision(pool, eventId, user.id);
		if (decision === 'withdrawn' && prior == null) {
			await auditDenied('first_withdrawn_rejected', decision);
			return res.status(400).json({ error: 'No prior decision to withdraw' });
		}

		// Roster pinning (S-1): the decision is recorded only against the
		// roster + notice version the caller was actually shown.
		const noticeVersion = panelLabelling.currentNoticeVersion();
		const expectedRoster = panelLabelling.rosterVersion(access.event, noticeVersion);
		if (body.roster_version !== expectedRoster) {
			await auditDenied('roster_changed', decision);
			return res.status(409).json({ error: 'Roster changed', code: 'ROSTER_CHANGED' });
		}

		// Attestation name from the server record (C-6c).
		const me = await pool.query('SELECT name FROM users WHERE id = $1', [user.id]);
		const attestingAs = me.rows[0]?.name || user.name || user.email;

		const ipAddress = req.ip || null; // req.ip only (STOP 1) — never a raw forwarded header
		const uaHash = panelLabelling.hashUserAgent(req.headers['user-agent']);
		// Device flag (C-6d): another account decided from this device
		// fingerprint recently — a review signal, not a block.
		let deviceFlag = false;
		if (ipAddress && uaHash) {
			const others = await pool.query(
				`SELECT COUNT(DISTINCT user_id)::int AS n FROM event_labelling_consent
				 WHERE ip_address = $1 AND user_agent_hash = $2 AND user_id <> $3
				   AND decided_at > NOW() - INTERVAL '10 minutes'`,
				[ipAddress, uaHash, user.id],
			);
			deviceFlag = others.rows[0].n > 0;
		}

		// ONE transaction: insert + audit + notification (STOP 1).
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			// S-D19 (#1956, §7 P5 / security C-5c): the per-event advisory
			// lock is taken on BOTH sides of the race — here on the
			// decision write, and in the worker's snapshot-and-claim
			// transaction — so a decision flip cannot land between the
			// worker's panel check and the persisting of its snapshot.
			await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
				`panel-event:${eventId}`,
			]);
			// Plain INSERT only, append-only; decided_at/created_at omitted
			// so the DB defaults stamp them (never a client/token clock).
			const ins = await client.query(
				`INSERT INTO event_labelling_consent
				 (interview_event_id, user_id, decision, notice_version, ip_address, user_agent_hash)
				 VALUES ($1, $2, $3, $4, $5, $6)
				 RETURNING id, decision, notice_version, decided_at`,
				[eventId, user.id, decision, noticeVersion, ipAddress, uaHash],
			);
			await panelLabelling.writePanelAudit(client, {
				eventId,
				actorId: user.id,
				actorRole: user.role,
				outcome: 'recorded',
				decision,
				deviceFlag,
			});
			await client.query(
				`INSERT INTO user_notifications (user_id, type, title, message, metadata)
				 VALUES ($1, 'labelling_decision', $2, $3, $4)`,
				[
					user.id,
					'Speaker labelling decision recorded',
					`You recorded "${decision}" for speaker labelling on interview ${eventId}. You can change it from the interview room.`,
					JSON.stringify({ event_id: eventId, decision }),
				],
			);
			await client.query('COMMIT');
			// S-D19 (#1956, §7.1, privacy C-1): a decline/withdrawal that
			// lands AFTER labels were written purges them — the gate
			// cannot cover processing that already happened. Runs after
			// COMMIT (the decision is durable first); a purge failure is
			// never reported as a capture failure — the decision itself
			// WAS recorded. The purge itself is transactional per
			// recording and throws a structured error (#1966 M-1:
			// failed recording ids + committed count) — logged here
			// with those ids so the incomplete purge is identifiable
			// and retryable (a re-call purges exactly the remainder).
			if (decision === 'declined' || decision === 'withdrawn') {
				try {
					const { purgeCompletedDiarizationForEvent } = require('../lib/panelWithdrawalPurge');
					await purgeCompletedDiarizationForEvent(eventId, pool);
				} catch (purgeErr) {
					console.error(
						'[interview-events] post-decision diarization purge incomplete:',
						purgeErr.message,
						JSON.stringify(purgeErr.failures || []),
					);
				}
			}
			// Allowlist-serialized response: caller's own state only — no
			// IP/UA, no other participant, no panel_expected_hash, ever.
			return res.json({
				success: true,
				event_id: eventId,
				decision: ins.rows[0].decision,
				notice_version: ins.rows[0].notice_version,
				own_decision: ins.rows[0].decision,
				decision_scope: 'panel_leg_only',
				attesting_as: attestingAs,
			});
		} catch (txnErr) {
			await client.query('ROLLBACK').catch(() => {});
			throw txnErr;
		} finally {
			client.release();
		}
	} catch (err) {
		console.error('[interview-events] labelling-consent error:', err.message);
		return res.status(500).json({ error: 'Failed to record labelling consent' });
	}
});

module.exports = router;
