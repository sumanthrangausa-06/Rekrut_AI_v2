/**
 * biometricAudit — append-only audit logging for biometric data access.
 *
 * S-014 (#573): Every biometric data access must be logged immutably.
 * The DB trigger `trg_biometric_audit_log_no_update` blocks UPDATE/DELETE;
 * this helper is the application-level write path (INSERT only).
 *
 * Follow-up (out of scope): encrypt candidate_id via per-candidate DEK
 * (architecture ADR-012). Currently stored as plain FK.
 */
const _crypto = require('node:crypto');
const db = require('./db');

const VALID_ACTIONS = [
	'view',
	'export',
	'delete',
	'purge',
	// #748: consent lifecycle events are audit-logged through logAccess
	// (consentService routes its raw INSERTs here with company attribution).
	'consent_granted',
	'consent_declined',
	'consent_withdrawn',
];

const REQUIRED_FIELDS = ['userId', 'userRole', 'action', 'dataType', 'candidateId'];

/**
 * Log a biometric data access event.
 *
 * @param {object} params
 * @param {number} params.userId — who accessed
 * @param {string} params.userRole — candidate|recruiter|employer|admin|hiring_manager
 * @param {string} params.action — view|export|delete|purge|consent_granted|consent_declined|consent_withdrawn
 * @param {string} params.dataType — e.g. face_embedding, voice_profile, transcript
 * @param {number} params.candidateId — whose biometric data
 * @param {string} [params.ipAddress] — optional source IP
+ * @param {number} [params.companyId] — tenant attribution for the audit entry
+ *   (S-065 C1: hiring_manager read views are scoped by company_id).
+ *   NULL when the caller's company is unknown (legacy rows); the read path
+ *   excludes NULL rows from hiring_manager views (fail-closed).
 * @param {object} [client] — pg client/pool for the INSERT (transaction support).
 *   Defaults to the shared pool. S-067 (#720): DEK-destruction audit rides the
 *   same client as the destruction so both roll back together.
 * @returns {Promise<object>} the inserted audit row
 */
async function logAccess({ userId, userRole, action, dataType, candidateId, ipAddress, companyId, metadata }, client = db) {
	const values = { userId, userRole, action, dataType, candidateId };
	for (const field of REQUIRED_FIELDS) {
		const v = values[field];
		if (v == null || v === '') {
			throw new Error(`biometricAudit.logAccess: ${field} is required`);
		}
	}

	if (!VALID_ACTIONS.includes(action)) {
		throw new Error(
			`biometricAudit.logAccess: Invalid action "${action}". Must be one of: ${VALID_ACTIONS.join(', ')}`,
		);
	}

	const { rows } = await client.query(
		`INSERT INTO biometric_audit_log
       (user_id, user_role, action, data_type, candidate_id, ip_address, company_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, accessed_at, user_id, user_role, action, data_type, candidate_id, ip_address, company_id`,
		[userId, userRole, action, dataType, candidateId, ipAddress || null, companyId || null, metadata ? JSON.stringify(metadata) : '{}'],
	);

	return rows[0];
}

module.exports = { logAccess, VALID_ACTIONS, pseudonymizeCandidateId };

/**
 * S-065 (#715): Display-level pseudonym for candidate references in the
 * audit viewer. Stable (same input → same output), non-sequential.
 *
 * Privacy review (S-065): the original unsalted SHA-256 was brute-forceable
 * (small integer ID space). Now HMAC-SHA256 with a server-side secret
 * (AUDIT_PSEUDONYM_SECRET). Without the secret, pseudonyms are NOT a
 * privacy boundary — they are obfuscation for screenshots only. The real
 * controls are access scope (admin/hiring_manager) and role checks.
 *
 * This is DISPLAY-level only: the DB still stores the plain FK (S-057
 * follow-up will encrypt candidate_id at rest). The read path never joins
 * the users table, so no PII is exposed alongside the pseudonym.
 *
 * Note: rotating AUDIT_PSEUDONYM_SECRET changes all pseudonyms. They are
 * not stored, so this is safe — but cross-session correlation breaks.
 *
 * @param {number|string} candidateId
 * @returns {string} e.g. "CAND-3f9a2b1c4d5e6f78"
 */
function pseudonymizeCandidateId(candidateId) {
	const secret = process.env.AUDIT_PSEUDONYM_SECRET;
	if (!secret && process.env.NODE_ENV === 'production') {
		console.warn(
			'[biometricAudit] AUDIT_PSEUDONYM_SECRET not set; pseudonyms are not HMAC-secured',
		);
	}
	const hash = _crypto
		.createHmac('sha256', secret || 'dev-only-insecure-fallback')
		.update(`biometric-audit-v1:${candidateId}`)
		.digest('hex')
		.slice(0, 16); // 64 bits
	return `CAND-${hash}`;
}
