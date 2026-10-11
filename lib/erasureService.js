/**
 * erasureService — shared biometric erasure routine for DSAR/account deletion.
 *
 * S-067 (#720): crypto-shredding must happen on EVERY erasure path, not just
 * self-serve deletion. This module is the single choke point:
 *   - DELETE /delete-account (routes/auth.js) calls it inside the deletion tx
 *   - Compliance fulfillment of POST /api/compliance/gdpr/delete data_requests
 *     MUST call it too (follow-up issue — manual fulfillment currently bypasses
 *     code entirely; see #720 HIGH-1)
 *
 * Semantics: destroy the candidate's DEK (renders all DEK-encrypted biometric
 * data unrecoverable), audit the destruction, skip cleanly when the user never
 * had a DEK (DEKNotFound). Any other error propagates → caller rolls back.
 */
const { destroyDEK } = require('./biometricCrypto');

/**
 * Crypto-shred a user's biometric DEK as part of an erasure workflow.
 *
 * @param {number} userId — the erasing user (candidate_id == user.id)
 * @param {object} opts
 * @param {object} opts.client — pg client/pool; destruction + audit ride it
 * @param {object} [opts.audit] — { userId, userRole, ipAddress } for the AC-3 audit entry
 * @returns {Promise<{ shredded: boolean }>} shredded=false when no DEK existed
 */
async function eraseBiometricData(userId, { client, audit } = {}) {
	try {
		await destroyDEK(userId, { client, audit });
		return { shredded: true };
	} catch (err) {
		if (err.code === 'DEKNotFound') {
			// Not every user has a DEK (recruiters, candidates with no video
			// data). Nothing to shred — not an error.
			return { shredded: false };
		}
		throw err;
	}
}

module.exports = { eraseBiometricData };
