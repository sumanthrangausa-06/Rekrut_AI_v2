# S-D19 follow-up — panel_consent_snapshot retention-clock sweep: design (#2011 Part B)

Rex (Solutioning), advance run 2026-10-31. Design-first per the restored
documentation rule: this document precedes any build lane. Part A (the
erasure-result disclosure count, `panelConsentSnapshotsRetained`) merged
2026-10-30 as PR #2023. This design covers Part B only: expiring the
retained copies so a copy never outlives its source consent record
(Lex R-1 from the #1944 panel).

## 1. Verified current state (Scout facts, first-hand on dev 4dc8afd47)

- The snapshot is a `panel_consent_snapshot` JSONB column on
  `diarization_jobs` and `diarization_runs` (migration 299). It carries
  user id + decision + timestamps — no IP/UA.
- A subject's OWN copies die with their own jobs/runs in the S-D13
  erasure deletes. Copies on OTHER subjects' rows are retained under
  the S-D19 consent-tombstone exception (BR-7 design §10) and are only
  counted at erasure time (Part A, `lib/erasureService.js` ~L1100).
- `diarization_jobs.recording_id` / `diarization_runs.recording_id`
  reference `interview_recordings(id) ON DELETE CASCADE`
  (migration 296) — a hard-deleted recording takes its snapshots with
  it. But the two paths that actually end recordings today do NOT
  hard-delete: `purgeExpiredRecordings` soft-deletes + deletes storage
  objects (services/euComplianceService.js ~L627), and erasure GAP-A
  keep-redacts the recording into a tombstone. On both paths the host
  rows — and the snapshots — survive indefinitely. That is the orphan
  path #2011 names.
- `event_labelling_consent.interview_event_id` is
  `REFERENCES interview_events(id) ON DELETE RESTRICT` (migration 299):
  source rows are removed by the panel user's own erasure
  (`DELETE FROM event_labelling_consent WHERE user_id = $1`,
  erasureService ~L1092) or not at all while the event exists.
- BR-7 §10 retention position: snapshots "live and die with
  diarization_jobs / diarization_runs"; panel rows live as long as
  their event/recording. The design below makes the code match that
  position on the soft-delete/tombstone paths where it currently
  does not.

## 2. Scheduler check (the Rex check #2011 requires)

No new scheduler. `server.js` already runs a 24-hour retention
interval (`startRecordingRetention`, ~L1050) calling the
euComplianceService purges plus, ungated, two erasure-completion
sweeps from `lib/erasureService.js`: `sweepPendingStorageDeletions` /
`purgeDrainedStorageDeletions` (#1172) and `sweepPanelSkeletonEvents`
(#1973). The skeleton sweep's own header comment already defers this
exact work: "panel_consent_snapshot copies in diarization_jobs/runs
persist on their own clock and are NOT claimed deleted by this
sweep." Part B is the sibling sweep that comment anticipates, wired
into the same interval, with its own `[erasure]`-style log line so
operators never mistake its counters for the retention mode line
(the #1176 O-4 labelling precedent).

## 3. The clock (definition)

A snapshot reference to panel user U (via `expected_user_ids` or any
`decisions[].user_id` — Part A's enumeration, reused verbatim) is
EXPIRED when both hold:

1. U's source `event_labelling_consent` row for that snapshot's event
   is gone (erased, or the event itself is gone), AND
2. the host recording has reached its own end: its
   `retention_expires_at` is in the past, OR it is an erasure
   tombstone (keep-redacted), OR it no longer exists.

Deliberately NOT a new duration: the absolute consent-record
retention period is an open counsel item (Gate-A C-06) and this
design invents none. Expiry is tied to clocks that already exist —
the source row's life and the host recording's retention end. If
counsel later sets a hard cap, it is one added predicate, not a
redesign.

## 4. Sweep shape

`sweepPanelConsentSnapshots()` in `lib/erasureService.js`, sibling to
`sweepPanelSkeletonEvents` (same fail-closed legal-hold lookup, same
counter discipline, held rows counted as `heldSkipped`, never
silently retained):

- Enumerate jobs/runs rows with a non-NULL snapshot (Part A predicate).
- For each expired reference: remove U from `expected_user_ids`
  (`array_remove`, the #2014 signature) and null U's entries in
  `decisions` (the #2014 JSON-surgery shape — entries become JSON
  null, keys are never deleted). Snapshot copies are per-user
  references inside a shared JSONB; one user's expiry never touches
  another user's still-live reference in the same snapshot.
- When a snapshot no longer references any user, set
  `panel_consent_snapshot = NULL` (the row itself survives — it is
  the host subject's job/run record).
- Return `{ scanned, snapshotsExpired, referencesRemoved, heldSkipped,
  lookupFailedSkipped }`; log on its own line from server.js.

## 5. Gating (two legs, kept distinct like #1172/#1973)

- Erasure-completion leg (source row deleted by a panel user's own
  erasure, host already at its end): erasure completion, NOT a
  retention schedule — runs ungated in both retention modes, per the
  #1172/#1973 precedent and for the same reason: gating it behind
  RETENTION_PURGE_LIVE would retain an erased user's consent evidence
  indefinitely past every clock that was supposed to end it.
- Retention-expiry leg (host reaches `retention_expires_at` with the
  source row already gone): this IS a retention schedule — it runs
  under the interval's existing `opts.dryRun` discipline and only
  deletes live when RETENTION_PURGE_LIVE is armed, a flip that
  remains Sumanth's gate and is NOT part of this design's build.

One function, a `mode` parameter per leg, two counters — the split is
in the gating, not duplicated code (ponytail).

## 6. Proof plan (HL-003, when the build is slotted)

Fresh-DB integration (JT-D7 family): seed a panel user + host
recordings in three states (live, retention-expired, tombstone) ×
source row (present, deleted). Sweep; read back snapshot contents and
counters per combination. Expected: only expired references removed;
live-source references byte-identical; emptied snapshots NULL; held
subject untouched and counted. Mutations: drop the source-existence
predicate → a live copy is swept early (red); drop the host-end
predicate → a copy on a live recording is swept (red). Neighbours:
Part A count suite, JT-D7, gap-c, skeleton sweep suite.

## 7. Specialist decision (for the build lane's STOP 1)

YES — privacy engineer + Lex lens (consent-evidence semantics: what
may expire, what must be disclosed) and the database lens (JSONB
surgery predicates reuse the #2014-verified forms). Recorded here so
the build lane's STOP 1 starts from this position, dissent included:
privacy's #2014 terminal-only dissent is preserved on #2014 and
applies to the sweep-all shape generally; Lex's position carried
there and its R-1 is the requirement here.

## 8. What this design does NOT do

No migration (no schema change). No scheduler. No
RETENTION_PURGE_LIVE flip. No change to Part A's count semantics.
Does not block S-D17 (#1919) or launch; must land before the snapshot
retention posture is relied on past its first clock expiry, per
#2011.
