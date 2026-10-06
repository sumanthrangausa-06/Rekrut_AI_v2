# Conversational AI Interviews (Phase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship turn-based conversational AI screening + AI interviews on the existing voice loop, unified in one session model and one candidate-profile panel, with $0 infra delta.

**Architecture:** One new `interview_sessions` table (type-tagged) absorbs screening/mock sessions; a single `services/conversation-engine.js` composes the two existing turn functions as question-source strategies; new `routes/interview-sessions.js` exposes the session API; the existing recording/consent/transcript tables are extended via nullable FK; the candidate gets one session page and the recruiter gets a unified panel.

**Tech Stack:** Node/Express, Neon Postgres, React + TypeScript, existing AI providers (no new keys), R2 storage, MediaRecorder.

**Spec:** `docs/superpowers/specs/2026-10-05-conversational-ai-interviews-design.md` (PR #325)

## Global Constraints

- $0 infrastructure delta: no new AI providers, API keys, paid services, or GPU.
- Every new table/column uses `IF NOT EXISTS`; the Phase 1 migration re-asserts migration-128 tables (they may not have run everywhere — precedent: migration 230).
- Branch from `dev`, PR targets `dev`; no direct pushes to staging/main.
- Conversation turns persist per turn (crash-resume safe); never lose a candidate's spoken answer to an in-memory buffer.
- Consent is written to `recording_consent` before any capture begins.

## Review Focus

- Invite-token double-submit: two concurrent joins with the same token must yield one session, not two (idempotency).
- Long voice answers: audio uploads must not blow Express body limits — chunk or cap with a friendly error.
- Render's ~30s request kill: LLM calls keep the proven 20s timeout + scripted fallback.
- Threshold edge: `auto_send_min_score: 0` is valid and must not become 70 (regression test).
- Consent withdrawn mid-session: capture stops, session marked, no further frames stored.

## File Structure

**Create:**
- `migrations/129_interview_sessions_unified.js` — `interview_sessions` table, nullable `interview_session_id` on `interview_recordings`/`interview_evaluations`, re-assert 128 tables, backfill.
- `services/conversation-engine.js` — `conductTurn()`, question-source strategies, phase machine.
- `routes/interview-sessions.js` — session CRUD + start/respond/complete/tts endpoints.
- `client/src/pages/candidate/InterviewSession.tsx` — single candidate session page.

**Modify:**
- `routes/candidate.js` (~line 2556) — auto-send hook writes `interview_sessions`, `|| 70` → `?? 70`.
- `server/routes/recordings.js` — accept `interview_session_id` alongside room linkage.
- `server.js` — mount new router; add retention interval wiring `euComplianceService`.
- `client/src/pages/recruiter/job-applicants.tsx` — unified interview panel.
- `client/src/pages/recruiter/screening.tsx` — flow config UI (topics, triggers, thresholds).
- `client/src/pages/candidate/voice-screening.tsx`, `screening.tsx` — route into `InterviewSession.tsx` (or wire frame capture; prefer redirect to the single page).

**Unchanged (imported, not moved):** `conductScreeningTurn` (services/interview-ai.js:743), `conductInterviewTurn` (lib/polsia-ai.js:1490), `generateScreeningReport` (services/interview-ai.js:361), Whisper chain (`aiProvider.transcribeAudio`), TTS, analyze-frame vision pipeline.

---

### Task 1: Unified session migration

**Files:**
- Create: `migrations/129_interview_sessions_unified.js`
- Test: `server/__tests__/migrations/129_interview_sessions.test.js` (assert tables/columns exist after migrate)

**Interfaces:**
- Consumes: existing tables `screening_sessions`, `mock_interview_sessions`, `interview_recordings`, `interview_evaluations` (read their DDL from migrations 041/031/128).
- Produces: `interview_sessions` table; `interview_recordings.interview_session_id INTEGER NULL`; `interview_evaluations.interview_session_id INTEGER NULL`.

- [ ] **Step 1: Write the failing test** — assert `interview_sessions` has columns (id, type, job_id, application_id, candidate_id, company_id, triggered_by, invite_token UNIQUE, status, config JSONB, conversation JSONB, frame_analysis JSONB, started_at, completed_at) and that `interview_recordings` has `interview_session_id`.
- [ ] **Step 2: Run test to verify it fails** — Run: `npx jest server/__tests__/migrations/129_interview_sessions.test.js --forceExit  # against a fresh DB; if local PG is down, use a fresh Neon branch` Expected: FAIL (table missing). (If local PG unavailable, run against a fresh Neon branch DB.)
- [ ] **Step 3: Implement migration** — `CREATE TABLE IF NOT EXISTS interview_sessions (...)`; `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; re-assert 128 tables with `IF NOT EXISTS`; backfill: `INSERT INTO interview_sessions SELECT ... FROM screening_sessions` (type='screening') and from `mock_interview_sessions` (type='practice', candidate_id=user_id).
- [ ] **Step 4: Run test to verify it passes** — same command. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: unified interview_sessions migration (#322)"`.

### Task 2: Conversation engine

**Files:**
- Create: `services/conversation-engine.js`
- Test: `server/__tests__/services/conversation-engine.test.js`

**Interfaces:**
- Consumes: `conductScreeningTurn(conversation, job, template, currentPhase)` from `./interview-ai`; `conductInterviewTurn(conversation, baseQuestions, currentQuestionIndex, targetRole, options)` from `../lib/polsia-ai`; `question_bank` rows.
- Produces: `conductTurn(session, candidateText, frames) -> Promise<{ ai_message, phase, is_complete }>`; `selectQuestionSource(session) -> 'template' | 'personalized'`.

- [ ] **Step 1: Write the failing test** — `conductTurn` with a screening-type session returns the template-driven next question; with ai_interview-type returns a JD+resume-grounded question; on LLM throw returns the scripted fallback shape `{ ai_message, phase, is_complete: false }`.
- [ ] **Step 2: Run test to verify it fails** — `npx jest server/__tests__/services/conversation-engine.test.js --forceExit` Expected: FAIL (module missing).
- [ ] **Step 3: Implement `conductTurn`** — load frozen config from session; branch on `session.config.question_source`; wrap provider call in 20s timeout (reuse the `withTimeout` helper pattern from routes/interviews.js); fallback ack list on failure; never duplicate the two imported turn functions.
- [ ] **Step 4: Run test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: unified conversation engine (#322)"`.

### Task 3: Session endpoints

**Files:**
- Create: `routes/interview-sessions.js`
- Modify: `server.js` (mount at `/api/interviews` — after `interviewRoutes`, new paths don't collide), `routes/interviews.js` (thin shims for `/mock/*` and `/screening/session/:token/*` delegating to the engine)
- Test: `server/__tests__/routes/interview-sessions.test.js` (supertest against the router with a test DB)

**Interfaces:**
- Consumes: `conductTurn` from Task 2; `aiProvider.transcribeAudio` for audio input; `textToSpeech` for `/tts`.
- Produces: `POST /interview-sessions`, `POST /interview-sessions/:id/start`, `POST /interview-sessions/:id/respond`, `POST /interview-sessions/:id/complete`, `POST /interview-sessions/:id/tts`, `GET /interview-sessions?candidate_id=|job_id=`.

- [ ] **Step 1: Write the failing test** — create → start → respond (text) → complete returns growing conversation and a final report; respond with audio buffer transcribes; double-start with the same invite token returns the existing session (idempotency).
- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL (router missing).
- [ ] **Step 3: Implement the router** — each handler: auth, load session, delegate turn to engine, persist conversation per turn, on complete call generalized `generateScreeningReport`. Shims: old endpoints call the same engine with a translated session shape.
- [ ] **Step 4: Run test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: interview session endpoints (#322)"`.

### Task 4: Recording/consent/transcript extension

**Files:**
- Modify: `server/routes/recordings.js` (accept `interview_session_id`), `server.js` (retention interval)
- Test: extend `server/__tests__/routes/interview-sessions.test.js` or new `server/__tests__/routes/recordings-session.test.js`

**Interfaces:**
- Consumes: `interview_recordings`, `recording_consent`, `interview_transcripts` tables; `euComplianceService` retention deleter.
- Produces: recording row linked to a session on start; consent row before capture; transcript segments on complete.

- [ ] **Step 1: Write the failing test** — `POST /interview-sessions/:id/start` creates an `interview_recordings` row with `interview_session_id` set; `POST /api/interviews/recordings/:id/consent` writes `recording_consent`; withdrawn consent blocks further capture.
- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL.
- [ ] **Step 3: Implement** — recordings router branches on `interview_session_id` vs `room_id`; wire `euComplianceService`'s retention deleter into a `setInterval` in server.js (daily), following the existing stall-check pattern (server.js ~line 962).
- [ ] **Step 4: Run test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: session-linked recordings + retention (#322)"`.

### Task 5: Auto-send hook migration + threshold fix

**Files:**
- Modify: `routes/candidate.js` (~line 2548–2600)
- Test: `server/__tests__/routes/candidate-autosend.test.js`

**Interfaces:**
- Consumes: `interview_sessions` table; `calculateDeterministicMatch`.
- Produces: auto-sent screening rows in `interview_sessions` (type='screening').

- [ ] **Step 1: Write the failing test** — apply with `auto_send_min_score: 0` creates a session (threshold 0 valid); with score below threshold creates none; double-apply creates exactly one session (idempotency).
- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL (writes to old table / `|| 70`).
- [ ] **Step 3: Implement** — change INSERT target to `interview_sessions` with `type='screening'`, config snapshot from the active template; `jobSettings.auto_send_min_score || 70` → `jobSettings.auto_send_min_score ?? 70`.
- [ ] **Step 4: Run test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: auto-send writes unified sessions, fix threshold falsy bug (#322)"`.

### Task 6: Recruiter AI-interview trigger

**Files:**
- Modify: `routes/interview-sessions.js` (add trigger endpoint)
- Test: extend Task 3's test file.

**Interfaces:**
- Consumes: job row, candidate resume (from `candidate_documents` or profile), `question_bank`.
- Produces: `POST /interview-sessions/trigger` → session with `config.question_source='personalized'`, JD+resume frozen into config.

- [ ] **Step 1: Write the failing test** — trigger creates an invited session whose config contains the job description and resume snapshot; triggering twice for the same application returns the existing session.
- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL.
- [ ] **Step 3: Implement** — validate recruiter owns the job's company; freeze JD + resume text into config; generate invite token; notify candidate.
- [ ] **Step 4: Run test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: recruiter AI interview trigger (#322)"`.

### Task 7: interview_flows generalization

**Files:**
- Create: migration `130_interview_flows.js` (rename-safe: create new table + backfill, or ALTER; prefer new table `interview_flows` + backfill from `screening_templates`)
- Modify: `routes/interview-sessions.js` (flow CRUD)
- Test: migration test + CRUD test.

**Interfaces:**
- Consumes: `screening_templates` rows.
- Produces: `interview_flows` (name, type, phases, topics/questions, rubric weights, triggers `{auto_send_threshold, manual}`); CRUD endpoints.

- [ ] **Step 1: Write the failing test** — backfill copies active templates; CRUD round-trips a flow with triggers.
- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL.
- [ ] **Step 3: Implement** — migration + endpoints; keep `screening_templates` readable during transition (shim), remove after frontend cutover.
- [ ] **Step 4: Run test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: interview flows generalization (#322)"`.

### Task 8: Candidate session page

**Files:**
- Create: `client/src/pages/candidate/InterviewSession.tsx`
- Modify: `client/src/App.tsx` (route), `client/src/pages/candidate/voice-screening.tsx`, `screening.tsx` (redirect to the single page)
- Test: Playwright script `e2e/interview-session.spec.ts` (mocked media): token → consent → start → respond → complete renders transcript.

**Interfaces:**
- Consumes: endpoints from Task 3; `playInterviewerAudio` pattern from mock-interview.tsx (reuse, don't copy-paste — extract shared hook if trivial, else duplicate the 30-line player).
- Produces: full session UI with frame capture (reuse mock-interview's capture cadence).

- [ ] **Step 1: Write the failing test** — Playwright: with mocked getUserMedia, the page progresses invite → consent → first AI question → answer → second question.
- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL (page missing).
- [ ] **Step 3: Implement the page** — consent screen → device check → session (self video, AI voice via TTS endpoint, live transcript, progress) → thank-you; frames captured per answer and sent on respond.
- [ ] **Step 4: Run test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: unified candidate interview session page (#322)"`.

### Task 9: Recruiter unified panel + session report

**Files:**
- Modify: `client/src/pages/recruiter/job-applicants.tsx` (panel), new `client/src/pages/recruiter/InterviewReport.tsx` (or extend existing report view)
- Test: Playwright: applicant row shows all three session types; report shows transcript, scores, frame timeline, recording playback.

**Interfaces:**
- Consumes: `GET /interview-sessions?candidate_id=`; `interview_evaluations` via report endpoints; `interview_recordings` playback URLs.
- Produces: panel list + report view.

- [ ] **Step 1: Write the failing test** — seeded sessions of all types render in the panel; opening a session shows transcript + scores + playback element.
- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL.
- [ ] **Step 3: Implement** — panel component (type badges, status), report view reusing the existing screening-report renderer where possible.
- [ ] **Step 4: Run test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: unified interview panel + report (#322)"`.

### Task 10: Recruiter flow config UI

**Files:**
- Modify: `client/src/pages/recruiter/screening.tsx`
- Test: Playwright: edit topics, set threshold 0 (regression for the falsy bug), preview flow, save persists to `interview_flows`.

**Interfaces:**
- Consumes: flow CRUD from Task 7.
- Produces: config UI.

- [ ] **Step 1: Write the failing test** — set threshold to 0, save, reload: still 0 (not 70).
- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL.
- [ ] **Step 3: Implement** — topics editor (exists), threshold input (null-safe), trigger toggles, flow preview.
- [ ] **Step 4: Run test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: interview flow config UI (#322)"`.

### Task 11: Audit events

**Files:**
- Modify: `routes/interview-sessions.js` (emit), `routes/company.js` or audit route (read)
- Test: unit test asserting events on flow update + session lifecycle.

**Interfaces:**
- Consumes: company audit log pattern (#251).
- Produces: `flow.created/updated`, `session.sent/started/completed/scored`, `report.viewed` events.

- [ ] **Step 1: Write the failing test** — trigger → start → complete emits the four session events with actor + timestamp.
- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL.
- [ ] **Step 3: Implement** — emit on each transition; store in the audit table used by #251.
- [ ] **Step 4: Run test to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: interview audit events (#322)"`.

### Task 12: Staging end-to-end verification

**Files:**
- Test: `e2e/phase1-interview.spec.ts` (targeted Playwright, NOT the broken full suite)

**Interfaces:**
- Consumes: staging deployment of all prior tasks.
- Produces: green E2E proof.

- [ ] **Step 1: Apply → auto-send** — candidate applies to a job with auto-send on; screening session created in `interview_sessions`; invite notification sent.
- [ ] **Step 2: Complete a screening** — join via token, consent, answer 2+ questions with camera on; verify transcript grows, frames analyzed, recording row completed.
- [ ] **Step 3: Recruiter trigger** — trigger AI interview; verify questions reference the resume (personalized source).
- [ ] **Step 4: Panel + audit** — unified panel shows all sessions; audit log has the lifecycle events; retention ExpiresAt set.
- [ ] **Step 5: Commit the E2E script** — `git commit -m "test: phase 1 interview E2E (#322)"`.

---

## Self-review

- **Spec coverage:** every spec section maps — 5.1→Task 1, 5.2→Tasks 2–3, 5.3→Tasks 4+8, 5.4→Tasks 7+10, 5.5→Task 8, 5.6→Task 9, 5.7→Tasks 4+11, 5.8→engine fallbacks (Task 2) + Review Focus tests, 5.9→Task 12. Recording/consent/transcript reuse → Task 4. Threshold fix → Task 5.
- **Type consistency:** `conductTurn(session, candidateText, frames)` defined once in Task 2, referenced identically in Task 3. `interview_session_id` nullable FK named identically in Tasks 1 and 4.
- **Proportion:** plan is longer than the spec section it implements but each task carries interfaces + tests the spec doesn't; no task transcribes implementation bodies.
