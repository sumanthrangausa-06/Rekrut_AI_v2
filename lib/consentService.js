/**
 * consentService — Consent lifecycle (architecture §3.20 ConsentService).
 *
 * S-010 (#568): Sole owner of consent records. Owns `consent_texts` and
 * `consent_receipts` tables.
 *
 * Interface:
 *   recordConsent({sessionId, candidateId, type, accepted, locale, ipAddress})
 *   getConsentStatus(sessionId) → per-type {granted, withdrawn, version}
 *   withdrawConsent({sessionId, candidateId, type, reason}) — idempotent
 *   isConsentValid(sessionId, type) — live DB lookup, NEVER cached
 *   getCurrentTextVersion(type) — MAX(effective_from) server-side
 *   getConsentHistory(candidateId) — DSAR source
 *
 * Consent-type → endpoint mapping (for S-011 middleware):
 *   signal batches  → biometric
 *   transcript chunks → recording
 *   ID verification → id_verification
 */
const crypto = require('node:crypto');
const db = require('./db');

const VALID_TYPES = ['recording', 'biometric', 'id_verification'];
const VALID_LOCALES = ['en', 'hi'];

function assertValidType(type, fnName) {
	if (!VALID_TYPES.includes(type)) {
		throw new Error(
			`consentService.${fnName}: Invalid consent type "${type}". Must be one of: ${VALID_TYPES.join(', ')}`,
		);
	}
}

/**
 * Record a candidate's accept or decline for a consent type.
 * Accept → granted_at set. Decline → withdrawn_at set (never granted).
 * Version is resolved server-side (never from request).
 */
async function recordConsent({ sessionId, candidateId, type, accepted, locale, ipAddress }) {
	for (const [key, value] of Object.entries({ sessionId, candidateId, type })) {
		if (value == null || value === '') {
			throw new Error(`consentService.recordConsent: ${key} is required`);
		}
	}
	assertValidType(type, 'recordConsent');
	if (accepted !== true && accepted !== false) {
		throw new Error('consentService.recordConsent: accepted must be a boolean');
	}
	if (locale != null && !VALID_LOCALES.includes(locale)) {
		throw new Error(
			`consentService.recordConsent: Invalid locale "${locale}". Must be one of: ${VALID_LOCALES.join(', ')}`,
		);
	}

	const now = new Date().toISOString();
	const grantedAt = accepted ? now : null;
	const withdrawnAt = accepted ? null : now;

	// Receipt hash binds the decision to session + candidate + timestamp.
	// The exact consented text is pinned by FK to consent_texts(consent_type, version).
	const textHash = crypto
		.createHash('sha256')
		.update(`${type}:${sessionId}:${candidateId}:${grantedAt || withdrawnAt}:${accepted}`)
		.digest('hex');

	// Version resolved server-side via MAX(effective_from) — never from the request.
	const { rows } = await db.query(
		`INSERT INTO consent_receipts
       (interview_session_id, candidate_id, consent_type, consent_text_version, consent_text_hash, granted_at, withdrawn_at)
     SELECT $1, $2, $3, version, $4, $5::timestamptz, $6::timestamptz
     FROM consent_texts
     WHERE consent_type = $3
       AND effective_from = (SELECT MAX(effective_from) FROM consent_texts WHERE consent_type = $3)
     RETURNING id`,
		[sessionId, candidateId, type, textHash, grantedAt, withdrawnAt],
	);

	if (rows.length === 0) {
		throw new Error(`consentService.recordConsent: no consent text found for type "${type}"`);
	}

	// CR-05: consent grant/decline events are also logged to the biometric audit trail.
	// Best-effort — audit logging must never break consent recording.
	try {
		await db.query(
			`INSERT INTO biometric_audit_log (user_id, user_role, action, data_type, candidate_id, ip_address)
       VALUES ($1, 'candidate', 'view', $2, $3, $4)`,
			[candidateId, `consent_${type}_${accepted ? 'granted' : 'declined'}`, candidateId, ipAddress || null],
		);
	} catch {
		// Audit trail write failed; consent_receipts remains the source of truth.
	}

	return rows[0];
}

/**
 * Get per-type consent status for a session.
 * Returns { recording: {granted, withdrawn, version}, biometric: {...}, id_verification: {...} }.
 * No receipt = not granted.
 */
async function getConsentStatus(sessionId) {
	const { rows } = await db.query(
		`SELECT DISTINCT ON (consent_type)
       consent_type, granted_at, withdrawn_at, consent_text_version
     FROM consent_receipts
     WHERE interview_session_id = $1
     ORDER BY consent_type, id DESC`,
		[sessionId],
	);

	const status = {};
	for (const type of VALID_TYPES) {
		const receipt = rows.find((r) => r.consent_type === type);
		status[type] = {
			granted: !!(receipt && receipt.granted_at && !receipt.withdrawn_at),
			withdrawn: !!(receipt && receipt.withdrawn_at),
			version: receipt ? receipt.consent_text_version : null,
		};
	}
	return status;
}

/**
 * Withdraw consent. Idempotent — withdrawing twice (or withdrawing a decline)
 * is a no-op, not an error.
 */
async function withdrawConsent({ sessionId, candidateId, type, reason }) {
	for (const [key, value] of Object.entries({ sessionId, candidateId, type })) {
		if (value == null || value === '') {
			throw new Error(`consentService.withdrawConsent: ${key} is required`);
		}
	}
	assertValidType(type, 'withdrawConsent');

	const { rows } = await db.query(
		`UPDATE consent_receipts
     SET withdrawn_at = NOW()
     WHERE interview_session_id = $1
       AND candidate_id = $2
       AND consent_type = $3
       AND withdrawn_at IS NULL
     RETURNING id`,
		[sessionId, candidateId, type],
	);

	// Idempotent: no matching open receipt → already withdrawn or never granted.
	return rows[0] || { id: null, alreadyWithdrawn: true, reason: reason || null };
}

/**
 * Hot-path check: is consent currently valid for (sessionId, type)?
 * Performs a LIVE DB lookup on every call — consent state is NEVER cached
 * (withdrawal must propagate immediately, per architecture §3.20).
 * Returns false when: no receipt, withdrawn, or text version is stale.
 */
async function isConsentValid(sessionId, type) {
	assertValidType(type, 'isConsentValid');

	const currentVersion = await getCurrentTextVersion(type);

	const { rows } = await db.query(
		`SELECT granted_at, withdrawn_at, consent_text_version
     FROM consent_receipts
     WHERE interview_session_id = $1 AND consent_type = $2
     ORDER BY id DESC
     LIMIT 1`,
		[sessionId, type],
	);

	if (rows.length === 0) return false;
	const receipt = rows[0];
	if (!receipt.granted_at) return false;
	if (receipt.withdrawn_at) return false;
	// Stale version → re-consent required (S-011 returns CONSENT_VERSION_STALE)
	if (receipt.consent_text_version !== currentVersion) return false;
	return true;
}

/**
 * Resolve the current consent text version for a type, server-side.
 * NEVER trust a version from the client request.
 */
async function getCurrentTextVersion(type) {
	assertValidType(type, 'getCurrentTextVersion');
	const { rows } = await db.query(
		`SELECT version FROM consent_texts
     WHERE consent_type = $1
       AND effective_from = (SELECT MAX(effective_from) FROM consent_texts WHERE consent_type = $1)`,
		[type],
	);
	if (rows.length === 0) {
		throw new Error(`consentService.getCurrentTextVersion: no consent text found for type "${type}"`);
	}
	return rows[0].version;
}

/**
 * Get the full consent text (EN + HI) for a type at the current version.
 * Used by the consent screens to render the copy.
 */
async function getConsentText(type, locale = 'en') {
	assertValidType(type, 'getConsentText');
	const { rows } = await db.query(
		`SELECT consent_type, version, text_en, text_hi, effective_from
     FROM consent_texts
     WHERE consent_type = $1
       AND effective_from = (SELECT MAX(effective_from) FROM consent_texts WHERE consent_type = $1)`,
		[type],
	);
	if (rows.length === 0) {
		throw new Error(`consentService.getConsentText: no consent text found for type "${type}"`);
	}
	return rows[0];
}

/**
 * Full consent history for a candidate — DSAR source (data subject access).
 */
async function getConsentHistory(candidateId) {
	const { rows } = await db.query(
		`SELECT r.id, r.interview_session_id, r.consent_type, r.consent_text_version,
            r.granted_at, r.withdrawn_at, t.effective_from AS text_effective_from
     FROM consent_receipts r
     JOIN consent_texts t
       ON t.consent_type = r.consent_type AND t.version = r.consent_text_version
     WHERE r.candidate_id = $1
     ORDER BY r.id`,
		[candidateId],
	);
	return rows;
}

module.exports = {
	VALID_TYPES,
	recordConsent,
	getConsentStatus,
	withdrawConsent,
	isConsentValid,
	getCurrentTextVersion,
	getConsentText,
	getConsentHistory,
};
