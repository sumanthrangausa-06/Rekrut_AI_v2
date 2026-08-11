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
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = '_migrations' AND column_name = 'name'
  ) THEN
    ALTER TABLE _migrations ALTER COLUMN name TYPE text;
  END IF;
END $$;

-- activity_log
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'activity_log' AND column_name = 'category'
  ) THEN
    ALTER TABLE activity_log ALTER COLUMN category TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'activity_log' AND column_name = 'event_type'
  ) THEN
    ALTER TABLE activity_log ALTER COLUMN event_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'activity_log' AND column_name = 'ip_address'
  ) THEN
    ALTER TABLE activity_log ALTER COLUMN ip_address TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'activity_log' AND column_name = 'severity'
  ) THEN
    ALTER TABLE activity_log ALTER COLUMN severity TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'activity_log' AND column_name = 'user_email'
  ) THEN
    ALTER TABLE activity_log ALTER COLUMN user_email TYPE text;
  END IF;
END $$;

-- agent_data
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_data' AND column_name = 'type'
  ) THEN
    ALTER TABLE agent_data ALTER COLUMN type TYPE text;
  END IF;
END $$;

-- ai_ab_tests
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_ab_tests' AND column_name = 'name'
  ) THEN
    ALTER TABLE ai_ab_tests ALTER COLUMN name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_ab_tests' AND column_name = 'status'
  ) THEN
    ALTER TABLE ai_ab_tests ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- ai_agent_actions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_agent_actions' AND column_name = 'action_type'
  ) THEN
    ALTER TABLE ai_agent_actions ALTER COLUMN action_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_agent_actions' AND column_name = 'agent_type'
  ) THEN
    ALTER TABLE ai_agent_actions ALTER COLUMN agent_type TYPE text;
  END IF;
END $$;

-- ai_call_log
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_call_log' AND column_name = 'feature'
  ) THEN
    ALTER TABLE ai_call_log ALTER COLUMN feature TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_call_log' AND column_name = 'modality'
  ) THEN
    ALTER TABLE ai_call_log ALTER COLUMN modality TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_call_log' AND column_name = 'model'
  ) THEN
    ALTER TABLE ai_call_log ALTER COLUMN model TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_call_log' AND column_name = 'module'
  ) THEN
    ALTER TABLE ai_call_log ALTER COLUMN module TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_call_log' AND column_name = 'provider'
  ) THEN
    ALTER TABLE ai_call_log ALTER COLUMN provider TYPE text;
  END IF;
END $$;

-- ai_prompt_versions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_prompt_versions' AND column_name = 'model'
  ) THEN
    ALTER TABLE ai_prompt_versions ALTER COLUMN model TYPE text;
  END IF;
END $$;

-- ai_prompts
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_prompts' AND column_name = 'feature'
  ) THEN
    ALTER TABLE ai_prompts ALTER COLUMN feature TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_prompts' AND column_name = 'model'
  ) THEN
    ALTER TABLE ai_prompts ALTER COLUMN model TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_prompts' AND column_name = 'module'
  ) THEN
    ALTER TABLE ai_prompts ALTER COLUMN module TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_prompts' AND column_name = 'name'
  ) THEN
    ALTER TABLE ai_prompts ALTER COLUMN name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_prompts' AND column_name = 'slug'
  ) THEN
    ALTER TABLE ai_prompts ALTER COLUMN slug TYPE text;
  END IF;
END $$;

-- ai_provider_stats
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_provider_stats' AND column_name = 'stat_key'
  ) THEN
    ALTER TABLE ai_provider_stats ALTER COLUMN stat_key TYPE text;
  END IF;
END $$;

-- ai_provider_verification
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_provider_verification' AND column_name = 'modality'
  ) THEN
    ALTER TABLE ai_provider_verification ALTER COLUMN modality TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_provider_verification' AND column_name = 'model'
  ) THEN
    ALTER TABLE ai_provider_verification ALTER COLUMN model TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_provider_verification' AND column_name = 'provider_key'
  ) THEN
    ALTER TABLE ai_provider_verification ALTER COLUMN provider_key TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_provider_verification' AND column_name = 'status'
  ) THEN
    ALTER TABLE ai_provider_verification ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- assessment_conversations
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assessment_conversations' AND column_name = 'role'
  ) THEN
    ALTER TABLE assessment_conversations ALTER COLUMN role TYPE text;
  END IF;
END $$;

-- assessment_events
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assessment_events' AND column_name = 'event_type'
  ) THEN
    ALTER TABLE assessment_events ALTER COLUMN event_type TYPE text;
  END IF;
END $$;

-- assessment_questions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assessment_questions' AND column_name = 'question_type'
  ) THEN
    ALTER TABLE assessment_questions ALTER COLUMN question_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assessment_questions' AND column_name = 'skill_category'
  ) THEN
    ALTER TABLE assessment_questions ALTER COLUMN skill_category TYPE text;
  END IF;
END $$;

-- assessment_sessions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assessment_sessions' AND column_name = 'status'
  ) THEN
    ALTER TABLE assessment_sessions ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- audit_logs
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs' AND column_name = 'action_type'
  ) THEN
    ALTER TABLE audit_logs ALTER COLUMN action_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs' AND column_name = 'ip_address'
  ) THEN
    ALTER TABLE audit_logs ALTER COLUMN ip_address TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs' AND column_name = 'target_type'
  ) THEN
    ALTER TABLE audit_logs ALTER COLUMN target_type TYPE text;
  END IF;
END $$;

-- bias_reports
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bias_reports' AND column_name = 'analysis_type'
  ) THEN
    ALTER TABLE bias_reports ALTER COLUMN analysis_type TYPE text;
  END IF;
END $$;

-- candidate_feedback
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_feedback' AND column_name = 'feedback_type'
  ) THEN
    ALTER TABLE candidate_feedback ALTER COLUMN feedback_type TYPE text;
  END IF;
END $$;

-- candidate_onboarding_data
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'account_type'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN account_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'address_line1'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN address_line1 TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'address_line2'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN address_line2 TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'bank_name'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN bank_name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'city'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN city TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'emergency_contact_email'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN emergency_contact_email TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'emergency_contact_name'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN emergency_contact_name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'emergency_contact_phone'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN emergency_contact_phone TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'emergency_contact_relationship'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN emergency_contact_relationship TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'i9_admission_number'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_admission_number TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'i9_alien_number'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_alien_number TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'i9_citizenship_status'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_citizenship_status TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'i9_country_of_issuance'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_country_of_issuance TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'i9_document_number'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_document_number TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'i9_document_title'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_document_title TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'i9_email'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_email TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'i9_issuing_authority'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_issuing_authority TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'i9_other_last_names'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_other_last_names TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'i9_passport_number'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_passport_number TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'i9_preparer_address'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_preparer_address TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'i9_preparer_name'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN i9_preparer_name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'legal_first_name'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN legal_first_name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'legal_last_name'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN legal_last_name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'legal_middle_name'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN legal_middle_name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'phone'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN phone TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'state'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN state TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'w4_filing_status'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN w4_filing_status TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'wizard_status'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN wizard_status TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_onboarding_data' AND column_name = 'zip_code'
  ) THEN
    ALTER TABLE candidate_onboarding_data ALTER COLUMN zip_code TYPE text;
  END IF;
END $$;

-- candidate_profiles
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_profiles' AND column_name = 'availability'
  ) THEN
    ALTER TABLE candidate_profiles ALTER COLUMN availability TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_profiles' AND column_name = 'github_url'
  ) THEN
    ALTER TABLE candidate_profiles ALTER COLUMN github_url TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_profiles' AND column_name = 'headline'
  ) THEN
    ALTER TABLE candidate_profiles ALTER COLUMN headline TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_profiles' AND column_name = 'linkedin_url'
  ) THEN
    ALTER TABLE candidate_profiles ALTER COLUMN linkedin_url TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_profiles' AND column_name = 'location'
  ) THEN
    ALTER TABLE candidate_profiles ALTER COLUMN location TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_profiles' AND column_name = 'notice_period'
  ) THEN
    ALTER TABLE candidate_profiles ALTER COLUMN notice_period TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_profiles' AND column_name = 'phone'
  ) THEN
    ALTER TABLE candidate_profiles ALTER COLUMN phone TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_profiles' AND column_name = 'photo_url'
  ) THEN
    ALTER TABLE candidate_profiles ALTER COLUMN photo_url TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_profiles' AND column_name = 'portfolio_url'
  ) THEN
    ALTER TABLE candidate_profiles ALTER COLUMN portfolio_url TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_profiles' AND column_name = 'remote_preference'
  ) THEN
    ALTER TABLE candidate_profiles ALTER COLUMN remote_preference TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_profiles' AND column_name = 'resume_url'
  ) THEN
    ALTER TABLE candidate_profiles ALTER COLUMN resume_url TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_profiles' AND column_name = 'work_authorization'
  ) THEN
    ALTER TABLE candidate_profiles ALTER COLUMN work_authorization TYPE text;
  END IF;
END $$;

-- candidate_skills
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_skills' AND column_name = 'category'
  ) THEN
    ALTER TABLE candidate_skills ALTER COLUMN category TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidate_skills' AND column_name = 'skill_name'
  ) THEN
    ALTER TABLE candidate_skills ALTER COLUMN skill_name TYPE text;
  END IF;
END $$;

-- communication_sequences
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'communication_sequences' AND column_name = 'name'
  ) THEN
    ALTER TABLE communication_sequences ALTER COLUMN name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'communication_sequences' AND column_name = 'status'
  ) THEN
    ALTER TABLE communication_sequences ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- communication_templates
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'communication_templates' AND column_name = 'name'
  ) THEN
    ALTER TABLE communication_templates ALTER COLUMN name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'communication_templates' AND column_name = 'subject_template'
  ) THEN
    ALTER TABLE communication_templates ALTER COLUMN subject_template TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'communication_templates' AND column_name = 'tone'
  ) THEN
    ALTER TABLE communication_templates ALTER COLUMN tone TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'communication_templates' AND column_name = 'type'
  ) THEN
    ALTER TABLE communication_templates ALTER COLUMN type TYPE text;
  END IF;
END $$;

-- communications
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'communications' AND column_name = 'status'
  ) THEN
    ALTER TABLE communications ALTER COLUMN status TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'communications' AND column_name = 'subject'
  ) THEN
    ALTER TABLE communications ALTER COLUMN subject TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'communications' AND column_name = 'tone'
  ) THEN
    ALTER TABLE communications ALTER COLUMN tone TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'communications' AND column_name = 'type'
  ) THEN
    ALTER TABLE communications ALTER COLUMN type TYPE text;
  END IF;
END $$;

-- companies
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'company_size'
  ) THEN
    ALTER TABLE companies ALTER COLUMN company_size TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'email_domain'
  ) THEN
    ALTER TABLE companies ALTER COLUMN email_domain TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'headquarters'
  ) THEN
    ALTER TABLE companies ALTER COLUMN headquarters TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'industry'
  ) THEN
    ALTER TABLE companies ALTER COLUMN industry TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'name'
  ) THEN
    ALTER TABLE companies ALTER COLUMN name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'slug'
  ) THEN
    ALTER TABLE companies ALTER COLUMN slug TYPE text;
  END IF;
END $$;

-- company_policies
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'company_policies' AND column_name = 'category'
  ) THEN
    ALTER TABLE company_policies ALTER COLUMN category TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'company_policies' AND column_name = 'title'
  ) THEN
    ALTER TABLE company_policies ALTER COLUMN title TYPE text;
  END IF;
END $$;

-- company_ratings
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'company_ratings' AND column_name = 'status'
  ) THEN
    ALTER TABLE company_ratings ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- consent_records
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'consent_records' AND column_name = 'consent_type'
  ) THEN
    ALTER TABLE consent_records ALTER COLUMN consent_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'consent_records' AND column_name = 'ip_address'
  ) THEN
    ALTER TABLE consent_records ALTER COLUMN ip_address TYPE text;
  END IF;
END $$;

-- country_configs (keep country_code, currency_code, currency_symbol as varchar)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'country_configs' AND column_name = 'country_name'
  ) THEN
    ALTER TABLE country_configs ALTER COLUMN country_name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'country_configs' AND column_name = 'date_format'
  ) THEN
    ALTER TABLE country_configs ALTER COLUMN date_format TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'country_configs' AND column_name = 'default_pay_frequency'
  ) THEN
    ALTER TABLE country_configs ALTER COLUMN default_pay_frequency TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'country_configs' AND column_name = 'employment_model'
  ) THEN
    ALTER TABLE country_configs ALTER COLUMN employment_model TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'country_configs' AND column_name = 'tax_system'
  ) THEN
    ALTER TABLE country_configs ALTER COLUMN tax_system TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'country_configs' AND column_name = 'timezone'
  ) THEN
    ALTER TABLE country_configs ALTER COLUMN timezone TYPE text;
  END IF;
END $$;

-- country_document_types (keep country_code as varchar)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'country_document_types' AND column_name = 'document_key'
  ) THEN
    ALTER TABLE country_document_types ALTER COLUMN document_key TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'country_document_types' AND column_name = 'document_name'
  ) THEN
    ALTER TABLE country_document_types ALTER COLUMN document_name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'country_document_types' AND column_name = 'government_form_id'
  ) THEN
    ALTER TABLE country_document_types ALTER COLUMN government_form_id TYPE text;
  END IF;
END $$;

-- data_requests
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'data_requests' AND column_name = 'request_type'
  ) THEN
    ALTER TABLE data_requests ALTER COLUMN request_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'data_requests' AND column_name = 'status'
  ) THEN
    ALTER TABLE data_requests ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- data_retention_policies
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'data_retention_policies' AND column_name = 'data_type'
  ) THEN
    ALTER TABLE data_retention_policies ALTER COLUMN data_type TYPE text;
  END IF;
END $$;

-- document_access_logs
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_access_logs' AND column_name = 'access_type'
  ) THEN
    ALTER TABLE document_access_logs ALTER COLUMN access_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_access_logs' AND column_name = 'ip_address'
  ) THEN
    ALTER TABLE document_access_logs ALTER COLUMN ip_address TYPE text;
  END IF;
END $$;

-- document_score_impacts
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_score_impacts' AND column_name = 'document_type'
  ) THEN
    ALTER TABLE document_score_impacts ALTER COLUMN document_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_score_impacts' AND column_name = 'verification_status'
  ) THEN
    ALTER TABLE document_score_impacts ALTER COLUMN verification_status TYPE text;
  END IF;
END $$;

-- document_verifications
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_verifications' AND column_name = 'duplicate_hash'
  ) THEN
    ALTER TABLE document_verifications ALTER COLUMN duplicate_hash TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_verifications' AND column_name = 'fraud_risk'
  ) THEN
    ALTER TABLE document_verifications ALTER COLUMN fraud_risk TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_verifications' AND column_name = 'verification_type'
  ) THEN
    ALTER TABLE document_verifications ALTER COLUMN verification_type TYPE text;
  END IF;
END $$;

-- education
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'education' AND column_name = 'degree'
  ) THEN
    ALTER TABLE education ALTER COLUMN degree TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'education' AND column_name = 'field_of_study'
  ) THEN
    ALTER TABLE education ALTER COLUMN field_of_study TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'education' AND column_name = 'institution'
  ) THEN
    ALTER TABLE education ALTER COLUMN institution TYPE text;
  END IF;
END $$;

-- employee_benefits
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_benefits' AND column_name = 'benefit_type'
  ) THEN
    ALTER TABLE employee_benefits ALTER COLUMN benefit_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_benefits' AND column_name = 'coverage_level'
  ) THEN
    ALTER TABLE employee_benefits ALTER COLUMN coverage_level TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_benefits' AND column_name = 'plan_name'
  ) THEN
    ALTER TABLE employee_benefits ALTER COLUMN plan_name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_benefits' AND column_name = 'status'
  ) THEN
    ALTER TABLE employee_benefits ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- employees (keep country_code, currency_code as varchar)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'department'
  ) THEN
    ALTER TABLE employees ALTER COLUMN department TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'employee_number'
  ) THEN
    ALTER TABLE employees ALTER COLUMN employee_number TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'employment_type'
  ) THEN
    ALTER TABLE employees ALTER COLUMN employment_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'position'
  ) THEN
    ALTER TABLE employees ALTER COLUMN position TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'status'
  ) THEN
    ALTER TABLE employees ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- events
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'event_type'
  ) THEN
    ALTER TABLE events ALTER COLUMN event_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'session_id'
  ) THEN
    ALTER TABLE events ALTER COLUMN session_id TYPE text;
  END IF;
END $$;

-- fairness_audits
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fairness_audits' AND column_name = 'audit_type'
  ) THEN
    ALTER TABLE fairness_audits ALTER COLUMN audit_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fairness_audits' AND column_name = 'status'
  ) THEN
    ALTER TABLE fairness_audits ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- interview_composite_scores
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'interview_composite_scores' AND column_name = 'recommendation'
  ) THEN
    ALTER TABLE interview_composite_scores ALTER COLUMN recommendation TYPE text;
  END IF;
END $$;

-- interview_evaluations
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'interview_evaluations' AND column_name = 'evaluator_type'
  ) THEN
    ALTER TABLE interview_evaluations ALTER COLUMN evaluator_type TYPE text;
  END IF;
END $$;

-- interview_questions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'interview_questions' AND column_name = 'category'
  ) THEN
    ALTER TABLE interview_questions ALTER COLUMN category TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'interview_questions' AND column_name = 'difficulty'
  ) THEN
    ALTER TABLE interview_questions ALTER COLUMN difficulty TYPE text;
  END IF;
END $$;

-- interview_reminders
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'interview_reminders' AND column_name = 'reminder_type'
  ) THEN
    ALTER TABLE interview_reminders ALTER COLUMN reminder_type TYPE text;
  END IF;
END $$;

-- interviews
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'interviews' AND column_name = 'interview_type'
  ) THEN
    ALTER TABLE interviews ALTER COLUMN interview_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'interviews' AND column_name = 'status'
  ) THEN
    ALTER TABLE interviews ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- job_applications
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_applications' AND column_name = 'screening_status'
  ) THEN
    ALTER TABLE job_applications ALTER COLUMN screening_status TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_applications' AND column_name = 'status'
  ) THEN
    ALTER TABLE job_applications ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- job_assessment_attempts
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_assessment_attempts' AND column_name = 'status'
  ) THEN
    ALTER TABLE job_assessment_attempts ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- job_assessment_questions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_assessment_questions' AND column_name = 'category'
  ) THEN
    ALTER TABLE job_assessment_questions ALTER COLUMN category TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_assessment_questions' AND column_name = 'question_type'
  ) THEN
    ALTER TABLE job_assessment_questions ALTER COLUMN question_type TYPE text;
  END IF;
END $$;

-- job_assessments
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_assessments' AND column_name = 'difficulty_level'
  ) THEN
    ALTER TABLE job_assessments ALTER COLUMN difficulty_level TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_assessments' AND column_name = 'status'
  ) THEN
    ALTER TABLE job_assessments ALTER COLUMN status TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_assessments' AND column_name = 'title'
  ) THEN
    ALTER TABLE job_assessments ALTER COLUMN title TYPE text;
  END IF;
END $$;

-- jobs (keep country_code, currency_code as varchar)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'company'
  ) THEN
    ALTER TABLE jobs ALTER COLUMN company TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'job_type'
  ) THEN
    ALTER TABLE jobs ALTER COLUMN job_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'location'
  ) THEN
    ALTER TABLE jobs ALTER COLUMN location TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'salary_range'
  ) THEN
    ALTER TABLE jobs ALTER COLUMN salary_range TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'status'
  ) THEN
    ALTER TABLE jobs ALTER COLUMN status TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'title'
  ) THEN
    ALTER TABLE jobs ALTER COLUMN title TYPE text;
  END IF;
END $$;

-- match_results
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'match_results' AND column_name = 'match_level'
  ) THEN
    ALTER TABLE match_results ALTER COLUMN match_level TYPE text;
  END IF;
END $$;

-- mock_interview_sessions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mock_interview_sessions' AND column_name = 'jd_hash'
  ) THEN
    ALTER TABLE mock_interview_sessions ALTER COLUMN jd_hash TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mock_interview_sessions' AND column_name = 'status'
  ) THEN
    ALTER TABLE mock_interview_sessions ALTER COLUMN status TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mock_interview_sessions' AND column_name = 'target_role'
  ) THEN
    ALTER TABLE mock_interview_sessions ALTER COLUMN target_role TYPE text;
  END IF;
END $$;

-- mutual_matches
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mutual_matches' AND column_name = 'match_level'
  ) THEN
    ALTER TABLE mutual_matches ALTER COLUMN match_level TYPE text;
  END IF;
END $$;

-- oauth_connections
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'oauth_connections' AND column_name = 'provider'
  ) THEN
    ALTER TABLE oauth_connections ALTER COLUMN provider TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'oauth_connections' AND column_name = 'provider_user_id'
  ) THEN
    ALTER TABLE oauth_connections ALTER COLUMN provider_user_id TYPE text;
  END IF;
END $$;

-- offer_templates
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offer_templates' AND column_name = 'name'
  ) THEN
    ALTER TABLE offer_templates ALTER COLUMN name TYPE text;
  END IF;
END $$;

-- offers (keep country_code, currency_code as varchar)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offers' AND column_name = 'candidate_sign_ip'
  ) THEN
    ALTER TABLE offers ALTER COLUMN candidate_sign_ip TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offers' AND column_name = 'company_name'
  ) THEN
    ALTER TABLE offers ALTER COLUMN company_name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offers' AND column_name = 'employment_type'
  ) THEN
    ALTER TABLE offers ALTER COLUMN employment_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offers' AND column_name = 'location'
  ) THEN
    ALTER TABLE offers ALTER COLUMN location TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offers' AND column_name = 'reporting_to'
  ) THEN
    ALTER TABLE offers ALTER COLUMN reporting_to TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offers' AND column_name = 'status'
  ) THEN
    ALTER TABLE offers ALTER COLUMN status TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offers' AND column_name = 'title'
  ) THEN
    ALTER TABLE offers ALTER COLUMN title TYPE text;
  END IF;
END $$;

-- omni_scores
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'omni_scores' AND column_name = 'score_tier'
  ) THEN
    ALTER TABLE omni_scores ALTER COLUMN score_tier TYPE text;
  END IF;
END $$;

-- onboarding_checklists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_checklists' AND column_name = 'status'
  ) THEN
    ALTER TABLE onboarding_checklists ALTER COLUMN status TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_checklists' AND column_name = 'title'
  ) THEN
    ALTER TABLE onboarding_checklists ALTER COLUMN title TYPE text;
  END IF;
END $$;

-- onboarding_documents
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_documents' AND column_name = 'document_type'
  ) THEN
    ALTER TABLE onboarding_documents ALTER COLUMN document_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_documents' AND column_name = 'signer_ip'
  ) THEN
    ALTER TABLE onboarding_documents ALTER COLUMN signer_ip TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_documents' AND column_name = 'status'
  ) THEN
    ALTER TABLE onboarding_documents ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- onboarding_plans
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_plans' AND column_name = 'department'
  ) THEN
    ALTER TABLE onboarding_plans ALTER COLUMN department TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_plans' AND column_name = 'role_title'
  ) THEN
    ALTER TABLE onboarding_plans ALTER COLUMN role_title TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_plans' AND column_name = 'status'
  ) THEN
    ALTER TABLE onboarding_plans ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- onboarding_tasks
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_tasks' AND column_name = 'assigned_to'
  ) THEN
    ALTER TABLE onboarding_tasks ALTER COLUMN assigned_to TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_tasks' AND column_name = 'category'
  ) THEN
    ALTER TABLE onboarding_tasks ALTER COLUMN category TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_tasks' AND column_name = 'day_range'
  ) THEN
    ALTER TABLE onboarding_tasks ALTER COLUMN day_range TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_tasks' AND column_name = 'phase'
  ) THEN
    ALTER TABLE onboarding_tasks ALTER COLUMN phase TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_tasks' AND column_name = 'status'
  ) THEN
    ALTER TABLE onboarding_tasks ALTER COLUMN status TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_tasks' AND column_name = 'title'
  ) THEN
    ALTER TABLE onboarding_tasks ALTER COLUMN title TYPE text;
  END IF;
END $$;

-- parsed_resumes
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parsed_resumes' AND column_name = 'file_url'
  ) THEN
    ALTER TABLE parsed_resumes ALTER COLUMN file_url TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parsed_resumes' AND column_name = 'original_filename'
  ) THEN
    ALTER TABLE parsed_resumes ALTER COLUMN original_filename TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parsed_resumes' AND column_name = 'parsing_status'
  ) THEN
    ALTER TABLE parsed_resumes ALTER COLUMN parsing_status TYPE text;
  END IF;
END $$;

-- pay_periods (keep country_code as varchar)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pay_periods' AND column_name = 'period_type'
  ) THEN
    ALTER TABLE pay_periods ALTER COLUMN period_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pay_periods' AND column_name = 'status'
  ) THEN
    ALTER TABLE pay_periods ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- paychecks (keep country_code, currency_code as varchar)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'paychecks' AND column_name = 'status'
  ) THEN
    ALTER TABLE paychecks ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- payroll_configs (keep country_code, currency_code, bank_account_last4 as varchar)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payroll_configs' AND column_name = 'bank_name'
  ) THEN
    ALTER TABLE payroll_configs ALTER COLUMN bank_name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payroll_configs' AND column_name = 'bank_routing_number'
  ) THEN
    ALTER TABLE payroll_configs ALTER COLUMN bank_routing_number TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payroll_configs' AND column_name = 'pay_frequency'
  ) THEN
    ALTER TABLE payroll_configs ALTER COLUMN pay_frequency TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payroll_configs' AND column_name = 'payment_method'
  ) THEN
    ALTER TABLE payroll_configs ALTER COLUMN payment_method TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payroll_configs' AND column_name = 'salary_type'
  ) THEN
    ALTER TABLE payroll_configs ALTER COLUMN salary_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payroll_configs' AND column_name = 'tax_filing_status'
  ) THEN
    ALTER TABLE payroll_configs ALTER COLUMN tax_filing_status TYPE text;
  END IF;
END $$;

-- payroll_runs (keep country_code, currency_code, currency_symbol as varchar)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payroll_runs' AND column_name = 'status'
  ) THEN
    ALTER TABLE payroll_runs ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- pipeline_automation_rules
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pipeline_automation_rules' AND column_name = 'from_stage'
  ) THEN
    ALTER TABLE pipeline_automation_rules ALTER COLUMN from_stage TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pipeline_automation_rules' AND column_name = 'to_stage'
  ) THEN
    ALTER TABLE pipeline_automation_rules ALTER COLUMN to_stage TYPE text;
  END IF;
END $$;

-- portfolio_projects
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_projects' AND column_name = 'github_url'
  ) THEN
    ALTER TABLE portfolio_projects ALTER COLUMN github_url TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_projects' AND column_name = 'image_url'
  ) THEN
    ALTER TABLE portfolio_projects ALTER COLUMN image_url TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_projects' AND column_name = 'project_url'
  ) THEN
    ALTER TABLE portfolio_projects ALTER COLUMN project_url TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_projects' AND column_name = 'role'
  ) THEN
    ALTER TABLE portfolio_projects ALTER COLUMN role TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_projects' AND column_name = 'title'
  ) THEN
    ALTER TABLE portfolio_projects ALTER COLUMN title TYPE text;
  END IF;
END $$;

-- post_hire_feedback
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'post_hire_feedback' AND column_name = 'feedback_type'
  ) THEN
    ALTER TABLE post_hire_feedback ALTER COLUMN feedback_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'post_hire_feedback' AND column_name = 'status'
  ) THEN
    ALTER TABLE post_hire_feedback ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- practice_sessions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'practice_sessions' AND column_name = 'category'
  ) THEN
    ALTER TABLE practice_sessions ALTER COLUMN category TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'practice_sessions' AND column_name = 'question_id'
  ) THEN
    ALTER TABLE practice_sessions ALTER COLUMN question_id TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'practice_sessions' AND column_name = 'response_type'
  ) THEN
    ALTER TABLE practice_sessions ALTER COLUMN response_type TYPE text;
  END IF;
END $$;

-- question_bank
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'question_bank' AND column_name = 'category'
  ) THEN
    ALTER TABLE question_bank ALTER COLUMN category TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'question_bank' AND column_name = 'difficulty'
  ) THEN
    ALTER TABLE question_bank ALTER COLUMN difficulty TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'question_bank' AND column_name = 'jd_hash'
  ) THEN
    ALTER TABLE question_bank ALTER COLUMN jd_hash TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'question_bank' AND column_name = 'question_type'
  ) THEN
    ALTER TABLE question_bank ALTER COLUMN question_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'question_bank' AND column_name = 'role'
  ) THEN
    ALTER TABLE question_bank ALTER COLUMN role TYPE text;
  END IF;
END $$;

-- recruiter_feedback
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'recruiter_feedback' AND column_name = 'feedback_type'
  ) THEN
    ALTER TABLE recruiter_feedback ALTER COLUMN feedback_type TYPE text;
  END IF;
END $$;

-- refresh_tokens
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'refresh_tokens' AND column_name = 'family_id'
  ) THEN
    ALTER TABLE refresh_tokens ALTER COLUMN family_id TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'refresh_tokens' AND column_name = 'token_hash'
  ) THEN
    ALTER TABLE refresh_tokens ALTER COLUMN token_hash TYPE text;
  END IF;
END $$;

-- role_scores
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'role_scores' AND column_name = 'role_name'
  ) THEN
    ALTER TABLE role_scores ALTER COLUMN role_name TYPE text;
  END IF;
END $$;

-- scheduled_interviews
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scheduled_interviews' AND column_name = 'interview_type'
  ) THEN
    ALTER TABLE scheduled_interviews ALTER COLUMN interview_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scheduled_interviews' AND column_name = 'outcome'
  ) THEN
    ALTER TABLE scheduled_interviews ALTER COLUMN outcome TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scheduled_interviews' AND column_name = 'status'
  ) THEN
    ALTER TABLE scheduled_interviews ALTER COLUMN status TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scheduled_interviews' AND column_name = 'timezone'
  ) THEN
    ALTER TABLE scheduled_interviews ALTER COLUMN timezone TYPE text;
  END IF;
END $$;

-- scheduling_preferences
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scheduling_preferences' AND column_name = 'timezone'
  ) THEN
    ALTER TABLE scheduling_preferences ALTER COLUMN timezone TYPE text;
  END IF;
END $$;

-- score_appeals
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'score_appeals' AND column_name = 'score_type'
  ) THEN
    ALTER TABLE score_appeals ALTER COLUMN score_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'score_appeals' AND column_name = 'status'
  ) THEN
    ALTER TABLE score_appeals ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- score_components
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'score_components' AND column_name = 'component_type'
  ) THEN
    ALTER TABLE score_components ALTER COLUMN component_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'score_components' AND column_name = 'source_type'
  ) THEN
    ALTER TABLE score_components ALTER COLUMN source_type TYPE text;
  END IF;
END $$;

-- score_history
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'score_history' AND column_name = 'change_reason'
  ) THEN
    ALTER TABLE score_history ALTER COLUMN change_reason TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'score_history' AND column_name = 'component_type'
  ) THEN
    ALTER TABLE score_history ALTER COLUMN component_type TYPE text;
  END IF;
END $$;

-- screening_sessions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'screening_sessions' AND column_name = 'invite_token'
  ) THEN
    ALTER TABLE screening_sessions ALTER COLUMN invite_token TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'screening_sessions' AND column_name = 'status'
  ) THEN
    ALTER TABLE screening_sessions ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- screening_templates
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'screening_templates' AND column_name = 'status'
  ) THEN
    ALTER TABLE screening_templates ALTER COLUMN status TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'screening_templates' AND column_name = 'title'
  ) THEN
    ALTER TABLE screening_templates ALTER COLUMN title TYPE text;
  END IF;
END $$;

-- sequence_enrollments
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sequence_enrollments' AND column_name = 'status'
  ) THEN
    ALTER TABLE sequence_enrollments ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- skill_assessments
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'skill_assessments' AND column_name = 'assessment_type'
  ) THEN
    ALTER TABLE skill_assessments ALTER COLUMN assessment_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'skill_assessments' AND column_name = 'title'
  ) THEN
    ALTER TABLE skill_assessments ALTER COLUMN title TYPE text;
  END IF;
END $$;

-- tax_documents
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tax_documents' AND column_name = 'document_type'
  ) THEN
    ALTER TABLE tax_documents ALTER COLUMN document_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tax_documents' AND column_name = 'status'
  ) THEN
    ALTER TABLE tax_documents ALTER COLUMN status TYPE text;
  END IF;
END $$;

-- trust_score_components
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trust_score_components' AND column_name = 'component_type'
  ) THEN
    ALTER TABLE trust_score_components ALTER COLUMN component_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trust_score_components' AND column_name = 'source_type'
  ) THEN
    ALTER TABLE trust_score_components ALTER COLUMN source_type TYPE text;
  END IF;
END $$;

-- trust_score_history
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trust_score_history' AND column_name = 'change_reason'
  ) THEN
    ALTER TABLE trust_score_history ALTER COLUMN change_reason TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trust_score_history' AND column_name = 'component_type'
  ) THEN
    ALTER TABLE trust_score_history ALTER COLUMN component_type TYPE text;
  END IF;
END $$;

-- trust_scores
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trust_scores' AND column_name = 'score_tier'
  ) THEN
    ALTER TABLE trust_scores ALTER COLUMN score_tier TYPE text;
  END IF;
END $$;

-- tts_cache
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tts_cache' AND column_name = 'text_hash'
  ) THEN
    ALTER TABLE tts_cache ALTER COLUMN text_hash TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tts_cache' AND column_name = 'text_preview'
  ) THEN
    ALTER TABLE tts_cache ALTER COLUMN text_preview TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tts_cache' AND column_name = 'voice'
  ) THEN
    ALTER TABLE tts_cache ALTER COLUMN voice TYPE text;
  END IF;
END $$;

-- user_memory
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_memory' AND column_name = 'memory_key'
  ) THEN
    ALTER TABLE user_memory ALTER COLUMN memory_key TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_memory' AND column_name = 'memory_type'
  ) THEN
    ALTER TABLE user_memory ALTER COLUMN memory_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_memory' AND column_name = 'source'
  ) THEN
    ALTER TABLE user_memory ALTER COLUMN source TYPE text;
  END IF;
END $$;

-- users
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'company_name'
  ) THEN
    ALTER TABLE users ALTER COLUMN company_name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'email'
  ) THEN
    ALTER TABLE users ALTER COLUMN email TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'google_id'
  ) THEN
    ALTER TABLE users ALTER COLUMN google_id TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'linkedin_id'
  ) THEN
    ALTER TABLE users ALTER COLUMN linkedin_id TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'name'
  ) THEN
    ALTER TABLE users ALTER COLUMN name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'oauth_provider'
  ) THEN
    ALTER TABLE users ALTER COLUMN oauth_provider TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'password_hash'
  ) THEN
    ALTER TABLE users ALTER COLUMN password_hash TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'role'
  ) THEN
    ALTER TABLE users ALTER COLUMN role TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'stripe_subscription_id'
  ) THEN
    ALTER TABLE users ALTER COLUMN stripe_subscription_id TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'subscription_plan'
  ) THEN
    ALTER TABLE users ALTER COLUMN subscription_plan TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'subscription_status'
  ) THEN
    ALTER TABLE users ALTER COLUMN subscription_status TYPE text;
  END IF;
END $$;

-- verification_documents
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'verification_documents' AND column_name = 'document_type'
  ) THEN
    ALTER TABLE verification_documents ALTER COLUMN document_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'verification_documents' AND column_name = 'mime_type'
  ) THEN
    ALTER TABLE verification_documents ALTER COLUMN mime_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'verification_documents' AND column_name = 'original_filename'
  ) THEN
    ALTER TABLE verification_documents ALTER COLUMN original_filename TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'verification_documents' AND column_name = 'status'
  ) THEN
    ALTER TABLE verification_documents ALTER COLUMN status TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'verification_documents' AND column_name = 'verified_by'
  ) THEN
    ALTER TABLE verification_documents ALTER COLUMN verified_by TYPE text;
  END IF;
END $$;

-- verified_credentials
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'verified_credentials' AND column_name = 'credential_name'
  ) THEN
    ALTER TABLE verified_credentials ALTER COLUMN credential_name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'verified_credentials' AND column_name = 'credential_type'
  ) THEN
    ALTER TABLE verified_credentials ALTER COLUMN credential_type TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'verified_credentials' AND column_name = 'issuer'
  ) THEN
    ALTER TABLE verified_credentials ALTER COLUMN issuer TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'verified_credentials' AND column_name = 'verification_status'
  ) THEN
    ALTER TABLE verified_credentials ALTER COLUMN verification_status TYPE text;
  END IF;
END $$;

-- work_experience
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_experience' AND column_name = 'company_name'
  ) THEN
    ALTER TABLE work_experience ALTER COLUMN company_name TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_experience' AND column_name = 'location'
  ) THEN
    ALTER TABLE work_experience ALTER COLUMN location TYPE text;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_experience' AND column_name = 'title'
  ) THEN
    ALTER TABLE work_experience ALTER COLUMN title TYPE text;
  END IF;
END $$;

-- ============================================================
-- SECTION 3: CHECK constraints for status enums, type enums, score ranges
-- ============================================================

-- Users role enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'users' AND constraint_name = 'chk_users_role'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT chk_users_role CHECK (role IN ('candidate', 'recruiter', 'employer', 'admin', 'hiring_manager'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Jobs status & type enums
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'jobs' AND constraint_name = 'chk_jobs_status'
  ) THEN
    ALTER TABLE jobs ADD CONSTRAINT chk_jobs_status CHECK (status IN ('draft', 'active', 'paused', 'closed', 'archived'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'jobs' AND constraint_name = 'chk_jobs_job_type'
  ) THEN
    ALTER TABLE jobs ADD CONSTRAINT chk_jobs_job_type CHECK (job_type IN ('full-time', 'part-time', 'contract', 'internship', 'freelance'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Job applications status enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'job_applications' AND constraint_name = 'chk_job_applications_status'
  ) THEN
    ALTER TABLE job_applications ADD CONSTRAINT chk_job_applications_status CHECK (status IN ('applied', 'screening', 'interviewed', 'offered', 'hired', 'rejected', 'withdrawn'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Interviews status & type enums
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'interviews' AND constraint_name = 'chk_interviews_status'
  ) THEN
    ALTER TABLE interviews ADD CONSTRAINT chk_interviews_status CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'interviews' AND constraint_name = 'chk_interviews_type'
  ) THEN
    ALTER TABLE interviews ADD CONSTRAINT chk_interviews_type CHECK (interview_type IN ('mock', 'live', 'video', 'phone', 'technical', 'behavioral'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Mock interview sessions status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'mock_interview_sessions' AND constraint_name = 'chk_mock_sessions_status'
  ) THEN
    ALTER TABLE mock_interview_sessions ADD CONSTRAINT chk_mock_sessions_status CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Scheduled interviews status & outcome
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'scheduled_interviews' AND constraint_name = 'chk_scheduled_interviews_status'
  ) THEN
    ALTER TABLE scheduled_interviews ADD CONSTRAINT chk_scheduled_interviews_status CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show', 'rescheduled'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'scheduled_interviews' AND constraint_name = 'chk_scheduled_interviews_outcome'
  ) THEN
    ALTER TABLE scheduled_interviews ADD CONSTRAINT chk_scheduled_interviews_outcome CHECK (outcome IS NULL OR outcome IN ('passed', 'failed', 'pending_review', 'no_decision'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Offers status & employment type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'offers' AND constraint_name = 'chk_offers_status'
  ) THEN
    ALTER TABLE offers ADD CONSTRAINT chk_offers_status CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired', 'withdrawn'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'offers' AND constraint_name = 'chk_offers_employment_type'
  ) THEN
    ALTER TABLE offers ADD CONSTRAINT chk_offers_employment_type CHECK (employment_type IS NULL OR employment_type IN ('full-time', 'part-time', 'contract', 'internship'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Employees status & employment type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'employees' AND constraint_name = 'chk_employees_status'
  ) THEN
    ALTER TABLE employees ADD CONSTRAINT chk_employees_status CHECK (status IN ('active', 'inactive', 'terminated', 'on_leave'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'employees' AND constraint_name = 'chk_employees_employment_type'
  ) THEN
    ALTER TABLE employees ADD CONSTRAINT chk_employees_employment_type CHECK (employment_type IS NULL OR employment_type IN ('full-time', 'part-time', 'contract', 'internship'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Screening sessions status & score range
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'screening_sessions' AND constraint_name = 'chk_screening_sessions_status'
  ) THEN
    ALTER TABLE screening_sessions ADD CONSTRAINT chk_screening_sessions_status CHECK (status IS NULL OR status IN ('invited', 'in_progress', 'completed', 'expired', 'cancelled'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'screening_sessions' AND constraint_name = 'chk_screening_sessions_score'
  ) THEN
    ALTER TABLE screening_sessions ADD CONSTRAINT chk_screening_sessions_score CHECK (overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Communications status & type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'communications' AND constraint_name = 'chk_communications_status'
  ) THEN
    ALTER TABLE communications ADD CONSTRAINT chk_communications_status CHECK (status IS NULL OR status IN ('draft', 'sent', 'delivered', 'failed', 'bounced'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'communications' AND constraint_name = 'chk_communications_type'
  ) THEN
    ALTER TABLE communications ADD CONSTRAINT chk_communications_type CHECK (type IN ('email', 'sms', 'in_app', 'notification'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Onboarding documents status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'onboarding_documents' AND constraint_name = 'chk_onboarding_docs_status'
  ) THEN
    ALTER TABLE onboarding_documents ADD CONSTRAINT chk_onboarding_docs_status CHECK (status IS NULL OR status IN ('pending', 'submitted', 'approved', 'rejected', 'expired'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Paychecks status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'paychecks' AND constraint_name = 'chk_paychecks_status'
  ) THEN
    ALTER TABLE paychecks ADD CONSTRAINT chk_paychecks_status CHECK (status IS NULL OR status IN ('pending', 'processing', 'paid', 'failed', 'voided'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Payroll runs status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'payroll_runs' AND constraint_name = 'chk_payroll_runs_status'
  ) THEN
    ALTER TABLE payroll_runs ADD CONSTRAINT chk_payroll_runs_status CHECK (status IS NULL OR status IN ('draft', 'processing', 'completed', 'failed'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Question bank difficulty & type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'question_bank' AND constraint_name = 'chk_question_bank_difficulty'
  ) THEN
    ALTER TABLE question_bank ADD CONSTRAINT chk_question_bank_difficulty CHECK (difficulty IN ('easy', 'medium', 'hard'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'question_bank' AND constraint_name = 'chk_question_bank_type'
  ) THEN
    ALTER TABLE question_bank ADD CONSTRAINT chk_question_bank_type CHECK (question_type IN ('behavioral', 'technical', 'situational', 'competency', 'role_specific'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Candidate profiles enums
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'candidate_profiles' AND constraint_name = 'chk_profiles_remote_preference'
  ) THEN
    ALTER TABLE candidate_profiles ADD CONSTRAINT chk_profiles_remote_preference CHECK (remote_preference IS NULL OR remote_preference IN ('remote', 'hybrid', 'onsite'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'candidate_profiles' AND constraint_name = 'chk_profiles_availability'
  ) THEN
    ALTER TABLE candidate_profiles ADD CONSTRAINT chk_profiles_availability CHECK (availability IS NULL OR availability IN ('immediately', '2 weeks', '1 month', '2 months', '3+ months'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Interview evaluations evaluator type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'interview_evaluations' AND constraint_name = 'chk_evaluations_evaluator_type'
  ) THEN
    ALTER TABLE interview_evaluations ADD CONSTRAINT chk_evaluations_evaluator_type CHECK (evaluator_type IN ('ai', 'human', 'panel'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Verification documents status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'verification_documents' AND constraint_name = 'chk_verification_docs_status'
  ) THEN
    ALTER TABLE verification_documents ADD CONSTRAINT chk_verification_docs_status CHECK (status IS NULL OR status IN ('pending', 'verified', 'rejected', 'expired'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Document verifications fraud risk
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'document_verifications' AND constraint_name = 'chk_doc_verifications_fraud_risk'
  ) THEN
    ALTER TABLE document_verifications ADD CONSTRAINT chk_doc_verifications_fraud_risk CHECK (fraud_risk IS NULL OR fraud_risk IN ('low', 'medium', 'high', 'critical'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Parsed resumes parsing status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'parsed_resumes' AND constraint_name = 'chk_parsed_resumes_status'
  ) THEN
    ALTER TABLE parsed_resumes ADD CONSTRAINT chk_parsed_resumes_status CHECK (parsing_status IS NULL OR parsing_status IN ('pending', 'processing', 'completed', 'failed'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;

-- Score tier enum (used in omni_scores and trust_scores)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'omni_scores' AND constraint_name = 'chk_omni_scores_tier'
  ) THEN
    ALTER TABLE omni_scores ADD CONSTRAINT chk_omni_scores_tier CHECK (score_tier IS NULL OR score_tier IN ('new', 'bronze', 'silver', 'gold', 'platinum'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'trust_scores' AND constraint_name = 'chk_trust_scores_tier'
  ) THEN
    ALTER TABLE trust_scores ADD CONSTRAINT chk_trust_scores_tier CHECK (score_tier IS NULL OR score_tier IN ('new', 'bronze', 'silver', 'gold', 'platinum'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;
