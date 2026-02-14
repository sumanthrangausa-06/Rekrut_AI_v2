-- P2 Schema Hardening Migration
-- Fixes: CHECK constraints, varchar→text conversions, screening_sessions timestamptz
-- Date: 2026-02-14
-- Pre-condition: P0 (FK fixes) and P1 (interview flow) already applied

-- ============================================================
-- SECTION 1: screening_sessions timestamp → timestamptz
-- ============================================================
ALTER TABLE screening_sessions ALTER COLUMN invited_at TYPE timestamptz USING invited_at AT TIME ZONE 'UTC';
ALTER TABLE screening_sessions ALTER COLUMN started_at TYPE timestamptz USING started_at AT TIME ZONE 'UTC';
ALTER TABLE screening_sessions ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC';
ALTER TABLE screening_sessions ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC';
ALTER TABLE screening_sessions ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

-- ============================================================
-- SECTION 2: varchar → TEXT conversions
-- PostgreSQL metadata-only change — no table rewrite needed
-- Keeping varchar for truly bounded: country_code(2), currency_code(3),
-- currency_symbol(5), bank_account_last4(4), date(10), winner(10)
-- ============================================================

-- _migrations
ALTER TABLE _migrations ALTER COLUMN name TYPE text;

-- activity_log
ALTER TABLE activity_log ALTER COLUMN category TYPE text;
ALTER TABLE activity_log ALTER COLUMN event_type TYPE text;
ALTER TABLE activity_log ALTER COLUMN ip_address TYPE text;
ALTER TABLE activity_log ALTER COLUMN severity TYPE text;
ALTER TABLE activity_log ALTER COLUMN user_email TYPE text;

-- agent_data
ALTER TABLE agent_data ALTER COLUMN type TYPE text;

-- ai_ab_tests
ALTER TABLE ai_ab_tests ALTER COLUMN name TYPE text;
ALTER TABLE ai_ab_tests ALTER COLUMN status TYPE text;

-- ai_agent_actions
ALTER TABLE ai_agent_actions ALTER COLUMN action_type TYPE text;
ALTER TABLE ai_agent_actions ALTER COLUMN agent_type TYPE text;

-- ai_call_log
ALTER TABLE ai_call_log ALTER COLUMN feature TYPE text;
ALTER TABLE ai_call_log ALTER COLUMN modality TYPE text;
ALTER TABLE ai_call_log ALTER COLUMN model TYPE text;
ALTER TABLE ai_call_log ALTER COLUMN module TYPE text;
ALTER TABLE ai_call_log ALTER COLUMN provider TYPE text;

-- ai_prompt_versions
ALTER TABLE ai_prompt_versions ALTER COLUMN model TYPE text;

-- ai_prompts
ALTER TABLE ai_prompts ALTER COLUMN feature TYPE text;
ALTER TABLE ai_prompts ALTER COLUMN model TYPE text;
ALTER TABLE ai_prompts ALTER COLUMN module TYPE text;
ALTER TABLE ai_prompts ALTER COLUMN name TYPE text;
ALTER TABLE ai_prompts ALTER COLUMN slug TYPE text;

-- ai_provider_stats
ALTER TABLE ai_provider_stats ALTER COLUMN stat_key TYPE text;

-- ai_provider_verification
ALTER TABLE ai_provider_verification ALTER COLUMN modality TYPE text;
ALTER TABLE ai_provider_verification ALTER COLUMN model TYPE text;
ALTER TABLE ai_provider_verification ALTER COLUMN provider_key TYPE text;
ALTER TABLE ai_provider_verification ALTER COLUMN status TYPE text;

-- assessment_conversations
ALTER TABLE assessment_conversations ALTER COLUMN role TYPE text;

-- assessment_events
ALTER TABLE assessment_events ALTER COLUMN event_type TYPE text;

-- assessment_questions
ALTER TABLE assessment_questions ALTER COLUMN question_type TYPE text;
ALTER TABLE assessment_questions ALTER COLUMN skill_category TYPE text;

-- assessment_sessions
ALTER TABLE assessment_sessions ALTER COLUMN status TYPE text;

-- audit_logs
ALTER TABLE audit_logs ALTER COLUMN action_type TYPE text;
ALTER TABLE audit_logs ALTER COLUMN ip_address TYPE text;
ALTER TABLE audit_logs ALTER COLUMN target_type TYPE text;

-- bias_reports
ALTER TABLE bias_reports ALTER COLUMN analysis_type TYPE text;

-- candidate_feedback
ALTER TABLE candidate_feedback ALTER COLUMN feedback_type TYPE text;

-- candidate_onboarding_data
ALTER TABLE candidate_onboarding_data ALTER COLUMN account_type TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN address_line1 TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN address_line2 TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN bank_name TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN city TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN emergency_contact_email TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN emergency_contact_name TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN emergency_contact_phone TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN emergency_contact_relationship TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_admission_number TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_alien_number TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_citizenship_status TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_country_of_issuance TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_document_number TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_document_title TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_email TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_issuing_authority TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_other_last_names TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_passport_number TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_preparer_address TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_preparer_name TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN legal_first_name TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN legal_last_name TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN legal_middle_name TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN phone TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN state TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN w4_filing_status TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN wizard_status TYPE text;
ALTER TABLE candidate_onboarding_data ALTER COLUMN zip_code TYPE text;

-- candidate_profiles
ALTER TABLE candidate_profiles ALTER COLUMN availability TYPE text;
ALTER TABLE candidate_profiles ALTER COLUMN github_url TYPE text;
ALTER TABLE candidate_profiles ALTER COLUMN headline TYPE text;
ALTER TABLE candidate_profiles ALTER COLUMN linkedin_url TYPE text;
ALTER TABLE candidate_profiles ALTER COLUMN location TYPE text;
ALTER TABLE candidate_profiles ALTER COLUMN notice_period TYPE text;
ALTER TABLE candidate_profiles ALTER COLUMN phone TYPE text;
ALTER TABLE candidate_profiles ALTER COLUMN photo_url TYPE text;
ALTER TABLE candidate_profiles ALTER COLUMN portfolio_url TYPE text;
ALTER TABLE candidate_profiles ALTER COLUMN remote_preference TYPE text;
ALTER TABLE candidate_profiles ALTER COLUMN resume_url TYPE text;
ALTER TABLE candidate_profiles ALTER COLUMN work_authorization TYPE text;

-- candidate_skills
ALTER TABLE candidate_skills ALTER COLUMN category TYPE text;
ALTER TABLE candidate_skills ALTER COLUMN skill_name TYPE text;

-- communication_sequences
ALTER TABLE communication_sequences ALTER COLUMN name TYPE text;
ALTER TABLE communication_sequences ALTER COLUMN status TYPE text;

-- communication_templates
ALTER TABLE communication_templates ALTER COLUMN name TYPE text;
ALTER TABLE communication_templates ALTER COLUMN subject_template TYPE text;
ALTER TABLE communication_templates ALTER COLUMN tone TYPE text;
ALTER TABLE communication_templates ALTER COLUMN type TYPE text;

-- communications
ALTER TABLE communications ALTER COLUMN status TYPE text;
ALTER TABLE communications ALTER COLUMN subject TYPE text;
ALTER TABLE communications ALTER COLUMN tone TYPE text;
ALTER TABLE communications ALTER COLUMN type TYPE text;

-- companies
ALTER TABLE companies ALTER COLUMN company_size TYPE text;
ALTER TABLE companies ALTER COLUMN email_domain TYPE text;
ALTER TABLE companies ALTER COLUMN headquarters TYPE text;
ALTER TABLE companies ALTER COLUMN industry TYPE text;
ALTER TABLE companies ALTER COLUMN name TYPE text;
ALTER TABLE companies ALTER COLUMN slug TYPE text;

-- company_policies
ALTER TABLE company_policies ALTER COLUMN category TYPE text;
ALTER TABLE company_policies ALTER COLUMN title TYPE text;

-- company_ratings
ALTER TABLE company_ratings ALTER COLUMN status TYPE text;

-- consent_records
ALTER TABLE consent_records ALTER COLUMN consent_type TYPE text;
ALTER TABLE consent_records ALTER COLUMN ip_address TYPE text;

-- country_configs (keep country_code, currency_code, currency_symbol as varchar)
ALTER TABLE country_configs ALTER COLUMN country_name TYPE text;
ALTER TABLE country_configs ALTER COLUMN date_format TYPE text;
ALTER TABLE country_configs ALTER COLUMN default_pay_frequency TYPE text;
ALTER TABLE country_configs ALTER COLUMN employment_model TYPE text;
ALTER TABLE country_configs ALTER COLUMN tax_system TYPE text;
ALTER TABLE country_configs ALTER COLUMN timezone TYPE text;

-- country_document_types (keep country_code as varchar)
ALTER TABLE country_document_types ALTER COLUMN document_key TYPE text;
ALTER TABLE country_document_types ALTER COLUMN document_name TYPE text;
ALTER TABLE country_document_types ALTER COLUMN government_form_id TYPE text;

-- data_requests
ALTER TABLE data_requests ALTER COLUMN request_type TYPE text;
ALTER TABLE data_requests ALTER COLUMN status TYPE text;

-- data_retention_policies
ALTER TABLE data_retention_policies ALTER COLUMN data_type TYPE text;

-- document_access_logs
ALTER TABLE document_access_logs ALTER COLUMN access_type TYPE text;
ALTER TABLE document_access_logs ALTER COLUMN ip_address TYPE text;

-- document_score_impacts
ALTER TABLE document_score_impacts ALTER COLUMN document_type TYPE text;
ALTER TABLE document_score_impacts ALTER COLUMN verification_status TYPE text;

-- document_verifications
ALTER TABLE document_verifications ALTER COLUMN duplicate_hash TYPE text;
ALTER TABLE document_verifications ALTER COLUMN fraud_risk TYPE text;
ALTER TABLE document_verifications ALTER COLUMN verification_type TYPE text;

-- education
ALTER TABLE education ALTER COLUMN degree TYPE text;
ALTER TABLE education ALTER COLUMN field_of_study TYPE text;
ALTER TABLE education ALTER COLUMN institution TYPE text;

-- employee_benefits
ALTER TABLE employee_benefits ALTER COLUMN benefit_type TYPE text;
ALTER TABLE employee_benefits ALTER COLUMN coverage_level TYPE text;
ALTER TABLE employee_benefits ALTER COLUMN plan_name TYPE text;
ALTER TABLE employee_benefits ALTER COLUMN status TYPE text;

-- employees (keep country_code, currency_code as varchar)
ALTER TABLE employees ALTER COLUMN department TYPE text;
ALTER TABLE employees ALTER COLUMN employee_number TYPE text;
ALTER TABLE employees ALTER COLUMN employment_type TYPE text;
ALTER TABLE employees ALTER COLUMN position TYPE text;
ALTER TABLE employees ALTER COLUMN status TYPE text;

-- events
ALTER TABLE events ALTER COLUMN event_type TYPE text;
ALTER TABLE events ALTER COLUMN session_id TYPE text;

-- fairness_audits
ALTER TABLE fairness_audits ALTER COLUMN audit_type TYPE text;
ALTER TABLE fairness_audits ALTER COLUMN status TYPE text;

-- interview_composite_scores
ALTER TABLE interview_composite_scores ALTER COLUMN recommendation TYPE text;

-- interview_evaluations
ALTER TABLE interview_evaluations ALTER COLUMN evaluator_type TYPE text;

-- interview_questions
ALTER TABLE interview_questions ALTER COLUMN category TYPE text;
ALTER TABLE interview_questions ALTER COLUMN difficulty TYPE text;

-- interview_reminders
ALTER TABLE interview_reminders ALTER COLUMN reminder_type TYPE text;

-- interviews
ALTER TABLE interviews ALTER COLUMN interview_type TYPE text;
ALTER TABLE interviews ALTER COLUMN status TYPE text;

-- job_applications
ALTER TABLE job_applications ALTER COLUMN screening_status TYPE text;
ALTER TABLE job_applications ALTER COLUMN status TYPE text;

-- job_assessment_attempts
ALTER TABLE job_assessment_attempts ALTER COLUMN status TYPE text;

-- job_assessment_questions
ALTER TABLE job_assessment_questions ALTER COLUMN category TYPE text;
ALTER TABLE job_assessment_questions ALTER COLUMN question_type TYPE text;

-- job_assessments
ALTER TABLE job_assessments ALTER COLUMN difficulty_level TYPE text;
ALTER TABLE job_assessments ALTER COLUMN status TYPE text;
ALTER TABLE job_assessments ALTER COLUMN title TYPE text;

-- jobs (keep country_code, currency_code as varchar)
ALTER TABLE jobs ALTER COLUMN company TYPE text;
ALTER TABLE jobs ALTER COLUMN job_type TYPE text;
ALTER TABLE jobs ALTER COLUMN location TYPE text;
ALTER TABLE jobs ALTER COLUMN salary_range TYPE text;
ALTER TABLE jobs ALTER COLUMN status TYPE text;
ALTER TABLE jobs ALTER COLUMN title TYPE text;

-- match_results
ALTER TABLE match_results ALTER COLUMN match_level TYPE text;

-- mock_interview_sessions
ALTER TABLE mock_interview_sessions ALTER COLUMN jd_hash TYPE text;
ALTER TABLE mock_interview_sessions ALTER COLUMN status TYPE text;
ALTER TABLE mock_interview_sessions ALTER COLUMN target_role TYPE text;

-- mutual_matches
ALTER TABLE mutual_matches ALTER COLUMN match_level TYPE text;

-- oauth_connections
ALTER TABLE oauth_connections ALTER COLUMN provider TYPE text;
ALTER TABLE oauth_connections ALTER COLUMN provider_user_id TYPE text;

-- offer_templates
ALTER TABLE offer_templates ALTER COLUMN name TYPE text;

-- offers (keep country_code, currency_code as varchar)
ALTER TABLE offers ALTER COLUMN candidate_sign_ip TYPE text;
ALTER TABLE offers ALTER COLUMN company_name TYPE text;
ALTER TABLE offers ALTER COLUMN employment_type TYPE text;
ALTER TABLE offers ALTER COLUMN location TYPE text;
ALTER TABLE offers ALTER COLUMN reporting_to TYPE text;
ALTER TABLE offers ALTER COLUMN status TYPE text;
ALTER TABLE offers ALTER COLUMN title TYPE text;

-- omni_scores
ALTER TABLE omni_scores ALTER COLUMN score_tier TYPE text;

-- onboarding_checklists
ALTER TABLE onboarding_checklists ALTER COLUMN status TYPE text;
ALTER TABLE onboarding_checklists ALTER COLUMN title TYPE text;

-- onboarding_documents
ALTER TABLE onboarding_documents ALTER COLUMN document_type TYPE text;
ALTER TABLE onboarding_documents ALTER COLUMN signer_ip TYPE text;
ALTER TABLE onboarding_documents ALTER COLUMN status TYPE text;

-- onboarding_plans
ALTER TABLE onboarding_plans ALTER COLUMN department TYPE text;
ALTER TABLE onboarding_plans ALTER COLUMN role_title TYPE text;
ALTER TABLE onboarding_plans ALTER COLUMN status TYPE text;

-- onboarding_tasks
ALTER TABLE onboarding_tasks ALTER COLUMN assigned_to TYPE text;
ALTER TABLE onboarding_tasks ALTER COLUMN category TYPE text;
ALTER TABLE onboarding_tasks ALTER COLUMN day_range TYPE text;
ALTER TABLE onboarding_tasks ALTER COLUMN phase TYPE text;
ALTER TABLE onboarding_tasks ALTER COLUMN status TYPE text;
ALTER TABLE onboarding_tasks ALTER COLUMN title TYPE text;

-- parsed_resumes
ALTER TABLE parsed_resumes ALTER COLUMN file_url TYPE text;
ALTER TABLE parsed_resumes ALTER COLUMN original_filename TYPE text;
ALTER TABLE parsed_resumes ALTER COLUMN parsing_status TYPE text;

-- pay_periods (keep country_code as varchar)
ALTER TABLE pay_periods ALTER COLUMN period_type TYPE text;
ALTER TABLE pay_periods ALTER COLUMN status TYPE text;

-- paychecks (keep country_code, currency_code as varchar)
ALTER TABLE paychecks ALTER COLUMN status TYPE text;

-- payroll_configs (keep country_code, currency_code, bank_account_last4 as varchar)
ALTER TABLE payroll_configs ALTER COLUMN bank_name TYPE text;
ALTER TABLE payroll_configs ALTER COLUMN bank_routing_number TYPE text;
ALTER TABLE payroll_configs ALTER COLUMN pay_frequency TYPE text;
ALTER TABLE payroll_configs ALTER COLUMN payment_method TYPE text;
ALTER TABLE payroll_configs ALTER COLUMN salary_type TYPE text;
ALTER TABLE payroll_configs ALTER COLUMN tax_filing_status TYPE text;

-- payroll_runs (keep country_code, currency_code, currency_symbol as varchar)
ALTER TABLE payroll_runs ALTER COLUMN status TYPE text;

-- pipeline_automation_rules
ALTER TABLE pipeline_automation_rules ALTER COLUMN from_stage TYPE text;
ALTER TABLE pipeline_automation_rules ALTER COLUMN to_stage TYPE text;

-- portfolio_projects
ALTER TABLE portfolio_projects ALTER COLUMN github_url TYPE text;
ALTER TABLE portfolio_projects ALTER COLUMN image_url TYPE text;
ALTER TABLE portfolio_projects ALTER COLUMN project_url TYPE text;
ALTER TABLE portfolio_projects ALTER COLUMN role TYPE text;
ALTER TABLE portfolio_projects ALTER COLUMN title TYPE text;

-- post_hire_feedback
ALTER TABLE post_hire_feedback ALTER COLUMN feedback_type TYPE text;
ALTER TABLE post_hire_feedback ALTER COLUMN status TYPE text;

-- practice_sessions
ALTER TABLE practice_sessions ALTER COLUMN category TYPE text;
ALTER TABLE practice_sessions ALTER COLUMN question_id TYPE text;
ALTER TABLE practice_sessions ALTER COLUMN response_type TYPE text;

-- question_bank
ALTER TABLE question_bank ALTER COLUMN category TYPE text;
ALTER TABLE question_bank ALTER COLUMN difficulty TYPE text;
ALTER TABLE question_bank ALTER COLUMN jd_hash TYPE text;
ALTER TABLE question_bank ALTER COLUMN question_type TYPE text;
ALTER TABLE question_bank ALTER COLUMN role TYPE text;

-- recruiter_feedback
ALTER TABLE recruiter_feedback ALTER COLUMN feedback_type TYPE text;

-- refresh_tokens
ALTER TABLE refresh_tokens ALTER COLUMN family_id TYPE text;
ALTER TABLE refresh_tokens ALTER COLUMN token_hash TYPE text;

-- role_scores
ALTER TABLE role_scores ALTER COLUMN role_name TYPE text;

-- scheduled_interviews
ALTER TABLE scheduled_interviews ALTER COLUMN interview_type TYPE text;
ALTER TABLE scheduled_interviews ALTER COLUMN outcome TYPE text;
ALTER TABLE scheduled_interviews ALTER COLUMN status TYPE text;
ALTER TABLE scheduled_interviews ALTER COLUMN timezone TYPE text;

-- scheduling_preferences
ALTER TABLE scheduling_preferences ALTER COLUMN timezone TYPE text;

-- score_appeals
ALTER TABLE score_appeals ALTER COLUMN score_type TYPE text;
ALTER TABLE score_appeals ALTER COLUMN status TYPE text;

-- score_components
ALTER TABLE score_components ALTER COLUMN component_type TYPE text;
ALTER TABLE score_components ALTER COLUMN source_type TYPE text;

-- score_history
ALTER TABLE score_history ALTER COLUMN change_reason TYPE text;
ALTER TABLE score_history ALTER COLUMN component_type TYPE text;

-- screening_sessions
ALTER TABLE screening_sessions ALTER COLUMN invite_token TYPE text;
ALTER TABLE screening_sessions ALTER COLUMN status TYPE text;

-- screening_templates
ALTER TABLE screening_templates ALTER COLUMN status TYPE text;
ALTER TABLE screening_templates ALTER COLUMN title TYPE text;

-- sequence_enrollments
ALTER TABLE sequence_enrollments ALTER COLUMN status TYPE text;

-- skill_assessments
ALTER TABLE skill_assessments ALTER COLUMN assessment_type TYPE text;
ALTER TABLE skill_assessments ALTER COLUMN title TYPE text;

-- tax_documents
ALTER TABLE tax_documents ALTER COLUMN document_type TYPE text;
ALTER TABLE tax_documents ALTER COLUMN status TYPE text;

-- trust_score_components
ALTER TABLE trust_score_components ALTER COLUMN component_type TYPE text;
ALTER TABLE trust_score_components ALTER COLUMN source_type TYPE text;

-- trust_score_history
ALTER TABLE trust_score_history ALTER COLUMN change_reason TYPE text;
ALTER TABLE trust_score_history ALTER COLUMN component_type TYPE text;

-- trust_scores
ALTER TABLE trust_scores ALTER COLUMN score_tier TYPE text;

-- tts_cache
ALTER TABLE tts_cache ALTER COLUMN text_hash TYPE text;
ALTER TABLE tts_cache ALTER COLUMN text_preview TYPE text;
ALTER TABLE tts_cache ALTER COLUMN voice TYPE text;

-- user_memory
ALTER TABLE user_memory ALTER COLUMN memory_key TYPE text;
ALTER TABLE user_memory ALTER COLUMN memory_type TYPE text;
ALTER TABLE user_memory ALTER COLUMN source TYPE text;

-- users
ALTER TABLE users ALTER COLUMN company_name TYPE text;
ALTER TABLE users ALTER COLUMN email TYPE text;
ALTER TABLE users ALTER COLUMN google_id TYPE text;
ALTER TABLE users ALTER COLUMN linkedin_id TYPE text;
ALTER TABLE users ALTER COLUMN name TYPE text;
ALTER TABLE users ALTER COLUMN oauth_provider TYPE text;
ALTER TABLE users ALTER COLUMN password_hash TYPE text;
ALTER TABLE users ALTER COLUMN role TYPE text;
ALTER TABLE users ALTER COLUMN stripe_subscription_id TYPE text;
ALTER TABLE users ALTER COLUMN subscription_plan TYPE text;
ALTER TABLE users ALTER COLUMN subscription_status TYPE text;

-- verification_documents
ALTER TABLE verification_documents ALTER COLUMN document_type TYPE text;
ALTER TABLE verification_documents ALTER COLUMN mime_type TYPE text;
ALTER TABLE verification_documents ALTER COLUMN original_filename TYPE text;
ALTER TABLE verification_documents ALTER COLUMN status TYPE text;
ALTER TABLE verification_documents ALTER COLUMN verified_by TYPE text;

-- verified_credentials
ALTER TABLE verified_credentials ALTER COLUMN credential_name TYPE text;
ALTER TABLE verified_credentials ALTER COLUMN credential_type TYPE text;
ALTER TABLE verified_credentials ALTER COLUMN issuer TYPE text;
ALTER TABLE verified_credentials ALTER COLUMN verification_status TYPE text;

-- work_experience
ALTER TABLE work_experience ALTER COLUMN company_name TYPE text;
ALTER TABLE work_experience ALTER COLUMN location TYPE text;
ALTER TABLE work_experience ALTER COLUMN title TYPE text;

-- ============================================================
-- SECTION 3: CHECK constraints for status enums, type enums, score ranges
-- ============================================================

-- Users role enum
ALTER TABLE users ADD CONSTRAINT chk_users_role
  CHECK (role IN ('candidate', 'recruiter', 'employer', 'admin', 'hiring_manager'));

-- Jobs status & type enums
ALTER TABLE jobs ADD CONSTRAINT chk_jobs_status
  CHECK (status IN ('draft', 'active', 'paused', 'closed', 'archived'));
ALTER TABLE jobs ADD CONSTRAINT chk_jobs_job_type
  CHECK (job_type IN ('full-time', 'part-time', 'contract', 'internship', 'freelance'));

-- Job applications status enum
ALTER TABLE job_applications ADD CONSTRAINT chk_job_applications_status
  CHECK (status IN ('applied', 'screening', 'interviewed', 'offered', 'hired', 'rejected', 'withdrawn'));

-- Interviews status & type enums
ALTER TABLE interviews ADD CONSTRAINT chk_interviews_status
  CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'));
ALTER TABLE interviews ADD CONSTRAINT chk_interviews_type
  CHECK (interview_type IN ('mock', 'live', 'video', 'phone', 'technical', 'behavioral'));

-- Mock interview sessions status
ALTER TABLE mock_interview_sessions ADD CONSTRAINT chk_mock_sessions_status
  CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'));

-- Scheduled interviews status & outcome
ALTER TABLE scheduled_interviews ADD CONSTRAINT chk_scheduled_interviews_status
  CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show', 'rescheduled'));
ALTER TABLE scheduled_interviews ADD CONSTRAINT chk_scheduled_interviews_outcome
  CHECK (outcome IS NULL OR outcome IN ('passed', 'failed', 'pending_review', 'no_decision'));

-- Offers status & employment type
ALTER TABLE offers ADD CONSTRAINT chk_offers_status
  CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired', 'withdrawn'));
ALTER TABLE offers ADD CONSTRAINT chk_offers_employment_type
  CHECK (employment_type IS NULL OR employment_type IN ('full-time', 'part-time', 'contract', 'internship'));

-- Employees status & employment type
ALTER TABLE employees ADD CONSTRAINT chk_employees_status
  CHECK (status IN ('active', 'inactive', 'terminated', 'on_leave'));
ALTER TABLE employees ADD CONSTRAINT chk_employees_employment_type
  CHECK (employment_type IS NULL OR employment_type IN ('full-time', 'part-time', 'contract', 'internship'));

-- Screening sessions status & score range
ALTER TABLE screening_sessions ADD CONSTRAINT chk_screening_sessions_status
  CHECK (status IS NULL OR status IN ('invited', 'in_progress', 'completed', 'expired', 'cancelled'));
ALTER TABLE screening_sessions ADD CONSTRAINT chk_screening_sessions_score
  CHECK (overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100));

-- Communications status & type
ALTER TABLE communications ADD CONSTRAINT chk_communications_status
  CHECK (status IS NULL OR status IN ('draft', 'sent', 'delivered', 'failed', 'bounced'));
ALTER TABLE communications ADD CONSTRAINT chk_communications_type
  CHECK (type IN ('email', 'sms', 'in_app', 'notification'));

-- Onboarding documents status
ALTER TABLE onboarding_documents ADD CONSTRAINT chk_onboarding_docs_status
  CHECK (status IS NULL OR status IN ('pending', 'submitted', 'approved', 'rejected', 'expired'));

-- Paychecks status
ALTER TABLE paychecks ADD CONSTRAINT chk_paychecks_status
  CHECK (status IS NULL OR status IN ('pending', 'processing', 'paid', 'failed', 'voided'));

-- Payroll runs status
ALTER TABLE payroll_runs ADD CONSTRAINT chk_payroll_runs_status
  CHECK (status IS NULL OR status IN ('draft', 'processing', 'completed', 'failed'));

-- Question bank difficulty & type
ALTER TABLE question_bank ADD CONSTRAINT chk_question_bank_difficulty
  CHECK (difficulty IN ('easy', 'medium', 'hard'));
ALTER TABLE question_bank ADD CONSTRAINT chk_question_bank_type
  CHECK (question_type IN ('behavioral', 'technical', 'situational', 'competency', 'role_specific'));

-- Candidate profiles enums
ALTER TABLE candidate_profiles ADD CONSTRAINT chk_profiles_remote_preference
  CHECK (remote_preference IS NULL OR remote_preference IN ('remote', 'hybrid', 'onsite'));
ALTER TABLE candidate_profiles ADD CONSTRAINT chk_profiles_availability
  CHECK (availability IS NULL OR availability IN ('immediately', '2 weeks', '1 month', '2 months', '3+ months'));

-- Interview evaluations evaluator type
ALTER TABLE interview_evaluations ADD CONSTRAINT chk_evaluations_evaluator_type
  CHECK (evaluator_type IN ('ai', 'human', 'panel'));

-- Verification documents status
ALTER TABLE verification_documents ADD CONSTRAINT chk_verification_docs_status
  CHECK (status IS NULL OR status IN ('pending', 'verified', 'rejected', 'expired'));

-- Document verifications fraud risk
ALTER TABLE document_verifications ADD CONSTRAINT chk_doc_verifications_fraud_risk
  CHECK (fraud_risk IS NULL OR fraud_risk IN ('low', 'medium', 'high', 'critical'));

-- Parsed resumes parsing status
ALTER TABLE parsed_resumes ADD CONSTRAINT chk_parsed_resumes_status
  CHECK (parsing_status IS NULL OR parsing_status IN ('pending', 'processing', 'completed', 'failed'));

-- Score tier enum (used in omni_scores and trust_scores)
ALTER TABLE omni_scores ADD CONSTRAINT chk_omni_scores_tier
  CHECK (score_tier IS NULL OR score_tier IN ('new', 'bronze', 'silver', 'gold', 'platinum'));
ALTER TABLE trust_scores ADD CONSTRAINT chk_trust_scores_tier
  CHECK (score_tier IS NULL OR score_tier IN ('new', 'bronze', 'silver', 'gold', 'platinum'));
