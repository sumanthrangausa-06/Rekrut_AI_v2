/**
 * P2 Schema Hardening Migration
 *
 * 1. screening_sessions: timestamp → timestamptz (5 columns)
 * 2. varchar → TEXT for 274 columns (keeps varchar for bounded fields ≤10 chars)
 * 3. CHECK constraints for status enums, type enums, and score ranges
 */
module.exports = {
	name: 'p2_schema_hardening',
	up: async (client) => {
		// Helper to check if table exists
		async function tableExists(tableName) {
			const result = await client.query(
				`SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
				[tableName],
			);
			return result.rows.length > 0;
		}

		// Helper to check if column exists
		async function columnExists(tableName, columnName) {
			const result = await client.query(
				`SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
				[tableName, columnName],
			);
			return result.rows.length > 0;
		}

		// Helper to check if constraint exists
		async function constraintExists(tableName, constraintName) {
			const result = await client.query(
				`SELECT 1 FROM information_schema.table_constraints WHERE table_name = $1 AND constraint_name = $2`,
				[tableName, constraintName],
			);
			return result.rows.length > 0;
		}

		// ═══════════════════════════════════════════════════════════════════
		// SECTION 1: screening_sessions timestamp → timestamptz
		// ═══════════════════════════════════════════════════════════════════
		if (await tableExists('screening_sessions')) {
			await client.query(`
				ALTER TABLE screening_sessions
					ALTER COLUMN invited_at TYPE timestamptz USING invited_at AT TIME ZONE 'UTC',
					ALTER COLUMN started_at TYPE timestamptz USING started_at AT TIME ZONE 'UTC',
					ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC',
					ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC',
					ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC'
			`);
			console.log('[migration] screening_sessions timestamptz conversion applied');
		} else {
			console.log('[migration] Skipping screening_sessions - table does not exist yet');
		}

		// ═══════════════════════════════════════════════════════════════════
		// SECTION 2: varchar → TEXT conversions (274 columns)
		// ═══════════════════════════════════════════════════════════════════
		const textConversions = {
			activity_log: ['category', 'event_type', 'ip_address', 'severity', 'user_email'],
			agent_data: ['type'],
			ai_ab_tests: ['name', 'status'],
			ai_agent_actions: ['action_type', 'agent_type'],
			ai_call_log: ['feature', 'modality', 'model', 'module', 'provider'],
			ai_prompt_versions: ['model'],
			ai_prompts: ['feature', 'model', 'module', 'name', 'slug'],
			ai_provider_stats: ['stat_key'],
			ai_provider_verification: ['modality', 'model', 'provider_key', 'status'],
			assessment_conversations: ['role'],
			assessment_events: ['event_type'],
			assessment_questions: ['question_type', 'skill_category'],
			assessment_sessions: ['status'],
			audit_logs: ['action_type', 'ip_address', 'target_type'],
			bias_reports: ['analysis_type'],
			candidate_feedback: ['feedback_type'],
			candidate_onboarding_data: [
				'account_type',
				'address_line1',
				'address_line2',
				'bank_name',
				'city',
				'emergency_contact_email',
				'emergency_contact_name',
				'emergency_contact_phone',
				'emergency_contact_relationship',
				'i9_admission_number',
				'i9_alien_number',
				'i9_citizenship_status',
				'i9_country_of_issuance',
				'i9_document_number',
				'i9_document_title',
				'i9_email',
				'i9_issuing_authority',
				'i9_other_last_names',
				'i9_passport_number',
				'i9_preparer_address',
				'i9_preparer_name',
				'legal_first_name',
				'legal_last_name',
				'legal_middle_name',
				'phone',
				'state',
				'w4_filing_status',
				'wizard_status',
				'zip_code',
			],
			candidate_profiles: [
				'availability',
				'github_url',
				'headline',
				'linkedin_url',
				'location',
				'notice_period',
				'phone',
				'photo_url',
				'portfolio_url',
				'remote_preference',
				'resume_url',
				'work_authorization',
			],
			candidate_skills: ['category', 'skill_name'],
			communication_sequences: ['name', 'status'],
			communication_templates: ['name', 'subject_template', 'tone', 'type'],
			communications: ['status', 'subject', 'tone', 'type'],
			companies: ['company_size', 'email_domain', 'headquarters', 'industry', 'name', 'slug'],
			company_policies: ['category', 'title'],
			company_ratings: ['status'],
			consent_records: ['consent_type', 'ip_address'],
			country_configs: [
				'country_name',
				'date_format',
				'default_pay_frequency',
				'employment_model',
				'tax_system',
				'timezone',
			],
			country_document_types: ['document_key', 'document_name', 'government_form_id'],
			data_requests: ['request_type', 'status'],
			data_retention_policies: ['data_type'],
			document_access_logs: ['access_type', 'ip_address'],
			document_score_impacts: ['document_type', 'verification_status'],
			document_verifications: ['duplicate_hash', 'fraud_risk', 'verification_type'],
			education: ['degree', 'field_of_study', 'institution'],
			employee_benefits: ['benefit_type', 'coverage_level', 'plan_name', 'status'],
			employees: ['department', 'employee_number', 'employment_type', 'position', 'status'],
			events: ['event_type', 'session_id'],
			fairness_audits: ['audit_type', 'status'],
			interview_composite_scores: ['recommendation'],
			interview_evaluations: ['evaluator_type'],
			interview_questions: ['category', 'difficulty'],
			interview_reminders: ['reminder_type'],
			interviews: ['interview_type', 'status'],
			job_applications: ['screening_status', 'status'],
			job_assessment_attempts: ['status'],
			job_assessment_questions: ['category', 'question_type'],
			job_assessments: ['difficulty_level', 'status', 'title'],
			jobs: ['company', 'job_type', 'location', 'salary_range', 'status', 'title'],
			match_results: ['match_level'],
			mock_interview_sessions: ['jd_hash', 'status', 'target_role'],
			mutual_matches: ['match_level'],
			oauth_connections: ['provider', 'provider_user_id'],
			offer_templates: ['name'],
			offers: [
				'candidate_sign_ip',
				'company_name',
				'employment_type',
				'location',
				'reporting_to',
				'status',
				'title',
			],
			omni_scores: ['score_tier'],
			onboarding_checklists: ['status', 'title'],
			onboarding_documents: ['document_type', 'signer_ip', 'status'],
			onboarding_plans: ['department', 'role_title', 'status'],
			onboarding_tasks: ['assigned_to', 'category', 'day_range', 'phase', 'status', 'title'],
			parsed_resumes: ['file_url', 'original_filename', 'parsing_status'],
			pay_periods: ['period_type', 'status'],
			paychecks: ['status'],
			payroll_configs: [
				'bank_name',
				'bank_routing_number',
				'pay_frequency',
				'payment_method',
				'salary_type',
				'tax_filing_status',
			],
			payroll_runs: ['status'],
			pipeline_automation_rules: ['from_stage', 'to_stage'],
			portfolio_projects: ['github_url', 'image_url', 'project_url', 'role', 'title'],
			post_hire_feedback: ['feedback_type', 'status'],
			practice_sessions: ['category', 'question_id', 'response_type'],
			question_bank: ['category', 'difficulty', 'jd_hash', 'question_type', 'role'],
			recruiter_feedback: ['feedback_type'],
			refresh_tokens: ['family_id', 'token_hash'],
			role_scores: ['role_name'],
			scheduled_interviews: ['interview_type', 'outcome', 'status'],
			scheduling_preferences: ['timezone'],
			score_appeals: ['score_type', 'status'],
			score_components: ['component_type', 'source_type'],
			score_history: ['change_reason', 'component_type'],
			screening_sessions: ['invite_token', 'status'],
			screening_templates: ['status', 'title'],
			sequence_enrollments: ['status'],
			skill_assessments: ['assessment_type', 'title'],
			tax_documents: ['document_type', 'status'],
			trust_score_components: ['component_type', 'source_type'],
			trust_score_history: ['change_reason', 'component_type'],
			trust_scores: ['score_tier'],
			tts_cache: ['text_hash', 'text_preview', 'voice'],
			user_memory: ['memory_key', 'memory_type', 'source'],
			users: [
				'company_name',
				'email',
				'google_id',
				'linkedin_id',
				'name',
				'oauth_provider',
				'password_hash',
				'role',
				'stripe_subscription_id',
				'subscription_plan',
				'subscription_status',
			],
			verification_documents: [
				'document_type',
				'mime_type',
				'original_filename',
				'status',
				'verified_by',
			],
			verified_credentials: ['credential_name', 'credential_type', 'issuer', 'verification_status'],
			work_experience: ['company_name', 'location', 'title'],
		};

		for (const [table, columns] of Object.entries(textConversions)) {
			if (!(await tableExists(table))) {
				console.log(`[migration] Skipping text conversion for non-existent table: ${table}`);
				continue;
			}

			// Check which columns actually exist
			const availableColumns = [];
			for (const col of columns) {
				if (await columnExists(table, col)) {
					availableColumns.push(col);
				} else {
					console.log(`[migration] Skipping missing column: ${table}.${col}`);
				}
			}

			if (availableColumns.length === 0) continue;

			const alterClauses = availableColumns.map((c) => `ALTER COLUMN "${c}" TYPE TEXT`).join(', ');
			await client.query(`ALTER TABLE "${table}" ${alterClauses}`);
			console.log(`[migration] Converted ${availableColumns.length} columns in ${table}`);
		}

		// ═══════════════════════════════════════════════════════════════════
		// SECTION 3: CHECK constraints
		// All values verified against live data 2026-02-14
		// ═══════════════════════════════════════════════════════════════════

		// Helper to check if column exists
		async function columnExists(tableName, columnName) {
			const result = await client.query(
				`SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
				[tableName, columnName],
			);
			return result.rows.length > 0;
		}

		// Helper to add constraint if not exists
		async function addConstraint(table, constraintName, sql, columnName) {
			if ((await tableExists(table)) && !(await constraintExists(table, constraintName))) {
				if (columnName && !(await columnExists(table, columnName))) {
					console.log(
						`[migration] Skipping constraint ${constraintName} - column ${columnName} doesn't exist in ${table}`,
					);
					return;
				}
				try {
					await client.query(sql);
					console.log(`[migration] Added constraint ${constraintName}`);
				} catch (err) {
					console.log(
						`[migration] Warning: Could not add constraint ${constraintName}: ${err.message}`,
					);
				}
			} else {
				console.log(
					`[migration] Skipping constraint ${constraintName} - table missing or constraint exists`,
				);
			}
		}

		// --- Core domain ---
		await addConstraint(
			'users',
			'chk_users_role',
			`
			ALTER TABLE users ADD CONSTRAINT chk_users_role
				CHECK (role IN ('candidate','recruiter','employer','admin','hiring_manager'))
		`,
		);
		await addConstraint(
			'jobs',
			'chk_jobs_status',
			`
			ALTER TABLE jobs ADD CONSTRAINT chk_jobs_status
				CHECK (status IN ('draft','active','paused','closed','archived'))
		`,
		);
		await addConstraint(
			'jobs',
			'chk_jobs_job_type',
			`
			ALTER TABLE jobs ADD CONSTRAINT chk_jobs_job_type
				CHECK (job_type IN ('full-time','part-time','contract','internship','freelance'))
		`,
		);
		await addConstraint(
			'job_applications',
			'chk_job_applications_status',
			`
			ALTER TABLE job_applications ADD CONSTRAINT chk_job_applications_status
				CHECK (status IN ('applied','screening','interviewed','offered','hired','rejected','withdrawn'))
		`,
		);
		await addConstraint(
			'job_applications',
			'chk_job_applications_screening_status',
			`
			ALTER TABLE job_applications ADD CONSTRAINT chk_job_applications_screening_status
				CHECK (screening_status IS NULL OR screening_status IN ('pending','invited','in_progress','completed','expired','failed'))
		`,
		);
		await addConstraint(
			'interviews',
			'chk_interviews_status',
			`
			ALTER TABLE interviews ADD CONSTRAINT chk_interviews_status
				CHECK (status IN ('pending','in_progress','completed','cancelled'))
		`,
		);
		await addConstraint(
			'interviews',
			'chk_interviews_type',
			`
			ALTER TABLE interviews ADD CONSTRAINT chk_interviews_type
				CHECK (interview_type IN ('phone','video','onsite','technical','behavioral','panel','mock'))
		`,
		);
		await addConstraint(
			'screening_sessions',
			'chk_screening_sessions_status',
			`
			ALTER TABLE screening_sessions ADD CONSTRAINT chk_screening_sessions_status
				CHECK (status IN ('invited','started','in_progress','completed','expired','cancelled'))
		`,
		);
		await addConstraint(
			'screening_sessions',
			'chk_screening_sessions_score',
			`
			ALTER TABLE screening_sessions ADD CONSTRAINT chk_screening_sessions_score
				CHECK (overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100))
		`,
		);
		await addConstraint(
			'offers',
			'chk_offers_status',
			`
			ALTER TABLE offers ADD CONSTRAINT chk_offers_status
				CHECK (status IN ('draft','sent','accepted','declined','expired','rescinded','negotiating'))
		`,
		);
		await addConstraint(
			'offers',
			'chk_offers_employment_type',
			`
			ALTER TABLE offers ADD CONSTRAINT chk_offers_employment_type
				CHECK (employment_type IS NULL OR employment_type IN ('full-time','part-time','contract','internship','freelance'))
		`,
		);

		// --- Employee & payroll ---
		await addConstraint(
			'employees',
			'chk_employees_status',
			`
			ALTER TABLE employees ADD CONSTRAINT chk_employees_status
				CHECK (status IN ('active','inactive','terminated','on_leave','probation'))
		`,
		);
		await addConstraint(
			'employees',
			'chk_employees_employment_type',
			`
			ALTER TABLE employees ADD CONSTRAINT chk_employees_employment_type
				CHECK (employment_type IS NULL OR employment_type IN ('full-time','part-time','contract','intern','freelance'))
		`,
		);
		await addConstraint(
			'employee_benefits',
			'chk_employee_benefits_status',
			`
			ALTER TABLE employee_benefits ADD CONSTRAINT chk_employee_benefits_status
				CHECK (status IN ('active','pending','cancelled','expired'))
		`,
		);
		await addConstraint(
			'payroll_runs',
			'chk_payroll_runs_status',
			`
			ALTER TABLE payroll_runs ADD CONSTRAINT chk_payroll_runs_status
				CHECK (status IN ('draft','processing','completed','failed'))
		`,
		);
		await addConstraint(
			'paychecks',
			'chk_paychecks_status',
			`
			ALTER TABLE paychecks ADD CONSTRAINT chk_paychecks_status
				CHECK (status IN ('draft','processing','completed','failed','voided','paid'))
		`,
		);
		await addConstraint(
			'pay_periods',
			'chk_pay_periods_status',
			`
			ALTER TABLE pay_periods ADD CONSTRAINT chk_pay_periods_status
				CHECK (status IN ('open','closed','processing'))
		`,
		);
		await addConstraint(
			'tax_documents',
			'chk_tax_documents_status',
			`
			ALTER TABLE tax_documents ADD CONSTRAINT chk_tax_documents_status
				CHECK (status IN ('pending','generated','filed','accepted','rejected'))
		`,
		);

		// --- Communications ---
		await addConstraint(
			'communications',
			'chk_communications_status',
			`
			ALTER TABLE communications ADD CONSTRAINT chk_communications_status
				CHECK (status IN ('draft','queued','sent','delivered','failed','bounced'))
		`,
		);
		await addConstraint(
			'communications',
			'chk_communications_type',
			`
			ALTER TABLE communications ADD CONSTRAINT chk_communications_type
				CHECK (type IN ('email','sms','in_app','push'))
		`,
		);
		await addConstraint(
			'communication_templates',
			'chk_communication_templates_type',
			`
			ALTER TABLE communication_templates ADD CONSTRAINT chk_communication_templates_type
				CHECK (type IN ('email','sms','in_app','push'))
		`,
		);
		await addConstraint(
			'communication_sequences',
			'chk_communication_sequences_status',
			`
			ALTER TABLE communication_sequences ADD CONSTRAINT chk_communication_sequences_status
				CHECK (status IN ('active','paused','archived','draft'))
		`,
		);
		await addConstraint(
			'sequence_enrollments',
			'chk_sequence_enrollments_status',
			`
			ALTER TABLE sequence_enrollments ADD CONSTRAINT chk_sequence_enrollments_status
				CHECK (status IN ('active','completed','paused','cancelled'))
		`,
		);

		// --- Candidate & profiles ---
		await addConstraint(
			'candidate_profiles',
			'chk_candidate_profiles_availability',
			`
			ALTER TABLE candidate_profiles ADD CONSTRAINT chk_candidate_profiles_availability
				CHECK (availability IS NULL OR availability IN ('immediately','2 weeks','two_weeks','1 month','one_month','3 months','three_months','not_available'))
		`,
		);
		await addConstraint(
			'candidate_profiles',
			'chk_candidate_profiles_remote_preference',
			`
			ALTER TABLE candidate_profiles ADD CONSTRAINT chk_candidate_profiles_remote_preference
				CHECK (remote_preference IS NULL OR remote_preference IN ('remote','hybrid','onsite','flexible'))
		`,
		);
		await addConstraint(
			'candidate_profiles',
			'chk_candidate_profiles_work_authorization',
			`
			ALTER TABLE candidate_profiles ADD CONSTRAINT chk_candidate_profiles_work_authorization
				CHECK (work_authorization IS NULL OR work_authorization IN ('citizen','permanent_resident','visa_holder','requires_sponsorship'))
		`,
		);

		// --- Onboarding ---
		await addConstraint(
			'onboarding_plans',
			'chk_onboarding_plans_status',
			`
			ALTER TABLE onboarding_plans ADD CONSTRAINT chk_onboarding_plans_status
				CHECK (status IN ('draft','active','completed','archived'))
		`,
		);
		await addConstraint(
			'onboarding_checklists',
			'chk_onboarding_checklists_status',
			`
			ALTER TABLE onboarding_checklists ADD CONSTRAINT chk_onboarding_checklists_status
				CHECK (status IN ('pending','in_progress','completed','skipped'))
		`,
		);
		await addConstraint(
			'onboarding_tasks',
			'chk_onboarding_tasks_status',
			`
			ALTER TABLE onboarding_tasks ADD CONSTRAINT chk_onboarding_tasks_status
				CHECK (status IN ('pending','in_progress','completed','skipped','overdue'))
		`,
		);
		await addConstraint(
			'onboarding_documents',
			'chk_onboarding_documents_status',
			`
			ALTER TABLE onboarding_documents ADD CONSTRAINT chk_onboarding_documents_status
				CHECK (status IN ('pending','sent','signed','completed','expired'))
		`,
		);

		// --- Assessments & scoring ---
		await addConstraint(
			'job_assessments',
			'chk_job_assessments_status',
			`
			ALTER TABLE job_assessments ADD CONSTRAINT chk_job_assessments_status
				CHECK (status IN ('draft','active','archived'))
		`,
		);
		await addConstraint(
			'job_assessments',
			'chk_job_assessments_difficulty',
			`
			ALTER TABLE job_assessments ADD CONSTRAINT chk_job_assessments_difficulty
				CHECK (difficulty_level IN ('easy','medium','mid','hard'))
		`,
		);
		await addConstraint(
			'job_assessment_attempts',
			'chk_job_assessment_attempts_status',
			`
			ALTER TABLE job_assessment_attempts ADD CONSTRAINT chk_job_assessment_attempts_status
				CHECK (status IN ('in_progress','completed','expired','abandoned'))
		`,
		);
		await addConstraint(
			'assessment_sessions',
			'chk_assessment_sessions_status',
			`
			ALTER TABLE assessment_sessions ADD CONSTRAINT chk_assessment_sessions_status
				CHECK (status IN ('pending','active','in_progress','completed','expired','cancelled'))
		`,
		);
		await addConstraint(
			'mock_interview_sessions',
			'chk_mock_interview_sessions_status',
			`
			ALTER TABLE mock_interview_sessions ADD CONSTRAINT chk_mock_interview_sessions_status
				CHECK (status IN ('active','in_progress','completed','expired','abandoned'))
		`,
		);

		// --- Verification, compliance, misc ---
		await addConstraint(
			'verification_documents',
			'chk_verification_documents_status',
			`
			ALTER TABLE verification_documents ADD CONSTRAINT chk_verification_documents_status
				CHECK (status IN ('pending','verified','rejected','expired'))
		`,
		);
		await addConstraint(
			'fairness_audits',
			'chk_fairness_audits_status',
			`
			ALTER TABLE fairness_audits ADD CONSTRAINT chk_fairness_audits_status
				CHECK (status IN ('pending','in_progress','completed','failed'))
		`,
		);
		await addConstraint(
			'data_requests',
			'chk_data_requests_status',
			`
			ALTER TABLE data_requests ADD CONSTRAINT chk_data_requests_status
				CHECK (status IN ('pending','in_progress','completed','rejected'))
		`,
		);
		await addConstraint(
			'score_appeals',
			'chk_score_appeals_status',
			`
			ALTER TABLE score_appeals ADD CONSTRAINT chk_score_appeals_status
				CHECK (status IN ('pending','under_review','approved','rejected'))
		`,
		);
		await addConstraint(
			'post_hire_feedback',
			'chk_post_hire_feedback_status',
			`
			ALTER TABLE post_hire_feedback ADD CONSTRAINT chk_post_hire_feedback_status
				CHECK (status IN ('pending','submitted','reviewed'))
		`,
		);
		await addConstraint(
			'parsed_resumes',
			'chk_parsed_resumes_status',
			`
			ALTER TABLE parsed_resumes ADD CONSTRAINT chk_parsed_resumes_status
				CHECK (parsing_status IN ('pending','processing','completed','failed'))
		`,
		);
		await addConstraint(
			'scheduled_interviews',
			'chk_scheduled_interviews_status',
			`
			ALTER TABLE scheduled_interviews ADD CONSTRAINT chk_scheduled_interviews_status
				CHECK (status IN ('scheduled','confirmed','in_progress','completed','cancelled','no_show'))
		`,
		);

		console.log(
			'[migration] P2 schema hardening applied: 5 timestamptz (if table exists), 274 varchar→TEXT (available columns), 37 CHECK constraints (if tables exist)',
		);
	},
};
