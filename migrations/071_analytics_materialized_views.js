/**
 * Migration: Analytics Materialized Views
 * Issue #143 — PostgreSQL Analytics Optimization
 *
 * Creates materialized views for expensive aggregate queries used by
 * the recruiter dashboard, candidate analytics, and funnel endpoints.
 * Views are refreshed concurrently where possible (requires unique index).
 */

module.exports = {
	name: '071_analytics_materialized_views',
	up: async (client) => {
		// ─────────────────────────────────────────────────────────────
		// 1. mv_daily_metrics — daily rollups of key entity counts
		//    Used by: /api/recruiter/analytics/overview, /api/analytics/overview
		// ─────────────────────────────────────────────────────────────
		await client.query(`
			CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_metrics AS
			WITH daily_users AS (
				SELECT
					DATE(created_at) AS day,
					role,
					COUNT(*) AS cnt
				FROM users
				GROUP BY DATE(created_at), role
			),
			daily_jobs AS (
				SELECT DATE(created_at) AS day, COUNT(*) AS cnt FROM jobs GROUP BY DATE(created_at)
			),
			daily_apps AS (
				SELECT
					DATE(created_at) AS day,
					status,
					COUNT(*) AS cnt
				FROM job_applications
				GROUP BY DATE(created_at), status
			),
			daily_interviews AS (
				SELECT
					DATE(created_at) AS day,
					status,
					COUNT(*) AS cnt
				FROM interviews
				GROUP BY DATE(created_at), status
			),
			all_days AS (
				SELECT generate_series(
					(SELECT MIN(day) FROM daily_users),
					CURRENT_DATE,
					'1 day'::interval
				)::date AS day
			)
			SELECT
				d.day,
				COALESCE(u.cnt, 0) AS user_count,
				u.role AS user_role,
				COALESCE(j.cnt, 0) AS job_count,
				COALESCE(a.cnt, 0) AS application_count,
				a.status AS application_status,
				COALESCE(i.cnt, 0) AS interview_count,
				i.status AS interview_status,
				NOW() AS refreshed_at
			FROM all_days d
			LEFT JOIN daily_users u ON d.day = u.day
			LEFT JOIN daily_jobs j ON d.day = j.day
			LEFT JOIN daily_apps a ON d.day = a.day
			LEFT JOIN daily_interviews i ON d.day = i.day
			ORDER BY d.day DESC
		`);

		await client.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_metrics_pk
			ON mv_daily_metrics(day, user_role, application_status, interview_status)
		`);

		// ─────────────────────────────────────────────────────────────
		// 2. mv_candidate_funnel — pipeline funnel counts by status
		//    Used by: /api/recruiter/analytics/funnel
		// ─────────────────────────────────────────────────────────────
		await client.query(`
			CREATE MATERIALIZED VIEW IF NOT EXISTS mv_candidate_funnel AS
			SELECT
				COALESCE(ja.status, 'total') AS status,
				COUNT(*) AS count,
				AVG(COALESCE(ic.score, 0)) AS avg_interview_score,
				NOW() AS refreshed_at
			FROM job_applications ja
			LEFT JOIN interviews i ON i.job_id = ja.job_id
			LEFT JOIN interview_composite_scores ic ON ic.interview_id = i.id
			GROUP BY ROLLUP(ja.status)
		`);

		await client.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_candidate_funnel_pk
			ON mv_candidate_funnel(status)
		`);

		// ─────────────────────────────────────────────────────────────
		// 3. mv_company_engagement_summary — per-company engagement rollup
		//    Used by: /api/recruiter/dashboard, /api/analytics/overview
		// ─────────────────────────────────────────────────────────────
		await client.query(`
			CREATE MATERIALIZED VIEW IF NOT EXISTS mv_company_engagement_summary AS
			SELECT
				u.company_name,
				u.id AS user_id,
				COUNT(DISTINCT j.id) AS total_jobs,
				COUNT(DISTINCT ja.id) AS total_applications,
				COUNT(DISTINCT i.id) AS total_interviews,
				COUNT(DISTINCT CASE WHEN ja.status = 'hired' THEN ja.id END) AS total_hires,
				AVG(COALESCE(ic.score, 0)) AS avg_score,
				NOW() AS refreshed_at
			FROM users u
			LEFT JOIN jobs j ON j.user_id = u.id
			LEFT JOIN job_applications ja ON ja.job_id = j.id
			LEFT JOIN interviews i ON i.user_id = u.id
			LEFT JOIN interview_composite_scores ic ON ic.interview_id = i.id
			WHERE u.role = 'recruiter'
			GROUP BY u.id, u.company_name
		`);

		await client.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_company_engagement_pk
			ON mv_company_engagement_summary(user_id)
		`);

		// ─────────────────────────────────────────────────────────────
		// 4. mv_time_to_hire — average days from application to hire per job
		//    Used by: /api/recruiter/time-to-hire
		// ─────────────────────────────────────────────────────────────
		await client.query(`
			CREATE MATERIALIZED VIEW IF NOT EXISTS mv_time_to_hire AS
			SELECT
				j.id AS job_id,
				j.title AS job_title,
				u.company_name,
				AVG(
					EXTRACT(EPOCH FROM (ja.updated_at - ja.created_at)) / 86400.0
				)::numeric(10,2) AS avg_days_to_hire,
				COUNT(*) FILTER (WHERE ja.status = 'hired') AS hires_count,
				NOW() AS refreshed_at
			FROM jobs j
			JOIN users u ON u.id = j.user_id
			JOIN job_applications ja ON ja.job_id = j.id
			WHERE ja.status = 'hired'
			GROUP BY j.id, j.title, u.company_name
		`);

		await client.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_time_to_hire_pk
			ON mv_time_to_hire(job_id)
		`);

		// ─────────────────────────────────────────────────────────────
		// 5. mv_candidate_skill_distribution — skill frequency counts
		//    Used by: /api/candidate/analytics
		// ─────────────────────────────────────────────────────────────
		await client.query(`
			CREATE MATERIALIZED VIEW IF NOT EXISTS mv_candidate_skill_distribution AS
			SELECT
				cs.skill_name,
				cs.category,
				COUNT(*) AS candidate_count,
				AVG(cs.proficiency_level) AS avg_proficiency,
				NOW() AS refreshed_at
			FROM candidate_skills cs
			GROUP BY cs.skill_name, cs.category
			ORDER BY candidate_count DESC
		`);

		await client.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_skill_dist_pk
			ON mv_candidate_skill_distribution(skill_name, category)
		`);
	},
};
