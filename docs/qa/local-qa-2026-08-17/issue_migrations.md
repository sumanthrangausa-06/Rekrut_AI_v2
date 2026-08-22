## Problem

`npm run migrate` cannot build the schema from empty on `dev` @ `80326e3`. It aborts
part-way, leaving the database incomplete. Production's start command is
`npm run migrate && npm start`, so **promoting `dev` to production today would fail
the deploy**.

This has been invisible because Render's `rekrutai-staging` service runs `npm start`
only — it never migrates — even though `render.yaml` declares
`npm run migrate && npm start` for staging.

## Defects found

Verified by running every pending migration in its own transaction against a clean
PostgreSQL 17.6 database (`docs/qa/audit_migrations.js`).

| # | Migration | Error | Root cause |
|---|---|---|---|
| 1 | `migrate.js` | `The server does not support SSL connections` | `lib/db.js` disables SSL when `DATABASE_URL` points at localhost; `migrate.js` has no such check, so **no one can migrate a local database** |
| 2 | `070_analytics_indexes` | `column "created_at" does not exist` | Indexes `job_applications.created_at` (real column: `applied_at`), `match_results.created_at` (real: `calculated_at`), and `job_applications.user_id` (does not exist). Also references absent tables `pipeline_stages` and `company_engagement_metrics` |
| 3 | `071_analytics_materialized_views` | `column "created_at" does not exist`, then `ic.score`, then `cs.proficiency_level` | Same phantom schema. Real columns are `applied_at`, `interview_composite_scores.composite_score`, `candidate_skills.level` |
| 4 | `073_screening_questionnaire` | `syntax error at or near "NOT"` | `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS` is not valid PostgreSQL |
| 5 | `119_coding_templates` | `invalid input syntax for type json` | `\n` written inside a JS template literal becomes a literal newline, so the seeded `starter_code` is invalid JSON. The same seeds also contain unescaped `"""` and `'` that will break the JSON string and the SQL literal |
| 6 | `130_candidate_search` | `function trigger_sync_candidate_search_index_skills() does not exist` | Trigger is created before the function it calls |
| 7 | `131_career_coach_schema` | `syntax error at or near "current_role"` | `current_role` is a reserved word in PostgreSQL and must be quoted or renamed |

Defects 2–7 blocked **44 downstream migrations**, including the schema for screening,
aptitude tests, chat, code sandbox, RBAC, compliance and candidate search.

## Downstream impact (confirmed at runtime)

| Issue | Feature | Runtime error |
|---|---|---|
| #3 | Candidate search | `relation "candidate_search_index" does not exist` |
| #121 | AI Career Coach | `relation "career_coach_sessions" does not exist` |
| #119 | Coding templates | `relation "coding_templates" does not exist` |

Each is currently labelled `ready-for-qa` but cannot work, because its table was
never created.

## Fixes already verified locally

Defects 1–4 were fixed to let QA proceed, and migrations then advanced from 76 to 111 applied:

- `migrate.js` — mirror the `isLocalhost` check from `lib/db.js`
- `070` — use `applied_at` / `calculated_at` / `company_id`, and wrap each index in a `SAVEPOINT` so an absent table skips instead of aborting the deploy
- `071` — use `applied_at`, `composite_score`, `level`
- `073` — replace with `CREATE UNIQUE INDEX IF NOT EXISTS`, which is natively idempotent

Defects 5–7 remain open.

## Acceptance criteria

- [ ] `npm run migrate` completes successfully against a **brand new empty database**
- [ ] Migrations 119, 130 and 131 apply cleanly
- [ ] `119_coding_templates` builds its JSON with `JSON.stringify()` and parameterised queries rather than string interpolation
- [ ] `130_candidate_search` creates `trigger_sync_candidate_search_index_skills()` before the trigger that references it
- [ ] `131_career_coach_schema` quotes or renames the `current_role` column
- [ ] `/api/candidates/search`, `/api/career-coach/status` and `/api/coding-templates` all return 200
- [ ] CI runs migrations against a clean throwaway database on every PR and fails on error
- [ ] Migration filename collisions are resolved (currently two `070_`, two `071_`, three `128_`, two `135_`)
- [ ] Staging's Render start command is corrected to `npm run migrate && npm start` to match `render.yaml`

## Reproduction

```bash
createdb rekrutai_fresh
DATABASE_URL=postgresql://postgres@localhost:5432/rekrutai_fresh npm run migrate
```

To enumerate every failure in one pass instead of stopping at the first:

```bash
node docs/qa/audit_migrations.js   # writes docs/qa/migration_audit.json
```

Found by local QA on 2026-08-17. Full report: `docs/qa/local-qa-2026-08-17/REPORT.md`
