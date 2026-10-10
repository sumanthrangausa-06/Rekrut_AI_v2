# Unified Interview Engine — SDLC Documentation Index

**Project:** Rekrut AI v2 — Unified Interview Engine
**Started:** 2026-10-10
**Status:** Phase 1 (Analysis) — In Progress
**SDLC Framework:** smart-sdlc + agentic-sdlc-handbook

---

## Phase 1 — Analysis

| Document | Description | Status |
|----------|-------------|--------|
| `01-analysis/technical-research-integrity.md` | Research papers on anti-cheat/integrity (7 questions, papers 2022-2026) | ✅ Complete |
| `01-analysis/aperture-competitive-analysis.md` | Aperture HQ UI/UX research + takeaways | ✅ Complete |
| `01-analysis/architecture-verification.md` | Codebase verification (file sizes, hook usage, fragmentation) | ✅ Complete |
| `01-analysis/failure-mode-analysis.md` | System design failure modes (critical/serious/integrity/scale) | ✅ Complete |

## Phase 2 — Planning (Not Started)

| Document | Description | Status |
|----------|-------------|--------|
| `02-planning/prd-unified-interview-engine.md` | Product Requirements Document | ⏳ Pending |
| `02-planning/stakeholder-questions.md` | Open questions for Sumanth | ⏳ Pending |

## Phase 3 — Solutioning (Not Started)

| Document | Description | Status |
|----------|-------------|--------|
| `03-solutioning/architecture.md` | Technical architecture spec | ⏳ Pending |
| `03-solutioning/epics-stories.md` | Epics and user stories breakdown | ⏳ Pending |

## Decisions Log

| Date | Decision | Made By |
|------|----------|---------|
| 2026-10-10 | Voice deception detection is OUT — science discredited, ship stress meter only | Research findings |
| 2026-10-10 | No autonomous cheating verdicts — human review mandatory | Research findings |
| 2026-10-10 | Build on MediaPipe/TF.js primitives, don't adopt demo repos | Research findings |
| 2026-10-10 | Unified engine with mode-specific configs (mock/screening/ai-interview/human) | Sumanth approved direction |

## Open Questions (for Sumanth)

1. Candidate report: scores or qualitative feedback only?
2. False positive tolerance: aggressive or conservative?
3. Challenge frequency: every 5 min, only when suspicious, or never mid-answer?
4. Data retention: how long to keep integrity evidence?
5. Budget for anti-cheat: still $0 hard limit?
6. Approve unified engine architecture?
