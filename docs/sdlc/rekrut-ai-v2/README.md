# Rekrut AI v2 — SDLC Documentation Index

**Project:** Rekrut AI v2
**SDLC Framework:** smart-sdlc + agentic-sdlc-handbook
**Started:** 2026-10-10

> **Structure rule:** One feature = one directory per phase.
> Project-level docs (relearn, shared research) live at the phase root.
> Feature-specific docs live in `<phase>/<feature-name>/`.

> **Tracking rule:** The markdown spec docs are NOT the backlog. **GitHub Issues are the source of truth.**
> After `epics-stories.md` is written: one Issue per epic (`[EPIC]`), one Issue per story (`[STORY]`),
> stories linked to parent epics. See `~/AGENTS.md` for the full workflow.

> **Persona-led model:** Each SDLC persona owns their phase, picks their own specialists from
> `~/workspace/SKILL_MAP.md`. Specialists → Persona → Suga (CTO) → Sumanth (Founder approves gates).

---

## Project-Level Documentation

| Document | Description | Status |
|----------|-------------|--------|
| `00-relearn/project-knowledge-base.md` | 5-step codebase relearn output (Scout, v2) | ✅ Approved |
| `01-analysis/technical-research-integrity.md` | Integrity research (Q1-Q9, papers 2022-2026) | ✅ Complete |
| `01-analysis/architecture-verification.md` | Codebase verification + AI Observer design (v2) | ✅ Complete |
| `01-analysis/competitive-analysis.md` | 7 competitors, differentiation gaps (Aria) | ✅ Complete |
| `01-analysis/failure-mode-analysis.md` | 74 failure modes, 44 launch blockers (Aria) | ✅ Complete |
| `01-analysis/prd-readiness-questions.md` | 15 questions + Sumanth's decisions | ✅ Complete |
| `01-analysis/pricing-strategy-brief.md` | Hybrid pricing recommendation | ✅ Complete |
| `01-analysis/whole-app-compliance-blueprint.md` | USA/EU/India, 26 items, 10 legal questions | ✅ Complete |
| `01-analysis/integrity-mitigation-brief.md` | 8 recommendations + operational playbook | ✅ Complete |

---

## Features

### unified-interview-engine

**Status:** Phase 3 (Solutioning) — ✅ Complete, awaiting Sumanth's final gate approval
**PRD:** ✅ Approved v3.2 (2026-10-10) — 86 FRs, 21 CRs, 8 NFRs
**Architecture:** ✅ Approved v3 (2026-10-10) — 24 components, 19 tables, 13 ADRs
**Epics/Stories:** ✅ Complete — 9 epics, 64 stories, GitHub Issues #550–#622

| Phase | Document | Status |
|-------|----------|--------|
| 02-planning | `prd.md` | ✅ Approved v3.2 |
| 02-planning | `prd-context.md` | ✅ Complete |
| 03-solutioning | `architecture.md` | ✅ Approved v3 |
| 03-solutioning | `epics-stories.md` | ✅ Complete |
| 04-implementation | — | ⏳ Pending Sumanth's Phase 3 gate |
| 05-quality | — | ⏳ Pending |
| 06-release | — | ⏳ Pending |
| 07-maintenance | — | ⏳ Pending |

**GitHub Tracking:**
- Epics: #550–#558 (labeled `epic`, `phase-3`, `unified-interview-engine`)
- Stories: #559–#622 (labeled `story`, `phase-3`, `unified-interview-engine`)

---

## Decisions Log

| Date | Decision | Made By |
|------|----------|---------|
| 2026-10-10 | Voice deception detection is OUT — science discredited, ship stress meter only | Research findings |
| 2026-10-10 | No autonomous cheating verdicts — human review mandatory | Research findings |
| 2026-10-10 | Build on MediaPipe/TF.js primitives, don't adopt demo repos | Research findings |
| 2026-10-10 | Unified engine with mode-specific configs (mock/screening/ai-interview/human) | Sumanth |
| 2026-10-10 | One feature = one directory per phase (doc structure rule) | Sumanth |
| 2026-10-10 | Persona-led delivery model (persona → specialists → Suga → Sumanth) | Sumanth |
| 2026-10-10 | GitHub Issues are the backlog (markdown spec is reference only) | Sumanth |
| 2026-10-10 | PRD v3.2 approved — 86 FRs, 21 CRs, 8 NFRs | Sumanth |
| 2026-10-10 | Architecture v3 approved — 24 components, 19 tables, 13 ADRs | Sumanth |
| 2026-10-10 | Screen-flash test approved (passive deepfake detection) | Sumanth |
| 2026-10-10 | AI Screening: no formal report, qualitative feedback OK | Sumanth |
| 2026-10-10 | Consent decline → human interview option, recruiter decides | Sumanth |
| 2026-10-10 | Modular monolith + client-side intelligence (architecture pattern) | Sumanth |
| 2026-10-10 | ADR-001: Scaling to 10K documented, build for 100 now | Sumanth |
| 2026-10-10 | No emotion inference — observe behavior, don't label (EU AI Act) | Sumanth |
| 2026-10-10 | Judge-first workflow approved | Sumanth |
| 2026-10-10 | No single integrity score — observations only | Sumanth |
| 2026-10-10 | OmniScore visibility: no causal link shown to anyone | Sumanth |
| 2026-10-10 | Hybrid pricing approved — two-sided (recruiters pay, candidates free) | Sumanth |
| 2026-10-10 | Launch: USA + India first, Europe phase 2 | Sumanth |
| 2026-10-10 | AI Observer = recruiter's toggle (no standalone candidate consent) | Sumanth |
| 2026-10-10 | Warm-up calibration mandatory at launch | Sumanth |
| 2026-10-10 | Legal reviews consent + retention before Phase 3 | Sumanth |
