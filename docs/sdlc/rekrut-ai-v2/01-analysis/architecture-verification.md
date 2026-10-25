# Architecture Verification — Unified Interview Engine (v2)

**Date:** 2026-10-10 (v2 — Scout's Phase 0 relearn corrections incorporated)
**Skills:** `smart-sdlc` `relearn-codebase` (Scout), dependency/duplication mapper, execution-path tracer
**Purpose:** Verify actual codebase state before designing unified engine (per Sumanth's "verify before theorizing" rule)
**Status:** v2 replaces v1. Corrections vs v1 noted inline.

---

## Verified File Inventory

| File | Lines | Role |
|------|-------|------|
| `client/src/pages/candidate/mock-interview.tsx` | 1,295 | **Runtime A** — Mock voice-turn loop (auto-mic, silence detection) |
| `client/src/pages/candidate/InterviewSession.tsx` | 1,226 | **Runtime B** — Unified session page (token join, manual mic, LiveKit Track A) |
| `client/src/pages/candidate/ai-screening.tsx` | 734 | **Dashboard** — screening list/detail, no media, no turn-taking *(v2 correction: not a runtime)* |
| `client/src/pages/candidate/voice-screening.tsx` | 13 | Wrapper/redirect only |
| `client/src/hooks/useInterviewCamera.ts` | 261 | Shared camera lifecycle |
| `client/src/hooks/useInterviewerAudio.ts` | 360 | Shared TTS playback + auto-record-after-speech |
| `client/src/hooks/useSpeechRecognition.ts` | 34 | **Availability-check helpers only** *(v2 correction: not a recognition driver)* |
| `client/src/pages/candidate/useVoiceRoom.ts` | — | Track A LiveKit join/dispatch/poll adapter (InterviewSession only) |
| `routes/interviews.js` | 3,882 | Legacy mock + screening endpoints |
| `routes/interview-sessions.js` | — | **Unified `interview_sessions` lifecycle** (create/join/respond/complete) *(v2: newly discovered)* |
| `routes/ai-screener.js` | 847 | Screening orchestration (recruiter + candidate) |
| `server/routes/livekit.js` | 442 | `/api/livekit` REST surface, identity prefixes |
| `server/services/livekit.js` | 998 | Token/room/dispatch/egress service |
| `services/conversation-engine.js` | — | Unified turn engine (`conductTurn`) *(v2: newly discovered)* |
| `agents/voice-interviewer/worker.mjs` | — | LiveKit agent: `runInterviewer` (Track A) / `runObserver` (Track B, muted) *(v2: newly discovered)* |

**Shared hooks (verified):**
- `useInterviewCamera.ts` — Camera lifecycle management (used by both runtimes)
- `useInterviewerAudio.ts` — AI voice playback (used by both runtimes)
- `useSpeechRecognition.ts` — `isSpeechRecognitionAvailable()` + message constant only. **Both runtimes run their own inline SpeechRecognition loops** (~25 lines duplicated each: mock-interview lines 294–359, InterviewSession lines 405–436)

**Backend (verified):**
- `server/routes/livekit.js:329` — identity prefixes (`observer-${user.id}`, `user-${user.id}`)
- `server/services/livekit.js` — `generateToken()`, room dispatch with `{interview_session_id, mode}` metadata
- `routes/interviews.js`, `routes/ai-screener.js` — mount order is fragile (documented in code comments)

---

## Key Findings

### Finding 1: Two runtimes, not three (v2 correction)
The Oct 8 audit's "90% duplication across 3 implementations" was wrong. `ai-screening.tsx` is a **dashboard** — it lists screenings and navigates via `invite_url` into `InterviewSession.tsx`. There are **two runtimes**: mock-interview.tsx (Runtime A) and InterviewSession.tsx (Runtime B).

### Finding 2: Hooks are shared; page-level logic is duplicated (confirmed)
Both runtimes use `useInterviewCamera` and `useInterviewerAudio`. Duplication is in **page-level orchestration**: ~160–175 lines across 5 blocks (frame capture, text turn flow, teardown, speech loop, voice upload) — all between mock-interview.tsx and InterviewSession.tsx.

### Finding 3: Speech recognition is NOT shared (v2 correction)
`useSpeechRecognition` (34 lines) only exposes availability checks. Each runtime implements its own inline `webkitSpeechRecognition` loop. This is a genuine shared-module gap.

### Finding 4: Turn-taking models differ (verified)
- **Runtime A (mock):** Automatic mic — hook re-arms recording on AI audio end; AnalyserNode silence detection with 3s auto-stop
- **Runtime B (InterviewSession):** Manual mic toggle only, no silence detection; LiveKit Track A voice agent with HTTP fallback

### Finding 5: Video bug confirmed
`InterviewSession.tsx` renders two `<video>` elements sharing one `videoRef` (setup/pre-join ~line 888, active-interview ~line 1086). `useInterviewCamera.ts` (~line 188) attaches the stream once via `videoRef.current.srcObject`. On UI transition the old element unmounts, the ref points to the new element, and the stream is never reattached.

### Finding 6: Unified backend already emerging (v2 discovery)
`routes/interview-sessions.js` implements a unified session lifecycle (create/join/respond/complete) against `interview_sessions`. `services/conversation-engine.js` provides `conductTurn`. The backend is already converging — the frontend has not caught up.

### Finding 7: LiveKit identity pattern exists (confirmed)
`server/routes/livekit.js:329`:
```js
identity: isObserver ? `observer-${user.id}` : `user-${user.id}`
```
Only `observer-` vs `user-` prefixes exist today. No `candidate-`/`interviewer-` role prefixes yet.

### Finding 8: Transcript speaker identity exists (confirmed)
`interview_transcripts.speaker_identity` VARCHAR(255) stores speaker labels. Ready for role-prefix mapping.

### Finding 9: Migration 128/129 double-definition (flag)
Both migrations contain `CREATE TABLE IF NOT EXISTS` for `interview_recordings`, `interview_transcripts`, `recording_consent`, `transcript_highlights`. Harmless at runtime (`IF NOT EXISTS`) but indicates 129 re-declared 128's tables. **Verify intent before adding new tables in this area.**

### Finding 10: Legacy paths (flag)
- `mock_interview_sessions` — separate table, still active
- `POST /api/interviews/start` → `interviews` table — inferred vestigial, needs confirmation before cleanup
- Legacy `/screening/session/:token/*` — in-flight pre-migration only

---

## AI Observer Readiness (v2 — verified)

### What exists
| Capability | Evidence |
|------------|----------|
| `observer-` identity prefix | `server/routes/livekit.js:329` |
| Subscribe-only observer tokens | Token generation with publish restrictions |
| Muted observer agent track | `agents/voice-interviewer/worker.mjs` — `runObserver` (Track B) |
| Idempotent dispatch with metadata | `{interview_session_id, mode}` in dispatch metadata |
| Session-linked rooms | `interview_rooms` via migration 139 |
| Speaker-labeled transcripts | `interview_transcripts.speaker_identity` |
| Human session type support | `type='human'` with dispatch guard |

### What's missing
| Gap | Impact |
|-----|--------|
| No `candidate-`/`interviewer-` role prefixes | Observer must parse `user-<id>` and DB-join to `candidate_id` |
| No role metadata in token/room | Role resolution requires extra lookup |
| No behavioral/integrity tables | `integrity_events`, `behavioral_signals` don't exist yet |
| No observer report writer | Analysis has nowhere to persist |

### Proposed role mapping (unchanged from v1)
| Participant | Identity Pattern | Analysis |
|-------------|-----------------|----------|
| Candidate | `candidate-{userId}` | Full behavioral + integrity analysis |
| Human interviewer(s) | `interviewer-{userId}` | Diarization only (who's speaking) |
| AI Observer bot | `ai-observer-{sessionId}` | Ignored (itself, subscribe-only) |

**Fallback:** Room metadata is source of truth:
```json
{
  "interview_session_id": 123,
  "candidate_id": 456,
  "interviewer_ids": [789],
  "mode": "human-with-ai-observer"
}
```

**Edge cases:**
- Panel interviews: multiple `interviewer-{userId}`, single candidate analysis target
- Wrong identity: room metadata wins; mismatch logged as integrity flag
- Interviewer camera off: observer continues; notes "interviewer video off" in report
- Observer publishes no audio/video tracks (subscribe-only, invisible in UI)

### What gets analyzed for whom
| Signal | Candidate | Interviewer |
|--------|-----------|-------------|
| Facial expressions | ✅ Full | ❌ No |
| Voice prosody | ✅ Full | ⚠️ Diarization only |
| Gaze patterns | ✅ Full | ❌ No |
| Integrity flags | ✅ Full | ❌ No |
| Linguistic (answers) | ✅ STAR, depth | — |
| Linguistic (questions) | — | ✅ Quality/depth/bias |

---

## Database State (verified)

| Table | Status | Notes |
|-------|--------|-------|
| `interview_sessions` | ✅ Active | `invite_expires_at` = 7 weeks; crash-safe persist-before-LLM |
| `interview_recordings` | ✅ Active | Session-linked |
| `interview_transcripts` | ✅ Active | Has `speaker_identity` |
| `recording_consent` | ✅ Active | 403 `CONSENT_REQUIRED` gate enforced |
| `interview_rooms` | ✅ Active | Session-linked via migration 139 |
| `interview_flows` | ✅ Active | Recruiter-defined configs |
| `mock_interview_sessions` | ⚠️ Legacy, active | Separate from unified sessions |
| `interview_analysis` | ⚠️ Legacy | References old `interviews` table, not `interview_sessions` |

**Gaps (new tables needed in Phase 3):**
| Gap | Table |
|-----|-------|
| Integrity flag timeline | `integrity_events` (NEW) |
| Per-turn behavioral signals | `behavioral_signals` (NEW) |
| AI Observer reports | `ai_observer_reports` (NEW) |
| Unified per-question analysis | `session_analysis` (NEW — replaces legacy `interview_analysis`) |

**Migration pattern** (from `migrations/138_interview_flows.js`):
- Numbered, module exports with `name` + `up`
- `IF NOT EXISTS` everywhere (idempotent)
- Non-destructive (old tables kept during transition)

---

## Revised Migration Order

Based on verification (not theory):

| Phase | Action | Rationale |
|-------|--------|-----------|
| 1 | Migrate `ai-screening.tsx` dashboard data flow | It's a dashboard — ensure it reads from unified session APIs |
| 2 | Extract shared speech-recognition module | Genuine gap: both runtimes have inline loops |
| 3 | Extract engine from `mock-interview.tsx` | Reference implementation (working), validate identical behavior |
| 4 | Migrate `InterviewSession.tsx` to engine | Fixes video bug + adds auto-mic/silence detection as part of migration |
| 5 | Adopt `candidate-`/`interviewer-`/`ai-observer-` identity prefixes | Extends existing `observer-` pattern |
| 6 | Build AI Observer service | New capability, reuses LiveKit infra + existing `runObserver` |
| 7 | Add integrity + behavioral layers | New capability, builds on stable engine |
| 8 | Build 4 new tables + compliance automation | Data layer for integrity/behavioral |

---

## Blast Radius

**Frontend:**
- `client/src/pages/candidate/mock-interview.tsx` → becomes thin wrapper
- `client/src/pages/candidate/InterviewSession.tsx` → becomes thin wrapper (video bug fixed in migration)
- `client/src/pages/candidate/ai-screening.tsx` → dashboard reads unified APIs
- `client/src/pages/candidate/voice-screening.tsx` → likely deprecated
- `client/src/hooks/useInterviewCamera.ts` → may need callback-ref fix for video bug
- New: `client/src/hooks/useSpeechRecognitionLoop.ts` (shared recognition driver)
- New: `client/src/engine/interview/` (entire new module)
- New: Human interview observer UI (recruiter view)

**Backend:**
- `routes/interview-sessions.js` → becomes canonical session API (already converging)
- `services/conversation-engine.js` → extends with integrity hooks
- `agents/voice-interviewer/worker.mjs` → `runObserver` promoted from muted stub to full observer
- New: `server/services/ai-observer.js` (or extend worker.mjs)
- New: 4 migration files
- Modified: `server/routes/livekit.js` (role identity prefixes)
- New: Compliance automation (retention cron, deletion workflows)
- New: Report generation (dual reports, AI Observer section)

---

## Verification Method

Per Sumanth's hard rule ("verify before theorizing"):
- ✅ Read actual files (Scout, Phase 0 v2)
- ✅ Line counts verified with `wc -l`
- ✅ Hook usage checked with `grep`
- ✅ Execution paths traced (turn-taking in both runtimes)
- ✅ Backend session lifecycle traced
- ✅ LiveKit room join + identity/metadata verified
- ✅ Migration files enumerated
- ❌ Did NOT yet verify report components (pending Phase 3)
