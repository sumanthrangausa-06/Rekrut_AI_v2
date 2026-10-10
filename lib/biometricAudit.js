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
const db = require('./db');

const VALID_ACTIONS = ['view', 'export', 'delete', 'purge'];

const REQUIRED_FIELDS = ['userId', 'userRole', 'action', 'dataType', 'candidateId'];

/**
 * Log a biometric data access event.
 *
 * @param {object} params
 * @param {number} params.userId — who accessed
 * @param {string} params.userRole — candidate|recruiter|employer|admin|hiring_manager
 * @param {string} params.action — view|export|delete|purge
 * @param {string} params.dataType — e.g. face_embedding, voice_profile, transcript
 * @param {number} params.candidateId — whose biometric data
 * @param {string} [params.ipAddress] — optional source IP
 * @returns {Promise<object>} the inserted audit row
 */
async function logAccess({ userId, userRole, action, dataType, candidateId, ipAddress }) {
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

	const { rows } = await db.query(
		`INSERT INTO biometric_audit_log
       (user_id, user_role, action, data_type, candidate_id, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, accessed_at, user_id, user_role, action, data_type, candidate_id, ip_address`,
		[userId, userRole, action, dataType, candidateId, ipAddress || null],
	);

	return rows[0];
}

module.exports = { logAccess, VALID_ACTIONS };
