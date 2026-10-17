# QA REPORT — #1187 public careers page AFTER-capture (fresh install, screenshot proof)

**Persona:** Quinn (Phase 6 — Quality) · **Date:** 2026-10-16 · **Run dir:** `~/workspace/goals/launch-rekrut-ai-v2-by-january/hidden_files/1187-after-run/`
**Tested commit:** `2b1b75a89a40029160339adbdacfb3861fe74722` (Merge PR #1248, the #1187 fix) — verified equal to live `origin/dev` head at run start, in a separate clone (`~/workspace/rekrut-quinn-1187-after/repo`); the shared dev worktree was not touched.
**Scope:** AFTER capture for #1187 only — the public careers page ignored the company in its URL (App route `:company` vs `useParams().companyId`), so logged-out visitors hit the auth-only `/careers/default`, got 401, and saw the unavailable state / login bounce, and logged-in users silently saw their own company.
**This run closes nothing and merges nothing.** #1187 stays OPEN for Lead. No promotion, no purge flag, no live/production DB, no outreach was performed.

## Verdict

| Check | Verdict | Evidence |
|---|---|---|
| (a) Logged-out browser visit to `/careers/<seeded-company-slug>` renders THAT company, no `/login` bounce | **PASS** | `screenshots/1187-careers-alpha-logged-out.png` (Playwright, desktop 1440×900): "Quinn Alpha Careers Inc", its tagline, 1 Open Position, its job "Alpha Widget Engineer", honest "TrustScore: Insufficient data". Final URL stayed `/careers/quinn1187-alpha`; the only careers API call was `200 /api/careers/quinn1187-alpha` — no `/careers/default` call (`evidence/browser-result.json`) |
| (b) `GET /api/careers/:id` logged-out returns 200 with that company (by slug and by numeric id) | **PASS** | Slug → 200 "Quinn Alpha Careers Inc" + its job; numeric id → 200 same company; control slug for the second seeded company → 200 "Quinn Beta Careers LLC" (endpoint differentiates). Contrast: `GET /api/careers/default` logged-out → **401** "Authentication required" — that is the old broken fallback path, and the fixed page no longer calls it (`evidence/api-probe.json`, 7/7 checks PASS) |
| (c) Logged-in user from a DIFFERENT company sees the URL's company, not their own | **PASS** | Both levels: API — authenticated as the Beta-company recruiter, `GET /api/careers/quinn1187-alpha` → 200 **Alpha**, while `GET /api/careers/default` with the same token → 200 **Beta** (proves `default` = own company, so the Alpha result is the URL winning, not default leakage). Browser — same Beta session in localStorage visiting `/careers/quinn1187-alpha` renders Alpha (name + job), no Beta content, no bounce (`screenshots/1187-careers-alpha-logged-in-as-beta.png`) |
| Server log clean on this path | **PASS** | Whole-run grep: `Career page error` → 0, `does not exist` → 0, `42P18` → 0 (`evidence/server-log-excerpt.txt`) |

**Overall: PASS.** The BEFORE state (2026-10-14/15 captures on #1187: logged-out `/careers/<slug>` → `/api/careers/default` → 401 → "This career page isn't available right now.") is gone at the merged commit, on a fresh install.

## Fresh-install proof

- Local PostgreSQL **16.15** (Ubuntu cluster `16/main`) on `127.0.0.1:55433` — started for this run on that port; the cluster held no prior QA databases at start. (Port note: the #1237 AFTER run used 5432 on the same cluster; recorded so the difference is not a mystery.)
- Database `rekrut_1187_after` created **empty**; schema built **only** by `node migrate.js` from the clean clone at `2b1b75a8` (full log in `evidence/migrate.log`).
  - 149 migrations recorded in `_migrations`, 248 public tables.
  - **Known fresh-install defect persists at this commit:** `migrate.js` exits **1** at `p2_schema_hardening.sql` — code `0A000`, `cannot alter type of a column used by a view or rule` (`candidate_profiles.availability` / `v_candidate_full_profile`). Identical to the Wave 2 / #1237 AFTER runs; this is #1141 territory, pre-existing, unrelated to #1187. **Nothing was hand-applied.**
- Server: `node server.js` from the clone at `2b1b75a8`, client built with `npm run build` (exit 0), serving on port **3000** (the port the CORS whitelist hardcodes, `server.js:443`). Health: `200 {"status":"ok","db":"connected"}`.
- Fixtures (this run's scratch DB only, direct seed SQL — the app has no API that creates companies with chosen slugs): **Quinn Alpha Careers Inc** (slug `quinn1187-alpha`, one active job "Alpha Widget Engineer") and **Quinn Beta Careers LLC** (slug `quinn1187-beta`, one active job "Beta Support Specialist"), plus a recruiter user belonging to Beta for check (c).

## Observations (not verdicts)

- **O1:** During server boot, a few background loaders logged `Connection terminated due to connection timeout` (ai-call-logger / activity-logger / token-budget DB loads). Health and every careers probe were unaffected (all 200). Pre-existing startup behaviour, noted for Lead triage only.

- **O2:** The two screenshots are byte-identical (same md5). That is genuine, not a copy error: the public careers page renders the same public content whether or not a session token exists, and both captures are full-page renders of it. The distinguishing evidence for check (c) is therefore the session record in `evidence/browser-result.json` (separate contexts; the Beta token was set in localStorage before navigation, and the page's own API call still went to `/api/careers/quinn1187-alpha`) plus the token-authenticated API pair in `evidence/api-probe.json` (`default` → Beta, slug → Alpha with the same token).

## Limits

Desktop viewport only (1440×900), per standing QA order. Local fresh install only — nothing on staging or production was touched, no PR was merged, no issue was closed, no flag flipped, no data outside this run's own local QA database was created or deleted, and no email/outreach was sent. #1187 remains **OPEN** for Lead.
