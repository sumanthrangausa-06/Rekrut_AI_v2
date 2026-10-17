# QA REPORT — AFTER verification: #1227 LinkedIn Optimizer tips 404 (fresh install)

**Persona:** QUINN (Phase 6 — Quality) · **Date:** 2026-10-16 · **Run dir:** `~/workspace/goals/launch-rekrut-ai-v2-by-january/hidden_files/1227-after-run/`
**Tested commit:** `210504a5d6a3788116be8f15cf4d32e6d2eb577f` (Merge PR #1264) — verified equal to live `origin/dev` head at run start (`git fetch` + `rev-parse`), in Quinn's own fresh worktree (`hidden_files/1227-after-run/repo`, detached HEAD, clean). This head contains the fix merge `054c6ab8` (PR #1262, fix commit `8d4b7396`: `linkedin-optimizer.tsx` now calls the real `/linkedin/tips/:candidateId` route). The shared dev worktree was not touched.
**Scope:** AFTER capture for #1227 only. **This run closes nothing and merges nothing.** Issue #1227 stays OPEN for Lead. No promotion, no purge flag, no live/production DB, no outreach, no code fixes in this lane.
**Skills:** startup-cto first; ecc/e2e-runner + gstack/qa lens; verification-before-completion last (every claim below is backed by a probe file, a network capture, or a visually inspected screenshot).

## Verdict — #1227 PASS

| Check | Result | Evidence |
|---|---|---|
| **API — real tips route** | `GET /api/linkedin/tips/<ownId>` as the seeded candidate → **200**, `success: true`, real payload: `profileStatus` (connected `true`, completeness from the seeded row), **5 tips**, **3 headline suggestions**, **5 weekly-plan entries**, about template, summary. Payload reflects the seeded profile exactly — headline suggestions are built from the seeded headline "Data Analyst" (`"Data Analyst \| Building scalable systems"`, …) | `evidence/api-probe.json` — 7/7 checks PASS |
| **API — guards intact** | Other user's id → **403** "Access denied" (`requireOwnCandidate` not weakened); anon → **401**. The old phantom string `GET /api/profile-enhancement/linkedin-tips` → **404 `{"error":"API endpoint not found"}`** (the route-miss body — documents that the dead string stays dead; the fix moved the client, it did not alias the wrong path) | `evidence/api-probe.json` |
| **Browser — LinkedIn Optimizer page (desktop 1440×900, real UI login)** | Candidate login → lands `/candidate`; page at `/candidate/linkedin-optimizer` fired exactly one tips call: **`200 /api/linkedin/tips/1`**. **Zero** requests containing `profile-enhancement`, **zero** 404s among all page API calls, no "API endpoint not found" text, no error boundary. Tips render (see screenshot description) | `evidence/browser-result.json`, `screenshots/1227-candidate-linkedin-optimizer.png` |

**Overall: PASS.** API probe 7/7 PASS; browser checks PASS.

## Screenshot — what it actually shows (visually inspected by Quinn)

`screenshots/1227-candidate-linkedin-optimizer.png` (full page, 1440×900): the candidate shell with "LinkedIn Optimizer" highlighted in the left nav, signed in as "Quinn After 1227 Candidate". Main panel: "LinkedIn Optimizer" heading with the AI-tips subheading; a profile-status card showing **Connected** (green link icon), **Profile Completeness 25%** with a red progress bar, "Missing: headline, about, skills", and a blue "View Profile" button; a summary banner — "Your LinkedIn profile is 25% complete. Focus on headline and about and skills to increase visibility."; tabs **Optimization Tips / Headlines / About Section / Weekly Plan**; tip cards rendered below — HEADLINE · HIGH "Strengthen your headline" with its actionable example, ABOUT · HIGH "Write a compelling About section", SKILLS · MEDIUM "Add more skills" (further cards continue below the fold in the full-page capture, matching the 5-tip payload). No error banner, no 404 text, no spinner, no empty state. Every value on the page (connected status, 25%, the three missing sections, the tip set) is exactly what the seeded `linkedin_profiles` row (short headline, short summary, 2 skills, URL set) produces from this handler — no fabricated data.

## Fresh-install proof

- **Database isolation:** private PostgreSQL 16.15 instance owned by this run alone — port **55437**, trust auth, data dir `/var/lib/postgresql/quinn1227` — per Lead's instruction (the 55433/55434 password-rotation failure of the last batch cannot recur; neither shared port was touched). Left running at run end; the app server was stopped.
- Database `rekrut_after_1227` created **empty** on that instance; schema built **only** by `node migrate.js` from the fresh worktree at `210504a5` (full log in `evidence/migrate.log`): **150 migrations** recorded in `_migrations`, **245 public tables**.
  - **Known fresh-install defect persists at this commit:** `migrate.js` exits **1** at `p2_schema_hardening.sql` — code `0A000`, `cannot alter type of a column used by a view or rule` (`candidate_profiles.availability` / `v_candidate_full_profile`). Identical to every prior AFTER run; #1141 territory, pre-existing, unrelated to #1227. **Nothing was hand-applied.** (Table count differs from the prior batch's 248 because migration 263 and intervening dev commits landed since; the tips flow's tables — `users`, `linkedin_profiles`, `profile_tool_progress` — are all present and exercised.)
- Server: `node server.js` from the worktree at `210504a5` (node_modules reused from Quinn's prior clone — no dependency changes at this head; client rebuilt with `npm run build`, exit 0), serving on port **3000**. Health: `200`, `"db":{"connected":true}`, commit `210504a5…` reported by `/health`.
- Fixtures (this run's scratch DB only, seeded via the repo's own bcryptjs hashing): one candidate (`quinn-after-1227-candidate@example.com`) with a seeded `linkedin_profiles` row (URL set, headline "Data Analyst", short summary, skills `[SQL, Python]` — the state the tips handler personalises from), plus a second candidate used only as the other-user 403 control. No env-admin was needed for this defect.

## Observations (not verdicts)

- **O1:** Browser console shows `ERR_TUNNEL_CONNECTION_FAILED` resource errors — these are non-API external resources failing through this VM's egress proxy; every `/api/` call on the page returned 200 and the page rendered completely. Not a #1227 signal.
- **O2:** The server does not log per-request paths, so there is no server-log line for the tips call; the network evidence is the browser capture (`browser-result.json`) and the API probe, both recorded live against this run's server.

## Limits

Desktop viewport only (1440×900), per standing QA order. Local fresh install only — nothing on staging or production was touched, no PR was merged by Quinn, no issue was closed, no flag flipped, no data outside this run's own local QA database was created or deleted, and no email/outreach was sent. #1227 remains **OPEN** for Lead.
