# S-D07 Build Log — Stitching: segments × turns (#1909)

**Design:** Architecture §3.6 (`03-solutioning/speaker-labelled-transcripts/architecture.md`) · PRD FR-D05/D06/D15/D16/D03
**Module:** `lib/transcriptStitch.js` · **Wiring:** `workers/diarization/index.js`

## What was built

- `assignSpeakers(segments, turns)` — pure max-overlap assignment: interval
  intersection on ms (§3.6.1). Ties and no-overlap → `speaker_number = NULL`.
- `coverageEndMs(turns)` — the run's coverage boundary (FR-D15).
- `persistStitch({jobId, recordingId, expectedSegmentIds, output})` — the
  atomic write (§3.6.4–6), guard-first on ONE `pool.connect()` client:
  job row `FOR UPDATE` (must be `processing`, this recording, still the
  newest job), recording row `FOR UPDATE`, no prior run for the job,
  current segment **id set** equal to the set the worker captured before
  the engine ran. Then, in the same transaction: `diarization_runs`
  insert (turns + engine versions **verbatim**, before any segment
  write, never mutated afterwards), segment `speaker_number` updates,
  `diarization_status='complete'`, job completion (guarded, rowCount=1).
- The worker's S-D05 non-atomic path (separate run insert + separate
  `diarizationJobs.complete()`) is **replaced**, not layered — the run
  insert exists only inside the stitch transaction (DB review, #1909).

## Behaviour decisions recorded

- **Superseded representation:** migration 296's job-status CHECK has no
  literal `superseded`; a guard-discarded job is marked
  `status='cancelled'` + `cancel_reason='superseded_by_retranscription'`
  (the §3.3 vocabulary), after rollback, via the guarded queue helper.
- **#1929 M4 (abrupt-end phantom):** turns shorter than
  `MIN_ASSIGNABLE_TURN_MS` (100 ms) are retained verbatim in the run row
  but can never label a segment — an honest NULL beats a phantom label.
  The 0.06 s phantom from the S-D06 fixtures is the motivating case.
- **#1929 m5 (uncovered tail):** segments past `coverage_end_ms` keep
  NULL; nothing is extrapolated or carried over (FR-D15).
- **Mapping proposal is S-D08:** `diarization_runs.proposed_mapping`
  stays NULL and no `recording_speaker_mappings` rows are written here.
- **Corrupt output fails honestly:** a non-integer speaker in engine
  output throws inside the transaction (rolling back the run insert
  too) instead of being rounded into an invented label by the INTEGER
  column. A stitch failure (incl. Postgres 40P01 vs a racing
  re-transcription) fails the job with the retryable `engine_failed`
  class — never a deterministic class, never a partial write.
- **Presentation-only (BR-12):** this module imports nothing from and
  is imported by nothing in scoring/matching/screening code (S-D14's
  dependency test will machine-check the fence).

## Specialist reviews (STOP 1, on #1909)

- Privacy engineer — APPROVE, no BLOCK/MAJOR (verbatim stripped turn
  shape; no embeddings/voice-print storage; NULL patterns signal no
  consent posture; no accuracy/confidence/share fields).
- Database/transactions (ecc/database-reviewer lens) — CONDITIONAL
  PASS; both BLOCK traps designed out (single-client transaction,
  no `diarizationJobs.*` calls inside it; superseded representation
  above) and MAJORs incorporated (id-set generation fingerprint,
  lock order job→recording, idempotency `NOT EXISTS` backstop,
  40P01 retryable). Follow-up proposed, NOT in this story: a
  `UNIQUE(job_id)` index on `diarization_runs` as a separate
  expand-only migration, and re-transcription taking the recording
  row lock first (touches S-D02 code).

## Evidence

- Red-first: both new suites failed on pristine dev (module absent) —
  unit suite load failure; integration 6/6 fail.
- Unit: `transcriptStitch.test.js` 9/9; worker/jobs/gate/flag suites
  green (63/63 across the five diarization unit suites).
- Real-DB (HL-003): `transcriptStitch.integration.test.js` 6/6 on a
  fresh-migrated Postgres (AC-1 verbatim run + atomic flip, AC-2
  partial coverage, AC-3 single voice, AC-4 stale-generation discard,
  AC-5 fault-at-last-write rollback to `processing`/unlabelled,
  idempotency). Existing worker integration suite 5/5 unchanged.
- Rig note (HL-009): the pre-existing local rig died mid-run; this
  gate ran on an ad-hoc rebuild under `~/workspace/sd07-pgrig/`
  (PG 16.15, port 55433, fresh `sd07_e2e` via `node migrate.js`).
