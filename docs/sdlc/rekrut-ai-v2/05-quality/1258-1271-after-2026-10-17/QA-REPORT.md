# Quinn AFTER — #1258 + #1271 batched (2026-10-17)

**Persona:** QUINN (QA). Skills: startup-cto first, ecc/e2e-runner + gstack/qa, verification-before-completion last.

## Tested target / scope / limits (stated before verdict)

- **Target:** live `origin/dev` head `4be9bb02dd15c445862d6516e35d63be57fbbf37` (merge of PR #1277), verified via `gh api commits/dev` and re-fetch in Quinn's own isolated clone (`hidden_files/1258-1271-after-run/repo`, branch `qa/1258-1271-after-2026-10-17`). PR #1275 MERGED (commit `1e5ff39b`), PR #1277 MERGED (merge `4be9bb02`). #1258 and #1271 both OPEN pending this AFTER batch. Shared checkout untouched.
- **Setup:** This VM had no Postgres (prior runs' instances did not survive a VM replacement). Private PostgreSQL 16.4 instance installed from standalone binaries for this run alone — port **55461**, trust auth, data dir `/tmp/pgdata1258`, plus pgvector 0.8.7 (PGDG .deb, extracted into the instance tree). Fresh DB `rekrut_after_1258_1271` created empty, built **only** by `node migrate.js`: exit 1 at `p2_schema_hardening.sql` (0A000 — #1141, pre-existing, nothing hand-applied). 150 migrations, 248 public tables.
- **Dependencies:** root+client `package.json`/lock verified **byte-identical** to the #1251–#1261 AFTER run's commit → its `node_modules` reused via symlink (removed before the evidence commit), disclosed here and in the PR body. Client build exit 0. Server `node server.js` port 3000, run-local `JWT_SECRET`/`SESSION_SECRET` (values committed nowhere), health 200 `{"status":"ok","db":"connected"}`.
- **Limits:** (1) No AI provider keys exist in this sandbox, so `POST`-free live `GET /api/candidate/company-matches` cannot reach its scoring path — `lib/ai-provider` throws "No available providers" and the route returns 500 (recorded live, screenshot 07). #1271(b)'s omitted/unparseable branches are therefore proven at the **same head** by the PR's own merged suites (jest route tests mock only the AI-provider boundary and execute the real route code; vitest renders the real page component), plus the live negative observation that no fabricated score renders. (2) The live mutual-fit value (0) is *consistent with* but not *discriminating for* the 0-strength rule in this seed, because company TrustScore is also NULL (geometric mean is 0 either way); the discriminating live evidence is the `skill_match` label, and the strength math with non-zero companion signals is covered by the merged `omniscore-mutual-matches-1271` suite. (3) Login rate limiter (429) tripped twice by repeated probe logins — scratch-DB `rate_limit_buckets` cleared between phases, disclosed (same pattern as prior AFTER runs). (4) Probe v1's two #1271(a) FAILs were harness defects (wrong response key `matches` vs `mutual_matches`; retained in `evidence/api-probe.json`, superseded by `evidence/api-probe-1271a-v2.json` 6/6).

## Results — OVERALL PASS (2/2)

### #1258 — PASS (live)
API probe (`evidence/api-probe.json`, #1258 checks 6/6):
- Employer login 200; `user` object **has `company_id`**; payload value **1 === seeded `users.company_id`** (company created in scratch DB).
- Candidate login 200; `company_id` key present-and-**null**.
- Consistency: `GET /api/auth/me` company_id (1) matches the login payload.
- Browser: real UI login as the seeded candidate lands on `/candidate` dashboard rendering the seeded data (screenshot 03, visually inspected).
- Regression suite at this head: `auth-login-company-id.test.js` PASS (part of jest 10/10 below).

### #1271 — PASS (live (a); same-head suites + live negative for (b))
**(a) Mutual matches — live PASS 6/6** (`evidence/api-probe-1271a-v2.json`): seeded candidate with a verified JavaScript skill (real OmniScore **372**) and a job application but **zero `match_results` rows**:
- `GET /api/omniscore/mutual-matches` 200, applied job row present.
- `signals.skill_match === "Insufficient data"` — never a fabricated %.
- No `"50% match"` anywhere in the payload; `mutual_fit_score = 0`.
- Browser (screenshot 06, visually inspected): Mutual Matches tab renders the card — **"0% Mutual Fit"**, "OmniScore 372 (Needs Work)", "TrustScore N/A (Insufficient data)", **"Insufficient data"** skill chip, "applied". No 50% anywhere.

**(b) Company matches — PASS via same-head suites; live path environmentally blocked (disclosed above)**:
- Jest `candidate-company-matches-1271.test.js` PASS: AI omits a company → its `match_score` is **null**, never 50; scored companies sort first, unscored last (order [2, 3, 1]); AI returns unparseable output → **every** `match_score` null.
- Vitest `CompanyMatchesHonestScore.test.tsx` PASS: unscored company renders **"N/A"** + **"Insufficient data"**, no "50%"; real 88% renders (progress bar is rendered only for non-null scores in the merged component).
- Live attempt recorded: `GET /api/candidate/company-matches` → 500 (no AI providers configured in sandbox); browser after Continue shows the error banner + "0 companies ranked / No matches found" — no fabricated score rendered (screenshot 07, visually inspected).

**Suites at this head:** jest 3 suites / **10 tests PASS** (`auth-login-company-id`, `candidate-company-matches-1271`, `omniscore-mutual-matches-1271` — `evidence/jest-suites.log`); vitest **1/1 PASS** (`evidence/vitest-company-matches.log`).

## Screenshots (all in `screenshots/`, visually inspected: 03, 06, 07 + text-verified 01, 02, 04, 05)
01 login page · 02 login filled · 03 candidate dashboard after UI login · 04 omniscore page · 05 company-matches positioning gate · 06 **mutual-matches tab (key #1271a proof)** · 07 company-matches after Continue (AI-unavailable error state, no fabricated scores).

## Boundaries held
No promotion to staging/main, no `RETENTION_PURGE_LIVE` flip, no schema change/drop, no live/production DB (scratch local PG only), no email/outreach, no merge, no issue close. Scratch DB left intact (never delete database rule). App server stopped at run end; private PG on 55461 left running (this run's own instance).

## Residuals
None for #1258 / #1271(a). For #1271(b): a fully-live company-matches capture still requires an AI-provider key in the QA environment — recommended one-time re-capture when a key is available; the code path itself is proven at this head by the suites above. Pre-existing migrate halt #1141 only.
