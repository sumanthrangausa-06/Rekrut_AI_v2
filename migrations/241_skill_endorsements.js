/**
 * Migration 241: Create skill_endorsements table.
 *
 * Recruiter-to-candidate skill endorsements. Recruiters verify skills during
 * interviews; this gives them a lightweight way to vouch for a candidate's
 * claimed skills. Separate from system verification (is_verified on
 * candidate_skills, set by assessments) — endorsements are human validation.
 *
 * Uniqueness on (candidate_id, skill_name, recruiter_id) prevents a recruiter
 * from endorsing the same skill twice.
 *
 * Issue #527. Part of Phase 3 (endorsements).
 */
module.exports = {
	name: '241_skill_endorsements',
	up: async (client) => {
		await client.query(`
			CREATE TABLE IF NOT EXISTS skill_endorsements (
				id SERIAL PRIMARY KEY,
				candidate_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				skill_name VARCHAR(255) NOT NULL,
				recruiter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at TIMESTAMPTZ DEFAULT NOW(),
				UNIQUE(candidate_id, skill_name, recruiter_id)
			);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_endorsements_candidate
			ON skill_endorsements(candidate_id);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_endorsements_skill
			ON skill_endorsements(candidate_id, skill_name);
		`);
	},
	down: async (client) => {
		await client.query('DROP TABLE IF EXISTS skill_endorsements;');
	},
};
