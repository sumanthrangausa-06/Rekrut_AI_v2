/**
 * Unified human-interview endpoints (InterviewService).
 *
 * Both scheduling systems (System A: scheduled_interviews, System B:
 * interview_events + proposed_slots) behind one normalized API.
 *
 * MOUNT ORDER MATTERS: this router must be mounted BEFORE interviewEventsRoutes
 * in server.js. interviewEventsRoutes defines GET /:id with an isInt validator
 * that 400s on non-integer ids — mounted earlier, it would swallow
 * GET /my-interviews (id="my-interviews" fails isInt) and the unified
 * endpoints would never be reached.
 */
const express = require('express');
const { authMiddleware } = require('../lib/auth');
const interviewService = require('../services/interview-service');

const router = express.Router();

function interviewServiceErrorStatus(code) {
	return (
		{ NOT_FOUND: 404, FORBIDDEN: 403, INVALID_STATE: 400, VALIDATION: 400 }[code] || 500
	);
}

// GET /api/interviews/my-interviews — all human interviews for the current
// user (both systems, normalized shape), newest first.
router.get('/my-interviews', authMiddleware, async (req, res) => {
	try {
		const role = req.user.role === 'candidate' ? 'candidate' : 'recruiter';
		const interviews = await interviewService.getMyInterviews(req.user.id, role);
		res.json({ success: true, interviews });
	} catch (err) {
		console.error('Get unified interviews error:', err);
		res
			.status(interviewServiceErrorStatus(err.code))
			.json({ error: err.message || 'Failed to fetch interviews' });
	}
});

// POST /api/interviews/unified — recruiter creates an interview via System B
// (multi-slot negotiation). Body: { job_application_id?, candidate_id,
// proposed_slots: [{start, end}], duration_minutes?, timezone?, notes?,
// panel_member_ids? }
router.post('/unified', authMiddleware, async (req, res) => {
	try {
		if (req.user.role === 'candidate') {
			return res.status(403).json({ error: 'Only recruiters can create interviews' });
		}
		const body = req.body || {};
		const result = await interviewService.createInterview({
			job_application_id: body.job_application_id ?? null,
			recruiter_id: req.user.id,
			candidate_id: body.candidate_id,
			proposed_slots: body.proposed_slots,
			duration_minutes: body.duration_minutes ?? 60,
			timezone: body.timezone ?? 'UTC',
			notes: body.notes ?? null,
			panel_member_ids: body.panel_member_ids ?? [],
		});
		res.status(201).json({ success: true, event: result.event, slots: result.slots });
	} catch (err) {
		console.error('Create unified interview error:', err);
		res
			.status(interviewServiceErrorStatus(err.code))
			.json({ error: err.message || 'Failed to create interview' });
	}
});

// POST /api/interviews/unified/:id/confirm-slot — candidate books one
// proposed slot. Body: { slot_id }
router.post('/unified/:id/confirm-slot', authMiddleware, async (req, res) => {
	try {
		if (req.user.role !== 'candidate') {
			return res.status(403).json({ error: 'Only candidates can confirm a slot' });
		}
		const interview = await interviewService.confirmSlot(
			req.params.id,
			(req.body || {}).slot_id,
			req.user.id,
		);
		res.json({ success: true, interview });
	} catch (err) {
		console.error('Confirm slot error:', err);
		res
			.status(interviewServiceErrorStatus(err.code))
			.json({ error: err.message || 'Failed to confirm slot' });
	}
});

module.exports = router;
