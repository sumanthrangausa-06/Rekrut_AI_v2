# Rekrut AI v2 — SDLC Documentation Index

**Project:** Rekrut AI v2
**SDLC Framework:** smart-sdlc + agentic-sdlc-handbook
**Started:** 2026-10-10

> **Structure rule:** One feature = one directory per phase.
> Project-level docs (relearn, shared research) live at the phase root.
> Feature-specific docs live in `<phase>/<feature-name>/`.

---

## Project-Level Documentation

| Document | Description | Status |
|----------|-------------|--------|
| `00-relearn/project-knowledge-base.md` | 5-step codebase relearn output | ✅ Complete |
| `01-analysis/technical-research-integrity.md` | Integrity research (Q1-Q9, papers 2022-2026) | ✅ Complete |
| `01-analysis/architecture-verification.md` | Codebase verification + AI Observer design | ✅ Complete |

---

## Features

### unified-interview-engine

**Status:** Phase 3 (Solutioning) — In Progress
**PRD:** ✅ Approved v2.1 (2026-10-10)

| Phase | Document | Status |
|-------|----------|--------|
| 02-planning | `prd.md` | ✅ Approved v2.1 |
| 02-planning | `prd-context.md` | ✅ Complete |
| 03-solutioning | `architecture.md` | 🔄 In Progress (Sections 1-4 done) |
| 04-implementation | — | ⏳ Pending |
| 05-quality | — | ⏳ Pending |
| 06-release | — | ⏳ Pending |
| 07-maintenance | — | ⏳ Pending |

---

## Decisions Log

| Date | Decision | Made By |
|------|----------|---------|
| 2026-10-10 | Voice deception detection is OUT — science discredited, ship stress meter only | Research findings |
| 2026-10-10 | No autonomous cheating verdicts — human review mandatory | Research findings |
| 2026-10-10 | Build on MediaPipe/TF.js primitives, don't adopt demo repos | Research findings |
| 2026-10-10 | Unified engine with mode-specific configs (mock/screening/ai-interview/human) | Sumanth |
| 2026-10-10 | One feature = one directory per phase (doc structure rule) | Sumanth |
| 2026-10-10 | PRD v2.1 approved — 55 FRs, 10 CRs, 8 NFRs | Sumanth |
| 2026-10-10 | Screen-flash test approved (passive deepfake detection) | Sumanth |
| 2026-10-10 | AI Screening: no formal report, qualitative feedback OK | Sumanth |
| 2026-10-10 | Consent decline → human interview option, recruiter decides | Sumanth |
| 2026-10-10 | Modular monolith + client-side intelligence (architecture pattern) | Sumanth |
| 2026-10-10 | ADR-001: Scaling to 10K documented, build for 100 now | Sumanth |
