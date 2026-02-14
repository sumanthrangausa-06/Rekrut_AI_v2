# Schema Improvements Roadmap

> Last updated: 2026-02-14 (after P0–P3 complete)

## Overview

This document tracks all schema improvement tasks for the HireLoop/Rekrut AI database.

| Priority | Category | Status | Migration | Date |
|----------|----------|--------|-----------|------|
| **P0** | FK corruption (5 tables) | ✅ RESOLVED | `041_fix_company_fk.js` | 2026-02-14 |
| **P1** | Interview flow & timezone | ✅ RESOLVED | `042_p1_interview_flow_schema.js` | 2026-02-14 |
| **P2** | CHECK constraints, varchar→TEXT, timestamptz | ✅ RESOLVED | `045_p2_schema_hardening.js` | 2026-02-14 |
| **P3** | Performance optimizations | ✅ RESOLVED | `046_p3_schema_optimizations.js` | 2026-02-14 |

---

## P0 — Foreign Key Corruption ✅ RESOLVED

**Problem**: 5 tables had `company_id` FK pointing to `users.id` instead of `companies.id`.

**Tables affected**: `offers`, `offer_templates`, `onboarding_documents`, `onboarding_plans`, `company_policies`

**Fix**: Dropped incorrect FKs, added correct FKs to `companies.id`, added missing `idx_offer_templates_company` index.

**Migration**: `041_fix_company_fk.js`

---

## P1 — Interview Flow & Timezone Issues ✅ RESOLVED

**Fixes applied**:
- **Timestamp standardization**: 20 columns across 8 tables migrated from `timestamp` → `timestamptz`
- **NOT NULL constraints**: Added to critical columns (user_id, status, created_at, etc.)
- **Missing FK constraints**: +4 added (evaluations + composite_scores → interviews, screening_sessions)
- **Missing FK indexes**: +14 added for query performance
- **Missing `updated_at` columns**: +5 tables updated
- **Data fix**: 8 interview records stuck in `in_progress` with NULL `job_id` — validated at schema level

**Migration**: `042_p1_interview_flow_schema.js` (formerly `p1_interview_flow_schema`)

---

## P2 — Schema Hardening ✅ RESOLVED

**Migration**: `045_p2_schema_hardening.js`
**Deployed**: 2026-02-14T17:39:15Z (commit 48c46714)

### 2a. CHECK Constraints (37 added)

Added CHECK constraints to enforce valid enum values across all status, type, and range columns:

| Table | Constraint | Column | Allowed Values |
|-------|-----------|--------|----------------|
| users | chk_users_role | role | candidate, recruiter, employer, admin, hiring_manager |
| jobs | chk_jobs_status | status | draft, active, paused, closed, archived |
| jobs | chk_jobs_job_type | job_type | full-time, part-time, contract, internship, freelance |
| job_applications | chk_job_applications_status | status | applied, screening, interviewed, offered, hired, rejected, withdrawn |
| job_applications | chk_job_applications_screening_status | screening_status | NULL OR pending, invited, in_progress, completed, expired, failed |
| interviews | chk_interviews_status | status | pending, in_progress, completed, cancelled |
| interviews | chk_interviews_type | interview_type | phone, video, onsite, technical, behavioral, panel, mock |
| offers | chk_offers_status | status | draft, sent, accepted, declined, expired, rescinded, negotiating |
| offers | chk_offers_employment_type | employment_type | NULL OR full-time, part-time, contract, internship, freelance |
| employees | chk_employees_status | status | active, inactive, terminated, on_leave, probation |
| employees | chk_employees_employment_type | employment_type | NULL OR full-time, part-time, contract, intern, freelance |
| communications | chk_communications_type | type | email, sms, in_app, push |
| communications | chk_communications_status | status | draft, queued, sent, delivered, failed, bounced |
| communication_templates | chk_communication_templates_type | type | email, sms, in_app, push |
| communication_sequences | chk_communication_sequences_status | status | active, paused, archived, draft |
| sequence_enrollments | chk_sequence_enrollments_status | status | active, completed, paused, cancelled |
| candidate_profiles | chk_candidate_profiles_availability | availability | NULL OR immediately, 2 weeks, two_weeks, 1 month, one_month, 3 months, three_months, not_available |
| candidate_profiles | chk_candidate_profiles_work_authorization | work_authorization | NULL OR citizen, permanent_resident, visa_holder, requires_sponsorship |
| candidate_profiles | chk_candidate_profiles_remote_preference | remote_preference | NULL OR remote, hybrid, onsite, flexible |
| parsed_resumes | chk_parsed_resumes_status | parsing_status | pending, processing, completed, failed |
| screening_sessions | chk_screening_sessions_status | status | invited, started, in_progress, completed, expired, cancelled |
| screening_sessions | chk_screening_sessions_score | overall_score | NULL OR 0–100 range |
| scheduled_interviews | chk_scheduled_interviews_status | status | scheduled, confirmed, in_progress, completed, cancelled, no_show |
| mock_interview_sessions | chk_mock_interview_sessions_status | status | active, in_progress, completed, expired, abandoned |
| onboarding_plans | chk_onboarding_plans_status | status | draft, active, completed, archived |
| onboarding_tasks | chk_onboarding_tasks_status | status | pending, in_progress, completed, skipped, overdue |
| onboarding_checklists | chk_onboarding_checklists_status | status | pending, in_progress, completed, skipped |
| onboarding_documents | chk_onboarding_documents_status | status | pending, sent, signed, completed, expired |
| job_assessments | chk_job_assessments_status | status | draft, active, archived |
| job_assessments | chk_job_assessments_difficulty | difficulty_level | easy, medium, mid, hard |
| job_assessment_attempts | chk_job_assessment_attempts_status | status | in_progress, completed, expired, abandoned |
| assessment_sessions | chk_assessment_sessions_status | status | pending, active, in_progress, completed, expired, cancelled |
| score_appeals | chk_score_appeals_status | status | pending, under_review, approved, rejected |
| post_hire_feedback | chk_post_hire_feedback_status | status | pending, submitted, reviewed |
| payroll_runs | chk_payroll_runs_status | status | draft, processing, completed, failed |
| pay_periods | chk_pay_periods_status | status | open, closed, processing |
| paychecks | chk_paychecks_status | status | draft, processing, completed, failed, voided, paid |
| employee_benefits | chk_employee_benefits_status | status | active, pending, cancelled, expired |
| tax_documents | chk_tax_documents_status | status | pending, generated, filed, accepted, rejected |
| data_requests | chk_data_requests_status | status | pending, in_progress, completed, rejected |
| fairness_audits | chk_fairness_audits_status | status | pending, in_progress, completed, failed |
| verification_documents | chk_verification_documents_status | status | pending, verified, rejected, expired |

### 2b. VARCHAR → TEXT Conversions (274 columns)

Converted 274 varchar columns to TEXT across ~80 tables. PostgreSQL TEXT is equivalent in performance but removes arbitrary length limits.

**Kept as VARCHAR** (24 columns with genuine length bounds):
- `country_code` VARCHAR(2), `currency_code` VARCHAR(3)
- `phone` VARCHAR(20), `zip_code` VARCHAR(20)
- `state` VARCHAR(100), `city` VARCHAR(100)
- And similar bounded fields

### 2c. screening_sessions TIMESTAMPTZ (5 columns)

Converted remaining `timestamp without time zone` columns to `timestamp with time zone`:
- `invited_at`, `started_at`, `completed_at`, `expires_at`, `created_at`

Used `AT TIME ZONE 'UTC'` for safe conversion of existing data.

### Data Fixes Applied Before Constraints

- `candidate_profiles.availability`: Normalized `'immediate'` → `'immediately'` (1 row)
- CHECK constraints designed to accept both human-readable (`'2 weeks'`) and snake_case (`'two_weeks'`) formats

---

## P3 — Performance Optimizations ✅ RESOLVED

**Migration**: `046_p3_schema_optimizations.js`
**Deployed**: 2026-02-14 (commit 7b01987)

**Fixes applied**:
- **FK Indexes**: +64 indexes on foreign key columns for join performance
- **Timestamp standardization**: 182 columns migrated from `timestamp` → `timestamptz` (only 2 system-table timestamps remain: `_migrations.applied_at`, `user_sessions.expire`)
- **Partial indexes**: +6 for status-filtered queries (active jobs, pending interviews, active screening sessions, pending offers, active refresh tokens, unsent interview reminders)
- **Unique constraints**: +7 for data integrity (composite uniqueness on match_results, mutual_matches, recruiter_feedback, etc.)

**Post-P3 schema totals**: 105 tables, 1,358 columns, 164 FKs, 386 indexes (incl. 10 partial), 56 CHECK constraints, 36 unique constraints

---

## Future Considerations (Post-P3)

Lower priority items not addressed by P0–P3:
- Table partitioning for high-volume tables (communications, agent_data)
- Archive strategy for old assessment_sessions / screening_sessions
- JSONB schema validation via CHECK constraints
- Zombie mock_interview_sessions cleanup (43% stuck in_progress)
