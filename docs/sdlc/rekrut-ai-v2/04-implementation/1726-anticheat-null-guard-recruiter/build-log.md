# Build log — #1726 anti_cheat_score NULL guard, remaining recruiter pages

- Branch: `nova/1726-anticheat-null-guard-recruiter`, based on dev tip `a004071d28d6adf4023c0a9a3592f1efc37efe2c`
- STOP 1: posted on #1726 (comment 6357007673, per dispatch brief)
- Specialist decision (per dispatch): none beyond the named precedents — the fix mirrors the already-reviewed #1718 pattern in the same codebase; no new surface, no API/schema change.

## Root cause

Since migration 290 dropped the `DEFAULT 100` on `anti_cheat_score`, an attempt whose anti-cheat was never computed stores NULL. The #1718 sweep guarded three pages; two recruiter pages still declared `anti_cheat_score: number` and used the value unguarded:

- In JS, `null < 70` is `true`, so a never-computed score fired the recruiter "Low Integrity" warning on `aptitude-test-results.tsx`.
- Rendering `{score}%` with a NULL score produced an empty "%" value, and the CSV export interpolated the literal string `null%` — dishonest surfaces (look like measured values, are actually no data).

## Sites fixed

### `client/src/pages/recruiter/aptitude-test-results.tsx`
- `AttemptResult.anti_cheat_score` (was :31): `number` → `number | null`. (`TestStats.avg_anti_cheat_score` already declared `number | null`.)
- CSV export (was :133): `` `${a.anti_cheat_score}%` `` → `a.anti_cheat_score != null ? `${a.anti_cheat_score}%` : 'N/A'` — NULL exports `N/A`, matching the percentile cell directly above it in the same export (`a.percentile !== null ? ... : 'N/A'`).
- Low Integrity warning (was :345): `{a.anti_cheat_score < 70 && (` → `{a.anti_cheat_score != null && a.anti_cheat_score < 70 && (` — a real 50 (or 0) still warns; NULL never does.
- Results-list value (was :369): the `{a.anti_cheat_score}%` span is wrapped in `{a.anti_cheat_score != null && (...)}` — NULL renders nothing.
- The stats average (:231) already guarded with `!== null` → `'—'`; untouched (pinned by test).

### `client/src/pages/recruiter/job-assessment.tsx`
- Result type `anti_cheat_score` (was :65): `number` → `number | null`.
- Meta line (was :681): the `Integrity: {r.anti_cheat_score}%` span is wrapped in `{r.anti_cheat_score != null && (...)}` — NULL renders nothing.

## Precedents mirrored

- #1718 fix (`73a83923a`): identical type + `!= null` guard shape on `recruiter/assessments.tsx`, `candidate/aptitude-test-results.tsx`, `candidate/aptitude-tests.tsx`.
- In-file precedents in `aptitude-test-results.tsx` itself: the guarded stats average and the CSV percentile `'N/A'` cell.
- Honest-absence rule: NULL renders NOTHING for the integrity value — never an empty `%`, never a fabricated 0; the CSV cell uses `'N/A'` to match its own export's percentile precedent. The guard is `!= null`, so a genuine measured 0 still renders `0%` and still trips the `< 70` warning, exactly as before.

## Tests (red-first, source-guard harness per #1613/#1715/#1718 precedent)

New test file: `client/src/__tests__/pages/AntiCheatNullGuard1726.test.ts` (8 tests) — pins, per site: the `number | null` type (with declaration counts), the CSV `'N/A'` ternary and the absence of the bare CSV cell, the `!= null` guard before the `< 70` comparison and the absence of the bare comparison, each render wrapper with its own occurrence count (`a.anti_cheat_score != null` ×3 across CSV + warning + render; `r.anti_cheat_score != null` ×1), the untouched in-file precedents, and that the real-value render strings survive.

Evidence (in the worktree, untracked): `evidence-1726/`

- RED — test file run against pristine dev sources (`evidence-1726/red.txt`): **6 failed | 2 passed (8)**, vitest exit 1. The 2 passes are the preservation assertions (in-file precedents untouched; real-value render string present before and after) — same shape as the #1718 suite.
- GREEN — same file after the fix (`evidence-1726/green.txt`): **8 passed (8)**, vitest exit 0.
- Sibling suites re-run with the fix (`evidence-1726/siblings-green.txt`): #1726 (8) + #1718 `AntiCheatNullGuard1718` (11) + #1715 `AssessmentsIntegrityHonestNull1715` (3) + #1613 `override-confidence-honest-null-1613` (6) = **28 passed (28), 4 files**, exit 0.
- TypeScript: `npx tsc --noEmit -p tsconfig.json` exits 2 with 80 lines of pre-existing errors in unrelated files (same count as the #1718 run). Zero errors in the two touched pages or the new test file (`evidence-1726/tsc.txt`).

## Behaviour after the fix

- NULL score → no integrity value, no Low Integrity warning, CSV cell `N/A`, on both pages.
- Real score 85 → renders `85%` / `Integrity: 85%` and exports `85%` exactly as before.
- Real score 50 or 0 → the `< 70` Low Integrity warning fires exactly as before; `0%` still renders/exports.

## Not done (by design / gate)

- No E2E/user-journey run: this is a client render-contract fix verified with the repo's established source-guard harness for full pages driven by many endpoints (the #1613/#1715/#1718 precedent).
- No PR opened, no GitHub comments, no merge by Nova (HL-007): the branch is pushed for the parent to verify first-hand and land.
