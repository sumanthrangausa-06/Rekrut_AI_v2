# PRD — M8: Interviews — Session Engine

**State (verified, Scout §2): WORKS — the unified core.** **Surfaces:** `server/routes/interview-sessions-v2.js`, `session-lifecycle.js`, `routes/interview-sessions.js`, `interview-events.js`, `interviews-unified.js` · client: book-interview, session-room, panel-room.

## 1. Purpose & users
One session engine for every interview mode (mock, AI screening, AI interview, human) — Sumanth's unified-engine vision, Phase 0–1 delivered. Users: candidates, recruiters, panel members; M9/M10/M11 are its consumers.

## 2. End-to-end journey
Create session (any mode, mode-specific config) → lifecycle state machine transitions (S-003) → room runs (M9/M10 surfaces) → completion → report surfaces (M10/M11). Mount order in `server.js:659-676` is load-bearing: sessions router first, lifecycle, human-requests, unified, events, with quick-practice isolated before the legacy interviews router.

## 3. Current state (verified)
Session creation (S-001 v2), lifecycle, and human-interview requests (S-012) are live. Legacy writes into the old model return 410 (S-074). The engine is the most-tested part of the platform (Sprint 9–11 suites).

## 4. Gap to launch-ready
No functional gap identified for launch. The risks are regression risks: the mount-order sensitivity and the legacy router's remaining read paths must survive Sprint 11's M6 edits untouched in behaviour.

## 5. Functional requirements
- FR-M08-1: Session state transitions occur only through the lifecycle service/routes — no module writes session status directly (the M10/M11 consumers comply today; new consumers must too).
- FR-M08-2: Mount order in `server.js` is a reviewed invariant: any change to the `:659-676` block requires a mount-order regression run (the pre-existing `interview-mount-order` harness failure on clean `dev` must be resolved or formally baselined before launch QA — it currently fails identically on clean dev and is carried as "pre-existing").
- FR-M08-3: Session payloads follow the S-087 projection rules (list = projections; full data only via the gated single-session read).

## 6. Non-functional
- Reliability: the engine is on every interview path; changes require the observer/session regression families green (mocked suites) plus staging QA at promotion.
- Responsive: booking + session-room entry must work on phone/tablet/laptop (the room itself is M10's surface).

## 7. Dependencies (verified states)
M10 rooms (exist) · M11 worker/report consumers (exist) · M6 booking hand-off (exists).

## 8. Sprint 11 overlap
None direct; Sprint 11 touches M6 files adjacent to session creation paths — regression family named above is the guard.

## 9. ⚠ Unverified
Real-DB behaviour of the lifecycle under concurrency (impossible from this VM); the mount-order harness failure's root cause (carried as pre-existing without one).

## 10. ▣ DECISIONS FOR SUMANTH
- None.
