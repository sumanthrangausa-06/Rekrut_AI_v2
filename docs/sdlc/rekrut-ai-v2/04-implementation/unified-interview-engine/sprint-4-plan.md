---
project: Unified Interview Engine
phase: 4-Implementation
sprint: 4
status: draft
created: 2026-10-11
owner: Sumanth
lead: Lead (Team Lead, smart-sdlc Phase 4)
capacity_points: 20
committed_points: 17
---

# Sprint 4 Plan — P0 Consent Enforcement + Heartbeat Wiring

> **Status:** Draft | **Lead:** Lead | **Phase Gate:** Requires Sumanth's approval before Nova starts building.
> **Method:** smart-sdlc `sprint-planning`. Backlog: `docs/sdlc/rekrut-ai-v2/03-solutioning/unified-interview-engine/epics-stories.md`.
> **Sprint 3 retro:** 17/17 points delivered (S-059 R2 encryption, S-060 request button, S-061 recruiter dashboard, S-062 InterviewPanel migration, S-064 withdrawn-consent UI). All 5 stories merged to `dev`. **Major finding:** Rex's AI Observer spec analysis revealed the observer has zero consent integration — if a candidate declines biometrics and the recruiter enables Observer, the spec runs full biometric analysis anyway, silently overriding the decline. Sumanth approved **Option A** (observer doesn't join at all when `biometric_collection: false`) per Rex + Nova's joint recommendation. Architecture updated (PR #727). Three new stories created (S-070/071/072). Privacy review of S-059 also surfaced 4 follow-ups (S-066/067/068/069), including a P0: Quick Practice collects face frames with no biometric consent gate.
> **Issue-number verification:** All story→issue mappings below verified via `gh issue view` title check on 2026-10-11. No trust-from-memory.

---

## Sprint Goal

**Both P0 consent gaps are closed (Quick Practice can't collect frames without consent; AI Observer can't override a biometric decline), the observer report honestly reflects declined state, the interview UI sends heartbeats so S-003's auto-pause actually works, and no plaintext biometric frames remain in R2.**

---

## Stories in Scope

| ID | Title | Issue | Epic | Points | Priority | Dependencies |
|----|-------|-------|------|--------|----------|--------------|
| S-066 | Add biometric consent gate to Quick Practice frame collection | #719 | E-002 | 3 | **P0 launch-blocker** | Requires S-059 ✅ (merged). Blocks QP staging. |
| S-070 | AI Observer skips declined-biometric sessions | #724 | E-008 | 3 | **P0 consent enforcement** | Requires S-012 ✅ (merged). Sumanth's Option A decision 2026-10-10. |
| S-071 | Observer report marks declined biometrics correctly | #725 | E-008 | 3 | Core | Requires S-070 (same sprint — order after). |
| S-063 | Wire heartbeat and lifecycle to interview UI | #713 | E-001 | 5 | Core | Requires S-003 ✅ (merged). |
| S-068 | Cleanup sweep for legacy plaintext frames in R2 | #721 | E-002 | 3 | Core | Requires S-059 ✅ (merged). |

**Total committed:** 17 / 20 points (3pt buffer for specialist review-fix cycles).

### Dependency Chain

```
S-066 (QP consent gate, 3pts) ── requires S-059 ✅ ── independent, P0 first
                                                    │
S-070 (Observer gate, 3pts) ── requires S-012 ✅ ────┤
  └──→ S-071 (report declined marking, 3pts) ── requires S-070
                                                    │
S-063 (heartbeat wiring, 5pts) ── requires S-003 ✅ ── independent, largest
                                                    │
S-068 (R2 plaintext cleanup, 3pts) ── requires S-059 ✅ ── independent
```

S-066, S-070, S-063, S-068 are mutually independent and can parallelize. S-071 must follow S-070 (needs the gate behavior defined to mark reports correctly). Per Rex's architecture §10.2 ordering rules, no cross-story conflicts.

### Why These Five

- **S-066** is a P0 launch-blocker — Quick Practice collects face frames with **no biometric consent gate**. Consent receipts are bound to interview sessions, which QP doesn't have. The privacy engineer flagged this as CRITICAL during S-059's review: do not ship the QP path to staging until resolved. This is active biometric collection without consent — the highest-risk item in the backlog.
- **S-070** is P0 consent-promise enforcement — AI Observer has zero consent integration. Per Rex's spec analysis, a candidate's biometric decline is silently overridden by the recruiter's observer toggle. Sumanth approved Option A (observer doesn't join at all when `biometric_collection: false`) on Nova's "structurally impossible > procedural discipline" reasoning. Without this, the "no AI biometric analysis" promise in S-060/S-064's UI copy is unenforceable.
- **S-071** completes the S-070 chain — when the observer doesn't join, the report must show biometric sections as "Declined by candidate," not blank or "data missing." A blank report looks like a bug; an honest declined state preserves recruiter trust.
- **S-063** makes S-003's backend actually work — the state machine, heartbeat endpoint, and 60s auto-pause exist but `InterviewSession.tsx` sends no heartbeats, so auto-pause never triggers in practice. This is the "does this module actually work?" question Sumanth keeps asking. Deferred from Sprint 3 as the largest story (5pts, iOS Safari background-timer complexity).
- **S-068** removes real exposure — legacy plaintext `.jpg` frames from before S-059 still sit in R2 unencrypted. S-059 fixed the forward path; this cleans up what's already there. Passive risk (data at rest), but it's actual biometric data in cloud storage.

### Deferred to Sprint 5

| Story | Issue | Points | Reason |
|-------|-------|--------|--------|
| S-065 (Audit log read endpoint and viewer UI) | #715 | 3 | Third deferral. Still lowest urgency — audit data is being written correctly (S-014); read access is admin-only, not launch-blocking. |
| S-067 (Wire destroyDEK into DSAR and account deletion) | #720 | 3 | Compliance gap (deletion doesn't crypto-shred), but only triggers on actual deletion requests. Fits Sprint 5 hardening. |
| S-069 (Encrypt full interview recordings .webm) | #722 | 3 | Recordings at rest unencrypted — real but passive risk. Prioritized below S-068's active plaintext-frame exposure. |
| S-072 (Update AI Observer disclosure for declined biometrics) | #726 | 3 | Small copy change (FR-85 text). Pairs well with any Sprint 5 story; not urgent enough to consume buffer. |

**Sprint 5 preview:** S-065 (3) + S-067 (3) + S-069 (3) + S-072 (3) = 12pts, leaving ~6-8pts for new engine work.

---

## Specialist Decisions (Mandatory — Sumanth's Directive, 2026-10-10)

*Per ~/AGENTS.md: at sprint planning, Lead MUST answer for each story: "Does this story need a specialist? Yes/No, and why." Specialists cover all domains, not just security.*

### S-066 — QP biometric consent gate (3pts, #719)

**Decision: YES — 2 specialists.**

| Specialist | Pool | Why |
|------------|------|-----|
| privacy-engineer | gensecai (security-compliance) — *proven on S-011, S-058, S-059* | The consent gate is the entire story — must verify no frame path bypasses it (including retries, error paths, and the QP-specific flow that lacks interview sessions). |
| ux-architect | voltagent | QP's decline UX — the candidate is in a practice flow, not a formal interview. Decline messaging must be clear without feeling punitive. Same bar as S-060/S-064 reviews. |

**Why:** P0. This is a consent-enforcement story — the privacy engineer verifies the gate is airtight, the UX architect verifies the decline experience is respectful.

### S-070 — AI Observer skips declined-biometric sessions (3pts, #724)

**Decision: YES — 1 specialist.**

| Specialist | Pool | Why |
|------------|------|-----|
| privacy-engineer | gensecai (security-compliance) — *proven on S-011, S-058, S-059* | Verify the enqueue gate is structurally enforced — no job enqueued, no streams received, no bypass via the recruiter toggle. This is the consent promise made code. |

**Why:** P0. The whole point is making a privacy violation structurally impossible. The privacy engineer verifies the gate can't be circumvented.

### S-071 — Observer report marks declined correctly (3pts, #725)

**Decision: YES — 1 specialist.**

| Specialist | Pool | Why |
|------------|------|-----|
| ux-architect | voltagent | Report UX for the declined state — "Declined by candidate" vs blank vs "data missing." The recruiter must understand why sections are empty without it reading as a system failure. |

**Why:** Same trust-sensitive lens as S-060/S-061/S-064. Wording matters when the report reflects someone's consent decision.

### S-063 — Wire heartbeat and lifecycle to interview UI (5pts, #713)

**Decision: YES — 1 specialist.**

| Specialist | Pool | Why |
|------------|------|-----|
| react-specialist | (frontend specialists) | Heartbeat timers in React (cleanup on unmount, background-tab throttling), pause/resume state integration with `InterviewSession.tsx`, iOS Safari background-timer suspension behavior. |

**Why:** This is a React lifecycle + browser-timing story. The iOS Safari backgrounding edge case (timers suspended → false auto-pause) is exactly the kind of platform-specific issue a React/frontend specialist catches. Nova confirms or adjusts at STOP 1.

### S-068 — R2 plaintext frame cleanup (3pts, #721)

**Decision: YES — 1 specialist.**

| Specialist | Pool | Why |
|------------|------|-----|
| privacy-engineer | gensecai (security-compliance) — *proven on S-011, S-058, S-059* | Verify the sweep is complete — zero plaintext frames remain in R2 (including edge cases: multipart fragments, versioned objects, CDN caches). A cleanup that misses 5% of frames is a failed cleanup. |

**Why:** The acceptance criterion is "zero plaintext frames remain." The privacy engineer verifies completeness, not just effort.

### Specialist Tracking

Per ~/AGENTS.md, Nova will document on each story's GitHub Issue:
1. At STOP 1: her specialist decision (confirming or adjusting the above)
2. After review: findings and fixes
3. In the PR body: "Specialist Reviews" section

**Estimate impact:** None. Specialist reviews run after Green (implementation complete), before PR creation. The 3pt sprint buffer absorbs review-fix cycles.

---

## Definition of Done

### Per Story
- [ ] All acceptance criteria pass (from the GitHub issue)
- [ ] Unit tests written FIRST (TDD Red), implementation makes them pass (Green), code cleaned (Refactor)
- [ ] **Issue number verified** at STOP 1: `gh issue view <#number> --json title` must contain the story ID. Mismatch = STOP, report to Suga.
- [ ] Separate reviewer approves the PR (not the implementer)
- [ ] No `console.log` debug code, no TODOs, no commented-out blocks
- [ ] Branch merged to `dev` via PR (never direct push)

### Sprint-Level
- [ ] **QP staging gate:** Quick Practice cannot upload a frame without a biometric consent receipt (verified by attempting upload without consent → blocked).
- [ ] **Observer consent gate:** Declined-biometric session + observer toggle ON → no observer job enqueued, no streams received (verified via observer_jobs table).
- [ ] **Observer report:** Declined session report shows "Declined by candidate" on biometric sections (not blank).
- [ ] **Heartbeat live:** `InterviewSession.tsx` sends heartbeats; browser close → auto-pause within 60s (verified in a real browser session).
- [ ] **R2 clean:** Zero plaintext `.jpg` frames in the R2 `frames/` prefix (verified via R2 API listing).
- [ ] **Cross-surface check:** New/changed UI works on desktop Chrome + iPhone Safari (Sumanth's whole-app responsiveness rule).
- [ ] **No placeholder data:** All UI uses real API responses, not mocked.

---

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| R1 | S-066's QP consent design may need a product decision (consent receipts are bound to interview sessions; QP has none) | Medium | High — P0 blocked on design | Nova flags at STOP 1 if the design is ambiguous. Sumanth decides: QP-specific receipt type vs session-less consent record. Do not guess. |
| R2 | S-070's enqueue gate location — SessionService vs observer worker vs both | Low | Medium | Nova checks the enqueue path at Comprehend. Gate at enqueue (SessionService) is the structural guarantee; worker-side check is defense-in-depth. |
| R3 | S-063's iOS Safari backgrounding — timers suspended, heartbeat stops, false auto-pause | Medium | Medium | react-specialist reviews the timer strategy. Options: Page Visibility API, shorter heartbeat interval, server-side grace period. Document the chosen approach. |
| R4 | S-068's R2 sweep may need R2 API credentials Nova doesn't have | Medium | Medium | Nova checks R2 client config at Comprehend. If credentials are missing, write the sweep script with integration tests mocked, flag live-R2 verification as follow-up. $0 constraint: no new buckets. |
| R5 | S-071 depends on S-070's gate behavior — if S-070's design shifts, S-071's report states shift too | Low | Low | Order S-070 first in the sprint. Nova confirms the gate contract before starting S-071. |
| R6 | Two P0s in one sprint (S-066, S-070) — both demand privacy-engineer review | Low | Low | Reviews run after Green, in parallel. Privacy-engineer reviews are the proven path (S-011, S-058, S-059 all cleared). |

---

## Nova's Starting Point

### Story Order

1. **S-066** (3pts, #719) — QP consent gate. P0, independent. Start here.
2. **S-070** (3pts, #724) — Observer enqueue gate. P0, independent. Can parallelize with S-066.
3. **S-071** (3pts, #725) — Report declined marking. Requires S-070's gate contract. Start after S-070.
4. **S-063** (5pts, #713) — Heartbeat wiring. Requires S-003 ✅ (merged). Independent, largest — good mid-sprint story.
5. **S-068** (3pts, #721) — R2 plaintext cleanup. Requires S-059 ✅ (merged). Independent, good sprint-closer.

### Branch Naming

```
feat/{issue-number}-{short-slug}
```

**Verified mappings (do NOT trust from memory):**
- S-066 → `feat/719-qp-consent-gate`
- S-070 → `feat/724-observer-consent-gate`
- S-071 → `feat/725-observer-report-declined`
- S-063 → `feat/713-heartbeat-wiring`
- S-068 → `feat/721-r2-plaintext-cleanup`

Branch from `dev`, PR targets `dev`. PR body must reference `Closes #<issue-number>`.

### TDD Cycle (per story)

Same as Sprint 3 (Red → Green → Refactor), plus:

1. **Comprehend** (⏸️ STOP) — Read story ACs from GitHub issue + relevant architecture section (§10 for migration stories, §3.19 for observer stories, ADR-012 for crypto). **Verify issue number** via `gh issue view`. Present plan to Suga.
2. **Branch** (⏸️ STOP) — Create branch, confirm.
3. **Red → Green → Refactor** — Tests first.
4. **Specialist review** (per the Specialist Decisions section above — mandatory, not optional) — Nova confirms or adjusts at STOP 1, dispatches after Green:
   - S-066: `gensecai/privacy-engineer` + `voltagent/ux-architect`
   - S-070: `gensecai/privacy-engineer`
   - S-071: `voltagent/ux-architect`
   - S-063: `react-specialist`
   - S-068: `gensecai/privacy-engineer`
   - Nova documents decision + findings on each story's GitHub Issue per ~/AGENTS.md
5. **Review** — Separate reviewer, Suga approves.
6. **Merge** — Sumanth approves merge.

### Key Files Nova Will Touch (Sprint 4)

| Story | Likely New Files | Existing Files to Check |
|-------|-----------------|------------------------|
| S-066 | QP consent gate (middleware or route guard) | `routes/quick-practice.js`, `lib/qp-ai.js` (frame upload path), consent receipt model (S-010/S-011) |
| S-070 | Enqueue gate in SessionService or observer worker | Observer enqueue path, `interview_sessions.config.biometric_collection` (S-012), recruiter toggle |
| S-071 | Report template changes | `ai_observer_reports` schema, report rendering |
| S-063 | Heartbeat logic in `InterviewSession.tsx` | `client/src/pages/candidate/InterviewSession.tsx`, S-003's `POST /heartbeat` + `GET /state` endpoints |
| S-068 | R2 sweep script | R2 client config, `frames/` prefix listing, S-059's encryption verification |

### What Nova Must Read Before Starting

1. This sprint plan
2. The 5 stories' GitHub issues (full ACs)
3. Architecture §3.19 (AI Observer) — for S-070/S-071, including the new consent-gate annotation (PR #727)
4. Architecture §10 (Frontend Integration & Migration Plan) — for S-063
5. ADR-012 (crypto-shredding / per-candidate DEKs) — for S-068
6. S-059's `lib/r2FrameStore.js` — for S-066 (frame upload path) and S-068 (what "encrypted" looks like)
7. S-012's `biometric_collection` flag — for S-066/S-070

---

## Sprint 5 Preview (not committed)

| Focus | Candidate Stories | Points (est.) |
|-------|-------------------|---------------|
| Audit + DSAR + recordings + disclosure | S-065 (audit viewer, 3), S-067 (DSAR DEK wiring, 3), S-069 (webm encryption, 3), S-072 (disclosure text, 3) | ~12 + new stories |

*(Detailed plan by Lead before Sprint 5, following this same process.)*

---

## Phase Gate Checklist

Before Sumanth approves this sprint plan:

- [ ] Sprint goal is clear and achievable in one sprint
- [ ] All 5 stories have complete acceptance criteria (in GitHub issues)
- [ ] Dependencies are satisfied (S-059 ✅, S-012 ✅, S-003 ✅ all merged; S-071 ordered after S-070)
- [ ] **Issue numbers verified** via `gh issue view` title check (S-066→#719, S-070→#724, S-071→#725, S-063→#713, S-068→#721)
- [ ] Capacity check: 17/20 points with 3pt buffer (within Sprint 1-3 velocity of ~17-18)
- [ ] Risks identified with mitigations
- [ ] Nova's starting point is unambiguous (story order, branch naming with verified issue #s, TDD cycle, files)
- [ ] **Specialist decisions documented** for all 5 stories (Yes/No + which specialist + why) in the Specialist Decisions section
- [ ] $0 infrastructure confirmed (no new services in Sprint 4)
- [ ] TDD + separate reviewer + issue-verification enforced
- [ ] Deferred stories documented with reasoning (S-065: 3rd deferral, lowest urgency; S-067: deletion-triggered; S-069: passive risk; S-072: small copy)

---

*Next: Sumanth approves → Nova starts with S-066 → Lead tracks progress → Sprint 4 review → Sprint 5 planning.*
