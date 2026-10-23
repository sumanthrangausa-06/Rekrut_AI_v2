# #1717 — OmniScore reader honesty (`|| 300` fabrication) — Build Log

**Branch:** `nova/1717-omniscore-null-honesty` (base: dev tip `59d568553`)
**Panel position:** `panel-1717/DISCUSSION.md` §3–§4 (Scout · Rex · Lead, discussed
team position, adopted verbatim at STOP 1). Specialist decision (§5): Recruiter +
Candidate Experience personas required; security/privacy/database reviewers
considered and skipped with reasons (database review conditional on the
`omniscore_at_match` nullability check — verified: migration
`008_matching_engine.js` declares `omniscore_at_match INTEGER`, nullable).

## Root cause

Three reader sites used `omniscore || 300`, which cannot distinguish (i) no
`omni_scores` row, (ii) an honestly NULL `total_score` (the #1192 writer-side
contract: a no-data candidate has **no** score), and (iii) a genuinely measured
0 — all three became the invented number 300:

- **Site A** — `services/matching-engine.js` `findMatchingCandidates`: +7.5
  fabricated weighted-score points, payload `omniscore: 300` with a fabricated
  tier sentence, and the fabrication persisted to
  `match_results.omniscore_at_match`.
- **Site B** — `services/matching-engine.js` `findMatchingJobs`: +3.0
  fabricated points on every recommendation, inflating `match_level` /
  `success_prediction` and persisted `job_recommendations.match_score`.
- **Site C** — `routes/recruiter.js` `POST /pipeline/auto-check/:jobId`:
  fabricated 300 auto-**rejected** no-data candidates under the default
  reject threshold (400, migration 038) and could auto-**advance** them under
  any configured threshold ≤ 300 — real state changes plus a rejection
  notification, decided by an invented number.

## Fix (per site, per panel §3)

- **Site A — (a)+(c):** explicit null test (`!== null && !== undefined`). On
  NULL: OmniScore term excluded, remaining weights renormalized ÷0.75
  (0.45 + 0.20 + 0.10); returns `omniscore: null` +
  `omniscore_status: 'insufficient_data'`; `explanation.omniscore_boost` =
  "OmniScore: insufficient data — not counted in this match" (no number);
  persisted `omniscore_at_match` is NULL.
- **Site B — (a)+(c):** same treatment with this function's weights,
  renormalized ÷0.90 (0.45 + 0.20 + 0.25); returns `omniscore: null` +
  `omniscore_status: 'insufficient_data'`; `explanation.your_strength` states
  plainly that no OmniScore was used and how to earn one; `match_level` /
  `success_prediction` derive only from measured components; brand-new
  candidates still receive recommendations.
- **Site C — (c) only:** explicit null test. On NULL the application is
  skipped by both auto-advance and auto-reject — no status UPDATE, no
  `notifyUser` call — and the skip is accounted for in the response
  `actions` as `{type: 'skipped', application_id, candidate_id, from,
  reason: 'OmniScore: insufficient data — automation not applied'}` plus a
  `skipped_insufficient_data` count in the response.
- Measured values, **including a measured 0**, flow exactly as before at all
  three sites (the null test is explicit, never `||`).

**Out of scope (separate issues, untouched):** `trustscore || 500` at
`services/matching-engine.js:444` and `:652` (#1724), `omniscore || 0` at
`routes/recruiter.js:1794` (#1725).

## Tests — red-first, real DB

New suites (real-DB integration, `legal-hold-db` precedent — gated behind
`MATCHING1717_INTEGRATION_DB_URL`, throwaway Postgres, resulting state read
back from the DB):

- `server/__tests__/services/matching-engine-omniscore-null-1717.test.js` —
  Site A: no-row candidate and NULL-total candidate → `omniscore` null +
  marker, `weighted_score` = renormalized value (100 on the fixture geometry),
  explanation carries no OmniScore number, persisted `omniscore_at_match`
  IS NULL; controls measured-600 unchanged (90), measured-0 scored as real 0
  (75). Site B: NULL candidate still gets recommendations, renormalized
  ÷0.90 scores, honest `your_strength`; controls measured-600 (96),
  measured-0 (90).
- `server/__tests__/routes/recruiter-pipeline-auto-check-1717.test.js` —
  Site C: NULL candidate with `auto_reject=true`/threshold 400 and with
  `auto_advance=true`/threshold 200 → status unchanged in DB, no
  notification, skip accounted in `actions`; controls measured-700 advances
  at 600, measured-100 rejects at 400, measured-0 judged as 0 (rejected).

**Red (pristine `59d568553`):** 8 failed, 3 passed, 11 total — every failure
traces to the fabricated 300 (returned `omniscore: 300`; NULL candidates
rejected/advanced; measured-0 controls rewritten to 300). The 3 passes are
the measured-score controls pristine code already satisfies.
**Green (after fix):** 11 passed, 11 total, 2 suites passed.
Evidence: `evidence-1717/red.txt`, `evidence-1717/green.txt` (worktree root).

Run:
```
MATCHING1717_INTEGRATION_DB_URL='postgresql://root@/rekrut_1717_test?host=/var/run/postgresql' \
  npx jest server/__tests__/services/matching-engine-omniscore-null-1717.test.js \
           server/__tests__/routes/recruiter-pipeline-auto-check-1717.test.js --forceExit
```

**Regression check:** 12 neighbouring suites (honest-null omniscore/trustscore/
candidate-routes, matching explain, company-matches, mutual matches, recruiter
override/screening-link, candidate score fallbacks, match explanation) —
85 passed, 2 failed; the 2 failures
(`score-explainer-match-results-1458.test.js`, weights-hash version strings)
reproduce identically on pristine dev `59d568553` in the main checkout, i.e.
pre-existing and unrelated to this change.

**Gate note (HL-003):** these suites are the server-side red/green proof on a
real database. The Quinn user-journey legs in panel §4 (recruiter views a
brand-new candidate's insufficient-data marker; candidate day-one
recommendations; recruiter auto-check skip visibility in the browser) remain
the dev-rig E2E step before this story is reported done.
