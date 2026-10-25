---
project: Unified Interview Engine
phase: 4-Implementation
sprint: 2
status: draft
created: 2026-10-10
owner: Sumanth
lead: Lead (Team Lead, smart-sdlc Phase 4)
capacity_points: 20
committed_points: 18
---

# Sprint 2 Plan — Session Engine Foundation + Consent Completion

> **Status:** Draft | **Lead:** Lead | **Phase Gate:** Requires Sumanth's approval before Nova starts building.
> **Method:** smart-sdlc `sprint-planning`. Backlog: `docs/sdlc/rekrut-ai-v2/03-solutioning/unified-interview-engine/epics-stories.md`.
> **Sprint 1 retro:** 18/18 points delivered (S-056, S-014, S-010, S-011 + 403 handler). Velocity confirmed at ~18pts/sprint. One process failure: S-011 was dispatched with wrong issue number (#571 instead of #569) — fixed via new hard rule (Suga verifies issue # before dispatch; Nova verifies at STOP 1 Comprehend).
> **Issue-number verification:** All story→issue mappings below verified via `gh issue view` title check on 2026-10-10. No trust-from-memory.

---

## Sprint Goal

**Interview sessions can be created in all 4 modes with consent gating enforced at creation, session state survives interruptions, and candidates who decline biometric consent get a working human-interview alternative.**

---

## Stories in Scope

| ID | Title | Issue | Epic | Points | Priority | Dependencies |
|----|-------|-------|------|--------|----------|--------------|
| S-058 | Biometric/PII segregation with separate encryption keys | #582 | E-002 | 5 | Core | None. Blocks S-057. |
| S-001 | Create interview session (all 4 modes) | #559 | E-001 | 5 | Core | Requires S-011 ✅ (done). Blocks S-002, S-003. |
| S-003 | Session lifecycle state machine | #561 | E-001 | 5 | Core | Requires S-001. Blocks S-005, S-008. |
| S-012 | Consent-decline → human interview path | #570 | E-002 | 3 | Core | Requires S-010 ✅ (done), S-001. |

**Total committed:** 18 / 20 points (2pt buffer, same as Sprint 1).

### Dependency Chain

```
S-058 (segregation, 5pts) ──────────────────── parallel, no dependencies
                                                    │
S-001 (create session, 5pts) ── requires S-011 ✅ ──┤
  ├──→ S-003 (lifecycle, 5pts) ── requires S-001   │
  └──→ S-012 (decline path, 3pts) ── requires S-001 + S-010 ✅
```

### Why These Four

- **S-058** was deferred from Sprint 1 ("architecturally foundational but not on the consent-gating critical path"). It is now the critical path — S-057 (encryption verification) and all biometric storage stories need segregated tables with per-candidate DEKs. No dependencies, so Nova starts here for a clean parallel-safe win.
- **S-001** is the foundation of E-001 (Session Engine). S-011's middleware gates session creation — the interface contract from Sprint 1 is now live, so S-001 builds directly against it. Unblocks S-002, S-003.
- **S-003** (pause/resume lifecycle) is the highest-value follow-on to S-001. Session state surviving browser kills is a core reliability requirement before any interview mode ships.
- **S-012** closes the consent loop from Sprint 1. S-010 built the decline-offer UI; S-012 makes it real (recruiter notification → approve/decline → human-mode session with biometric collection disabled). Without this, candidates who decline biometric consent hit a dead end — a BIPA compliance gap.

### Deferred to Sprint 3

| Story | Points | Reason |
|-------|--------|--------|
| S-057 (encryption verification) | 3 | Requires S-058. Verification story (CI scan + config audit) — meaningful after S-058's tables exist. Fits Sprint 3's hardening theme. |
| S-002 (invite token generation) | 3 | Requires S-001. Recruiter-facing; candidate session flow (S-001→S-003) is higher priority. |
| S-004 + S-006 (camera/mic init + pre-flight checks) | 5 + 3 | S-006 requires S-004 (8pts combined — doesn't fit in 20pt budget alongside the above). **Note on parent's "un-break" ask:** the spec defines S-006 as pre-flight *device checks*, not consent-flow integration. Mock interviews already recover via the S-011 403 handler → consent redirect (PR #627). S-004/S-006 make the pre-interview flow seamless (device checks → consent → start) and belong in Sprint 3's UX pass. |

---

## Specialist Decisions (Mandatory — Sumanth's Directive, 2026-10-10)

*Per ~/AGENTS.md: at sprint planning, Lead MUST answer for each story: "Does this story need a specialist? Yes/No, and why." Specialists cover all domains, not just security. The question is: "Would ANY specialist make this better?"*

### S-058 — Biometric/PII segregation (5pts, #582)

**Decision: YES — 3 specialists.**

| Specialist | Pool | Why |
|------------|------|-----|
| privacy-engineer | gensecai (security-compliance) | Segregation correctness against BIPA/GDPR requirements — is biometric data truly separated from identity data? |
| penetration-tester | voltagent (04-quality-security) — *proven Tier 1 on S-011* | Adversarial: can they JOIN across the segregation boundary to re-identify a candidate? |
| crypto-implementation-expert | gensecai (security-compliance) | Per-candidate DEK implementation (ADR-012) — crypto is easy to get subtly wrong (IV reuse, key derivation, storage) |

**Why:** Highest security-risk story of the sprint. Segregation + per-candidate encryption is the foundation every later integrity/behavioral story depends on. A flaw here compromises the entire compliance posture.

### S-001 — Create interview session, all 4 modes (5pts, #559)

**Decision: YES — 2 specialists.**

| Specialist | Pool | Why |
|------------|------|-----|
| database-reviewer | ecc | Proactive session-table schema review before migration. 4-mode config polymorphism in one schema is easy to get wrong (R1). |
| architect | gensecai (development-programming) | 4-mode config shape review — are mode configs extensible without schema churn? Is the mode enum future-proof? |

**Why:** Foundation of E-001 (Session Engine). Every subsequent story builds on this schema. Schema mistakes are the most expensive to fix later — review is cheap insurance.

### S-003 — Session lifecycle state machine (5pts, #561)

**Decision: YES — 1 specialist.**

| Specialist | Pool | Why |
|------------|------|-----|
| event-driven-architect | gensecai (development-programming) | State machine transition review — are all transitions valid? Are terminal states reachable? Are pause/resume races handled? |

**Why:** State machines are deceptively simple to design and easy to get wrong (invalid transitions, lost states, race conditions on pause/resume). A transition-table review catches logic bugs that unit tests often miss because the tests encode the same flawed assumptions as the implementation.

### S-012 — Consent-decline → human interview path (3pts, #570)

**Decision: YES — 1 specialist.**

| Specialist | Pool | Why |
|------------|------|-----|
| design-ux-architect | agency-agents (design) | Candidate-facing decline flow review. Declining consent is a sensitive, high-anxiety moment — the flow must be humane, clear, and unambiguous. Also validates the BIPA "real alternative" requirement through a UX walkthrough. |

**Why:** This is fundamentally a UX story — the backend wiring (recruiter notification, session creation) is straightforward, but the candidate experience of being offered an alternative after declining determines whether the consent system feels trustworthy or coercive. A UX lens here protects the product's integrity posture as much as any security review.

### Specialist Tracking

Per ~/AGENTS.md, Nova will document on each story's GitHub Issue:
1. At STOP 1: her specialist decision (confirming or adjusting the above)
2. After review: findings and fixes
3. In the PR body: "Specialist Reviews" section

**Estimate impact:** None. Specialist reviews run after Green (implementation complete), before PR creation. The 2pt sprint buffer absorbs review-fix cycles.

---

## Definition of Done

### Per Story
- [ ] All acceptance criteria pass (from `epics-stories.md`)
- [ ] Unit tests written FIRST (TDD Red), implementation makes them pass (Green), code cleaned (Refactor)
- [ ] **Issue number verified** at STOP 1: `gh issue view <#number> --json title` must contain the story ID. Mismatch = STOP, report to Suga.
- [ ] Separate reviewer approves the PR (not the implementer)
- [ ] No `console.log` debug code, no TODOs, no commented-out blocks
- [ ] Branch merged to `dev` via PR (never direct push)

### Sprint-Level
- [ ] **Live demo:** Recruiter creates AI-interview session → candidate joins → consent enforced at session start (403 without receipt) → candidate closes browser mid-session → rejoins and resumes at same question → candidate declines biometric consent → recruiter gets notification → approves → human-mode session runs with zero biometric collection
- [ ] **Segregation test:** Direct JOIN from biometric tables to `users` name/email fails; linkage only via authorized key-service path
- [ ] **Crypto-shredding readiness:** Per-candidate DEKs exist and are random (deletion = key destruction, per ADR-012)
- [ ] **Cross-surface check:** Session creation works from recruiter dashboard on desktop Chrome + iPhone Safari (Sumanth's whole-app responsiveness rule)
- [ ] **No placeholder data:** Session configs use real mode definitions from architecture §3 (not stubbed)

---

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| R1 | S-001's 4-mode config schema is complex (mock/screening/ai-interview/human each have different required fields) | Medium | High — blocks S-003, S-012 | Architecture §3 defines mode configs; Nova reads them at Comprehend. Zod validation per S-001 AC-2 catches malformed configs early. |
| R2 | S-058's per-candidate DEK design (ADR-012) may conflict with existing key management | Medium | Medium | Nova checks existing crypto patterns at Comprehend. If no DEK infra exists, S-058 creates the minimal version (documented as such). |
| R3 | S-012's "human-mode session" needs a session type that S-001 must support | Low | Medium | S-001 AC-1 covers all 4 modes including human. Nova confirms `type: "human"` is in the mode enum during S-001 Comprehend. |
| R4 | S-003's heartbeat/pause detection needs a background job or websocket | Medium | Medium | Architecture specifies the pattern; if it requires new infra (e.g., BullMQ), flag at Comprehend — $0 constraint means reuse existing job infra or use lightweight polling. |
| R5 | Sprint 1's 403-handler redirect assumes `/interview/consent?sessionId=X` route exists (built in S-010 ✅) | Low | Low | Already merged (PR #625). Nova verifies route exists at S-012 Comprehend. |

---

## Nova's Starting Point

### Story Order

1. **S-058** (5pts, #582) — segregation. No dependencies, parallel-safe. Start here.
2. **S-001** (5pts, #559) — session creation. Requires S-011 ✅ (merged). The E-001 foundation.
3. **S-003** (5pts, #561) — lifecycle. Requires S-001. Can start once S-001's session table/API shape is defined (doesn't need S-001 merged if Nova coordinates the interface).
4. **S-012** (3pts, #570) — decline path. Requires S-001 + S-010 ✅. Smallest, good sprint-closer.

### Branch Naming

```
feat/{issue-number}-{short-slug}
```

**Verified mappings (do NOT trust from memory):**
- S-058 → `feat/582-biometric-segregation`
- S-001 → `feat/559-create-session`
- S-003 → `feat/561-session-lifecycle`
- S-012 → `feat/570-decline-human-path`

Branch from `dev`, PR targets `dev`. PR body must reference `Closes #<issue-number>`.

### TDD Cycle (per story)

Same as Sprint 1 (Red → Green → Refactor), plus:

1. **Comprehend** (⏸️ STOP) — Read story ACs + architecture section. **Verify issue number** via `gh issue view`. Present plan to Suga.
2. **Branch** (⏸️ STOP) — Create branch, confirm.
3. **Red → Green → Refactor** — Tests first.
4. **Specialist review** (per the Specialist Decisions section above — mandatory, not optional) — Nova confirms or adjusts at STOP 1, dispatches after Green:
   - S-058: `gensecai/privacy-engineer` + `voltagent/penetration-tester` + `gensecai/crypto-implementation-expert`
   - S-001: `ecc/database-reviewer` (proactive) + `gensecai/architect`
   - S-003: `gensecai/event-driven-architect`
   - S-012: `agency-agents/design-ux-architect`
   - Nova documents decision + findings on each story's GitHub Issue per ~/AGENTS.md
5. **Review** — Separate reviewer, Suga approves.
6. **Merge** — Sumanth approves merge.

### Key Files Nova Will Touch (Sprint 2)

| Story | Likely New Files | Existing Files to Check |
|-------|-----------------|------------------------|
| S-058 | `migrations/2xx_biometric_segregation.js`, `lib/keyService.js` (or extend) | Existing crypto patterns, `users` table |
| S-001 | `server/routes/interviews.js` (extend) or new `server/routes/sessions.js`, `migrations/2xx_interview_sessions_v3.js` | S-011 middleware wiring, mode config definitions |
| S-003 | `lib/sessionLifecycle.js`, heartbeat handler | S-001's session table |
| S-012 | `server/routes/consent.js` (extend decline flow), recruiter notification | S-010's offer UI, notification system |

### What Nova Must Read Before Starting

1. This sprint plan
2. The 4 stories in `epics-stories.md` (full ACs + technical notes)
3. Architecture §3 (session engine components, mode configs) and §4 (table schemas)
4. ADR-012 (crypto-shredding / per-candidate DEKs)
5. S-011's middleware (`server/middleware/requireBiometricConsent.js`) — S-001 wires into it

---

## Sprint 3 Preview (not committed)

| Focus | Candidate Stories | Points (est.) |
|-------|-------------------|---------------|
| Hardening + pre-flight | S-057 (encryption verification), S-002 (invite tokens), S-004 (camera/mic init), S-006 (pre-flight checks) | ~19 |

*(Detailed plan by Lead before Sprint 3, following this same process.)*

---

## Phase Gate Checklist

Before Sumanth approves this sprint plan:

- [ ] Sprint goal is clear and achievable in one sprint
- [ ] All 4 stories have complete acceptance criteria (in `epics-stories.md`)
- [ ] Dependencies are satisfied (S-011 ✅, S-010 ✅ merged; S-001 chains correctly)
- [ ] **Issue numbers verified** via `gh issue view` title check (S-058→#582, S-001→#559, S-003→#561, S-012→#570)
- [ ] Capacity check: 18/20 points with 2pt buffer (matches Sprint 1 velocity)
- [ ] Risks identified with mitigations
- [ ] Nova's starting point is unambiguous (story order, branch naming with verified issue #s, TDD cycle, files)
- [ ] **Specialist decisions documented** for all 4 stories (Yes/No + which specialist + why) in the Specialist Decisions section
- [ ] $0 infrastructure confirmed (no new services in Sprint 2)
- [ ] TDD + separate reviewer + issue-verification enforced
- [ ] S-006 scope discrepancy flagged (spec = device checks, not consent integration; 403 handler already covers recovery)

---

*Next: Sumanth approves → Nova starts with S-058 → Lead tracks progress → Sprint 2 review → Sprint 3 planning.*
