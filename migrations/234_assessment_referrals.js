/**
 * Migration 234: assessment_referrals — tokenized referral links for assessments.
 *
 * Lets recruiters share a link (/r/<token>) with a candidate by email. The
 * candidate signs up / logs in, the token is claimed, and an application +
 * assigned attempt are created (idempotently). Follows the oauth_exchange_codes
 * pattern (migration 230): sha256(token) stored, raw token never persisted.
 */
module.exports = {
	name: '234_assessment_referrals',
	up: async (client) => {
		await client.query(`
			CREATE TABLE IF NOT EXISTS assessment_referrals (
				id SERIAL PRIMARY KEY,
				job_assessment_id INTEGER NOT NULL REFERENCES job_assessments(id) ON DELETE CASCADE,
				email VARCHAR(255) NOT NULL,
				token_hash VARCHAR(64) NOT NULL UNIQUE,
				created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				due_date TIMESTAMPTZ,
				claimed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
				claimed_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_assessment_referrals_token
			ON assessment_referrals (token_hash)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_assessment_referrals_email
			ON assessment_referrals (email)
		`);
		console.log('[migration:234] assessment_referrals created');
	},
};
