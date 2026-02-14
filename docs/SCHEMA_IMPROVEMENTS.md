# Database Schema Improvement Roadmap

> Target state recommendations for HireLoop database schema
> Generated: 2026-02-14

## Priority Matrix

| Priority | Issue | Impact | Effort | Tables Affected |
|---|---|---|---|---|
| **P0** | FK corruption (company_id → users) | Data integrity | Medium | 5 |
| **P1** | Timestamp standardization | Time zone bugs | High | ~100 |
| **P1** | NOT NULL on required FKs | Data integrity | Low | ~20 |
| **P2** | Normalize candidate_onboarding_data | Maintainability | Medium | 1 |
| **P2** | Migrate serial → BIGINT IDENTITY | Future-proofing | High | 105 |
| **P3** | JSONB → junction tables where appropriate | Query flexibility | Medium | ~10 |
| **P3** | Index optimization (GIN, covering) | Performance | Low | ~15 |

## P0: Fix FK Corruption (CRITICAL)

### Problem
5 tables have `company_id` foreign key pointing to `users.id` instead of `companies.id`:
- `offers`
- `offer_templates`
- `onboarding_documents`
- `onboarding_plans`
- `company_policies`

### Migration Strategy
```sql
-- Step 1: Add new column
ALTER TABLE offers ADD COLUMN company_id_new INTEGER REFERENCES companies(id);

-- Step 2: Populate from user's company
UPDATE offers o
SET company_id_new = u.company_id
FROM users u
WHERE o.company_id = u.id AND u.company_id IS NOT NULL;

-- Step 3: Drop old FK, rename columns
ALTER TABLE offers DROP CONSTRAINT offers_company_id_fkey;
ALTER TABLE offers RENAME COLUMN company_id TO company_id_old;
ALTER TABLE offers RENAME COLUMN company_id_new TO company_id;

-- Step 4: Verify, then drop old column
-- ALTER TABLE offers DROP COLUMN company_id_old;
```

Repeat for all 5 tables. **Test thoroughly in staging first.**

## P1: Timestamp Standardization

### Problem
`users` table correctly uses `timestamptz`, but all other tables use `timestamp without time zone`.

### Migration
```sql
-- Safe migration — PostgreSQL interprets existing values as UTC
ALTER TABLE jobs ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE jobs ALTER COLUMN updated_at TYPE timestamptz;
-- Repeat for all tables...
```

**Note:** This requires a table rewrite for each column. Run during low-traffic window.

## P1: NOT NULL Constraints

### Key columns that should be NOT NULL:
- `job_applications.candidate_id` — application must have a candidate
- `job_applications.job_id` — application must reference a job
- `interviews.user_id` — interview must have a user
- `candidate_skills.user_id` — skill must belong to a user
- `match_results.candidate_id` — match must have a candidate
- `match_results.job_id` — match must have a job

## P2: Normalize Wide Tables

### `candidate_onboarding_data` (54 columns)
This table likely contains form fields that should be stored as key-value pairs or in a JSONB column:
```sql
CREATE TABLE candidate_onboarding_responses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES users(id),
  checklist_id INTEGER NOT NULL REFERENCES onboarding_checklists(id),
  field_key TEXT NOT NULL,
  field_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## P3: Index Optimization

### Add GIN indexes for JSONB queries
```sql
CREATE INDEX idx_match_results_skills ON match_results USING GIN (matching_skills);
CREATE INDEX idx_candidate_profiles_preferences ON candidate_profiles USING GIN (preferred_job_types);
```

### Re-tune vector indexes as data grows
Current: `lists=100` (IVFFlat)
Rule of thumb: `lists = sqrt(row_count)`
At 10K candidates: lists=100 is fine
At 1M candidates: increase to lists=1000

---

*See `docs/DATABASE_SCHEMA.md` for the complete current-state schema reference.*
