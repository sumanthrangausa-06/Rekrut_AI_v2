# #1931 — diarization_runs UNIQUE(job_id) + re-transcription lock-first (build log)

Story: #1931 [FOLLOW-UP] Diarization stitch hardening (from PR #1930).
Items 1 + 2 built; item 3 verification-only (answered by Rex 2026-10-28).
Persona: Nova (Implementation). Base: dev `910c076fb`.
Branch: `nova/1931-runs-unique-lockfirst`. PR to dev only; no merge by
Nova — Suga gates. DIARIZATION_ENABLED stays OFF. No promotion:
migration 301 executes only in promotion order post-Nov-1.

STOP 1: https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/1931#issuecomment-6524456904
(posted before any code).

## Current state / root cause (first-hand, at base)

Item 1 — migration `296_diarization_schema.js` defines
`diarization_runs.job_id INTEGER REFERENCES diarization_jobs(id)`:
plain nullable FK, no uniqueness; the only index on the table is
`idx_diarization_runs_recording (recording_id)`. No migration 297–300
adds one. The sole guard is application-level: `persistStitch`
(`lib/transcriptStitch.js`) runs job-row FOR UPDATE → recording-row
FOR UPDATE → `SELECT 1 FROM diarization_runs WHERE job_id = $1`
existence check → INSERT, in one transaction. A writer bypassing
`persistStitch` can duplicate a run for a job.

Item 2 — there is no `claimSessionForTranscription` symbol in dev
(zero grep hits). The re-transcription path is the inline
`POST /:id/transcribe` handler in `server/routes/recordings.js`. Its
claim is an autocommit scoped UPDATE (`status='processing'` WHERE
`status='completed'`). Its segment-swap transaction was
BEGIN → DELETE runs/mappings/audit/jobs/transcripts → INSERT segments
→ scoped UPDATE recording → COMMIT, taking **no row lock at all** —
while `persistStitch` holds job + recording locks. The two could
interleave around the generation guard (PR #1930 review MINOR-3).

Item 3 — VERIFIED, no change. `grep coverage_end_ms
server/routes/recordings.js` returns exactly one hit, a comment in the
GET `/:id/transcript` handler: "coverage_end_ms is run provenance and
is not read here." The handler queries only `interview_transcripts`
and `recording_speaker_mappings` (never `diarization_runs`), and
derives coverage per segment: `diarization_covered =
(speaker_number IS NOT NULL)`. Exactly Rex's 2026-10-28 ruling.
Neighbour proof: the S-D09 composition suite's C5 cases (phantom
sub-100 ms tail; interior gap) pass on this branch (14/14, below).

## Specialist decision + findings (STOP 1, mandatory)

YES — specialist REQUIRED: ecc **database-reviewer** (PostgreSQL
schema/migration/concurrency), consulted as a dedicated specialist
subagent applying the ecc agent perspective (plus the agency
database-optimizer file). Skipped: privacy (no PII/consent/retention
surface changes; flag stays off), ecc security-reviewer (no auth
surface; existing gates untouched), agency database-optimizer as a
separate consult (overlaps the reviewer's brief for a one-column
index). Findings:

(a) Migration shape — CONFIRMED as built: standalone `CREATE UNIQUE
INDEX` (not ADD CONSTRAINT: a constraint cannot be created with
IF NOT EXISTS, and a pre-check-then-add races; the index is
enforcement-equivalent). Postgres UNIQUE treats NULLs as distinct →
at most one run per non-null job, unlimited NULL-job rows: exactly
the desired semantics. Pre-existing duplicates on a live DB make the
index build fail loud — correct; never auto-dedupe retained audit
output. Post-state assertion belongs on `pg_indexes`/`pg_index`
(indisunique) — as built. Keep the migration a single index creation;
do not fold the lock fix into it (as built — separate file/concern).

(b) Lock ordering — TWO findings that changed the build:
  1. Taking **only** the recording-row lock first in the swap creates
     a genuine deadlock cycle: swap holds recording → its
     `DELETE FROM diarization_jobs` awaits a job row a stitch holds;
     stitch holds job → awaits recording. Postgres detects it (~1 s)
     and aborts one side. Acceptable as a backstop, wrong as a design.
  2. The specialist's preferred global reorder (recording → jobs →
     runs → transcripts in BOTH paths, stitch included) plus merging
     the claim into the swap transaction exceeds this lane's scope:
     it rewrites S-D07's stitch lock order and the claim's 409
     semantics, and a claim-to-swap single transaction would hold
     locks across the audio download + ASR calls (against the
     reviewer's own short-transaction principle).
  ADOPTED for this lane (minimum diff, no new deadlock): the swap
  acquires locks in **stitch's existing order** — (1)
  `SELECT id FROM diarization_jobs WHERE recording_id=$1 ORDER BY id
  FOR UPDATE`, then (2) `SELECT id FROM interview_recordings WHERE
  id=$1 FOR UPDATE` — both before any DELETE. Invariant: with both
  paths acquiring jobs → recording, neither can hold one of these
  locks while awaiting the other (whoever holds the recording lock
  already holds the job locks; whoever awaits a job lock holds
  neither). Serialisation outcomes: stitch first → swap blocks on
  the job lock holding nothing, then deletes the completed stitch's
  artefacts with the old generation; swap first → stitch blocks on
  its job lock holding nothing, its job row is deleted by the swap,
  and its guard fails as superseded after the swap commits.
  Residual (recorded, not built): the claim flip still precedes the
  swap by the download/ASR window; a stitch completing inside that
  window labels the OLD generation, which the swap then replaces
  wholesale — a consistent final state (new generation wins), not an
  interleave. Closing even that window is the specialist's larger
  restructure, for Lead to slot if wanted.

## Changes

1. `migrations/301_diarization_runs_unique_job.js` (new) —
   `CREATE UNIQUE INDEX IF NOT EXISTS ux_diarization_runs_job_id
   ON diarization_runs(job_id)` + pg_indexes post-state assertion
   (unique, exactly `(job_id)`); down() no-op per shared-DB rule.
   Expand-only; no rows touched.
2. `server/routes/recordings.js` — +24 lines in the transcribe swap
   transaction: the two lock SELECTs with the reasoning in a comment.
   Nothing else in the handler changed.
3. Tests (new): `server/__tests__/routes/recordings-1931-lockfirst.integration.test.js`,
   `server/__tests__/migrations/301_diarization_runs_unique_job.test.js`.
4. This build log.

## Red / green evidence

Rig: no instance was listening on 127.0.0.1:55433 (HL-009 — rig
absent after VM restart); rebuilt from the extracted PGDG tree at
`~/workspace/pg16` (PostgreSQL 16.15 + pgvector 0.8.6) on
127.0.0.1:55433, user `pgrunner`. Caveat: PG16, not the PG18 of
TOOLS.md — migration 301 and the lock change use no version-specific
behaviour, and every suite below ran on this same rig for red and
green. Fresh DB `sd1931_e2e` built by `node migrate.js` per phase.

RED (base code, DB migrated through 300 only) — 3 failed, 1 passed:
- structural: no `FOR UPDATE` on interview_recordings in the swap
  transaction (lockIdx = −1).
- item 1: second INSERT with the same job_id **resolved** instead of
  rejecting — the hole, proven against the real schema.
- item 2 (behavioural, real route): while a stitch-shaped holder owned
  the recording row, the swap had already deleted the old segments —
  the third-connection `FOR UPDATE NOWAIT` probe failed with
  "could not obtain lock on row in relation interview_transcripts".
- item 1 NULL/different-job guard passed (semantics that must survive).

GREEN (branch, fresh DB migrated through 301, exit 0; index read back
from pg_indexes as `CREATE UNIQUE INDEX ux_diarization_runs_job_id …
btree (job_id)`):
- #1931 suite: **4 passed, 0 failed** — duplicate insert now rejects
  with SQLSTATE 23505 and exactly one run remains; NULL semantics
  intact; the swap now parks on the locks (probe locks the old
  segments cleanly, old generation still visible) and completes with
  the new generation after the holder releases.
- Migration 301 mocked-client suite: 4 passed (incl. fail-loud
  post-state). `up()` run twice directly against the DB: idempotent.
- Neighbours on the same fresh DB: transcriptStitch integration
  9/9 (persistStitch unaffected by the UNIQUE index), transcriptStitch
  unit + migrations 296/300 suites pass (29 passed, 3 skipped across
  the combined run), recordings segments real-DB (#1904) 15/15,
  transcript composition (#1911) 14/14.

## Quinn E2E gate (HL-003)

Fresh-install, real HTTP, real DB, state read back — the item-2 test
drives the real recordings router via supertest with stubs only at
the object-storage and ASR boundaries (the #1904 pattern); item-1
tests write and read back real rows. Requests/statuses: transcribe
returns 200 after lock release; final segment state read back from
`interview_transcripts` equals the new generation exactly, with no
old-generation ids surviving. Evidence: suite outputs quoted above;
DB `sd1931_e2e` on the rig.

## Review

Independent reviewer: PENDING at log write — verdict and findings are
recorded on the PR; any BLOCK is fixed before this lane reports done.
