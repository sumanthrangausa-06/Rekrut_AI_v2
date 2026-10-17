---
project: Unified Interview Engine
phase: 4-Implementation
sprint: 7
status: draft
created: 2026-10-11
owner: Sumanth
lead: Lead (Team Lead, smart-sdlc Phase 4)
capacity_points: 20
committed_points: 10
---

# Sprint 7 Plan — Erasure + Retention (Build-Heavy)

> **Status:** Draft | **Lead:** Lead | **Phase Gate:** Requires Sumanth's approval before Nova starts building.
> **Method:** smart-sdlc `sprint-planning` + `writing-plans`. Backlog: `docs/sdlc/rekrut-ai-v2/03-solutioning/unified-interview-engine/epics-stories.md`.
> **Sprint 6 retro:** 5/5 delivered (S-074 legacy endpoint retirement, S-075 embeddings hard-delete, #746 DSAR fulfillment, #748 consent audit company_id, #743 retention design spike). All 5 PRs merged to `dev` (#754, #755, #757, #758, plus #743 design doc PR #762 pending). **Major findings:** S-075's privacy review caught the `candidate_search_index` twin-copy of embeddings (fixed in-PR) and surfaced the resume/profile erasure gap (→ #756); #743's compliance-skills review (privacy-engineer, gdpr-ccpa-compliance, compliance-auditor — 11 findings) caught the DPIA requirement, missing S-015 deletion jobs, and policy/enforcement drift. **Process:** First sprint under persona skill-toolkit regime (#748 was the pilot — Nova's STOP 1 explicitly showed ponytail ladder, scope refusal, proactive DB check). Rex pre-sprint architectural review held BEFORE planning finalized (Sumanth's process fix).
> **Issue-number verification:** All story→issue mappings below verified via `gh issue view` title check on 2026-10-11. No trust-from-memory.
> **Sumanth's approvals (2026-10-11):** (1) Retention periods: 90d recordings / 30d frames / 24mo inactive embeddings. (2) Sprint 7 implementation of #743 (~5 pts). (3) Persona skill toolkits as default from Sprint 7.

---

## Sprint Goal

**Close the erasure gaps and build the retention lifecycle: extend erasure to the resume/profile family (including plaintext R2 files), implement the purge cron with storage deletion, and get the E-008 observer spec drafted with proper tracking.**

---

## Stories in Scope

| ID | Title | Issue | Epic | Points | Priority | Dependencies |
|----|-------|-------|------|--------|----------|--------------|
| S-076 | Erasure completeness — resume/profile family (HIGH) | #759 | E-002 | 5 | P1 — active GDPR Art. 17 exposure (plaintext CV files in R2) | Requires S-075 ✅ (merged) |
| S-077 | Retention lifecycle implementation (purge cron + storage deletion) | #760 | E-002 | 5 | P1 — Art. 5(1)(e) storage limitation; Sumanth-approved | Requires #743 design ✅ (PR #762 pending merge) |

**Total committed:** 10 / 20 points (10pt buffer for a build-heavy sprint with architectural complexity).

**Points notes:**
- S-076 at 5pts (not 3): 4 HIGH tables + `cv_analyses`/`cv_reviews` (Rex's scope expansion) + new R2 `deleteFile` helper with provider routing + versioning guard + two-phase deletion design + audit entries + tests. Bigger than S-075's 3pts due to the storage-deletion dimension.
- S-077 at 5pts (Sumanth-approved estimate): registry migration + cron extension + lock-free sweep + policy single-source-of-truth refactor + dry-run rollout + tests. Rex's review refined the design (lock-free instead of locks-held-across-R2, pinned batch size).

### Dependency Chain

```
S-076 (erasure family, 5pts) ── requires S-075 ✅ ── builds shared deleteFile helper
    │
    ├── shared: lib/file-storage.js deleteFile({provider, key})
    │
S-077 (purge cron, 5pts) ── requires #743 design ✅ ── reuses deleteFile helper
```

**Sequencing:** S-076 first (builds the shared storage-deletion helper; higher compliance urgency — plaintext PII in R2). S-077 second (reuses the helper; cron is the future reconciliation backstop for S-076 post-commit failures).

### Parallel Track: E-008 Observer Spec

| Item | Issue | Owner | Gate |
|------|-------|-------|------|
| E-008 implementation spec | #761 | Rex | Week-1 draft checkpoint → Sumanth approval |

**Not in-sprint** (consumes Rex's time, not Nova's build capacity). Sprint 6's parallel track leaked (no draft, no checkpoint) — this time with full issue hygiene: real issue (#761) + ACs + dated week-1 checkpoint + Sumanth approval gate. ~1 week to draft.

### Why These Two

Sprint 6 was spike-heavy by design (Sumanth's directive: Sprint 7 must be build-heavy). Both stories are Sumanth-approved builds addressing active GDPR exposure:
- S-076: plaintext resume/CV files surviving deletion in R2 — the Art. 17 gap S-075's review surfaced
- S-077: recordings/frames with zero lifecycle — the Art. 5(1)(e) gap #743's compliance review reframed as active exposure

---

## Architectural Review (Pre-Sprint — Process Fix)

Rex reviewed both stories BEFORE planning finalized. Verdicts:

### S-076 (#759) — APPROVE WITH CHANGES
1. **Two-phase deletion required:** DB in-tx (`DELETE ... RETURNING file_url`) → COMMIT → post-commit R2 deletes with retry. R2 deletion NEVER inside the pg transaction (distributed-transaction failure mode).
2. **New `deleteFile` helper:** `lib/file-storage.js` has no delete API. Must handle provider routing (URL encodes R2 vs B2), bucket versioning guard, key dedupe.
3. **Scope expanded:** `cv_analyses` + `cv_reviews` pulled in (SET NULL FKs leave derived PII).
4. **`ai_observer_reports`:** documented exclusion (table doesn't exist yet); E-008 forward requirement filed.

### S-077 (#760) — APPROVE WITH CHANGES
1. Registry approach confirmed; compliance review strengthened requirements.
2. Design doc merges to dev separately (PR #762) — not bundled with implementation.
3. Lock-free idempotent sweep (not locks-held-across-R2); batch size 100; `expires_at` semantics resolved in spec.
4. **Shared helper:** one common R2/B2 deletion helper serves both stories.

### E-008 — APPROVE WITH CHANGES (shape change)
Parallel workstream kept, but tracked: issue #761 + ACs + week-1 checkpoint + Sumanth approval gate.

**No blockers.** Full review: #759 (comment), #760 (comment).

---

## Specialist Plan

| Story | Planned specialist | Why |
|-------|-------------------|-----|
| S-076 | `gensecai/privacy-engineer` | Art. 17 completeness — S-075's review caught the twin-copy; same risk domain |
| S-077 | `ecc/database-reviewer` | Purge sweep design (lock-free, batching, idempotency) — schema/query risk domain |

Nova makes the final specialist decision at STOP 1 per the rule (planned ≠ forced). Tight briefs required (S-074 lesson).

---

## Persona Skill Toolkits (First Full Sprint)

Sprint 7 is the first full sprint under the persona skill-toolkit regime (Sumanth's directive, 2026-10-11). Each persona consults their selected toolkit before each task:
- **Lead:** `sprint-planning`, `writing-plans`, `dispatching-parallel-agents`, `agent-orchestration-advisor`
- **Nova:** `test-driven-development`, `ponytail`, `minimal-change-engineer`, `verification-before-completion`, `database-reviewer` (proactive)
- **Rex:** `create-architecture`, `database-reviewer`, `review-adversarial`, `check-readiness`, `api-design-reviewer`
- **Quinn:** `test-plan`, `test-execution`, `bug-triage`, `qa-signoff`, `e2e-runner` (if QA phase runs)

---

## Out of Scope (Explicit)

- #756 MEDIUM tables (messages, sessions, transcripts, `user_memory`, `match_results`, scores) — stays tracked in #756 for Sprint 8+
- Counsel items (DPIA, BIPA public policy text, final period confirmation) — separate legal track
- Actual R2/B2 storage deletion requires Sumanth's explicit approval per deletion-scope rules (dry-run first)
- #739 R2 plaintext cleanup — staging QA ops, not sprint work
- Other P1 backlog items (#414, #416, #528, etc.) — different modules, per Sumanth's "handle with that module" directive

---

## Risks

| Risk | Mitigation |
|------|------------|
| R2 versioning makes deletes non-destructive | Nova verifies bucket versioning at STOP 1 (Rex's review) |
| Two-phase deletion complexity | Rex's design is explicit; privacy-engineer reviews the failure modes |
| S-077 cron holds up S-076 | Independent — S-076 doesn't need the cron; sequencing is helper-first, not blocking |
| E-008 spec slips again | Issue #761 + week-1 checkpoint + Sumanth gate (the hygiene Sprint 6 lacked) |

---

## Definition of Done (Sprint)

- [ ] S-076 merged to `dev` (PR, tests passing, privacy-engineer review, Suga review, Sumanth merge approval)
- [ ] S-077 merged to `dev` (PR, tests passing, database-reviewer review, Suga review, Sumanth merge approval)
- [ ] E-008 spec draft to Sumanth by end of week 1 (#761)
- [ ] #756 updated (HIGH done, MEDIUM still tracked)
- [ ] No open P0/P1 regressions
