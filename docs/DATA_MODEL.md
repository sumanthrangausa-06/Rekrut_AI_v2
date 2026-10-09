# Rekrut_AI_v2 Data Model

**Issue:** #518 | **Last verified:** 2026-10-09 (against `origin/dev`)

This document describes the database architecture: which table owns which concept,
the known traps, and the conventions for keeping views in sync with their source tables.

---

## 1. Overview

- **~223 tables**, 133 migration files, ~610 indexes
- **Hybrid schema:** relational core + ~178 JSONB columns for flexible/evolving fields
- **pgvector** extension: `vector(1536)` embeddings on `candidate_embeddings` and `job_embeddings` for semantic search
- **Core design:** everything hangs off `users.id`. Candidates and recruiters are both
  rows in `users`, differentiated by the `role` column (`'candidate'` / `'recruiter'` / etc.).
  `candidate_profiles` extends `users` 1:1 via `user_id`.
- **No PostgreSQL enums** — status fields use VARCHAR + CHECK constraints
  (e.g. `interview_events.status` has an explicit CHECK list).

### Core relationship diagram

```
users (id, role, name, avatar_url)
 ├── candidate_profiles (user_id UNIQUE → users.id)
 │    ├── candidate_skills (user_id → users.id)
 │    ├── work_experience (user_id → users.id)
 │    └── parsed_resumes (user_id → users.id)
 ├── companies (owner_id → users.id)
 │    └── jobs (user_id → users.id [poster])
 │         └── job_applications (job_id → jobs.id, candidate_id → users.id)
 │              ├── interview_events (job_application_id → job_applications.id)  [System B]
 │              └── interview_sessions (application_id → job_applications.id)    [AI]
 ├── scheduled_interviews (candidate_id → users.id, recruiter_id → users.id)    [System A]
 ├── omni_scores (user_id UNIQUE → users.id)
 └── user_notifications (user_id → users.id)
```

---

## 2. The `users` vs `candidate_profiles` split (READ THIS FIRST)

### The trap

`name` and `avatar_url` live on **`users`**, NOT on `candidate_profiles`.
`candidate_profiles` has `photo_url` but no `name` or `avatar_url` column.

This is the single most common source of silent bugs in this codebase.

### Verified schema

`users` (`migrate.js:65`):
```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  name VARCHAR(255),              -- ← name lives HERE
  role VARCHAR(50) DEFAULT 'candidate',
  company_name VARCHAR(255),
  avatar_url TEXT,                -- ← avatar_url lives HERE
  ...
)
```

`candidate_profiles` (`migrations/004_candidate_profiles.js:9`):
```sql
CREATE TABLE IF NOT EXISTS candidate_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  headline VARCHAR(200),
  bio TEXT,
  location VARCHAR(255),
  ...
  photo_url VARCHAR(500),         -- ← photo_url, NOT avatar_url
  ...
  -- NO name column. NO avatar_url column.
)
```

### Correct join pattern

The canonical example is `GET /candidate/profile` (`routes/candidate.js:138`):

```sql
SELECT cp.*, u.name, u.email, u.avatar_url, os.total_score as omni_score,
  (SELECT original_filename FROM parsed_resumes
    WHERE user_id = u.id AND file_url = cp.resume_url
    ORDER BY id DESC LIMIT 1) as resume_filename
FROM users u
LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
LEFT JOIN omni_scores os ON os.user_id = u.id
WHERE u.id = $1
```

**Rule:** when you need a candidate's name or avatar, always join `users`.
Never read `p.name` or `p.avatar_url` from a `candidate_profiles` row — those
columns do not exist and will silently return NULL.

### Cautionary tale: bug #515

The dashboard completeness formula read `p.name` and `p.avatar_url` from a
`SELECT * FROM candidate_profiles` result. Both were always NULL, so two fields
were permanently counted missing — the dashboard showed 75% while the profile
page (which correctly falls back to `users.name` / `users.avatar_url`) showed 92%.
Fixed by querying `users` for name/avatar with `candidate_profiles.photo_url`
as fallback. This document exists so the next developer doesn't repeat it.

### Future direction

Issue #517 proposes `v_candidate_full_profile`, a view that resolves this join
once. Until it lands, hand-roll the join exactly as shown above.

---

## 3. Table groups

### Users & Auth
| Table | Key columns |
|-------|-------------|
| `users` | id, email, role, name, avatar_url, company_name |
| `user_roles`, `roles`, `permissions`, `role_permissions` | New RBAC (most users still on legacy fallback) |
| `refresh_tokens`, `oauth_exchange_codes`, `oauth_connections`, `password_reset_tokens` | Auth/session |
| `user_settings`, `notification_preferences` | Per-user config |

### Candidate Profile
| Table | Key columns |
|-------|-------------|
| `candidate_profiles` | user_id (UNIQUE FK→users), headline, bio, location, resume_url, photo_url, years_experience |
| `candidate_skills` | user_id, skill_name, level (1–5), is_verified, verified_score. UNIQUE(user_id, skill_name) |
| `work_experience`, `education`, `portfolio_projects` | Standard profile sections |
| `parsed_resumes`, `cv_uploads` | Resume storage + parsing |
| `candidate_embeddings` | user_id, embedding vector(1536) — pgvector semantic search |
| `linkedin_profiles` | LinkedIn OAuth data |

**Skill verification:** when a candidate passes a skill assessment,
`routes/assessments.js:928` sets `is_verified = true`, `verified_at`, and
`verified_score` on the matching `candidate_skills` row. This is the system's
objective skill signal, distinct from human endorsements.

### Companies & Recruiters
| Table | Key columns |
|-------|-------------|
| `companies` | id, owner_id (FK→users), name, slug, email_domain, is_verified |
| `departments`, `department_members` | Org structure |
| `company_ratings`, `company_review_responses` | Reviews |

### Jobs & Applications
| Table | Key columns |
|-------|-------------|
| `jobs` | id, user_id (FK→users, the poster), title, company (TEXT), description, salary_range, status |
| `job_applications` | job_id, candidate_id (FK→users), company_id, status, UNIQUE(job_id, candidate_id) |
| `job_embeddings` | vector(1536) for job matching |
| `saved_jobs`, `saved_searches` | Candidate bookmarks |

**Note on `jobs.company`:** the base `jobs` table has both a free-text `company`
column and a `company_id` FK. Both are populated on insert; reads use a
COALESCE-style fallback chain. This is intentional — do not "fix" it.

### Human Interviews — two systems, one view
| Table | Role |
|-------|------|
| `scheduled_interviews` | **System A (live):** single fixed `scheduled_at`, candidate accept/decline/change-request, static meeting links |
| `interview_events` | **System B (slot negotiation):** recruiter proposes slots, candidate picks one, LiveKit/Jitsi meeting data |
| `proposed_slots` | Proposed times for System B negotiation |
| `unified_interviews` | **VIEW** combining both with `source_system` discriminator (`migrations/236`, `237`) |

**API:** `routes/interviews-unified.js` —
`GET /my-interviews` (:27), `POST /unified` (:44),
`POST /unified/:id/confirm-slot` (:71), `GET /:id/join` (:95, link expiry).

**Supporting tables:** `interview_panels`, `panel_members`, `panel_notes`,
`interview_recordings`, `interview_transcripts`, `interview_feedback`,
`interview_evaluations`, `scorecards`, `interview_reminders`, `scheduling_preferences`.

### AI Interviews
| Table | Role |
|-------|------|
| `interview_sessions` | type ('screening'/'ai_interview'), invite_token, status, config JSONB |
| `mock_interview_sessions`, `practice_sessions` | Practice flows |
| `screening_sessions`, `screening_questions`, `screening_responses` | AI screening engine |
| `interview_rooms` | LiveKit room management |

**Note:** the base `interviews` table (from `migrate.js`) is **LIVE** — it stores
AI interview sessions (`routes/interviews.js` actively INSERT/UPDATE/SELECTs it).
Do not treat it as dead.

### Assessments — three overlapping systems
| Tables | Used by |
|--------|---------|
| `aptitude_tests`, `aptitude_questions`, `aptitude_test_attempts`, `aptitude_test_assignments` | `routes/aptitude.js` |
| `skill_assessments`, `assessment_sessions`, `assessment_questions`, `assessment_events` | `routes/assessments.js` |
| `job_assessments`, `job_assessment_questions`, `job_assessment_attempts` | `routes/assessments.js` |
| `coding_templates`, `coding_test_cases`, `coding_submissions`, `coding_scores` | Coding challenges |
| `question_bank` | Shared question pool |

This is the same "three ways to do X" sprawl interviews had before unification.
Issue #523 proposes `v_unified_assessments` following the `unified_interviews` pattern.

### Scoring
| Table | Role |
|-------|------|
| `omni_scores` | user_id (UNIQUE), total_score, component scores, score_tier |
| `score_components`, `score_history`, `role_scores` | Breakdown & history |
| `trust_scores`, `trust_score_components` | Trust scoring |

### Notifications & Comms
| Table | Role |
|-------|------|
| `user_notifications` | user_id, type, title, message, read, metadata JSONB (may contain `url` for click-through) |
| `notification_queue`, `email_queue` | Outbound delivery |
| `conversations`, `messages` | In-app messaging |
| `notification_templates`, `notification_preferences` | Templates & settings |

**Audit pending:** 6 notification-related tables exist; issue #519 tracks which
are actually live in the send path.

### Compliance & Verification
`document_verifications`, `verification_documents`, `background_checks`,
`reference_checks`, `audit_logs`, `compliance_audit_trail`, `consent_records`,
`bias_reports`, `fairness_audits`.

### Payroll & Offers
`offers`, `offer_templates`, `payroll_runs`, `paychecks`, `employees`,
`tax_documents`, `onboarding_plans`, `onboarding_tasks`, `onboarding_documents`.

---

## 4. Views

### Regular views
| View | Source tables | Defined in | Status |
|------|---------------|------------|--------|
| `unified_interviews` | `scheduled_interviews`, `interview_events`, `proposed_slots`, `job_applications` | `migrations/236_unified_interviews_view.js`, `237_unified_interviews_view_slot_ids.js` | **Live.** Read by `services/interview-service.js`. Missing columns (`outcome`, `feedback`, `job_application_id`) are a deliberate union-compatible subset, not staleness. |

### Materialized views (DEAD — see issue #520)
| View | Defined in | Status |
|------|------------|--------|
| `mv_daily_metrics` | `migrations/p3c_analytics_materialized_views.js:18` | Never refreshed, never read |
| `mv_candidate_funnel` | `:81` | Never refreshed, never read |
| `mv_company_engagement_summary` | `:103` | Never refreshed, never read |
| `mv_time_to_hire` | `:132` | Never refreshed, never read |
| `mv_candidate_skill_distribution` | `:159` | Never refreshed, never read |

Zero `REFRESH MATERIALIZED VIEW` calls and zero references in routes/services/frontend.
Analytics endpoints query the `events` table directly with the in-memory
`lib/analytics-cache.js`. Pending Sumanth's decision (issue #520): drop or integrate.

---

## 5. View maintenance convention

**Rule:** any migration that changes a view's source table MUST `CREATE OR REPLACE`
that view in the same migration.

**Why:** views don't update automatically. When a column is added to a source table,
the view silently omits it until someone redefines the view. The 5 dead materialized
views are what happens with no maintenance at all.

**How:**
1. Views use explicit column lists, never `SELECT *`.
2. The migration that ALTERs the table includes the updated `CREATE OR REPLACE VIEW`.
3. CI compares view columns against source-table columns and fails on mismatch.

**Example workflow** — adding `portfolio_url`:
```js
// migrations/137_add_portfolio_url.js
exports.up = async (client) => {
  await client.query(`
    ALTER TABLE candidate_profiles
    ADD COLUMN IF NOT EXISTS portfolio_url TEXT;
  `);
  await client.query(`
    CREATE OR REPLACE VIEW v_candidate_full_profile AS
    SELECT u.id, u.name, u.email, u.avatar_url,
           cp.headline, cp.bio, cp.location, cp.photo_url,
           cp.portfolio_url,          -- new column added here
           cp.years_experience,
           os.total_score AS omni_score
    FROM users u
    LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    LEFT JOIN omni_scores os ON os.user_id = u.id;
  `);
};
```

---

## 6. Known traps (don't repeat these)

1. **`candidate_profiles` has no `name`/`avatar_url`.** They're on `users`. See §2 and bug #515.
2. **`jobs.company` (TEXT) + `company_id` (FK) is intentional.** Both populated on insert; reads fall back. Don't normalize it.
3. **Base `interviews` table is live.** It stores AI interview sessions. Don't drop it.
4. **JSONB is deliberate.** ~178 JSONB columns hold config, preferences, and score breakdowns that genuinely vary. Don't normalize for purity.
5. **CHECK constraints instead of PG enums.** Works fine and is arguably more portable. Don't "fix" it.
6. **Duplicate `CREATE TABLE` across migrations.** All use `IF NOT EXISTS`; harmless. Don't churn them.
7. **Assessment table overlap.** Three systems exist; check all three before adding a fourth. See issue #523.
8. **Interview table sprawl.** 16 interview-related tables. New interview features should go through `interview-service.js` / the unified view, not new tables.

---

## 7. Related issues

- #515 — dashboard completeness bug (the `users`/`candidate_profiles` trap)
- #517 — `v_candidate_full_profile` VIEW proposal
- #519 — notification table audit
- #520 — dead materialized views decision
- #521 — dashboard query consolidation
- #522 — extend cache to candidate hot paths
- #523 — `v_unified_assessments` VIEW proposal
