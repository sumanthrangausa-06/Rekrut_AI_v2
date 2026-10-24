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
| `00-relearn/data/` | **Data documentation pack** — [index](00-relearn/data/README.md): data model, as-is schema, migrations, access-control (RLS) truth, seed data (Scout/Rex/Quinn, 2026-10-13) | 📄 At gate |
| `DESIGN.md` (repo root) | **Design system** — tokens, typography, layout/shells, components, accessibility floor, voice & honesty rules, known gaps/targets (Aria/Nova/Quinn, 2026-10-14) | ✅ Living document |
| `01-analysis/technical-research-integrity.md` | Integrity research (Q1-Q9, papers 2022-2026) | ✅ Complete |
| `01-analysis/architecture-verification.md` | Codebase verification + AI Observer design (v2) | ✅ Complete |
| `01-analysis/competitive-analysis.md` | 7 competitors, differentiation gaps (Aria) | ✅ Complete |
| `01-analysis/failure-mode-analysis.md` | 74 failure modes, 44 launch blockers (Aria) | ✅ Complete |
| `01-analysis/prd-readiness-questions.md` | 15 questions + Sumanth's decisions | ✅ Complete |
| `01-analysis/pricing-strategy-brief.md` | Hybrid pricing recommendation | ✅ Complete |
| `01-analysis/whole-app-compliance-blueprint.md` | USA/EU/India, 26 items, 10 legal questions | ✅ Complete |
| `01-analysis/integrity-mitigation-brief.md` | 8 recommendations + operational playbook | ✅ Complete |
| `00-relearn/project-knowledge-base-2026-10-13-full-application.md` | Full-application relearn: 22 modules, issue reconciliation, reverse ADRs (Scout) | ✅ Complete |
| `02-planning/full-application/` | Whole-application overview + 23 module PRDs + consolidated decisions for Sumanth (Rex) | ⏳ At Sumanth's gate |

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

### sumanth-batch-2026-10-21

**Status:** Phase 2 (Planning) — PRDs written 2026-10-21 (Aria), at Suga's review gate; builds wait for these PRDs per the restored documentation-first rule.
**Source:** Nine issues Sumanth filed from his own testing 2026-10-21 (Issues3.pdf + Assessment_window_issues.pdf).

| Phase | Document | Status |
|-------|----------|--------|
| 02-planning | `02-planning/sumanth-batch-2026-10-21/prd-assessments-module.md` (#1602, #1606, #1604, #1605, #1603) | 📄 At gate |
| 02-planning | `02-planning/sumanth-batch-2026-10-21/prd-job-board-and-profile.md` (#1600, #1601, #1607, #1608) | 📄 At gate |
| 03-solutioning | Rex design: unified exit implementation + #1603 catalogue architecture | ⏳ Pending PRD approval |
| 04-implementation | — | ⏳ Pending |

**GitHub Tracking:**
- Issues: #1600–#1608 (Sumanth-filed batch; #1603 is the Assessments redesign EPIC)

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
| 2026-10-13 | Gate A ruled **B, amended**: Observer ships presence-only for a controlled cohort in January (no public consent ask, no analysis claimed); dormant audio-capture built as one complete unit after design approval; re-entry contract — counsel + design cleared by 2026-11-01 opens cohort pilot path, after 2026-12-01 nothing activates pre-launch (full ruling on #634) | Sumanth |
| 2026-10-13 | Gate A dormant-capture design package delivered for approval (Rex v2 + Quinn validation protocol + Lex consent/retention review; privacy review BLOCK on v1 cleared with conditions on v2) — `04-implementation/unified-interview-engine/gate-a-dormant-capture-design.md` | Lead |
| 2026-10-12 | Mock scores & OmniScore: practice OUT of OmniScore → separate labelled readiness panel; practice-fact marker adopted (opt-in default-off, counts/dates only); removal scheduled separately — supersedes "practice-only" posture (see KB §7; #113, #791–#793) | Sumanth |
| 2026-10-21 | Documentation-first RESTORED (re-asserts 2026-10-10): PRD before build, design before implementation, docs in the same PR; binds ALL personas (HL-006) | Sumanth |
| 2026-10-21 | User-perspective testing: acceptance criteria written as user journeys from the user's expectations; work done only when journey tests pass E2E | Sumanth |
| 2026-10-21 | Assessments exit reconciliation: ONE exit dialog, four outcomes — Continue / Save & Exit (resumable) / Submit & Exit (scored) / Exit Exam (abandoned, never scored) — PRD `02-planning/sumanth-batch-2026-10-21/prd-assessments-module.md` §6 | Aria (PRD, at gate) |
