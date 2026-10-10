# Architecture Verification — Unified Interview Engine

**Date:** 2026-10-10
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
| `client/src/pages/candidate/interview-practice.tsx` | ? | ? | Not yet verified |
| `client/src/pages/candidate/interview-active-layout.tsx` | ? | ? | Not yet verified |

**Shared hooks (already exist):**
- `useInterviewCamera.ts` — Camera lifecycle management
- `useInterviewerAudio.ts` — AI voice playback
- `useSpeechRecognition.ts` — Speech-to-text

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

---

## Revised Migration Order

Based on verification (not theory):

| Phase | Action | Rationale |
|-------|--------|-----------|
| 1 | Migrate `ai-screening.tsx` to shared hooks | Quick win, eliminates fragmentation |
| 2 | Extract engine from `mock-interview.tsx` | Reference implementation, validate identical behavior |
| 3 | Migrate `InterviewSession.tsx` to engine | Fixes video bug + voice auto as part of migration |
| 4 | Add integrity + behavioral layers | New capability, builds on stable engine |

---

## Blast Radius

**Files that will be affected:**
- `client/src/pages/candidate/mock-interview.tsx` (will become thin wrapper)
- `client/src/pages/candidate/InterviewSession.tsx` (will become thin wrapper)
- `client/src/pages/candidate/ai-screening.tsx` (migrate to hooks, then to engine)
- `client/src/pages/candidate/voice-screening.tsx` (likely deprecated)
- `client/src/hooks/useInterviewCamera.ts` (may need callback ref fix)
- New: `client/src/engine/interview/` (entire new module)

**Backend (to verify):**
- Interview session API routes
- Report generation endpoints
- Need to check: `server/routes/interviews.js` (or equivalent)

---

## Verification Method

Per Sumanth's hard rule ("verify before theorizing"):
- ✅ Read actual files (not from memory)
- ✅ Counted lines with `wc -l`
- ✅ Checked hook usage with `grep`
- ✅ Used `codebase-memory` for architecture overview
- ❌ Did NOT yet verify backend routes (pending)
- ❌ Did NOT yet verify report components (pending)
