# HireLoop Schema Improvements Roadmap

Last updated: 2026-02-14

## Priority Levels
- **P0**: Data corruption / integrity violations → immediate fix
- **P1**: Missing constraints / wrong types → next priority
- **P2**: Missing features / optimization → planned
- **P3**: Nice-to-have / cosmetic → backlog

---

## P0: Foreign Key Corruption ✅ RESOLVED

**Resolved**: 2026-02-14 by Task #31581 (commit `7044a42`)

### Issue
5 tables had `company_id` FK pointing to `users.id` instead of `companies.id`:
- `offers.company_id`
- `offer_templates.company_id`
- `interview_evaluations.company_id`
- `interview_composite_scores.company_id`
- `scheduled_interviews.company_id`

### Fix Applied
- Dropped incorrect FK constraints → recreated pointing to `companies.id`
- Added missing index on `offer_templates.company_id`
- Verified all company_id values reference valid companies
- **Result**: 160 FKs (5 dropped + 5 recreated), 295 indexes (+1 new)

---

## P1: Interview Flow Schema Issues ✅ RESOLVED

**Resolved**: 2026-02-14 by Task #31590 (commit `30f0fb6`, migration `p1_interview_flow_schema`)

### Issues Found (via direct schema inspection)

#### 1. Wrong timestamp type — `timestamp without time zone` → `timestamptz`
All 8 interview tables used `timestamp without time zone`. PostgreSQL best practice requires `timestamptz` to avoid timezone bugs.

**Tables fixed** (20 columns total):
| Table | Columns Converted |
|-------|-------------------|
| interviews | created_at, completed_at, updated_at |
| scheduled_interviews | scheduled_at, created_at, updated_at |
| interview_questions | created_at |
| interview_evaluations | created_at |
| interview_analysis | created_at |
| interview_composite_scores | created_at |
| interview_reminders | send_at, created_at |
| mock_interview_sessions | started_at, completed_at |

#### 2. Missing NOT NULL constraints on critical columns
FK columns, status fields, and timestamps were nullable despite always having values or defaults.

**Constraints added**:
| Table | Columns Set NOT NULL |
|-------|---------------------|
| interviews | user_id, status, interview_type, created_at, updated_at |
| scheduled_interviews | company_id, job_id, candidate_id, interview_type, status, created_at, updated_at |
| interview_evaluations | created_at |
| interview_analysis | interview_id, created_at |
| interview_composite_scores | created_at |
| interview_questions | created_at |
| interview_reminders | interview_id, recipient_id, sent, created_at |
| mock_interview_sessions | user_id, status, started_at |

#### 3. Missing FK constraints
`interview_evaluations` and `interview_composite_scores` had FK columns without actual constraints.

**FKs added** (4 new):
| Table | Column | References |
|-------|--------|------------|
| interview_evaluations | interview_id | interviews.id |
| interview_evaluations | screening_session_id | screening_sessions.id |
| interview_composite_scores | interview_id | interviews.id |
| interview_composite_scores | screening_session_id | screening_sessions.id |

#### 4. Missing FK indexes
14 FK columns lacked indexes, causing slow JOINs and lock contention.

**Indexes added** (14 new):
| Table | Index Name | Column |
|-------|-----------|--------|
| interviews | idx_interviews_user_id | user_id |
| interviews | idx_interviews_job_id | job_id |
| interview_evaluations | idx_interview_evaluations_interview_id | interview_id |
| interview_evaluations | idx_interview_evaluations_job_id | job_id |
| interview_evaluations | idx_interview_evaluations_company_id | company_id |
| interview_composite_scores | idx_interview_composite_scores_interview_id | interview_id |
| interview_composite_scores | idx_interview_composite_scores_job_id | job_id |
| interview_composite_scores | idx_interview_composite_scores_company_id | company_id |
| interview_composite_scores | idx_interview_composite_scores_screening | screening_session_id |
| interview_reminders | idx_interview_reminders_interview_id | interview_id |
| interview_reminders | idx_interview_reminders_recipient_id | recipient_id |
| scheduled_interviews | idx_scheduled_interviews_candidate_id | candidate_id |
| scheduled_interviews | idx_scheduled_interviews_recruiter_id | recruiter_id |
| scheduled_interviews | idx_scheduled_interviews_job_id | job_id |

#### 5. Missing `updated_at` columns
5 tables lacked `updated_at` — critical for tracking data modifications.

**Columns added** (all `timestamptz NOT NULL DEFAULT now()`):
- interview_evaluations.updated_at
- interview_analysis.updated_at
- interview_composite_scores.updated_at
- interview_questions.updated_at
- interview_reminders.updated_at

### Result
- **FKs**: 160 → **164** (+4 new constraints)
- **Indexes**: 295 → **309** (+14 new indexes)
- **Columns**: ~1,250 → **1,358** (+5 updated_at + other table growth)
- **Data integrity**: Zero orphaned records, zero NULL violations

---

## P2: Broader Schema Hardening (Open)

These are planned improvements that don't block functionality but improve data quality.

### 2a. CHECK constraints on status/type columns
Add CHECK constraints to validate allowed values:
- `interviews.status` CHECK IN ('pending', 'in_progress', 'completed', 'cancelled')
- `interviews.interview_type` CHECK IN ('mock', 'video', 'phone', 'technical', 'panel')
- `scheduled_interviews.status` CHECK IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'rescheduled', 'no_show')
- `scheduled_interviews.interview_type` CHECK IN ('video', 'phone', 'technical', 'panel', 'onsite')
- `mock_interview_sessions.status` CHECK IN ('in_progress', 'completed', 'abandoned')

**Note**: Requires backend code audit first — Engineering agent should verify all status values used in code match the CHECK constraints.

### 2b. varchar → text conversion
Multiple tables use `character varying` instead of `text`. Per PostgreSQL best practices, `text` with CHECK length constraints is preferred.

**Affected tables**: interviews, scheduled_interviews, interview_questions, mock_interview_sessions, screening_sessions, and others.

### 2c. Screening sessions timestamp fix
`screening_sessions` also uses `timestamp without time zone` on 5 columns (invited_at, started_at, completed_at, expires_at, created_at). Should be converted to `timestamptz` and add NOT NULL + updated_at.

### 2d. Missing NOT NULL on remaining interview FK columns
Some FK columns remain nullable where they could be NOT NULL:
- `interview_evaluations.interview_id` (nullable — could be required)
- `interview_evaluations.candidate_id`, `job_id`, `company_id` (nullable — depends on use case)
- `interview_composite_scores.*` FK columns (same pattern)

**Note**: Requires Engineering agent to verify these columns can be NOT NULL based on application logic.

---

## P3: Long-term Optimization (Backlog)

### 3a. Partitioning for large tables
If `interviews`, `mock_interview_sessions`, or `interview_analysis` grow past 10M rows, consider range partitioning by `created_at`.

### 3b. Materialized views for scoring
`interview_composite_scores` could benefit from materialized view for aggregated scoring dashboards.

### 3c. Soft delete pattern
Consider adding `deleted_at` columns for soft-delete instead of hard delete on interview-related tables.

### 3d. Audit trail
Add trigger-based audit logging for interview_evaluations and interview_composite_scores to track score changes over time.
