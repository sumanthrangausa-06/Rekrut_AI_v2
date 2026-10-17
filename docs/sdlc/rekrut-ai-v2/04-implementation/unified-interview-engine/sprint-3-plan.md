---
project: Unified Interview Engine
phase: 4-Implementation
sprint: 3
status: draft
created: 2026-10-10
owner: Sumanth
lead: Lead (Team Lead, smart-sdlc Phase 4)
capacity_points: 20
committed_points: 17
---

# Sprint 3 Plan — P0 Crypto + Frontend Integration

> **Status:** Draft | **Lead:** Lead | **Phase Gate:** Requires Sumanth's approval before Nova starts building.
> **Method:** smart-sdlc `sprint-planning`. Backlog: `docs/sdlc/rekrut-ai-v2/03-solutioning/unified-interview-engine/epics-stories.md`.
> **Sprint 2 retro:** 18/18 points delivered (S-058, S-001, S-003, S-012 + 7-day expiry fix). Velocity confirmed at ~18pts/sprint. **Major finding:** Nova's post-sprint audit revealed 4 of 7 implemented stories have frontend wiring gaps — backend built with no frontend callers (S-001: UI uses old endpoint; S-003: no heartbeats sent; S-011: withdrawn-consent UI never renders; S-014: audit log write-only). Root cause: Rex's architecture designed a greenfield client (`client/src/engine/interview/`) with zero migration plan for existing pages. Fixed via architecture §10 (Frontend Integration & Migration Plan, PR #716) and 7 new stories (S-059 through S-065).
> **Issue-number verification:** All story→issue mappings below verified via `gh issue view` title check on 2026-10-10. No trust-from-memory.

---

## Sprint Goal

**The P0 R2 encryption launch-blocker is resolved, the human-interview path works end-to-end (candidate request → recruiter dashboard → approval), the recruiter panel runs on the new session endpoint, and candidates who withdraw consent get a working recovery UI.**

---

## Stories in Scope

| ID | Title | Issue | Epic | Points | Priority | Dependencies |
|----|-------|-------|------|--------|----------|--------------|
| S-059 | R2 frame encryption with per-candidate DEK | #630 | E-002 | 5 | **P0 launch-blocker** | Requires S-058 ✅ (merged). |
| S-060 | Candidate — "Request Human Interview" button | #710 | E-002 | 3 | Core | Requires S-012 ✅ (merged). Blocks S-061. |
| S-061 | Recruiter — Pending human-interview requests dashboard | #711 | E-002 | 3 | Core | Requires S-060, S-012 ✅. |
| S-062 | Migrate InterviewPanel to new session endpoint | #712 | E-001 | 3 | Core | Requires S-001 ✅ (merged). |
| S-064 | Build withdrawn-consent recovery UI | #714 | E-002 | 3 | Core | Requires S-011 ✅ (merged). |

**Total committed:** 17 / 20 points (3pt buffer for specialist review-fix cycles).

### Dependency Chain

```
S-059 (R2 encryption, 5pts) ── requires S-058 ✅ ── parallel, no frontend deps
                                                    │
S-060 (request button, 3pts) ── requires S-012 ✅ ──┤
  └──→ S-061 (recruiter dashboard, 3pts) ── requires S-060
                                                    │
S-062 (InterviewPanel migration, 3pts) ── requires S-001 ✅ (independent)
                                                    │
S-064 (withdrawn-consent UI, 3pts) ── requires S-011 ✅ (independent)
```

Per Rex's architecture §10.2: S-060 before S-061 (dashboard needs requests to display). S-062 and S-064 are independent. S-059 is parallel-safe (backend crypto, no frontend dependencies).

### Why These Five

- **S-059** is a P0 launch-blocker — raw face frames upload to R2 unencrypted, bypassing S-058's entire crypto-shredding design. Discovered by the privacy engineer during S-058's specialist review. Non-negotiable for launch. Backend-only (crypto), so it runs parallel to frontend work.
- **S-060 → S-061** completes the human-interview path Sumanth explicitly asked about ("is this module going to work?"). S-012's backend is merged but unreachable — no frontend calls it. S-060 adds the candidate-facing button; S-061 adds the recruiter dashboard to approve/decline. Together they make the consent-decline flow work end-to-end.
- **S-062** migrates `InterviewPanel.tsx` from the old `POST /interview-sessions` to the new `POST /api/interviews/sessions` (S-001). Until this lands, S-001's endpoint is unreachable and old-endpoint deprecation (§10.3) is blocked.
- **S-064** fixes a compliance gap — S-011's backend sets `isConsentWithdrawn` but no UI renders the recovery path. Candidates who withdraw consent hit a dead error flag. BIPA's "real alternative" requirement is unmet in practice.

### Deferred to Sprint 4

| Story | Issue | Points | Reason |
|-------|-------|--------|--------|
| S-063 (Wire heartbeat and lifecycle to interview UI) | #713 | 5 | Largest story (5pts). `InterviewSession.tsx` migration is more complex than S-062's panel migration (heartbeat timers, pause/resume state, iOS Safari backgrounding). Fits Sprint 4 alongside remaining hardening. |
| S-065 (Audit log read endpoint and viewer UI) | #715 | 3 | Lowest urgency. Audit data is being written correctly (S-014); read access is admin-only and not launch-blocking. |

**Sprint 4 preview:** S-063 (5) + S-065 (3) = 8pts, leaving ~10pts for new stories (S-002 invite tokens, S-004 camera/mic init, S-057 encryption verification).

---

## Specialist Decisions (Mandatory — Sumanth's Directive, 2026-10-10)

*Per ~/AGENTS.md: at sprint planning, Lead MUST answer for each story: "Does this story need a specialist? Yes/No, and why." Specialists cover all domains, not just security.*

### S-059 — R2 frame encryption with per-candidate DEK (5pts, #630)

**Decision: YES — 3 specialists.**

| Specialist | Pool | Why |
|------------|------|-----|
| crypto-implementation-expert | gensecai (security-compliance) | R2 upload path encryption — must use S-058's `lib/biometricCrypto.js` correctly. Key handling in an async upload pipeline is easy to get wrong. |
| privacy-engineer | gensecai (security-compliance) — *proven on S-011, S-058* | Verify no plaintext frame touches R2 at any point (including retries, multipart uploads, error paths). |
| penetration-tester | voltagent — *proven Tier 1 on S-011* | Adversarial: can they intercept frames before encryption? Is the DEK accessible from the upload path? |

**Why:** P0 launch-blocker. This is the highest-risk story of the sprint — a flaw here means biometric data leaks to cloud storage unencrypted.

### S-060 — Candidate "Request Human Interview" button (3pts, #710)

**Decision: YES — 1 specialist.**

| Specialist | Pool | Why |
|------------|------|-----|
| ux-architect | voltagent | Candidate-facing button at a sensitive moment (just declined biometric consent). Copy, placement, and flow must feel respectful, not punitive. Same standard as S-012's backend copy review. |

**Why:** The UX architect's S-012 review caught bias-framing in notification copy. The same lens applies to the button that triggers this flow — tone matters at the moment of trust.

### S-061 — Recruiter pending requests dashboard (3pts, #711)

**Decision: YES — 1 specialist.**

| Specialist | Pool | Why |
|------------|------|-----|
| ux-architect | voltagent | Recruiter dashboard UX — request list, approve/decline actions, empty states. Must present candidate context without bias-framing (per S-012's HIGH-1 finding). |

**Why:** The dashboard displays the same sensitive flow from the recruiter's side. The S-012 review established that wording matters here — the dashboard must not define candidates by their refusal.

### S-062 — Migrate InterviewPanel to new session endpoint (3pts, #712)

**Decision: YES — 1 specialist.**

| Specialist | Pool | Why |
|------------|------|-----|
| react-specialist | (frontend specialists) | React migration review — endpoint swap in `InterviewPanel.tsx`, error handling for new 400/409 codes, ensuring all 4 modes work through the new endpoint. |

**Why:** This is a surgical frontend migration. A React specialist catches integration issues (stale closures, unhandled error states, mode-specific config shapes) that backend-focused review would miss.

### S-064 — Build withdrawn-consent recovery UI (3pts, #714)

**Decision: YES — 1 specialist.**

| Specialist | Pool | Why |
|------------|------|-----|
| ux-architect | voltagent | Consent withdrawal is a high-anxiety moment. The re-consent/exit UI must be clear, non-coercive, and unambiguous. Validates BIPA's "real alternative" requirement through UX. |

**Why:** Same reasoning as S-012's UX review — consent flows are trust-critical. A UX lens ensures the recovery path feels like a genuine choice, not a dark pattern.

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
- [ ] **Live demo:** Candidate declines biometric consent → clicks "Request Human Interview" → recruiter sees request in dashboard → approves → human-mode session created with zero biometric collection. Recruiter creates session from InterviewPanel via new endpoint. Candidate withdraws consent mid-flow → sees recovery UI → re-consents or exits cleanly.
- [ ] **R2 encryption verified:** No plaintext frames in R2 bucket (spot-check via R2 API); DEK destruction renders frames unrecoverable (test on scratch data).
- [ ] **Old endpoint still serving:** `POST /interview-sessions` NOT removed (S-063 not yet done — `InterviewSession.tsx` still uses old endpoints). Deprecation headers not yet added.
- [ ] **Cross-surface check:** New UI works on desktop Chrome + iPhone Safari (Sumanth's whole-app responsiveness rule).
- [ ] **No placeholder data:** All UI uses real API responses, not mocked.

---

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| R1 | S-059's R2 encryption may require R2 API credentials/bucket config that Nova doesn't have | Medium | High — P0 blocked | Nova checks R2 client config at Comprehend. If credentials are missing, implement the encryption wrapper with integration tests mocked, flag the live-R2 verification as a follow-up. $0 constraint: no new R2 buckets. |
| R2 | S-060's button placement in consent-screens.tsx may conflict with S-010's existing layout | Low | Low | Nova reads `consent-screens.tsx` at Comprehend. The S-010 AC-4 offer area is the natural placement. |
| R3 | S-061's dashboard may need a new recruiter page route — check if routing pattern exists | Low | Low | Nova checks `App.tsx` routing at Comprehend. If no recruiter dashboard section exists, create a minimal one (don't build a full dashboard). |
| R4 | S-062's migration may break existing recruiter workflows if the new endpoint has different response shapes | Medium | Medium | Nova compares old vs new response shapes at Comprehend. Add a compatibility shim in the frontend if needed (documented as tech debt). |
| R5 | S-064's recovery UI needs the `isConsentWithdrawn` flag — verify `lib/api.ts` still sets it | Low | Low | Nova verifies at Comprehend. Flag was confirmed in S-011 audit. |
| R6 | Sprint has 3 UX-architect reviews (S-060, S-061, S-064) — specialist bottleneck | Low | Low | Reviews run after Green, in parallel. UX architect reviews are typically fast (copy/flow, not code deep-dives). |

---

## Nova's Starting Point

### Story Order

1. **S-059** (5pts, #630) — R2 encryption. P0, backend-only, parallel-safe. Start here.
2. **S-060** (3pts, #710) — Request button. Requires S-012 ✅ (merged). Can start in parallel with S-059 (different files).
3. **S-061** (3pts, #711) — Recruiter dashboard. Requires S-060. Start after S-060's API contract is defined.
4. **S-062** (3pts, #712) — InterviewPanel migration. Requires S-001 ✅ (merged). Independent, can parallelize.
5. **S-064** (3pts, #714) — Withdrawn-consent UI. Requires S-011 ✅ (merged). Independent, good sprint-closer.

### Branch Naming

```
feat/{issue-number}-{short-slug}
```

**Verified mappings (do NOT trust from memory):**
- S-059 → `feat/630-r2-frame-encryption`
- S-060 → `feat/710-request-human-interview-btn`
- S-061 → `feat/711-recruiter-requests-dashboard`
- S-062 → `feat/712-interviewpanel-migration`
- S-064 → `feat/714-withdrawn-consent-ui`

Branch from `dev`, PR targets `dev`. PR body must reference `Closes #<issue-number>`.

### TDD Cycle (per story)

Same as Sprint 2 (Red → Green → Refactor), plus:

1. **Comprehend** (⏸️ STOP) — Read story ACs from GitHub issue + relevant architecture section (§10 for migration stories). **Verify issue number** via `gh issue view`. Present plan to Suga.
2. **Branch** (⏸️ STOP) — Create branch, confirm.
3. **Red → Green → Refactor** — Tests first.
4. **Specialist review** (per the Specialist Decisions section above — mandatory, not optional) — Nova confirms or adjusts at STOP 1, dispatches after Green:
   - S-059: `gensecai/crypto-implementation-expert` + `gensecai/privacy-engineer` + `voltagent/penetration-tester`
   - S-060: `voltagent/ux-architect`
   - S-061: `voltagent/ux-architect`
   - S-062: `react-specialist`
   - S-064: `voltagent/ux-architect`
   - Nova documents decision + findings on each story's GitHub Issue per ~/AGENTS.md
5. **Review** — Separate reviewer, Suga approves.
6. **Merge** — Sumanth approves merge.

### Key Files Nova Will Touch (Sprint 3)

| Story | Likely New Files | Existing Files to Check |
|-------|-----------------|------------------------|
| S-059 | R2 upload encryption wrapper (extend `lib/biometricCrypto.js` usage) | `lib/biometricCrypto.js` (S-058), R2 client config, frame upload path |
| S-060 | Button component in consent flow | `client/src/pages/consent-screens.tsx`, `POST /api/consent/human-interview-request` (S-012) |
| S-061 | Recruiter dashboard page/section | `client/src/App.tsx` (routing), `GET` requests endpoint (S-012), approve/decline endpoints |
| S-062 | (modify) `client/src/.../InterviewPanel.tsx` | Old `POST /interview-sessions` call, new `POST /api/interviews/sessions` (S-001) |
| S-064 | Recovery UI component | `client/src/lib/api.ts` (`isConsentWithdrawn` flag), consent screen routing |

### What Nova Must Read Before Starting

1. This sprint plan
2. The 5 stories' GitHub issues (full ACs)
3. Architecture §10 (Frontend Integration & Migration Plan) — especially §10.1 (page→endpoint map) and §10.2 (ordering rules)
4. ADR-012 (crypto-shredding / per-candidate DEKs) — for S-059
5. S-012's routes (`server/routes/human-interview-requests.js`) — for S-060/S-061
6. S-001's endpoint (`POST /api/interviews/sessions`) — for S-062
7. S-011's `isConsentWithdrawn` flag in `client/src/lib/api.ts` — for S-064

---

## Sprint 4 Preview (not committed)

| Focus | Candidate Stories | Points (est.) |
|-------|-------------------|---------------|
| Heartbeat + audit + new engine work | S-063 (heartbeat wiring, 5), S-065 (audit viewer, 3) | ~8 + new stories |

*(Detailed plan by Lead before Sprint 4, following this same process.)*

---

## Phase Gate Checklist

Before Sumanth approves this sprint plan:

- [ ] Sprint goal is clear and achievable in one sprint
- [ ] All 5 stories have complete acceptance criteria (in GitHub issues)
- [ ] Dependencies are satisfied (S-058 ✅, S-012 ✅, S-001 ✅, S-011 ✅ all merged)
- [ ] **Issue numbers verified** via `gh issue view` title check (S-059→#630, S-060→#710, S-061→#711, S-062→#712, S-064→#714)
- [ ] Capacity check: 17/20 points with 3pt buffer (within Sprint 1-2 velocity of ~18)
- [ ] Risks identified with mitigations
- [ ] Nova's starting point is unambiguous (story order, branch naming with verified issue #s, TDD cycle, files)
- [ ] **Specialist decisions documented** for all 5 stories (Yes/No + which specialist + why) in the Specialist Decisions section
- [ ] $0 infrastructure confirmed (no new services in Sprint 3)
- [ ] TDD + separate reviewer + issue-verification enforced
- [ ] Deferred stories documented with reasoning (S-063: largest, complex; S-065: lowest urgency)

---

*Next: Sumanth approves → Nova starts with S-059 → Lead tracks progress → Sprint 3 review → Sprint 4 planning.*
