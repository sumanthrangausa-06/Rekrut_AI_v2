module.exports = {
	name: 'p3_schema_optimizations',
	up: async (db) => {
		// =============================================
		// P3 SCHEMA OPTIMIZATIONS — Nice-to-have fixes
		// 64 FK indexes + ~182 timestamptz conversions +
		// 6 partial indexes + 7 unique constraints
		// =============================================

		// Helper to check if table exists
		async function tableExists(tableName) {
			const result = await db.query(
				`SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
				[tableName],
			);
			return result.rows.length > 0;
		}

		// Helper to run ALTER statements safely (skip if table doesn't exist)
		async function safeAlter(sql) {
			// Extract table name from ALTER TABLE statement
			const match = sql.match(/ALTER\s+TABLE\s+(\w+)/i);
			const tableName = match ? match[1] : null;
			if (tableName && !(await tableExists(tableName))) {
				console.log(
					`[migration] Skipping ALTER (table '${tableName}' doesn't exist): ${sql.trim().substring(0, 60)}...`,
				);
				return;
			}
			try {
				await db.query(sql);
			} catch (err) {
				if (err.message.includes('does not exist')) {
					console.log(
						`[migration] Skipping ALTER (column doesn't exist): ${sql.trim().substring(0, 60)}...`,
					);
				} else {
					throw err;
				}
			}
		}

		// Helper to extract table name from CREATE INDEX statement
		function extractTableName(sql) {
			const match = sql.match(/ON\s+(\w+)/i);
			return match ? match[1] : null;
		}

		// Helper to run CREATE INDEX IF NOT EXISTS safely
		async function safeCreateIndex(sql) {
			const tableName = extractTableName(sql);
			if (tableName && !(await tableExists(tableName))) {
				console.log(
					`[migration] Skipping index (table '${tableName}' doesn't exist): ${sql.trim().substring(0, 60)}...`,
				);
				return;
			}
			try {
				await db.query(sql);
			} catch (err) {
				if (err.message.includes('already exists')) {
					console.log(`[migration] Index already exists, skipping`);
				} else {
					throw err;
				}
			}
		}

		// PART 1: Missing FK indexes (64 indexes)
		// PostgreSQL does NOT auto-create indexes on FK columns.
		const fkIndexes = [
			'CREATE INDEX IF NOT EXISTS idx_ai_ab_tests_prompt_id ON ai_ab_tests(prompt_id)',
			'CREATE INDEX IF NOT EXISTS idx_assessment_conversations_question_id ON assessment_conversations(question_id)',
			'CREATE INDEX IF NOT EXISTS idx_assessment_sessions_job_id ON assessment_sessions(job_id)',
			'CREATE INDEX IF NOT EXISTS idx_assessment_sessions_skill_id ON assessment_sessions(skill_id)',
			'CREATE INDEX IF NOT EXISTS idx_bias_reports_created_by ON bias_reports(created_by)',
			'CREATE INDEX IF NOT EXISTS idx_candidate_feedback_candidate_id ON candidate_feedback(candidate_id)',
			'CREATE INDEX IF NOT EXISTS idx_candidate_feedback_job_id ON candidate_feedback(job_id)',
			'CREATE INDEX IF NOT EXISTS idx_candidate_feedback_interview_id ON candidate_feedback(interview_id)',
			'CREATE INDEX IF NOT EXISTS idx_communications_recruiter_id ON communications(recruiter_id)',
			'CREATE INDEX IF NOT EXISTS idx_communications_parent_id ON communications(parent_id)',
			'CREATE INDEX IF NOT EXISTS idx_communications_job_id ON communications(job_id)',
			'CREATE INDEX IF NOT EXISTS idx_companies_owner_id ON companies(owner_id)',
			'CREATE INDEX IF NOT EXISTS idx_company_ratings_job_id ON company_ratings(job_id)',
			'CREATE INDEX IF NOT EXISTS idx_data_requests_processed_by ON data_requests(processed_by)',
			'CREATE INDEX IF NOT EXISTS idx_document_access_logs_company_id ON document_access_logs(company_id)',
			'CREATE INDEX IF NOT EXISTS idx_document_score_impacts_document_id ON document_score_impacts(document_id)',
			'CREATE INDEX IF NOT EXISTS idx_document_verifications_duplicate_of ON document_verifications(duplicate_of)',
			'CREATE INDEX IF NOT EXISTS idx_employee_benefits_employee_id ON employee_benefits(employee_id)',
			'CREATE INDEX IF NOT EXISTS idx_job_applications_company_id ON job_applications(company_id)',
			'CREATE INDEX IF NOT EXISTS idx_job_assessments_created_by ON job_assessments(created_by)',
			'CREATE INDEX IF NOT EXISTS idx_job_recommendations_job_id ON job_recommendations(job_id)',
			'CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id)',
			'CREATE INDEX IF NOT EXISTS idx_jobs_company_id ON jobs(company_id)',
			'CREATE INDEX IF NOT EXISTS idx_mutual_matches_job_id ON mutual_matches(job_id)',
			'CREATE INDEX IF NOT EXISTS idx_offers_job_id ON offers(job_id)',
			'CREATE INDEX IF NOT EXISTS idx_offers_recruiter_id ON offers(recruiter_id)',
			'CREATE INDEX IF NOT EXISTS idx_onboarding_chats_plan_id ON onboarding_chats(plan_id)',
			'CREATE INDEX IF NOT EXISTS idx_onboarding_chats_candidate_id ON onboarding_chats(candidate_id)',
			'CREATE INDEX IF NOT EXISTS idx_onboarding_chats_checklist_id ON onboarding_chats(checklist_id)',
			'CREATE INDEX IF NOT EXISTS idx_onboarding_checklists_offer_id ON onboarding_checklists(offer_id)',
			'CREATE INDEX IF NOT EXISTS idx_onboarding_documents_verified_by ON onboarding_documents(verified_by)',
			'CREATE INDEX IF NOT EXISTS idx_onboarding_documents_candidate_id ON onboarding_documents(candidate_id)',
			'CREATE INDEX IF NOT EXISTS idx_onboarding_documents_checklist_id ON onboarding_documents(checklist_id)',
			'CREATE INDEX IF NOT EXISTS idx_onboarding_documents_plan_id ON onboarding_documents(plan_id)',
			'CREATE INDEX IF NOT EXISTS idx_onboarding_plans_created_by ON onboarding_plans(created_by)',
			'CREATE INDEX IF NOT EXISTS idx_onboarding_plans_job_id ON onboarding_plans(job_id)',
			'CREATE INDEX IF NOT EXISTS idx_onboarding_plans_offer_id ON onboarding_plans(offer_id)',
			'CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_completed_by ON onboarding_tasks(completed_by)',
			'CREATE INDEX IF NOT EXISTS idx_parsed_resumes_user_id ON parsed_resumes(user_id)',
			'CREATE INDEX IF NOT EXISTS idx_paychecks_payroll_run_id ON paychecks(payroll_run_id)',
			'CREATE INDEX IF NOT EXISTS idx_payroll_runs_processed_by ON payroll_runs(processed_by)',
			'CREATE INDEX IF NOT EXISTS idx_pipeline_automation_rules_recruiter_id ON pipeline_automation_rules(recruiter_id)',
			'CREATE INDEX IF NOT EXISTS idx_portfolio_projects_user_id ON portfolio_projects(user_id)',
			'CREATE INDEX IF NOT EXISTS idx_post_hire_feedback_manager_id ON post_hire_feedback(manager_id)',
			'CREATE INDEX IF NOT EXISTS idx_recruiter_feedback_job_id ON recruiter_feedback(job_id)',
			'CREATE INDEX IF NOT EXISTS idx_saved_jobs_job_id ON saved_jobs(job_id)',
			'CREATE INDEX IF NOT EXISTS idx_score_appeals_reviewed_by ON score_appeals(reviewed_by)',
			'CREATE INDEX IF NOT EXISTS idx_screening_answers_job_id ON screening_answers(job_id)',
			'CREATE INDEX IF NOT EXISTS idx_screening_sessions_template_id ON screening_sessions(template_id)',
			'CREATE INDEX IF NOT EXISTS idx_screening_sessions_application_id ON screening_sessions(application_id)',
			'CREATE INDEX IF NOT EXISTS idx_screening_sessions_company_id ON screening_sessions(company_id)',
			'CREATE INDEX IF NOT EXISTS idx_screening_sessions_invited_by ON screening_sessions(invited_by)',
			'CREATE INDEX IF NOT EXISTS idx_screening_templates_company_id ON screening_templates(company_id)',
			'CREATE INDEX IF NOT EXISTS idx_screening_templates_created_by ON screening_templates(created_by)',
			'CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_job_id ON sequence_enrollments(job_id)',
			'CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_sequence_id ON sequence_enrollments(sequence_id)',
			'CREATE INDEX IF NOT EXISTS idx_skill_assessments_user_id ON skill_assessments(user_id)',
			'CREATE INDEX IF NOT EXISTS idx_skill_assessments_skill_id ON skill_assessments(skill_id)',
			'CREATE INDEX IF NOT EXISTS idx_skill_assessments_session_id ON skill_assessments(session_id)',
			'CREATE INDEX IF NOT EXISTS idx_tax_documents_employee_id ON tax_documents(employee_id)',
			'CREATE INDEX IF NOT EXISTS idx_tax_documents_employer_id ON tax_documents(employer_id)',
			'CREATE INDEX IF NOT EXISTS idx_trust_score_history_company_id ON trust_score_history(company_id)',
			'CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id)',
			'CREATE INDEX IF NOT EXISTS idx_verified_credentials_document_id ON verified_credentials(document_id)',
		];

		for (const sql of fkIndexes) {
			await safeCreateIndex(sql);
		}
		console.log('P3 Part 1 complete: FK indexes created');

		// PART 2: timestamptz conversions
		// These are organized by table for easier error handling
		const timestamptzConversions = [
			// agent_data
			{ table: 'agent_data', columns: ['created_at'] },
			// assessment_conversations
			{ table: 'assessment_conversations', columns: ['created_at'] },
			// assessment_events
			{ table: 'assessment_events', columns: ['timestamp'] },
			// assessment_questions
			{ table: 'assessment_questions', columns: ['created_at'] },
			// assessment_sessions
			{ table: 'assessment_sessions', columns: ['completed_at', 'created_at', 'started_at'] },
			// audit_logs
			{ table: 'audit_logs', columns: ['created_at'] },
			// bias_reports
			{ table: 'bias_reports', columns: ['created_at'] },
			// candidate_embeddings
			{ table: 'candidate_embeddings', columns: ['created_at', 'last_updated'] },
			// candidate_feedback
			{ table: 'candidate_feedback', columns: ['created_at'] },
			// candidate_onboarding_data
			{ table: 'candidate_onboarding_data', columns: ['completed_at', 'created_at', 'updated_at'] },
			// candidate_profiles
			{ table: 'candidate_profiles', columns: ['created_at', 'updated_at'] },
			// candidate_skills
			{ table: 'candidate_skills', columns: ['created_at', 'verified_at'] },
			// communication_sequences
			{ table: 'communication_sequences', columns: ['created_at', 'updated_at'] },
			// communication_templates
			{ table: 'communication_templates', columns: ['created_at', 'updated_at'] },
			// communications
			{
				table: 'communications',
				columns: ['created_at', 'read_at', 'replied_at', 'sent_at', 'updated_at'],
			},
			// companies
			{ table: 'companies', columns: ['created_at', 'updated_at', 'verified_at'] },
			// company_policies
			{ table: 'company_policies', columns: ['created_at', 'updated_at'] },
			// company_ratings
			{ table: 'company_ratings', columns: ['created_at', 'updated_at'] },
			// consent_records
			{ table: 'consent_records', columns: ['consented_at', 'created_at', 'updated_at'] },
			// country_configs
			{ table: 'country_configs', columns: ['created_at', 'updated_at'] },
			// country_document_types
			{ table: 'country_document_types', columns: ['created_at'] },
			// data_requests
			{ table: 'data_requests', columns: ['processed_at', 'requested_at'] },
			// data_retention_policies
			{ table: 'data_retention_policies', columns: ['created_at', 'updated_at'] },
			// document_access_logs
			{ table: 'document_access_logs', columns: ['accessed_at'] },
			// document_score_impacts
			{ table: 'document_score_impacts', columns: ['applied_at', 'created_at'] },
			// document_verifications
			{ table: 'document_verifications', columns: ['created_at', 'verified_at'] },
			// education
			{ table: 'education', columns: ['created_at'] },
			// employee_benefits
			{ table: 'employee_benefits', columns: ['created_at', 'updated_at'] },
			// employees
			{ table: 'employees', columns: ['created_at', 'updated_at'] },
			// events
			{ table: 'events', columns: ['created_at'] },
			// fairness_audits
			{ table: 'fairness_audits', columns: ['created_at'] },
			// job_analytics
			{ table: 'job_analytics', columns: ['created_at', 'last_view_at', 'updated_at'] },
			// job_applications
			{ table: 'job_applications', columns: ['applied_at', 'updated_at'] },
			// job_assessment_attempts
			{
				table: 'job_assessment_attempts',
				columns: ['completed_at', 'created_at', 'scored_at', 'started_at'],
			},
			// job_assessment_questions
			{ table: 'job_assessment_questions', columns: ['created_at'] },
			// job_assessments
			{ table: 'job_assessments', columns: ['created_at', 'published_at', 'updated_at'] },
			// job_embeddings
			{ table: 'job_embeddings', columns: ['created_at', 'last_updated'] },
			// job_recommendations
			{
				table: 'job_recommendations',
				columns: ['applied_at', 'clicked_at', 'created_at', 'dismissed_at', 'shown_at'],
			},
			// jobs
			{ table: 'jobs', columns: ['created_at', 'updated_at'] },
			// match_results
			{ table: 'match_results', columns: ['calculated_at'] },
			// mutual_matches
			{ table: 'mutual_matches', columns: ['calculated_at'] },
			// oauth_connections
			{ table: 'oauth_connections', columns: ['created_at', 'token_expires_at', 'updated_at'] },
			// offer_templates
			{ table: 'offer_templates', columns: ['created_at', 'updated_at'] },
			// offers
			{
				table: 'offers',
				columns: [
					'accepted_at',
					'candidate_signed_at',
					'created_at',
					'declined_at',
					'offer_letter_generated_at',
					'sent_at',
					'updated_at',
					'viewed_at',
				],
			},
			// omni_scores
			{ table: 'omni_scores', columns: ['created_at', 'last_updated'] },
			// omniscore_results
			{ table: 'omniscore_results', columns: ['assessment_date', 'created_at', 'updated_at'] },
			// onboarding_chats
			{ table: 'onboarding_chats', columns: ['last_activity', 'session_started'] },
			// onboarding_checklists
			{ table: 'onboarding_checklists', columns: ['completed_at', 'created_at', 'updated_at'] },
			// onboarding_documents
			{
				table: 'onboarding_documents',
				columns: [
					'ai_generated_at',
					'ai_processed_at',
					'created_at',
					'signed_at',
					'uploaded_at',
					'verified_at',
				],
			},
			// onboarding_plans
			{
				table: 'onboarding_plans',
				columns: ['completed_at', 'created_at', 'started_at', 'updated_at'],
			},
			// onboarding_tasks
			{ table: 'onboarding_tasks', columns: ['completed_at', 'created_at', 'updated_at'] },
			// parsed_resumes
			{ table: 'parsed_resumes', columns: ['created_at', 'parsed_at'] },
			// pay_periods
			{ table: 'pay_periods', columns: ['created_at', 'updated_at'] },
			// paychecks
			{ table: 'paychecks', columns: ['created_at', 'paid_at', 'updated_at'] },
			// payroll_configs
			{ table: 'payroll_configs', columns: ['created_at', 'updated_at'] },
			// payroll_runs
			{ table: 'payroll_runs', columns: ['created_at', 'processed_at', 'updated_at'] },
			// portfolio_projects
			{ table: 'portfolio_projects', columns: ['created_at'] },
			// post_hire_feedback
			{ table: 'post_hire_feedback', columns: ['completed_at', 'created_at', 'sent_at'] },
			// practice_sessions
			{ table: 'practice_sessions', columns: ['created_at'] },
			// question_bank
			{ table: 'question_bank', columns: ['created_at'] },
			// recruiter_feedback
			{ table: 'recruiter_feedback', columns: ['created_at'] },
			// recruiter_preferences
			{ table: 'recruiter_preferences', columns: ['created_at', 'updated_at'] },
			// refresh_tokens
			{ table: 'refresh_tokens', columns: ['created_at', 'expires_at', 'last_used_at'] },
			// role_scores
			{ table: 'role_scores', columns: ['last_updated'] },
			// saved_jobs
			{ table: 'saved_jobs', columns: ['saved_at'] },
			// scheduling_preferences
			{ table: 'scheduling_preferences', columns: ['created_at', 'updated_at'] },
			// score_appeals
			{ table: 'score_appeals', columns: ['created_at', 'reviewed_at', 'updated_at'] },
			// score_components
			{ table: 'score_components', columns: ['created_at', 'expires_at'] },
			// score_history
			{ table: 'score_history', columns: ['created_at'] },
			// screening_answers
			{ table: 'screening_answers', columns: ['created_at', 'updated_at'] },
			// screening_templates
			{ table: 'screening_templates', columns: ['created_at', 'updated_at'] },
			// sequence_enrollments
			{
				table: 'sequence_enrollments',
				columns: ['completed_at', 'enrolled_at', 'next_send_at', 'updated_at'],
			},
			// skill_assessments
			{ table: 'skill_assessments', columns: ['completed_at', 'created_at', 'started_at'] },
			// tax_documents
			{ table: 'tax_documents', columns: ['created_at', 'issued_at', 'updated_at'] },
			// trust_score_components
			{ table: 'trust_score_components', columns: ['created_at', 'expires_at'] },
			// trust_score_history
			{ table: 'trust_score_history', columns: ['created_at'] },
			// trust_scores
			{ table: 'trust_scores', columns: ['created_at', 'last_updated'] },
			// user_memory
			{
				table: 'user_memory',
				columns: ['created_at', 'expires_at', 'last_accessed', 'updated_at'],
			},
			// verification_documents
			{
				table: 'verification_documents',
				columns: ['created_at', 'processed_at', 'updated_at', 'uploaded_at', 'verified_at'],
			},
			// verified_credentials
			{ table: 'verified_credentials', columns: ['created_at', 'verified_at'] },
			// work_experience
			{ table: 'work_experience', columns: ['created_at'] },
		];

		for (const { table, columns } of timestamptzConversions) {
			if (!(await tableExists(table))) {
				console.log(`[migration] Skipping timestamptz for non-existent table: ${table}`);
				continue;
			}
			for (const col of columns) {
				await safeAlter(
					`ALTER TABLE ${table} ALTER COLUMN ${col} TYPE timestamptz USING ${col} AT TIME ZONE 'UTC'`,
				);
			}
		}
		console.log('P3 Part 2 complete: timestamptz conversions');

		// PART 3: Partial indexes for hot query paths
		const partialIndexes = [
			`CREATE INDEX IF NOT EXISTS idx_jobs_status_active ON jobs(id) WHERE status = 'active'`,
			`CREATE INDEX IF NOT EXISTS idx_job_applications_status_pipeline ON job_applications(job_id, candidate_id) WHERE status IN ('applied', 'screening', 'interviewed')`,
			`CREATE INDEX IF NOT EXISTS idx_interviews_status_pending ON interviews(user_id, job_id) WHERE status IN ('pending', 'in_progress')`,
			`CREATE INDEX IF NOT EXISTS idx_screening_sessions_status_active ON screening_sessions(candidate_id, job_id) WHERE status IN ('invited', 'started', 'in_progress')`,
			`CREATE INDEX IF NOT EXISTS idx_offers_status_pending ON offers(candidate_id) WHERE status IN ('sent', 'negotiating')`,
			`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active ON refresh_tokens(user_id) WHERE is_revoked = false`,
		];
		for (const sql of partialIndexes) {
			await safeCreateIndex(sql);
		}
		console.log('P3 Part 3 complete: partial indexes');

		// PART 4: UNIQUE constraints for 1:1 relationships
		const uniqueIndexes = [
			'CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_profiles_user_unique ON candidate_profiles(user_id)',
			'CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_embeddings_user_unique ON candidate_embeddings(user_id)',
			'CREATE UNIQUE INDEX IF NOT EXISTS idx_job_embeddings_job_unique ON job_embeddings(job_id)',
			'CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_scores_user_unique ON omni_scores(user_id)',
			'CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduling_preferences_user_unique ON scheduling_preferences(user_id)',
			'CREATE UNIQUE INDEX IF NOT EXISTS idx_omniscore_results_user_unique ON omniscore_results(user_id)',
			'CREATE UNIQUE INDEX IF NOT EXISTS idx_company_ratings_user_job_unique ON company_ratings(candidate_id, job_id)',
		];
		for (const sql of uniqueIndexes) {
			await safeCreateIndex(sql);
		}
		console.log('P3 Part 4 complete: unique constraints');

		console.log('[migration] P3 schema optimizations complete');
	},
};
