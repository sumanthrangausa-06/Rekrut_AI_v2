# Seed & Fixture Data — Rekrut_AI_v2

*Builder-facing. Verified against `origin/dev` @ `e5599900` (2026-10-13) by reading the git
tree (`git show origin/dev:<path>`), not the working tree. Anything not evidenced in the repo
is marked `NOT VERIFIED`. No passwords, real people's emails, or credential values appear here.*

**The one-sentence story:** there is no demo-data seeder and no general fixture dataset.
What exists is (a) reference data embedded inside migrations — which therefore runs on
**every deploy boot**, (b) two narrow manual scripts (candidate-search test data, E2E RBAC
patch-ups), and (c) E2E accounts created on-the-fly through the real register API.
Unit tests fake the database entirely and need no seed data at all.

---

## 1. What seed / fixture material exists

### 1.1 The runner: everything in `migrations/` is a migration

`migrate.js` (repo root; `package.json` → `"migrate": "node migrate.js"`):

1. Creates the `_migrations` tracking table, then creates core tables inline with
   `CREATE TABLE IF NOT EXISTS` (`users`, `jobs`, `interviews`, `interview_questions`,
   `agent_data`, `refresh_tokens`, `password_reset_tokens`, `oauth_connections`,
   `companies`, `recruiter_join_requests`, `referral_rewards`, `candidate_profiles`,
   `saved_jobs`).
2. Reads `migrations/`, sorts filenames alphabetically, and runs every `.js`/`.sql` file
   not yet recorded in `_migrations` — each in its own transaction; any failure rolls back
   that file, aborts the run, and `process.exit(1)`. A JS migration's identity is
   `migration.name || <filename>`.

**When it runs:** `render.yaml` sets `startCommand: npm run migrate && npm start` for all
three Render services (prod / staging / dev), so migrations — including every seed insert
below — execute at every deploy boot. CI also runs `npm run migrate` before E2E
(`.github/workflows/ci.yml`). Plain `npm start` does **not** migrate.

### 1.2 Reference data seeded by migrations (runs automatically, see §1.1)

All inserts are idempotent (`ON CONFLICT … DO NOTHING / DO UPDATE`) unless noted.

| Migration | Seeds | Notes |
|---|---|---|
| `migrations/2024-06-13-add-email-templates.js` | Creates `notification_templates` + 15 email templates (welcome, password_reset, email_verification, job_application_submitted/received, interview_scheduled/reminder, offer_extended/accepted/rejected, document_verified/flagged, account_suspended, payment_failed, subscription_renewal) | The table-creating migration for templates |
| `migrations/035_email_notifications.js` | 8 more `notification_templates` (application_received, interview_scheduled, offer_extended, application_rejected, assessment_invite, onboarding_welcome, password_reset, weekly_digest) | Also backfills `notification_preferences` for **existing** users (cross-join, not a seed) |
| `migrations/061_add_notification_system.js` | 7 templates (welcome_email, interview_scheduled, application_received, application_status_update, assessment_invite, password_reset, offer_received) | Overlapping names with 035/2024-06-13 — last writer wins per `name` |
| `migrations/063_add_missing_email_templates.js` | 3 templates: hired, rejection, interview_reminder | Has a `down()` that deletes them |
| `migrations/seed_notification_templates.js` | 8 system templates (`is_system=true`): application_received, interview_scheduled, offer_extended, status_update, job_application_submitted, job_application_received, welcome, password_reset | **It is a migration, despite the name** — `name: 'seed_notification_templates'`, sorts last, runs via §1.1. Skips silently if `notification_templates` doesn't exist; first adds the `variables`/`is_system` columns the table-creating migration never defined (issue #183 comment in-file) |
| `migrations/006_dynamic_assessments.js` | 6 rows in `assessment_questions` (JavaScript ×2, React, Python, Communication, Problem Solving) | Initial question bank |
| `migrations/074_aptitude_test_engine.js` | 1 test (`Cognitive Aptitude Assessment`, 15 min) + 30 questions (10 logic / 10 verbal / 10 numerical) | |
| `migrations/119_coding_templates.js` | 5 `coding_templates` with test cases (incl. "Two Sum", "CSV Sales Report Processor", "REST API Rate Limiter") | |
| `migrations/117_code_sandbox.js` | 12 `sandbox_languages` (Python 3, JavaScript, Java, C++, Go, C, TypeScript, Ruby, Rust, PHP, Kotlin, Swift; Judge0 IDs) | |
| `migrations/128_rbac_foundation.js` | 6 roles (owner, admin, recruiter, hiring_manager, interviewer, viewer), 21 permissions, and the role→permission mapping | The RBAC vocabulary the whole app assumes |
| `migrations/132_trustscore_v2.js` | 13 `trustscore_methodology` rows (TrustScore v2.0 factors/weights) | Reference weights, not company scores |
| `migrations/027_multi_country_support.js` | 8 `country_configs` (US, IN, GB, CA, AU, DE, FR, SG) + per-country document types | Payroll/onboarding reference data |
| `migrations/013_compliance_system.js` | 4 `data_retention_policies` (audit_logs 2555d, interview_recordings 730d, assessment_results 1825d, candidate_data 1095d) | |
| `migrations/253_recording_objects_registry.js`, `migrations/257_observer_capture.js` | Additional `data_retention_policies` rows (recording objects; `observer_audio` 30d) | |
| `migrations/244_consent_tables.js` | v1.0 `consent_texts` for 3 types (recording, biometric, id_verification; EN + HI), marked DRAFT in-file | |
| `migrations/250_qp_biometric_consent_text.js` | 1 `consent_texts` row (`biometric_practice` v1.0, EN + HI) | |

**Not seeds — one-shot backfills from existing data** (also in migrations; they create
nothing on an empty DB): `021_payroll_company_bridge.js` (employee records from accepted
offers), `077_omniscore_v2_eight_factor.js` (score snapshots from `omni_scores`),
`138_interview_flows.js` (flows from active `screening_templates`),
`p3b_candidate_search.js` (search index from existing profiles), `035` preferences (above).

There is **no** migration that seeds users, companies, jobs, candidates, plans/pricing, or
an admin account. Admin access is env-driven (`ADMIN_USERNAME` / `ADMIN_PASSWORD` in
`.env.example`, `render.yaml`), not a DB row.

### 1.3 Manual scripts (never run automatically)

| Path | What it creates | When / how |
|---|---|---|
| `scripts/seed-candidate-search.js` | 25 fictional candidate profiles (per its header, issue #3): a `users` row (`role='candidate'`, placeholder password hash explicitly marked as not real), `candidate_profiles`, `candidate_skills`, `work_experience`, `education`, `omni_scores`, plus a `sync_candidate_search_index()` call per user | Manual only: `node scripts/seed-candidate-search.js`, needs `DATABASE_URL`. **Hard guard: throws if `NODE_ENV=production`.** Skips emails that already exist. Creates candidates only — no company, no job |
| `scripts/seed-rbac-e2e.js` | Assigns the `recruiter` role (in `user_roles`, company_id 1) to the pre-existing E2E recruiter user and grants that role **all** permissions in `role_permissions` | Manual only. Hardcoded local DB `postgresql://postgres@localhost/rekrut_e2e_phased`. Assumes the user already exists (see §1.4); creates no user |
| `scripts/e2e-schema-align.js` | Patches a local E2E DB up to shape: adds `jobs.department_id/department`, creates `email_queue`, `candidate_search_index`, `saved_searches` if missing; inserts one `candidate_search_index` row for the pre-existing E2E candidate | Manual only, same hardcoded `rekrut_e2e_phased` DB. It is a workaround for schema drift, not a migration |
| `scripts/add-templates.js` | Nothing at runtime today — a one-off file-editing utility that rewrites `migrations/seed_notification_templates.js` to add two templates | Historical; do not run as a seeder |
| `scripts/test-candidate-search.js`, `scripts/test-recruiter-analytics.js`, `scripts/test-stripe-flow.js`, `scripts/test-webhook.js` | No seed data — manual API test drivers against a running server | Manual verification only |
| `scripts/run-e2e-sequential.js`, `run-e2e-full-suite.sh`, `run-e2e-sequential.sh`, `run-e2e-perfile.sh` | No data — Playwright runners (per-file / 4-shard) that work around browser memory accumulation; they run `e2e/auth.setup.ts` first | Manual / CI |
| `scripts/gate-a-evidence-pack.js`, `scripts/db-health-check.js`, `scripts/health-check.js`, `scripts/check-jobs.js`, `check-user.js`, `check-password.js`, `clear-rate-limits.js` | Diagnostics / evidence / cleanup utilities; none seed usable app data | Manual |

No `fixtures/` directory, demo-data generator, or factory library exists in the repo
(`NOT VERIFIED` negative grounded in a full `origin/dev` tree + name search for
`seed|fixture|demo|sample|factory`: only the files above matched).

### 1.4 E2E accounts are created through the real API, not seeded

`e2e/auth.setup.ts` (`getOrCreateUser`): tries `POST /api/auth/login`, and on 401 registers
via `POST /api/auth/register`, for the candidate and recruiter E2E accounts on the
synthetic `@rekrutai.test` domain; writes Playwright storage state to `e2e/.auth/*.json`.
Admin E2E login uses the env-configured admin credentials (`ADMIN_USERNAME` /
`ADMIN_PASSWORD`). `e2e/helpers.ts` (`apiLogin` / `ensureAuth`) repeats the
login-or-register pattern. Several specs (e.g. `candidate-critical-flow.spec.ts`,
`candidate-full-journey.spec.ts`, `password-reset-flow.spec.ts`) register fresh,
timestamp-unique `@rekrutai.test` users per run. Consequence: E2E leaves real rows in
whatever DB it points at — which is exactly the policy problem in §2.

---

## 2. Test / QA accounts policy (Sumanth's standing rules)

State of policy, with the tracking issues. This section is policy, not repo code.

1. **QA / E2E / debug test accounts are NEEDED until launch and must not be removed
   before then.** They are the working accounts for hands-on QA, E2E runs, and debugging.
   Until launch: hide soft-deleted users from recruiter search results, but **do not
   delete any rows**.
2. **Issue #151 — pre-launch cleanup gate:** ALL test data (test accounts and everything
   they created) must be removed before launch. #151 stays open as the reminder; it is a
   launch blocker, not a someday-cleanup.
3. **Issue #336 (P0) — known exposure, deferred by ruling:** two QA-runner test accounts,
   user IDs **205** and **206**, hold `role='admin'` in the shared production database.
   This is a known, tracked exposure. Sumanth's ruling: cleanup is **explicitly deferred
   to the pre-launch track** (with #151) — do not "fix" it opportunistically, and do not
   create any more privileged test accounts in the meantime.
4. Anything seeded or registered for testing belongs in a local DB, CI's throwaway
   Postgres, or the synthetic `@rekrutai.test` namespace (§1.4) — never as hand-made
   rows in the shared production DB beyond the already-tracked accounts above.

---

## 3. What must NEVER be seeded

| Never seed | Why / grounding |
|---|---|
| Real user data of any kind — real candidates, real companies, real resumes, real interview content | Seed material in this repo is fictional by construction (`scripts/seed-candidate-search.js` invents profiles; E2E uses the synthetic `@rekrutai.test` domain). Real records enter only through the product's own flows |
| Real candidate/company records copied from production into dev/staging/local | No repo tooling does this, and none should be added casually — production data carries consent and erasure obligations (see the consent/erasure machinery seeded in §1.2: `244_consent_tables.js`, retention policies in `013`/`253`/`257`) |
| Production credentials or keys in any seed, fixture, script, or `.env` committed to the repo | `.env.example` is placeholders only (`DATABASE_URL=...`, `pk_test_…`, `sk_test_…` patterns). `render.yaml` marks every secret `sync: false` (set in the Render dashboard, never in git) |
| Live Stripe keys outside production | **Guard verified in code:** `server.js` refuses to boot (`process.exit(1)`) when `NODE_ENV !== 'production'` and `STRIPE_SECRET_KEY` starts with `sk_live_`. Staging/prod currently hold TEST-class Stripe keys; **live keys are a launch-gate item — issue #837**. Do not "pre-seed" live keys anywhere |
| Any test account with `role='admin'` in the shared production DB | See §2.3 / #336 — the two existing ones are the tracked exception, not a precedent |
| Seed scripts run against production | `scripts/seed-candidate-search.js` enforces this itself: it throws when `NODE_ENV=production`. Treat the same rule as binding for every script in §1.3, including the ones without the guard (`seed-rbac-e2e.js`, `e2e-schema-align.js` — both are hardcoded to a local DB) |

Related guard worth knowing: `server.js` also refuses to boot a non-production process
whose `DATABASE_URL` points at the production Neon hostname — a misdirected local/E2E run
against prod fails closed instead of writing test rows into it.

---

## 4. How a builder gets a working local dataset

The honest recipe, from repo evidence (`README.md` Setup, `.env.example`, `migrate.js`):

```bash
# 1. Local Postgres 15+ with pgvector available (README prerequisite)
# 2. Configure env
cp .env.example .env
#    DATABASE_URL=postgresql://<user>@localhost:5432/<your-db>
#    plus locally generated SESSION_SECRET / JWT_SECRET / ENCRYPTION_KEY
#    and ADMIN_USERNAME / ADMIN_PASSWORD (admin panel refuses to start without them)
# 3. Migrate — creates core tables + all 150+ migrations + §1.2 reference data
DATABASE_URL=postgresql://<user>@localhost:5432/<your-db> node migrate.js
#    (equivalently: npm run migrate)
```

### ⚠️ Migration-238 caveat — a from-scratch DB currently cannot finish migrating

**Verified in code.** `migrate.js` creates `candidate_profiles` inline *before* running
any migration file, and its inline definition has **no `bio` column**. Migration
`004_candidate_profiles.js` defines `candidate_profiles` *with* `bio TEXT` — but via
`CREATE TABLE IF NOT EXISTS`, so on a fresh DB it is a no-op against the table `migrate.js`
just created. No later migration adds `bio` (grep over `migrations/`: `bio` appears only in
004's definition, in `p3b_candidate_search.js`'s separate `candidate_search_index` table,
and in the views below). Migration `238_v_candidate_full_profile.js` then does
`CREATE OR REPLACE VIEW … SELECT …, cp.bio, … FROM candidate_profiles cp …`, which fails
on the missing column. Per §1.1, `migrate.js` rolls that migration back and exits —
**so on a fresh database, migrations 239–258 and the `p*`/`seed_*` files never run.**

- Tracked as **issue #894**.
- What it means locally: a from-scratch local DB stops at migration 238. You do **not**
  get the post-238 schema (consent hardening, observer tables, legal holds, the
  notification-template seed, etc.), even though the pre-238 reference data (§1.2, files
  sorting before `238_…`) did land.
- **Workaround: NOT VERIFIED / none known.** No fix, patch script, or documented manual
  `ALTER TABLE` step for this exists in the repo. Do not invent one in a PR description;
  the fix belongs to #894.

### Populating a usable dataset (after migrations, as far as they get)

There is **no single "make me a demo workspace" command**. The minimal usable dataset —
a company + owner, a candidate, a job — is assembled from three different mechanisms:

1. **Company + owner:** no script creates these. Use the real flow the E2E suite uses:
   register an employer via `POST /api/auth/register` (or the UI) — `routes/auth.js`
   creates the `companies` row and the owner's `user_roles` row on employer signup
   (company-email domain enforcement applies). **Job:** likewise no seeder — create it
   through the recruiter UI / jobs API as that owner.
2. **Candidates with searchable profiles (optional, bulk):**
   `node scripts/seed-candidate-search.js` (§1.3) — 25 fictional candidates with skills,
   experience, education, and OmniScores, enough to exercise candidate search. It does
   not connect them to your company or job (no applications).
3. **E2E-shaped accounts (optional):** run Playwright's setup once
   (`npx playwright test --project=setup`, which executes `e2e/auth.setup.ts`) against
   your local server to login-or-register the `@rekrutai.test` candidate + recruiter and
   cache their auth state. If you specifically need the legacy phased-E2E shape, the
   manual pair `scripts/e2e-schema-align.js` + `scripts/seed-rbac-e2e.js` patches the
   hardcoded local `rekrut_e2e_phased` DB — niche, local-only.

Everything in §1.2 (templates, RBAC roles/permissions, question banks, coding templates,
country configs, consent texts, retention policies, TrustScore methodology) arrives with
the migration run itself — no extra step.

---

## 5. Test-suite fixtures: the suites fake the DB

Unit/integration tests need **no seeded database**:

- **Jest (backend)** — `jest.config.js`: `testMatch` covers `server/__tests__/**`,
  `tests/**`, `agents/**`; `setupFilesAfterEnv` loads `server/test/setup.js`, which
  **globally mocks `../../lib/db`** with an in-memory, `Map`-backed fake whose
  `mockQuery` pattern-matches SQL strings (user lookups by email/id, soft-delete, …) and
  returns canned `{ rows, rowCount }`. Route tests (e.g.
  `server/__tests__/routes/auth.test.js`) then drive the real Express app with
  `supertest` against that fake. Many lib tests additionally declare their own
  `jest.mock('../../lib/db', …)` per file (e.g. `server/__tests__/lib/consentService.test.js`,
  `server/__tests__/lib/observerCapture.test.js`).
- **Migration tests** that need real SQL semantics use **`pg-mem`** (in-memory Postgres,
  a devDependency) instead of a server — e.g. `server/__tests__/migrations/138_interview_flows.test.js`,
  `server/__tests__/migrations/232_assessment_attempt_due_date.test.js`,
  `server/__tests__/routes/oauth-exchange.test.js`.
- **Vitest (client)** — `client/vitest.config.ts`: `jsdom` environment, globals on,
  setup `client/src/__tests__/setup.ts` (`@testing-library/jest-dom`); component/page
  tests stub API responses in-test. No DB is involved.
- **Playwright E2E is the exception:** it runs against a real migrated DB and a real
  server (CI: `pgvector/pgvector:pg16` service → `npm run migrate` → `npm start` →
  specs, per `.github/workflows/ci.yml`), with accounts created per §1.4 and only a
  GC-forcing page fixture in `e2e/test-fixtures.ts` — there is no E2E data fixture file.

---

*Sources: `migrate.js`, `migrations/` (156 files), `scripts/`, `e2e/auth.setup.ts`,
`e2e/helpers.ts`, `e2e/test-fixtures.ts`, `server.js` (startup guards), `server/test/setup.js`,
`jest.config.js`, `client/vitest.config.ts`, `render.yaml`, `.github/workflows/ci.yml`,
`.env.example`, `README.md` — all at `origin/dev` `e5599900`. Policy §2: issues #151, #336;
§3 Stripe launch gate: issue #837; §4 migration halt: issue #894.*

---

**Data documentation pack:** [index](./README.md) · [data model](./data-model.md) · [schema](./schema.md) · [migrations](./migrations.md) · [access control / RLS](./rls-policies.md) · [seed data](./seed-data.md)
