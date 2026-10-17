---
project: Unified Interview Engine
phase: 4-Implementation
sprint: 6
status: draft
created: 2026-10-11
owner: Sumanth
lead: Lead (Team Lead, smart-sdlc Phase 4)
capacity_points: 20
committed_points: 14
---

# Sprint 6 Plan — Legacy Cleanup + Erasure Completeness

> **Status:** Draft | **Lead:** Lead | **Phase Gate:** Requires Sumanth's approval before Nova starts building.
> **Method:** smart-sdlc `sprint-planning`. Backlog: `docs/sdlc/rekrut-ai-v2/03-solutioning/unified-interview-engine/epics-stories.md`.
> **Sprint 5 retro:** 11/11 points delivered (S-069 WebM encryption, S-067 DSAR DEK wiring, S-065 audit viewer + tenant isolation, S-072 disclosure text). All 4 PRs merged to `dev` (#741, #744, #747, #750). **Major findings:** S-069's privacy review surfaced C-1 (no consent gate on `/upload-video` → #742) and H-1 (no retention lifecycle → #743); S-067's privacy review surfaced the `data_requests` fulfillment gap (→ #746) and `candidate_embeddings` scope question (→ #745); S-065's privacy review caught C1 (no tenant isolation — fixed before merge via migration 251). Rex synced architecture docs with all Sprint 4–5 implementation (PR #749).
> **Post-sprint specialist reviews:** All three personas' recommendations were pressure-tested by specialists. Key outcomes: (1) Backend-architect confirmed patching #742 is architecturally impossible — deprecation is the only path; found 5 dead endpoints (not 1) including `/start` burning AI tokens. (2) Privacy-engineer on #745: `candidate_embeddings` is NOT biometric (text vector) — zero BIPA exposure — but IS an active GDPR Art. 17 violation (plaintext surviving deletion). (3) Eng-review reshaped Sprint 6: #742 approach spike unnecessary (deprecation subsumes it), #743 demoted to design spike, E-008 runs in parallel (not after).
> **Issue-number verification:** All story→issue mappings below verified via `gh issue view` title check on 2026-10-11. No trust-from-memory.
> **Sumanth's approvals (2026-10-11):** (1) Retire 5 dead write endpoints (breaking change). (2) Hard-delete embeddings on erasure + rescope erasure service. (3) Sprint 6 direction (revised plan with spikes + parallel E-008).

---

## Sprint Goal

**Kill the whack-a-mole: retire the dead legacy write surface (ending the consent-gap class of bugs), close the erasure gaps (embeddings hard-delete, DSAR fulfillment), and design the retention lifecycle — while Rex specs E-008 in parallel.**

---

## Stories in Scope

| ID | Title | Issue | Epic | Points | Priority | Dependencies |
|----|-------|-------|------|--------|----------|--------------|
| S-074 | Retire legacy interview write endpoints | #751 | E-001 | 3 | P0 — ends consent-gap class; stops AI token burn | None (independent) |
| S-075 | Hard-delete candidate_embeddings on erasure + rescope erasure service | #752 | E-002 | 3 | P1 — active GDPR Art. 17 violation | Requires S-067 ✅ (merged) |
| — | #743 retention lifecycle (design spike) | #743 | E-002 | 2 | P1 — needs Rex input; decisions unmade | None (spike) |
| — | #746 data_requests fulfillment endpoint | #746 | E-002 | 3 | P1 — closes DSAR loop | Requires S-067 ✅ (merged) |
| — | #748 consent audit company_id threading | #748 | E-002 | 2 | P2 — completeness (fail-closed already) | Requires S-065 ✅ (merged) |

**Total committed:** 13 / 20 points (7pt buffer).

**Points notes:**
- S-074 at 3pts: 410 + logging on 5 endpoints is mechanical; the one-sprint monitoring window is calendar time, not effort. Deletion after clean logs is a small follow-up.
- S-075 at 3pts: extends S-067's `erasureService`; hard-delete is one SQL statement; rescope/rename is refactoring with test updates.
- #743 as 2pt design spike (not a build): retention periods, deletion triggers, and BIPA §15(a) linkage are unmade decisions requiring Rex's architectural input. Build follows in Sprint 7.
- #748 at 2pts (not 3): #748's scope is threading `company_id` through `consentService` writes — mechanical, following the S-065 migration 251 pattern.

### Dependency Chain

```
S-074 (retire endpoints, 3pts) ── independent ── resolves #742 (closes as "resolved by deprecation")
S-075 (embeddings delete, 3pts) ── requires S-067 ✅ ── independent of S-074
#743 spike (retention design, 2pts) ── needs Rex input ── informs Sprint 7 build
#746 (fulfillment endpoint, 3pts) ── requires S-067 ✅ ── uses erasureService
#748 (audit company_id, 2pts) ── requires S-065 ✅ ── independent
```

S-074 and S-075 are the highest value and independent — start there. #746 and #748 are well-defined builds. #743 is a design spike (no code).

### Why These Five

- **S-074** ends the whack-a-mole — every privacy gap for three sprints has been "the legacy path doesn't have the new guarantees" (S-066 QP frames, #742 `/upload-video`, S-068 legacy plaintext). Retiring the 5 dead write endpoints kills the entire class. Bonus: `/start` stops burning AI tokens on Sumanth's budget.
- **S-075** fixes an active GDPR violation — `candidate_embeddings` (plaintext text vectors + summaries) survives account deletion today. Art. 17 requires erasure "without undue delay." One DELETE statement + service rescope.
- **#743 spike** designs what #743 will build — retention periods, deletion triggers, storage cost implications, and BIPA §15(a) linkage for `biometric_templates`. Cannot be a build until Rex provides architectural input and Sumanth confirms periods.
- **#746** closes the DSAR loop — `data_requests` rows sit as `'pending'` with no processing path. GDPR has a 30-day clock. Uses S-067's `erasureService` (now rescoped by S-075).
- **#748** completes the audit trail — `consentService` writes audit rows via raw INSERTs bypassing `logAccess`, so `company_id` is NULL. Hiring managers can't see their own candidates' consent events (fail-closed excludes them). Completeness, not a leak.

### Explicitly Out of Scope

| Item | Reason |
|------|--------|
| #742 as a standalone story | **Subsumed by S-074.** Backend-architect proved patching is architecturally impossible. #742 closes as "resolved by deprecation" with zero-caller evidence (S-074 AC-5). |
| #745 as a build story | **Converted to S-075.** The product decision (hard-delete: yes) is made. The remaining Art. 9 counsel/DPIA track is legal, not engineering — tracked separately as launch-blocking. |
| #739 R2 cleanup deletion | QA-stage ops action, not a sprint build story. Gated on Sumanth's explicit approval of dry-run results. Tracked in #739. |
| E-008 observer worker implementation | **Rex's parallel track** (not in sprint). Week-1 contract-compatibility checkpoint against S-070/S-071 assumptions. Spec approval → Sprint 7+. |
| Other phase-3 stories (S-002–S-054) | Solutioning backlog, not approved for implementation sprints. |

**Capacity note:** Sprint 6 commits 13/20 points. The 7pt buffer absorbs the E-008 week-1 checkpoint review and any S-074 monitoring-window findings.

---

## Specialist Decisions (Mandatory — Sumanth's Directive, 2026-10-10)

*Per ~/AGENTS.md: at sprint planning, Lead MUST answer for each story: "Does this story need a specialist? Yes/No, and why." Specialists cover all domains, not just security. Pools verified in ~/workspace/SKILL_MAP.md.*

### S-074 — Retire legacy interview write endpoints (3pts, #751)

**Decision: YES — 1 specialist.**

| Specialist | Pool | Why |
|------------|------|-----|
| engineering-backend-architect | agency-agents — *already reviewed during scoping, found the 5 endpoints + token burn* | Re-verify blast radius at implementation: confirm zero callers (codebase + deploy logs), verify read surface untouched, verify `/mock/*` isolation. |

**Why:** The scoping review was thorough, but implementation must re-verify — a missed caller means a broken production path.

### S-075 — Hard-delete candidate_embeddings + rescope erasure service (3pts, #752)

**Decision: YES — 1 specialist.**

| Specialist | Pool | Why |
|------------|------|-----|
| privacy-engineer | gensecai (security-compliance) — *proven on S-065, S-067, S-069* | Verify GDPR Art. 17 compliance: no residual copies (caches, replicas), rescope doesn't break S-067's biometric callers, audit entries written. |

**Why:** Deletion-path completeness is a checklist problem — the specialist verifies no table was missed (the exact failure mode that created this story).

### #743 — Retention lifecycle design spike (2pts, #743)

**Decision: YES — 1 specialist (Rex, not a subagent).**

| Specialist | Pool | Why |
|------------|------|-----|
| Rex (architect persona) | Internal | Retention periods, deletion triggers, storage cost, BIPA §15(a) linkage for `biometric_templates` — architectural design decisions, not implementation review. |

**Why:** This is a design spike, not a build. Rex provides the architectural input; Nova (or a follow-up story) builds in Sprint 7.

### #746 — data_requests fulfillment endpoint (3pts, #746)

**Decision: YES — 1 specialist.**

| Specialist | Pool | Why |
|------------|------|-----|
| privacy-engineer | gensecai (security-compliance) | DSAR fulfillment correctness: admin-only access, idempotency (double-fulfill safe), status transitions valid, calls rescoped erasureService (post-S-075). |

**Why:** Admin fulfillment endpoints are privilege-escalation surfaces — verify the access control is airtight.

### #748 — Consent audit company_id threading (2pts, #748)

**Decision: NO.**

**Why:** Mechanical change following the S-065 migration 251 pattern exactly (`company_id` threading through writes). No new data handling, no access-control change, no trust copy. The pattern is proven; a specialist would add review latency for zero new risk.

### Specialist Tracking

Per ~/AGENTS.md, Nova will document on each story's GitHub Issue:
1. At STOP 1: her specialist decision (confirming or adjusting the above)
2. After review: findings and fixes
3. In the PR body: "Specialist Reviews" section

**Estimate impact:** None. Specialist reviews run after Green (implementation complete), before PR creation. The 7pt sprint buffer absorbs review-fix cycles.

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
- [ ] **Legacy writes retired:** 5 endpoints return 410 Gone with hit logging; zero production callers confirmed via logs.
- [ ] **Erasure complete:** `candidate_embeddings` hard-deleted on account deletion and DSAR erasure; erasure service rescoped to personal-data.
- [ ] **DSAR loop closed:** Admin can fulfill `data_requests` via the new endpoint; status transitions valid; idempotent.
- [ ] **Audit complete:** Consent audit writes carry `company_id`; hiring managers see their company's consent events.
- [ ] **Retention designed:** #743 spike produces a design doc with periods, triggers, and BIPA §15(a) linkage — ready for Sprint 7 build.
- [ ] **#742 closed:** As "resolved by deprecation" with zero-caller evidence (S-074 AC-5).
- [ ] **Cross-surface check:** New/changed UI works on desktop Chrome + iPhone Safari (Sumanth's whole-app responsiveness rule).
- [ ] **No placeholder data:** All UI uses real API responses, not mocked.

---

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| R1 | S-074: a production caller exists that codebase search missed | Low | High | 410 + hit-logging window (one sprint) before deletion. Logs reviewed before removal. Rollback = revert the 410 commit. |
| R2 | S-075: rescope/rename breaks S-067's existing callers | Low | Medium | Rename is mechanical; tests updated in same PR. Privacy-engineer verifies no caller missed. |
| R3 | #743 spike: Rex's input delayed, spike can't complete | Low | Low | Spike is time-boxed (2pts). If Rex is blocked, the spike documents open questions and Sprint 7 planning accounts for it. |
| R4 | #746: scope creep into recording-lifecycle semantics | Low | Low | Explicitly out of scope (that's #743's design). PR review enforces the boundary. |
| R5 | E-008 parallel track: week-1 checkpoint finds S-070/S-071 assumption conflicts | Medium | Medium | That's the checkpoint's purpose — find conflicts early while they're cheap. Rex adjusts the spec; Nova's contracts are pure functions (easy to adapt). |

---

## Nova's Starting Point

### Story Order

1. **S-074** (3pts, #751) — Legacy retirement. P0, independent. Start here. 410 + logging is mechanical.
2. **S-075** (3pts, #752) — Embeddings hard-delete. Requires S-067 ✅. Independent of S-074 — can parallelize.
3. **#746** (3pts, #746) — Fulfillment endpoint. Requires S-067 ✅ (uses erasureService — coordinate with S-075's rescope; build after S-075 or against the renamed interface).
4. **#748** (2pts, #748) — Audit company_id. Requires S-065 ✅. Independent, smallest build — good mid-sprint story.
5. **#743 spike** (2pts, #743) — Design spike. Needs Rex's input. No code — can run anytime.

**Note on #746 vs S-075 ordering:** #746 calls `erasureService`. S-075 renames/rescopes it. To avoid merge conflicts, build S-075 first, then #746 against the new interface. Alternatively, coordinate via a shared branch — Nova decides at STOP 1.

### Branch Naming

```
feat/{issue-number}-{short-slug}
```

**Verified mappings (do NOT trust from memory):**
- S-074 → `feat/751-retire-legacy-writes`
- S-075 → `feat/752-embeddings-erasure`
- #746 → `feat/746-dsar-fulfillment`
- #748 → `feat/748-consent-audit-company`
- #743 → `spike/743-retention-design` (design doc, no code branch needed — or docs branch)

Branch from `dev`, PR targets `dev`. PR body must reference `Closes #<issue-number>`.

### TDD Cycle (per story)

Same as Sprints 3–5 (Red → Green → Refactor), plus:

1. **Comprehend** (⏸️ STOP) — Read story ACs from GitHub issue + relevant architecture section. **Verify issue number** via `gh issue view`. Present plan to Suga.
2. **Branch** (⏸️ STOP) — Create branch, confirm.
3. **Red → Green → Refactor** — Tests first.
4. **Specialist review** (per the Specialist Decisions section above — mandatory, not optional) — Nova confirms or adjusts at STOP 1, dispatches after Green:
   - S-074: `agency-agents/engineering-backend-architect`
   - S-075: `gensecai/privacy-engineer`
   - #743: Rex (design input, not subagent review)
   - #746: `gensecai/privacy-engineer`
   - #748: none (mechanical, pattern-proven)
   - Nova documents decision + findings on each story's GitHub Issue per ~/AGENTS.md
5. **Review** — Separate reviewer, Suga approves.
6. **Merge** — Sumanth approves merge.

### Key Files Nova Will Touch (Sprint 6)

| Story | Likely New Files | Existing Files to Check |
|-------|-----------------|------------------------|
| S-074 | 410 handlers + hit logging (in `routes/interviews.js`) | `routes/interviews.js` (5 endpoints: :98, :161, :247, :477, :585); read endpoints to preserve (`GET /history`, `GET /:id/analysis`); `routes/compliance.js` (DSAR export reader) |
| S-075 | Rescoped `lib/erasureService.js` | `lib/erasureService.js` (S-067), `migrations/008_matching_engine.js` (`candidate_embeddings` schema), `routes/auth.js` (delete-account flow) |
| #746 | `POST /api/compliance/data-requests/:id/fulfill` | `routes/compliance.js` (`data_requests` table), `lib/erasureService.js` (post-S-075 interface) |
| #748 | `company_id` threading in consent writes | `lib/consentService.js` (raw INSERTs bypassing `logAccess`), `lib/biometricAudit.js` (S-065 pattern) |
| #743 | Design doc (no code) | Rex's architectural input; BIPA §15(a) requirements; R2 storage costs |

### What Nova Must Read Before Starting

1. This sprint plan
2. The 5 items' GitHub issues (full ACs): #751, #752, #743, #746, #748
3. Backend-architect's scoping review on #742 (5 endpoints, blast radius, 410 method)
4. S-067's `lib/erasureService.js` — for S-075's rescope and #746's integration
5. S-065's migration 251 + `company_id` threading pattern — for #748
6. Privacy-engineer's #745 verdict (on #745) — for S-075's GDPR requirements

---

## Parallel Track: E-008 Observer Spec (Rex)

**Not in Sprint 6.** Rex specs the E-008 observer worker implementation in parallel.

**Week-1 checkpoint:** Rex's draft spec reviewed against S-070 (`lib/observerConsentGate.js`) and S-071 (`lib/observerReportStates.js`) assumptions. Purpose: find contract conflicts early while they're cheap.

**Expected spec coverage:** `observer_jobs` table, dispatch mechanism, LiveKit integration, analysis pipeline, S-070 gate integration, S-071 report-state integration.

**Sprint 7+:** Spec approval → implementation stories → Sprint 7 planning.

---

## Phase Gate Checklist

Before Sumanth approves this sprint plan:

- [ ] Sprint goal is clear and achievable in one sprint
- [ ] All 5 items have complete acceptance criteria (in GitHub issues)
- [ ] Dependencies are satisfied (S-067 ✅, S-065 ✅ merged; S-074 independent)
- [ ] **Issue numbers verified** via `gh issue view` title check (S-074→#751, S-075→#752, #743, #746, #748)
- [ ] Capacity check: 13/20 points with 7pt buffer
- [ ] Risks identified with mitigations (including R1's rollback plan for S-074)
- [ ] Nova's starting point is unambiguous (story order, branch naming with verified issue #s, TDD cycle, files, #746/S-075 ordering note)
- [ ] **Specialist decisions documented** for all 5 items (Yes/No + which specialist + why) in the Specialist Decisions section
- [ ] $0 infrastructure confirmed (no new services in Sprint 6)
- [ ] TDD + separate reviewer + issue-verification enforced
- [ ] Out-of-scope items documented with reasoning (#742 subsumed by S-074; #745 converted to S-075; #739 QA-ops; E-008 parallel track)
- [ ] **Sumanth's three approvals recorded** (legacy retirement breaking change; embeddings hard-delete + rescope; Sprint 6 direction)

---

*Next: Sumanth approves → Nova starts with S-074 → Lead tracks progress → Sprint 6 review → Sprint 7 (E-008 implementation + #743 build).*
