// =============================================================================
// LiveKit Routes — REST API for video room management (Issue #124)
// =============================================================================
//
// Endpoints:
//   POST   /api/livekit/rooms              — create a room for an interview
//   POST   /api/livekit/rooms/:id/token    — get a join token
//   DELETE /api/livekit/rooms/:id          — close a room
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
				// @ts-ignore express-validator type mismatch across versions
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
	[
		body('interview_event_id').isInt({ min: 1 }).withMessage('Valid interview_event_id required'),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const { interview_event_id: interviewEventId } = req.body;
			const user = req.user;

			// Verify the interview event exists and user is the recruiter
			const pool = require('../../lib/db');
			const eventRes = await pool.query(
				`SELECT * FROM interview_events WHERE id = $1`,
				[interviewEventId],
			);
			if (eventRes.rows.length === 0) {
				return res.status(404).json({ error: 'Interview event not found' });
			}
			const event = eventRes.rows[0];

			if (user.role !== 'admin' && event.recruiter_id !== user.id) {
				return res.status(403).json({ error: 'Not authorized to create a room for this interview' });
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
			if (!room || room.status !== 'active') {
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
			const eventRes = await pool.query(
				`SELECT * FROM interview_events WHERE id = $1`,
				[room.interview_event_id],
			);
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

module.exports = router;
