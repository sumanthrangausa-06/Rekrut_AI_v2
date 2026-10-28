# S-D03 Build Log — Schema expansion + diarization job queue (#1905)

**Story:** S-D03 under epic #1900 · **Design:** Architecture §4, §3.3, ADR-D02/D03 · **Builder:** Nova

## What was built

- `migrations/296_diarization_schema.js` (296 = next after 295, verified on dev) — expand-only:
  `interview_transcripts.speaker_number`, `interview_recordings.diarization_status`
  (+ CHECK over pending/processing/complete/failed/unavailable) and
  `diarization_updated_at`, and the five §4.2 tables (`diarization_jobs`,
  `diarization_runs`, `recording_speaker_mappings`, `transcript_speaker_audit`,
  `diarization_metrics_daily`). No voice-template-shaped column anywhere (Lex BR-4/BR-5).
- `lib/diarizationJobs.js` — observer-jobs sibling queue: enqueue with
  supersede-pending, claim via FOR UPDATE SKIP LOCKED (pending, or failed with
  attempt_count < 3), heartbeat, stale-claim sweep, guarded
  markProcessing/complete, cancel-with-reason, fail with error class
  (deterministic classes exhaust the attempt budget).
- Tests: `server/__tests__/lib/diarizationJobs.test.js` (observer-suite shapes),
  `server/__tests__/migrations/296_diarization_schema.test.js` (static contract +
  real-DB suite gated behind `MIG296_INTEGRATION_DB_URL`).

## Evidence (local rig only — see execution gate below)

Local rig: PostgreSQL 16.15 + pgvector 0.8.7 on 127.0.0.1:55433, built from the
on-VM PG16 tree (HL-009 context: the documented pguser rig and the embedded-PG
rig were both absent/broken this run; the first rebuilt rig's data dir later
suffered a WAL-redo failure and every proof below was re-run on the rebuilt rig).

- RED (pristine dev 403ba4f91): fresh `node migrate.js` exit 0 but diarization
  tables = 0 and new columns = 0; `lib/diarizationJobs.js` absent.
- GREEN fresh-DB: empty DB → `node migrate.js` exit 0, migration 296 recorded in
  `_migrations`; read-back shows all 3 columns (nullable), all 5 tables, the
  CHECK, and the claim/heartbeat/speaker indexes.
- AC-4: legacy fixture (1 recording, 2 transcript segments) seeded on a
  pristine-migrated DB; after applying 296 via migrate.js, row counts and the
  legacy transcript read are byte-identical; new columns read NULL.
- Unit suites: diarizationJobs + observerJobs (regression) + 296 static
  contract — 45 passed. Real-DB 296 suite — 10 passed.
- Schema-drift check (`scripts/check-schema-drift.js`): finding set identical
  to the pristine-dev baseline (147 pre-existing findings, exit 1 on baseline
  too); the only diff is the header count (+5 tables, +12 columns — exactly
  this migration). Zero new drift findings.

## Execution gate (§4.4)

Migration 296 executed ONLY on the local rig in this story. It has NOT been
run against Neon/staging/production. Live execution happens after the Nov 1
Neon unfreeze, in dev → staging → main promotion order, sequenced by Lead.

## Judgment calls flagged for reviewers

- `recording_speaker_mappings.participant_user_id` / `updated_by` and the
  audit table's `from_user_id` / `to_user_id`: `ON DELETE SET NULL`;
  `transcript_speaker_audit.actor_user_id`: `ON DELETE CASCADE` — §4.2 does
  not specify delete actions for user FKs; chosen so a user's erasure
  (BR-13) is never blocked by a diarization row.
- `diarization_runs.job_id`: plain FK (no delete action specified in §4.2);
  both job and run rows die with their recording via CASCADE.
