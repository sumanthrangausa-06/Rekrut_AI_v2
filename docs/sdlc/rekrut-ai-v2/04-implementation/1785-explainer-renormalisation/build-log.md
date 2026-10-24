# #1785 — scoreExplainer factor_breakdown renormalisation — Build Log

**Issue:** #1785 (filed by Lead from the independent review of PR #1784 /
#1777, Finding F1) · **STOP 1:** issue #1785 comment 6377740914 ·
**Branch:** `nova/1785-explainer-renorm` (base: `origin/dev` 969bdaf51).

## Defect

`services/scoreExplainer.js` — `explainOmniScore`, served from
`routes/compliance.js` `GET /explain/omniscore/:userId` — decomposed
contributions with NOMINAL `FACTOR_WEIGHTS`:
`factorContribution(raw, weight) = round((raw/100) × weight × 550)`.
Since #1777 (v4-total-renormalised) the persisted total is renormalised
over measured factors only, so for a partially-measured candidate this
surface's contributions no longer summed to its own `overall_score`.
Review-verified example: sole-measured-factor candidate — headline
850, reliability contribution shown 55, a 495-point unexplained gap.
The function's header comment also still stated the pre-v4 formula.

## Root cause

`scoreExplainer.js` reads the PERSISTED row (`omni_scores`) rather
than recomputing factors, and #1777's renormalisation was applied only
inside `services/omniscore.js` (its `renormalisedWeight` helper drives
`getScoreBreakdown.weighted_contribution` and `getScoreExplainer.impact`
there). `scoreExplainer.js` was outside #1777's STOP 1 scope and kept
the nominal-weight decomposition. The persisted shape already carries
everything needed to renormalise on this surface: `factor_scores` is
number-or-null (#1538), so non-NULL = measured.

## Fix (minimum surgical diff — one service file)

`services/scoreExplainer.js` only:

- `explainOmniScore` computes the measured weight sum once from
  persisted `factor_scores` (non-NULL entries, weights from
  `FACTOR_WEIGHTS`) and each factor's **effective weight** =
  nominal ÷ measured-weight-sum (0 for unmeasured).
- `factor_breakdown` entries gain `effective_weight` (mirrors
  `getScoreBreakdown`) and their `contribution` uses the effective
  weight. `weight` stays nominal. Unmeasured factors keep
  `contribution: null` — honest, never a nominal-weight fake and never
  0-substituted.
- The 3-group `score_breakdown` contributions use the same effective
  weights (technical ← verified_skills; behavioral ←
  reliability_signals + soft_skills effective weights summed — their
  source columns are #1596 measured-only compat averages of exactly
  those factors, so average × combined effective weight equals the
  factors' contributions; experience ← experience_quality). A group
  with no measured backing factor gets `contribution: null`.
- `factorContribution`'s header comment and `how_calculated`'s formula
  text now state the v4 renormalised formula; the per-factor breakdown
  lines print the effective weight % so the printed arithmetic matches
  the printed contribution.
- The #1531 honesty gate is **kept**: the `300 + …` equality renders
  only when all 8 contributions are present — a stored total is not
  guaranteed v4-derived (e.g. document-verification rows carry totals
  written outside the engine), so for partial rows the stored-total
  wording stands while the numeric contributions themselves are
  renormalised.

Fully-measured candidates are unchanged (renormalising over weight
sum 1.0 is the identity — pinned).

Worked examples (post-fix):

| Persisted row | Contributions | Sum vs headline |
|---|---|---|
| Reliability 100 only, total 850 | reliability 550 (effective weight 1.0), others null | 550 = 850 − 300 |
| Reliability 100 + education 25, total 644 | 275 + 69 (effective .5 each) | 344 = 644 − 300 |
| All 8 measured (#1523 fixture), total 691 | nominal (identity) | 391 = 691 − 300 |
| Partial {verified 50, soft 60}, stored total 500 | verified 196, soft 94 (measured weight .35) | renormalised; equality text withheld per #1531 gate (stored total not engine-derived) |

## Riders from the same review

- **F4(a)** — `calcMarketDemand` fallback cap pinned in the #1777
  suite: 5 in-demand categories → raw 100 (at cap); 6 → raw 100
  (6 × 20 = 120 capped by `Math.min(100, …)`). Previously the largest
  tested matchCount was 2.
- **F4(b)** — mixed-measured breakdown sum pinned in the #1777 suite:
  `getScoreBreakdown` for the 644 fixture — reliability
  `weighted_contribution` 275, education 69, sum 344 = total − 300
  (the mixed total was pinned in #1777; its breakdown sum was not).
- **F2 (docs accuracy)** — the #1777 build log's claim that the
  zero-measured floor artifact is computed "exactly as before" is
  corrected in place: post-fix artifact is 300; pre-fix it was 306
  (it included market_demand's phantom 20). Zero external effect —
  the total is nulled via `hasAnyData` either way.

## Tests — red first, then green

**Red (against unmodified `origin/dev` 969bdaf51):**

- `compliance-score-explainer-repoint-1523` (extended): **6 failed** —
  including the filed defect reproduced exactly through the real route:
  sole-measured contribution sum expected 550, received 55.
- `score-explainer-renormalisation-realdb-1785` (new, real DB):
  **3 failed / 0 passed**.
- The F4 pins in the #1777 suite passed pre-fix as designed — they pin
  already-correct omniscore.js behaviour the review found untested.

**Green after the fix:**

- `compliance-score-explainer-repoint-1523` + `omniscore-total-renormalisation-1777`:
  **37/37** (1523 suite: sole/mixed/full sum-to-total,
  `effective_weight` fields, 3-group renormalisation, PARTIAL_ROW
  expectations updated to renormalised arithmetic — verified 196,
  soft 94, was nominal 69/33).
- Real-DB suite on a **fresh throwaway Postgres** (`node migrate.js`
  from empty; local PG 16.4 + pgvector 0.8.7, DB `nova1785`):
  `score-explainer-renormalisation-realdb-1785` **3/3** — persisted
  sole/mixed/full rows read back through the REAL `explainOmniScore`
  with Σ contributions = total − 300 in each case.
- Neighbour sweep (every suite importing `services/scoreExplainer.js`
  or `services/omniscore.js` that is runnable in this environment):
  results recorded in the PR body.

## Gates remaining (Lead coordinates)

- Independent ecc/code-reviewer review of this PR (specialist decision
  at STOP 1, comment 6377740914: code-reviewer YES for
  scoring-semantics correctness; security/DB/UX considered and skipped
  with reasons there).
- Quinn + Candidate Experience user-journey gate on the fresh-install
  dev rig: partially-measured candidate — explainer contributions sum
  to the headline total. The suites above do not claim that gate.
- Nova does not merge or close.
