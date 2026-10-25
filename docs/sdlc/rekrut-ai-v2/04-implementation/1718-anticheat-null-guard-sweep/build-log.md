# Build log — #1718 anti_cheat_score NULL guard sweep

- Branch: `nova/1718-anticheat-null-guard`, based on dev tip `59d568553a01b86bef75af962f293a3caf440b8c`
- STOP 1: posted on #1718 (comment 6356452947, per dispatch brief)
- Specialist decision (per dispatch): none beyond the named precedents — the fix mirrors two already-reviewed patterns in the same codebase (see below); no new surface, no API/schema change.

## Root cause

Since migration 290 dropped the `DEFAULT 100` on `anti_cheat_score`, an attempt whose anti-cheat was never computed stores NULL. Three pages still declared `anti_cheat_score: number` and used the value unguarded:

- In JS, `null < 70` is `true`, so a never-computed score fired the recruiter "Low Integrity" warning.
- Rendering `{score}%` with a NULL score produced an empty "Integrity: %" badge — a dishonest surface (looks like a measured 0-ish value, is actually no data).

## Sites fixed

### `client/src/pages/recruiter/assessments.tsx`
- `AssessmentResult.anti_cheat_score` (was :34) and `JobAssessmentResult.anti_cheat_score` (was :118): `number` → `number | null`. (`AssessmentDetail` at :85 already declared `number | null`.)
- Job-assessments meta line (was :385): the `Integrity: {r.anti_cheat_score}%` span is now wrapped in `{r.anti_cheat_score != null && (...)}` — NULL renders nothing.
- Results tab warning (was :484): `{a.anti_cheat_score < 70 && (` → `{a.anti_cheat_score != null && a.anti_cheat_score < 70 && (` — a real 50 still warns; NULL never does.
- Results tab value (was :512): the `{a.anti_cheat_score}%` span is wrapped in `{a.anti_cheat_score != null && (...)}`.
- The detail view (:695-706) already guarded with `== null` → "Insufficient data"; untouched (pinned by test).

### `client/src/pages/candidate/aptitude-test-results.tsx`
- `AttemptDetail.anti_cheat_score` (was :24): `number` → `number | null`.
- The Integrity card (was :216-223, `>= 80` / `>= 50` class comparisons + `{attempt.anti_cheat_score}%` render) is now wrapped in `{attempt.anti_cheat_score != null && (...)}` — the whole card renders nothing when NULL. This mirrors the Percentile card directly above it in the same file, which is already conditional on `attempt.percentile !== null`.

### `client/src/pages/candidate/aptitude-tests.tsx`
- `AptitudeResult.anti_cheat_score` (was :34): `number` → `number | null`.
- Results row (was :308): the `{r.anti_cheat_score}%` span is wrapped in `{r.anti_cheat_score != null && (...)}` — mirroring the neighbouring `{r.percentile !== null && ...}` guard in the same row.

## Precedents mirrored

- Detail view in the same recruiter file: `selectedDetail.anti_cheat_score == null` guard.
- #1715-O1 candidate fix in `client/src/pages/candidate/assessments.tsx`: `r.anti_cheat_score != null && r.anti_cheat_score < 80 && (... Integrity: {r.anti_cheat_score}% ...)`.
- Honest-absence rule: NULL renders NOTHING for the badge — never an empty `%`, never a fabricated 0.

## Tests (red-first, source-guard harness per #1613/#1715 precedent)

New test file: `client/src/__tests__/pages/AntiCheatNullGuard1718.test.ts` (11 tests) — pins, per site: the `number | null` type, the `!= null` guard before every comparison/render, the absence of the bare unguarded warning comparison, and that the real-value render strings (`85%`-style) survive.

Evidence (in the worktree, untracked): `evidence-1718/`

- RED — test file run against pristine dev sources (`evidence-1718/red.txt`): **8 failed | 3 passed (11)**, vitest exit 1. The 3 passes are the preservation assertions (detail-view precedent untouched; real-value render strings present before and after) — same shape as the #1715 suite.
- GREEN — same file after the fix (`evidence-1718/green.txt`): **11 passed (11)**, vitest exit 0.
- Sibling suites re-run with the fix (`evidence-1718/siblings-green.txt`): #1718 (11) + #1613 `override-confidence-honest-null-1613` (6) + #1715 `AssessmentsIntegrityHonestNull1715` (3) = **20 passed (20), 3 files**, exit 0.
- TypeScript: `npx tsc --noEmit -p tsconfig.json` exits 2 with 80 lines of pre-existing errors in unrelated files (test-globals typing in older test files; `interview-active-layout.tsx`, `job-detail.tsx`, `mock-interview.tsx`, `quick-practice-session.tsx`, `recruiter/interviews.tsx`, `recruiter/job-applicants.tsx`). Zero errors in the three touched pages or the new test file (`evidence-1718/tsc.txt`).

## Behaviour after the fix

- NULL score → no integrity badge/card, no Low Integrity warning, on all three pages.
- Real score 85 → badge renders `85%` exactly as before.
- Real score 50 → recruiter `< 70` Low Integrity warning fires exactly as before; candidate colour bands unchanged.

## Not done (by design / gate)

- No E2E/user-journey run: this is a client render-contract fix verified with the repo's established source-guard harness for full pages driven by many endpoints (the #1613/#1715 precedent).
- No GitHub writes were made by Nova (HL-007): no push, no `gh`. Landing is the parent's step after first-hand verification.
