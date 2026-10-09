/**
 * Migration 240: v_unified_assessments VIEW.
 *
 * Combines the three overlapping assessment systems into one read source,
 * following the same pattern as unified_interviews and v_candidate_full_profile:
 *
 *   - aptitude_test_attempts  (074_aptitude_test_engine.js:49)   -> 'aptitude'
 *   - skill_assessments       (004_candidate_profiles.js:89)    -> 'skill'
 *   - job_assessment_attempts (042_job_assessments.js:51)       -> 'job_assessment'
 *
 * Column sources verified against the migration files above before writing.
 * Types are cast to UNION ALL-compatible types (score/max_score -> numeric,
 * status -> text). skill_assessments has no status column; it is derived
 * from completed_at ('completed' vs 'in_progress').
 *
 * Additive only: CREATE OR REPLACE VIEW, no table changes.
 * DOWN: DROP VIEW IF EXISTS.
 */
module.exports = {
	name: '240_v_unified_assessments',
	up: async (client) => {
		await client.query(`
			CREATE OR REPLACE VIEW v_unified_assessments AS
			SELECT
				ata.id,
				ata.candidate_id AS user_id,
				'aptitude'::text AS source_system,
				ata.test_id AS source_id,
				at.title AS title,
				ata.score::numeric AS score,
				ata.max_score::numeric AS max_score,
				ata.status::text AS status,
				ata.started_at,
				ata.completed_at
			FROM aptitude_test_attempts ata
			LEFT JOIN aptitude_tests at ON at.id = ata.test_id
			UNION ALL
			SELECT
				sa.id,
				sa.user_id,
				'skill'::text AS source_system,
				sa.skill_id AS source_id,
				sa.title AS title,
				sa.score::numeric AS score,
				sa.max_score::numeric AS max_score,
				CASE WHEN sa.completed_at IS NOT NULL THEN 'completed' ELSE 'in_progress' END::text AS status,
				sa.started_at,
				sa.completed_at
			FROM skill_assessments sa
			UNION ALL
			SELECT
				jaa.id,
				jaa.candidate_id AS user_id,
				'job_assessment'::text AS source_system,
				jaa.assessment_id AS source_id,
				ja.title AS title,
				jaa.composite_score AS score,
				NULL::numeric AS max_score,
				jaa.status::text AS status,
				jaa.started_at,
				jaa.completed_at
			FROM job_assessment_attempts jaa
			LEFT JOIN job_assessments ja ON ja.id = jaa.assessment_id
		`);
	},
	down: async (client) => {
		await client.query('DROP VIEW IF EXISTS v_unified_assessments;');
	},
};
