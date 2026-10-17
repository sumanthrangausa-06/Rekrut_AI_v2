/**
 * Interview sessions v2 — Unified session creation (S-001 #640).
 *
 * NEW endpoint (does NOT touch routes/interview-sessions.js):
 *   POST /sessions  →  mounted at /api/interviews → POST /api/interviews/sessions
 *
 * AC-1: POST with type ai-interview → 201, session with status invited
 * AC-2: Invalid config → 400 VALIDATION_ERROR with field-level errors
 * AC-3: Unknown type → 400 INVALID_SESSION_TYPE
 *
 * NOTE (architecture discrepancy): architecture.md specifies
 * POST /api/v1/interview-sessions, but the ACs specify POST /api/interviews/sessions.
 * Per STOP 1 decision: ACs override architecture on the URL path.
 * Flagged for architecture review.
 */
const express = require('express');
const { authMiddleware } = require('../../lib/auth');
const SessionService = require('../../lib/sessionService');

const router = express.Router();

router.post('/sessions', authMiddleware, async (req, res) => {
	try {
		const { type, job_id, application_id, candidate_id, company_id, config } = req.body || {};

		const session = await SessionService.create({
			type,
			triggeredBy: req.user.id,
			callerRole: req.user.role,
			companyId: company_id || req.user.company_id || null,
			jobId: job_id,
			applicationId: application_id,
			candidateId: candidate_id,
			config,
		});

		res.status(201).json({ success: true, session });
	} catch (err) {
		if (err.code === 'INVALID_SESSION_TYPE') {
			return res.status(400).json({ code: 'INVALID_SESSION_TYPE', error: err.message });
		}
		if (err.code === 'VALIDATION_ERROR') {
			return res.status(400).json({
				code: 'VALIDATION_ERROR',
				error: err.message,
				errors: err.errors || [],
			});
		}
		if (err.code === 'FORBIDDEN') {
			return res.status(403).json({ code: 'FORBIDDEN', error: err.message });
		}
		console.error('[interview-sessions-v2] create error:', err.message);
		res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Failed to create interview session' });
	}
});

module.exports = router;
