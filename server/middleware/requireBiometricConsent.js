/**
 * requireBiometricConsent — Consent enforcement middleware (S-011, CR-21).
 *
 * Makes biometric collection impossible without valid consent — compliant
 * by architecture, not by convention.
 *
 * Security design (AC-6):
 *   - The middleware NEVER reads consent state from the client. Any
 *     client-supplied consent assertion (headers, body fields, query params
 *     claiming consent) is ignored entirely. The DB is the single source
 *     of truth, so a forged receipt cannot bypass the gate.
 *   - IDOR protection: the consent receipt must belong to the authenticated
 *     caller (`req.user.id`). Presenting another candidate's sessionId yields
 *     CONSENT_REQUIRED, not their consent. Requires authMiddleware upstream.
 *   - Consent state is resolved via a live DB lookup on EVERY request —
 *     never cached — so withdrawal propagates immediately (AC-5).
 *   - sessionId is validated as a positive integer before the DB call.
 *   - Fail-closed: missing/invalid sessionId → 400; unauthenticated → 403;
 *     DB error → 503. The request is blocked whenever consent cannot be
 *     positively verified.
 *
 * Usage:
 *   const { requireBiometricConsent } = require('../server/middleware/requireBiometricConsent');
 *   router.post('/interviews/:id/frames', authMiddleware, requireBiometricConsent('biometric'), handler);
 *
 * Consent-type → endpoint mapping (from architecture):
 *   signal batches    → 'biometric'
 *   transcript chunks → 'recording'
 *   ID verification   → 'id_verification'
 */
const consentService = require('../../lib/consentService');

const ERROR_MESSAGES = {
	CONSENT_REQUIRED: 'Biometric collection requires consent. Please complete the consent screens before continuing.',
	CONSENT_VERSION_STALE: 'The consent text has changed since you consented. Please review and accept the updated text.',
	CONSENT_WITHDRAWN: 'Consent was withdrawn. Biometric collection is blocked.',
	CONSENT_SESSION_REQUIRED: 'A valid interview session is required for biometric collection.',
	CONSENT_CHECK_UNAVAILABLE: 'Consent verification is temporarily unavailable. Please try again.',
};

/**
 * Build the consent-gate middleware for a consent type.
 *
 * @param {string} consentType - 'recording' | 'biometric' | 'id_verification'
 * @returns {Function} Express middleware
 */
function requireBiometricConsent(consentType) {
	return async function requireBiometricConsentMiddleware(req, res, next) {
		// ─── 1. Resolve the session — fail closed if we cannot identify it ───
		// NOTE: we deliberately read sessionId only from routing/body context,
		// never from any client-supplied consent claim.
		const rawSessionId =
			(req.body && req.body.sessionId) ||
			(req.query && req.query.sessionId) ||
			(req.params && req.params.sessionId);

		// Validate: must be a positive integer (rejects arrays, objects, garbage).
		const sessionId = typeof rawSessionId === 'string' && /^\d+$/.test(rawSessionId)
			? parseInt(rawSessionId, 10)
			: rawSessionId;
		if (!Number.isInteger(sessionId) || sessionId <= 0) {
			return res.status(400).json({
				error: ERROR_MESSAGES.CONSENT_SESSION_REQUIRED,
				code: 'CONSENT_SESSION_REQUIRED',
			});
		}

		// ─── 2. Bind to the authenticated data subject (IDOR protection) ───
		// The consent receipt must belong to the caller. Without this, any
		// authenticated user could present another candidate's sessionId and
		// inherit their consent. Fail closed if the request is unauthenticated.
		const callerId = req.user && req.user.id;
		if (callerId == null) {
			return res.status(403).json({
				error: ERROR_MESSAGES.CONSENT_REQUIRED,
				code: 'CONSENT_REQUIRED',
			});
		}

		// ─── 3. Live DB consent check — never cached (AC-5) ───
		let consentState;
		try {
			consentState = await consentService.checkConsentState(sessionId, consentType, callerId);
		} catch (err) {
			// Fail closed: if we cannot verify consent, block collection (AC-2).
			console.error('[requireBiometricConsent] consent check failed:', err.message);
			return res.status(503).json({
				error: ERROR_MESSAGES.CONSENT_CHECK_UNAVAILABLE,
				code: 'CONSENT_CHECK_UNAVAILABLE',
			});
		}

		// ─── 3. Enforce ───
		if (consentState.state === 'valid') {
			// Attach for downstream handlers (read-only; not a trust signal).
			req.consentState = consentState;
			return next();
		}

		if (consentState.state === 'withdrawn') {
			return res.status(403).json({
				error: ERROR_MESSAGES.CONSENT_WITHDRAWN,
				code: 'CONSENT_WITHDRAWN',
			});
		}

		if (consentState.state === 'stale') {
			return res.status(403).json({
				error: ERROR_MESSAGES.CONSENT_VERSION_STALE,
				code: 'CONSENT_VERSION_STALE',
				receiptVersion: consentState.receiptVersion,
				currentVersion: consentState.currentVersion,
			});
		}

		// 'missing' or any unknown state → block.
		return res.status(403).json({
			error: ERROR_MESSAGES.CONSENT_REQUIRED,
			code: 'CONSENT_REQUIRED',
		});
	};
}

module.exports = { requireBiometricConsent, ERROR_MESSAGES };
