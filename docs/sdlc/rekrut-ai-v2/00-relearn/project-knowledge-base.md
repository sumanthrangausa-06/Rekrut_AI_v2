# Phase 0 Relearn — Project Knowledge Base

**Project:** Rekrut AI v2
**Date:** 2026-10-10
**Workflow:** `smart-sdlc/0-relearn/relearn-codebase` (Steps 01–05)
**Status:** ✅ Complete

---

## 1. Scan Summary (Step 01)

| Attribute | Value |
|-----------|-------|
| Shape | Modular Monolith |
| Language | TypeScript (251 files) + JavaScript (138 files) |
| Frontend | React 19 + Vite + Tailwind CSS |
| Backend | Express.js (Node ≥22) |
| Database | PostgreSQL (Neon) — 105 tables, 50+ migrations |
| Real-time | LiveKit (video/audio rooms, AI voice agents) |
| Test | Jest (server) + Vitest (client) + Playwright (E2E) — 129 test files |
| CI/CD | GitHub Actions → Render |
| Entry points | `server.js` (backend), `client/src/main.tsx` (frontend) |

## 2. Architecture (Step 02)

**Layers:**
- Presentation/API: `routes/` (60+ files), `server/routes/`
- Business Logic: `server/services/`, `services/`, `agents/`
- Data Access: `lib/db.js` (pg pool), `migrations/`
- Shared: `lib/`, `client/src/hooks/`, `client/src/lib/`

**Communication:** REST API (Express) + WebSockets (LiveKit). No GraphQL, no message queue.

**Interview domain components:**
- `routes/interviews.js`, `routes/ai-screener.js` — API handlers (mount order is fragile)
- `mock-interview.tsx` (1295 lines), `InterviewSession.tsx` (1226 lines) — use shared hooks
- `ai-screening.tsx` (734 lines) — does NOT use shared hooks (fragmentation)
- `useInterviewCamera`, `useInterviewerAudio`, `useSpeechRecognition` — shared hooks
- `server/routes/livekit.js`, `server/services/livekit.js` — room management with identity prefixes

**AI Observer (new):** LiveKit bot with `ai-observer-{sessionId}` identity. Role differentiation via identity prefix (`candidate-`, `interviewer-`) + room metadata.

## 3. Data Model (Step 03)

**Core interview tables:**
- `interview_sessions` — unified (type: screening/ai-interview/mock/human; config JSONB; conversation JSONB)
- `interview_recordings` → `interview_transcripts` (speaker_identity exists)
- `interview_evaluations` — human interviewer feedback
- `interview_analysis` — legacy, references old `interviews` table
- `interview_rooms` — LiveKit room mapping
- `interview_flows` — recruiter-defined screening/AI-interview configurations

**Gaps (to fill in Phase 3):**
1. `integrity_events` — NEW (flag timeline)
2. `behavioral_signals` — NEW (per-turn behavioral analysis)
3. `interview_analysis` — MIGRATE (old table references)
4. `ai_observer_reports` — NEW (human interview AI analysis)
5. `config` JSONB — ADD Zod validation per mode

## 4. Patterns (Step 04)

**Naming:** camelCase (vars), kebab-case (files/routes), snake_case (DB), UPPER_SNAKE (constants)

**Migrations:** Numbered (`138_`), module exports with `name` + `up`, `IF NOT EXISTS` everywhere, non-destructive (old tables kept), header comments with issue numbers.

**Error handling:** Non-blocking try/catch for auxiliary systems. Core flow continues.

**Logging:** `console.*` with `[prefix]` tags. No structured logging. PII risk — avoid logging transcripts.

**Testing:** Jest (server) + Vitest (client) + Playwright (E2E).

**DI:** None. Direct `require()` imports, singleton modules.

## 5. Key Decisions for Unified Engine

| Decision | Rationale |
|----------|-----------|
| Extract engine from mock-interview.tsx | It's the working reference implementation |
| Migrate ai-screening.tsx to shared hooks first | It's the fragmented one |
| New tables follow existing migration pattern | Consistency, idempotent, non-destructive |
| Zod validation for config JSONB | Type safety without DB migration |
| AI Observer as LiveKit bot | Reuses existing LiveKit infra |
| Identity prefix for role detection | Already established pattern in codebase |

---

**Next:** Phase 1 (Analysis) → Phase 2 (Planning: PRD)
