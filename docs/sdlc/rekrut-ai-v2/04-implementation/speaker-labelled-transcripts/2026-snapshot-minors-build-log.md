# #2026 — #2011 Part B review minors: record_id precedence + forced hold-lookup-failure cell (build log)

Story: #2026 [FOLLOW-UP] #2011 Part B review minors (M1 + M2; M3 explicitly
no-change). From the independent review of PR #2025 (APPROVE-WITH-MINORS,
PR comment 6537592387). #2026 stays OPEN after this lane — Suga gates the merge.
STOP 1: issue #2026 comment 6538008433 (posted before any code; specialist
decision YES — privacy/erasure lens used; Lex, database, and security lenses
considered and skipped with reasons recorded there).
Base: dev `cd01ec19e`. Branch: `fix/2026-snapshot-minors`.
PR to dev only; no merge/closure by Nova — Suga gates.

## Root cause (M1)

In `sweepPanelConsentSnapshots` (`lib/erasureService.js`), the referenced-user
map enumerated `expected_user_ids` first (`recordId: null`) and the decisions
loop only inserted users not already present (`!referenced.has(uid)`). For a
user in BOTH lists, the decision's `record_id` was therefore dropped, so
`snapshotSourcePresent` was called with `recordId: null` and its
`OR id = $3` leg — the leg that proves a source alive from a live consent row
on a different event — could never fire for that user. A both-lists snapshot
on an ended host recording could be expired despite a live `record_id` row.
Verified unreachable on real data today under the diarizationGate invariant
(per the issue); this is hardening plus the regression cell that pins it.

## What changed

- `lib/erasureService.js` (M1, one-line class): in the decisions loop, when
  the user already exists in the referenced map with `recordId == null` and
  the decision carries a `record_id`, the decision's `record_id` fills the
  entry in. Nothing else in production code changes — the
  `snapshotSourcePresent` SQL, the two-leg clock, the hold discipline, and
  all counters keep their Part B semantics. The fix can only retain a
  reference longer when a live source row proves itself; it can never remove
  earlier or retain after the source is gone.
- `server/__tests__/lib/erasure-snapshot-sweep-2011.integration.test.js`:
  - **Cell J (M1 regression):** seeded in the shared matrix. PAN in BOTH
    `expected_user_ids` and `decisions`; the decision's `record_id` points
    at a LIVE `event_labelling_consent` row on a DIFFERENT event; NO consent
    row for PAN on the snapshot's host event; host recording is a tombstone
    (`status='deleted'`). Asserted byte-identical after the dry-run, live,
    and third sweeps.
  - **Cell K (M2):** seeded inside its own test so the shared matrix
    counters do not move. Tombstone host, PAN's host-event source deleted,
    swept through a wrapping `queryable` that throws only on `legal_holds`
    queries (exactly the queries `findActiveHold` issues with the sweep's
    pool) and delegates everything else to the real pool — the real sweep
    against the real DB, no mocking of `sweepPanelConsentSnapshots` itself.
    Asserted: counted `lookupFailedSkipped`, left byte-identical, nothing
    removed. The already-seeded held cell F reaches the same throwing
    lookup in that run and is likewise counted `lookupFailedSkipped`
    (never `heldSkipped`), so the test expects `lookupFailedSkipped = 2`
    (K and F), `heldSkipped = 0`, `referencesRemoved = 0`,
    `snapshotsExpired = 0`.
  - **Counter shifts from adding J (explained, no assertion weakened):**
    J is one additional snapshot-carrying job row that is never removed.
    `scanned` in the dry-run test shifts 11 → 12 and in the live test
    10 → 11. Every other pre-existing counter expectation is unchanged,
    because after the fix J is never expired; J was added to the
    byte-identical assertion lists of all three pre-existing sweep tests.
- **M3: no change** (hold-check-before-dry-run-gate counter semantics stay
  exactly as Part B built them, per the issue).

## Evidence (HL-003, local PG 18.6 + pgvector rig @127.0.0.1:55439, /opt/pg2011)

- **Red-first:** new cells run against UNFIXED dev code, fresh DB
  `snap2026_red`, `node migrate.js` exit 0, `SNAPSHOT2011_INTEGRATION_DB_URL`
  set: **3 failed / 2 passed / 5 total** —
  dry-run `referencesRemoved` expected 3, received 4 (J wrongly expired on
  the erasure leg); live-sweep `scanned` expected 11, received 10 (J's
  snapshot already NULL); third sweep: J's snapshot `null` instead of
  byte-identical. The M2 cell passed on unfixed code, as designed — it is
  coverage of the pre-existing fail-closed branch, not a bug fix.
- **Green:** fresh DB `snap2026_green`, `node migrate.js` exit 0, suite
  **5 passed / 5** (the 4 pre-existing tests, with J's shifts above, plus
  the new M2 test).
- **Neighbours (each on its own fresh migrated DB, migrate exit 0):**
  skeleton sweep — `erasure-skeleton-sweep-1973.integration.test.js`
  **6 passed / 6** (DB `snap2026_n1973`); gap-c —
  `gap-c-1972-panel-erasure.integration.test.js` **2 passed / 2**
  (DB `snap2026_gapc`); JT-D7 / Part A —
  `erasure-diarization-1915.integration.test.js` **1 passed / 1**
  (DB `snap2026_jtd7`).
- **Mutation sanity:** the red-first run IS the mutation check for this
  lane — removing the fix (the unfixed base) turns the suite red in
  exactly the J assertions (3 failed / 5), and restoring it returns 5/5.
- `node --check lib/erasureService.js` OK.
- Rig note: `/tmp` is 100% full on this VM; jest was run with `TMPDIR` and
  `--cacheDirectory` redirected into the goal's hidden run directory —
  without that, jest dies with ENOSPC in haste-map persist before any test
  runs (an infrastructure failure, not a test result).

## What this does NOT do

No migration. No scheduler change. No `RETENTION_PURGE_LIVE` flip. No
change to Part A / Part B counter semantics beyond the explained `scanned`
shifts from the new seeded cell. M3 untouched. Does not close #2026 —
Suga gates merge after independent review.
