// =============================================================================
// Consent Routes — REST API for the consent lifecycle (S-010, Issue #568)
// =============================================================================
//
// Endpoints:
//   GET    /api/consent/texts/:type              — current consent text (EN+HI)
//   POST   /api/consent/record                   — record accept/decline
//   POST   /api/consent/withdraw                 — withdraw consent (idempotent)
//   GET    /api/consent/status/:sessionId        — per-type status for a session
//   GET    /api/consent/history                  — candidate's full history (DSAR)
//
// Auth: authMiddleware (candidate). The consent screens themselves are public,
// but recording consent requires an authenticated candidate identity.
// =============================================================================

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authMiddleware } = require('../../lib/auth');
const consentService = require('../../lib/consentService');

const router = express.Router();

function handleValidationErrors(req, res, next) {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({
			error: 'Validation failed',
			details: errors.array().map((e) => ({
				field: e.path || e.param || 'unknown',
				message: e.msg,
			})),
		});
	}
	next();
}

// --- GET /api/consent/texts/:type — current consent text (public, no auth) ---
// The screens need the copy before the candidate is deep in the flow.
// Version is resolved server-side; the client never supplies it.
router.get(
	'/texts/:type',
	[param('type').isIn(consentService.VALID_TYPES).withMessage('Invalid consent type')],
	[query('locale').optional().isIn(['en', 'hi']).withMessage('Invalid locale')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const text = await consentService.getConsentText(req.params.type);
			res.json({
				consent_type: text.consent_type,
				version: text.version,
				text_en: text.text_en,
				text_hi: text.text_hi,
				effective_from: text.effective_from,
			});
		} catch (err) {
			res.status(404).json({ error: err.message });
		}
	},
);

// --- POST /api/consent/record — record accept/decline (candidate auth) ---
router.post(
	'/record',
	authMiddleware,
	[
		body('sessionId').isInt({ min: 1 }).withMessage('sessionId is required'),
		body('type').isIn(consentService.VALID_TYPES).withMessage('Invalid consent type'),
		body('accepted').isBoolean().withMessage('accepted must be a boolean'),
		body('locale').optional().isIn(['en', 'hi']).withMessage('Invalid locale'),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const receipt = await consentService.recordConsent({
				sessionId: req.body.sessionId,
				candidateId: req.user.id,
				type: req.body.type,
				accepted: req.body.accepted,
				locale: req.body.locale || 'en',
				ipAddress: req.ip,
			});
			res.status(201).json({ id: receipt.id, type: req.body.type, accepted: req.body.accepted });
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	},
);

// --- POST /api/consent/withdraw — withdraw consent (candidate auth, idempotent) ---
router.post(
	'/withdraw',
	authMiddleware,
	[
		body('sessionId').isInt({ min: 1 }).withMessage('sessionId is required'),
		body('type').isIn(consentService.VALID_TYPES).withMessage('Invalid consent type'),
		body('reason').optional().isString(),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const result = await consentService.withdrawConsent({
				sessionId: req.body.sessionId,
				candidateId: req.user.id,
				type: req.body.type,
				reason: req.body.reason,
			});
			res.json({ withdrawn: true, alreadyWithdrawn: !!result.alreadyWithdrawn });
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	},
);

// --- GET /api/consent/status/:sessionId — per-type status (candidate auth) ---
router.get(
	'/status/:sessionId',
	authMiddleware,
	[param('sessionId').isInt({ min: 1 }).withMessage('Invalid session id')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const status = await consentService.getConsentStatus(Number(req.params.sessionId));
			res.json(status);
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	},
);

// --- GET /api/consent/history — candidate's full consent history (DSAR source) ---
router.get('/history', authMiddleware, async (req, res) => {
	try {
		const history = await consentService.getConsentHistory(req.user.id);
		res.json({ history });
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

module.exports = router;
