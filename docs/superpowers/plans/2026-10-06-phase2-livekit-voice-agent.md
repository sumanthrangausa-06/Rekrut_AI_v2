# Phase 2 LiveKit Voice Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Phase 1 interviews a real-time voice transport: a LiveKit Cloud voice agent that interviews candidates live (Track A), and a muted observer mode that transcribes + analyzes human interviews (Track B).

**Architecture:** One LiveKit Cloud room per `interview_sessions` row. A serverless voice agent (LiveKit Cloud agents) joins as interviewer (Track A) or muted observer (Track B). The Phase 1 `conductTurn` engine stays the single brain — the agent is ears and mouth only. Session rooms/tokens are company-scoped exactly like Phase 1 endpoints.

**Tech Stack:** LiveKit Cloud (Build tier, $0), livekit-server-sdk (installed), livekit-client + @livekit/components-react (installed), Whisper STT via `lib/ai-provider`, Cartesia TTS (existing key), Phase 1 `conductTurn` engine.

**Spec:** `docs/superpowers/specs/2026-10-06-phase2-livekit-voice-agent-design.md`

## Global Constraints

- $0 infrastructure delta: no new paid services, API keys, or processes. LiveKit Cloud Build tier only (hard caps, never bills).
- Every new table/column uses IF NOT EXISTS; new migration number 139 (138 taken by interview_flows).
- Branch from `dev`; PRs target `dev`; never push directly to `staging` or `main`.
- Bring-own-keys for STT/LLM/TTS (Whisper, AI_KEYS_JSON, Cartesia). No LiveKit metered inference.
- Consent rule from Phase 1 carries over: explicit consent before media capture; backend blocks capture when consent missing/withdrawn.
- Track B observer is default-off; candidate is told the observer is present before joining.

## Review Focus

1. **Agent dispatch fails or the agent drops mid-interview** → the candidate must fall back to Phase 1 HTTP turns (Track A) or get a clean error, never a dead silent room. *Test in Task 4: block dispatch, assert HTTP-turn UI takes over.*
2. **Cross-company token mint** → `POST /livekit/session-rooms/:sessionId/token` for another company's session must 403, like every Phase 1 session endpoint. *Test in Task 1.*
3. **STT returns empty/garbage** → the agent must ask for a repeat, never feed garbage into `conductTurn` as a candidate answer. *Test in Task 3: empty transcript → repeat prompt, engine not called.*
4. **Barge-in false triggers** → VAD must be conservative by default (slight yield delay); constant interruptions are the failure mode. *Test in Task 3: rapid noise bursts don't cut the agent off (config assertion + unit test on the VAD threshold).*
5. **Observer captures without consent** → subscription must be gated on the same consent check as Phase 1 frame capture. *Test in Task 5: no consent → 403, no subscription.*

---

### Task 1: Session-linked rooms + token endpoint

**Files:**
- Create: `migrations/139_interview_rooms_session_link.js`
- Modify: `server/routes/livekit.js` (add session room + token endpoints)
- Modify: `server/services/livekit.js` (session room helpers)
- Test: `server/__tests__/routes/livekit-session.test.js`

**Interfaces:**
- Consumes: `interview_sessions` (migration 129), Phase 1 `canAccess` company scoping (`routes/interview-sessions.js`), `generateToken` (`server/services/livekit.js`).
- Produces: `POST /api/livekit/session-rooms` (create-or-get room for a session), `POST /api/livekit/session-rooms/:sessionId/token` → `{ token, roomName }`, `findOrCreateSessionRoom(sessionId)`.

**Why:** The existing token endpoint (`POST /api/livekit/rooms/:id/token`) is wired to the old `interview_events` model (#256's real gap). Phase 2 needs rooms keyed to `interview_sessions`.

- [ ] **Step 1: Write the failing test** — `POST /api/livekit/session-rooms/:sessionId/token` as the session's candidate returns 200 + JWT; as a cross-company recruiter returns 403; unauthenticated returns 401.
- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL (404, no route).
- [ ] **Step 3: Implement migration 139** — `ALTER TABLE interview_rooms ADD COLUMN IF NOT EXISTS interview_session_id INTEGER REFERENCES interview_sessions(id) ON DELETE CASCADE`; index on it. Keep `interview_event_id` (old rooms still use it).
- [ ] **Step 4: Implement the endpoints in `server/routes/livekit.js`** — `POST /session-rooms` (body: `session_id`; company-scoped via Phase 1 `canAccess`; idempotent: return active room if exists; room name `interview-<sessionId>`), `POST /session-rooms/:sessionId/token` (body: `identity`, `name`; mints via `generateToken` with `canPublish/canSubscribe`; candidate gets publish+subscribe, observer identity gets subscribe-only).
- [ ] **Step 5: Run test to verify it passes** — Expected: PASS.
- [ ] **Step 6: Update #256** — comment: the endpoint exists; the actual gap was session-model wiring, closed by this task.
- [ ] **Step 7: Commit** — `git commit -m "feat: session-linked LiveKit rooms + token endpoint (#323)"`.

### Task 2: Agent dispatch endpoint

**Files:**
- Modify: `server/services/livekit.js` (dispatch helper)
- Modify: `server/routes/livekit.js` (dispatch endpoint)
- Test: extend `server/__tests__/routes/livekit-session.test.js`

**Interfaces:**
- Consumes: `findOrCreateSessionRoom` (Task 1), LiveKit Cloud Agent Dispatch API.
- Produces: `POST /api/livekit/session-rooms/:sessionId/dispatch` → `{ dispatched: true } | { already_dispatched: true }`, `dispatchVoiceAgent(sessionId, mode)`.

- [ ] **Step 1: Write the failing test** — dispatch as recruiter returns 200 with `dispatched: true`; second call returns `already_dispatched: true`; cross-company returns 403; LiveKit API failure returns 502 with a clear error (not a crash).
- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL (404).
- [ ] **Step 3: Implement `dispatchVoiceAgent(sessionId, mode)`** — calls the LiveKit Cloud dispatch API targeting room `interview-<sessionId>` with metadata `{ interview_session_id, mode: 'interviewer' | 'observer' }`. Idempotent per session+mode (store dispatch state on the room row or a small in-memory guard backed by DB).
- [ ] **Step 4: Implement the endpoint** — company-scoped; recruiter/hiring_manager only; mode defaults to `interviewer`.
- [ ] **Step 5: Run test to verify it passes** — Expected: PASS (LiveKit API mocked).
- [ ] **Step 6: Commit** — `git commit -m "feat: voice agent dispatch endpoint (#323)"`.

### Task 3: Voice agent worker

**Files:**
- Create: `agents/voice-interviewer/` (agent entry, pipeline, modes)
- Test: `agents/voice-interviewer/pipeline.test.js` (unit, mocked STT/TTS/engine)

**Interfaces:**
- Consumes: `conductTurn(session, candidateText, frames)` (`services/conversation-engine.js`), `transcribeAudio` (`lib/ai-provider`), Cartesia TTS, session metadata from dispatch.
- Produces: a deployable agent (LiveKit Cloud) with two modes; `agents/voice-interviewer/README.md` (deploy instructions via LiveKit CLI).

**Why:** This is the ears-and-mouth. The brain stays in `conductTurn`.

- [ ] **Step 1: Write the failing tests** — (a) empty STT transcript → agent re-prompts, `conductTurn` NOT called; (b) valid transcript → `conductTurn` called with session + text, reply sent to TTS; (c) observer mode → no TTS call, transcript appended with speaker label; (d) VAD config is conservative (yield delay ≥ 300ms default).
- [ ] **Step 2: Run tests to verify they fail** — Expected: FAIL.
- [ ] **Step 3: Implement the pipeline** — Silero VAD → Whisper STT → `conductTurn` → Cartesia TTS → streamed to room (Track A). Track B: subscribe-only, dual transcripts with LiveKit participant identities as speaker labels, no TTS. Barge-in: VAD interrupts TTS playback.
- [ ] **Step 4: Write `agents/voice-interviewer/README.md`** — exact LiveKit CLI deploy commands for the dev and staging projects.
- [ ] **Step 5: Run tests to verify they pass** — Expected: PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat: voice agent worker, interviewer + observer modes (#323)"`.

### Task 4: Track A frontend — room join in the session page

**Files:**
- Modify: `client/src/pages/candidate/InterviewSession.tsx` (join LiveKit room)
- Test: `e2e/phase2-voice-interview.spec.ts` (mocked LiveKit)

**Interfaces:**
- Consumes: `POST /api/livekit/session-rooms/:sessionId/token` (Task 1), dispatch endpoint (Task 2), existing consent/device UI in `InterviewSession.tsx`.

- [ ] **Step 1: Write the failing test** — session page requests a token on start, joins room `interview-<id>`, renders live transcript lines as room events arrive.
- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL.
- [ ] **Step 3: Implement** — on session start: fetch token → dispatch agent (fire-and-forget; failure is silent) → join room with camera+mic (post-consent) → render transcript from room data events → keep the Phase 1 HTTP-turn UI as the fallback path (shown if dispatch fails or LiveKit errors).
- [ ] **Step 4: Run test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: Track A voice room join in session page (#323)"`.

### Task 5: Track B observer — transcripts, Q&A extraction, report

**Files:**
- Create: `services/qa-extraction.js`
- Modify: `routes/interview-sessions.js` (observer toggle on human interviews; report endpoint serves observer reports)
- Modify: `client/src/components/domain/InterviewPanel.tsx` (observer toggle, default off; report link)
- Test: `server/__tests__/services/qa-extraction.test.js`

**Interfaces:**
- Consumes: muted agent transcripts (Task 3), mock-interview analysis stack, `rubric_weights` from `interview_flows` (Task 7, Phase 1).
- Produces: `extractQAPairs(transcript)` → `[{ question, answer, asker, answerer }]`, observer report rendered in the unified panel.

- [ ] **Step 1: Write the failing tests** — fixture transcript (two speakers, free-form) → `extractQAPairs` returns correct Q/A pairs with asker/answerer labels; recruiter rubric weights flow into the report when defined; default rubric otherwise.
- [ ] **Step 2: Run tests to verify they fail** — Expected: FAIL.
- [ ] **Step 3: Implement `extractQAPairs`** — LLM-based (existing LLM keys): identify interviewer questions and candidate answers from speaker-labeled turns.
- [ ] **Step 4: Implement the observer toggle + report wiring** — recruiter enables observer per human interview (default off); candidate sees the observer notice pre-join; on end (or on demand) the transcript → extraction → analysis → report in the panel. Consent gate: subscription blocked without candidate consent (403 path, mirroring Phase 1).
- [ ] **Step 5: Run tests to verify they pass** — Expected: PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat: Track B observer transcripts + analysis (#323)"`.

### Task 6: Room recording + retention

**Files:**
- Modify: `server/services/livekit.js` (egress on room close)
- Modify: `server/routes/livekit.js` (hook into session complete)
- Test: extend `server/__tests__/routes/livekit-session.test.js`

**Interfaces:**
- Consumes: Task 4's session-linked recordings (`interview_recordings`, migration 130), R2 egress (existing).

- [ ] **Step 1: Write the failing test** — session complete triggers egress; recording row links to the session; `retention_expires_at` set.
- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL.
- [ ] **Step 3: Implement** — on session complete: stop egress, link the recording to `interview_sessions` via `interview_recordings.interview_session_id`, set retention per the Phase 1 policy.
- [ ] **Step 4: Run test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: room egress recording + retention (#323)"`.

### Task 7: Staging E2E

**Files:**
- Test: `e2e/phase2-voice.spec.ts` (targeted Playwright, NOT the broken full suite)

**Interfaces:**
- Consumes: staging deployment of all prior tasks (deploys behind Sumanth's approval).

- [ ] **Step 1: Deploy agent to the dev LiveKit project, run unit/integration checks.**
- [ ] **Step 2 (staging, Sumanth's deploy approval required): Track A** — real voice call: transcript accurate, barge-in works, report generated; then block dispatch and verify the HTTP-turn fallback takes over silently.
- [ ] **Step 3 (staging): Track B** — two test users talk; speaker labels correct; report appears in the unified panel; consent-withdrawal stops capture without killing the call.
- [ ] **Step 4: Quota check** — confirm $0 spend on the LiveKit dashboard.
- [ ] **Step 5: Commit** — `git commit -m "test: phase 2 voice E2E (#323)"`.

---

## Self-review

- **Spec coverage:** §3 architecture → Tasks 1–4; Track B observer (§3) → Task 5; §5 consent → Tasks 1/4/5 (gates); §6 error handling → Tasks 2/4 (fallback), Task 3 (STT repeat); §7 testing → each task + Task 7; §8 costs → Task 7 step 4; §11 acceptance criteria → Tasks 1–7 map one-to-one. #256 → Task 1 step 6.
- **Type consistency:** `interview-<sessionId>` room naming used in Tasks 1, 2, 4; `conductTurn(session, candidateText, frames)` signature preserved in Task 3; `extractQAPairs(transcript)` defined in Task 5, consumed there.
- **Proportion:** plan is longer than the spec section it implements, but each task carries interfaces + tests the spec doesn't; no task transcribes implementation bodies.
