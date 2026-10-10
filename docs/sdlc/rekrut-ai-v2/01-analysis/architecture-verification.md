# Architecture Verification — Unified Interview Engine

**Date:** 2026-10-10 (updated)
**Skills:** `startup-cto`, `codebase-memory`, direct codebase inspection
**Purpose:** Verify actual codebase state before designing unified engine (per Sumanth's "verify before theorizing" rule)

---

## Verified File Inventory

| File | Lines | Uses Shared Hooks | Notes |
|------|-------|-------------------|-------|
| `client/src/pages/candidate/mock-interview.tsx` | 1,295 | ✅ Yes | Reference implementation, working |
| `client/src/pages/candidate/InterviewSession.tsx` | 1,226 | ✅ Yes | AI Interview, broken video, manual mic |
| `client/src/pages/candidate/ai-screening.tsx` | 734 | ❌ No | Separate implementation, fragmented |
| `client/src/pages/candidate/voice-screening.tsx` | 13 | N/A | Wrapper/redirect only |

**Shared hooks (already exist):**
- `useInterviewCamera.ts` — Camera lifecycle management
- `useInterviewerAudio.ts` — AI voice playback
- `useSpeechRecognition.ts` — Speech-to-text

**Backend (verified):**
- `server/routes/livekit.js` — Room management, token generation with identity prefixes (`observer-{userId}`, `user-{userId}`)
- `server/services/livekit.js` — `generateToken()`, room dispatch with metadata (`interview_session_id`, `mode`)
- `routes/interviews.js`, `routes/ai-screener.js` — Interview session API (mount order is fragile, documented in code comments)

---

## Key Findings

### Finding 1: Hooks are already shared (good news)
Mock Interview and AI Interview both use `useInterviewCamera`, `useInterviewerAudio`, `useSpeechRecognition`. The "90% duplication" from the Oct 8 audit was overstated — duplication is in **page-level logic** (turn-taking, session management, question flow), not the hooks.

### Finding 2: AI Screening is the real fragmentation (bad news)
`ai-screening.tsx` (734 lines) does NOT use shared hooks. This is the isolated implementation that needs migration first.

### Finding 3: Video bug confirmed
`InterviewSession.tsx` has two `<video>` elements sharing one `videoRef`:
- Line ~888: setup/pre-join video
- Line ~1086: active-interview video
- `useInterviewCamera.ts` line ~188 attaches stream once via `videoRef.current.srcObject`
- When UI transitions, old element unmounts, ref points to new element, stream not reattached

### Finding 4: LiveKit identity pattern already exists (good news)
`server/routes/livekit.js:329` already uses identity prefixes:
```js
identity: isObserver ? `observer-${user.id}` : `user-${user.id}`
```
This pattern extends naturally to the AI Observer design (`candidate-`, `interviewer-`, `ai-observer-`).

### Finding 5: Transcript speaker identity already exists
`interview_transcripts.speaker_identity` VARCHAR(255) already stores speaker labels. Maps directly to our identity prefix plan.

---

## New Component: AI Observer (Human Interview Mode)

### Design (approved 2026-10-10)

The AI Observer is a LiveKit bot that joins human interviews as an invisible participant.

```
Component: AI Observer Agent
  Type: LiveKit bot / Service
  Files: TO BE BUILT (server/services/ai-observer.js)
  Responsibility: Silently observe human interviews, run behavioral + integrity analysis
  Depends on: LiveKit SDK, behavioral analysis engine, integrity layer
  Exposes to: Report generator (AI analysis section)
  External deps: @livekit/agents (already in package.json)
```

### Role Differentiation

| Participant | Identity Pattern | Analysis |
|-------------|-----------------|----------|
| Candidate | `candidate-{userId}` | Full behavioral + integrity analysis |
| Human interviewer(s) | `interviewer-{userId}` | Diarization only (who's speaking) |
| AI Observer bot | `ai-observer-{sessionId}` | Ignored (itself, subscribe-only) |

**Backup:** Room metadata contains authoritative mapping:
```json
{
  "interview_session_id": 123,
  "candidate_id": 456,
  "interviewer_ids": [789],
  "mode": "human-with-ai-observer"
}
```

**Edge cases handled:**
- Panel interviews: multiple `interviewer-{userId}`, single candidate analysis target
- Wrong identity: room metadata is source of truth; mismatch logged as integrity flag
- Interviewer camera off: observer continues; notes "interviewer video off" in report
- Observer publishes no audio/video tracks (subscribe-only, invisible in UI)

### What Gets Analyzed for Whom

| Signal | Candidate | Interviewer |
|--------|-----------|-------------|
| Facial expressions | ✅ Full | ❌ No |
| Voice prosody | ✅ Full | ⚠️ Diarization only |
| Gaze patterns | ✅ Full | ❌ No |
| Integrity flags | ✅ Full | ❌ No |
| Linguistic (answers) | ✅ STAR, depth | — |
| Linguistic (questions) | — | ✅ Quality/depth/bias |

---

## Database Gaps (confirmed)

| Gap | Table | Status |
|-----|-------|--------|
| Integrity flag timeline | `integrity_events` | NEW — to be created in Phase 3 |
| Per-turn behavioral signals | `behavioral_signals` | NEW — to be created in Phase 3 |
| AI Observer reports | `ai_observer_reports` | NEW — to be created in Phase 3 |
| Unified per-question analysis | `session_analysis` | NEW — replaces legacy `interview_analysis` |
| Legacy table migration | `interview_analysis` | References old `interviews` table, not `interview_sessions` |

**Migration pattern** (from `migrations/138_interview_flows.js`):
- Numbered, module exports with `name` + `up`
- `IF NOT EXISTS` everywhere (idempotent)
- Non-destructive (old tables kept during transition)
- Header comments with issue numbers

---

## Revised Migration Order

Based on verification (not theory):

| Phase | Action | Rationale |
|-------|--------|-----------|
| 1 | Migrate `ai-screening.tsx` to shared hooks | Quick win, eliminates fragmentation |
| 2 | Extract engine from `mock-interview.tsx` | Reference implementation, validate identical behavior |
| 3 | Migrate `InterviewSession.tsx` to engine | Fixes video bug + voice auto as part of migration |
| 4 | Build AI Observer service | New capability, reuses LiveKit infra |
| 5 | Add integrity + behavioral layers | New capability, builds on stable engine |
| 6 | Build 4 new tables + compliance automation | Data layer for integrity/behavioral |

---

## Blast Radius

**Frontend (to be affected):**
- `client/src/pages/candidate/mock-interview.tsx` (will become thin wrapper)
- `client/src/pages/candidate/InterviewSession.tsx` (will become thin wrapper)
- `client/src/pages/candidate/ai-screening.tsx` (migrate to hooks, then to engine)
- `client/src/pages/candidate/voice-screening.tsx` (likely deprecated)
- `client/src/hooks/useInterviewCamera.ts` (may need callback ref fix for video bug)
- New: `client/src/engine/interview/` (entire new module)
- New: Human interview observer UI (recruiter view)

**Backend (to be affected):**
- New: `server/services/ai-observer.js` (LiveKit bot)
- New: 4 migration files (integrity_events, behavioral_signals, ai_observer_reports, session_analysis)
- Modified: `server/routes/livekit.js` (observer identity prefixes)
- New: Compliance automation (retention cron, deletion workflows)
- New: Report generation (dual reports, AI Observer section)

---

## Verification Method

Per Sumanth's hard rule ("verify before theorizing"):
- ✅ Read actual files (not from memory)
- ✅ Counted lines with `wc -l`
- ✅ Checked hook usage with `grep`
- ✅ Used `codebase-memory` for architecture overview
- ✅ Verified backend LiveKit routes and identity patterns
- ✅ Verified transcript speaker_identity column exists
- ❌ Did NOT yet verify report components (pending Phase 3)
