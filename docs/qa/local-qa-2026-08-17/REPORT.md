# Local QA Report — 2026-08-17

**Branch tested:** `dev` @ `80326e3` (2026-08-17)
**Environment:** local deploy (Node 24.19.0, PostgreSQL 17.6 + pgvector 0.8.2, port 3000)
**Reason for local run:** staging is down and 5 days stale (see §1)

---

## 1. Why this had to be run locally

| Finding | Evidence |
|---|---|
| Neon database is hard-down | `HTTP 402: Your account or project has exceeded the compute time quota` — account plan is `free`, quota resets **2026-09-01** |
| Staging has no data layer | `/health` reports `db.connected=false`, all 7 core tables missing |
| Staging code is 5 days stale | `origin/staging` @ `5578391` (Aug 12); `origin/dev` is **115 commits ahead** |
| Staging never runs migrations | Render `rekrutai-staging.startCommand` = `npm start`. `render.yaml` claims `npm run migrate && npm start`. Production *does* run migrate |

**Process consequence:** `ready-for-qa` is being applied to work merged into `dev`, but the QA environment deploys from `staging`. None of the 74 labelled issues were ever deployed anywhere testable.

---

## 2. P0 — The entire frontend is dead on `dev`

Every route — including the public homepage — renders the error boundary:

> Something went wrong. An unexpected error occurred. Please try refreshing the page.

**Root cause:** two components are rendered in `client/src/App.tsx` but never imported.

| Component | Rendered at | Module that exports it | Introduced by |
|---|---|---|---|
| `CandidateOmniScorePage` | `App.tsx:648` | `client/src/pages/candidate/omniscore.tsx` | `9cb0c37` (Aug 15) — issue #24 |
| `RecruiterInterviewsPage` | `App.tsx:1112` | `client/src/pages/recruiter/interviews.tsx` | `a32b389` (Aug 15) — issue #126 |

Because the route table is built at module scope, a single missing symbol throws
`ReferenceError` before *any* page can mount, so all 26 audited pages failed.

**Critically, `npm run build` exits 0.** Vite does not type-check, so this ships clean.

**Verified fix** (both applied locally, all 26 pages then rendered):

```ts
const CandidateOmniScorePage = lazy(() =>
  import('@/pages/candidate/omniscore').then((m) => ({ default: m.CandidateOmniScorePage })),
)
const RecruiterInterviewsPage = lazy(() =>
  import('@/pages/recruiter/interviews').then((m) => ({ default: m.RecruiterInterviewsPage })),
)
```

**Required guard:** add `tsc --noEmit` (or `vite build` with type-checking) to CI. A
scripted check for JSX identifiers not in scope is in
`docs/qa/local-qa-2026-08-17/find_undefined_components.py`.

---

## 3. P0 — A fresh deploy cannot build its schema

`npm run migrate` against an empty database aborts. Seven separate defects:

| # | Migration | Error | Root cause |
|---|---|---|---|
| 1 | `migrate.js` | `The server does not support SSL connections` | `lib/db.js` skips SSL for localhost; `migrate.js` does not. Local dev is impossible |
| 2 | `070_analytics_indexes` | `column "created_at" does not exist` | Indexes `job_applications.created_at` (real column: `applied_at`), `match_results.created_at` (real: `calculated_at`), `job_applications.user_id` (does not exist); also references absent tables `pipeline_stages`, `company_engagement_metrics` |
| 3 | `071_analytics_materialized_views` | `column "created_at" does not exist`, then `ic.score`, then `cs.proficiency_level` | Same phantom schema. Real columns: `applied_at`, `interview_composite_scores.composite_score`, `candidate_skills.level` |
| 4 | `073_screening_questionnaire` | `syntax error at or near "NOT"` | `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS` — unsupported by PostgreSQL |
| 5 | `119_coding_templates` | `invalid input syntax for type json` | `\n` inside a JS template literal becomes a real newline, producing invalid JSON. Also unescaped `"""` and `'` that will break the SQL literal |
| 6 | `130_candidate_search` | `function trigger_sync_candidate_search_index_skills() does not exist` | Trigger created before its function |
| 7 | `131_career_coach_schema` | `syntax error at or near "current_role"` | `current_role` is a reserved word in PostgreSQL |

Migrations 2–7 blocked **44 subsequent migrations**. Defects 1–4 were fixed locally to
let QA proceed; 5–7 remain broken and directly cause the feature failures in §4.

Production's start command *is* `npm run migrate && npm start`, so **promoting `dev` to
production today would fail the deploy outright.**

Full machine-readable results: `migration_audit.json` (via `docs/qa/audit_migrations.js`).

---

## 4. Feature verdicts

Verdicts here are from three passes. Pass 1 (`qa_api.py`) used guessed paths and
produced many false 404s. Pass 2 (`qa_api2.py`) used paths extracted from the live
Express route table (`extract_routes.js`, 800 routes). Pass 3 (`qa_api3.py`) re-tested
everything pass 2 called "not implemented", and **overturned five of those verdicts** —
panels, LiveKit, collaboration, compliance and the sandbox are all mounted and reachable;
I had simply probed paths or HTTP methods that do not exist. Only verdicts confirmed by a
server-side stack trace or a schema check are reported as failures below.

### Broken — caused directly by the failed migrations in §3

| Issue | Feature | Runtime error |
|---|---|---|
| #3 | Candidate search | `relation "candidate_search_index" does not exist` (migration 130 failed) |
| #121 | AI Career Coach | `relation "career_coach_sessions" does not exist` (migration 131 failed) |
| #119 | Coding templates | `relation "coding_templates" does not exist` (migration 119 failed) |

### Broken — independent defects

| Issue | Feature | Root cause |
|---|---|---|
| #113 | **OmniScore v2** | `column v.status does not exist` at `services/omniscore.js:150`. All of `/`, `/breakdown`, `/explainer` return 500. This is the stated core differentiator |
| #110 | Screening questions | `GET /api/screening/questions` → `invalid input syntax for type integer: "questions"` at `routes/screening.js:234`. A `/:id` route is declared before the literal path, so `"questions"` is parsed as an ID |
| #77 | Career diagnosis | `column "diagnosis_data" does not exist` — code and migration 225 disagree |
| #129 | Analytics dashboard | `TypeError: analyticsCache.key is not a function` at `routes/analytics.js:60`. `key()` is declared `static` in `lib/analytics-cache.js:27` but called on the exported singleton instance. **4 call sites**, 3 of them on the recruiter dashboard path (`routes/recruiter.js:120`, `:1478`, `:3410`) — so the main recruiter dashboard is broken for any *approved* recruiter. My test recruiter was pending approval and 403'd before reaching the handler, which is the only reason this surfaced as one failure rather than four |
| #90 | Candidate calls recruiter endpoint | **Worse than reported.** `/api/company/profile` returns 403 on *every* candidate page, not just `/candidate/offers/manage` |
| #52 | OpenAPI docs | No Swagger anywhere. `/api-docs` 404s; `/api/docs` returns 401 with no OpenAPI content |

### Passing

| Issue | Verdict |
|---|---|
| #106 | **PASS** — unknown paths return 404, known routes return 200. (`/jobs` 404s correctly; the real route is `/candidate/jobs`) |
| #111 | PASS — aptitude endpoints return 200 |
| #33 | PASS — `/api/candidate/auto-apply/status` returns 200 |
| #18 | PASS — `/api/notifications/in-app` and `/preferences` return 200 |
| #122 | PASS — `/api/trustscore/methodology` returns 200 |
| #80 | PASS — `/api/referrals` returns 200 |
| #127 | PASS — `/api/calendar/status` returns 200 |
| #139 | PASS — `/api/departments` reachable |
| #140 | PASS — `/api/v1/jobs` public API returns 200 |
| #109 | **PARTIAL** — 5 of 10 endpoints now exist (`candidate/conversations`, `candidate/documents`, `onboarding/feedback/completed`, `candidate/list`, `recruiter/conversations`). `omniscore/explainer` exists but 500s |
| #117 | PASS — `/api/sandbox/languages` returns 200 |
| #82 | PASS — `/api/candidate/cv-review` returns 404 with `{"error":"No CV review found","code":"NOT_FOUND"}`, which is the correct application response for a candidate who has not submitted a CV, not route shadowing |

### Not verified — inconclusive, do not treat as either pass or fail

| Issue | Why |
|---|---|
| #124 | LiveKit. `server/routes/livekit.js` defines only POST and DELETE routes; there is no GET to probe. Needs a test that creates a room, and LiveKit credentials that are not set locally |
| #125 | Interview panels. `routes/panels.js` has no `GET /` — the collection route is `GET /:jobId`. Needs a seeded job and an approved recruiter |
| #128 | Collaboration. `/api/collaboration/notes` and `/comments` return 400 (validation), so the router is mounted and reachable; needs valid payloads to exercise |
| #136 | Compliance. `/api/admin/compliance/*` returns 401 behind the admin gate; needs an admin session |

### Ponytail issues — none are implemented

All six are labelled `ready-for-qa` but the work is absent:

| Issue | Claim | Actual |
|---|---|---|
| #169 | Replace `node-fetch` with native fetch | Still in `package.json`; still imported in `routes/interviews.js`, `routes/billing.js`, `routes/documents.js`, `routes/candidate.js`, `lib/ai-provider.js`, `lib/qp-ai.js`, `lib/qp-provider.js`, `lib/polsia-ai.js`, `services/cartesia-voice.js`, `services/tts-service.js`, `scripts/nim-audit.js` |
| #170 | Replace `form-data` with native FormData | Still in `package.json`; still imported in 10 files |
| #173 | Merge `agent-memory.js` into `memory-service.js` | Both still present (149 and 197 lines) |
| #178 | Shrink `cartesia-voice.js` multipart builder | Unchanged, 404 lines |
| #180 | Merge domain validators | Both still present (893 and 233 lines) |
| #181 | Simplify `encryption.js` | Unchanged, 166 lines |

**Blocker on #169/#170:** `.claude/skills/r2-proxy/SKILL.md` explicitly instructs
`// IMPORTANT: Use node-fetch, not native fetch`. That constraint must be resolved
before either issue is actioned, or R2 uploads will break.

---

## 5. Additional findings not currently tracked

1. **`routes/health.js` never checks the database.** It did `const { pool } = require('../lib/db')`, but `lib/db.js` does `module.exports = pool`. `pool` was always `undefined`, and the `if (pool)` guard meant it silently reported `db: "connected"` without querying. The same mistake in `lib/query-profiler.js` crashed the server on boot (`TypeError: Cannot read properties of undefined (reading 'query')` at `server.js:2125`). Both fixed locally.
2. **30% of the repo is agent scratch data.** 689 of 2309 tracked files live under `projects/-tmp-polsia-workspaces-company-956-agent-30-exec-*` (Claude tool-result dumps and JSONL transcripts). `.gitignore` does not exclude them.
3. **`services/email-domain-validator.js` is 893 lines**, ~700 of which are a hand-maintained blocklist of ~712 domains. The `disposable-email-domains` package maintains exactly this list, continuously updated. Ponytail rung 5.
4. **`postinstall` is not portable.** It uses POSIX `if [ "$CI" = "true" ]`, which `cmd.exe` cannot parse, so `npm install` fails on Windows.
5. **Migration numbering collides** — two `070_`, two `071_`, three `128_`, two `135_`.
6. **Contradictory labels** — #106, #90, #76, #44, #37, #13, #11 carry both `in-progress` and `ready-for-qa`.

---

## 6. How to reproduce this environment

```powershell
# toolchain (portable, no admin)
python docs/qa/setup_tools.py        # Node 24 + gh
python docs/qa/setup_postgres.py     # PostgreSQL 17.6
python docs/qa/setup_pgvector.py     # pgvector 0.8.2
powershell -File docs/qa/pg_up.ps1   # init + start on port 5433
python docs/qa/make_env.py           # .env with locally generated secrets

npm install --ignore-scripts
npm run migrate
cd client && npm install --include=dev --ignore-scripts && npm run build && cd ..
node server.js

# QA
python docs/qa/local-qa-2026-08-17/qa_api2.py
python docs/qa/local-qa-2026-08-17/qa_browser.py
```

Secrets are generated locally and never copied from production. The app refuses to
start against the production Neon host outside `NODE_ENV=production`.

---

## 7. Recommended order of work

1. Fix the two missing imports (§2) and add `tsc --noEmit` to CI — nothing else can be QA'd until the UI mounts.
2. Fix migrations 119, 130, 131 (§3) — this alone restores #3, #119 and #121.
3. Fix `migrate.js` localhost SSL so contributors can run locally at all.
4. Fix `v.status` in `services/omniscore.js:150` (#113).
5. Reorder the literal routes ahead of `/:id` in `routes/screening.js` (#110) and `routes/candidate.js` (#82).
6. Stop the candidate UI calling `/api/company/profile` (#90).
7. Reconcile the branch/deploy model so `ready-for-qa` means "deployed somewhere testable".
