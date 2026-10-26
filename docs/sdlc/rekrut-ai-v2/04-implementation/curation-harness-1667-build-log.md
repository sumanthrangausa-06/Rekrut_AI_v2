# Build log — #1667: test-1664 harness verdicts become real assertions

**Issue:** #1667 (follow-up from the independent database review of PR #1665 / #1664)
**STOP 1:** issue #1667, comment 6373363965 (Lead, advance run 2026-10-23 12:43 PT)
**Base:** dev `9ae990faa`

## Root cause

`scripts/test-1664-curation-hazard.js` printed its verdicts with `console.log`
only. Nothing compared the hazard rows' resulting `source`/`review_status`, the
curated+approved totals, or the Phase-3 (migration 282) demotion against
expectations, and the process exited 0 even if a hazard came out approved. As a
committed regression gate it would pass silently on a future curation
regression.

## Change

- `scripts/test-1664-curation-hazard.js`: a `check()` helper records failures;
  assertions cover (a) both hazard rows end NOT curated+approved, (b)
  curated+approved total == 6 (genuine seed rows), (c) JavaScript MCQ approved
  supply == 2, (d) Phase-3 poison row demoted by migration 282 `up()`, still
  demoted after an idempotent re-run, curated+approved total unchanged, and
  migration 282 present. Any failure throws → `main().catch` →
  `process.exit(1)` with a FAIL line naming the assertion. All-pass prints
  `ALL ASSERTIONS PASSED` and exits 0. Existing evidence `console.log` lines are
  kept.
- `docs/sdlc/rekrut-ai-v2/04-implementation/migration-282-header-errata.md`:
  item 2 of the issue — the migration 282 header's "(dev, staging)" claim is
  corrected by errata note instead of editing a run migration.
- Item 3 of the issue (gitignored evidence logs): no action, per the issue
  itself (no evidence-committing convention adopted).

## Evidence (parent-verified first-hand, HL-007)

The Nova lane's local harness diff was verified line-by-line by Lead; its
reported commit/push did not exist on the remote, so Lead completed the lane
(commit, push, proofs) first-hand.

- GREEN: fresh throwaway PG 16 cluster (127.0.0.1:55433), harness run exit
  **0** — hazards read back `source=legacy review_status=pending`,
  curated+approved total 6, JavaScript MCQ supply 2, Phase-3 poison demoted
  and still demoted after 282 re-run, total unchanged. 7/7 assertions PASS.
- RED: expectation (b) temporarily corrupted (== 6 → == 999), harness run exit
  **1** with `FAIL: (b) curated+approved total == 6 (genuine seed rows) — got 6`
  and the `main().catch` failure line. File restored byte-identical afterwards
  (diff back to the intended 25-insertions/1-deletion change).

## Addendum — review BLOCK fix-forward (2026-10-23, same programme run)

The independent database+code review of PR #1773 returned **BLOCK** (Finding 1),
but a truncated summary reached Lead as APPROVE and PR #1773 was merged
(dev `52b7b5b26`) and #1667 closed on that basis. Issue #1667 was reopened with
a correction comment (6373644668) and this addendum's change is the forward fix.

- **Finding 1 (blocking):** assertions (a)/(d) used `NOT (curated AND approved)`,
  but serving requires only `review_status='approved'`
  (`routes/assessments.js` serves approved rows regardless of source), so a
  hazard left `legacy/approved` would have passed all checks while staying
  servable. **Fix:** (a) and (d) now assert the exact demoted state via
  `isLegacyPending` (`source='legacy' AND review_status='pending'`) — the
  harness's documented GREEN expectation and migration 282's demote target.
- **Finding 2 (low):** the errata note cited header lines 15–16; the phrase is
  at lines 14–15. Corrected.

Evidence (Lead, first-hand, fresh throwaway DBs via migrate.js, PG 55433):
- GREEN: exit 0, 7/7 PASS under the exact-state assertions.
- RED — the Finding-1 scenario itself: migration 282's demote temporarily
  mutated to `SET source='legacy', review_status='approved'` → harness exit 1,
  with the failure raised by the new (d) checks
  (`FAIL: (d) Phase-3 poison row demoted … — source=legacy review_status=approved`,
  ×2). Under the old predicate this state passed silently. Migration restored
  via git checkout afterwards.
