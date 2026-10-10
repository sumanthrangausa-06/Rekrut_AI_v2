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
       VALUES ($1, 'candidate', $2, $3, $4, $5)`,
			[candidateId, accepted ? 'consent_granted' : 'consent_declined', `consent_${type}`, candidateId, ipAddress || null],
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

	// CR-05: log the withdrawal to the audit trail (best-effort).
	if (rows[0]) {
		try {
			await db.query(
				`INSERT INTO biometric_audit_log (user_id, user_role, action, data_type, candidate_id)
         VALUES ($1, 'candidate', 'consent_withdrawn', $2, $1)`,
				[candidateId, `consent_${type}`],
			);
		} catch {
			// Audit trail write failed; consent_receipts remains the source of truth.
		}
	}

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
 * Check the consent state for a session + type — the enforcement primitive
 * used by `requireBiometricConsent` middleware (S-011).
 *
 * Live DB lookup on every call. NEVER cached — withdrawal must propagate
 * immediately (AC-5). NEVER trusts client-supplied consent assertions;
 * the DB is the single source of truth (AC-6).
 *
 * @param {number} sessionId - interview session ID
 * @param {string} type - consent type
 * @param {number} [candidateId] - when provided, the receipt must belong to
 *   this candidate (IDOR protection: a receipt for another candidate's
 *   session must not grant access).
 *
 * Returns one of:
 *   { state: 'valid' }                                    — granted, current version
 *   { state: 'missing' }                                   — no receipt, or never granted
 *   { state: 'stale', receiptVersion, currentVersion }     — text changed since consent
 *   { state: 'withdrawn', withdrawnAt }                    — consent withdrawn mid-session
 */
async function checkConsentState(sessionId, type, candidateId = null) {
	assertValidType(type, 'checkConsentState');
	if (sessionId == null || sessionId === '') {
		throw new Error('consentService.checkConsentState: sessionId is required');
	}

	const currentVersion = await getCurrentTextVersion(type);

	// candidateId binding (S-011 pentest fix): the receipt must belong to the
	// authenticated data subject. A receipt planted on another candidate's
	// session — or a sessionId belonging to someone else — yields 'missing'.
	const ownerClause = candidateId != null ? 'AND candidate_id = $3' : '';
	const params = candidateId != null ? [sessionId, type, candidateId] : [sessionId, type];

	const { rows } = await db.query(
		`SELECT granted_at, withdrawn_at, consent_text_version
     FROM consent_receipts
     WHERE interview_session_id = $1 AND consent_type = $2 ${ownerClause}
     ORDER BY id DESC
     LIMIT 1`,
		params,
	);

	if (rows.length === 0) return { state: 'missing' };
	const receipt = rows[0];
	if (!receipt.granted_at) return { state: 'missing' };
	if (receipt.withdrawn_at) return { state: 'withdrawn', withdrawnAt: receipt.withdrawn_at };
	if (receipt.consent_text_version !== currentVersion) {
		return {
			state: 'stale',
			receiptVersion: receipt.consent_text_version,
			currentVersion,
		};
	}
	return { state: 'valid', version: currentVersion };
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
 * Verify that an interview session belongs to a candidate.
 * Used by consent write-path routes (S-011 pentest fix): prevents receipt
 * planting on another candidate's session and the resulting withdrawal
 * lockout (an attacker plants a receipt the victim can never withdraw).
 *
 * Checks both the unified interview_sessions table (candidate_id) and the
 * legacy mock_interview_sessions table (user_id). S-001 will unify these.
 *
 * @throws if the session does not exist or belongs to someone else.
 */
async function assertSessionOwnership(sessionId, candidateId) {
	const { rows } = await db.query(
		`SELECT candidate_id AS owner_id FROM interview_sessions WHERE id = $1
     UNION ALL
     SELECT user_id AS owner_id FROM mock_interview_sessions WHERE id = $1`,
		[sessionId],
	);
	if (rows.length === 0) {
		throw new Error(`consentService.assertSessionOwnership: session ${sessionId} not found`);
	}
	if (!rows.some((r) => r.owner_id === candidateId)) {
		throw new Error('consentService.assertSessionOwnership: session does not belong to this candidate');
	}
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
	checkConsentState,
	assertSessionOwnership,
	getCurrentTextVersion,
	getConsentText,
	getConsentHistory,
};
