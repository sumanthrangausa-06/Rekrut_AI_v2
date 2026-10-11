/**
 * erasureService — shared personal-data erasure routine for DSAR/account deletion.
 *
 * S-067 (#720): crypto-shredding must happen on EVERY erasure path, not just
 * self-serve deletion. This module is the single choke point:
 *   - DELETE /delete-account (routes/auth.js) calls it inside the deletion tx
 *   - Compliance fulfillment of POST /api/compliance/gdpr/delete data_requests
 *     MUST call it too (follow-up issue — manual fulfillment currently bypasses
 *     code entirely; see #720 HIGH-1)
 *
 * S-075 (#752): rescoped from biometric-only to personal-data. Privacy-engineer
 * verdict (Rex's specialist review): candidate_embeddings is NOT biometric
 * (1536-dim text embedding of profile/resume text — zero BIPA exposure) but IS
 * personal data under GDPR Art. 4(1), and its plaintext survival past account
 * deletion is an active Art. 17 violation. Fix: hard-delete the row on erasure.
 * The embeddings row is a leaf table (user_id UNIQUE, no FKs pointing at it),
 * so hard-delete is safe; embeddings are independent of DEK existence.
 *
 * S-075 privacy review (CRITICAL finding): candidate_search_index holds a
 * SECOND copy of the 1536-dim embedding plus plaintext PII (name, bio,
 * job_title, location, skills, avatar_url) — same Art. 17 violation in the
 * same table family. Also a leaf table (user_id PK, no referencing FKs):
 * hard-deleted alongside. Note the users-table sync trigger
 * (trg_sync_csi_users, AFTER UPDATE OF name/avatar_url) fires during the
 * account-deletion UPDATE — but our DELETE runs after it in the same
 * transaction, so ordering is safe.
 *
 * Semantics: destroy the candidate's DEK (renders all DEK-encrypted biometric
 * data unrecoverable) + hard-delete the candidate_embeddings row, audit the
 * destruction, skip cleanly when the user never had a DEK (DEKNotFound). Any
 * other error propagates → caller rolls back.
 */
const { destroyDEK } = require('./biometricCrypto');

/**
 * Erase a user's personal data as part of an erasure workflow.
 *
 * @param {number} userId — the erasing user (candidate_id == user.id)
 * @param {object} opts
 * @param {object} opts.client — pg client/pool; destruction + audit ride it
 * @param {object} [opts.audit] — { userId, userRole, ipAddress, companyId } for
 *   the AC-3 audit entry (companyId = tenant attribution, S-065 C1)
 * @returns {Promise<{ shredded: boolean, embeddingsDeleted: boolean, searchIndexDeleted: boolean }>}
 *   shredded=false when no DEK existed; embeddingsDeleted/searchIndexDeleted
 *   false when the respective row didn't exist
 */
async function erasePersonalData(userId, { client, audit } = {}) {
	let shredded;
	try {
		await destroyDEK(userId, { client, audit });
		shredded = true;
	} catch (err) {
		if (err.code === 'DEKNotFound') {
			// Not every user has a DEK (recruiters, candidates with no video
			// data). Nothing to shred — not an error.
			shredded = false;
		} else {
			throw err;
		}
	}

	// S-075 (#752): hard-delete the candidate_embeddings row. Independent of
	// DEK existence — plaintext personal data, GDPR Art. 17 requires erasure
	// regardless. Leaf table (user_id UNIQUE, no referencing FKs): safe.
	// Privacy-review CRITICAL: candidate_search_index holds a second embedding
	// copy + plaintext PII — same violation, deleted alongside (also a leaf
	// table; the users sync trigger fires earlier in this transaction, so the
	// DELETE runs after any re-sync).
	const queryable = client || require('./db');
	const { rowCount: embeddingsRows } = await queryable.query(
		'DELETE FROM candidate_embeddings WHERE user_id = $1',
		[userId],
	);
	const { rowCount: searchIndexRows } = await queryable.query(
		'DELETE FROM candidate_search_index WHERE user_id = $1',
		[userId],
	);

	return {
		shredded,
		embeddingsDeleted: embeddingsRows > 0,
		searchIndexDeleted: searchIndexRows > 0,
	};
}

module.exports = { erasePersonalData };
