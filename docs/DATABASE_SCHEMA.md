# HireLoop Database Schema Reference

> **Auto-generated from live DB introspection** — 2026-02-14
> PostgreSQL (Neon) · 105 tables · 160 FK relationships · 294 indexes · ~1,250 columns

---

## Schema Pattern Classification

**Pattern:** Normalized Relational (3NF) with JSONB extensions

| Characteristic | Value |
|---|---|
| Normalization level | Third Normal Form (3NF) |
| PK strategy | `integer` with `nextval()` (serial) |
| FK enforcement | Yes — 160 declared foreign keys |
| Timestamp convention | Mixed (`timestamp` and `timestamptz`) |
| String type convention | `character varying` (most tables) |
| Semi-structured data | JSONB for arrays, metadata, flexible fields |
| Vector search | pgvector with IVFFlat indexes (2 tables) |
| Self-referential FKs | `communications.parent_id → communications.id` |
| Circular FKs | `users.company_id → companies.id` ↔ `companies.owner_id → users.id` |

---

## Table Inventory by Domain (105 tables)

### 1. Auth & Users (5 tables)

| Table | Columns | PK | Key Relationships |
|---|---|---|---|
| `users` | 18 | `id` (serial) | → `companies.id` (company_id) |
| `refresh_tokens` | 8 | `id` | → `users.id` (user_id) |
| `user_sessions` | 3 | `sid` (text) | Session store (express-session) |
| `oauth_connections` | 10 | `id` | → `users.id` (user_id) |
| `user_memory` | 12 | `id` | → `users.id` (user_id) |

**`users` columns:** id, email (unique, case-insensitive), name, password_hash, created_at (timestamptz), updated_at (timestamptz), stripe_subscription_id, subscription_status, subscription_plan, subscription_expires_at, subscription_updated_at, company_id → companies, role (default: 'candidate'), company_name, google_id, linkedin_id, oauth_provider, avatar_url

### 2. Companies & Employees (5 tables)

| Table | Columns | PK | Key Relationships |
|---|---|---|---|
| `companies` | 23 | `id` (serial) | → `users.id` (owner_id) |
| `employees` | 15 | `id` | → `users.id` (user_id, employer_id) |
| `employee_benefits` | 12 | `id` | → `employees.id` (employee_id) |
| `company_policies` | 11 | `id` | ⚠️ `company_id` → `users.id` (BUG) |
| `company_ratings` | 19 | `id` | → `companies.id`, `users.id`, `jobs.id` |

**`companies` columns:** id, owner_id → users, name (NOT NULL), slug (unique), email_domain, logo_url, website, description, industry, company_size, founded_year, headquarters, linkedin_url, is_verified, verified_at, created_at, updated_at, culture_description, core_values (jsonb), benefits (jsonb), office_locations (jsonb), primary_country, operating_countries (jsonb)

### 3. Jobs & Applications (8 tables)

| Table | Columns | PK | Key Relationships |
|---|---|---|---|
| `jobs` | 18 | `id` (serial) | → `companies.id`, `users.id` (user_id) |
| `job_applications` | 15 | `id` | → `jobs.id`, `users.id` (candidate_id), `companies.id` |
| `job_analytics` | 10 | `id` | → `jobs.id` |
| `job_embeddings` | 7 | `id` | → `jobs.id` (unique) |
| `job_recommendations` | 10 | `id` | → `jobs.id`, `users.id` |
| `saved_jobs` | 5 | `id` | → `jobs.id`, `users.id` |
| `pipeline_automation_rules` | 12 | `id` | → `jobs.id`, `users.id` (recruiter_id) |
| `recruiter_preferences` | 9 | `id` | → `users.id` (unique) |

**`jobs` columns:** id, user_id → users, title (NOT NULL), company (varchar), description, requirements, location, salary_range, job_type (default: 'full-time'), status (default: 'active'), created_at, updated_at, company_id → companies, screening_questions (jsonb), country_code, currency_code, salary_min (numeric), salary_max (numeric)

**`job_applications` columns:** id, job_id → jobs, candidate_id → users, company_id → companies, status (default: 'applied'), resume_url, cover_letter, omniscore_at_apply, recruiter_notes, applied_at, updated_at, match_score, screening_answers (jsonb), screening_status, screening_score (numeric)

### 4. Candidates (5 tables)

| Table | Columns | PK | Key Relationships |
|---|---|---|---|
| `candidate_profiles` | 28 | `id` | → `users.id` (unique) |
| `candidate_skills` | 10 | `id` | → `users.id` |
| `candidate_embeddings` | 8 | `id` | → `users.id` (unique) |
| `candidate_feedback` | 12 | `id` | → `users.id`, `companies.id`, `interviews.id`, `jobs.id` |
| `candidate_onboarding_data` | 54 | `id` | → `users.id`, `onboarding_checklists.id` |

**`candidate_profiles` columns:** id, user_id, headline, bio, location, phone, linkedin_url, github_url, portfolio_url, resume_url, photo_url, availability (default: 'immediately'), salary_min, salary_max, preferred_job_types (jsonb), preferred_locations (jsonb), remote_preference (default: 'hybrid'), years_experience, created_at, updated_at, work_authorization, certifications (jsonb), preferred_industries (jsonb), visa_sponsorship_needed, notice_period, willing_to_relocate, preferred_company_size (jsonb), cover_letter_template

### 5. Interviews (8 tables)

| Table | Columns | PK | Key Relationships |
|---|---|---|---|
| `interviews` | 14 | `id` | → `jobs.id`, `users.id` |
| `interview_questions` | 6 | `id` | (standalone question bank) |
| `interview_evaluations` | 12 | `id` | → `users.id` (candidate_id), `companies.id`, `jobs.id` |
| `interview_analysis` | 10 | `id` | → `interviews.id` |
| `interview_composite_scores` | 15 | `id` | → `users.id`, `companies.id`, `jobs.id` |
| `interview_reminders` | 7 | `id` | → `scheduled_interviews.id`, `users.id` |
| `scheduled_interviews` | 17 | `id` | → `users.id` (candidate, recruiter), `companies.id`, `jobs.id` |
| `scheduling_preferences` | 10 | `id` | → `users.id` (unique) |

### 6. Assessments & Screening (11 tables)

| Table | Columns | PK | Key Relationships |
|---|---|---|---|
| `assessment_sessions` | 18 | `id` | → `users.id`, `candidate_skills.id`, `jobs.id` |
| `assessment_questions` | 10 | `id` | (standalone) |
| `assessment_conversations` | 7 | `id` | → `job_assessment_attempts.id`, `job_assessment_questions.id` |
| `assessment_events` | 5 | `id` | → `assessment_sessions.id` |
| `job_assessments` | 15 | `id` | → `jobs.id`, `users.id` (created_by) |
| `job_assessment_questions` | 15 | `id` | → `job_assessments.id` |
| `job_assessment_attempts` | 21 | `id` | → `job_assessments.id`, `users.id` |
| `screening_sessions` | 19 | `id` | → `screening_templates.id`, `companies.id`, `jobs.id`, `users.id`, `job_applications.id` |
| `screening_templates` | 12 | `id` | → `companies.id`, `users.id`, `jobs.id` |
| `screening_answers` | 10 | `id` | → `jobs.id`, `question_bank.id`, `users.id` |
| `skill_assessments` | 18 | `id` | → `assessment_sessions.id`, `candidate_skills.id`, `users.id` |

### 7. Scoring & OmniScore (9 tables)

| Table | Columns | PK | Key Relationships |
|---|---|---|---|
| `omni_scores` | 10 | `id` | → `users.id` (unique) |
| `omniscore_results` | 10 | `id` | → `users.id` (unique) |
| `score_components` | 12 | `id` | → `users.id` |
| `score_history` | 9 | `id` | → `users.id` |
| `score_appeals` | 12 | `id` | → `users.id` (user + reviewer) |
| `role_scores` | 6 | `id` | → `users.id` |
| `trust_scores` | 11 | `id` | → `companies.id` (unique) |
| `trust_score_components` | 12 | `id` | → `companies.id` |
| `trust_score_history` | 8 | `id` | → `companies.id` |

**`omni_scores` columns:** id, user_id, total_score (default: 300), interview_score, technical_score, resume_score, behavior_score, score_tier (default: 'new'), last_updated, created_at

### 8. Matching (3 tables)

| Table | Columns | PK | Key Relationships |
|---|---|---|---|
| `match_results` | 19 | `id` | → `users.id` (candidate), `jobs.id` |
| `mutual_matches` | 11 | `id` | → `users.id`, `companies.id`, `jobs.id` |
| `recruiter_feedback` | 7 | `id` | → `users.id` (candidate, recruiter), `jobs.id` |

**`match_results` columns:** id, candidate_id, job_id, similarity_score, weighted_score, omniscore_at_match, trustscore_at_match, matching_skills (jsonb), missing_skills (jsonb), match_explanation (jsonb), match_level, calculated_at, experience_score, education_score, salary_fit_score, location_score, interview_score, assessment_score, dimension_breakdown (jsonb)

### 9. Communications (4 tables)

| Table | Columns | PK | Key Relationships |
|---|---|---|---|
| `communications` | 19 | `id` | → `users.id` (recruiter, candidate), `jobs.id`, self-ref `parent_id` |
| `communication_templates` | 13 | `id` | (standalone, indexed by company_id) |
| `communication_sequences` | 10 | `id` | (indexed by company_id) |
| `sequence_enrollments` | 11 | `id` | → `users.id`, `jobs.id`, `communication_sequences.id` |

### 10. Offers & Onboarding (7 tables)

| Table | Columns | PK | Key Relationships |
|---|---|---|---|
| `offers` | 30 | `id` | → `users.id` (candidate, recruiter), `jobs.id`, ⚠️ `company_id` → `users.id` (BUG) |
| `offer_templates` | 8 | `id` | ⚠️ `company_id` → `users.id` (BUG) |
| `onboarding_plans` | 19 | `id` | → `users.id`, `offers.id`, `jobs.id`, ⚠️ `company_id` → `users.id` (BUG) |
| `onboarding_tasks` | 17 | `id` | → `onboarding_plans.id`, `users.id` |
| `onboarding_checklists` | 12 | `id` | → `users.id`, `offers.id` |
| `onboarding_chats` | 10 | `id` | → `users.id`, `onboarding_checklists.id`, `onboarding_plans.id` |
| `onboarding_documents` | 25 | `id` | → `users.id` (candidate, verified_by), `onboarding_checklists.id`, `onboarding_plans.id`, ⚠️ `company_id` → `users.id` (BUG) |

### 11. Payroll & HR (5 tables)

| Table | Columns | PK | Key Relationships |
|---|---|---|---|
| `payroll_runs` | 17 | `id` | → `users.id` (employer, processed_by) |
| `paychecks` | 22 | `id` | → `employees.id`, `payroll_runs.id` |
| `payroll_configs` | 18 | `id` | → `employees.id` (unique) |
| `pay_periods` | 10 | `id` | (indexed by company_id, country_code) |
| `tax_documents` | 15 | `id` | → `employees.id`, `users.id` (employer) |

### 12. AI & ML (13 tables)

| Table | Columns | PK | Key Relationships |
|---|---|---|---|
| `ai_prompts` | 15 | `id` | (slug unique) |
| `ai_prompt_versions` | 15 | `id` | → `ai_prompts.id` |
| `ai_ab_tests` | 19 | `id` | → `ai_prompts.id` |
| `ai_call_log` | 18 | `id` | (indexed by module, provider, modality) |
| `ai_agent_actions` | 12 | `id` | → `users.id` |
| `ai_provider_stats` | 4 | `id` | (stat_key unique) |
| `ai_provider_verification` | 9 | `id` | (provider_key+modality unique) |
| `ai_verification_meta` | 5 | `id` | (singleton config) |
| `ai_token_budget_daily` | 16 | `id` | (date unique) |
| `agent_data` | 4 | `id` | (generic key-value) |
| `tts_cache` | 5 | `text_hash` | (TTS audio cache) |
| `parsed_resumes` | 8 | `id` | → `users.id` |
| `mock_interview_sessions` | 17 | `id` | → `users.id` |

### 13. Documents & Verification (5 tables)

| Table | Columns | PK | Key Relationships |
|---|---|---|---|
| `verification_documents` | 20 | `id` | → `users.id` |
| `document_verifications` | 19 | `id` | → `verification_documents.id`, `users.id` |
| `document_access_logs` | 9 | `id` | → `verification_documents.id`, `users.id`, `companies.id` |
| `document_score_impacts` | 10 | `id` | → `verification_documents.id`, `users.id` |
| `verified_credentials` | 12 | `id` | → `verification_documents.id`, `users.id` |

### 14. Compliance & Privacy (6 tables)

| Table | Columns | PK | Key Relationships |
|---|---|---|---|
| `consent_records` | 9 | `id` | → `users.id` |
| `data_requests` | 10 | `id` | → `users.id` (user + processor) |
| `data_retention_policies` | 7 | `id` | (data_type unique) |
| `audit_logs` | 9 | `id` | → `users.id` |
| `bias_reports` | 8 | `id` | → `users.id` (created_by) |
| `fairness_audits` | 10 | `id` | (standalone) |

### 15. Candidate Profile Extensions (4 tables)

| Table | Columns | PK | Key Relationships |
|---|---|---|---|
| `education` | 12 | `id` | → `users.id` |
| `work_experience` | 13 | `id` | → `users.id` |
| `portfolio_projects` | 14 | `id` | → `users.id` |
| `practice_sessions` | 15 | `id` | → `users.id` |

### 16. Reference Data & Other (7 tables)

| Table | Columns | PK | Key Relationships |
|---|---|---|---|
| `country_configs` | 17 | `id` | (country_code unique) |
| `country_document_types` | 11 | `id` | (country_code+document_key unique) |
| `question_bank` | 15 | `id` | → `users.id` (recruiter_id) |
| `activity_log` | 9 | `id` | (indexed by user_id, event_type, category) |
| `events` | 6 | `id` | → `users.id` |
| `post_hire_feedback` | 15 | `id` | → `users.id` (employee, manager) |
| `_migrations` | 3 | `id` | (schema migration tracking) |

---

## Foreign Key Relationship Map (160 FKs)

### Central Hub Tables (most referenced)

```
                              ┌─────────────────┐
                              │     users (18)   │  ← 57 FKs point here
                              │   PK: id         │
                              │   email (unique)  │
                              │   role, company_id│
                              └────────┬──────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
     ┌────────▼────────┐    ┌──────────▼──────────┐   ┌────────▼────────┐
     │  companies (23)  │    │    jobs (18)         │   │ candidate_      │
     │  PK: id          │    │    PK: id            │   │ profiles (28)   │
     │  owner_id→users  │    │    user_id→users     │   │ user_id→users   │
     │  slug (unique)   │    │    company_id→co.    │   │ (unique)        │
     └────────┬─────────┘    └──────────┬───────────┘   └─────────────────┘
              │                         │
    ┌─────────┼──────────┐    ┌─────────┼──────────────┐
    │         │          │    │         │              │
  trust_   screening  scheduled  job_    match_    job_
  scores   _templates _interviews applic. results  assessments
```

### FK Count by Target Table

| Target Table | Inbound FKs | Key Sources |
|---|---|---|
| `users` | **57** | Nearly every domain table references users |
| `jobs` | **18** | applications, assessments, screening, matching, interviews |
| `companies` | **11** | ratings, trust_scores, screening, scheduling, documents |
| `interviews` | **3** | analysis, feedback |
| `verification_documents` | **4** | verifications, access_logs, score_impacts, credentials |
| `onboarding_plans` | **2** | tasks, documents |
| `onboarding_checklists` | **3** | chats, documents, onboarding_data |
| `offers` | **2** | onboarding_checklists, onboarding_plans |
| `employees` | **4** | benefits, paychecks, payroll_configs, tax_documents |
| `assessment_sessions` | **2** | events, skill_assessments |
| `candidate_skills` | **2** | assessment_sessions, skill_assessments |
| `ai_prompts` | **2** | versions, ab_tests |
| `job_assessments` | **2** | questions, attempts |
| `question_bank` | **1** | screening_answers |
| `screening_templates` | **1** | screening_sessions |
| `job_applications` | **1** | screening_sessions |
| `communication_sequences` | **1** | sequence_enrollments |
| `scheduled_interviews` | **1** | interview_reminders |
| `payroll_runs` | **1** | paychecks |
| `job_assessment_attempts` | **1** | assessment_conversations |
| `job_assessment_questions` | **1** | assessment_conversations |
| `communications` | **1** | self-referential (parent_id) |

---

## Index Coverage Summary (294 indexes)

### Index Types

| Type | Count | Usage |
|---|---|---|
| B-tree (PK) | 105 | Every table has a primary key |
| B-tree (UNIQUE) | ~45 | Composite unique constraints, natural keys |
| B-tree (regular) | ~140 | FK columns, query filters, sorting |
| B-tree (partial) | 4 | Conditional filtering (active records, pending sends) |
| B-tree (expression) | 2 | `LOWER(email)` on users, `recruiter_id+question_text` on question_bank |
| IVFFlat (vector) | 2 | candidate_embeddings.embedding, job_embeddings.embedding |

### Notable Partial Indexes

| Table | Index | Condition |
|---|---|---|
| `interview_reminders` | `idx_interview_reminders_send` | `WHERE sent = false` |
| `sequence_enrollments` | `idx_seq_enrollments_next_send` | `WHERE status = 'active'` |
| `screening_answers` | `idx_screening_answers_user_question` | `WHERE question_text IS NOT NULL` |
| `question_bank` | `idx_question_bank_recruiter_text` | `WHERE recruiter_id IS NOT NULL` |

### Vector Indexes (pgvector)

| Table | Index | Type | Config |
|---|---|---|---|
| `candidate_embeddings` | `idx_candidate_embeddings_vector` | IVFFlat | `vector_cosine_ops`, lists=100 |
| `job_embeddings` | `idx_job_embeddings_vector` | IVFFlat | `vector_cosine_ops`, lists=100 |

### Tables With Best Index Coverage (5+ indexes)

| Table | Index Count | Indexes |
|---|---|---|
| `ai_call_log` | 6 | PK + module, provider, modality, success, created_at |
| `activity_log` | 5 | PK + user_id, event_type, category, created_at |
| `audit_logs` | 5 | PK + user_id, action_type, target_type+id, created_at |
| `screening_sessions` | 7 | PK + candidate, job, status, token (unique), invite_token |
| `candidate_embeddings` | 4 | PK + user_id (unique), user_id, vector |
| `events` | 5 | PK + user_id, event_type, session_id, created_at |
| `mutual_matches` | 5 | PK + candidate, company, fit_score, unique(candidate+company+job) |
| `match_results` | 5 | PK + candidate, job, score, unique(candidate+job) |
| `company_ratings` | 4 | PK + company, candidate, unique(company+candidate) |
| `question_bank` | 5 | PK + jd_hash, role, type, recruiter+text (partial unique) |

### Tables Missing FK Indexes (potential performance issues)

All FK columns appear to have corresponding indexes based on the introspection. This is good — PostgreSQL doesn't auto-create FK indexes, so these were added explicitly.

---

## ⚠️ Known Schema Issues

### CRITICAL: Foreign Key Corruption (5 tables)

Five tables have `company_id` FK pointing to `users.id` instead of `companies.id`:

| Table | Column | Points To | Should Point To |
|---|---|---|---|
| `offers` | `company_id` | `users.id` ❌ | `companies.id` |
| `offer_templates` | `company_id` | `users.id` ❌ | `companies.id` |
| `onboarding_documents` | `company_id` | `users.id` ❌ | `companies.id` |
| `onboarding_plans` | `company_id` | `users.id` ❌ | `companies.id` |
| `company_policies` | `company_id` | `users.id` ❌ | `companies.id` |

**Impact:** Silent data corruption risk. JOINs on `company_id` return wrong data. Any `company_id` value stored is actually a user ID.

### HIGH: Timestamp Type Inconsistency

- `users` table uses `timestamp with time zone` (correct) ✅
- All other tables use `timestamp without time zone` ❌
- Risk: Time zone bugs in multi-region deployments

### MEDIUM: PK Type — serial vs IDENTITY

- All tables use `integer` with `nextval()` (serial pattern)
- Best practice: `BIGINT GENERATED ALWAYS AS IDENTITY`
- Risk: Integer overflow at ~2.1B rows (unlikely near-term)

### MEDIUM: varchar vs text

- Heavy use of `character varying` without length constraints
- Best practice: Use `text` with `CHECK` constraints for validation
- Impact: No functional difference, but inconsistent with PostgreSQL conventions

### LOW: Nullable FK Columns

- Most FK columns are nullable (e.g., `interviews.job_id`, `job_applications.candidate_id`)
- Some should likely be `NOT NULL` (e.g., a job_application without a candidate_id is nonsensical)

### LOW: Circular FK (users ↔ companies)

- `users.company_id → companies.id`
- `companies.owner_id → users.id`
- Requires careful insert ordering (create user first without company_id, create company with owner_id, update user with company_id)

---

## Schema Statistics

| Metric | Value |
|---|---|
| Total tables | 105 |
| Total columns | ~1,250 |
| Foreign keys | 160 |
| Indexes | 294 |
| Unique constraints | ~45 |
| Vector indexes | 2 |
| Partial indexes | 4 |
| Expression indexes | 2 |
| JSONB columns | ~40+ |
| Tables with 20+ columns | 8 (candidate_onboarding_data: 54, offers: 30, candidate_profiles: 28, onboarding_documents: 25, companies: 23, paychecks: 22, job_assessment_attempts: 21, verification_documents: 20) |
| Largest table by columns | `candidate_onboarding_data` (54 columns) |
| Most-referenced table | `users` (57 inbound FKs) |

---

## Recommendations for ARCHITECTURE_TARGET.md

### P0 — Fix FK Corruption
- Migrate 5 tables to correctly reference `companies.id`
- Requires data migration (current values are user IDs, need company IDs)
- Must be done carefully to avoid breaking existing queries

### P1 — Standardize Timestamps
- Migrate all `timestamp without time zone` → `timestamptz`
- Add `ALTER TABLE ... ALTER COLUMN ... TYPE timestamptz` for affected columns
- ~100+ columns across ~100 tables

### P1 — Add NOT NULL Constraints
- Audit nullable FK columns that should be required
- Priority: `job_applications.candidate_id`, `job_applications.job_id`, `interviews.user_id`

### P2 — Normalize `candidate_onboarding_data`
- 54 columns is excessive — likely a wide denormalized table
- Consider splitting into related sub-tables or using JSONB for flexible fields

### P2 — Consider BIGINT Migration
- Move from `serial` (int4) to `BIGINT GENERATED ALWAYS AS IDENTITY`
- Low urgency but future-proofs the schema

### P3 — Review JSONB Usage
- Several tables store structured data in JSONB that could benefit from proper normalization
- Example: `match_results.matching_skills`, `match_results.missing_skills` → could be junction tables
- Trade-off: JSONB is flexible and read-performant for these use cases

### P3 — Index Optimization
- Consider GIN indexes on frequently queried JSONB columns
- Review if IVFFlat `lists=100` is optimal for current data volumes (re-tune as data grows)
- Add covering indexes (`INCLUDE`) for common query patterns to enable index-only scans
