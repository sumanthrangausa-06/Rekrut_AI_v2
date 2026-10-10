# Phase 0 Relearn — Project Knowledge Base (v2)

**Project:** Rekrut AI v2 — Unified Interview Engine
**Date:** 2026-10-10
**Workflow:** `smart-sdlc/0-relearn/relearn-codebase` (Steps 01–05)
**Persona:** Scout (Code Archaeologist)
**Specialists:** dependency/duplication mapper (code-review-graph methodology, manual), execution-path tracer (ecc/code-explorer methodology)
**Status:** Complete — v2 replaces v1 (deeper verification, corrected findings)
**Branch verified:** `dev` @ `e92aed69`
**Read-only:** no source files modified.

> **Corrections vs v1:** (1) `ai-screening.tsx` is a dashboard/list page, not a competing interview runtime — the "fragmentation" framing was wrong. (2) `useSpeechRecognition` is not a recognition driver, only availability-check helpers. (3) Newly discovered in v2: `routes/interview-sessions.js` (unified lifecycle), `services/conversation-engine.js` (turn engine), `agents/voice-interviewer/worker.mjs` (existing observer Track B).

---

## 1. Scan Summary (Step 01)

| Attribute | Value | Source |
|-----------|-------|--------|
| Shape | Modular monolith | repo layout |
| Language | TypeScript + JavaScript (Node ≥22) | `package.json` engines |
| Frontend | React 19 + Vite + Tailwind CSS | `client/package.json` |
| Backend | Express.js | `server.js` |
| Database | PostgreSQL (Neon) | `lib/db.js`, migrations |
| Real-time | LiveKit (rooms, voice agents, egress) | `server/services/livekit.js` |
| Entry points | `server.js`, `client/src/main.tsx` | — |

### Interview file inventory (verified line counts)

| File | Lines | Role |
|------|-------|------|
| `client/src/pages/candidate/mock-interview.tsx` | 1,295 | Mock voice-turn loop (auto-mic, silence detection) |
| `client/src/pages/candidate/InterviewSession.tsx` | 1,226 | Unified session page (token join, manual mic, LiveKit Track A) |
| `client/src/pages/candidate/ai-screening.tsx` | 734 | Screening list/detail dashboard — **no turn-taking, no media** |
| `client/src/hooks/useInterviewCamera.ts` | 261 | Shared camera lifecycle |
| `client/src/hooks/useInterviewerAudio.ts` | 360 | Shared TTS playback + auto-record-after-speech |
| `client/src/hooks/useSpeechRecognition.ts` | 34 | **Availability-check helpers only** — not a recognition driver |
| `client/src/pages/candidate/useVoiceRoom.ts` | — | Track A LiveKit join/dispatch/poll adapter (InterviewSession only) |
| `routes/interviews.js` | 3,882 | Legacy mock + screening endpoints |
| `routes/interview-sessions.js` | — | **Unified `interview_sessions` lifecycle** (create/join/respond/complete) |
| `routes/ai-screener.js` | 847 | Screening orchestration (recruiter + candidate) |
| `server/routes/livekit.js` | 442 | `/api/livekit` REST surface, identity prefixes |
| `server/services/livekit.js` | 998 | Token/room/dispatch/egress service |
| `services/conversation-engine.js` | — | Unified turn engine (`conductTurn`) |
| `agents/voice-interviewer/worker.mjs` | — | LiveKit agent: `runInterviewer` (Track A) / `runObserver` (Track B, muted) |

### Other interview pages (noted, out of v2 scope)
`book-interview.tsx`, `interview-active-layout.tsx` (presentation layer used by mock-interview), `interview-analysis.tsx`, `interview-practice.tsx`, `interview-results-page.tsx` (used by mock-interview), `interview.tsx`, `interviews.tsx`, `screening-questionnaire.tsx`, `screening.tsx`, `voice-screening.tsx`, `quick-practice-session.tsx` (third consumer of `useInterviewCamera` — most tightly coupled).

### Interview migrations
`022_screening_questions.js`, `023_fix_interviews_updated_at.js`, `032_mock_interview_cached_feedback.js`, `041_interview_scheduling_screening.js`, `051_screening_tables.js`, `073_screening_questionnaire.js`, `125_interview_panels.js`, `126_interview_events_proposed_slots.js`, `127_livekit_interview_rooms.js`, `128_interview_recordings.js`, `129_interview_sessions_unified.js`, `130_recordings_session_nullable.js`, `138_interview_flows.js`, `139_interview_rooms_session_link.js`, `1739617200000_p1_interview_flow_schema.js`, `235_interview_invite_expiry.js`, `236_unified_interviews_view.js`, `237_unified_interviews_view_slot_ids.js`, `p5_screening_conversational_phase.js`, `p6_screening_template_topics.js`, `p7_auto_send_screening_on_jobs.js`

> ⚠️ **Flag:** migrations `128` and `129` both contain `CREATE TABLE IF NOT EXISTS` for `interview_recordings`, `interview_transcripts`, `recording_consent`, `transcript_highlights` — double-definition. `IF NOT EXISTS` makes it harmless at runtime, but it indicates 129 re-declared 128's tables; verify intent before adding new tables in this area.

---

## 2. Architecture (Step 02)

### Layers
- **Presentation:** `client/src/pages/candidate/` (interview pages), `interview-active-layout.tsx` (shared active-session UI)
- **Client shared:** `client/src/hooks/` (camera, audio, speech-availability), `client/src/lib/` (`api`, `analytics`)
- **API:** `routes/` (60+ files; interview: `interviews.js`, `interview-sessions.js`, `ai-screener.js`), `server/routes/` (`livekit.js`)
- **Business logic:** `server/services/` (`livekit.js`), `services/` (`conversation-engine.js`), `agents/voice-interviewer/` (LiveKit agent worker)
- **Data access:** `lib/db.js` (pg pool), `migrations/`

### Component map (interview runtime)

```
Candidate browser
├── mock-interview.tsx ──► useInterviewCamera ──► camera
│                       ──► useInterviewerAudio ──► TTS /api/interviews/mock/tts
│                       ──► inline SpeechRecognition (own loop, lines 294-359)
│                       ──► POST /api/interviews/mock/* (raw fetch voice path w/ manual 401-refresh)
├── InterviewSession.tsx ─► useInterviewCamera
│                       ──► useInterviewerAudio (TTS /api/interviews/interview-sessions/{id}/tts)
│                       ──► inline webkitSpeechRecognition (own loop, lines 405-436)
│                       ──► useVoiceRoom ──► LiveKit room (Track A voice agent)
│                       ──► POST /api/interviews/interview-sessions/* (apiCall)
└── ai-screening.tsx ──► (no hooks, no media) ──► GET /candidates/me/screenings
                                                   ──► navigate(invite_url) ──► InterviewSession.tsx

Server
├── routes/interview-sessions.js ──► interview_sessions lifecycle (unified)
├── routes/interviews.js ──► mock_interview_sessions, legacy screening, scheduling
├── routes/ai-screener.js ──► screening orchestration + human review
├── services/conversation-engine.js ──► conductTurn (interview vs screening dispatch)
├── server/routes/livekit.js ──► rooms, tokens (identity prefixes), dispatch
├── server/services/livekit.js ──► findOrCreateSessionRoom, generateToken, dispatchVoiceAgent, egress
└── agents/voice-interviewer/worker.mjs ──► runInterviewer / runObserver (reads dispatch metadata)
```

### Turn-taking: mock vs unified (verified)

| Aspect | mock-interview.tsx | InterviewSession.tsx |
|--------|-------------------|----------------------|
| Mic mode | **Automatic** — `useInterviewerAudio` wired with `isVoiceMode/isRecording/startRecording` (lines 151–162); hook's `finish()` re-arms mic on AI audio end | **Manual toggle only** — hook gets none of the voice-loop options (lines 177–184); `toggleRecording` at line 552 |
| Silence detection | AnalyserNode energy threshold: avg < 8 over 200 ms ticks, 15 ticks ≈ 3 s auto-stop, 2.5 s grace (lines 362–437) | **None** — records until user toggles off |
| No-speech handling | ≥15 silent checks + no transcript → skip send, "No speech detected" 3-strike escalation | N/A |
| Voice session | HTTP turn loop (POST voice-respond → audio back) | **Track A LiveKit voice agent** via `useVoiceRoom` (lines 196–220), HTTP fallback |
| Audio endpoint | `/api/interviews/mock/:id/voice-respond` (raw `fetch`, manual token refresh) | `/api/interviews/interview-sessions/:id/respond` (shared text+audio, `apiCall`) |
| Session entry | Direct start (owner) | Invite token → `GET by-token/:token` → `POST :id/start` |
| Types handled | mock only | `screening`, `ai_interview`, `human` (dispatch skipped for human) |
| Storage | `mock_interview_sessions` | `interview_sessions` |

### Duplication map (specialist-verified, ~160–175 lines across 5 blocks)

| Block | mock-interview.tsx | InterviewSession.tsx | Est. lines |
|-------|-------------------|----------------------|-----------|
| D1 frame capture (canvas 320×240 JPEG 0.7, 4 s, cap 20/8-per-q) | 243–293 | 346–376 | ~30–35 |
| D2 text turn-taking send flow | 765–838 | 476–552 | ~40–45 |
| D3 session teardown sequence | 841–868, 890–895 | 444–470 | ~25–30 |
| D4 SpeechRecognition live-transcript loop | 294–359 | 405–436 | ~25 |
| D5 voice-answer upload (MediaRecorder→FormData→respond) | 505–640 | 555–632 | ~40 |

Notes: AI audio playback and camera acquisition are already extracted (hooks). The mock voice path's raw-`fetch` + manual 401-refresh (lines 526–566) duplicates `apiCall` behavior — a lib-level duplication, not cross-page.

### Blast radius: `useInterviewCamera` ref-API change
- **Breaks:** `mock-interview.tsx:101`, `InterviewSession.tsx:137`, `quick-practice-session.tsx:132` (most coupled — destructures all 7 return fields).
- **Unaffected:** `interview-active-layout.tsx` (imports only `getCameraErrorMessage` helper, line 37).

### Communication patterns
- REST (Express) for session lifecycle, transcripts, reports.
- LiveKit for real-time media + voice agent; **server→client push via LiveKit data channel or 3 s transcript polling** (`useVoiceRoom.ts` polls `GET /livekit/session-rooms/:sessionId/transcript`).
- No GraphQL, no message queue, no WebSocket server of our own.

---

## 3. Data & API (Step 03)

### Tables (from migrations 127, 128/129, 138)

**`interview_sessions`** (129): `id`, `type` VARCHAR(50), `job_id`, `application_id`, `candidate_id`, `company_id`, `triggered_by`, `invite_token` VARCHAR(128), `invite_expires_at` (7 weeks), `status`, `config` JSONB (frozen engine config), `conversation` JSONB (turn array), `frame_analysis` JSONB, `started_at`, `completed_at`, `created_at`.
Lifecycle: `invited → in_progress → completed`; `conversation` persisted **before** LLM call (crash-resume safety, `interview-sessions.js:~690`); completion merges report into `config` via jsonb `||`.

**`interview_recordings`** (128/129): `id`, `interview_event_id`, `room_id`, `livekit_egress_id`, `status`, `started_at`, `stopped_at`, `duration_seconds`, `storage_path` BYTEA, `encryption_key_id`, `file_size_bytes`, `file_format`, `retention_expires_at`, timestamps.

**`interview_transcripts`** (128/129): `id`, `recording_id` FK, **`speaker_identity` VARCHAR(255)** (already exists — supports role-labeled transcripts), `text`, `start_time_ms`, `end_time_ms`, `confidence` DECIMAL(4,3).

**`recording_consent`** (128/129): `id`, `recording_id`, `user_id`, `consented_at`, `consent_type`, `ip_address` INET, `user_agent`. Frames rejected with 403 `CONSENT_REQUIRED` without a consent row.

**`transcript_highlights`** (128/129): `id`, `transcript_id`, `user_id`, `note`, `highlight_timestamp_ms`.

**`interview_flows`** (138): `id`, `company_id`, `job_id`, `created_by`, `name`, `type`, `description`, `phases/topics/questions/rubric_weights/triggers` JSONB, `status`.

**`interview_rooms`** (127): `id`, `interview_event_id`, `interview_session_id` (added by 139), `room_name` (`interview-<sessionId>`), `livekit_room_id`, `status`.

**Legacy tables (still written):** `mock_interview_sessions` (mock flow), `interviews` (vestigial `POST /start` path — inferred, flag for verification), `screening_sessions` (legacy screening; unified flow uses `interview_sessions` with `type='screening'`).

### API surface

**`routes/interview-sessions.js`** (unified): `POST /` (create), `POST /trigger` (recruiter AI interview, idempotent per application), `GET /by-token/:token` (anonymous, redacted shape, 410 `INVITE_EXPIRED`), `POST /:id/start` (idempotent, `invited→in_progress`, AI intro except `human`), `POST /:id/respond` (transcribe → consent-gate → persist → `conductTurn` → persist), `POST /:id/complete` (report branch, transcripts insert, recording finalize, `job_applications` mirror).

**`routes/interviews.js`** (mock + legacy): `POST /mock/start`, `POST /mock/:sessionId/respond`, `POST /mock/:sessionId/end`, `GET /mock/sessions[/:id][/feedback][/per-question]`, `GET /mock/question-bank[/browse]`, `POST /mock/analyze-frame`, `POST /mock/tts`, scheduling (`/suggest-slots`, `/schedule`, `/reschedule`, `/scheduling-preferences`), screening templates, legacy `/screening/session/:token/*` (in-flight pre-migration only).

**`routes/ai-screener.js`**: `POST /jobs/:jobId/screen/:candidateId`, `GET /jobs/:jobId/screenings[/:candidateId]`, `POST /jobs/:jobId/screen-batch`, `POST /screenings/:screeningId/human-review`, `GET /screenings/:screeningId/audit-log`, `GET /candidates/me/screenings`, `POST /candidates/me/screenings/:screeningId/request-human-review`.

**`server/routes/livekit.js`**: `POST /rooms`, `POST /rooms/:id/token`, `DELETE /rooms/:id`, `POST /session-rooms` (create-or-get), `POST /session-rooms/:sessionId/token`, `POST /session-rooms/:sessionId/dispatch` (voice agent; rejects interviewer-dispatch into `human`), `GET /session-rooms/:sessionId/transcript`.

### LiveKit identity & metadata (verified)
- Token identity (server/routes/livekit.js:**329**): `` `observer-${user.id}` `` for observers, `` `user-${user.id}` `` otherwise. Legacy per-event rooms: unprefixed `String(user.id)` (line 144).
- **No `token.metadata` is ever set** (generateToken, lines 57–77) and **no room-level metadata** on `createRoom` (lines 104–108).
- Observer token grants: `canPublish: false, canSubscribe: true, canPublishData: false`.
- Dispatch metadata (server/services/livekit.js:**314**): `{ interview_session_id, mode }` — idempotent per session+mode (`_isActiveDispatchForMode`, lines 283–296).
- Agent worker (`agents/voice-interviewer/worker.mjs:262`) parses `ctx.job.metadata` → runs `runInterviewer` (Track A) or **`runObserver` (Track B, muted)**.

---

## 4. Patterns (Step 04)

- **Hooks:** named exports; TypeScript option/return interfaces (`UseInterviewCameraOptions`, `UseInterviewCameraReturn`); union string types for errors (`CameraError`).
- **API client:** `apiCall` from `@/lib/api` is the standard; the mock voice path's raw-`fetch` + manual 401-refresh is the exception (tech-debt pattern).
- **Backend errors:** `try/catch` → `res.status().json({ error })`; ownership checks via `verifyRecruiterOwnsJob`; idempotency via `already_started` / `already_completed` / `already_triggered` / `already_dispatched` responses.
- **Migrations:** numbered prefix (`NNN_name.js`), `CREATE TABLE IF NOT EXISTS`, plain `module.exports = { up }`.
- **State transitions:** explicit status columns with code-enforced transitions (not DB enums).
- **Persistence-before-LLM:** conversation turns written before the AI call (crash-resume safety).
- **Consent gating:** 403 `CONSENT_REQUIRED` blocks frame upload without a `recording_consent` row.

---

## 5. AI Observer Readiness Assessment

### What already exists ✅
| Capability | Evidence |
|------------|----------|
| Observer identity prefix | `observer-${user.id}` (server/routes/livekit.js:329) |
| Subscribe-only observer tokens | `canPublish: false, canSubscribe: true` |
| Idempotent agent dispatch with metadata | `{ interview_session_id, mode }` (server/services/livekit.js:314) |
| Muted observer agent track | `runObserver` in `agents/voice-interviewer/worker.mjs` (Track B) |
| Session-linked rooms | `interview_rooms.interview_session_id` (migration 139) |
| Speaker-labeled transcripts | `interview_transcripts.speaker_identity` |
| Hiring-team-only observer dispatch | route guard on `/session-rooms/:sessionId/dispatch` |
| Human-type session support | `interview_sessions.type='human'`, no AI intro, dispatch guard rejects interviewer-dispatch |

### What's missing ❌
| Gap | Notes |
|-----|-------|
| `candidate-` / `interviewer-` role prefixes | Only `observer-` vs `user-` exist; role must be derived by parsing `user-<id>` and joining to `interview_sessions.candidate_id` |
| Token/room metadata for roles | `generateToken` never sets `token.metadata`; `createRoom` sets no room metadata |
| Silent human-interview observer flow | Existing `runObserver` is tied to voice-agent dispatch modes; human-interview passive observation needs a distinct dispatch path |
| Behavioral/integrity tables | `integrity_events`, `behavioral_signals`, `ai_observer_reports` don't exist yet (planned in architecture) |
| Observer report generation | No `ai_observer_reports` writer; completion report branches cover observer transcript → `analyzeObserverSession` (verify implementation exists) |

### Inferences (explicit)
- I infer the legacy `POST /api/interviews/start` → `interviews` table path is vestigial (nothing else references it) — flag for verification, not settled fact.
- I infer screening Q&A runs exclusively through `InterviewSession.tsx` (unified), since `my-sessions` builds `invite_url` as `/interview/session/<token>` and no other candidate Q&A UI exists for screenings.

---

## 6. Key Decisions for Unified Engine (carried forward)

| Decision | Rationale | Source |
|----------|-----------|--------|
| Extract engine from mock-interview.tsx | Working reference: auto-mic + silence detection already correct | Path 1a |
| Unify on `interview_sessions` + `interview-sessions.js` lifecycle | Already the unified path for screening/ai_interview/human | Path 2 |
| Keep `mock_interview_sessions` separate (for now) | Mock is self-contained; migrate after engine stabilizes | Path 2 |
| AI Observer: parse `user-<id>` + DB join for roles (short term) | No token/room metadata exists today | §5 |
| Add `candidate-`/`interviewer-` prefixes + token metadata (target) | Clean role detection for observer | §5 gaps |
| New tables follow existing migration pattern | Numbered, `IF NOT EXISTS`, non-destructive | §4 |
| Resolve 128/129 double-definition before new tables | Avoid confusion in the recordings area | §3 flag |

---

*End of Phase 0 knowledge base v2. Next: Phase 1 (Analysis) → Aria (Product) owns Phase 2 (PRD).*
