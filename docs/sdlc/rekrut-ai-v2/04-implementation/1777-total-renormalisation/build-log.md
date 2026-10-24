# #1777 — OmniScore total renormalisation audit — Build Log

**Story:** #1777 · **Parent / ruling:** #1761 panel position (Scout/Rex/Lead
consolidated brief, comment 6374505039 — companion (2) of Option D) ·
**Branch:** `nova/1777-total-renormalisation` (base: `origin/dev`
`b513d6cfd`, PR #1778 merge, verified first-hand) · **STOP 1:** issue
#1777 comment 6376270386. Companion to Story A #1776
(`1776-reliability-measured-only/build-log.md`), whose work this builds on.

## Scoring-semantics version bump

This change ships as the named bump **`SCORING_SEMANTICS_VERSION =
'v4-total-renormalised'`** (exported from `services/omniscore.js`,
returned by `calculateScore` as `scoring_semantics_version`),
superseding #1776's `v3-reliability-measured-only`. It recalibrates
**partially-measured** candidates' totals — it is not a silent bugfix.
Fully-measured candidates are **unchanged** (renormalising over the
full weight sum 1.0 is the identity — pinned by a test). Old rows and
snapshots written under earlier semantics keep their stored values and
are **not reinterpreted**; only new computations use v4.

Worked examples:

| Candidate | Old total (v3) | v4 total |
|---|---|---|
| Zero inputs | null (#1192) | null (unchanged) |
| Reliability only (1 application, follow-through raw 100) | 361 (0.10 measured weight diluted over 1.0, plus market phantom 20 × 0.05) | **850** — that factor alone: 300 + 1.0 × 550 |
| Reliability 100 + education 25 (weights 0.10 + 0.10) | ~374 | **644** = round(300 + (0.10×100 + 0.10×25)/0.20 /100 × 550) |
| One verified in-demand skill (honest-null suite candidate) | 325 | **355** = round(300 + ((0.25×8 + 0.05×20 + 0.05×10)/100 / 0.35) × 550) |
| Fully measured, integer raws (suite fixture) | 476 | 476 (identity) |

## AC-1 audit table — all 8 factors

Read from the calculators in `services/omniscore.js` on `origin/dev`
`b513d6cfd` (pre-fix), then confirmed post-fix by the test suites below.
"Contribution" is the factor's effect on the weighted total.

| # | Factor (weight) | Raw when `hasData=false` (pre-fix) | Phantom pre-fix? | Post-fix contribution when `hasData=false` |
|---|---|---|---|---|
| 1 | verified_skills (0.25) | 0 — every component is count-based from 0 | No points; weight diluted the total | **0 — excluded, weight renormalised away** |
| 2 | interview_performance (0.20) | 0 — practice/eval/feedback branches all require rows | No points; dilution only | **0 — excluded** |
| 3 | experience_quality (0.15) | 0 — no records, no points | No points; dilution only | **0 — excluded** |
| 4 | education_credentials (0.10) | 0 — degree/GPA/doc/field points all require rows | No points; dilution only | **0 — excluded** |
| 5 | reliability_signals (0.10) | 0 — #1776 measured-only (pre-#1776 it was the fabricated 85) | No points since #1776; dilution only | **0 — excluded** |
| 6 | soft_skills (0.10) | 0 — session/feedback branches require rows | No points; dilution only | **0 — excluded** |
| 7 | market_demand (0.05) | **20** — fallback branch runs when matches are empty: `matchCount(0) × 20 + 20`, even with zero skills | **YES — +20 raw = +5.5 points of phantom in every no-skills/no-matches candidate's total, plus dilution** | **0 — raw is now 0 (floor removed) AND the factor is excluded** |
| 8 | growth_trajectory (0.05) | 0 — recency components all count-based from 0 | No points; dilution only | **0 — excluded** |

Confirmation: post-fix, every `hasData=false` factor contributes
exactly 0 weight — the renormalisation loop in `computeFactors` skips
it (`if (!factor.hasData) continue`), and its nominal weight is absent
from the denominator. The single-factor and mixed tests pin this
numerically: any contribution from a no-data factor — points or
weight — would move the asserted totals (850 / 644).

## AC-3 — calcMarketDemand fallback floor: measured-only (no floor retained)

Disposition recorded at STOP 1 before building: **remove the silent
+20**. No code evidence justifies a floor — the +20 was an unconditional
constant in the skills-category fallback, awarded identically with zero
skills, zero in-demand categories, or several. New fallback:
`pts = min(100, matchCount × 20)`. Consequences:

- No matches and no skills → raw 0, `hasData=false` (was raw 20).
- Skills present, none in-demand → raw 0, `hasData=true` — a measured 0
  (the categories were examined and none matched), which correctly
  counts in the renormalisation denominator as a measurement.
- 1 in-demand category → 20 (was 40); 2 → 40; ≥5 → 100 cap (unchanged cap).
- Matches branch (`matchRate × 100`) untouched — already measured.

## Root cause

`computeFactors` summed `(raw / 100) × FACTOR_WEIGHTS[key]` over all 8
factors over the full weight sum 1.0, regardless of `hasData`; the
total was nulled only when NO factor had data (#1192). So (a) the one
non-zero no-data raw (market_demand's 20) added phantom points, and
(b) every no-data factor's weight stayed in the denominator, diluting
measured factors — a candidate measured on reliability alone scored
361 instead of the 850 that factor's raw implies on the 300–850 scale.

## Fix (minimum surgical diff — one service file)

- **`computeFactors`:** weighted sum and weight sum accumulate over
  measured (`hasData`) factors only; total =
  `300 + (weightedSum / measuredWeight) × 550`, clamped 300–850. No
  measured factor → the floor artifact is 300 post-fix and
  `calculateScore` still nulls it via `hasAnyData` (#1192/#1538
  behaviour unchanged). Accuracy correction (#1785 rider F2): the
  artifact is NOT "exactly as before" — pre-fix it was 306, because
  the pre-fix sum included market_demand's phantom 20
  (300 + (20/100 × 0.05) × 550 = 305.5 → 306). The nulling behaviour
  is unchanged either way; only the discarded artifact's value
  differs, so this has zero external effect. This reuses the measured-only pattern already
  in the file — `compatScore` (#1596) and the #1731/#1776
  renormalisation — no second mechanism. The stale ponytail comment
  claiming weights are deliberately NOT renormalised is replaced
  (the panel ruling on #1761 superseded it).
- **`calcMarketDemand`:** `+ 20` floor removed (above).
- **`renormalisedWeight(factors, key)` helper** (one shared function):
  a measured factor's nominal weight divided by the combined measured
  weight; 0 for no-data. Used by `getScoreBreakdown`
  (`weighted_contribution`, plus a new `effective_weight` field) and
  `getScoreExplainer` (`impact`) so per-factor contributions sum to
  the headline total they sit next to. Hypothetical
  `potential_gain` / `estimatedPoints` recommendation figures keep
  nominal weights — they are not contributions.
- `SCORING_SEMANTICS_VERSION` → `v4-total-renormalised`.

Out of scope (unchanged): factor calculators other than
market_demand; compat columns (#1596 logic untouched); persisted
factor_scores shape (#1538 number-or-null); client code.

## Tests — red first, then green

**Red (new suites against unmodified `origin/dev` code):**

- Mocked `omniscore-total-renormalisation-1777`: **9 failed / 4
  passed**. The filed defect reproduced exactly: sole-measured-factor
  candidate total **expected 850, received 361**; market no-data raw
  expected 0, received 20; explainer impact expected 550, received 55.
  The 4 passing were the regression pins that must hold under both
  semantics (matches branch 100, zero-input null, fully-measured
  identity, no-data-addition invariant).
- Real-DB `omniscore-total-renormalisation-realdb-1777` (fix stashed):
  **1 failed / 1 passed** — the Quinn-scenario persisted-total test
  fails on the old code; the zero-input null pin passes.

**Green after the fix:**

- Mocked omniscore suites — the 7 from #1776 (`omniscore-factors`,
  `omniscore-reliability-1776`, `honest-null-omniscore`,
  `omniscore-factor-null-1538`, `omniscore-explainer-1219`,
  `omniscore-chain`, `omniscore-job-assessments`) **plus the new
  `omniscore-total-renormalisation-1777`** — **8 suites, 73 tests, all
  pass.**
- Real-DB suites on a **fresh throwaway Postgres** (`node migrate.js`
  from empty; local PG 16 cluster, DB `nova1777`):
  `omniscore-total-renormalisation-realdb-1777` **2/2** (apps-only
  candidate: returned AND persisted total **850**, reliability 100,
  every other factor persisted null incl. market_demand, behaviour
  100; zero-input candidate: persisted total null),
  `omniscore-reliability-realdb-1776` **2/2**,
  `omniscore-compat-null-1596` **4/4** — **3 suites, 8 tests, all pass.**
- Neighbours: `document-verification-omniscore-honest-total-1715`,
  `omniscore-anticheat-honest-null-1715`,
  `matching-engine-omniscore-null-1717`,
  `omniscore-mutual-matches-1271` — pass / DB-gated skips, same as the
  #1776 report.
- Every suite importing `services/omniscore.js` (30 suites): 22 passed,
  5 skipped (DB-gated), **3 failed — the same 3 suites / 11 tests the
  #1776 build log recorded as pre-existing on unmodified `origin/dev`**
  (assessments-score-roundtrip, assessments-short-answer-honesty-1572,
  assessments-graded-confidence-1584; none asserts an OmniScore total).

Existing tests updated to the new semantics, with arithmetic shown
in-file: `honest-null-omniscore` (325 → 355 in the with-inputs
regression, the #1251 percentile test, and the heal test's genuine-row
number), `omniscore-factors` (market no-data raw 20 → 0),
`omniscore-reliability-1776` (version pin v3 → v4 only; its reliability
assertions are unchanged).

HL-003 note: the mocked suite's rows use only real shapes (practice
rows with `score: null`, interview status/outcome in the storable
vocabularies per #1776's Quinn evidence); the persisted-total
assertions that matter are additionally pinned on the real-DB suite
above, where rows are inserted by SQL into the migrated schema.

## Gates remaining (Lead coordinates)

- Independent ecc/code-reviewer review of this PR (specialist decision
  recorded at STOP 1: scoring-semantics correctness; security/privacy/
  DB specialists considered and skipped with reasons there).
- Quinn + Candidate Experience user-journey gate on the fresh-install
  dev rig (candidate with exactly one measured factor → total from
  that factor alone; every other factor labelled "Insufficient data").
  The unit/DB suites above do not claim that gate.
