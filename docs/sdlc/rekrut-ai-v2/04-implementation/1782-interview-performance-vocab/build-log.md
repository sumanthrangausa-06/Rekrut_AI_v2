# #1782 — calcInterviewPerformance interview vocabulary — Build Log

**Story:** #1782 (filed by Lead from the delta re-review of PR #1778,
Finding 6a — pre-existing, out of #1776 scope) · **Branch:**
`nova/1782-interview-performance-vocab` (base: `origin/dev`
`01ceb35b1`, verified first-hand) · **STOP 1:** issue #1782 comment
6377031193 (root cause, fix plan, specialist decision).

## Root cause

`calcInterviewPerformance` (`services/omniscore.js`) filtered real
interviews with `outcome === 'completed' || outcome === 'passed'`.
`chk_scheduled_interviews_outcome` (fresh-DB read-back, PG 16.15,
`node migrate.js` from empty, 253 tables) permits only
`passed/failed/pending_review/no_decision/NULL`; `completed` is a
status value (`chk_scheduled_interviews_status`:
`scheduled/confirmed/in_progress/completed/cancelled/no_show`). The
`outcome='completed'` branch is therefore dead on real data, and the
factor counted only `outcome='passed'` rows: an attended interview
concluded `failed`/`pending_review`/`no_decision` (written as
`status='completed'` + that outcome by `routes/recruiter.js`
PUT /interviews/:id) was invisible to the feedback path, the
completed-count fallback, and `hasData` — persisting as null
(#1538) as if the interview never happened. Same vocabulary class
as the #1776 Quinn catch on `calcReliabilitySignals`.

## Fix (minimum surgical diff — one service file)

- `completedInterviews := status === 'completed' || outcome === 'passed'`
  — exactly the attended definition `calcReliabilitySignals` uses
  post-#1776, with the schema/writer grounding recorded in a comment
  at the filter. No second mechanism.
- **hasData audit (as the issue directs):** the expression
  `practice>0 || evalScores>0 || completedInterviews>0` is unchanged.
  `feedbackScores` derives from `completedInterviews`, so it needs no
  separate term — widening the filter is what makes feedback on a
  status-`completed` interview set `hasData` truthfully. A completed
  interview without feedback/evaluations is measured data (count
  fallback, +10 each cap 50), matching the pre-fix treatment of
  `outcome='passed'` rows; a merely scheduled/no_show/cancelled
  interview still contributes nothing to this factor. Audit outcome
  recorded in a comment at the `hasData` site.
- **Scoring-semantics version bump:** `SCORING_SEMANTICS_VERSION`
  `v4-total-renormalised` → `v5-interview-performance-vocab`
  (the #1776/#1777 precedent; header comment in the service).
  Recalibrates `interview_performance` only for candidates whose
  completed-but-not-passed interviews were previously invisible;
  candidates whose interviews all ended `outcome='passed'` are
  unchanged. Old snapshots are not reinterpreted.

## Tests — red first, then green

**Red (before the fix), real-DB suite only:**
`omniscore-interview-performance-realdb-1782` — **2 failed / 2 passed**.
The two failures are the filed defect exactly: candidates with a
`status='completed'` + `outcome='failed'` interview (feedback rating 4)
and a `status='completed'` + `outcome='pending_review'` interview both
reported `interview_performance.hasData=false` (expected `true`).
The CHECK-rejection pin (`outcome='completed'` INSERT → PG 23514) and
the `outcome='passed'` control passed pre-fix, as designed.

**Green (after the fix):**
- `omniscore-interview-performance-realdb-1782` (new, real DB) +
  `omniscore-factors` — **2 suites, 34 tests, all pass**. The new
  suite asserts returned AND persisted values: failed+feedback →
  raw 40, persisted `factor_scores.interview_performance=40`,
  `interview_score=40`; pending_review count fallback → raw 10,
  persisted 10; passed control → 40 (unchanged).
- Full OmniScore regression set on the same fresh DB —
  `omniscore-factors`, `omniscore-reliability-1776`,
  `omniscore-reliability-realdb-1776`,
  `omniscore-total-renormalisation-1777`,
  `omniscore-total-renormalisation-realdb-1777`,
  `omniscore-interview-performance-realdb-1782`,
  `omniscore-compat-null-1596`, `honest-null-omniscore`,
  `omniscore-factor-null-1538`, `omniscore-explainer-1219`,
  `omniscore-chain`, `omniscore-job-assessments` —
  **12 suites, 85 tests, all pass**.
- Neighbours: `document-verification-omniscore-honest-total-1715`,
  `omniscore-anticheat-honest-null-1715`,
  `matching-engine-omniscore-null-1717`,
  `omniscore-mutual-matches-1271` — pass (7 skipped are DB-gated,
  same as the #1776 run).

**Existing tests updated, citing #1782 in-file:**
`omniscore-factors` — three fixtures used the impossible shape
`{ outcome: 'completed', … }`; they now use real shapes with the
arithmetic unchanged (evaluations-win guard: status completed +
outcome passed; feedback-only regression: status completed + outcome
failed, raw 40; count-fallback regression: status completed + outcome
pending_review, raw 10). Version pins in
`omniscore-reliability-1776`, `omniscore-total-renormalisation-1777`
and its real-DB suite updated v4 → v5 (the same succession update
#1777 made to #1776's pin).

**Rig:** throwaway PostgreSQL 16.15 cluster on 127.0.0.1:55495
(`/var/tmp/nova1782-pgdata`), DB `nova1782` built only by
`node migrate.js` from empty (exit 0); suites run with
`OMNISCORE1782_INTEGRATION_DB_URL` (and the 1776/1777/1596 env vars
pointed at the same DB for the regression run).

## Specialist review

Per the STOP 1 specialist decision on #1782: independent
ecc/code-reviewer review (risk domain: scoring-semantics correctness)
is arranged by Lead after this PR opens, followed by the Quinn +
Candidate Experience journey gate. Security/privacy/DB specialists
were considered and skipped at STOP 1 with reasons (no
auth/consent/PII/schema/SQL surface). **Do not merge until the
review lands.**
