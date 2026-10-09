/**
 * Migration 238: v_candidate_full_profile view — single read surface for
 * complete candidate data.
 *
 * PROBLEM: 27 queries across routes/ hand-roll the users + candidate_profiles
 * join. name/avatar_url live on users, NOT on candidate_profiles. This caused
 * bug #515 (dashboard showed 75% vs profile 92% — backend read p.name from
 * the wrong table and got NULLs).
 *
 * SOLUTION: One view that resolves the join once, correctly. New code queries
 * the view instead of hand-rolling the join.
 *
 * NON-DESTRUCTIVE: no tables created, altered, or dropped. The view is
 * read-only. Fully reversible: DROP VIEW v_candidate_full_profile.
 *
 * MAINTENANCE: Per the view maintenance convention, any migration that adds
 * a column to users, candidate_profiles, or omni_scores must also
 * CREATE OR REPLACE this view to include the new column.
 *
 * NOTE: candidate_profiles.availability is the correct column name
 * (not availability_status).
 */
module.exports = {
	name: '238_v_candidate_full_profile',
	up: async (client) => {
		await client.query(`
      CREATE OR REPLACE VIEW v_candidate_full_profile AS
      SELECT
        -- From users (identity — name/avatar live here, NOT on candidate_profiles)
        u.id,
        u.name,
        u.email,
        u.avatar_url,
        -- From candidate_profiles (profile details)
        cp.headline,
        cp.bio,
        cp.location,
        cp.photo_url,
        cp.years_experience,
        cp.resume_url,
        cp.availability,
        -- From omni_scores
        os.total_score AS omni_score,
        os.score_tier,
        -- Aggregates (subqueries keep this a single-row-per-user view)
        (SELECT COUNT(*) FROM candidate_skills cs WHERE cs.user_id = u.id)::integer AS skill_count,
        (SELECT COUNT(*) FROM work_experience we WHERE we.user_id = u.id)::integer AS experience_count,
        (SELECT COUNT(*) FROM education e WHERE e.user_id = u.id)::integer AS education_count
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN omni_scores os ON os.user_id = u.id
    `);
	},
	down: async (client) => {
		await client.query(`DROP VIEW IF EXISTS v_candidate_full_profile`);
	},
};
