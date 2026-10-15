# Hold-Partition Transaction-Poisoning Audit — Build Log (#1167)

**Story:** #1167 — per-row legal-hold consults abort the caller's transaction (25P02) at every catch-and-continue partition except GAP-H.
**Branch:** `story/1167-hold-partition-audit` → PR to `dev` (Sumanth's gate; this log is evidence, not a merge).
**Design source:** database reviewer's verdict table on #1167 (comment 6183603348, 2026-10-14) — production shape, real PG 16.15. Approved template: GAP-H's SAVEPOINT containment in `gapHPartition` (#1127).
**Persona:** Nova (Phase 4 implementation), reporting to Lead.

## Defect (proved, not theoretical)

Both production callers run `erasePersonalData` inside BEGIN…COMMIT on one
client. When a per-row hold consult hits a genuine PG error, the transaction
aborts (25P02); every partition whose catch counts the row and continues then
dies on its next statement → wholesale rollback, no counts, no disclosure.

## RED evidence (pre-fix, 2026-10-14, real PG 16.15 @ 127.0.0.1:55434, DB `rekrut1167`)

Instrument: reviewer's harness (`~/workspace/rekrut-1167-dryrun/harness.js`),
extended as `harness-v2.js` in the same directory (MODE=red|green) with three
added scenarios:

- `c2-walk-error` — C2 job-walk failure. Export wrappers cannot reach walk
  SELECTs; a `pool.connect` client.query wrap hung the harness's own pool
  (pg internals), so the walk's target table (`screening_questionnaires`,
  referenced ONLY by the walk inside erasureService — grep-verified) is
  renamed away for the production run and restored immediately after —
  the same technique as the reviewer's entry-gate rename control. The walk
  SELECT dies with a genuine server-side PG error (42P01) inside the
  caller's transaction.
- `gapa-rec` / `gapa-frames` — GAP-A recordings / frames loops (the
  reviewer's harness covered sessions only). Pre-fix injection via a
  faithful `isHeld` wrapper (PG error on the consult's own queryable,
  swallowed inside, returns true).

Failure injection for all other scenarios is the reviewer's: a genuine
server-side PG error (`SELECT 1/0`, 22012) issued on the SAME queryable the
consult received, via the patched `findActiveHold` / `isHeld` /
`anyHoldActive` exports. Runs use
`NODE_PATH=/home/hatch/workspace/rekrut-1126/node_modules` (npm ci broken on
dev, filed as #1193; no package files touched).

| Scenario | Site | Pre-fix outcome |
|---|---|---|
| gapd | 1 · gapDRowHeld (verified_credentials) | REJECTED 25P02, wholesale rollback, both rows preserved, user untombstoned |
| gapd-company | 1 · gapDRowHeld (company-keyed offers) | REJECTED 25P02, both offers preserved |
| gapb | 1 · via gapDRowHeld (score_snapshots) | REJECTED 25P02, both rows preserved |
| gapc | 1 · via gapDRowHeld (scheduled_interviews) | REJECTED 25P02, both rows preserved |
| gap780 | 2 · #780 job_applications inline loop | REJECTED 25P02, both cover letters intact |
| c2-walk | 3 · c2Partition consult | REJECTED 25P02, response + application preserved |
| c2-walk-error | 3 · c2Partition job-walk | REJECTED 25P02 (walk catch counted the row, next statement died), response + application preserved |
| gapa-isheld | 4 · GAP-A sessions via isHeld | REJECTED 25P02, both sessions preserved unstripped |
| gapa-rec | 4 · GAP-A recordings via isHeld | REJECTED 25P02, both recordings preserved, session unstripped |
| gapa-frames | 4 · GAP-A frames via isHeld | REJECTED 25P02, both frames preserved unstamped |
| gape | 5 · gapEPartition | REJECTED 25P02, both candidate_invites preserved |
| gapf | 6 · gapFPartition | REJECTED 25P02, both user_notifications preserved |
| gapf-h1 | 6 · gapFPartition H1 anyHoldActive (self-catching) | REJECTED 25P02, both email_queue rows preserved |
| gapg | 7 · gapGPartition | REJECTED 25P02, both refresh_tokens preserved |
| baseline | control (no failure) | COMPLETED; 8 findActiveHold consults; gapD.verified=2, gapH redacted 2+1, gapE.demo=1, gapG.refresh=1 |
| gaph-current | control (GAP-H, #1127) | COMPLETED; consentRecordsRedacted=1, consentRecordsLookupFailed=1, failed record preserved |
| rename | control (entry gate) | REJECTED LEGAL_HOLD (not 25P02); completes after restore |
| poison | control | REJECTED LEGAL_HOLD; completes after hold row deleted |
| drain | control (GAP-I, post-commit pool) | COMPLETED, heldSkips=2 |
| gapi-purge | control (GAP-I purge) | 1 assertion failed on re-run ONLY: the sweep is global, and the reviewer's retained ledger row for their user A (lookup_failed in their run) was purged by this re-run (their wrapper no longer armed for that user), so `ledgerRowsPurged=2` vs the check's 1. Per-user isolation itself held (new A lookup_failed, new B purged). Seed-isolation artifact on a dirty DB, not a code result; GAP-I is not a fix site. |

Logs: `~/workspace/rekrut-1167-dryrun/red/run-*.log`.

## Unit-suite baseline (pre-fix)

Erasure set (17 suites, `server/__tests__/lib/*erasure*.test.js` +
`gap-*.test.js`, jest from the rekrut-1126 NODE_PATH): **2 failed, 177
passed** — both failures in `observer-audio-erasure.test.js` ("T8: registry
+ chunk keys…" and "erasure with no observer artefacts…"), the known
pre-existing #1117 observer-audio drift. Log:
`~/workspace/rekrut-1167-dryrun/unit-baseline.log`.

## Fix

_(filled in after implementation — see the fix commit)_
