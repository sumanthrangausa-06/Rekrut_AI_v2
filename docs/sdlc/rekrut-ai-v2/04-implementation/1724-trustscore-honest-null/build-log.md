# #1724 — TrustScore reader honesty (`|| 500` fabrication) — Build Log

**Branch:** `nova/1724-trustscore-honest-null` (base: origin/dev `a004071d2`)
**Panel position:** `panel-1724/PANEL.md` §0–§2, §5.1 (Lead · Rex · Scout ·
Recruiter — discussed team position; STOP 1 posted on #1724). Specialist
decision (panel §4.2): **no additional specialist** — semantics, pattern and
test shape are fully settled by the #1717 precedent in the same two
functions; privacy/database/security considered and skipped with reasons
recorded there (database reduced to one build-time check, below).

## Root cause

Two reader sites in `services/matching-engine.js` used
`const trustscore = job.trustscore || 500`, which cannot distinguish
(i) no `trust_scores` row for the company, (ii) a row whose `total_score`
is honestly NULL, and (iii) a genuinely measured **0** — all three became
the invented number 500:

- **Site A** — `findMatchingCandidates` (trust weight **0.10** in this
  function: similarity .45 / skills .20 / OmniScore .25 / trust .10):
  +5 fabricated weighted-score points on every candidate match for an
  unmeasured company, a fabricated `Company TrustScore 500` explanation
  string, and the fabrication **persisted** to
  `match_results.trustscore_at_match`, where it kept feeding
  `explainMatch`'s cached path and the introductions fallback.
- **Site B** — `findMatchingJobs` (trust weight **0.25** in this
  function: similarity .45 / skills .20 / trust .25 / OmniScore .10):
  +12.5 fabricated points on every job recommendation, payload
  `trustscore: 500`, and the explanation `Company TrustScore 500
  (new tier)` — a fabricated number *and* an invented tier.

## Fix (both sites, mirroring the #1717 per-site inline pattern — there
is no shared helper in the codebase, panel §0.3)

- Explicit null test (`!== null && !== undefined`) →
  `hasTrustscore`; `trustscore` is the measured value or `null`.
  A measured score, **including a measured 0**, flows exactly as before.
- On NULL: the trust term is excluded and the weighted score is
  renormalized over measured components only. The divisor is computed
  as the sum of the measured weights (never stacked ternaries, panel
  §0.4): Site A — trust-only missing ÷0.90, OmniScore-only missing
  ÷0.75 (as #1717 shipped), both missing ÷0.65; Site B — trust-only
  missing ÷0.75, OmniScore-only missing ÷0.90 (as #1717 shipped),
  both missing ÷0.65.
- Payloads: Site A gains top-level `trustscore` (it returned none
  before) and both sites return
  `trustscore_status: 'measured' | 'insufficient_data'`, mirroring the
  existing `omniscore` / `omniscore_status` pair.
- Persistence: Site A's `match_results` write now passes the nullable
  `trustscore` variable, so `trustscore_at_match` is written **NULL**
  when insufficient. Nullability re-confirmed at build time against
  migration `008_matching_engine.js`: `trustscore_at_match INTEGER,`
  — no `NOT NULL`, nullable. No schema change.
- Explanations: insufficient-data wording with no number —
  Site A `company_trustscore`: "TrustScore: insufficient data — not
  counted in this match"; Site B `company_quality`: "Company
  TrustScore: insufficient data — not counted in this match".
  Measured companies' strings are byte-identical to before. Site B's
  `trust_tier` stays whatever the query returned (NULL when no row) —
  no invented `'new'` tier in the insufficient case.
- `explainMatch` on-demand return (panel §2.2) now also carries
  `omniscore`, `omniscore_status`, `trustscore`, `trustscore_status`
  from the computed match. The cached branch is unchanged (it returns
  the `match_results` row; its `*_at_match` NULLs are the signal).
  The fields were **not** added to the #1468 candidate-safe allowlist
  in `routes/matching.js` — that file is untouched.

**Out of scope (untouched):** #1728 consumers (`/stats`,
introductions), any client change, schema changes.

## Tests — red-first, real DB

New suite `server/__tests__/services/matching-engine-trustscore-null-1724.test.js`
(mirrors the #1717 real-DB harness; gated behind
`MATCHING1724_INTEGRATION_DB_URL`, throwaway Postgres, resulting state
read back from the DB). The only stub is the external embedding API
(`lib/ai-provider`), which returns the exact seeded unit vector — no
AI provider is reachable from the rig and `explainMatch`'s on-demand
branch calls the embedding refresh unguarded; all SQL, scoring,
renormalisation and persistence under test are the real production
paths. Fixture geometry: similarity 1.0, skills 100, OmniScore 600 —
expected values recomputed from the code's actual weights and pinned
(Site A trust-missing 88.89, Site B trust-missing 94.67 — identical to
the panel §5.1 arithmetic, no divergence; both-missing ÷0.65 → 100 at
both sites; measured-0 controls 80 / 71; measured-800 controls 88 / 91;
OmniScore-only-missing 97.33 / 94.44).

- **Red (pristine origin/dev `a004071d2`):** 13 failed, 0 passed —
  every failure traces to the fabricated 500, the measured-0 promotion,
  or the missing marker/payload fields.
- **Green (this branch):** 13 passed, 0 failed.
- **Neighbours re-run green:** #1717 engine suite 7/7, #1717 pipeline
  auto-check suite 4/4, matching explain/allowlist neighbours
  (1468, 1479, 1463, 1271 ×2) 29/29 across 5 suites.
- **Full unit suite** (`server/__tests__` + `agents`): 270 suites
  passed, 8 failed; 2831 tests passed, 162 failed. The same 8 suites
  (candidate-autosend, spa-routes, assessments ×4,
  score-explainer-match-results-1458, threat-intel-no-surface) fail
  with the **identical 162 test failures on pristine origin/dev** —
  pre-existing, unrelated to this change. (The DB-gated #1717/#1724
  suites skip in the full run without their DB env vars; they were
  run separately as above.)

## User-visible behaviour change

Job recommendations and recruiter candidate lists for companies with
no measured Trust Score no longer show or rank by an invented 500:
the score is computed from the measured components only, the payload
marks the Trust Score `insufficient_data`, explanations say so in
words, and stored match rows record NULL instead of 500.
