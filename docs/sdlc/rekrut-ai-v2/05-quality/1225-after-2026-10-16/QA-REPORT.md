# QA REPORT — AFTER verification: #1225 SPA fallback known-routes (fresh install)

**Persona:** QUINN (Phase 6 — Quality) · **Date:** 2026-10-16 · **Run dir:** `~/workspace/goals/launch-rekrut-ai-v2-by-january/hidden_files/1225-after-run/`
**Tested commit:** `b3cee5c33cd7994919166cb1d5e4d8abd52c3765` (Merge PR #1272) — verified equal to live `origin/dev` head at run start (`gh api commits/dev` + `git fetch` + `git rev-parse HEAD` in Quinn's own clone), and confirmed live during the run by server `/health` reporting commit `b3cee5c3…`. Clone: `hidden_files/1225-after-run/repo`, detached HEAD at that commit, clean. The shared checkout `~/workspace/skill-repos/rekrut-ai-v2` was **not** touched — no checkout/reset/stash there.
**Scope:** AFTER capture for #1225 only. **This run closes nothing and merges nothing.** Issue #1225 stays OPEN for Lead. No promotion, no purge flag, no live/production DB, no outreach, no code fixes in this lane.
**Skills:** startup-cto first; ecc/e2e-runner + gstack/qa lens; verification-before-completion last (every claim below is backed by a probe file, a network/document capture, or a visually inspected screenshot).

## Verdict — #1225 PASS

| Check | Result | Evidence |
|---|---|---|
| **Original 10 routes from #1225** — `/compare`, `/leaderboard`, `/privacy/biometric-policy`, `/aptitude-tests`, `/candidate/identity-verification`, `/candidate/scores`, `/candidate/messages`, `/recruiter/aptitude-tests`, `/recruiter/session-room`, `/admin/biometric-audit` | **All 10 → HTTP 200** document status with `<!DOCTYPE html>` SPA shell (previously 404 while rendering) | `evidence/api-probe.json` — group `original-10-issue`, 10/10 PASS |
| **Additional 17 routes restored by PR #1272** — `/ref`, `/r/abc123`, `/interview/session/abc123`, `/interview/consent`, `/candidate/interviews/42/book`, `/candidate/quick-practice/42`, `/candidate/screening/42`, `/aptitude-tests/42/take`, `/aptitude-test-results/42`, `/recruiter/aptitude-tests/create`, `/recruiter/aptitude-tests/42/edit`, `/recruiter/aptitude-tests/42/results`, `/recruiter/screening-monitor`, `/recruiter/recordings/42/playback`, `/recruiter/interviews/report/42`, `/recruiter/panels/42`, `/recruiter/jobs/42/panel-criteria` | **All 17 → HTTP 200** | `evidence/api-probe.json` — group `additional-17-pr1272`, 17/17 PASS |
| **Dual-token param sampling** (proves patterns are not hard-coded to `42`) — `/r/xyz789`, `/interview/session/xyz789`, `/candidate/interviews/99/book`, `/aptitude-tests/99/take`, `/recruiter/panels/99` | **All 5 → HTTP 200** | `evidence/api-probe.json` — group `dual-token-param-sampling`, 5/5 PASS |
| **Negative control — genuinely unknown routes must still 404** — `/this-does-not-exist`, `/quinn1225-definitely-unknown-xyz`, `/candidate/nonexistent`, `/recruiter/nonexistent`, `/admin/nonexistent`, `/foo/bar/baz` | **All 6 → HTTP 404** with SPA shell (client renders NotFound) — #106 behaviour preserved, fix did not turn the fallback into 200-for-everything | `evidence/api-probe.json` — group `negative-control-unknown`, 6/6 PASS |
| **Negative control — API** — `GET /api/this-does-not-exist` | **404 JSON** `{"error":"API endpoint not found"}` (not HTML) | `evidence/api-probe.json` — group `negative-control-api`, PASS |
| **Sanity — pre-existing known routes** — `/`, `/login` | **Both → 200** | `evidence/api-probe.json` — group `sanity-known-preexisting`, 2/2 PASS |
| **Browser — renders, not just status** (desktop 1440×900, Playwright) | `/compare` doc **200** renders “Compare Companies / Search companies to compare”; `/leaderboard` doc **200** renders “Company TrustScore Leaderboard” with honest empty state; `/privacy/biometric-policy` doc **200** renders the full Biometric Privacy Policy; unknown route doc **404** renders “404 Page Not Found” | `evidence/browser-result.json`; screenshots visually inspected by Quinn (see below) |
| **Guard suites at this commit** | `spa-routes.test.js` + `spa-known-routes-guard.test.js`: **148/148 tests PASS, 2/2 suites PASS** | `logs/spa-tests.log` (Jest open-handle warning after pass is the server's background timers, pre-existing) |

**Overall: PASS.** HTTP probe **41/41 PASS** (`evidence/api-probe.json`); browser checks PASS for all captured routes.

## Per-route table (HTTP document status)

| Route | Expected | Actual | Verdict |
|---|---|---|---|
| /compare | 200 | 200 | PASS |
| /leaderboard | 200 | 200 | PASS |
| /privacy/biometric-policy | 200 | 200 | PASS |
| /aptitude-tests | 200 | 200 | PASS |
| /candidate/identity-verification | 200 | 200 | PASS |
| /candidate/scores | 200 | 200 | PASS |
| /candidate/messages | 200 | 200 | PASS |
| /recruiter/aptitude-tests | 200 | 200 | PASS |
| /recruiter/session-room | 200 | 200 | PASS |
| /admin/biometric-audit | 200 | 200 | PASS |
| /ref | 200 | 200 | PASS |
| /r/abc123 | 200 | 200 | PASS |
| /interview/session/abc123 | 200 | 200 | PASS |
| /interview/consent | 200 | 200 | PASS |
| /candidate/interviews/42/book | 200 | 200 | PASS |
| /candidate/quick-practice/42 | 200 | 200 | PASS |
| /candidate/screening/42 | 200 | 200 | PASS |
| /aptitude-tests/42/take | 200 | 200 | PASS |
| /aptitude-test-results/42 | 200 | 200 | PASS |
| /recruiter/aptitude-tests/create | 200 | 200 | PASS |
| /recruiter/aptitude-tests/42/edit | 200 | 200 | PASS |
| /recruiter/aptitude-tests/42/results | 200 | 200 | PASS |
| /recruiter/screening-monitor | 200 | 200 | PASS |
| /recruiter/recordings/42/playback | 200 | 200 | PASS |
| /recruiter/interviews/report/42 | 200 | 200 | PASS |
| /recruiter/panels/42 | 200 | 200 | PASS |
| /recruiter/jobs/42/panel-criteria | 200 | 200 | PASS |
| /this-does-not-exist (unknown) | 404 | 404 | PASS |
| /quinn1225-definitely-unknown-xyz (unknown) | 404 | 404 | PASS |
| /candidate/nonexistent (unknown) | 404 | 404 | PASS |
| /recruiter/nonexistent (unknown) | 404 | 404 | PASS |
| /admin/nonexistent (unknown) | 404 | 404 | PASS |
| /foo/bar/baz (unknown) | 404 | 404 | PASS |
| /api/this-does-not-exist (API unknown) | 404 JSON | 404 JSON | PASS |

## Screenshots — what they actually show (visually inspected by Quinn)

- `screenshots/1225-compare.png` (full page, 1440×900): shield icon, heading **“Compare Companies”**, subheading about comparing TrustScore factors side-by-side, and a “Search companies to compare” card with the company-name input. No error, no NotFound.
- `screenshots/1225-leaderboard.png`: heading **“Company TrustScore Leaderboard”**, TrustScore explainer, search box, **“0 companies ranked”**, and the honest empty state **“No companies found — No companies have enough data to be ranked yet.”** No fabricated companies or scores on a fresh empty DB — correct per the no-fake-data rule.
- `screenshots/1225-privacy-biometric-policy.png`: Rekrut AI header, **“Biometric Privacy Policy”** with “Last updated: October 17, 2026”, the DRAFT counsel-review banner, and full numbered sections (What We Collect, Why We Collect It, Retention Periods, Destruction Method, Your Rights, Security) rendering completely.
- `screenshots/1225-unknown-404.png` (negative control): centred **“404 / Page Not Found — The page you're looking for doesn't exist or has been moved”** with Go Home / Go Back — the unknown route still behaves as a 404 in both status and rendering.
- Browser note on `/aptitude-tests` (`evidence/browser-result.json`, screenshot `1225-aptitude-tests.png` in the run folder): document status was **200** (the #1225 claim), after which the client's own auth guard redirected the unauthenticated browser to `/login`, which rendered normally. That redirect is client-side route protection, not a server status failure; the HTTP probe above records the document status directly.

## Fresh-install proof

- **Database:** private PostgreSQL 16.15 instance owned by this run alone — port **55451** (per task instruction), trust auth, data dir `/var/lib/postgresql/quinn1225`. No other lane's ports (55433/55434/55437/55441) were touched.
- Database `rekrut_after_1225` created **empty** on that instance; schema built **only** by `node migrate.js` from the clone at `b3cee5c3` (full log in `evidence/migrate.log`): **150 migrations** recorded in `_migrations`, **248 public tables**.
  - **Known fresh-install defect persists at this commit:** `migrate.js` exits **1** at `p2_schema_hardening.sql` — code `0A000`, `cannot alter type of a column used by a view or rule` (`candidate_profiles.availability` / `v_candidate_full_profile`). Identical to every prior AFTER run; #1141 territory, pre-existing, unrelated to #1225. **Nothing was hand-applied.**
- **Dependencies (method deviation, disclosed — same as prior Quinn AFTER runs):** `npm ci` failed with `ENOSPC` during the `onnxruntime-node` postinstall download (log in `logs/npm-ci.log`; the volume reported 58G free afterwards — the failure is transient to that install, exactly as in the #1251–#1261 run). `package.json` + `package-lock.json` (root and client) were verified **byte-identical** between this commit and the #1251–#1261 AFTER run's tested commit, so that run's installed `node_modules` were reused via symlink. Client rebuilt fresh from this commit's source with `npm run build`, exit **0** (`logs/client-build.log`).
- Server: `node server.js` from the clone at `b3cee5c3`, port **3000**, run-local `JWT_SECRET`/`SESSION_SECRET`/`ADMIN_*` env (values committed nowhere). Health during the run: `200 {"status":"ok", db connected, commit "b3cee5c33cd7994919166cb1d5e4d8abd52c3765"}` — recorded in `evidence/api-probe.json` (`health` field).
- No fixtures were needed: the #1225 claim is about document status + rendering of the SPA shell, which needs no seeded users. Protected routes were verified at the document-status layer (the exact layer that was broken); rendering of protected pages behind login is covered by the other Wave-3 AFTER runs at their own commits.

## Limits

Desktop viewport only (1440×900), per standing QA order. Local fresh install only — nothing on staging or production was touched, no PR was merged by Quinn, no issue was closed, no flag flipped, no data outside this run's own local QA database was created or deleted, and no email/outreach was sent. #1225 remains **OPEN** for Lead.
