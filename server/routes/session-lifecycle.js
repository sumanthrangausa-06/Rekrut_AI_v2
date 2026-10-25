/**
 * Session lifecycle routes — S-003 (#642).
 *
 * Mounted at /api/interviews (see server.js):
 *   PATCH /sessions/:id/state     → transition (409 SESSION_STATE_CONFLICT on invalid)
 *   POST  /sessions/:id/heartbeat → refresh heartbeat
 *   GET   /sessions/:id/state     → read state (lazy pause evaluation)
 *   POST  /sessions/:id/resume    → resume paused session via invite token
 */
const express = require('express');
const { authMiddleware } = require('../../lib/auth');
const SessionService = require('../../lib/sessionService');

const router = express.Router();

function toHttpError(err, res) {
	if (err.code === 'SESSION_STATE_CONFLICT') {
		return res.status(409).json({ code: 'SESSION_STATE_CONFLICT', error: err.message });
	}
	if (err.code === 'SESSION_NOT_FOUND') {
		return res.status(404).json({ code: 'SESSION_NOT_FOUND', error: err.message });
	}
	if (err.code === 'INVALID_TOKEN') {
		return res.status(403).json({ code: 'INVALID_TOKEN', error: err.message });
	}
	if (err.code === 'FORBIDDEN') {
		return res.status(403).json({ code: 'FORBIDDEN', error: err.message });
	}
	console.error('[session-lifecycle] error:', err.message);
	return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Session operation failed' });
}

/**
 * Authorize the caller for the session before any lifecycle operation.
 * Owner (candidate/triggered_by) or hiring team with company match.
 */
async function authorize(req, res) {
	try {
		await SessionService._loadOwned(Number(req.params.id), req.user);
		return true;
	} catch (err) {
		toHttpError(err, res);
		return false;
	}
}

// PATCH /sessions/:id/state — explicit transition
router.patch('/sessions/:id/state', authMiddleware, async (req, res) => {
	try {
		if (!(await authorize(req, res))) return;
		const { to_state } = req.body || {};
		if (!to_state) {
			return res.status(400).json({ code: 'VALIDATION_ERROR', error: 'to_state is required' });
		}
		const session = await SessionService.transition(Number(req.params.id), to_state);
		return res.json({ success: true, session });
	} catch (err) {
		return toHttpError(err, res);
	}
});

// POST /sessions/:id/heartbeat — keep-alive
router.post('/sessions/:id/heartbeat', authMiddleware, async (req, res) => {
	try {
		if (!(await authorize(req, res))) return;
		const session = await SessionService.heartbeat(Number(req.params.id));
		return res.json({ success: true, session });
	} catch (err) {
		return toHttpError(err, res);
	}
});

// GET /sessions/:id/state — read with lazy pause evaluation (AC-1)
//
// ⚠️ SIDE EFFECT ON READ: if the session is in_progress with a stale
// heartbeat, this GET transitions it to paused (atomic, in SQL).
// Documented deliberately — see SessionService.getState().
router.get('/sessions/:id/state', authMiddleware, async (req, res) => {
	try {
		if (!(await authorize(req, res))) return;
		const session = await SessionService.getState(Number(req.params.id));
		return res.json({ success: true, session });
	} catch (err) {
		return toHttpError(err, res);
	}
});

// POST /sessions/:id/resume — resume via invite token (AC-2)
// The invite token is the bearer credential; ownership is proven by possession.
router.post('/sessions/:id/resume', authMiddleware, async (req, res) => {
	try {
		const { invite_token } = req.body || {};
		if (!invite_token) {
			return res.status(400).json({ code: 'VALIDATION_ERROR', error: 'invite_token is required' });
		}
		const session = await SessionService.resume(Number(req.params.id), invite_token);
		return res.json({ success: true, session });
	} catch (err) {
		return toHttpError(err, res);
	}
});

module.exports = router;
