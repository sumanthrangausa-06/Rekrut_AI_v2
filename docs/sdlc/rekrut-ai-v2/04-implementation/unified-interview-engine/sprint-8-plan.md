---
project: Unified Interview Engine
phase: 4-Implementation
sprint: 8
status: draft
created: 2026-10-11
owner: Sumanth
lead: Lead (Team Lead, smart-sdlc Phase 4)
capacity_points: 20
committed_points: 8
---

# Sprint 8 Plan — Erasure Completion + Frame Cleanup + Security Fix

> **Status:** Draft | **Lead:** Lead | **Phase Gate:** Requires Sumanth's approval before Nova starts building.
> **Method:** smart-sdlc `sprint-planning` + `writing-plans`. Backlog: `docs/sdlc/rekrut-ai-v2/03-solutioning/unified-interview-engine/epics-stories.md`.
> **Sprint 7 retro:** 2/2 delivered (S-076 erasure resume/profile family via PR #765, S-077 retention lifecycle via PR #767). **Major findings:** S-076's privacy review caught 7 missed tables (gov IDs, verification docs), a crash-safety gap (fixed with persistent ledger), and audit granularity issues. S-077's privacy review caught 4 bugs including a silent audit no-op; Rex's post-implementation review then caught a missing DB CHECK constraint migration (the headline fix was non-functional as committed — tests mocked the DB layer). **Process win:** Sumanth asked "was Rex informed?" → Rex briefed post-implementation → blocker found. This is now standard: Rex reviews post-implementation architectural changes, not just pre-sprint.
> **Issue-number verification:** All story→issue mappings below verified via `gh issue view` title check on 2026-10-11. No trust-from-memory.
> **Sumanth's decisions carried forward:** (1) #336 P0 mint path already fixed (Oct 6 commit) — rogue test accounts (205/206) deferred to pre-launch cleanup per Sumanth. (2) #766 role model — Rex's recommendations delivered, Sumanth hasn't decided yet. NOT in this sprint.

---

## Sprint Goal

**Finish the erasure story: complete the MEDIUM-table erasure (#756), clean up legacy plaintext frames (S-068), and fix the ownership-transfer privilege escalation (#768).**

---

## Stories in Scope

| ID | Title | Issue | Epic | Points | Priority | Dependencies |
|----|-------|-------|------|--------|----------|--------------|
| S-078 | Erasure completeness — MEDIUM tables (messages, sessions, transcripts, user_memory, match_results, scores) | #756 | E-002 | 3 | P1 — Art. 17 gap; HIGH tables done in S-076 | Requires S-076 ✅ (merged) |
| S-068 | Cleanup sweep for legacy plaintext frames in R2 | #721 | E-002 | 3 | P1 — crypto-shredding guarantee doesn't cover pre-S-059 frames | Requires S-059 ✅ (merged) |
| S-079 | Fix ownership-transfer privilege escalation | #768 | — | 2 | P2 — not P0 but wrong privilege escalation | None |

**Total committed:** 8 / 20 points (12pt buffer — S-068 involves live R2 operations; #768 is platform code Nova hasn't touched).

**Points notes:**
- S-078 at 3pts (not 5): extends S-076's established `erasureService` pattern and two-phase deletion design. Smaller table set, no new storage helpers needed. The pattern is proven.
- S-068 at 3pts: script to identify plaintext `.jpg` frames under `frames/` prefix, then delete or re-encrypt with candidate DEK. R2 list + delete operations need care (destructive — Sumanth's explicit approval per deletion-scope rules).
- S-079 at 2pts: one-line fix (`routes/company.js:1308` — demote to `recruiter` instead of `admin`) + tests. Small but security-relevant.

### Dependency Chain

```
S-078 (#756 MEDIUM) ── requires S-076 ✅ ── reuses erasureService + deleteFile
S-068 (#721 frames) ── requires S-059 ✅ ── independent of S-078
S-079 (#768 xfer fix) ── independent ── small, can go first
```

**Sequencing:** S-079 first (small, unblocks nothing but quick win). S-078 second (builds on S-076 momentum). S-068 third (R2 operations need Sumanth's deletion approval — gate this explicitly).

### Parallel Tracks (Not Nova Capacity)

| Item | Issue | Owner | Gate |
|------|-------|-------|------|
| E-008 AI Observer spec | #761 | Rex | Draft overdue (was Sprint 7 week-1). Needs Sumanth review. |
| Threat-intel spec | #764 | Rex | Spec first (architectural prerequisite). Privacy-engineer reviews data-source legality. Implementation → Sprint 9+. |

**#761 status:** 0 comments as of 2026-10-11. Rex has not posted a draft. This is now overdue — flagged for Sumanth's attention.

---

## Architectural Review (Pre-Sprint — Process Fix)

Per Sumanth's standing rule, Rex reviews architectural changes before sprint planning finalizes.

### S-078 (#756 MEDIUM) — Expected: APPROVE
Extends S-076's proven pattern (`erasureService.erasePersonalData()` + two-phase deletion). No new architectural decisions. Privacy-engineer should confirm table completeness (same risk as S-076's 7 missed tables).

### S-068 (#721) — Needs Rex Review
The delete-vs-re-encrypt decision is architectural: if candidate-DEK mapping is recoverable for a frame, re-encrypt; otherwise delete. Rex should confirm the approach before Nova builds. Also: this touches live R2 objects — Sumanth's deletion-scope approval required.

### S-079 (#768) — Expected: APPROVE
One-line change. But note the interaction with #766: if Sumanth later approves Rex's "retire `employer`" recommendation, the demotion target may need revisiting. For now, `recruiter` is the safe choice.

### #764 Threat-Intel — Spec Required (Not In-Sprint)
Rex must spec the integration points (screening/interview flow), data sources, and privacy boundaries before any implementation planning. Privacy-engineer reviews data-source legality in parallel.

---

## Specialist Plan

| Story | Planned specialist | Why |
|-------|-------------------|-----|
| S-078 | `gensecai/privacy-engineer` | Art. 17 completeness — S-076's review caught 7 missed tables; same risk domain |
| S-068 | `gensecai/privacy-engineer` | Crypto-shredding guarantee scope; plaintext PII handling |
| S-079 | `ecc/security-reviewer` | Privilege escalation fix verification |
| #764 (spec) | `gensecai/privacy-engineer` | Data-source legality for threat-intel inputs |

Nova makes the final specialist decision at STOP 1 per the rule (planned ≠ forced). Tight briefs required.

---

## Blocked / Deferred (Explicit)

| Item | Issue | Status | Unblocks |
|------|-------|--------|----------|
| Employer vs recruiter role model | #766 | **Blocked on Sumanth** — Rex's recommendations delivered, no decision yet | Sumanth's call on: strip recruiter powers? retire `employer`? |
| Threat-intel implementation | #764 | **Blocked on Rex spec** — architectural prerequisite | Rex spec + privacy-engineer data-source review |
| E-008 spec draft | #761 | **Overdue** — 0 comments, was due Sprint 7 week 1 | Rex draft → Sumanth approval → S-080+ implementation |
| #336 account cleanup | — | **Deferred to pre-launch** per Sumanth (2026-10-11) | Pre-launch checklist |

---

## Out of Scope (Explicit)

- #766 role model implementation — blocked on Sumanth's decision, platform track
- #764 threat-intel implementation — needs Rex spec first (Sprint 9+)
- Counsel items (DPIA, BIPA public policy text) — separate legal track
- Actual R2/B2 storage deletion in S-068 requires Sumanth's explicit approval per deletion-scope rules (dry-run/identify first)
- E-008 implementation stories (#694–#697) — blocked on #761 spec

---

## Risks

| Risk | Mitigation |
|------|------------|
| S-068 touches live R2 objects | Identify-first (AC-1), Sumanth approves deletion scope before AC-2 runs |
| #768 is platform code (company.js) Nova hasn't touched | Small diff, security-reviewer validates; blast-radius check at STOP 1 |
| #761 spec still missing | Flagged as overdue; Sumanth may need to nudge Rex |
| S-078 misses tables again | Privacy-engineer review at STOP 1 explicitly asks "what tables did we miss?" (S-076 lesson) |
| Rex pre-sprint review adds scope | Reviews are scheduled before Nova starts; scope changes go through Sumanth |

---

## Definition of Done (Sprint)

- [ ] S-079 merged to `dev` (PR, tests passing, security-reviewer review, Suga review, Sumanth merge approval)
- [ ] S-078 merged to `dev` (PR, tests passing, privacy-engineer review, Suga review, Sumanth merge approval)
- [ ] S-068 merged to `dev` (PR, tests passing, privacy-engineer review, Rex pre-review, Suga review, Sumanth merge approval + deletion scope approval)
- [ ] #761 E-008 spec draft delivered to Sumanth (Rex)
- [ ] #764 threat-intel spec drafted (Rex)
- [ ] No open P0/P1 regressions
