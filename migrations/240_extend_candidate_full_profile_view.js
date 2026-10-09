/**
 * Migration 240: extend v_candidate_full_profile for dashboard consolidation (#521).
 *
 * The dashboard stats endpoint (GET /candidate/dashboard/stats) needs a few
 * more columns than the original view provided:
 *   - cp.linkedin_url, cp.github_url, cp.phone (profile completeness formula)
 *   - skill_verified_count (verified skills badge count)
 *
 * Per the view maintenance convention, the view is redefined here with the
 * new columns alongside the existing ones.
 *
 * NON-DESTRUCTIVE: CREATE OR REPLACE VIEW only. No tables touched.
 */
module.exports = {
	name: '240_extend_candidate_full_profile_view',
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
        cp.linkedin_url,
        cp.github_url,
        cp.phone,
        -- From omni_scores
        os.total_score AS omni_score,
        os.score_tier,
        -- Aggregates (subqueries keep this a single-row-per-user view)
        (SELECT COUNT(*) FROM candidate_skills cs WHERE cs.user_id = u.id)::integer AS skill_count,
        (SELECT COUNT(*) FILTER (WHERE cs.is_verified) FROM candidate_skills cs WHERE cs.user_id = u.id)::integer AS skill_verified_count,
        (SELECT COUNT(*) FROM work_experience we WHERE we.user_id = u.id)::integer AS experience_count,
        (SELECT COUNT(*) FROM education e WHERE e.user_id = u.id)::integer AS education_count
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN omni_scores os ON os.user_id = u.id
    `);
	},
	down: async (client) => {
		// Restore the migration-238 definition (without linkedin_url, github_url,
		// phone, skill_verified_count).
		await client.query(`
      CREATE OR REPLACE VIEW v_candidate_full_profile AS
      SELECT
        u.id,
        u.name,
        u.email,
        u.avatar_url,
        cp.headline,
        cp.bio,
        cp.location,
        cp.photo_url,
        cp.years_experience,
        cp.resume_url,
        cp.availability,
        os.total_score AS omni_score,
        os.score_tier,
        (SELECT COUNT(*) FROM candidate_skills cs WHERE cs.user_id = u.id)::integer AS skill_count,
        (SELECT COUNT(*) FROM work_experience we WHERE we.user_id = u.id)::integer AS experience_count,
        (SELECT COUNT(*) FROM education e WHERE e.user_id = u.id)::integer AS education_count
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN omni_scores os ON os.user_id = u.id
    `);
	},
};
