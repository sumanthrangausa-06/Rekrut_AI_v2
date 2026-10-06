# Phase 2 Design: Full-Duplex LiveKit Voice Agent (#323)

**Status:** draft — pending Sumanth's review
**Date:** 2026-10-06
**Parent:** #321 (epic), follows #322 (Phase 1 — shipped, staging E2E green)

## 1. Goal

Upgrade the interview media transport from turn-based HTTP to real-time
full-duplex voice over LiveKit, in two tracks:

- **Track A — AI voice interviewer.** A voice agent interviews the candidate
  live: sub-second responses, barge-in, natural turn-taking. The candidate is
  on video + voice; everything Phase 1 captures (frames, voice, transcript,
  scores) keeps working, fed from the LiveKit media tracks.
- **Track B — human interview observer.** Recruiter and candidate talk to each
  other; the AI joins muted, transcribes both sides with speaker labels, and
  analyzes the interview using the mock-interview analysis stack.

Session logic, questions, scoring, and the analysis itself stay unchanged —
Phase 2 is a transport upgrade plus a silent-observer mode, not a rebuild.

## 2. Locked decisions

1. **LiveKit Cloud, Build tier ($0/mo, no credit card).** Verified 2026-10-06:
   5,000 WebRTC minutes + 1,000 agent minutes/month, hard caps (requests fail,
   never bills). ~40 hours of 1:1 interviews/month — ample for build, staging,
   and early use. Credentials live in staging env vars; verified working via
   token generation.
2. **Serverless agent deployment (LiveKit Cloud agents).** Zero new processes
   to host or monitor. If usage ever outgrows the free quota, the worker moves
   in-house later — the transport abstraction makes that move not touch
   interview logic (reversible decision).
3. **Bring our own STT/LLM/TTS keys** (Whisper via `lib/ai-provider`, LLM via
   `AI_KEYS_JSON`, Cartesia for TTS). LiveKit's metered inference is not used —
   no second bill, no new vendor.
4. **The engine doesn't know the transport.** `conductTurn(session,
   candidateText, frames)` remains the single authority for questions,
   follow-ups, and scoring. The HTTP router and the voice agent both call it.
5. **One analysis stack for everything.** The mock-interview analysis (frame
   analysis, voice analysis, transcript scoring) serves mock interviews, AI
   interviews, and human interviews. Track B's only adaptation is Q&A-pair
   extraction from the free-form transcript (recruiter questions aren't
   scripted).
6. **AI interviewer is voice-only in Phase 2.** No avatar face — that's Phase 3
   (#324, optional GPU), already separated.
7. **$0 infrastructure delta.** No new paid services, keys, or processes.

## 3. Architecture

One LiveKit Cloud room per interview session: `interview-<sessionId>`.

**Track A (AI interviewer):**
- Candidate starts the session → backend dispatches the cloud voice agent to
  the room with session metadata (session id, type, question source).
- Agent pipeline: Silero VAD → STT (Whisper) → `conductTurn` → TTS (Cartesia)
  → streamed back with barge-in (candidate can interrupt).
- Candidate media: camera + mic on (same consent → devices flow as Phase 1).
  Video track feeds the frame-analysis pipeline; audio feeds STT + voice
  analysis; transcript + frames persist exactly as Phase 1 does.

**Track B (human observer):**
- Recruiter starts a human interview from the unified panel → room created,
  both join with camera + mic.
- Backend dispatches the agent **muted** (no audio publish, no TTS). It
  subscribes to both media tracks: audio → STT with speaker labels from
  LiveKit participant identities (no ML diarization needed); video → frame
  pipeline.
- On interview end (or on demand), the transcript goes through Q&A extraction
  (LLM-based, using the existing LLM keys: identify interviewer questions and
  the candidate's answers from speaker-labeled turns) → mock-interview
  analysis → report, using the recruiter's `rubric_weights`
  from `interview_flows` when defined, else the default rubric.

**Shared backend pieces:**
- `POST /api/livekit/rooms/:id/token` — the missing endpoint from #256.
  Mints tokens for candidate/agent/observer identities, company-scoped like
  every Phase 1 endpoint.
- Room lifecycle tied to `interview_sessions`: room created on session start,
  torn down on complete; session-linked recording via the existing egress
  path (Task 4) to R2.

## 4. Data flow

**Track A:**
candidate joins → agent dispatched → speaks opening question → VAD detects
speech → STT → text to `conductTurn(session)` → AI reply → TTS streams back
(barge-in supported) → transcript + frames recorded → on complete, the Phase 1
scoring/report path runs unchanged.

**Track B:**
recruiter + candidate join → muted agent subscribes → dual transcripts with
speaker labels accumulate → interview ends → Q&A extraction → analysis stack →
report appears in the unified panel next to the human-scheduled row.

## 5. Consent

Phase 1's consent rule carries over unchanged: explicit consent before any
media capture; backend blocks frame capture when consent is missing or
withdrawn; text remains usable.

- **Track A:** candidate consents on the session page (existing flow).
- **Track B:** candidate consents on the session page; the recruiter consents
  by enabling the AI observer when starting the interview (explicit toggle,
  default off). The candidate is told the AI observer is present before
  joining. Withdrawing consent stops capture mid-interview; the human call
  itself continues.

## 6. Error handling (degrade, never dead-end)

- Agent dispatch failure → silent fallback to Phase 1 HTTP turns (Track A).
  The candidate gets the working turn-based interview, never an error page.
- STT garbage → agent asks for a repeat, like a human would.
- TTS outage → browser speech-synthesis fallback (already in
  `useInterviewerAudio` from Phase 1).
- LiveKit quota hit (hard cap) → clean "voice unavailable right now, continue
  in text mode."
- Track B observer crash → the human call continues; analysis is marked
  partial, re-runnable from the recording.

## 7. Testing

- Unit: token endpoint (auth, company scoping, TTL), dispatch logic with
  mocked LiveKit API, Q&A extraction on fixture transcripts.
- Agent pipeline: tested against a dev LiveKit Cloud project (separate from
  the staging project).
- Staging E2E: real voice call for Track A (transcript accuracy, barge-in,
  fallback kill-switch by blocking dispatch); Track B with two test users
  (speaker labels correct, report generated).
- Human-ear QA: Sumanth's device for Track A call quality/latency — latency
  and voice naturalness are judgments, not assertions.

## 8. Costs

$0. Build-tier quotas cover build + staging + early use. Inference rides on
existing keys. The quota dashboard is the tripwire: approaching the free
limits triggers a conversation about the $50 Ship tier — never before, never
automatically.

## 9. Risks

- **LiveKit agent framework churn.** The agents SDK is evolving fast (1.0
  redesign retired old patterns). Pin versions; keep the agent worker thin so
  SDK upgrades are contained.
- **STT accuracy on accented/domain speech.** Whisper is strong here, but
  interview jargon + accents is the failure mode to watch in QA. Mitigation:
  the transcript is shown live so the candidate can correct course, and the
  engine is tolerant of imperfect transcripts (it already is in Phase 1).
- **Barge-in false triggers.** VAD tuning is empirical. Start conservative
  (slight delay before yielding), tune from real calls.
- **Two humans + observer bandwidth.** 3 participants × video is fine inside
  the free tier, but Track B sessions should default to audio-first with video
  optional to protect the quota.

## 10. Out of scope

- Phase 3 avatar rendering (#324).
- SIP telephony / phone-call interviews.
- The recruiter-side "AI co-pilot whispering hints live" — the observer
  analyzes after (or on demand), not in real time. A live co-pilot is a
  separate feature with its own latency budget.
- Rebuilding scoring: the engine and analysis stack are reused as-is.

## 11. Acceptance criteria

- [ ] Candidate completes a Track A voice interview: barge-in works,
      transcript + frames + report match Phase 1 quality.
- [ ] Track A falls back to HTTP turns when dispatch is blocked (tested by
      blocking dispatch).
- [ ] Track B: two humans talk, observer transcribes with correct speaker
      labels, report appears in the unified panel.
- [ ] Token endpoint is company-scoped; cross-company token mint fails.
- [ ] Consent: no capture before explicit consent on either track;
      withdrawal stops capture without killing the call.
- [ ] Staging E2E green; $0 spend confirmed (quota dashboard checked).
