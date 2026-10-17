# Quinn — #1184 Verification Re-Run (2026-10-15)

**Persona:** Quinn (QA). **Scope:** prove or disprove PR #1236 (the #1184 schema-drift class fix:
migration 262 + bootstrap parity + code-side fixes + CI guard) the way the QA standard demands —
fresh install, real app, real screenshots. Quinn verifies and files evidence only; no code was fixed
and #1184 itself is not closed by Quinn (Lead closes it).

## Setup (freshness)

| Item | Measured result |
|---|---|
| Source | Fresh clone of `origin/dev`, head **629eb3d28b43cdd293e2314b81b5eb384c408a3b** — exactly the PR #1236 merge commit |
| Install | `npm ci` (root + client): packages install; the full run failed only at the `onnxruntime-node` postinstall binary download (`ECONNRESET` / socket hang-up — network, repeated 4×). `npm ci --ignore-scripts` then completed **exit 0** (527 root packages; the onnx binary ships inside the tarball and is present). Client build (`npm run build`) **exit 0** |
| Database | Brand-new empty DB `rekrut_quinn_1184` on local PG 16 @ 127.0.0.1:55433, built **only** by `DATABASE_URL=<fresh> node migrate.js` |
| Migrate outcome | **Exit 1, attributed to #1141**: failure is in `p2_schema_hardening.sql`, code `0A000` (rule `_RETURN` on view `v_candidate_full_profile` depends on column "availability"). Migration **262_schema_drift_class_fix applied successfully** before that failure |
| Server | Booted against the fresh DB on port 3000 (the app's CORS allow-list only permits `http://localhost:3000` for browser origins — running on any other port makes the browser refuse its own assets; port 3000 is the Oct 15 pattern). Health: `200 {"status":"ok","db":"connected"}` |
| Fixtures | `@rekrutai.test` accounts only: candidate `candidate@rekrutai.test`, recruiter `recruiter@qacorp.rekrutai.test` (company "QA Corp 2026", slug `qa-corp-2026-2`, id 1), job "QA Fixture Data Analyst" (id 1), one real application, one saved job. No real email sent (SMTP is disabled on this VM; Brevo key on file returns 401 — sends fail harmlessly in logs). No storage uploads were needed by any journey in this set |
| Viewport | Desktop 1440×900, same as Oct 15 |

Seed + corrected API probe results: `seed-results.json`, `api-probe-results.json` in this folder.
(Three seed probes used guessed URL shapes — `/api/careers/company/<slug>`, `/api/careers/my-company`,
`/api/trust-score/leaderboard` — and their 404/500s are probe artefacts, not app results. The real
routes are `/api/careers/:id-or-slug`, `/api/careers/default`, `/api/trustscore/leaderboard`; the
corrected probe in `api-probe-results.json` is the record.)

## Verdict table

Before-state = the pre-fix fresh-DB audit (Oct 15, `qa-1184-run` smoke: every surface below returned
500 on a fresh DB built the same way).

| # | Surface (issue) | Before | After (screenshot) | Verdict |
|---|---|---|---|---|
| 1 | Recruiter job create → created job visible (#1185) | `POST /api/recruiter/jobs` → 500 ("Failed to create job", `jobs.auto_send_on_apply does not exist`) | API **201**; `screenshots/1185/1185-recruiter-jobs-created-visible.png` shows "QA Fixture Data Analyst — Active / Live, 1 Applicants" | **PASS** |
| 2 | Careers page by slug + by id + authed default (#1186) | 500 / 404 on fresh DB | APIs: `/api/careers/qa-corp-2026-2` **200**, `/api/careers/1` **200**, `/api/careers/default` (authed) **200**. Authed page renders fully: `screenshots/1186/1186-careers-authed-default.png` (QA Corp 2026, updated tagline, 1 Open Position) | **PASS** |
| 2a | Logged-out careers visit (#1187 — different, non-schema defect, NOT part of this fix) | bounced to /login | Still bounces to /login: `screenshots/1186/1186-careers-by-slug-loggedout-1187evidence.png` and `...-by-id-loggedout.png` show the Sign-in page. Filed as #1187's evidence; **not counted against #1186** | Reported for #1187 |
| 3 | Public company profile renders (#1189) | `GET /api/company/public/<slug>` → 500 | API **200**; `screenshots/1189/1189-public-company-profile.png` — full profile (Verified, Technology, 11-50, Remote, Est. 2020, 1 Open Position, honest "Not enough data" TrustScore breakdown) | **PASS** |
| 4 | Company profile update saves (#1190) | `PUT /api/company/profile` → 500 | API **200**; re-GET returns the saved values; `screenshots/1190/1190-recruiter-company-profile-update.png` shows description "Updated by Quinn #1184 re-run", Industry Technology, Size 11-50, HQ Remote, Founded 2020 | **PASS** |
| 5 | Candidate jobs list + job detail (#1191) | `GET /api/candidate/jobs` → 500 (`companies.company_size does not exist`) | API **200, 1 job**; `screenshots/1191/1191-candidate-jobs-list.png` (job card, Applied badge) and `1191-candidate-job-detail.png` (full role description + requirements) | **PASS** |
| 6 | Recruiter dashboard / pages without join-requests 500 (#1214 D1) | `GET /api/company/join-requests` → 500 | API **200**; dashboard loads with real pipeline data (`screenshots/1214/1214-recruiter-dashboard.png`); join-requests page renders its empty state (`1214-recruiter-join-requests.png`) | **PASS** |
| 7 | Candidate Saved Jobs + My Applications (#1215 D2) | Saved Jobs → 500 | APIs **200**; `screenshots/1215/1215-candidate-saved-jobs.png` ("1 job bookmarked" — the fixture job) and `1215-candidate-my-applications.png` (the real application in the Applied column, 1 Total Applied) | **PASS** |
| 8 | Admin compliance: data-requests, consents, appeals (#1216 D3) | All three → 500 | All three APIs **200** (corrected probe); page renders counters incl. Consent Records / Pending Data Requests / Pending Appeals with no failed requests: `screenshots/1216/1216-admin-compliance-{data-requests,consents,appeals}.png` | **PASS** |
| 9 | Candidate referrals list (#1217 D4) | `GET /api/referrals` → 500 | API **200**; `screenshots/1217/1217-candidate-referrals.png` — Refer & Earn page loads, zero-state stats, no error | **PASS** |
| 10 | AI Search recommendations (#1218 D5, first half) | `GET /api/matching/recommendations` → 500 | API **200**; AI Search page loads clean: `screenshots/1218/1218-candidate-ai-search.png` | **PASS (this half)** |
| 11 | TrustScore leaderboard (#1218 D5, second half) | 500 (schema) | **Still 500 — different error class.** `GET /api/trustscore/leaderboard` → 500; page shows "Failed to load leaderboard": `screenshots/1218/1218-trustscore-leaderboard-public.png`. Server log: `Get leaderboard error: error: could not determine data type of parameter $1 … at Object.getLeaderboard (services/trustscore.js:1146:22) … code: '42P18'` (see `leaderboard-42P18-log-excerpt.txt`). This is parameter typing, **not** schema drift — unmasked by the fix, not caused by it. Filed as new issue **#1237**; #1218 stays open for this half | **FAIL (expected)** |
| 12a | Bonus: recruiter Candidate Search (p3b tables re-homed) | 500-class on fresh DB | `screenshots/bonus/bonus-recruiter-candidate-search.png` — search loads and finds the fixture candidate with profile (Data Analyst, Remote, 5 years) | **PASS** |
| 12b | Bonus: candidate Company Matches | — | Page loads and renders its positioning UI with the candidate's profile: `screenshots/bonus/bonus-candidate-company-matches.png`. The match-generation API call itself reaches the AI layer and fails there on this VM (no AI providers available — circuits open / not configured), which is an environment limit, not schema drift | **PASS as a surface; AI generation BLOCKED-ENV** |
| 12c | Bonus: candidate Saved Jobs page itself | — | Same screenshot as #1215 Saved Jobs — loads with the real saved job | **PASS** |

## Schema-drift grep (whole re-run server log)

- `does not exist` → **0**
- `operator does not exist` → **0**
- Only remaining 500 class in the set: the leaderboard **42P18** above (reported separately, #1237).

## QA verdict

**The #1184 fix is PROVEN** for every surface it claimed to heal: on a brand-new database built only
by `node migrate.js` from merge commit 629eb3d2, all ten healed surfaces render real fixture data
with zero schema-drift errors in the server log. The one remaining failure (TrustScore leaderboard)
is a different, pre-declared error class (42P18 parameter typing at `services/trustscore.js:1146`),
now filed separately as #1237; #1218 therefore stays open. #1187 (logged-out careers bounce) is
likewise untouched by this fix and was photographed only as that issue's evidence.
