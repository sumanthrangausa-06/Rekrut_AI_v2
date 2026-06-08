# Rekrut AI Database Analysis

## Executive Summary

The Rekrut AI database is a **PostgreSQL-based schema** with **60+ tables** spanning recruitment, AI/ML scoring, interviews, assessments, payroll, onboarding, compliance, and communication features. The schema has evolved through **52 migration files** (numbered 001-046 plus specialized P1/P2/P3 hardening migrations) demonstrating an active, feature-rich platform with some accumulated technical debt.

**Key Concern:** Migration `045_fix_company_id_fk_constraints.sql` reveals that 5 core business tables (`offers`, `offer_templates`, `onboarding_documents`, `onboarding_plans`, `company_policies`) had **foreign key constraints pointing to `users(id)` instead of `companies(id)`** — a significant schema integrity issue that was only corrected in the P0 fix phase.

---

## Migration Inventory (52 Files)

### Numbered Migrations (001-046)

| # | File | Description | Tables Created | Columns Added |
|---|------|-------------|----------------|---------------|
| 001 | `001_add_omniscore.js` | OmniScore scoring system | `omni_scores`, `score_components`, `score_history` | `omniscore`, `trust_score` to `users` |
| 002 | `002_add_trustscore.js` | TrustScore for employers | `trust_scores`, `trust_score_components`, `trust_score_history` | `trust_score` to `companies` |
| 003 | `003_add_company_profile_fields.js` | Company profile expansion | — | `phone`, `website`, `size`, `industry`, `location` to `companies` |
| 003 | `003_add_role_column.js` | User role system | — | `role` to `users` |
| 004 | `004_candidate_profiles.js` | Candidate profile system | `candidate_profiles`, `education`, `work_experience`, `candidate_skills`, `portfolio_projects` | — |
| 005 | `005_backfill_application_company_id.js` | Data backfill | — | `company_id` to `applications` (with backfill) |
| 005 | `005_oauth_refresh_tokens.js` | OAuth session management | `oauth_connections`, `refresh_tokens` | `stripe_customer_id`, `subscription_plan` to `users` |
| 006 | `006_dynamic_assessments.js` | Dynamic assessment engine | `skill_assessments`, `assessment_sessions`, `assessment_questions`, `assessment_conversations`, `assessment_events` | — |
| 007 | `007_practice_sessions.js` | Practice interview system | `practice_sessions` | — |
| 008 | `008_matching_engine.js` | AI matching engine | `candidate_embeddings`, `job_embeddings`, `match_results`, `mutual_matches` | `embedding` (pgvector) to `jobs` |
| 009 | `009_document_verification.js` | Document verification | `document_verifications`, `verification_documents`, `verified_credentials`, `document_access_logs`, `document_score_impacts` | — |
| 010 | `010_video_analysis.js` | Video interview analysis | `interview_evaluations`, `interview_analysis`, `interview_composite_scores` | `video_analysis`, `video_url` to `interviews` |
| 011 | `011_payroll_system.js` | Payroll system | `employees`, `payroll_configs`, `pay_periods`, `payroll_runs`, `paychecks`, `employee_benefits`, `tax_documents` | — |
| 012 | `012_payroll_fixes.js` | Payroll schema fix | — | Unique constraint on `payroll_configs(employee_id)` |
| 013 | `013_compliance_system.js` | GDPR/compliance | `consent_records`, `data_requests`, `data_retention_policies`, `audit_logs`, `fairness_audits`, `bias_reports` | `deleted_at` to `users` |
| 014 | `014_onboarding_system.js` | Employee onboarding | `onboarding_checklists`, `onboarding_documents`, `onboarding_chats`, `company_policies` | `offer_id` to `employees` |
| 015 | `015_add_company_id_to_offers.js` | Offers data fix | — | `company_id` to `offers`, `offer_templates` (with backfill) |
| 016 | `016_conversion_tracking.js` | Analytics/tracking | `job_analytics`, `saved_jobs`, `recruiter_feedback`, `post_hire_feedback`, `candidate_feedback`, `company_ratings` | — |
| 017 | `017_fix_missing_schema.js` | Schema fix | `omniscore_results` | `avatar_url`, `omniscore_results` to `users` |
| 018 | `018_extend_onboarding_documents.js` | Document extensions | — | AI generation fields to `onboarding_documents` |
| 019 | `019_candidate_onboarding_wizard.js` | Onboarding wizard | `candidate_onboarding_data` | `wizard_status` to `users` |
| 020 | `020_w4_filing_status.js` | Tax form support | — | `w4_filing_status` to `candidate_onboarding_data` |
| 021 | `021_payroll_company_bridge.js` | Payroll bridge | — | `company_id` to `employees`, `payroll_configs` (with backfill) |
| 022 | `022_screening_questions.js` | Screening system | `screening_templates`, `screening_sessions`, `screening_answers` | — |
| 023 | `023_fix_interviews_updated_at.js` | Schema fix | — | `updated_at` to `interviews` |
| 024 | `024_offer_letter_generation.js` | Offer generation | — | `offer_letter_generated`, `offer_letter_data` to `offers` |
| 025 | `025_real_onboarding_documents.js` | Real documents | — | `real_onboarding_documents` JSONB to `onboarding_checklists` |
| 026 | `026_i9_government_spec_fields.js` | I-9 form support | — | I-9 government spec fields to `candidate_onboarding_data` |
| 027 | `027_multi_country_support.js` | Global expansion | `country_configs`, `country_document_types` | `country_code`, `language` to `users` |
| 028 | `028_video_practice.js` | Video practice | `mock_interview_sessions` | — |
| 029 | `029_global_payroll_enhancements.js` | Global payroll | — | `country_code`, `currency_code` to `payroll_configs`, `payroll_runs` |
| 030 | `030_omniscore_v2.js` | OmniScore v2 | — | `role_scores`, `ai_interview_scores` to `users` |
| 031 | `031_question_bank.js` | Question bank | `question_bank` | — |
| 032 | `032_mock_interview_cached_feedback.js` | Mock feedback | `mock_interview_feedback` | `cached_feedback` to `mock_interview_sessions` |
| 033 | `033_tts_audio_cache.js` | TTS caching | `tts_cache` | — |
| 034 | `034_activity_log.js` | Activity logging | `activity_log` | `last_activity` to `users` |
| 035 | `035_email_notifications.js` | Email system | `email_notifications`, `email_templates` | — |
| 035 | `035_pg_sessions.js` | Session store | `user_sessions` | — |
| 036 | `036_smart_data_reuse.js` | Smart data reuse | `user_memory`, `parsed_resumes` | `reuse_data` to `users` |
| 037 | `037_smart_profile_memory.js` | Profile memory | `recruiter_preferences`, `scheduling_preferences` | `profile_memory` to `users` |
| 038 | `038_ai_agents_pipeline_automation.js` | AI pipeline | `ai_agents`, `ai_agent_actions`, `pipeline_automation_rules`, `sequence_enrollments`, `communication_sequences`, `communication_templates` | — |
| 039 | `039_ai_health_monitoring.js` | AI health | `ai_health_metrics`, `ai_call_log`, `ai_prompts`, `ai_prompt_versions`, `ai_ab_tests` | — |
| 040 | `040_communication_hub.js` | Communication | `communications` | — |
| 040 | `040_mock_per_question_analysis.js` | Mock analysis | — | `per_question_analysis` to `mock_interview_sessions` |
| 041 | `041_interview_scheduling_screening.js` | Interview scheduling | `scheduled_interviews`, `interview_reminders`, `interview_questions` | `screening_status` to `job_applications` |
| 042 | `042_job_assessments.js` | Job assessments | `job_assessments`, `job_assessment_questions`, `job_assessment_attempts` | — |
| 043 | `043_ai_health_persistence.js` | AI health persistence | `ai_provider_verification`, `ai_token_budget_daily`, `ai_provider_stats` | — |
| 044 | `044_ai_onboarding_plans.js` | AI onboarding | `onboarding_plans`, `onboarding_tasks` | AI memory to `onboarding_chats` |
| 045 | `045_fix_company_id_fk_constraints.sql` | **CRITICAL FIX** | — | Fixes FK constraints on `offers`, `offer_templates`, `onboarding_documents`, `onboarding_plans`, `company_policies` |
| 045 | `045_p2_schema_hardening.js` | Schema hardening | — | CHECK constraints, screening_sessions timestamptz |
| 046 | `046_password_reset_tokens.js` | Password reset | `password_reset_tokens` | — |
| 051 | `051_screening_tables.js` | Screening tables | `screening_logs`, `job_application_screenings` | — |

### Post-Numbered Hardening Migrations (P0-P3)

| File | Description | Key Changes |
|------|-------------|-------------|
| `1739617200000_p1_interview_flow_schema.js` | Interview flow fixes | timestamptz conversions (9 tables), NOT NULL constraints (20+ columns), FK constraints (4 missing), 13 indexes, updated_at columns (5 tables) |
| `p2_schema_hardening.sql` | Comprehensive schema hardening | 274+ varchar→TEXT conversions, CHECK constraints (25+ enum/range constraints), screening_sessions timestamptz |
| `p3_schema_optimizations.js` | Performance optimizations | 64 FK indexes, ~182 timestamptz conversions (3 batches), 6 partial indexes, 7 unique constraints |

---

## Database Evolution Over Time

### Phase 1: Core Foundation (Migrations 001-005)
- **Base schema** (`migrate.js`): `users`, `jobs`, `interviews`, `applications`, `messages`, `feedback`, `interview_responses`, `job_applications`
- **Scoring systems**: OmniScore (001), TrustScore (002)
- **User roles**: Role-based access (003)
- **OAuth**: Session management with refresh tokens (005)
- **Company profiles**: Enhanced employer data (003)

### Phase 2: Candidate Experience (006-010)
- **Dynamic assessments**: Skill-based testing (006)
- **Practice sessions**: Interview preparation (007)
- **AI matching**: pgvector-powered embeddings (008)
- **Document verification**: Identity/fraud detection (009)
- **Video analysis**: Interview evaluation AI (010)

### Phase 3: Enterprise Features (011-021)
- **Payroll system**: Full employee payroll (011-012, 021)
- **Compliance**: GDPR, data retention, audits (013)
- **Onboarding**: Employee onboarding with checklists (014, 018-019)
- **Tax forms**: W-4 and I-9 support (020, 026)
- **Global payroll**: Multi-country support (027, 029)

### Phase 4: AI/ML Enhancement (022-033)
- **Screening**: Template-based screening questions (022)
- **Mock interviews**: Video practice with feedback (028, 032)
- **Question bank**: Structured question library (031)
- **TTS caching**: Audio generation optimization (033)
- **Smart memory**: User data reuse and profile memory (036-037)

### Phase 5: Automation & Communication (034-042)
- **Activity logging**: Comprehensive audit trail (034)
- **Email system**: Notifications and templates (035)
- **AI pipeline**: Automated recruitment workflows (038)
- **AI health monitoring**: Provider performance tracking (039)
- **Communication hub**: Unified messaging (040)
- **Interview scheduling**: Calendar integration (041)
- **Job assessments**: Role-based testing (042)

### Phase 6: Schema Hardening (043-051 + P1-P3)
- **AI persistence**: Token budgets and provider verification (043)
- **AI onboarding**: Plan generation and task management (044)
- **Critical fixes**: FK constraint corrections (045)
- **Schema hardening**: CHECK constraints, type conversions (045-P2)
- **Performance**: 64+ indexes, timestamptz standardization (P1-P3)
- **Password reset**: Token management (046)
- **Screening**: Application screening tables (051)

---

## Current Schema State

### Core Tables (8)
- `users` — Candidates, recruiters, employers, admins
- `jobs` — Job postings with AI embeddings
- `interviews` — Interview sessions (mock, live, video)
- `applications` / `job_applications` — Job applications
- `messages` — Chat/messaging data
- `feedback` — General feedback
- `interview_responses` — Interview answer data
- `_migrations` — Migration tracking

### AI/ML Tables (15+)
- `omni_scores`, `score_components`, `score_history` — OmniScore system
- `trust_scores`, `trust_score_components`, `trust_score_history` — TrustScore system
- `candidate_embeddings`, `job_embeddings`, `match_results`, `mutual_matches` — Matching engine
- `ai_call_log`, `ai_prompts`, `ai_prompt_versions`, `ai_ab_tests` — AI operations
- `ai_health_metrics`, `ai_provider_verification`, `ai_token_budget_daily`, `ai_provider_stats` — AI monitoring
- `screening_logs`, `job_application_screenings` — Screening results

### Interview Tables (10+)
- `interviews`, `scheduled_interviews`, `interview_questions`, `interview_evaluations`
- `interview_analysis`, `interview_composite_scores`, `interview_reminders`
- `mock_interview_sessions`, `mock_interview_feedback`, `practice_sessions`
- `screening_templates`, `screening_sessions`, `screening_answers`

### Assessment Tables (5)
- `skill_assessments`, `assessment_sessions`, `assessment_questions`
- `assessment_conversations`, `assessment_events`
- `job_assessments`, `job_assessment_questions`, `job_assessment_attempts`

### Payroll & HR Tables (10+)
- `employees`, `payroll_configs`, `pay_periods`, `payroll_runs`, `paychecks`
- `employee_benefits`, `tax_documents`, `country_configs`, `country_document_types`
- `candidate_onboarding_data`, `onboarding_checklists`, `onboarding_documents`
- `onboarding_chats`, `onboarding_plans`, `onboarding_tasks`, `company_policies`
- `offers`, `offer_templates`

### Compliance & Audit Tables (6)
- `consent_records`, `data_requests`, `data_retention_policies`
- `audit_logs`, `fairness_audits`, `bias_reports`

### Communication Tables (8)
- `communications`, `communication_sequences`, `communication_templates`
- `email_notifications`, `email_templates`, `user_sessions`
- `pipeline_automation_rules`, `sequence_enrollments`

### Candidate Profile Tables (8)
- `candidate_profiles`, `education`, `work_experience`, `candidate_skills`
- `portfolio_projects`, `parsed_resumes`, `user_memory`, `recruiter_preferences`
- `scheduling_preferences`, `saved_jobs`

### Verification & Document Tables (5)
- `document_verifications`, `verification_documents`, `verified_credentials`
- `document_access_logs`, `document_score_impacts`

### Analytics & Feedback Tables (6)
- `job_analytics`, `recruiter_feedback`, `post_hire_feedback`, `candidate_feedback`
- `company_ratings`, `activity_log`, `score_appeals`

### Security & Auth Tables (5)
- `oauth_connections`, `refresh_tokens`, `password_reset_tokens`
- `ai_agents`, `agent_data`

### Support Tables (4)
- `question_bank`, `tts_cache`, `events`, `role_scores`

---

## Key Relationships

### Entity Relationship Overview
```
users (1) ───────► (N) jobs
users (1) ───────► (N) interviews
users (1) ───────► (N) applications/job_applications
users (1) ───────► (N) candidate_profiles
users (1) ───────► (1) omni_scores
users (1) ───────► (1) candidate_embeddings
users (1) ───────► (N) practice_sessions

companies (1) ───► (N) jobs
companies (1) ───► (N) employees
companies (1) ───► (1) trust_scores
companies (1) ───► (N) screening_templates
companies (1) ───► (N) offers
companies (1) ───► (N) onboarding_plans
companies (1) ───► (N) company_policies

jobs (1) ────────► (N) job_applications
jobs (1) ────────► (N) interviews
jobs (1) ────────► (1) job_embeddings
jobs (1) ────────► (N) match_results
jobs (1) ────────► (N) scheduled_interviews
jobs (1) ────────► (N) job_assessments

offers (1) ──────► (N) onboarding_checklists
offers (1) ──────► (1) onboarding_plans

screening_sessions (1) ─► (N) interview_evaluations
screening_sessions (1) ─► (N) interview_composite_scores
```

---

## Indexes Summary

### Performance Indexes (100+)
- **FK indexes**: 64+ covering all foreign key columns (P3 optimization)
- **Partial indexes**: 6 for hot query paths (active jobs, pipeline statuses, pending interviews, active screening, pending offers, active tokens)
- **Unique indexes**: 7 for 1:1 relationships (candidate_profiles, candidate_embeddings, job_embeddings, omni_scores, recruiter_preferences, scheduling_preferences, saved_jobs)
- **Status indexes**: Various indexes on status columns for filtering

### Key Indexes by Table
- `users`: email (unique), google_id, linkedin_id, company_id, role
- `jobs`: status, company_id, user_id, active status partial index
- `job_applications`: job_id, candidate_id, status, pipeline status partial index
- `interviews`: user_id, job_id, status, pending status partial index
- `screening_sessions`: candidate_id, job_id, template_id, application_id, company_id, active status partial index
- `offers`: candidate_id, job_id, company_id, pending status partial index
- `refresh_tokens`: user_id, token_hash, active partial index

---

## Schema Issues & Technical Debt

### 🔴 Critical Issues

1. **FK Constraint Bug (Fixed in P0/045)**
   - `offers`, `offer_templates`, `onboarding_documents`, `onboarding_plans`, `company_policies` had `company_id` referencing `users(id)` instead of `companies(id)`
   - This was a fundamental data integrity issue that could cause orphaned records or incorrect joins
   - **Status**: Fixed in migration 045

2. **Missing `updated_at` Columns (Fixed in P1)**
   - `interview_evaluations`, `interview_analysis`, `interview_composite_scores`, `interview_questions`, `interview_reminders` lacked `updated_at`
   - **Status**: Fixed in P1 migration

3. **Missing FK Indexes (Fixed in P3)**
   - PostgreSQL does not auto-index FK columns, causing slow JOINs and cascading deletes
   - 64+ missing FK indexes identified and created
   - **Status**: Fixed in P3 migration

### 🟡 Moderate Issues

4. **Heavy JSONB Usage**
   - `screening_questions` (JSONB array), `assessment_configs` (JSONB), `onboarding_items` (JSONB)
   - `communication_metadata` (JSONB), `onboarding_plan_data` (JSONB), `ai_memory` (JSONB)
   - `screening_data` (JSONB), `mock_interview_data` (JSONB), `offer_letter_data` (JSONB)
   - **Risk**: Schema flexibility at the cost of query performance and data integrity. No JSONB indexes apparent.
   - **Recommendation**: Consider extracting frequently queried JSONB fields into proper columns

5. **varchar→TEXT Conversion Debt**
   - P2 migration converted 274+ varchar columns to TEXT
   - Indicates initial schema used varchar without proper length analysis
   - **Status**: Fixed in P2 migration

6. **Timestamp Without Timezone (Fixed in P1-P3)**
   - ~200+ columns used `timestamp` instead of `timestamptz`
   - P1 fixed 20 columns, P2 fixed 5, P3 fixed ~182 across 82 tables
   - **Status**: Fixed in P3 migration

7. **Missing NOT NULL Constraints (Fixed in P1)**
   - Many critical columns lacked NOT NULL constraints
   - P1 added constraints after verifying no NULL values exist
   - **Status**: Fixed in P1 migration

### 🟢 Minor Issues

8. **Duplicate Migration Numbers**
   - Multiple migrations share the same number (003, 005, 035, 040, 045)
   - Indicates parallel development tracks without proper sequencing
   - **Risk**: Potential ordering issues if migrations are not idempotent

9. **Backfill Migrations**
   - `005_backfill`, `015`, `021` exist to populate new columns with data
   - Indicates schema changes after data existed
   - **Status**: Completed successfully

10. **Missing Unique Constraints (Fixed in P3)**
    - Several 1:1 relationships lacked unique constraints
    - P3 added unique indexes for `candidate_profiles(user_id)`, `candidate_embeddings(user_id)`, etc.
    - **Status**: Fixed in P3 migration

11. **CHECK Constraints Added Late (P2)**
    - Status enums, type enums, and score ranges added via CHECK constraints in P2
    - These should ideally be defined at table creation time
    - **Status**: Fixed in P2 migration

### 📋 Recommendations

1. **Add JSONB Indexes**: For frequently queried JSONB fields (screening_data, assessment_configs, etc.)
2. **Consider Partitioning**: Large tables like `activity_log`, `audit_logs`, `ai_call_log` could benefit from time-based partitioning
3. **Review Nullability**: Some columns still allow NULL where business logic requires values
4. **Migration Naming**: Establish consistent sequential numbering to avoid duplicate migration numbers
5. **Schema Validation**: Add CI checks to validate FK constraint correctness before deployment
6. **Data Retention**: Implement retention policies for `activity_log`, `audit_logs`, `ai_call_log` to prevent unbounded growth

---

## Schema Quality Score: 7/10

**Strengths:**
- Comprehensive feature coverage (60+ tables)
- Good use of PostgreSQL features (pgvector, JSONB, partial indexes)
- CHECK constraints for data integrity
- Proper timestamptz standardization
- Extensive indexing strategy

**Weaknesses:**
- Significant schema drift requiring corrective migrations (P0-P3)
- Heavy JSONB usage without apparent indexes
- Inconsistent migration numbering
- Some schema fixes were reactive rather than proactive

**Overall:** The schema is well-designed for a feature-rich AI recruitment platform, but the need for P0-P3 hardening migrations indicates the schema evolved rapidly without sufficient upfront design review. The critical FK constraint bug is concerning but has been fixed.
