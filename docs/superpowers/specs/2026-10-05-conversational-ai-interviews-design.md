# Conversational AI Interviews — Design Spec

- **Date:** 2026-10-05
- **Status:** Design approved by Sumanth (2026-10-05); spec review pending
- **Epic:** #321 · **Phase issues:** #322 (Phase 1), #323 (Phase 2), #324 (Phase 3)
- **Path:** superpowers/brainstorming, architectural

## 1. Intent

Give recruiters AI-run conversational interviews with video and voice, in two
products sharing one engine: standardized **screening** (first round, auto-sent
on apply) and personalized **AI interviews** (recruiter-triggered deep dives).
Every session — AI or human-scheduled — surfaces in one interview panel on the
candidate's profile, visible to the hiring team, with transcripts, scores,
frame analysis, recordings, and a full audit trail.

Success looks like: a candidate applies, gets auto-screened the same day,
completes a live voice+video conversation, and the recruiter opens one panel
to see the transcript, per-question scores, body-language analysis, and the
recording — with zero GPU spend.

## 2. Locked product decisions

- **Two independent layers.** Video interview infrastructure (candidate
  video/audio, recording, frame capture, analysis) is the product. Avatar face
  rendering (recruiter's own face / branded / Rekrut default) is an optional
  GPU enhancement. They are designed, built, and shipped independently.
- **Screening vs AI interview.** Screening is standardized and template-driven
  from the recruiter's per-job topics — same flow for every candidate, auto-sent
  on apply above a threshold; its job is fast filtering. AI interviews are
  personalized: questions generated from the JD + the candidate's resume + the
  role, with follow-ups probing actual experience claims; recruiter-triggered;
  their job is deep evaluation. One shared conversational engine, different
  question sources and depth.
- **Mode:** live real-time conversation. Not async recorded answers.
- **Unified panel.** Screening sessions, AI interviews, and human-scheduled
  interviews all appear in one interview panel on the candidate's profile.
- **Visibility.** Session data visible to hiring team only (recruiter + hiring
  manager); candidates see their own sessions.
- **Recording & retention.** Explicit consent checkbox before joining
  (`recording_consent`, migration 128). Full session video to R2 via
  `interview_recordings` (encrypted storage reference). Transcript, analysis,
  key frames, and scores stay in the DB. Raw video auto-deleted 30 days after
  the hiring decision via `retention_expires_at` (note: the table default is
  90 days — the 30-day-post-decision value is set explicitly per recording).
- **Transparency.** Every flow change and session event is audit-logged.

## 3. Architecture

```
Phase 1 (this spec): turn-based HTTP conversational loop — $0, no GPU
  candidate browser (video+audio, frames)
    → POST /interview-sessions/:id/respond (text or audio)
    → conversation-engine: question source → LLM (20s timeout + fallback)
    → TTS (Cartesia) → audio playback in browser
    → frames → vision analysis → per-answer indicators
    → R2 recording, transcript, scores, audit events

Phase 2 (#323): same engine, LiveKit full-duplex agent replaces HTTP turns
Phase 3 (#324): optional GPU avatar face renders on top of Phase 1/2 media
```

Transport is abstracted: the interview engine never knows whether turns arrive
over HTTP or a LiveKit room. Phase 2 and 3 slot in without touching questions,
scoring, or analysis.

## 4. Approaches considered

- **A. Turn-based HTTP, generalized (chosen).** Reuse the proven mock-interview
  loop; add the employer layer. $0, fastest, proven UX. Cost: multi-second
  turns, no barge-in.
- **B. LiveKit full-duplex agent now (rejected for Phase 1).** Sub-second,
  interruptible — but a new distributed system (agent worker, room lifecycle,
  token service, egress costs) and the highest pre-launch risk. Deferred to
  Phase 2 behind the transport abstraction.
- **C. Ship A, abstract the transport (roadmap).** The strategy connecting the
  phases; reversible by construction.

Key technical finding: the mock-interview loop (question bank →
conductInterviewTurn → Whisper→LLM→TTS → frame capture → vision analysis) is
already ~80% of Phase 1. Phase 1 employer-ifies it; it does not build a new
engine.

## 5. Detailed design — Phase 1

### 5.1 Session model (data)

New `interview_sessions` table:

| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| type | text | `screening` \| `ai_interview` \| `practice` \| `human_scheduled` |
| job_id, application_id, candidate_id, company_id | FKs | nullable where N/A |
| triggered_by | FK users | recruiter, or NULL for auto-send |
| invite_token | text unique | candidate join |
| status | text | `invited` \| `in_progress` \| `completed` \| `expired` \| `cancelled` |
| config | JSONB | frozen template snapshot: phases, topics/questions, scoring rubric, question source |
| conversation | JSONB | turns: role, text, timestamp, phase, per-turn metadata |
| frame_analysis | JSONB | per-answer vision indicators + aggregate (no existing table covers this) |
| started_at, completed_at | timestamptz | |

**Reuse, don't duplicate — with an honest caveat.** The recording/consent/
transcript/evaluation infrastructure already exists in migrations and the new
session row links to it instead of adding columns:
- `interview_recordings` (migration 128): gets a nullable
  `interview_session_id` FK. Reuses its status lifecycle
  (`pending→recording→processing→completed→failed→deleted`), encrypted
  `storage_path` (BYTEA, never raw URLs), and `retention_expires_at`.
- `interview_transcripts` (128): speaker-attributed segments; the turn-based
  conversation JSONB stays as the live working copy, final transcript lands here.
- `recording_consent` (128): per-user consent records
  (`explicit`/`implicit`/`withdrawn`) — replaces the proposed `consent_at` column.
- `interview_evaluations` + `interview_composite_scores` (041): already carry
  nullable `interview_id`/`screening_session_id` and are actively written by
  `runMultiEvaluation` — per-evaluator and composite scores go here, not in a
  new `scores` JSONB column.
- **Caveat (verified 2026-10-06):** the 128 tables have zero write paths and
  zero UI reads today — nothing creates recording rows, and only the
  compliance deleter touches them. They were built for the unshipped LiveKit
  flow. Phase 1 therefore BUILDS the write path (recording row on session
  start, consent write, transcript write, status transitions). Pre-build gate:
  verify these tables exist in the live database — migration files existing
  locally does not prove they ran (precedent: migration 230 never ran on
  staging). The Phase 1 migration re-asserts them with `IF NOT EXISTS`.

Migration: backfill from `screening_sessions` and `mock_interview_sessions`;
link `scheduled_interviews` and `interview_rooms` rows as `human_scheduled`.
No third table family — this consolidation is a requirement, not a
suggestion. One read path serves the panel:
`GET /interview-sessions?candidate_id=` / `?job_id=`.

### 5.2 Conversational engine (backend)

New `services/conversation-engine.js`, single entry point
`conductTurn(session, candidateText, frames)`:

1. Load session + frozen config.
2. Select question source —
   - screening: recruiter template topics/questions (standardized);
   - ai_interview: JD + resume + role prompt generating personalized questions
     and follow-ups (question_bank reused, keyed by role+jd_hash+resume_hash).
3. `conductScreeningTurn` (services/interview-ai.js) and `conductInterviewTurn`
   (lib/polsia-ai.js) move in as the two question-source strategies. Not
   duplicated.
4. LLM call with 20s timeout + scripted fallback (existing mock pattern).
5. Append both turns to `conversation` JSONB on every turn (crash-resume safe).
6. Return `{ ai_message, phase, is_complete }`.

Endpoints (new; old routes become thin shims, then are removed):

- `POST /interview-sessions` — create (recruiter trigger or #307 auto-send hook)
- `POST /interview-sessions/:id/start`
- `POST /interview-sessions/:id/respond` — accepts text or audio (audio →
  Whisper via the existing aiProvider 4-layer chain)
- `POST /interview-sessions/:id/complete` — generalized
  `generateScreeningReport` → scores
- `POST /interview-sessions/:id/tts` — generalized `/mock/tts`

### 5.3 Media pipeline

- Candidate media: getUserMedia video+audio; MediaRecorder captures the full
  session → chunked upload to R2 on complete. An `interview_recordings` row is
  created at session start (status `pending` → `recording` → `processing` →
  `completed`); consent is written to `recording_consent` before capture
  begins. Both tables already exist (migration 128).
- Frame capture: reuse mock-interview's capture cadence (periodic + per
  answer). Frames ride along on `respond` → existing analyze-frame vision
  pipeline → per-answer indicators stored in `frame_analysis`, aggregated into
  the report. This closes the known gap in voice-screening.tsx/screening.tsx,
  which are preview-only today.
- TTS: Cartesia via the generalized endpoint; browser speech-synthesis
  fallback in the UI (existing pattern).
- STT: browser speech recognition for the live transcript + server-side
  Whisper on audio upload (existing voice-respond pattern).

### 5.4 Recruiter config + triggers

- Generalize `screening_templates` → `interview_flows`: name, type, phases,
  topics/questions, scoring rubric weights, triggers
  `{ auto_send_threshold, manual }`.
- Job UI: keep the existing topics editor + threshold (#307/#318), add flow
  preview. "Trigger AI interview" on the applicant row creates a session with
  JD+resume context frozen into config.
- Auto-send: the existing #307 apply hook creates screening sessions; same
  logic, new table.

### 5.5 Candidate join flow (frontend)

One page, `InterviewSession.tsx` (replaces/augments voice-screening.tsx and
screening.tsx): invite token → consent screen → camera/mic check → live
session (self video, AI voice, live transcript, per-question progress) →
thank-you screen. Frame capture wired in using mock-interview's cadence.

### 5.6 Unified panel + reports (frontend)

- Recruiter candidate profile → Interview panel: every session by type and
  status. Session detail: transcript, per-question scores, frame-analysis
  timeline, recording playback (R2 URL), AI summary. Cross-candidate
  comparison per job.
- Extend screening-monitor for live session tracking.

### 5.7 Audit + retention

- Audit events: `flow.created/updated`, `session.sent/started/completed/scored`,
  `report.viewed` (feeds the company audit log, #251).
- Retention: the existing `retention_expires_at` mechanism on
  `interview_recordings` (migration 128) drives auto-deletion — set it to
  30 days after the hiring decision per recording (the table default is
  90 days). Transcript, analysis, key frames, and scores are retained.

### 5.8 Error handling

LLM timeout → scripted fallback. TTS failure → browser speech. STT failure →
typed-input fallback. Network drop → resume by session id + token (conversation
persisted per turn). Rate limits → friendly retry message. No dead ends for
the candidate.

### 5.9 Verification

- Pre-build: verify `interview_recordings`, `recording_consent`, and
  `interview_transcripts` exist in the live database (staging + production
  share one DB — check once). Migration 128's file existing locally is not
  proof it ran.
- Unit: question-source selection, fallback paths, retention worker.
- Staging E2E (targeted Playwright scripts, not the broken full suite):
  apply → auto-send → completed screening with transcript + frame analysis +
  recording, all in the unified panel; recruiter-triggered AI interview with
  JD+resume-personalized questions; audit-log assertions.

## 6. Non-goals

- No GPU, no avatar rendering (Phase 3, #324).
- No full-duplex agent (Phase 2, #323).
- No new AI providers, keys, or paid infra. $0 delta.
- No changes to interview scoring semantics beyond generalizing the existing
  report generator.

## 7. Open questions (deferred to their phase)

- Phase 2: current LiveKit egress/pricing and agent-worker ops model (#323).
- Phase 3: renderer quality bar and GPU provider/pricing (#324).
