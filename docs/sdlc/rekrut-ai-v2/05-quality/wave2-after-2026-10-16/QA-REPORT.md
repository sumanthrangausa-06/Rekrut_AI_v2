# QA REPORT — Wave 2 AFTER-capture verification (fresh install, screenshot proof)

**Persona:** Quinn (Phase 6 — Quality) · **Date:** 2026-10-16 · **Run dir:** `~/workspace/rekrut-wave2-run/`
**Tested commit:** `c9342daf63e8c23f3e582ebaf6c02e13d949770b` (PR #1244 merge) — verified equal to live `origin/dev` head at run time (`git fetch origin dev` → `c9342daf`).
**Scope:** AFTER captures for the six merged-but-open Wave 2 issues #893, #845, #889, #1188, #1192, #1239, each beside its BEFORE state from the 2026-10-15 full local verification (`~/workspace/qa-20261015-run/shots/`, PR #1213).
**This run closes nothing.** All six issues stay OPEN for Lead's review of this evidence. No merge, no promotion, no purge flag, no live/production DB, no outreach was performed.

## Verdict table

| Issue | PR | Verdict | One-line evidence |
|---|---|---|---|
| #893 recruiter compliance = real API data | #1240 | **PASS** | Page renders only `/api/compliance` data: real seeded job in the dropdown, real 0 flagged / 0 audits, 7 real retention policies; zero failed requests |
| #845 fake recruiter profile retired | #1241 | **PASS** | `/recruiter/profile` redirects to `/recruiter/company` — the real Company Profile editor for the seeded company; fake page file deleted; no TechCorp/4.8★/89-hires content anywhere |
| #889 invented inbox retired | #1242 | **PASS** | `/recruiter/communications` redirects to `/recruiter/chat` — the real Messages surface with an honest "No conversations yet" empty state |
| #1188 careers honest stats | #1243 | **PASS** (caveat C2) | Both careers API handlers return `avgTimeToHire: null, employees: null, growthRate: null, rating: null`; rendered page shows only the one real stat (1 Open Position) and "TrustScore: Insufficient data" — no 18d / +34% / 50 / 4.5 literals |
| #1192 server honest-null scores | #1244 | **PASS** (observations O1–O3) | No-data candidate: `total_score: null` on dashboard stats, `/api/omniscore/` and `/breakdown` (never 300/352). Fresh company: `trust_score.total_score: null` on recruiter dashboard, **zero rows in `trust_scores`** (no STARTING-500 insert), public payload `score: null, tier_label: null, insufficient_data: true` |
| #1239 standalone TrustScore page no-data state | #1244 | **PASS** (caveat C1) | With the API reachable, the hero renders "Insufficient data / No score yet / V1: N/A / V2: N/A" — never a headline 0. Employer-role users still hit the separate #1222 403 error state (captured) |

## Fresh-install proof

- Local PostgreSQL on `127.0.0.1:55433` (this VM had no Postgres at run start — the prior custom PG 18.4 install under `/home/pguser` no longer exists; Ubuntu `postgresql-16` 16.15 + `postgresql-16-pgvector` 0.6.0 were installed from Ubuntu pool .debs for this run — environment difference vs prior runs, noted honestly).
- Database `rekrut_wave2_20261016` created **empty**; schema built **only** by `node migrate.js` (full log: `evidence/migrate.log`).
  - 149 migrations recorded in `_migrations`, 248 public tables.
  - **Known fresh-install defect persists at this commit:** `migrate.js` exits 1 at `p2_schema_hardening.sql` — `cannot alter type of a column used by a view or rule … v_candidate_full_profile depends on column "availability"`. Identical failure in the 2026-10-15 run's migrate log. Migrations after it (`p3…p7`, `seed_notification_templates`) therefore do not run on a fresh install. **Nothing was hand-applied** — the app was verified exactly as `migrate.js` leaves it.
- Server: `node server.js` from the worktree at `c9342daf`, serving API + built client (`npm run build`, exit 0) on port 3000 — the port the app's CORS whitelist hardcodes (`server.js:443`). An initial attempt on port 3100 was discarded (module scripts rejected: CORS-driven 500s on `/assets/*.js`) and the DB was rebuilt fresh for the reported run.
- Server log for the reported run: exactly **1** `does not exist` error (`function percent_rank(integer) does not exist`, OmniScore explainer — observation O2), **0** CORS errors. Registration email attempts fail in-sandbox (invalid local Brevo key / SMTP off) as in prior runs; no mail was sent by this run.
- Fixtures (local QA DB only): candidate `candidate@rekrutai.test`, employer recruiter `recruiter@qacorp.rekrutai.test` (company "QA Corp 2026", id 1, slug `qa-corp-2026-2`, one job id 1), plus one directly-inserted `role='recruiter'` fixture user on the same company used only for the #1239 reachable-path capture (labelled as such below).

## Per-issue evidence

### #893 — PASS · `screenshots/893-recruiter-compliance.png`
BEFORE (`M19-privacy__recruiter-compliance.png`, Oct 15): mock figures. AFTER: header states the page shows live compliance-service records only. Cards show Flagged bias metrics **0**, Jobs **1** (the real seeded job), Fairness audits **0**, Retention policies **7** (real migration-seeded rows). "Bias Metrics by Job" dropdown contains the real fixture job "QA Fixture Data Analyst"; empty sections say so in words. API probe (recruiter token): `/api/compliance/bias/flagged` 200 `{rows: [], total: 0}`, `/bias/reports` 200 `[]`, `/fairness/audits` 200 `[]`, `/retention/policies` 200 with 7 real policies. Page load had zero failed requests. Code path: `client/src/pages/recruiter/compliance.tsx:155-195` calls only `/recruiter/jobs` + `/api/compliance/*` (recruiter-accessible), never the admin API.

### #845 — PASS · `screenshots/845-recruiter-profile-redirect.png`
`/recruiter/profile` → final URL `/recruiter/company`, rendering the real Company Profile editor pre-filled with the seeded company (QA Corp 2026, Verified). Route: `client/src/App.tsx:1363` `<Navigate to="/recruiter/company" replace />`; `client/src/pages/recruiter-profile.tsx` no longer exists. No fake identity (TechCorp Solutions, 4.8★, 89 hires — BEFORE: `M2-companies__recruiter-profile-fake.png`) is reachable.

### #889 — PASS · `screenshots/889-recruiter-communications-redirect.png`
`/recruiter/communications` → final URL `/recruiter/chat`, the real Messages surface: "No conversations yet — Candidates will appear here when they apply to your jobs." Route: `client/src/App.tsx` (#889 block, `communications` → `<Navigate to="/recruiter/chat" replace />`); `client/src/pages/recruiter-communications.tsx` no longer exists. BEFORE (`M18-comms__recruiter-communications.png`) showed the invented inbox.

### #1188 — PASS (caveat C2) · `screenshots/1188-careers-authed.png`, `screenshots/1188-careers-public.png`
API (both handlers, `evidence/api-probe.json`): `GET /api/careers/qa-corp-2026-2` and `GET /api/careers/default` return `stats { openPositions: 1, avgTimeToHire: null, employees: null, growthRate: null }`, `rating: null`, `reviewCount: 0`, `trustscore: null` (`routes/careers.js:155-160, 311-316`: growth has no real source → null; employees from real `company.size` → null here). Rendered page (as the company recruiter): stats row contains **only** "1 Open Positions" (the real seeded job); header shows "TrustScore: Insufficient data"; the 18d / +34% / 50-employees / 4.5★ cards are absent because the client renders each stat only when non-null (`client/src/pages/recruiter/career-page.tsx:198,234,247,260`).

### #1192 — PASS (observations O1–O3) · `screenshots/1192-candidate-omniscore.png`, `1192-candidate-dashboard.png`, `1192-recruiter-dashboard.png`, `evidence/api-probe.json`
Candidate (no data): `GET /api/candidate/dashboard/stats` → `omniscore { total_score: null, score_tier: null }`; `GET /api/omniscore/` and `/breakdown` → `total_score: null, tier: null, tier_label: null, peer_percentile: null`. No 300 stats starter, no 352 breakdown starter. OmniScore page hero ring reads "Insufficient data" and every factor card is badged "Insufficient data" (the "300"/"850" glyphs on that page are the scale-axis legend "Ranges from 300 (minimum) to 850 (exceptional)", not a score). Candidate dashboard OmniScore card shows "—".
Company (fresh): `GET /api/recruiter/dashboard` → `trust_score { total_score: null, tier: null, tier_label: null }`; dashboard banner reads "Employer Trust Score: Insufficient data". **Database proof: `SELECT count(*) FROM trust_scores` = 0** — no STARTING-500 row is inserted for a fresh company. Public payload `GET /api/trustscore/company/1/public` → `{ score: null, tier: null, tier_label: null, insufficient_data: true }` — no verdict label beside a null (the PR #1244 privacy-gate delta, `routes/trustscore.js:349`). With a `recruiter`-role fixture: `/api/trustscore/`, `/breakdown` also return `total_score: null`.

### #1239 — PASS (caveat C1) · `screenshots/1239-recruiter-trustscore-recruiter-role.png`, `screenshots/1239-recruiter-trustscore.png`
Reachable-path capture (recruiter-role fixture, all four page API calls 200): hero ring reads **"Insufficient data"**, subtitle "No score yet", "V1 Score: **N/A**", "V2: N/A" — the missing score is never headlined as 0 (`client/src/pages/recruiter-trustscore.tsx:295-299, 374-418`). Factor cards show the API's component values with "Not enough data" badges on the V2 factors.

## Caveats

- **C1 (#1239 / #1192 reachability — separate defect #1222):** a self-registered recruiter has role `employer`, and `routes/trustscore.js:10-15` (`requireRecruiter`) admits only `recruiter|hiring_manager|admin`. All four TrustScore page calls therefore 403 ("Recruiter access required") for employer users, and the page shows an error state — still no fabricated 0, but not the no-data state either. This is the already-open #1222, explicitly out of #1239's scope per Lead's scope note. The employer-path screenshot is included so the distinction is visible, not hidden.
- **C2 (#1188 anonymous reachability — pre-existing, unchanged):** an anonymous visit to `/careers/:slug` bounces to `/login`: the page fetches `/careers/${companyId || 'default'}` (`client/src/pages/recruiter/career-page.tsx:112`), gets 401 from `/api/careers/default`, and the API interceptor treats it as session expiry. The Oct 15 BEFORE capture shows the identical behaviour (same 401, same final URL `/login`), so this is not a #1243 regression; the #1188 stats contract is verified at the API layer on both handlers and on the authed render. The anon screenshot is included for honesty.

## Observations (not verdicts on the six)

- **O1:** `/api/omniscore/` returns component `behavior: 43` for the brand-new candidate while all factor `raw` values are 0 with `hasData: false` (activity-derived component, `services/omniscore.js:808,919`). The **total** is null as required; whether a no-data candidate should show a non-zero behaviour component is a product question for Lead/Nova, not a #1192 starter-total.
- **O2:** `GET /api/omniscore/explainer` → 500 on the fresh install (`function percent_rank(integer) does not exist`, `services/omniscore.js:1092`). The OmniScore page still renders its no-data state; the explainer panel's call fails.
- **O3:** `GET /api/trustscore/public/:slug` 404s for a fresh company — the handler INNER JOINs `trust_scores` (`routes/trustscore.js:817+`), so a no-data company reads as "Company not found"; the same handler keeps a `tier_label: … || 'Unknown'` fallback (line 843) for rows whose tier is null. It fabricates no score, but Lead may want it aligned with the honest-null contract.
- **O4:** `/candidate/scores` has no route at this commit; the SPA lands on `/candidate/assessments` (capture included as `1192-candidate-scores.png` for completeness). The candidate scores surface is `/candidate/omniscore`.
- **O5:** fresh recruiters land on `/recruiter/pending-approval` after login; direct navigation to the verified pages still worked in this run.

## Limits

Desktop viewport only (1440×900), per standing QA order. Local fresh install only — nothing on staging or production was touched, no PR was merged, no flag flipped, no data outside this run's own local QA database was created or deleted, and no email/outreach was sent. All six issues remain **OPEN** for Lead.
