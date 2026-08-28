/**
 * Migration: Analytics Indexes
 * Issue #143 — PostgreSQL Analytics Optimization
 *
 * Adds single-column and composite indexes on tables heavily used by
 * analytics endpoints. These indexes target filters on created_at, status,
 * role, company_id, job_id, and candidate_id.
 */

module.exports = {
	name: '070_analytics_indexes',
	up: async (client) => {
<<<<<<< HEAD
		// Helper: create index only if table and column exist (avoids transaction abort)
		async function createIndexIfReady(sql, tableName, columnName) {
			const tableCheck = await client.query(
				`SELECT to_regclass($1) as exists`,
				[tableName]
			);
			if (!tableCheck.rows[0].exists) {
				console.log(`[migration:070] Skipped index (table '${tableName}' not ready): ${sql}`);
				return;
			}
			// Check column exists
			const colCheck = await client.query(
				`SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
				[tableName, columnName]
			);
			if (colCheck.rows.length === 0) {
				console.log(`[migration:070] Skipped index (column '${columnName}' not ready on '${tableName}'): ${sql}`);
				return;
			}
			await client.query(sql);
=======
		const indexes = [
			// ── users ──
			`CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`,
			`CREATE INDEX IF NOT EXISTS idx_users_company_name ON users(company_name) WHERE company_name IS NOT NULL`,

			// ── jobs ──
			`CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_jobs_user_id_created_at ON jobs(user_id, created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`,
			`CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company)`,

			// ── job_applications (timestamps live in applied_at, not created_at) ──
			`CREATE INDEX IF NOT EXISTS idx_job_applications_applied_at ON job_applications(applied_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_job_applications_status ON job_applications(status)`,
			`CREATE INDEX IF NOT EXISTS idx_job_applications_status_applied_at ON job_applications(status, applied_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_job_applications_job_id ON job_applications(job_id)`,
			`CREATE INDEX IF NOT EXISTS idx_job_applications_job_id_applied_at ON job_applications(job_id, applied_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_job_applications_candidate_id ON job_applications(candidate_id)`,
			`CREATE INDEX IF NOT EXISTS idx_job_applications_candidate_id_applied_at ON job_applications(candidate_id, applied_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_job_applications_company_id ON job_applications(company_id)`,

			// ── interviews ──
			`CREATE INDEX IF NOT EXISTS idx_interviews_created_at ON interviews(created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_interviews_user_id_created_at ON interviews(user_id, created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_interviews_job_id_created_at ON interviews(job_id, created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status)`,
			`CREATE INDEX IF NOT EXISTS idx_interviews_interview_type ON interviews(interview_type)`,

			// ── interview_evaluations ──
			`CREATE INDEX IF NOT EXISTS idx_interview_evaluations_interview_id ON interview_evaluations(interview_id)`,
			`CREATE INDEX IF NOT EXISTS idx_interview_evaluations_created_at ON interview_evaluations(created_at DESC)`,

			// ── interview_composite_scores ──
			`CREATE INDEX IF NOT EXISTS idx_composite_scores_interview_id ON interview_composite_scores(interview_id)`,

			// ── screening_sessions ──
			`CREATE INDEX IF NOT EXISTS idx_screening_sessions_created_at ON screening_sessions(created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_screening_sessions_status ON screening_sessions(status)`,
			`CREATE INDEX IF NOT EXISTS idx_screening_sessions_job_id ON screening_sessions(job_id)`,

			// ── pipeline_stages ──
			`CREATE INDEX IF NOT EXISTS idx_pipeline_stages_job_id ON pipeline_stages(job_id)`,
			`CREATE INDEX IF NOT EXISTS idx_pipeline_stages_order_num ON pipeline_stages(job_id, order_num)`,

			// ── communications ──
			`CREATE INDEX IF NOT EXISTS idx_communications_created_at ON communications(created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_communications_status ON communications(status)`,
			`CREATE INDEX IF NOT EXISTS idx_communications_type ON communications(type)`,

			// ── match_results (timestamps live in calculated_at, not created_at) ──
			`CREATE INDEX IF NOT EXISTS idx_match_results_calculated_at ON match_results(calculated_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_match_results_job_id ON match_results(job_id)`,
			`CREATE INDEX IF NOT EXISTS idx_match_results_candidate_id ON match_results(candidate_id)`,

			// ── company_engagement_metrics ──
			`CREATE INDEX IF NOT EXISTS idx_company_engagement_date ON company_engagement_metrics(date DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_company_engagement_company_date ON company_engagement_metrics(company_id, date DESC)`,

			// ── activity_log ──
			`CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_activity_log_event_type ON activity_log(event_type)`,

			// ── trust_scores ──
			`CREATE INDEX IF NOT EXISTS idx_trust_scores_created_at ON trust_scores(created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_trust_scores_user_id ON trust_scores(user_id)`,

			// ── offers ──
			`CREATE INDEX IF NOT EXISTS idx_offers_created_at ON offers(created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status)`,

			// ── scheduled_interviews ──
			`CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_created_at ON scheduled_interviews(created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_status ON scheduled_interviews(status)`,

			// ── candidate_profiles ──
			`CREATE INDEX IF NOT EXISTS idx_candidate_profiles_created_at ON candidate_profiles(created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_candidate_profiles_user_id ON candidate_profiles(user_id)`,
		];

		// These indexes are pure query optimisations. A table or column that is
		// absent on a given environment must not abort the whole deploy, so skip
		// those rather than failing the migration.
		// The runner wraps each migration in a transaction, so a savepoint is
		// needed to recover from an individual failure without aborting the rest.
		const SKIPPABLE = new Set(['42P01', '42703']); // undefined_table, undefined_column
		for (const sql of indexes) {
			await client.query('SAVEPOINT idx_stmt');
			try {
				await client.query(sql);
				await client.query('RELEASE SAVEPOINT idx_stmt');
			} catch (err) {
				await client.query('ROLLBACK TO SAVEPOINT idx_stmt');
				if (!SKIPPABLE.has(err.code)) throw err;
				console.log(`[070_analytics_indexes] skipped (${err.message}): ${sql}`);
			}
>>>>>>> origin/dev
		}

		// ── users ──
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC)`, 'users', 'created_at');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`, 'users', 'role');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_users_company_name ON users(company_name) WHERE company_name IS NOT NULL`, 'users', 'company_name');

		// ── jobs ──
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC)`, 'jobs', 'created_at');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_jobs_user_id_created_at ON jobs(user_id, created_at DESC)`, 'jobs', 'user_id');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`, 'jobs', 'status');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company)`, 'jobs', 'company');

		// ── job_applications ──
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_job_applications_created_at ON job_applications(created_at DESC)`, 'job_applications', 'created_at');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_job_applications_status ON job_applications(status)`, 'job_applications', 'status');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_job_applications_status_created_at ON job_applications(status, created_at DESC)`, 'job_applications', 'status');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_job_applications_job_id ON job_applications(job_id)`, 'job_applications', 'job_id');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_job_applications_job_id_created_at ON job_applications(job_id, created_at DESC)`, 'job_applications', 'job_id');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_job_applications_candidate_id ON job_applications(candidate_id)`, 'job_applications', 'candidate_id');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_job_applications_candidate_id_created_at ON job_applications(candidate_id, created_at DESC)`, 'job_applications', 'candidate_id');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_job_applications_user_id ON job_applications(user_id)`, 'job_applications', 'user_id');

		// ── interviews ──
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_interviews_created_at ON interviews(created_at DESC)`, 'interviews', 'created_at');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_interviews_user_id_created_at ON interviews(user_id, created_at DESC)`, 'interviews', 'user_id');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_interviews_job_id_created_at ON interviews(job_id, created_at DESC)`, 'interviews', 'job_id');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status)`, 'interviews', 'status');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_interviews_interview_type ON interviews(interview_type)`, 'interviews', 'interview_type');

		// ── interview_evaluations ──
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_interview_evaluations_interview_id ON interview_evaluations(interview_id)`, 'interview_evaluations', 'interview_id');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_interview_evaluations_created_at ON interview_evaluations(created_at DESC)`, 'interview_evaluations', 'created_at');

		// ── interview_composite_scores ──
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_composite_scores_interview_id ON interview_composite_scores(interview_id)`, 'interview_composite_scores', 'interview_id');

		// ── screening_sessions ──
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_screening_sessions_created_at ON screening_sessions(created_at DESC)`, 'screening_sessions', 'created_at');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_screening_sessions_status ON screening_sessions(status)`, 'screening_sessions', 'status');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_screening_sessions_job_id ON screening_sessions(job_id)`, 'screening_sessions', 'job_id');

		// ── pipeline_stages ──
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_pipeline_stages_job_id ON pipeline_stages(job_id)`, 'pipeline_stages', 'job_id');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_pipeline_stages_order_num ON pipeline_stages(job_id, order_num)`, 'pipeline_stages', 'job_id');

		// ── communications ──
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_communications_created_at ON communications(created_at DESC)`, 'communications', 'created_at');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_communications_status ON communications(status)`, 'communications', 'status');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_communications_type ON communications(type)`, 'communications', 'type');

		// ── match_results ──
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_match_results_created_at ON match_results(created_at DESC)`, 'match_results', 'created_at');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_match_results_job_id ON match_results(job_id)`, 'match_results', 'job_id');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_match_results_candidate_id ON match_results(candidate_id)`, 'match_results', 'candidate_id');

		// ── company_engagement_metrics ──
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_company_engagement_date ON company_engagement_metrics(date DESC)`, 'company_engagement_metrics', 'date');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_company_engagement_company_date ON company_engagement_metrics(company_id, date DESC)`, 'company_engagement_metrics', 'company_id');

		// ── activity_log ──
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC)`, 'activity_log', 'created_at');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_activity_log_event_type ON activity_log(event_type)`, 'activity_log', 'event_type');

		// ── trust_scores ──
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_trust_scores_created_at ON trust_scores(created_at DESC)`, 'trust_scores', 'created_at');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_trust_scores_user_id ON trust_scores(user_id)`, 'trust_scores', 'user_id');

		// ── offers ──
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_offers_created_at ON offers(created_at DESC)`, 'offers', 'created_at');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status)`, 'offers', 'status');

		// ── scheduled_interviews ──
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_created_at ON scheduled_interviews(created_at DESC)`, 'scheduled_interviews', 'created_at');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_status ON scheduled_interviews(status)`, 'scheduled_interviews', 'status');

		// ── candidate_profiles ──
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_candidate_profiles_created_at ON candidate_profiles(created_at DESC)`, 'candidate_profiles', 'created_at');
		await createIndexIfReady(`CREATE INDEX IF NOT EXISTS idx_candidate_profiles_user_id ON candidate_profiles(user_id)`, 'candidate_profiles', 'user_id');
	},
};
