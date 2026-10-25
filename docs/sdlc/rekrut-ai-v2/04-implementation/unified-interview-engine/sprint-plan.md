---
project: Unified Interview Engine
phase: 4-Implementation
sprint: 1
status: draft
created: 2026-10-10
owner: Sumanth
lead: Lead (Team Lead, smart-sdlc Phase 4)
capacity_points: 20
committed_points: 18
---

# Sprint 1 Plan — Consent & Compliance Foundation

> **Status:** Draft | **Lead:** Lead | **Phase Gate:** Requires Sumanth's approval before Nova starts building.
> **Method:** smart-sdlc `sprint-planning`. Backlog: `docs/sdlc/rekrut-ai-v2/03-solutioning/unified-interview-engine/epics-stories.md`.
> **Specialist note:** Sprint-prioritizer skill reviewed; selection is dependency-driven (deterministic), so Lead made the final call directly.

---

## Sprint Goal

**Consent is enforceable end-to-end: candidates see versioned consent screens, receipts are stored immutably, the API middleware blocks all biometric collection without valid consent, and every access is audit-logged.**

---

## Stories in Scope

| ID | Title | Epic | Points | Priority | Dependencies |
|----|-------|------|--------|----------|--------------|
| S-056 | Biometric privacy policy page | E-002 | 2 | Core | None. Blocks S-010. |
| S-010 | Three separate consent screens (+ AI disclosure) | E-002 | 8 | Core | Requires S-056. Blocks S-011. |
| S-011 | Consent enforcement middleware (API gate) | E-002 | 5 | Core | Requires S-010. Blocks S-001, S-022, S-028. |
| S-014 | Biometric audit log (append-only) | E-002 | 3 | Core | None. Required by S-013b, S-015, S-016b, S-017, S-018. |

**Total committed:** 18 / 20 points (2pt buffer for first-sprint uncertainty).

### Dependency Chain

```
S-056 (policy page, 2pts)
  └──→ S-010 (consent screens, 8pts)
         └──→ S-011 (middleware gate, 5pts)  ← THE critical path deliverable
S-014 (audit log, 3pts) — parallel, no dependencies
```

### Why These Four

- **S-056 → S-010 → S-011** is the unbreakable chain: the middleware (S-011) is the single story that gates *every* biometric endpoint in the entire engine. Nothing in E-004 (integrity), E-005 (behavioral), or E-008 (observer) can ship without it.
- **S-014** (audit log) has 5 downstream dependents across Sprints 2–3. Building it now prevents Sprint 2 stalls.
- **Deferred to Sprint 2:** S-058 (segregation, 5pts) — architecturally foundational but not on the consent-gating critical path. S-012 (decline path, 3pts) — requires S-001 (session engine, E-001), which isn't built yet.

---

## Definition of Done

### Per Story
- [ ] All acceptance criteria pass (from `epics-stories.md`)
- [ ] Unit tests written FIRST (TDD Red), implementation makes them pass (Green), code cleaned (Refactor)
- [ ] Separate reviewer approves the PR (not the implementer)
- [ ] No `console.log` debug code, no TODOs, no commented-out blocks
- [ ] Branch merged to `dev` via PR (never direct push)

### Sprint-Level
- [ ] **Live demo:** Candidate flow shows 3 consent screens → accepts → biometric API call succeeds; declines → gets `403 CONSENT_REQUIRED`; withdraws mid-session → subsequent calls get `403 CONSENT_WITHDRAWN`
- [ ] **Consent version bump test:** Change consent text → existing receipt rejected with `403 CONSENT_VERSION_STALE`
- [ ] **Audit log immutability test:** Attempted UPDATE/DELETE on `biometric_audit_log` is blocked by DB trigger (not just app logic)
- [ ] **Cross-surface check:** Consent screens render correctly on iPhone Safari + desktop Chrome (per Sumanth's whole-app responsiveness rule)
- [ ] **No placeholder data:** Policy page has real legal-reviewed content (or clearly marked "DRAFT — pending counsel")

---

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| R1 | Consent screen copy not ready (needs legal review) | Medium | High — blocks S-010 | Use clearly-marked draft copy; legal reviews in parallel; S-056 links are updatable |
| R2 | First sprint — velocity unknown, 18pts may be optimistic | Medium | Medium | 2pt buffer built in; S-014 can slip to Sprint 2 without blocking the S-056→S-010→S-011 chain |
| R3 | `requireBiometricConsent` middleware design unclear on token-to-receipt lookup | Low | High — blocks S-011 | Architecture §6 specifies the pattern; Nova reads it before starting (Comprehend step) |
| R4 | DB migration conflicts with existing `recording_consent` table | Medium | Medium | Scout flagged this in Phase 0; Nova checks migration 128/129 double-definition before writing new migration |
| R5 | Brevo OTP not needed in Sprint 1 (S-016a is Sprint 3) — no risk | — | — | Noted for clarity |

---

## Nova's Starting Point

### Story Order

Nova picks up stories in dependency order. **Start with S-056** (smallest, no dependencies, unblocks S-010):

1. **S-056** (2pts) — policy page. Get a quick win, establish the branch/PR/test rhythm.
2. **S-014** (3pts) — audit log. Parallel-safe (no dependencies). Can be done while S-010 is in review.
3. **S-010** (8pts) — consent screens. The big one. Requires S-056 merged.
4. **S-011** (5pts) — middleware. Requires S-010 merged. The sprint's keystone deliverable.

### Branch Naming

```
feat/{issue-number}-{short-slug}
```

- Look up the GitHub issue number: `gh issue list --search "S-056" --repo sumanthrangausa-06/Rekrut_AI_v2`
- Example: `feat/612-biometric-policy-page`
- Branch from `dev`, PR targets `dev`. Never push to `staging` or `main`.

### TDD Cycle (per story)

For each story, Nova follows **Red → Green → Refactor**:

1. **Comprehend** (⏸️ STOP) — Read the story's ACs, the PRD section, and the architecture component. For S-011, read architecture §6 (consent enforcement) and the error catalog (`CONSENT_REQUIRED`, `CONSENT_VERSION_STALE`, `CONSENT_WITHDRAWN`). Present understanding to Suga before writing code.
2. **Branch** (⏸️ STOP) — Create feature branch, confirm with Suga.
3. **Red** — Write failing tests first:
   - Middleware (S-011): `server/__tests__/middleware/requireBiometricConsent.test.js`
   - DB trigger (S-014): `server/__tests__/migrations/biometric-audit-append-only.test.js`
   - API (S-010): `server/__tests__/routes/consent.test.js`
   - Run: `npx jest --testPathPatterns="server/__tests__" --forceExit` → confirm RED
4. **Green** — Write minimum implementation to pass. No gold-plating.
5. **Refactor** — Clean up, check ponytail discipline (reuse > stdlib > platform > minimal code).
6. **Review** — Separate reviewer (not Nova) reviews the diff. Suga approves.
7. **Merge** — PR to `dev` with: story issue #, test results, reviewer approval.

### Key Files Nova Will Touch (Sprint 1)

| Story | New Files | Existing Files |
|-------|-----------|----------------|
| S-056 | `client/src/pages/privacy/biometric-policy.tsx` (or static route) | `client/src/App.tsx` (route) |
| S-010 | `client/src/pages/candidate/consent-screens.tsx`, `server/routes/consent.js` | — |
| S-011 | `server/middleware/requireBiometricConsent.js` | `server.js` (mount), biometric routes (apply) |
| S-014 | `migrations/2xx_biometric_audit_log.js` | `lib/db.js` (if pool changes needed) |
| All | `server/__tests__/{middleware,routes,migrations}/*.test.js` | — |

### What Nova Must Read Before Starting

1. This sprint plan
2. The 4 stories in `epics-stories.md` (full ACs + technical notes)
3. PRD §9 vocabulary (consent types, error codes)
4. Architecture §4 (table schemas for `consent_texts`, `consent_receipts`, `biometric_audit_log`) and §6 (middleware pattern, error catalog)
5. Scout's Phase 0 note on migrations 128/129 double-definition

---

## Sprint 2–5 Outline

| Sprint | Focus | Key Stories | Points (est.) |
|--------|-------|-------------|---------------|
| **2** | Biometric storage foundation + ID verification | S-058 (segregation), S-057 (encryption), S-013a (face-match), S-015 (purges) | ~18 |
| **3** | Data rights (DSAR + deletion) | S-016a (step-up auth), S-016b (export), S-013b (ID deletion), S-017 (delete-my-data) | ~18 |
| **4** | Session engine core begins | S-001 (create session), S-002/S-003 (join flows), S-006 (pre-flight) | ~18 |
| **5** | Session engine + calibration | S-004/S-005 (turn-taking), S-019/S-020 (calibration protocol) | ~18 |

*(Detailed sprint plans to be written by Lead before each sprint, following this same process.)*

---

## Parallelization Opportunities

Per Rex's architecture notes and the epic dependency order:

- **E-002 (consent) → E-001 (session):** Strictly sequential for S-011 → S-001. But once S-011's middleware *interface* is defined (end of Sprint 1), E-001 stories can be built against the interface in parallel.
- **E-009 (metering/admin):** Can parallelize from Sprint 4+ once E-001's metering hooks exist. Independent enough for a second implementer if capacity grows.
- **E-008 (AI observer):** Largely independent after Sprint 8 (needs session + reporting + behavioral). Good candidate for parallel track.
- **E-003 (calibration):** Must complete before E-004's signal stories are meaningful, but the calibration *protocol* (S-019/S-020) can be built in parallel with E-001.

**Current plan assumes single implementer (Nova).** If a second developer joins, Lead will re-plan with parallel tracks.

---

## Phase Gate Checklist

Before Sumanth approves this sprint plan:

- [ ] Sprint goal is clear and achievable in one sprint
- [ ] All 4 stories have complete acceptance criteria (in `epics-stories.md`)
- [ ] Dependencies are satisfied (no story blocked by work outside this sprint, except noted S-012 deferral)
- [ ] Capacity check: 18/20 points with 2pt buffer
- [ ] Risks identified with mitigations
- [ ] Nova's starting point is unambiguous (story order, branch naming, TDD cycle, files)
- [ ] $0 infrastructure confirmed (no new services in Sprint 1)
- [ ] TDD + separate reviewer enforced

---

*Next: Sumanth approves → Nova starts with S-056 → Lead tracks progress → Sprint 1 review → Sprint 2 planning.*
