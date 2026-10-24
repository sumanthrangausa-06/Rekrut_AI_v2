# Whisper transcript confidence honesty — #1619 build log

**Issue:** #1619 — `server/routes/recordings.js` stamps fabricated Whisper confidence 0.85 when unrecorded (2 sites). Sibling class of #1584/#1613, found by the independent reviewer of PR #1618.

## Root cause (STOP 1, verified first-hand on dev f77dba9)

- Handler `POST /api/interviews/recordings/:id/transcribe` used `whisperResult.confidence || 0.85` at the `interview_transcripts` INSERT (L700) and in the response body (L715). `||` invents 0.85 when no confidence was recorded AND destroys a genuinely measured 0.
- Unrecorded is the common case: `transcribeAudioWithWhisper` delegates to `aiProvider.transcribeAudio`; Whisper/Groq verbose_json results carry no top-level `confidence`, and Deepgram returns it as `_confidence`. So essentially every transcript was stamped 0.85.
- Column is nullable: `interview_transcripts.confidence DECIMAL(4,3) CHECK (confidence >= 0 AND confidence <= 1)`, no NOT NULL (migrations 128/129). No migration needed. Sibling writer `routes/interview-sessions.js` already inserts literal NULL.

## Fix (ponytail: minimum surgical diff)

- `server/routes/recordings.js`: both sites now pass through a local `recordedConfidence()` sanitizer. First shape was the #1613-proven `?? null`; the independent reviewer BLOCKED it (PR #1623, round 1) with in-repo evidence: `whisperResult` is built by several provider writers the route does not control, and some stamp `confidence: 0` as their "not reported" default (Cartesia `lib/ai-provider.js`, NIM in `lib/qp-ai.js`, the Deepgram path's `alternative?.confidence || 0`), while others (Groq/OpenAI/self-hosted) return no confidence at all. So for THIS field, 0 is provider garbage, not a measurement — storing it would mint a fake measured 0.000, and out-of-range values (1.7, NaN) would violate the column CHECK / poison the insert. Final shape: only a finite number in (0, 1] is recorded; missing/0/negative/>1/NaN → null. Recorded values in range pass through unchanged.
- `client/src/pages/recruiter/recording-playback.tsx`: `TranscriptSegment.confidence` type `number` → `number | null` (type truth only — the field is never rendered there, so null cannot surface as 0% or crash).
- Consumers checked: `GET /:id/transcript` passes the value verbatim (null already occurs from the interview-sessions writer); `GET /:id` does not expose it; no integrity/OmniScore/TrustScore consumer reads it.

## Out-of-scope find (for Lead, not fixed here)

- `services/memory-service.js:33,46` — `confidence || 0.8` (smart-profile memory confidence; migration 037 defaults that column to 0.80). Same fabrication class, different field/flow.

## Evidence

- Red-first: `server/__tests__/routes/recordings-whisper-confidence-1619.test.js` — 2 failed / 1 passed on pristine dev (unrecorded → 0.85; measured 0 → 0.85).
- Green (final shape): new suite 6/6 (unrecorded → null; provider 0 → null; 1.7 / -0.2 / NaN → null; 0.42 passes through). Neighbours: recordings-transcribe-claim 2/2, recordings-encryption 10/10, recordings-purged-sentinel 5/5, recordings-session 15/15, recruiter-override-confidence-1613 12/12. (`assessments-graded-confidence-1584` fails 2/2 on pristine dev too — pre-existing, unrelated; verified via stash.)
- Quinn HL-003 (re-run on the final shape): PG16 fresh DB built only by `node migrate.js`; real server + real HTTP `POST /api/interviews/recordings/:id/transcribe` and consumer `GET /:id/transcript`. External boundaries served locally over real HTTP (storage download; Whisper ASR via `OPENAI_BASE_URL` OpenAI-compatible stub — no live provider key exists in this VM); the completed-recording row is seeded post-egress state (LiveKit cannot run here). Case A (ASR returns no confidence): DB `NULL (is_null=t)`, response `null`, consumer `null`. Case B (ASR confidence 0, provider default): DB `NULL`, response `null`, consumer `null`. Case C (ASR confidence 0.42): DB `0.420`, response `0.42`, consumer `0.420`. 9/9 steps PASS.
