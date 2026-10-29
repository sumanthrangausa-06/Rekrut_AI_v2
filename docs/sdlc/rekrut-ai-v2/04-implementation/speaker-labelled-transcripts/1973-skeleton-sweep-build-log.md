# #1973 — Erasure cleanup sweep: K-12 skeleton-class events (build log)

Story: #1973 (follow-on of #1964 Lex panel decision; epic #1900).
STOP 1: issue comments 6499901121 + amendments 6499937562,
6499960851, 6499979485 — the binding predicate set is Amendment 3's
C-4. Route: **deferred retention sweep** (marker route rejected —
schema change, founder gate; not taken).

## What was built

- `sweepPanelSkeletonEvents({ queryable, limit })` in
  `lib/erasureService.js`, beside `sweepPendingStorageDeletions`
  (B-2). Pool-only, self-transactional per event (purge-pool
  precedent): a `{query}`-only queryable is refused with the typed
  `ERASURE_SKELETON_SWEEP_POOL_REQUIRED` error before any data is
  touched.
- Wired into the existing 24h retention tick in `server.js`, beside
  the storage-ledger sweep, with its own log line. **Not gated by
  `RETENTION_PURGE_LIVE`** (B-2): erasure completion runs live in
  both retention modes; only the retention purge is flag-gated.
  This is the recurring trigger A-4 requires — the tick fires every
  24h in-process.

## Behaviour (user-visible surface change)

Before: a GAP-C panel-kept skeleton event (#1972) lived forever —
its only keep basis was parenting other users'
`event_labelling_consent` rows, and no path ever revisited it after
those rows were erased.

After: once the last panel row is gone, the next retention tick
deletes the skeleton row — and only a row that re-proves the full
C-4 conjunction inside its own DELETE:

1. exact K-12 signature (the five GAP-C assignments) — required,
   never sufficient alone (A-1);
2. tombstone conjunction, exact form (B-3): `deleted_at` set +
   `name = 'Deleted User'` + synthetic email embedding the event's
   own `candidate_id`;
3. chronology (C-1): `event.created_at <= candidate deleted_at` —
   excludes the reachable false positive of a live event created
   for an already-tombstoned candidate;
4. no `interview_recordings` (any status);
5. no `event_labelling_consent` rows (any decision — absence is
   the only last-row-gone signal);
6. no `proposed_slots`, no `interview_rooms`, and no session link
   (`interview_session_id IS NULL`) — A-2: any dependent present
   EXCLUDES the event; nothing is cascade-disposed;
7. no active legal hold under any of the four C-2 attribution
   branches: (a) candidate user hold, (b) DERIVED company
   (`job_application_id → job_applications.company_id` — the
   operative branch), (c) candidate's `users.company_id`,
   (d) any company on the candidate's `interview_sessions`.

No predicate on status / scheduled_at / duration / timezone /
job_application_id / recruiter_id (C-4).

Concurrency (C-3): per event — SERIALIZABLE transaction,
`LOCK TABLE legal_holds IN SHARE MODE` (closes the hold-insert
race), `SELECT … FOR UPDATE` on the event row (serialises FK child
inserts), DELETE re-stating the full conjunction, audit row in the
same transaction. `rowCount = 0` ⇒ raced, counted skipped. One
retry on serialization failure (40001), then lookup-failed.

Hold release only **re-queues** (B-1/C-5): a released event becomes
eligible on a later run under full re-derivation; release never
deletes directly.

## Honesty labelling (C-5, privacy conditions)

- All counts are labelled **"skeleton-class"**
  (`{ label, scanned, deleted, heldSkipped, lookupFailedSkipped,
  skipped }`) — never "panel-kept": the sweep proves a posture, not
  per-row provenance.
- The sweep never claims panel consent evidence is gone:
  `diarization_jobs`/`diarization_runs` `panel_consent_snapshot`
  copies persist on their own retention clock and are reported
  separately. A swept skeleton is pseudonymous personal data,
  never described as anonymous.
- Every deletion writes an `audit_logs` row
  (`skeleton_event_swept`, event id + tombstone user id +
  skeleton-class label) in the deletion transaction; every run
  logs its counts, including zero-match runs.

## B-6 build note (hold attribution coverage)

The sweep does not call `findActiveHold`: that helper cannot
express branch (b) (derived company), which C-2 makes mandatory.
Its SQL partition therefore spells out all four branches directly.
Branch (d) is `findActiveHold`'s session-less any-session
attribution applied to the candidate, so event-linked sessions'
companies are covered by construction — the GAP-C-identical
posture, plus the derived-company branch GAP-C's own partition
derives the same way.

## B-5 false-positive check (flip condition)

Quinn's AC-3 seed includes tombstoned-candidate live-shaped
events — including one created AFTER the candidate's erasure
(C-1's reachable shape). Both survived the sweep on the rig; no
reachable false positive was demonstrated, so identification
stands and the story does NOT flip to the founder-gated marker
route.

## Evidence (Quinn E2E, HL-003)

Rig: rebuilt local PG 16.15 + pgvector at 127.0.0.1:55433
(documented pguser rig absent on this VM — HL-009 pattern; the
on-VM PGDG tree in `~/workspace/pg16` was used), fresh DB
`skel1973_e2e`, `node migrate.js` exit 0.

Red first: the integration suite failed 4/4 with
`sweepPanelSkeletonEvents` unimplemented. Green after the build:

- `erasure-skeleton-sweep-1973.integration.test.js` — **4/4**
  (journey: last panel row gone ⇒ skeleton deleted; one-of-two
  rows ⇒ persists; held persists under all four C-2 branches;
  post-erasure-created and live-candidate signature-matching
  events persist; recording/slot/room dependents persist whole;
  partial tombstones persist; idempotent second run; hold release
  re-queues and the next sweep deletes; AC-5 posture audit empty).
  Run counts reconcile: run 1 scanned=9, deleted=1, held=5,
  skipped=3 (dependents).
- `erasure-skeleton-sweep-1973.test.js` — **2/2** (pool contract).
- Regressions: #1972 GAP-C integration **2/2** on a fresh DB;
  mocked erasure family (gap-b…gap-i, sanitizer, pool-fallback,
  dead-letter, CSI, medium tables) **260/260**.
