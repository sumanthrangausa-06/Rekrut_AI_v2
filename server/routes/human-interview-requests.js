/**
 * Human interview request routes — S-012 (#651).
 *
 * Mounted at /api/interviews (see server.js):
 *   POST /sessions/:id/request-human-interview  (candidate auth) → AC-1
 *   POST /human-requests/:id/approve             (recruiter auth) → AC-2 approve
 *   POST /human-requests/:id/decline             (recruiter auth) → AC-2 decline
 *
 * Business logic lives in lib/humanInterviewService.js; routes map
 * coded errors to HTTP status.
 */
const express = require('express');
const { param, validationResult } = require('express-validator');
const { authMiddleware } = require('../../lib/auth');
const humanInterviewService = require('../../lib/humanInterviewService');
const { HIRING_ROLES } = require('../../lib/sessionService');

const router = express.Router();

function handleValidationErrors(req, res, next) {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({ code: 'VALIDATION_ERROR', errors: errors.array() });
	}
	return next();
}

function toHttpError(err, res) {
	switch (err.code) {
		case 'BIOMETRIC_CONSENT_NOT_DECLINED':
		case 'REQUEST_ALREADY_EXISTS':
		case 'REQUEST_ALREADY_DECIDED':
			return res.status(409).json({ code: err.code, error: err.message });
		case 'SESSION_NOT_FOUND':
		case 'REQUEST_NOT_FOUND':
			return res.status(404).json({ code: err.code, error: err.message });
		case 'FORBIDDEN':
			return res.status(403).json({ code: 'FORBIDDEN', error: err.message });
		default:
			console.error('[human-interview-requests] error:', err.message);
			return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Request failed' });
	}
}

// --- POST /sessions/:id/request-human-interview (candidate auth) — AC-1 ---
router.post(
	'/sessions/:id/request-human-interview',
	authMiddleware,
	[param('id').isInt({ min: 1 }).withMessage('session id is required')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const requestRow = await humanInterviewService.requestHumanInterview({
				sessionId: Number(req.params.id),
				candidateId: req.user.id,
			});
			res.status(201).json({ request: requestRow });
		} catch (err) {
			toHttpError(err, res);
		}
	},
);

function requireHiringRole(req, res, next) {
	const role = req.user && req.user.role;
	if (!role || !HIRING_ROLES.includes(role)) {
		return res.status(403).json({ code: 'FORBIDDEN', error: 'Hiring team only' });
	}
	return next();
}

// --- POST /human-requests/:id/approve (recruiter auth) — AC-2 ---
router.post(
	'/human-requests/:id/approve',
	authMiddleware,
	requireHiringRole,
	[param('id').isInt({ min: 1 }).withMessage('request id is required')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const requestRow = await humanInterviewService.respondToRequest({
				requestId: Number(req.params.id),
				recruiterId: req.user.id,
				recruiterRole: req.user.role,
				recruiterCompanyId: req.user.company_id,
				approved: true,
			});
			res.json({ request: requestRow });
		} catch (err) {
			toHttpError(err, res);
		}
	},
);

// --- POST /human-requests/:id/decline (recruiter auth) — AC-2 ---
router.post(
	'/human-requests/:id/decline',
	authMiddleware,
	requireHiringRole,
	[param('id').isInt({ min: 1 }).withMessage('request id is required')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const requestRow = await humanInterviewService.respondToRequest({
				requestId: Number(req.params.id),
				recruiterId: req.user.id,
				recruiterRole: req.user.role,
				recruiterCompanyId: req.user.company_id,
				approved: false,
			});
			res.json({ request: requestRow });
		} catch (err) {
			toHttpError(err, res);
		}
	},
);

module.exports = router;
