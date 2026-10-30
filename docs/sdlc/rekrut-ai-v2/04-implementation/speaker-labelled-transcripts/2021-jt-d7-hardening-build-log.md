# #2021 — JT-D7/gap-c test-hardening pins from the PR #2018/#2020 reviews (build log)

Story: #2021 [HARDENING] JT-D7/gap-c test pins — session-branch exclusion
fixture, gap-c filter signature, claimed/processing job rows.
STOP 1: issue #2021 comment 6535119935 (Lead/Suga, posted before any code).
Base: dev `58857344e` (origin/dev tip verified first-hand at lane start).
Branch: `nova/2021-jt-d7-hardening`. PR to dev only; no merge/closure by
Nova — Suga gates.
**TEST-ONLY: no production code was changed.** Both mutations below were
applied to `lib/erasureService.js` temporarily for the red-first proof and
reverted with `git checkout` before commit (`git status` shows only the
two test files + this log modified).

## Root cause of each gap

1. **Session-branch exclusion untested (PR #2018 review, minor 1):**
   JT-D7's session-linked fixture seeded
   `panel_expected_user_ids = ARRAY[U_REC, U_OTHER]` — the erased user
   (U_CAND) was not in the array, so the item-1 panel sweep's
   session-branch `NOT IN` exclusion (lib/erasureService.js, sweep
   UPDATE) was never load-bearing: deleting it left the suite green.
   Residual risk was only a `crossRecordingPanelPairsSwept` over-count
   in that combination (GAP-A backstops the final state).
2. **gap-c filter too broad (PR #2018 review, minor 2):** the #2014
   amendment to `gap-c-erasure.test.js` exempted ANY
   `UPDATE interview_recordings` containing `panel_expected_user_ids`
   from the "GAP-C issues no UPDATE against interview_recordings"
   assertion. The GAP-A keep-redact UPDATE
   (`panel_expected_user_ids = '{}', …`) also names the column, so a
   plain panel UPDATE would have been silently exempted.
3. **Claimed/processing jobs unpinned (PR #2020 review, minor):**
   JT-D7 exercised only a `pending` diarization job for the #2019
   in-flight cancellation; the `claimed` and `processing` arms of its
   `status IN ('pending','claimed','processing')` predicate were
   untested.

## Changes (test files only)

- `server/__tests__/lib/erasure-diarization-1915.integration.test.js`
  - Session-linked fixture now seeds
    `panel_expected_user_ids = ARRAY[U_CAND, U_REC, U_OTHER]`; seed
    sanity asserts that exact array, so `crossRecordingPanelPairsSwept`
    staying at 2 pins the session-branch exclusion, and the existing
    tombstone assertions (`[]` + hash NULL) prove the pair was cleared
    only via the item-3 GAP-A(c) redact path.
  - In-flight (panel-swept) recording now carries `pending` + `claimed`
    + `processing` diarization jobs; seed sanity asserts all three
    statuses; post-erasure asserts
    `crossRecordingPanelJobsCancelled === 3` and all 3 rows read back
    `cancelled` (the cross recording's `complete` job stays complete).
- `server/__tests__/lib/gap-c-erasure.test.js`
  - Exemption filter tightened from `/panel_expected_user_ids/` to
    `/array_remove\(panel_expected_user_ids/` — the sweep's exact
    signature — with the comment updated to name the GAP-A redact as
    deliberately NOT exempted.

## Mutation evidence (red-first, HL-003 / TDD)

Rig: PG 18.6 at `/var/tmp/suga2014` (127.0.0.1:55471, user `postgres`).
Fresh DB `nova2021_jtd7_final`: `node migrate.js` exit code **0**
(checked directly, not through a pipe).

Baseline on shipped code (pre-change): JT-D7 1/1 pass, gap-c 14/14 pass.

**Mutation 1 — item 1 (session-branch exclusion):** deleted the
session-branch `AND id NOT IN (… interview_sessions …)` block from the
item-1 sweep UPDATE in `lib/erasureService.js` only. JT-D7 went RED:

```
expect(received).toBe(expected) // Object.is equality
Expected: 2
Received: 3
> expect(result.crossRecordingPanelPairsSwept).toBe(2);
```

(An earlier malformed mutation attempt that left a stray `)` failed
with a SQL syntax error and was discarded as invalid proof; the valid
mutation above removes the whole block including its closing paren.)
Mutation reverted; suite GREEN on shipped code.

**Mutation 2 — item 2 (gap-c filter):** changed the sweep's SET clause
to a plain panel UPDATE (`panel_expected_user_ids =
panel_expected_user_ids`, no `array_remove`). With the TIGHTENED filter
the gap-c rooms test went RED:

```
expect(received).toHaveLength(expected)
Expected length: 0
Received length: 1
Received array: [["UPDATE interview_recordings\n SET panel_expected_user_ids = panel_expected_user_ids, …"]]
```

Control: the SAME production mutation with the OLD broad filter
(`/panel_expected_user_ids/`) PASSED (1 passed, 13 skipped) — proving
the tightening, not something else, is what catches a plain panel
UPDATE. Both mutation and control reverted.

Item 3 has no separate mutation: its pin is the count itself — seed
sanity proves 3 in-flight rows exist pre-erasure, and
`crossRecordingPanelJobsCancelled` was 1 before this change with only
the pending row present.

## Final gate counts (shipped production code, fresh DB)

- JT-D7 (`erasure-diarization-1915.integration.test.js`, `--forceExit`,
  fresh DB `nova2021_jtd7_final`): **1 passed, 1 total**.
- gap-c (`gap-c-erasure.test.js`): **14 passed, 14 total**.
- Erasure neighbour batch (`resume-family-erasure.test.js`,
  `embeddings-erasure.test.js`, `dsar-dek-destruction.test.js`):
  **3 suites passed, 28 tests passed, 28 total**.

## Specialist decision (per STOP 1)

No dedicated specialist spawn — test-fixture/filter work on
already-reviewed production semantics (STOP 1 on #2021). Quinn journey
lens preserved: JT-D7 assertions stay on user-visible erasure outcomes
(absence after erasure) plus the counters the suite already pins.
