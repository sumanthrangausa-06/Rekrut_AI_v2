---
project: Unified Interview Engine
phase: 4-Implementation
sprint: 5
status: draft
created: 2026-10-11
owner: Sumanth
lead: Lead (Team Lead, smart-sdlc Phase 4)
capacity_points: 20
committed_points: 11
---

# Sprint 5 Plan — Privacy Hardening + Audit Visibility

> **Status:** Draft | **Lead:** Lead | **Phase Gate:** Requires Sumanth's approval before Nova starts building.
> **Method:** smart-sdlc `sprint-planning`. Backlog: `docs/sdlc/rekrut-ai-v2/03-solutioning/unified-interview-engine/epics-stories.md`.
> **Sprint 4 retro:** 20/20 points delivered (S-066 QP consent gate backend, S-073 QP consent frontend — unplanned P0-blocker discovered mid-sprint, S-070 observer enqueue gate, S-071 report declined marking, S-063 heartbeat wiring, S-068 R2 cleanup script). All 6 PRs merged to `dev` (#732, #734, #735, #736, #737, #738). **Major findings:** S-066's backend couldn't merge without its frontend (Nova's "graceful degradation" was a silent consent bypass — privacy engineer caught it, fixed to fail-closed); S-070's gate flag was disconnected from the consent system of record (withdrawal wouldn't terminate an active observer — privacy engineer HIGH finding, fixed with consent-lifecycle sync + withdrawal teardown); S-073 shipped atomically with S-066. S-068's script is merged but **no deletion performed** — the actual `--delete` run is tracked as QA follow-up #739 (VM can't reach R2/B2; needs Sumanth's explicit approval).
> **Issue-number verification:** All story→issue mappings below verified via `gh issue view` title check on 2026-10-11. No trust-from-memory.

---

## Sprint Goal

**No unencrypted biometric data remains at rest (recordings encrypted like frames), deletion actually destroys keys (crypto-shredding wired into DSAR/account deletion), the audit log is readable by admins, and the observer disclosure tells the truth about declined biometrics.**

---

## Stories in Scope

| ID | Title | Issue | Epic | Points | Priority | Dependencies |
|----|-------|-------|------|--------|----------|--------------|
| S-069 | Encrypt full interview recordings (.webm) | #722 | E-002 | 3 | Core — closes S-059's last gap | Requires S-059 ✅ (merged) |
| S-067 | Wire destroyDEK into DSAR and account deletion | #720 | E-002 | 3 | Core — compliance | Requires S-058 ✅ (merged) |
| S-065 | Audit log read endpoint and viewer UI | #715 | E-002 | 3 | Core — admin visibility (4th sprint in backlog) | Requires S-014 ✅ (merged) |
| S-072 | Update AI Observer disclosure for declined biometrics | #726 | E-008 | 2 | Core — copy accuracy | Requires S-070 ✅ (merged) |

**Total committed:** 11 / 20 points (9pt buffer — light sprint, absorbs review-fix cycles and any S-069 streaming complexity).

**Points note:** S-072 estimated at 2pts (revised down from the rough 3pt Sprint 4 deferral estimate — it's a disclosure-text update in EN/HI plus UX-architect review and text-content tests, not a 3pt build).

### Dependency Chain

```
S-069 (webm encryption, 3pts) ── requires S-059 ✅ ── independent, highest value
S-067 (DSAR DEK wiring, 3pts) ── requires S-058 ✅ ── independent; covers S-069's
    recordings automatically once they use per-candidate DEKs
S-065 (audit viewer, 3pts) ── requires S-014 ✅ ── independent; displays S-067's
    DEK-destruction audit entries
S-072 (disclosure text, 2pts) ── requires S-070 ✅ ── independent, smallest
```

All four are mutually independent and can run in any order. Suggested order above: encryption first (real exposure), then deletion wiring (compliance), then audit viewer (visibility into both), then disclosure (smallest, fills buffer).

### Why These Four

- **S-069** closes S-059's last gap — full `.webm` recordings sit **unencrypted** in storage while the frames extracted from them are encrypted. Same biometric content plus audio, zero protection. Flagged H-4 by the privacy engineer during S-059's review. This is the highest-value remaining privacy item.
- **S-067** makes deletion real — `destroyDEK` exists but is never called, so "delete my data" doesn't crypto-shred anything. DSAR erasure and account deletion must destroy the candidate's DEK (rendering all encrypted biometric data unrecoverable) and log it. Compliance gap, triggers on actual deletion requests.
- **S-065** makes the audit log readable — S-014 writes entries nobody can read. Admin/recruiter-lead GET endpoint + viewer UI with filters and pseudonymized refs. Fourth sprint in the backlog; still the lowest urgency, but the viewer now displays S-067's DEK-destruction entries, giving it a concrete Sprint 5 purpose beyond "nice to have."
- **S-072** tells the truth — FR-85's "may include AI-assisted analysis" is wrong when biometrics are declined (S-070 guarantees the observer never joins). Small copy change, must not overpromise in either direction (video still recorded; answer is definitively "no AI analysis," not "may include").

### Explicitly Out of Scope

| Item | Reason |
|------|--------|
| E-008 observer worker stories (S-046–S-049, #694–#697) | Labeled `phase-3` (solutioning) — Rex has not produced implementation-ready specs. No implementation without an approved plan (standing rule). |
| S-068 deletion run (#721 / follow-up #739) | Script merged in Sprint 4. The `--delete` run is a QA-stage ops action gated on Sumanth's explicit approval — not a Sprint 5 build story. Tracked in #739. |
| Other phase-3 stories (S-002–S-054) | Solutioning backlog, not approved for implementation sprints. |

**Capacity note:** Only 12pts of approved implementation work existed in the backlog; Sprint 5 commits 11pts. The remaining capacity is intentional buffer, not missing scope — the next approved work (E-008 observer implementation) needs Rex's solutioning first.

---

## Specialist Decisions (Mandatory — Sumanth's Directive, 2026-10-10)

*Per ~/AGENTS.md: at sprint planning, Lead MUST answer for each story: "Does this story need a specialist? Yes/No, and why." Specialists cover all domains, not just security. Pools verified in ~/workspace/SKILL_MAP.md.*

### S-069 — Encrypt full interview recordings (.webm) (3pts, #722)

**Decision: YES — 2 specialists.**

| Specialist | Pool | Why |
|------------|------|-----|
| crypto-implementation-expert | gensecai | Envelope format for large files — S-059's frame envelope may not suit multi-MB webm. Streaming/chunked decryption for playback (recordings are larger than frames; loading whole file into memory is a risk). |
| privacy-engineer | gensecai (security-compliance) — *proven on S-011, S-058, S-059* | BIPA/GDPR sufficiency — verify no plaintext-at-rest path remains (upload, temp files, CDN), playback authorization is airtight. |

**Why:** This is a crypto-design story, not just a wiring story. The issue itself flags streaming decryption as an open question — exactly what the crypto-implementation-expert resolves.

### S-067 — Wire destroyDEK into DSAR and account deletion (3pts, #720)

**Decision: YES — 1 specialist.**

| Specialist | Pool | Why |
|------------|------|-----|
| privacy-engineer | gensecai (security-compliance) — *proven on S-011, S-058, S-059* | DSAR/erasure workflow correctness under GDPR/CCPA — verify every deletion path calls destroyDEK (no path missed), audit entries are written with pseudonymized refs, no ordering bug (destroy key before vs after deleting metadata). |

**Why:** Deletion-path completeness is a checklist problem — the specialist verifies no caller was missed.

### S-065 — Audit log read endpoint and viewer UI (3pts, #715)

**Decision: YES — 1 specialist.**

| Specialist | Pool | Why |
|------------|------|-----|
| privacy-engineer | gensecai (security-compliance) | Audit data sensitivity — verify access control (admin/recruiter-lead only), candidate refs pseudonymized per S-057 scope, no PII leakage through filters or exports. |

**Why:** The issue's own suggested specialist. An audit viewer that leaks PII is worse than no viewer.

### S-072 — Update AI Observer disclosure for declined biometrics (2pts, #726)

**Decision: YES — 1 specialist.**

| Specialist | Pool | Why |
|------------|------|-----|
| ux-architect | voltagent | Disclosure clarity — "no AI analysis" must be unambiguous without implying "no video recorded." Same trust surface as S-060/S-064/S-071 reviews (all caught false-promise copy). |

**Why:** The issue's own suggested specialist. Every consent-surface copy change in this project has needed UX-architect correction so far (S-060, S-064, S-071) — no reason to skip it here.

### Specialist Tracking

Per ~/AGENTS.md, Nova will document on each story's GitHub Issue:
1. At STOP 1: her specialist decision (confirming or adjusting the above)
2. After review: findings and fixes
3. In the PR body: "Specialist Reviews" section

**Estimate impact:** None. Specialist reviews run after Green (implementation complete), before PR creation. The 9pt sprint buffer absorbs review-fix cycles.

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
- [ ] **Recordings encrypted:** `.webm` uploads are DEK-encrypted before storage; playback requires authorization + server-side decryption (verified via storage inspection).
- [ ] **Deletion destroys keys:** Account deletion and DSAR erasure call `destroyDEK`; every destruction writes a pseudonymized audit entry (verified via test + audit log).
- [ ] **Audit readable:** Admin can list/filter biometric audit entries; candidate refs pseudonymized; access restricted to admin/recruiter-lead.
- [ ] **Disclosure accurate:** FR-85 text states no AI analysis occurs when biometrics are declined, without implying no video is recorded.
- [ ] **Cross-surface check:** New/changed UI works on desktop Chrome + iPhone Safari (Sumanth's whole-app responsiveness rule).
- [ ] **No placeholder data:** All UI uses real API responses, not mocked.

---

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| R1 | S-069's streaming decryption — webm files are multi-MB; naive decrypt-then-serve loads whole file into memory | Medium | Medium | crypto-implementation-expert reviews the design at Green. Fallback: HTTP range-request decryption or pre-signed decrypt-proxy URLs (S-059's frame-proxy pattern). Nova flags at STOP 1 if the design needs a product call. |
| R2 | S-067's deletion-flow locations — account-deletion and DSAR erasure handlers need discovery; there may be more than one path | Low | Medium | Nova locates all callers at Comprehend (codebase-memory). Privacy-engineer verifies completeness at review. |
| R3 | S-065's pseudonymization must match S-057's convention — wrong format breaks cross-referencing | Low | Low | Nova checks S-057's implementation at Comprehend. Privacy-engineer verifies at review. |
| R4 | S-069's AC-3 (DEK destruction renders recordings unrecoverable) depends on S-067's wiring being correct | Low | Low | Automatic if recordings use per-candidate DEKs (S-069's design) and S-067 wires destroyDEK into deletion (its AC-1/AC-2). Test asserts the chain end-to-end. |
| R5 | Light sprint (11/20) may tempt scope creep | Low | Low | Buffer is intentional. New work needs its own story + Sumanth's approval — do not absorb unplanned work into Sprint 5. |

---

## Nova's Starting Point

### Story Order

1. **S-069** (3pts, #722) — WebM encryption. Highest value, independent. Start here.
2. **S-067** (3pts, #720) — DSAR DEK wiring. Requires S-058 ✅ (merged). Independent — can parallelize with S-069.
3. **S-065** (3pts, #715) — Audit viewer. Requires S-014 ✅ (merged). Independent — good mid-sprint story.
4. **S-072** (2pts, #726) — Disclosure text. Requires S-070 ✅ (merged). Independent, smallest — good sprint-closer.

### Branch Naming

```
feat/{issue-number}-{short-slug}
```

**Verified mappings (do NOT trust from memory):**
- S-069 → `feat/722-webm-encryption`
- S-067 → `feat/720-dsar-dek-wiring`
- S-065 → `feat/715-audit-viewer`
- S-072 → `feat/726-observer-disclosure`

Branch from `dev`, PR targets `dev`. PR body must reference `Closes #<issue-number>`.

### TDD Cycle (per story)

Same as Sprints 3–4 (Red → Green → Refactor), plus:

1. **Comprehend** (⏸️ STOP) — Read story ACs from GitHub issue + relevant architecture section (§10 for migration stories, §3.19 for observer stories, ADR-012 for crypto). **Verify issue number** via `gh issue view`. Present plan to Suga.
2. **Branch** (⏸️ STOP) — Create branch, confirm.
3. **Red → Green → Refactor** — Tests first.
4. **Specialist review** (per the Specialist Decisions section above — mandatory, not optional) — Nova confirms or adjusts at STOP 1, dispatches after Green:
   - S-069: `gensecai/crypto-implementation-expert` + `gensecai/privacy-engineer`
   - S-067: `gensecai/privacy-engineer`
   - S-065: `gensecai/privacy-engineer`
   - S-072: `voltagent/ux-architect`
   - Nova documents decision + findings on each story's GitHub Issue per ~/AGENTS.md
5. **Review** — Separate reviewer, Suga approves.
6. **Merge** — Sumanth approves merge.

### Key Files Nova Will Touch (Sprint 5)

| Story | Likely New Files | Existing Files to Check |
|-------|-----------------|------------------------|
| S-069 | Encrypted recording upload path (extends `r2FrameStore.js` pattern) | `routes/interviews.js:416` (upload site), `lib/r2FrameStore.js` (S-059 envelope), `server/routes/frame-proxy.js` (decrypt-proxy pattern for playback) |
| S-067 | DEK-destruction calls in deletion flows | `lib/biometricCrypto.js` (`destroyDEK`, S-058), account-deletion flow, DSAR erasure handler, `lib/biometricAudit.js` (S-014 audit log) |
| S-065 | `GET /api/admin/biometric-audit` route, admin viewer page | `lib/biometricAudit.js` (S-014 write path), S-057 pseudonymization convention, admin role middleware |
| S-072 | Updated FR-85 disclosure text (EN/HI) | Consent/disclosure content store, S-070's gate (`lib/observerConsentGate.js`) for accurate wording |

### What Nova Must Read Before Starting

1. This sprint plan
2. The 4 stories' GitHub issues (full ACs)
3. S-059's `lib/r2FrameStore.js` + `server/routes/frame-proxy.js` — envelope and decrypt-proxy patterns for S-069
4. S-058's `lib/biometricCrypto.js` (`destroyDEK`) — for S-067
5. S-014's `lib/biometricAudit.js` — for S-065 (read path) and S-067 (audit entries)
6. S-070's `lib/observerConsentGate.js` — for S-072's accurate wording

---

## Phase Gate Checklist

Before Sumanth approves this sprint plan:

- [ ] Sprint goal is clear and achievable in one sprint
- [ ] All 4 stories have complete acceptance criteria (in GitHub issues)
- [ ] Dependencies are satisfied (S-059 ✅, S-058 ✅, S-014 ✅, S-070 ✅ all merged)
- [ ] **Issue numbers verified** via `gh issue view` title check (S-069→#722, S-067→#720, S-065→#715, S-072→#726)
- [ ] Capacity check: 11/20 points with 9pt buffer (light sprint — only 11pts of approved work exists; E-008 implementation needs Rex's solutioning)
- [ ] Risks identified with mitigations
- [ ] Nova's starting point is unambiguous (story order, branch naming with verified issue #s, TDD cycle, files)
- [ ] **Specialist decisions documented** for all 4 stories (Yes/No + which specialist + why) in the Specialist Decisions section
- [ ] $0 infrastructure confirmed (no new services in Sprint 5)
- [ ] TDD + separate reviewer + issue-verification enforced
- [ ] Out-of-scope items documented with reasoning (E-008 worker stories: phase-3, need Rex; S-068 deletion: QA follow-up #739, needs Sumanth's approval)

---

*Next: Sumanth approves → Nova starts with S-069 → Lead tracks progress → Sprint 5 review → E-008 solutioning (Rex) for future sprints.*
