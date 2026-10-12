---
project: Unified Interview Engine
phase: 4-Implementation
sprint: 9
status: draft
created: 2026-10-12
owner: Sumanth
lead: Lead (Team Lead, smart-sdlc Phase 4)
capacity_points: 20
committed_points: 6
---

# Sprint 9 Plan — AI Observer Spec + Threat-Intel Spec

> **Status:** Draft | **Lead:** Lead | **Phase Gate:** Requires Sumanth's approval before work starts.
> **Method:** smart-sdlc `sprint-planning` + `writing-plans`. Backlog: `docs/sdlc/rekrut-ai-v2/03-solutioning/unified-interview-engine/epics-stories.md`.
> **Sprint 8 retro:** 2/3 engineering delivered (S-079 ownership-transfer fix via PR #770, S-078 erasure MEDIUM tables via PR #771). S-068 engineering complete (script via PR #738, 20/20 tests, privacy-reviewed, Rex confirmed deletion-only) — live deletion run deferred to pre-launch per Sumanth (test data, not active exposure). **Process wins:** (1) Sumanth asked "was Rex informed?" on S-077 → Rex briefed → caught missing DB CHECK migration (headline fix was non-functional). (2) Same question on S-078 → Rex approved with no changes. Post-implementation Rex review is now standard. (3) Sumanth redirected "give me suggestions" to personas directly — Rex delivered role model recommendations (#766), Lead delivered #721 deferral recommendation. Personas speak to Sumanth, not through Suga.
> **Issue-number verification:** All story→issue mappings below verified via `gh issue view` title check on 2026-10-12. No trust-from-memory.
> **Sumanth's decisions carried forward:** (1) #336 P0 mint path already fixed (Oct 6) — rogue test accounts (205/206) deferred to pre-launch. (2) #766 role model — Rex's recommendations delivered, Sumanth hasn't decided yet. NOT in this sprint. (3) #721/#739 R2 cleanup — deferred to pre-launch track.

---

## Sprint Goal

**Unblock the AI Observer epic: deliver the E-008 implementation spec (#761) and the threat-intel spec (#764). Both are Rex-owned spec deliverables that gate downstream implementation.**

---

## Stories in Scope

| ID | Title | Issue | Epic | Points | Priority | Dependencies |
|----|-------|-------|------|--------|----------|--------------|
| S-080 | E-008 AI Observer worker implementation spec | #761 | E-008 | 3 | P1 — gates 4 implementation stories (#694–#697); overdue since Sprint 7 | Requires architecture.md §3.19, S-070/S-071/S-072 contracts |
| S-081 | Threat-intel checks spec for applicant fraud detection | #764 | — | 3 | P2 — from Aperture competitive analysis; implementation → Sprint 10+ | None (greenfield spec) |

**Total committed:** 6 / 20 points.

**Points notes:**
- S-080 at 3pts: ~1 week to draft per issue estimate. Foundation ~60% built (architecture, schemas, S-070/S-071/S-072 contracts). Must define: worker runtime (claim/heartbeat/stale-claim), analysis/integrity_summary JSONB schemas, LiveKit agent wiring, S-070 consent gate + S-071 report state integration, erasure wiring from day one, retention interplay with S-077's registry, test strategy.
- S-081 at 3pts: greenfield spec. Must define: integration points (screening/interview flow), data sources, privacy boundaries. Privacy-engineer reviews data-source legality in parallel.

### Dependency Chain

```
S-080 (#761 E-008 spec) ── unblocks S-046 (#694), S-047 (#695), S-048 (#696), S-049 (#697)
S-081 (#764 threat-intel spec) ── unblocks future implementation (Sprint 10+)
```

**Sequencing:** Both are Rex-owned and independent — can proceed in parallel. S-080 is higher priority (overdue, gates 4 stories).

### Nova Capacity (Held)

Nova has no committed implementation stories this sprint. The E-008 implementation stories (#694–#697) are blocked on S-080. Once Sumanth approves the #761 spec, Nova can start S-046 in the same sprint if capacity allows, or it becomes Sprint 10's lead story.

---

## Architectural Review (Pre-Sprint)

Per Sumanth's standing rule, Rex reviews architectural changes before sprint planning finalizes. **Both Sprint 9 stories ARE Rex's deliverables** — he is the architect producing the specs, not reviewing someone else's. No separate pre-sprint review needed.

Post-implementation Rex review will apply to whatever Nova builds from these specs in Sprint 10+.

---

## Specialist Plan

| Story | Planned specialist | Why |
|-------|-------------------|-----|
| S-080 | `gensecai/privacy-engineer` | Erasure wiring from day one (AC: ai_observer_reports erasure path); biometric data handling in observer context |
| S-081 | `gensecai/privacy-engineer` | Data-source legality for threat-intel inputs (open-source intel, synthetic identity DBs) |

Rex makes the final specialist decision per the rule (planned ≠ forced). Tight briefs required.

---

## Blocked / Deferred (Explicit)

| Item | Issue | Status | Unblocks |
|------|-------|--------|----------|
| Employer vs recruiter role model | #766 | **Blocked on Sumanth** — Rex's recommendations delivered, no decision yet | Sumanth's call on: strip recruiter powers? retire `employer`? |
| E-008 implementation stories | #694–#697 | **Blocked on S-080** — need #761 spec first | Rex spec → Sumanth approval → Nova implementation |
| Threat-intel implementation | #764 | **Blocked on S-081** — need spec first | Rex spec + privacy-engineer review → Sprint 10+ |
| R2 plaintext frame cleanup | #721, #739 | **Deferred to pre-launch** per Sumanth (2026-10-12) | Pre-launch checklist |
| #336 account cleanup (205/206) | — | **Deferred to pre-launch** per Sumanth (2026-10-11) | Pre-launch checklist |

---

## Out of Scope (Explicit)

- #766 role model implementation — blocked on Sumanth's decision, platform track
- E-008 implementation (#694–#697) — blocked on #761 spec (may start late-sprint if spec approved early)
- #764 threat-intel implementation — needs spec first (Sprint 10+)
- Counsel items (DPIA, BIPA public policy text) — separate legal track
- Pre-launch cleanup items (#721, #739, #336 accounts, #151) — pre-launch track, not sprint work

---

## Risks

| Risk | Mitigation |
|------|------------|
| #761 spec overdue twice (Sprint 7, Sprint 8) | Explicitly committed as Sprint 9's lead story; Sumanth visibility |
| Rex is bottleneck for both stories | Both are spec-only (no Nova dependency); can parallelize |
| S-080 scope creep (worker + LiveKit + erasure + retention) | ACs are bounded in #761; Rex timeboxes to ~1 week |
| #764 data sources have legal risk | Privacy-engineer reviews in parallel with spec drafting, not after |
| Nova idle if specs slip | Nova can pick up E-008 implementation mid-sprint if #761 approved early |

---

## Definition of Done (Sprint)

- [ ] S-080 E-008 spec drafted by Rex, reviewed by privacy-engineer, delivered to Sumanth for approval (#761)
- [ ] S-081 threat-intel spec drafted by Rex, data-source legality reviewed by privacy-engineer (#764)
- [ ] Sumanth approves both specs (or provides redirect)
- [ ] #694–#697 unblocked for Sprint 10 planning (pending Sumanth's spec approval)
- [ ] No open P0/P1 regressions
