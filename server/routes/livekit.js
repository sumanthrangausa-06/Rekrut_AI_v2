// =============================================================================
// LiveKit Routes — REST API for video room management (Issue #124)
// =============================================================================
//
// Endpoints:
//   POST   /api/livekit/rooms              — create a room for an interview
//   POST   /api/livekit/rooms/:id/token    — get a join token
//   DELETE /api/livekit/rooms/:id          — close a room
//   POST   /api/livekit/session-rooms              — create-or-get a room for an interview session (#323)
//   POST   /api/livekit/session-rooms/:sessionId/token — get a join token for a session room (#323)
//   POST   /api/livekit/session-rooms/:sessionId/dispatch — dispatch the voice agent to a session room (#323)
//
// Auth: authMiddleware + role checks
// Rate limiting: distributed rate limiter (strict for token endpoints)
// =============================================================================

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { authMiddleware } = require('../../lib/auth');
const { requirePermission } = require('../../middleware/rbac');
const { rateLimits } = require('../../lib/distributed-rate-limiter');
const livekitService = require('../services/livekit');

const router = express.Router();

function handleValidationErrors(req, res, next) {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({
			error: 'Validation failed',
			details: errors.array().map((e) => ({
				// @ts-expect-error express-validator type mismatch across versions
				field: e.path || e.param || 'unknown',
				message: e.msg,
			})),
		});
	}
	next();
}

// ─── POST /api/livekit/rooms — Create a room for an interview ───────────────

router.post(
	'/rooms',
	authMiddleware,
	requirePermission('interviews:schedule'),
	rateLimits.standard,
	[body('interview_event_id').isInt({ min: 1 }).withMessage('Valid interview_event_id required')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const { interview_event_id: interviewEventId } = req.body;
			const user = req.user;

			// Verify the interview event exists and user is the recruiter
			const pool = require('../../lib/db');
			const eventRes = await pool.query(`SELECT * FROM interview_events WHERE id = $1`, [
				interviewEventId,
			]);
			if (eventRes.rows.length === 0) {
				return res.status(404).json({ error: 'Interview event not found' });
			}
			const event = eventRes.rows[0];

			if (user.role !== 'admin' && event.recruiter_id !== user.id) {
				return res
					.status(403)
					.json({ error: 'Not authorized to create a room for this interview' });
			}

			// Idempotent: return existing room if active
			const existing = await livekitService.findActiveRoomByInterviewEventId(interviewEventId);
			if (existing) {
				return res.json({
					success: true,
					room: existing,
					message: 'Room already exists',
				});
			}

			const roomName = `rekrut-${interviewEventId}-${Date.now()}`;
			const livekitRoom = await livekitService.createRoom(roomName, {
				emptyTimeout: 600,
				maxParticipants: 10,
			});

			const record = await livekitService.createRoomRecord({
				interviewEventId,
				roomName: livekitRoom.name,
				livekitRoomId: livekitRoom.sid,
			});

			// Update interview_events with room URL
			const livekitUrl = `${process.env.LIVEKIT_URL.replace(/\/$/, '')}/${roomName}`;
			await pool.query(
				`UPDATE interview_events SET livekit_room_url = $1, updated_at = NOW() WHERE id = $2`,
				[livekitUrl, interviewEventId],
			);

			res.status(201).json({
				success: true,
				room: record,
				joinUrl: livekitUrl,
			});
		} catch (err) {
			console.error('[livekit-routes] Create room error:', err.message);
			if (err.message.includes('not configured')) {
				return res.status(503).json({ error: 'LiveKit not configured' });
			}
			res.status(500).json({ error: 'Failed to create room' });
		}
	},
);

// ─── POST /api/livekit/rooms/:id/token — Get a join token ───────────────────

router.post(
	'/rooms/:id/token',
	authMiddleware,
	rateLimits.strict, // strict rate limit for token generation
	[
		param('id').isInt({ min: 1 }).withMessage('Valid room ID required'),
		body('name').optional().isString().trim().isLength({ max: 255 }).withMessage('Name too long'),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const roomId = parseInt(req.params.id, 10);
			const user = req.user;
			const displayName = req.body.name || user.name || user.email || `User-${user.id}`;

			// Validate room access
			const access = await livekitService.validateRoomAccess(roomId, user.id);
			if (!access.isParticipant) {
				return res.status(403).json({ error: 'Not authorized to join this room' });
			}

			const room = await livekitService.findRoomById(roomId);
			if (room?.status !== 'active') {
				return res.status(404).json({ error: 'Room not found or closed' });
			}

			const token = await livekitService.generateToken({
				identity: String(user.id),
				name: displayName,
				roomName: room.room_name,
				ttlMs: 60 * 60 * 1000, // 1 hour
			});

			res.json({
				success: true,
				token,
				roomName: room.room_name,
				livekitUrl: process.env.LIVEKIT_URL,
				expiresIn: 3600,
			});
		} catch (err) {
			console.error('[livekit-routes] Token error:', err.message);
			if (err.message.includes('not configured')) {
				return res.status(503).json({ error: 'LiveKit not configured' });
			}
			res.status(500).json({ error: 'Failed to generate token' });
		}
	},
);

// ─── DELETE /api/livekit/rooms/:id — Close a room ───────────────────────────

router.delete(
	'/rooms/:id',
	authMiddleware,
	requirePermission('interviews:schedule'),
	rateLimits.standard,
	[param('id').isInt({ min: 1 }).withMessage('Valid room ID required')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const roomId = parseInt(req.params.id, 10);
			const user = req.user;

			const room = await livekitService.findRoomById(roomId);
			if (!room) {
				return res.status(404).json({ error: 'Room not found' });
			}

			// Verify user owns the interview
			const pool = require('../../lib/db');
			const eventRes = await pool.query(`SELECT * FROM interview_events WHERE id = $1`, [
				room.interview_event_id,
			]);
			if (eventRes.rows.length === 0) {
				return res.status(404).json({ error: 'Associated interview event not found' });
			}
			const event = eventRes.rows[0];

			if (user.role !== 'admin' && event.recruiter_id !== user.id) {
				return res.status(403).json({ error: 'Not authorized to close this room' });
			}

			if (room.status === 'closed') {
				return res.json({ success: true, message: 'Room already closed' });
			}

			// Delete from LiveKit server
			await livekitService.deleteRoom(room.room_name);

			// Update local record
			await livekitService.closeRoomRecord(roomId);

			// Clear room URL from interview_events
			await pool.query(
				`UPDATE interview_events SET livekit_room_url = NULL, updated_at = NOW() WHERE id = $1`,
				[room.interview_event_id],
			);

			res.json({ success: true, message: 'Room closed' });
		} catch (err) {
			console.error('[livekit-routes] Close room error:', err.message);
			if (err.message.includes('not configured')) {
				return res.status(503).json({ error: 'LiveKit not configured' });
			}
			res.status(500).json({ error: 'Failed to close room' });
		}
	},
);

// ─── Session-linked rooms (Issue #323) ───────────────────────────────────────
// Phase 2 keys LiveKit rooms to the unified interview_sessions model. Access
// mirrors Phase 1's canAccess (routes/interview-sessions.js): the session's
// candidate, the session company's hiring team, or admin. Fail-closed — a
// missing company_id never matches.

const HIRING_ROLES = ['recruiter', 'hiring_manager'];

function canAccessSession(session, user) {
	if (!user) return false;
	if (Number(user.id) === Number(session.candidate_id)) return true;
	return isHiringTeamForSession(session, user);
}

function isHiringTeamForSession(session, user) {
	if (!user) return false;
	if (user.role === 'admin') return true;
	return (
		HIRING_ROLES.includes(user.role) &&
		user.company_id != null &&
		Number(user.company_id) === Number(session.company_id)
	);
}

async function loadSessionOr404(sessionId, res) {
	const pool = require('../../lib/db');
	const sessionRes = await pool.query(`SELECT * FROM interview_sessions WHERE id = $1`, [
		sessionId,
	]);
	if (sessionRes.rows.length === 0) {
		res.status(404).json({ error: 'Interview session not found' });
		return null;
	}
	return sessionRes.rows[0];
}

// ─── POST /api/livekit/session-rooms — Create-or-get a room for a session ───

router.post(
	'/session-rooms',
	authMiddleware,
	rateLimits.standard,
	[body('session_id').isInt({ min: 1 }).withMessage('Valid session_id required')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const sessionId = parseInt(req.body.session_id, 10);
			const session = await loadSessionOr404(sessionId, res);
			if (!session) return;

			if (!canAccessSession(session, req.user)) {
				return res.status(403).json({ error: 'Not authorized for this interview session' });
			}

			const room = await livekitService.findOrCreateSessionRoom(sessionId);
			res.json({ success: true, room });
		} catch (err) {
			console.error('[livekit-routes] Session room error:', err.message);
			if (err.message.includes('not configured')) {
				return res.status(503).json({ error: 'LiveKit not configured' });
			}
			res.status(500).json({ error: 'Failed to create session room' });
		}
	},
);

// ─── POST /api/livekit/session-rooms/:sessionId/token — Join token ───────────

router.post(
	'/session-rooms/:sessionId/token',
	authMiddleware,
	rateLimits.strict, // strict rate limit for token generation
	[
		param('sessionId').isInt({ min: 1 }).withMessage('Valid session ID required'),
		body('name').optional().isString().trim().isLength({ max: 255 }).withMessage('Name too long'),
		body('mode').optional().isIn(['participant', 'observer']).withMessage('Invalid mode'),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const sessionId = parseInt(req.params.sessionId, 10);
			const user = req.user;
			const mode = req.body.mode || 'participant';

			const session = await loadSessionOr404(sessionId, res);
			if (!session) return;

			if (!canAccessSession(session, user)) {
				return res.status(403).json({ error: 'Not authorized for this interview session' });
			}

			const isObserver = mode === 'observer';
			if (isObserver && !isHiringTeamForSession(session, user)) {
				// Observer mode is subscribe-only: only the hiring team may use it.
				// The candidate must always be able to publish (speak).
				return res
					.status(403)
					.json({ error: 'Observer mode is only available to the hiring team' });
			}

			const room = await livekitService.findOrCreateSessionRoom(sessionId);
			const token = await livekitService.generateToken({
				identity: isObserver ? `observer-${user.id}` : `user-${user.id}`,
				name: req.body.name || user.name || user.email || `User-${user.id}`,
				roomName: room.room_name,
				grants: isObserver
					? { canPublish: false, canSubscribe: true, canPublishData: false }
					: { canPublish: true, canSubscribe: true, canPublishData: true },
			});

			res.json({ token, roomName: room.room_name, livekitUrl: process.env.LIVEKIT_URL });
		} catch (err) {
			console.error('[livekit-routes] Session token error:', err.message);
			if (err.message.includes('not configured')) {
				return res.status(503).json({ error: 'LiveKit not configured' });
			}
			res.status(500).json({ error: 'Failed to generate session token' });
		}
	},
);

// ─── POST /api/livekit/session-rooms/:sessionId/dispatch — Dispatch voice agent

router.post(
	'/session-rooms/:sessionId/dispatch',
	authMiddleware,
	rateLimits.standard,
	[
		param('sessionId').isInt({ min: 1 }).withMessage('Valid session ID required'),
		body('mode').optional().isIn(['interviewer', 'observer']).withMessage('Invalid mode'),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const sessionId = parseInt(req.params.sessionId, 10);
			const user = req.user;
			const mode = req.body.mode || 'interviewer';

			const session = await loadSessionOr404(sessionId, res);
			if (!session) return;

			// Hiring team only: the candidate never dispatches the agent.
			if (!isHiringTeamForSession(session, user)) {
				return res.status(403).json({ error: 'Only the hiring team can dispatch the voice agent' });
			}

			const result = await livekitService.dispatchVoiceAgent(sessionId, mode);
			res.json({ success: true, ...result });
		} catch (err) {
			console.error('[livekit-routes] Agent dispatch error:', err.message);
			if (err.message.includes('not configured')) {
				return res.status(503).json({ error: 'LiveKit not configured' });
			}
			res.status(502).json({ error: 'Failed to dispatch voice agent' });
		}
	},
);

// ─── GET /api/livekit/session-rooms/:sessionId/transcript — Live conversation ─
// Track A: the voice agent persists each turn to interview_sessions.conversation
// (agents/voice-interviewer/worker.mjs). The candidate's session page polls
// this endpoint while in voice mode to render live transcript lines.

router.get(
	'/session-rooms/:sessionId/transcript',
	authMiddleware,
	rateLimits.standard,
	[param('sessionId').isInt({ min: 1 }).withMessage('Valid session ID required')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const sessionId = parseInt(req.params.sessionId, 10);
			const session = await loadSessionOr404(sessionId, res);
			if (!session) return;

			if (!canAccessSession(session, req.user)) {
				return res.status(403).json({ error: 'Not authorized for this interview session' });
			}

			res.json({ success: true, conversation: session.conversation || [] });
		} catch (err) {
			console.error('[livekit-routes] Session transcript error:', err.message);
			res.status(500).json({ error: 'Failed to load session transcript' });
		}
	},
);

module.exports = router;
