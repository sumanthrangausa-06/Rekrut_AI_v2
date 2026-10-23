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

## Quinn journey gate — FAIL (2026-10-23), fixed forward on this branch

Quinn's fresh-install journey gate on PR #1778 head `66fc60101`
(evidence: `hidden_files/quinn-1776-2026-10-23/run.md`) passed Legs 0,
1, 1c but **FAILED Leg 2**: a candidate with 1 application, 1 attended
interview and 1 no-show scored reliability **70 instead of 60**,
persisted — the no-show penalty never fired on real data.

**Root cause (HL-003 class):** `calcReliabilitySignals` counted
no-shows from `outcome ∈ {no_show, cancelled}` and
`fetchCandidateData` selected only `outcome` from
`scheduled_interviews`. Those outcome values are **not storable**:
`chk_scheduled_interviews_outcome`
(`migrations/p2_schema_hardening.sql:2820`) allows only
passed/failed/pending_review/no_decision/NULL. Quinn proved it three
ways — recruiter `PUT` with `outcome:'no_show'` → HTTP 500; direct
INSERTs of outcome `no_show`/`cancelled` → PG 23514. The unit tests
mocked rows as `{ outcome: 'no_show' }`, bypassing the CHECK — mocked
tests proved nothing about the layer they mocked.

**Vocabulary evidence (enumerated from code + migrations, and read
back from a fresh `migrate.js` DB in this fix's rig):**

- `status` CHECK — `chk_scheduled_interviews_status`: `scheduled,
  confirmed, completed, cancelled, no_show, rescheduled`
  (`migrations/p2_schema_hardening.sql:2809`); the JS migration that
  `migrate.js` actually applies swaps `rescheduled` for `in_progress`
  (`migrations/047_p2_schema_hardening.js`) — read back from the fresh
  DB as `scheduled/confirmed/in_progress/completed/cancelled/no_show`.
  Both agree on every value this fix counts.
- `outcome` CHECK — `chk_scheduled_interviews_outcome`: `passed,
  failed, pending_review, no_decision` or NULL (file above, :2820;
  identical read-back from the fresh DB).
- Writers: `routes/recruiter.js` `PUT /interviews/:id` passes `status`
  and `outcome` through separately — Quinn's attended write was
  status `completed` + outcome `passed`; her no-show write was status
  `no_show` + outcome NULL. Cancellations are written as **status**
  `cancelled` by `routes/interviews.js` (reschedule-cancel),
  `routes/recruiter.js` (passthrough; its calendar branch keys on
  `status === 'cancelled'`) and `routes/candidate.js` decline — which
  even writes a free-text reason into `outcome`, further proof outcome
  is not the cancellation vocabulary. No writer anywhere writes
  outcome `no_show`/`cancelled`.

**Fix (same branch, minimum diff — `services/omniscore.js` only):**

- `fetchCandidateData` now also selects `status` for
  `scheduled_interviews`.
- `calcReliabilitySignals`: attended := `status === 'completed' OR
  outcome === 'passed'` (outcome `completed` cannot exist per the
  CHECK — dropped); noShows := `status IN ('no_show','cancelled')`
  (outcome variants dropped — no real writers, CHECK-forbidden).
  Nothing else changes: weights 60/40, renormalisation, coverage
  notes, `hasData`, penalty cap 20 at 10/no-show, scheduled := all
  interview rows.

**Tests — red first, against head `66fc60101`, realistic shapes:**

- Mocked: the `{ outcome: 'no_show' }` fixtures were updated to the
  real shape (`{ status: 'no_show', outcome: null }`, attended as
  `{ status: 'completed', outcome: 'passed' }`, plus a status-
  `cancelled` case and Quinn's exact scenario in both
  `omniscore-factors` and `omniscore-reliability-1776`). Red:
  **4 failed / 32 passed** — Quinn scenario **expected 60, received
  70** in both suites; no-show/cancelled penalty cases 50 vs 40.
- Real-DB (new, the HL-003 pin):
  `omniscore-reliability-realdb-1776.test.js`, following the
  `omniscore-compat-null-1596` pattern — fresh throwaway PG built by
  `node migrate.js` from empty (253 tables), rows inserted via SQL in
  Quinn's exact scenario (1 application; interview status
  `completed`/outcome `passed`; interview status `no_show`/outcome
  NULL). Red on the old head: scenario failed with Quinn's exact
  detail strings and no penalty detail; the vocabulary test (outcome
  `no_show`/`cancelled` INSERTs rejected by the CHECK) passed. Note:
  the migrated schema makes `scheduled_interviews.company_id`/`job_id`
  NOT NULL, so the seed inserts the parent company/job rows the API
  path would have created.

**Green after the fix:**

- The 7 mocked omniscore suites (`omniscore-factors`,
  `omniscore-reliability-1776`, `honest-null-omniscore`,
  `omniscore-factor-null-1538`, `omniscore-explainer-1219`,
  `omniscore-chain`, `omniscore-job-assessments`) — **7 suites, 60
  tests, all pass** (was 57; +3 new reliability cases).
- Real-DB suites on the fresh rig: `omniscore-reliability-realdb-1776`
  **2/2 pass** — reliability raw **60 returned and persisted**
  (`factor_scores.reliability_signals = 60`, `behavior_score = 60`);
  `omniscore-compat-null-1596` **4/4 pass** unchanged.
- Neighbours (`document-verification-omniscore-honest-total-1715`,
  `omniscore-anticheat-honest-null-1715`,
  `matching-engine-omniscore-null-1717`,
  `omniscore-mutual-matches-1271`) — 3 passed, 1 skipped (DB-gated,
  7 tests), 10 passed — same as the first report.

## Gates remaining (Lead coordinates)

- Independent ecc/code-reviewer review of this PR (specialist decision
  recorded at STOP 1: scoring-semantics correctness; security/privacy/DB
  specialists considered and skipped with reasons there).
- Quinn + Candidate Experience user-journey gate on the fresh-install
  dev rig (apply → no 85, coverage note visible; attended + no-show leg
  → measured score). Unit/DB suites above do not claim that gate.
