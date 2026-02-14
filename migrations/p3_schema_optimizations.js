module.exports = {
  name: 'p3_schema_optimizations',
  up: async (db) => {
    // =============================================
    // P3 SCHEMA OPTIMIZATIONS — Nice-to-have fixes
    // 64 FK indexes + ~182 timestamptz conversions +
    // 6 partial indexes + 7 unique constraints
    // =============================================

    // PART 1: Missing FK indexes (64 indexes)
    // PostgreSQL does NOT auto-create indexes on FK columns.
    // Missing FK indexes cause slow JOINs, slow cascading deletes,
    // and lock contention during parent row updates.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_ab_tests_prompt_id ON ai_ab_tests(prompt_id);
      CREATE INDEX IF NOT EXISTS idx_assessment_conversations_question_id ON assessment_conversations(question_id);
      CREATE INDEX IF NOT EXISTS idx_assessment_sessions_job_id ON assessment_sessions(job_id);
      CREATE INDEX IF NOT EXISTS idx_assessment_sessions_skill_id ON assessment_sessions(skill_id);
      CREATE INDEX IF NOT EXISTS idx_bias_reports_created_by ON bias_reports(created_by);
      CREATE INDEX IF NOT EXISTS idx_candidate_feedback_candidate_id ON candidate_feedback(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_candidate_feedback_job_id ON candidate_feedback(job_id);
      CREATE INDEX IF NOT EXISTS idx_candidate_feedback_interview_id ON candidate_feedback(interview_id);
      CREATE INDEX IF NOT EXISTS idx_communications_recruiter_id ON communications(recruiter_id);
      CREATE INDEX IF NOT EXISTS idx_communications_parent_id ON communications(parent_id);
      CREATE INDEX IF NOT EXISTS idx_communications_job_id ON communications(job_id);
      CREATE INDEX IF NOT EXISTS idx_companies_owner_id ON companies(owner_id);
      CREATE INDEX IF NOT EXISTS idx_company_ratings_job_id ON company_ratings(job_id);
      CREATE INDEX IF NOT EXISTS idx_data_requests_processed_by ON data_requests(processed_by);
      CREATE INDEX IF NOT EXISTS idx_document_access_logs_company_id ON document_access_logs(company_id);
      CREATE INDEX IF NOT EXISTS idx_document_score_impacts_document_id ON document_score_impacts(document_id);
      CREATE INDEX IF NOT EXISTS idx_document_verifications_duplicate_of ON document_verifications(duplicate_of);
      CREATE INDEX IF NOT EXISTS idx_employee_benefits_employee_id ON employee_benefits(employee_id);
      CREATE INDEX IF NOT EXISTS idx_job_applications_company_id ON job_applications(company_id);
      CREATE INDEX IF NOT EXISTS idx_job_assessments_created_by ON job_assessments(created_by);
      CREATE INDEX IF NOT EXISTS idx_job_recommendations_job_id ON job_recommendations(job_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_company_id ON jobs(company_id);
      CREATE INDEX IF NOT EXISTS idx_mutual_matches_job_id ON mutual_matches(job_id);
      CREATE INDEX IF NOT EXISTS idx_offers_job_id ON offers(job_id);
      CREATE INDEX IF NOT EXISTS idx_offers_recruiter_id ON offers(recruiter_id);
      CREATE INDEX IF NOT EXISTS idx_onboarding_chats_plan_id ON onboarding_chats(plan_id);
      CREATE INDEX IF NOT EXISTS idx_onboarding_chats_candidate_id ON onboarding_chats(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_onboarding_chats_checklist_id ON onboarding_chats(checklist_id);
      CREATE INDEX IF NOT EXISTS idx_onboarding_checklists_offer_id ON onboarding_checklists(offer_id);
      CREATE INDEX IF NOT EXISTS idx_onboarding_documents_verified_by ON onboarding_documents(verified_by);
      CREATE INDEX IF NOT EXISTS idx_onboarding_documents_candidate_id ON onboarding_documents(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_onboarding_documents_checklist_id ON onboarding_documents(checklist_id);
      CREATE INDEX IF NOT EXISTS idx_onboarding_documents_plan_id ON onboarding_documents(plan_id);
      CREATE INDEX IF NOT EXISTS idx_onboarding_plans_created_by ON onboarding_plans(created_by);
      CREATE INDEX IF NOT EXISTS idx_onboarding_plans_job_id ON onboarding_plans(job_id);
      CREATE INDEX IF NOT EXISTS idx_onboarding_plans_offer_id ON onboarding_plans(offer_id);
      CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_completed_by ON onboarding_tasks(completed_by);
      CREATE INDEX IF NOT EXISTS idx_parsed_resumes_user_id ON parsed_resumes(user_id);
      CREATE INDEX IF NOT EXISTS idx_paychecks_payroll_run_id ON paychecks(payroll_run_id);
      CREATE INDEX IF NOT EXISTS idx_payroll_runs_processed_by ON payroll_runs(processed_by);
      CREATE INDEX IF NOT EXISTS idx_pipeline_automation_rules_recruiter_id ON pipeline_automation_rules(recruiter_id);
      CREATE INDEX IF NOT EXISTS idx_portfolio_projects_user_id ON portfolio_projects(user_id);
      CREATE INDEX IF NOT EXISTS idx_post_hire_feedback_manager_id ON post_hire_feedback(manager_id);
      CREATE INDEX IF NOT EXISTS idx_recruiter_feedback_job_id ON recruiter_feedback(job_id);
      CREATE INDEX IF NOT EXISTS idx_saved_jobs_job_id ON saved_jobs(job_id);
      CREATE INDEX IF NOT EXISTS idx_score_appeals_reviewed_by ON score_appeals(reviewed_by);
      CREATE INDEX IF NOT EXISTS idx_screening_answers_job_id ON screening_answers(job_id);
      CREATE INDEX IF NOT EXISTS idx_screening_sessions_template_id ON screening_sessions(template_id);
      CREATE INDEX IF NOT EXISTS idx_screening_sessions_application_id ON screening_sessions(application_id);
      CREATE INDEX IF NOT EXISTS idx_screening_sessions_company_id ON screening_sessions(company_id);
      CREATE INDEX IF NOT EXISTS idx_screening_sessions_invited_by ON screening_sessions(invited_by);
      CREATE INDEX IF NOT EXISTS idx_screening_templates_company_id ON screening_templates(company_id);
      CREATE INDEX IF NOT EXISTS idx_screening_templates_created_by ON screening_templates(created_by);
      CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_job_id ON sequence_enrollments(job_id);
      CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_sequence_id ON sequence_enrollments(sequence_id);
      CREATE INDEX IF NOT EXISTS idx_skill_assessments_user_id ON skill_assessments(user_id);
      CREATE INDEX IF NOT EXISTS idx_skill_assessments_skill_id ON skill_assessments(skill_id);
      CREATE INDEX IF NOT EXISTS idx_skill_assessments_session_id ON skill_assessments(session_id);
      CREATE INDEX IF NOT EXISTS idx_tax_documents_employee_id ON tax_documents(employee_id);
      CREATE INDEX IF NOT EXISTS idx_tax_documents_employer_id ON tax_documents(employer_id);
      CREATE INDEX IF NOT EXISTS idx_trust_score_history_company_id ON trust_score_history(company_id);
      CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);
      CREATE INDEX IF NOT EXISTS idx_verified_credentials_document_id ON verified_credentials(document_id);
    `);
    console.log('P3 Part 1 complete: 64 FK indexes created');

    // PART 2a: Remaining timestamp -> timestamptz conversions (batch 1)
    // P1 fixed 20 columns, P2 fixed 5 in screening_sessions.
    // ~182 columns across 82 tables still use timestamp without timezone.
    // Skipping: _migrations (internal), user_sessions (session store).
    await db.query(`
      ALTER TABLE agent_data ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE assessment_conversations ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE assessment_events ALTER COLUMN timestamp TYPE timestamptz USING timestamp AT TIME ZONE 'UTC';
      ALTER TABLE assessment_questions ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE assessment_sessions ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC';
      ALTER TABLE assessment_sessions ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE assessment_sessions ALTER COLUMN started_at TYPE timestamptz USING started_at AT TIME ZONE 'UTC';
      ALTER TABLE audit_logs ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE bias_reports ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE candidate_embeddings ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE candidate_embeddings ALTER COLUMN last_updated TYPE timestamptz USING last_updated AT TIME ZONE 'UTC';
      ALTER TABLE candidate_feedback ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE candidate_onboarding_data ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC';
      ALTER TABLE candidate_onboarding_data ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE candidate_onboarding_data ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE candidate_profiles ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE candidate_profiles ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE candidate_skills ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE candidate_skills ALTER COLUMN verified_at TYPE timestamptz USING verified_at AT TIME ZONE 'UTC';
      ALTER TABLE communication_sequences ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE communication_sequences ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE communication_templates ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE communication_templates ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE communications ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE communications ALTER COLUMN read_at TYPE timestamptz USING read_at AT TIME ZONE 'UTC';
      ALTER TABLE communications ALTER COLUMN replied_at TYPE timestamptz USING replied_at AT TIME ZONE 'UTC';
      ALTER TABLE communications ALTER COLUMN sent_at TYPE timestamptz USING sent_at AT TIME ZONE 'UTC';
      ALTER TABLE communications ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE companies ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE companies ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE companies ALTER COLUMN verified_at TYPE timestamptz USING verified_at AT TIME ZONE 'UTC';
      ALTER TABLE company_policies ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE company_policies ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE company_ratings ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE company_ratings ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE consent_records ALTER COLUMN consented_at TYPE timestamptz USING consented_at AT TIME ZONE 'UTC';
      ALTER TABLE consent_records ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE consent_records ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE country_configs ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE country_configs ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE country_document_types ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE data_requests ALTER COLUMN processed_at TYPE timestamptz USING processed_at AT TIME ZONE 'UTC';
      ALTER TABLE data_requests ALTER COLUMN requested_at TYPE timestamptz USING requested_at AT TIME ZONE 'UTC';
      ALTER TABLE data_retention_policies ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE data_retention_policies ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE document_access_logs ALTER COLUMN accessed_at TYPE timestamptz USING accessed_at AT TIME ZONE 'UTC';
      ALTER TABLE document_score_impacts ALTER COLUMN applied_at TYPE timestamptz USING applied_at AT TIME ZONE 'UTC';
      ALTER TABLE document_score_impacts ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE document_verifications ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE document_verifications ALTER COLUMN verified_at TYPE timestamptz USING verified_at AT TIME ZONE 'UTC';
      ALTER TABLE education ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE employee_benefits ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE employee_benefits ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE employees ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE employees ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE events ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE fairness_audits ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
    `);
    console.log('P3 Part 2a complete: timestamptz batch 1 (57 columns)');

    // PART 2b: Remaining timestamp -> timestamptz conversions (batch 2)
    await db.query(`
      ALTER TABLE job_analytics ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE job_analytics ALTER COLUMN last_view_at TYPE timestamptz USING last_view_at AT TIME ZONE 'UTC';
      ALTER TABLE job_analytics ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE job_applications ALTER COLUMN applied_at TYPE timestamptz USING applied_at AT TIME ZONE 'UTC';
      ALTER TABLE job_applications ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE job_assessment_attempts ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC';
      ALTER TABLE job_assessment_attempts ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE job_assessment_attempts ALTER COLUMN scored_at TYPE timestamptz USING scored_at AT TIME ZONE 'UTC';
      ALTER TABLE job_assessment_attempts ALTER COLUMN started_at TYPE timestamptz USING started_at AT TIME ZONE 'UTC';
      ALTER TABLE job_assessment_questions ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE job_assessments ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE job_assessments ALTER COLUMN published_at TYPE timestamptz USING published_at AT TIME ZONE 'UTC';
      ALTER TABLE job_assessments ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE job_embeddings ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE job_embeddings ALTER COLUMN last_updated TYPE timestamptz USING last_updated AT TIME ZONE 'UTC';
      ALTER TABLE job_recommendations ALTER COLUMN applied_at TYPE timestamptz USING applied_at AT TIME ZONE 'UTC';
      ALTER TABLE job_recommendations ALTER COLUMN clicked_at TYPE timestamptz USING clicked_at AT TIME ZONE 'UTC';
      ALTER TABLE job_recommendations ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE job_recommendations ALTER COLUMN dismissed_at TYPE timestamptz USING dismissed_at AT TIME ZONE 'UTC';
      ALTER TABLE job_recommendations ALTER COLUMN shown_at TYPE timestamptz USING shown_at AT TIME ZONE 'UTC';
      ALTER TABLE jobs ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE jobs ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE match_results ALTER COLUMN calculated_at TYPE timestamptz USING calculated_at AT TIME ZONE 'UTC';
      ALTER TABLE mutual_matches ALTER COLUMN calculated_at TYPE timestamptz USING calculated_at AT TIME ZONE 'UTC';
      ALTER TABLE oauth_connections ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE oauth_connections ALTER COLUMN token_expires_at TYPE timestamptz USING token_expires_at AT TIME ZONE 'UTC';
      ALTER TABLE oauth_connections ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE offer_templates ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE offer_templates ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE offers ALTER COLUMN accepted_at TYPE timestamptz USING accepted_at AT TIME ZONE 'UTC';
      ALTER TABLE offers ALTER COLUMN candidate_signed_at TYPE timestamptz USING candidate_signed_at AT TIME ZONE 'UTC';
      ALTER TABLE offers ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE offers ALTER COLUMN declined_at TYPE timestamptz USING declined_at AT TIME ZONE 'UTC';
      ALTER TABLE offers ALTER COLUMN offer_letter_generated_at TYPE timestamptz USING offer_letter_generated_at AT TIME ZONE 'UTC';
      ALTER TABLE offers ALTER COLUMN sent_at TYPE timestamptz USING sent_at AT TIME ZONE 'UTC';
      ALTER TABLE offers ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE offers ALTER COLUMN viewed_at TYPE timestamptz USING viewed_at AT TIME ZONE 'UTC';
      ALTER TABLE omni_scores ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE omni_scores ALTER COLUMN last_updated TYPE timestamptz USING last_updated AT TIME ZONE 'UTC';
      ALTER TABLE omniscore_results ALTER COLUMN assessment_date TYPE timestamptz USING assessment_date AT TIME ZONE 'UTC';
      ALTER TABLE omniscore_results ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE omniscore_results ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE onboarding_chats ALTER COLUMN last_activity TYPE timestamptz USING last_activity AT TIME ZONE 'UTC';
      ALTER TABLE onboarding_chats ALTER COLUMN session_started TYPE timestamptz USING session_started AT TIME ZONE 'UTC';
      ALTER TABLE onboarding_checklists ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC';
      ALTER TABLE onboarding_checklists ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE onboarding_checklists ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE onboarding_documents ALTER COLUMN ai_generated_at TYPE timestamptz USING ai_generated_at AT TIME ZONE 'UTC';
      ALTER TABLE onboarding_documents ALTER COLUMN ai_processed_at TYPE timestamptz USING ai_processed_at AT TIME ZONE 'UTC';
      ALTER TABLE onboarding_documents ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE onboarding_documents ALTER COLUMN signed_at TYPE timestamptz USING signed_at AT TIME ZONE 'UTC';
      ALTER TABLE onboarding_documents ALTER COLUMN uploaded_at TYPE timestamptz USING uploaded_at AT TIME ZONE 'UTC';
      ALTER TABLE onboarding_documents ALTER COLUMN verified_at TYPE timestamptz USING verified_at AT TIME ZONE 'UTC';
      ALTER TABLE onboarding_plans ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC';
      ALTER TABLE onboarding_plans ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE onboarding_plans ALTER COLUMN started_at TYPE timestamptz USING started_at AT TIME ZONE 'UTC';
      ALTER TABLE onboarding_plans ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
    `);
    console.log('P3 Part 2b complete: timestamptz batch 2 (57 columns)');

    // PART 2c: Remaining timestamp -> timestamptz conversions (batch 3)
    await db.query(`
      ALTER TABLE onboarding_tasks ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC';
      ALTER TABLE onboarding_tasks ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE onboarding_tasks ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE parsed_resumes ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE parsed_resumes ALTER COLUMN parsed_at TYPE timestamptz USING parsed_at AT TIME ZONE 'UTC';
      ALTER TABLE pay_periods ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE pay_periods ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE paychecks ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE paychecks ALTER COLUMN paid_at TYPE timestamptz USING paid_at AT TIME ZONE 'UTC';
      ALTER TABLE paychecks ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE payroll_configs ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE payroll_configs ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE payroll_runs ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE payroll_runs ALTER COLUMN processed_at TYPE timestamptz USING processed_at AT TIME ZONE 'UTC';
      ALTER TABLE payroll_runs ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE portfolio_projects ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE post_hire_feedback ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC';
      ALTER TABLE post_hire_feedback ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE post_hire_feedback ALTER COLUMN sent_at TYPE timestamptz USING sent_at AT TIME ZONE 'UTC';
      ALTER TABLE practice_sessions ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE question_bank ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE recruiter_feedback ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE recruiter_preferences ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE recruiter_preferences ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE refresh_tokens ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE refresh_tokens ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC';
      ALTER TABLE refresh_tokens ALTER COLUMN last_used_at TYPE timestamptz USING last_used_at AT TIME ZONE 'UTC';
      ALTER TABLE role_scores ALTER COLUMN last_updated TYPE timestamptz USING last_updated AT TIME ZONE 'UTC';
      ALTER TABLE saved_jobs ALTER COLUMN saved_at TYPE timestamptz USING saved_at AT TIME ZONE 'UTC';
      ALTER TABLE scheduling_preferences ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE scheduling_preferences ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE score_appeals ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE score_appeals ALTER COLUMN reviewed_at TYPE timestamptz USING reviewed_at AT TIME ZONE 'UTC';
      ALTER TABLE score_appeals ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE score_components ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE score_components ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC';
      ALTER TABLE score_history ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE screening_answers ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE screening_answers ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE screening_templates ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE screening_templates ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE sequence_enrollments ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC';
      ALTER TABLE sequence_enrollments ALTER COLUMN enrolled_at TYPE timestamptz USING enrolled_at AT TIME ZONE 'UTC';
      ALTER TABLE sequence_enrollments ALTER COLUMN next_send_at TYPE timestamptz USING next_send_at AT TIME ZONE 'UTC';
      ALTER TABLE sequence_enrollments ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE skill_assessments ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC';
      ALTER TABLE skill_assessments ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE skill_assessments ALTER COLUMN started_at TYPE timestamptz USING started_at AT TIME ZONE 'UTC';
      ALTER TABLE tax_documents ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE tax_documents ALTER COLUMN issued_at TYPE timestamptz USING issued_at AT TIME ZONE 'UTC';
      ALTER TABLE tax_documents ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE trust_score_components ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE trust_score_components ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC';
      ALTER TABLE trust_score_history ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE trust_scores ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE trust_scores ALTER COLUMN last_updated TYPE timestamptz USING last_updated AT TIME ZONE 'UTC';
      ALTER TABLE user_memory ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE user_memory ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC';
      ALTER TABLE user_memory ALTER COLUMN last_accessed TYPE timestamptz USING last_accessed AT TIME ZONE 'UTC';
      ALTER TABLE user_memory ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE verification_documents ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE verification_documents ALTER COLUMN processed_at TYPE timestamptz USING processed_at AT TIME ZONE 'UTC';
      ALTER TABLE verification_documents ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
      ALTER TABLE verification_documents ALTER COLUMN uploaded_at TYPE timestamptz USING uploaded_at AT TIME ZONE 'UTC';
      ALTER TABLE verification_documents ALTER COLUMN verified_at TYPE timestamptz USING verified_at AT TIME ZONE 'UTC';
      ALTER TABLE verified_credentials ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      ALTER TABLE verified_credentials ALTER COLUMN verified_at TYPE timestamptz USING verified_at AT TIME ZONE 'UTC';
      ALTER TABLE work_experience ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
    `);
    console.log('P3 Part 2c complete: timestamptz batch 3 (68 columns)');

    // PART 3: Partial indexes for hot query paths
    // These accelerate common filtered queries by indexing only active/pending records
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_status_active ON jobs(id) WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS idx_job_applications_status_pipeline ON job_applications(job_id, candidate_id) WHERE status IN ('applied', 'screening', 'interviewed');
      CREATE INDEX IF NOT EXISTS idx_interviews_status_pending ON interviews(user_id, job_id) WHERE status IN ('pending', 'in_progress');
      CREATE INDEX IF NOT EXISTS idx_screening_sessions_status_active ON screening_sessions(candidate_id, job_id) WHERE status IN ('invited', 'started', 'in_progress');
      CREATE INDEX IF NOT EXISTS idx_offers_status_pending ON offers(candidate_id) WHERE status IN ('sent', 'negotiating');
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active ON refresh_tokens(user_id) WHERE is_revoked = false;
    `);
    console.log('P3 Part 3 complete: 6 partial indexes');

    // PART 4: UNIQUE constraints for 1:1 relationships
    // Verified zero duplicate rows in all target tables before adding
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_profiles_user_unique ON candidate_profiles(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_embeddings_user_unique ON candidate_embeddings(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_job_embeddings_job_unique ON job_embeddings(job_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_scores_user_unique ON omni_scores(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_recruiter_preferences_user_unique ON recruiter_preferences(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduling_preferences_user_unique ON scheduling_preferences(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_jobs_user_job_unique ON saved_jobs(user_id, job_id);
    `);
    console.log('P3 Part 4 complete: 7 unique constraints');

    console.log('=== P3 SCHEMA OPTIMIZATIONS COMPLETE ===');
    console.log('Summary: +64 FK indexes, ~182 timestamp->timestamptz, +6 partial indexes, +7 unique constraints');
  }
};
