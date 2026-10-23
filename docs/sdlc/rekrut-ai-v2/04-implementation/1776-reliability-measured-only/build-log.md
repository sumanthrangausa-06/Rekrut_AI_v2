# #1776 — OmniScore reliability factor: measured-only raw — Build Log

**Story:** #1776 · **Parent / ruling:** #1761 panel position (Scout/Rex/Lead
consolidated brief, comment 6374505039 — Option D adopted, Lead dissent
preserved) · **Branch:** `nova/1776-reliability-measured-only` (base:
`origin/dev` `c40510322`, verified first-hand) · **STOP 1:** issue #1776
comment 6375408654.

## Scoring-semantics version bump

This change ships as the named bump **`SCORING_SEMANTICS_VERSION =
'v3-reliability-measured-only'`** (exported from `services/omniscore.js`,
returned by `calculateScore` as `scoring_semantics_version`). It
recalibrates fully-measured candidates too — it is not a silent bugfix.
Old rows and snapshots written under the previous semantics keep their
stored values and are **not reinterpreted**; only new computations use v3.

| Candidate | Old raw | v3 raw |
|---|---|---|
| Zero inputs | 85 (50 base + 15 default attendance + 20 default follow-through), `hasData=false` | 0, `hasData=false` → persists `null` (#1538) |
| Apps-only (1 app, 0 withdrawn, 0 interviews) | 85 (only 20 pts measured) | **100** — follow-through only, renormalised, with coverage note |
| Middling fully-measured (a=0.5, f=0.5, no penalty) | 75 | **50** (`60a + 40f − penalty`) |
| Perfect fully-measured | 100 | 100 |

## AC-2 variant ruling (recorded at STOP 1)

AC-2 takes its **main text** (Lead's ruling from the #1761 panel): an
apps-only candidate gets the follow-through-only renormalised raw **with
a coverage note on every grading/labelling surface** — "based on
application follow-through only; attendance: insufficient data" — never
an unqualified grade. The Lead-dissent variant (factor null until an
interview exists) was **not** used.

## Root cause

`calcReliabilitySignals` (`services/omniscore.js`) started from a 50-pt
neutral base, defaulted attendance to 50% (+15) when no interview was
scheduled, and defaulted follow-through to 100% (+20) when no application
existed — and always emitted an "Interview attendance 50%" detail string.
`hasData` was already honest, so the fabricated 85 was persisted as
measured (#1538 path), became `behavior_score` (#1596 path), added ~47
phantom points to the weighted total, and was graded "Excellent —
exceptional" by an explainer with no `hasData` gate.

## Fix (minimum surgical diff — one service file)

- **`calcReliabilitySignals` rewritten measured-only:** attendance
  (weight 60) computed only when ≥1 interview is scheduled; follow-through
  (weight 40) only when ≥1 application exists; no-show penalty only when
  interviews are measured. Raw renormalises over measured weights
  (#1731 pattern): both measured → `60a + 40f − penalty`, clamped 0–100.
  Returns `coverage` + `coverageNote` metadata (no schema change).
- **Zero-input:** raw 0 / `hasData=false` → `factor_scores.reliability_signals`
  persists `null` (#1538), `behavior_score` gets no contribution from it
  (#1596 measured-only compat), the weighted total gets 0 points from it,
  and no attendance-% detail string is produced.
- **`calculateScore`** carries `coverage`/`coverageNote` per factor and
  the semantics version; **`getScoreBreakdown`** carries `coverage_note`
  per factor.
- **`getScoreExplainer`:** `hasData=false` → grade and plain text are
  "Insufficient data", impact 0, no improvement action; partial coverage
  → the coverage note is appended to the plain text and carried in
  `coverage_note`, so a partial score is never graded unqualified.

Out of scope (unchanged): total-weight renormalisation across factors
and the `calcMarketDemand` fallback floor — Story B #1777. Client code
unchanged: the candidate page already renders the explainer `plain_text`.

## Tests — red first, then green

Red run (tests updated/added before the fix, against old code):
**15 failed / 28 passed** across `omniscore-factors`,
`omniscore-reliability-1776`, `honest-null-omniscore` — including the
filed defect reproduced exactly: apps-only explainer raw **expected 100,
received 85**, and a zero-input candidate's reliability graded
**"Excellent"** instead of "Insufficient data".

Green runs after the fix:

- `omniscore-factors`, `omniscore-reliability-1776` (new),
  `honest-null-omniscore`, `omniscore-factor-null-1538`,
  `omniscore-explainer-1219`, `omniscore-chain`,
  `omniscore-job-assessments` — **7 suites, 57 tests, all pass.**
  #1538/#1596 null cases pass unchanged (only stale comments updated).
- `omniscore-compat-null-1596` on a **fresh throwaway Postgres**
  (migrate.js from empty, real `calculateScore`, persisted rows read
  back) — **4/4 pass** with the new expectations: one-app behaviour 100
  (follow-through-only, coverage note asserted), fully-measured control
  behaviour 74 = round((100+48)/2).
- Neighbours: `document-verification-omniscore-honest-total-1715`,
  `omniscore-anticheat-honest-null-1715`,
  `matching-engine-omniscore-null-1717`,
  `omniscore-mutual-matches-1271` — pass (7 skipped are DB-gated in the
  doc-verification check script).
- `honest-null-omniscore` totals updated 372 → 325 with the arithmetic
  shown in-file: a skill-only candidate's reliability now contributes 0,
  not the neutral 85.

Existing tests updated to the new semantics, citing the #1761 panel
brief in-file: `omniscore-factors`, `omniscore-compat-null-1596`,
`omniscore-factor-null-1538` (comment only — assertions unchanged),
`honest-null-omniscore` (neighbour whose total embedded the old 85).

Full unit suite (`server/__tests__|agents`): 3021 passed / 20 failed /
7 suites failed on this branch. The failures are **pre-existing on
`origin/dev`**: every suite that imports `services/omniscore.js` was
re-run, the only failures among them (assessments-score-roundtrip,
assessments-short-answer-honesty-1572, assessments-graded-confidence-1584)
fail identically — 11 failed tests, same suites — on an unmodified
`origin/dev` archive extract, and the remaining failing suites (e.g.
threat-intel-no-surface) do not touch this diff.

## Gates remaining (Lead coordinates)

- Independent ecc/code-reviewer review of this PR (specialist decision
  recorded at STOP 1: scoring-semantics correctness; security/privacy/DB
  specialists considered and skipped with reasons there).
- Quinn + Candidate Experience user-journey gate on the fresh-install
  dev rig (apply → no 85, coverage note visible; attended + no-show leg
  → measured score). Unit/DB suites above do not claim that gate.
