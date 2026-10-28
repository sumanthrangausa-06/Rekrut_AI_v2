# S-D02 Build Log — Recordings handler stores timestamped segments, replace-on-re-run

- **Story:** #1904 [STORY] S-D02 · **Epic:** #1900 · **Wave:** 2
- **Design:** Rex, Architecture §3.1 (`03-solutioning/speaker-labelled-transcripts/architecture.md`) · **PRD:** FR-D01..D03
- **Dependency:** S-D01 (#1903, PR #1921) — the `requireSegments` segment contract in `transcribeAudio`
- **Persona:** Nova (implementation) · **Date:** 2026-10-28

## STOP 1 (posted on #1904 before build)

Comprehension, verified first-hand on origin/dev (tip included PR #1921/#1920 merges):

- `server/routes/recordings.js` `POST /:id/transcribe` claimed the recording (#1202 guard), downloaded/decrypted audio in memory, called `transcribeAudioWithWhisper` (`lib/polsia-ai.js`), inserted **one** `interview_transcripts` row (0 → duration) and never deleted prior rows — re-transcription appended.
- S-D01's contract (`lib/ai-provider.js` `_normalizeSegmentResult` + `transcribeAudio {requireSegments}`) returns `{text, confidence, duration, segments:[{start_s, end_s, text}]}` with the concatenation invariant enforced; segment-less legs continue the cascade; no segment-bearing leg → `null`.
- Gap: `lib/polsia-ai.js` did not forward `requireSegments` — the handler had no way to ask for segments.
- Schema: **no migration needed.** `interview_transcripts` already carries `start_time_ms`/`end_time_ms` (migration 128); S-D03 (migration 296) added `speaker_number`, `diarization_status`/`diarization_updated_at`, and the artefact tables (`diarization_jobs`, `diarization_runs`, `recording_speaker_mappings`, `transcript_speaker_audit`). `transcript_highlights.transcript_id` is `ON DELETE CASCADE`.

**Specialist decision (forced answer): YES** — database/transactions specialist pattern (ecc `database-reviewer`) applied to the AC-2 atomic replace (single-client transaction, delete order, scoped status flips, no migration). API specialist considered and skipped (response shape is pinned unchanged by AC-3; nothing new to design). Security/privacy considered and skipped (no new data flow, `speaker_identity` stays `'unknown'`, BR-4/BR-5 schema facts settled in S-D03; Lex's BR set remains the epic's standing specialist output). Position follows Rex's Phase 3 design, not a solo call (HL-004).

## Red first (Quinn journey test, HL-003 rig)

New suite `server/__tests__/routes/recordings-segments-realdb-1904.test.js`: real recordings router + real `lib/db` + real auth/RBAC + real livekit service + real ASR cascade over HTTP (supertest) against a fresh Postgres built by `node migrate.js`. Stubs only at the two external boundaries: object storage (a local HTTP stub serving synthetic audio bytes, reached via the real encrypted `storage_path` + real `downloadRecordingAudio`) and the ASR provider (`OPENAI_BASE_URL` → local stub returning real verbose_json multi-segment payloads; the real S-D01 contract runs end to end). Synthetic fixtures only.

**Red run (pristine handler), fresh DB:**
- ✕ AC-1 — handler stored ONE row `0 → 12000` with the full text instead of 3 timed segments (DB read-back confirmed)
- ✕ AC-3 highlight — only one segment existed to attach to
- ✕ AC-2 — generation 1 was a single appended row, no replace semantics
- ✓ AC-3 purged-absence and ✓ AC-4 honest failure — regression pins that already held

## Implementation (minimum diff, ponytail)

1. `lib/polsia-ai.js` — `transcribeAudioWithWhisper` forwards `requireSegments` when the caller passes it (all other callers unchanged, byte-for-byte).
2. `server/routes/recordings.js` — transcribe handler:
   - calls with `requireSegments: true`;
   - on success, in **one transaction** (single pooled client): deletes the recording's `diarization_runs`, `recording_speaker_mappings`, `transcript_speaker_audit`, `diarization_jobs`, then its `interview_transcripts` rows (highlights cascade), inserts one row per segment (`speaker_identity='unknown'`, ms = round(seconds × 1000), confidence via the existing #1619 `recordedConfidence` sanitiser), resets `diarization_status` to NULL, and flips the recording to `completed` — commit. Any failure rolls back: the old generation survives a failed swap, no partial segments;
   - a segment-less result (contract bypass) fails honestly like an ASR failure — never revives the whole-recording single row;
   - ASR failure path and the transcribe **response shape are unchanged**: `{success, transcript:{text, duration_ms, confidence}}`.
3. Mocked suites updated to the new contract (`recordings-transcribe-claim`, `recordings-whisper-confidence-1619`, `recordings-encryption`): their Whisper mocks now return segment-bearing results (the post-S-D01 shape); their own assertions (claim 409 guard, confidence honesty, .enc branch) are untouched.

Out of scope, per design: diarization enqueue (§3.1 step 3) is S-D04; read-time label composition is S-D09. Neither is built here.

## E2E gate evidence (fresh-install rig, local PG 127.0.0.1:55433)

Fresh DB → `node migrate.js` → "All migrations completed successfully" → journey suite:

| AC | Result | Evidence |
|----|--------|----------|
| AC-1 | ✅ PASS | POST transcribe 200; GET transcript returns 3 segments `[0,2000] [2000,6500] [6500,12000]`, ordered, bounded, jointly covering 0→12000 ms, `speaker_identity='unknown'`, segment texts joined = full transcript text |
| AC-2 | ✅ PASS | Gen-1 artefacts planted (job, run, mapping, audit, `diarization_status='complete'`); re-run with gen-2 fixture → DB holds exactly gen-2's 2 segments, 0 rows left in all 4 artefact tables, `diarization_status` NULL, recording `completed`; GET shows only new text |
| AC-3 | ✅ PASS | Highlight POST 201 on a segment, survives transcript reload; `[purged]` recording returns `segment_count: 0` (absence unchanged); transcribe response keys exactly `{success, transcript{text, duration_ms, confidence}}` |
| AC-4 | ✅ PASS | ASR stub 500 on all legs → POST 500, recording back to `completed`, 0 transcript rows, GET `segment_count: 0` |

Suite: **5 passed, 5 total** (`SD02_INTEGRATION_DB_URL=… npx jest server/__tests__/routes/recordings-segments-realdb-1904.test.js --forceExit`). Final DB read-back: gen-2's two segments only, `[purged]` tombstone untouched, artefact count 0.

Regression suites (all pass, 105 tests): recordings-transcribe-claim, recordings-whisper-confidence-1619, recordings-encryption, recordings-purged-sentinel, recordings-session, interviews-video-encryption, interviews-mock-end-fabricated-scores-1372, interview-sessions-completion-flow, interview-sessions-recording-gate, ai-provider-segment-contract-1903 (S-D01), diarizationJobs (S-D03), transcription-module.

Rig note: the local PG instance is PG 16 (the S-D03 rig on 55433); the full migration set including 296 completes cleanly on it. The shared Neon DB is untouched — migration 296 executes there only in promotion order after the Nov 1 unfreeze (S-D03 gate), and this story adds no migration.
