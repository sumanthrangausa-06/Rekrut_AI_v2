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

## Fix (commit 5787423a — `lib/erasureService.js` only, +107/−31)

One shared helper, `containedConsult(fn)` closing over `queryable`, placed
at the top of `erasePersonalData` (the entry gate deliberately does NOT use
it — its throw is the design). It mirrors the GAP-H dance with one
documented extension:

- `SAVEPOINT gap_hold_consult`; on error code **25P01** (autocommit — no
  surrounding transaction, poisoning impossible) run `fn()` bare and return
  its result; on any other SAVEPOINT error, rethrow.
- With the savepoint set: run `fn()`; then — whether it returned or threw —
  `ROLLBACK TO SAVEPOINT gap_hold_consult` + `RELEASE SAVEPOINT
  gap_hold_consult`; rethrow after de-poisoning if it threw, else return
  its value. The rollback-to is **unconditional** (GAP-H releases without
  rollback on success only because its consult throws reliably; GAP-A's
  and GAP-F H1's consults self-catch, so a swallowed PG error leaves the
  transaction aborted with no throw to trigger cleanup). All contained
  consults/walks are read-only SELECTs, so rollback-to undoes nothing
  legitimate. If ROLLBACK TO / RELEASE themselves throw (genuinely dead
  transaction), the error propagates — fail-closed.

Applied at exactly the BROKEN sites, nothing else:

| Site | Change |
|---|---|
| 1 · `gapDRowHeld` | `findActiveHold` wrapped in `containedConsult`. Repairs GAP-D + GAP-B + GAP-C (all families, `gapDDeleteFamily` variants, and the direct calls for signature documents/parties route through it). |
| 2 · #780 `job_applications` loop | Consult wrapped; the existing catch still counts the row (`rowHeld=true` on error). |
| 3 · `c2Partition` | Job-walk wrapped (its catch still notes `job_walk_error`) AND consult wrapped (its catch still notes `held_company`). |
| 4 · GAP-A sessions/recordings/frames | `isHeld` replaced by `gapAContainedHeld(subject)`: contained `findActiveHold({userId, sessionId}, queryable)`, held := (hold != null), contained throw ⇒ held. Subjects mirror exactly what `isHeld` received (sessions: session row id; recordings: `interview_session_id`; frames: `interview_id`). No lookup-failed bucket invented — GAP-A's error≡held contract unchanged. |
| 5 · `gapEPartition` | Consult wrapped; throw ⇒ existing failedRows (lookup-failed) path. |
| 6 · `gapFPartition` + H1 | Consult wrapped AND `gapFGetAnyHold()` wrapped (containment de-poisons even though `anyHoldActive` self-catches and never throws; its error⇒true return still governs). Throw ⇒ existing failedRows path. |
| 7 · `gapGPartition` | Consult wrapped; throw ⇒ existing failedRows path. |

`gapHPartition` untouched (the proven control). `lib/legalHold.js`
untouched. No counting changes: variable names, buckets, note-helpers,
result fields, and log-line meanings are identical.

## GREEN evidence (post-fix, same harness, MODE=green)

Every previously-BROKEN scenario now COMPLETES with the family's designed
counts and the tombstone committed (user stripped to "Deleted User");
logs in `~/workspace/rekrut-1167-dryrun/green/run-*.log`:

| Scenario | Post-fix counts |
|---|---|
| gapd | gapD.verifiedCredentials=1, rowsHeld=1 (heldTables=[verified_credentials]); 1 row preserved in DB |
| gapd-company | gapD.offersRedacted=0, rowsHeld=2 (both offers share the failing company — both held, both preserved) |
| gapb | gapB.scoreSnapshots=1, rowsHeld=1; 1 row preserved |
| gapc | gapC.scheduledInterviews=1, rowsHeld=1; 1 row preserved |
| gap780 | jobApplicationRowsHeld=1; 1 application redacted (cover NULL), failed one intact |
| c2-walk | applicationKeyedRowsHeld=1, details reason `held_company`; response preserved, parent application redacted |
| c2-walk-error | applicationKeyedRowsHeld=1, details reason `job_walk_error`; response preserved, parent application redacted |
| gapa-isheld | sessionsHeld=1, sessionsStripped=1; failed session unstripped, other stripped |
| gapa-rec | recordingsHeld=1, recordingsRedacted=1; failed recording preserved, other status='deleted' |
| gapa-frames | framesHeld=1, framesLedgered=1; failed frame unstamped, other stamped deleted_at |
| gape | candidateInvites deleted=1, holdLookupFailed=1 (rowsHeld=0 — lookup-failed is its own bucket), 1 row preserved |
| gapf | userNotifications deleted=1, holdLookupFailed=1, 1 row preserved |
| gapf-h1 | gapF.emailQueue=0, rowsHeld=2 (heldTables=[email_queue]) — H1's error⇒true governed after de-poisoning; both queue rows preserved, run completed |
| gapg | refresh_tokens: 1 erased, holdLookupFailed=1, 1 token preserved |
| gapd-autocommit (posture) | Pool caller (no BEGIN): SAVEPOINT probe 25P01 → bare consult; verifiedCredentials=1, rowsHeld=1, failed row preserved |
| baseline (control) | COMPLETED — result object **byte-identical** to the pre-fix baseline run |
| gaph-current (control) | COMPLETED, consentRecordsRedacted=1, consentRecordsLookupFailed=1 — result byte-identical to pre-fix run; GAP-H code untouched |
| rename / poison / drain (controls) | Unchanged: LEGAL_HOLD gate refusal / LEGAL_HOLD on poison row / drain heldSkips=2 |

## Unit suites (post-fix)

Same 17-suite erasure set: **2 failed, 177 passed — suite-by-suite and
test-by-test identical to the pre-fix baseline** (the same 2
observer-audio failures from #1117 drift; no new failures). No mock
teaching was needed: the suites' query mocks already accept-and-ignore
SAVEPOINT / ROLLBACK TO / RELEASE statements (GAP-H trained them in
#1127), so there is no test-only commit in this story. Log:
`~/workspace/rekrut-1167-dryrun/unit-after.log`.

## Notes / deviations

- C2 walk-error injection uses a table rename (restored immediately)
  rather than a client.query wrapper — the wrapper hung the harness's
  own pg pool. Same genuine-server-error poison class; the rename
  technique is the reviewer's own entry-gate control method. The task
  brief's wrapper suggestion is noted as attempted-and-replaced.
- `gapi-purge` control re-run artifact: see RED table note (dirty-DB
  seed isolation; GAP-I untouched and not a fix site).
- `npm ci` remains broken on dev (#1193); all runs used the NODE_PATH
  workaround. No package files or lockfile were modified.
