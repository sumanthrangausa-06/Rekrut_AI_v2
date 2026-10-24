# #1728b — recruiter-introductions cached-fallback gate must not act on a renormalised score (build log)

**Defect:** In `routes/recruiter-introductions.js`, both cached-fallback
blocks (the matching-engine-error catch and the engine-unavailable else)
SELECTed only `weighted_score` from `match_results` and gated the Top-5
introduction on `fitScore >= 70`. A cached `weighted_score` whose basis
was renormalised over measured components only — either at-match column
NULL (`omniscore_at_match` / `trustscore_at_match`, the #1717/#1724
semantics) — was indistinguishable from a fully-measured score at that
gate, so an introduction (and a weekly quota slot) could be granted on
partial evidence.

**Root cause:** The fallback SELECTs never read the at-match columns,
so the gate had no way to tell a renormalised score from a fully
measured one. The columns exist in the live schema (migration 008,
verified against a fresh `node migrate.js` build) and are written by
`services/matching-engine.js`; only this reader ignored them.

**Fix (minimum, per STOP 1 on #1728):** Both fallback SELECTs now also
fetch `omniscore_at_match, trustscore_at_match`, and both blocks judge
the row through one small shared helper, `judgeCachedMatch`:

- either at-match column NULL → the handler returns a distinct honest
  error before any write: HTTP 403, code `INSUFFICIENT_DATA`, message
  "Insufficient data: this match lacks fully-measured evidence for an
  introduction". No introduction row is created and no quota is
  consumed (the quota increment is step 6 of the handler, after this
  gate — ordering verified in the route and asserted by the tests).
- both at-match columns non-NULL → the existing `>= 70` heuristic is
  unchanged.
- NULL `weighted_score` → unchanged S-11 behaviour (#1731 Lane 3):
  no evidence, gate fails with the existing `NOT_TOP_FIVE`.
- The primary live-rank path (matching engine result) is untouched.

**User-visible behaviour change:** A candidate whose only cached match
for a job rests on a renormalised score now gets an honest
insufficient-data refusal instead of an introduction granted on partial
evidence (or, below the fold of the old heuristic, a misleading
not-top-five). Fully-measured matches behave exactly as before.

**Tests:** `server/__tests__/routes/recruiter-intros-fallback-gate-1728b.test.js`
— real-DB integration suite in the S-11/Lane-3 pattern (throwaway
Postgres, real HTTP via supertest; only auth/subscription/email and the
matching-engine producer are mocked). Both fallback blocks are
exercised: the catch block via a throwing engine, the else block by
removing `findMatchingCandidates` from the mocked engine module.
Red-first on pristine `origin/dev` (00948ffec): 2 failed / 4 passed —
both renormalised cases (J1a/J1b) returned 201 and created the
introduction. Green after the fix: 6/6 — J1a/J1b refuse with
`INSUFFICIENT_DATA` (zero intro rows, quota `used_count` still 0),
J2a/J2b fully-measured 85 passes on both blocks, J3 fully-measured 50
stays `NOT_TOP_FIVE`, J4 NULL `weighted_score` stays S-11.

**Neighbour suites:** `score-honesty-1731-lane3` initially failed its
two S-11 cases on this branch: its minimal `match_results` DDL lacked
the at-match columns the live schema carries, and S-11b seeded a
`weighted_score` of 80 with the at-match basis implicitly NULL — under
#1728b semantics that row is renormalised and is now correctly refused.
The fixture was aligned to the live schema (columns added per migration
008; S-11b now seeds a fully-measured row, 600/700) and the suite passes
11/11, as it does on pristine dev with its original fixture. The
matching neighbours (1717, 1724, 1748, 1752, 1755, 1463, 1468, 1458)
all pass on this branch.
