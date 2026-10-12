---
project: Unified Interview Engine
phase: 4-Implementation
sprint: 10
status: draft
created: 2026-10-12
owner: Sumanth
lead: Lead (Team Lead, smart-sdlc Phase 4)
capacity_points: 20
committed_points: 15
---

# Sprint 10 Plan — Observer Renderer, E-004/E-005 Decision Path, Threat-Intel Planning

> **Status:** Draft | **Lead:** Lead | **Phase Gate:** Requires Sumanth's approval before work starts.
> **Method:** smart-sdlc `sprint-planning` + `writing-plans`. Backlog: `docs/sdlc/rekrut-ai-v2/03-solutioning/unified-interview-engine/epics-stories.md`.
> **Sprint 9 retro:** Planned 6/20 (two specs); delivered both specs plus the full E-008 build track (S-046 #773, S-047 #774, S-048 #775, S-049a #778) after Sumanth's mid-sprint approvals. Sprint 9's defining event was the S-049 split — Nova's STOP 1 caught the spec's `AnalysisService`/`IntegrityService` assumption (neither exists), and the Rex × Nova × Lead panel re-scoped honestly: S-049a shipped, #697 became S-049b (blocked by #674/#681), and a Gate A decision path was created. **Process win:** dependency verification is now a hard rule — every spec dependency carries a verified state, and unverified dependencies block approval (E-008 spec §11; Lead repo-checks dependency lists at planning). Full retro: `sprint-9-retro.md` (in this PR).
> **Issue-number verification:** Every story→issue mapping below was verified via `gh issue view` title check on 2026-10-12, and every code claim was checked against `dev` at `feee94ee`. No trust-from-memory. Where Sprint 10 needs new story issues (S-082, S-083, S-084), Lead creates them on plan approval — numbers below are the reserved story IDs.
> **Sumanth's decisions carried forward:** (1) Threat-intel spec (#764) approved 2026-10-12 for Sprint 10 implementation planning — conditions: HIBP ToS verification, AbuseIPDB DPIA. (2) #766 role model — Rex's recommendations delivered, no decision yet. NOT in this sprint. (3) #721/#739 R2 cleanup, #336 test accounts (205/206), #151 test data — pre-launch track. (4) #777 biometric-policy promise — pre-launch track.

---

## Sprint Goal

**Close the E-008 loop honestly (S-039 renderer over real report rows), produce the evidence for Sumanth's E-004/E-005 launch-scope decision (spike → Gate A brief), and turn the approved threat-intel spec into a costed, gated story backlog.**

---

## Decisions Sumanth Is Asked to Make at This Gate

### D1 — Track B qa-report rename: decouple from S-049b? ⚠️ Sequencing tension (explicit)

The panel sequenced the rename (`POST …/observer/report` → `POST …/observer/qa-report`, deprecated alias for one sprint) **before S-039**, and placed it inside S-049b (#697). Both facts verified. But S-049b is blocked by S-027 (#674) + S-034 (#681), which wait on the Gate A decision this sprint produces. **Taken literally, the rename cannot precede S-039 unless it leaves S-049b** — the dependency is circular. The collision is real (verified in code): `routes/interview-sessions.js:1224` — the Track B POST occupies the E-008 report's route name, and no GET content endpoint for `ai_observer_reports` exists yet (S-047's `GET …/observer/status` returns metadata only). S-039 defines the read contract, so what the GET is called — and what it sits next to — gets decided when S-039 is built.

- **Option A (Lead recommends):** Pull the rename out of S-049b into a small standalone story (**S-083**, 2 pts, Nova), executed before S-039's read contract lands. The rename has zero dependency on the analysis pipeline — its only link to S-049b was bookkeeping. S-049b keeps the GET endpoint's full contract, real analysis, and the advisory lock.
- **Option B:** S-039 reads report content via a non-colliding interim path; rename + canonical GET wait for S-049b. Cost: S-039's read contract is built twice, and the Track B name collision persists into the renderer era.

Lead does **not** reorder silently — D1 is Sumanth's call at plan approval. S-039's start is sequenced after D1 either way (see Dependency Chain).

### D2 — HIBP cost finding: the approved spec's "free tier" assumption is wrong (verified)

Background research flagged this; **Lead verified it directly against HIBP's own API documentation and pricing on 2026-10-12:**

- Searching HIBP by email address **requires a paid subscription key**. There is no free API tier for email breach lookup (the only key-free API is Pwned Passwords, which is irrelevant to applicant checks). The spec's §3.1 "Commercial (free tier)" line is incorrect.
- The **direct** email lookup (sends the candidate's full email address to HIBP — their docs state this "discloses it to HIBP") is available on the cheapest tier, Core 1: **$52.68/yr** (10 requests/min).
- The **k-anonymity** lookup — the privacy-preserving pattern the spec describes (§3.1), which sends only a hash prefix — is restricted to **Pro and High RPM tiers**. Pro 1 is **$4,548/yr**.
- Either price fails the spec's own §3.3 $0 constraint: *"If a source requires payment, it is out of scope until Sumanth approves budget."*

**Planning posture proposed (no budget requested at this gate):** S-084 scopes threat-intel v1 on the sources that survive at $0 — AbuseIPDB (free tier, DPIA + notice per spec) and FBI IC3 (trend context) — and plans the HIBP email-breach signal as a separately-gated story whose entry conditions are (i) ToS verification for employment-screening use (still open, per Sumanth's approval condition) and (ii) a budget decision between the Core direct-lookup shape ($52.68/yr, full-email disclosure — privacy-engineer must rule on acceptability) and Pro k-anonymity ($4,548/yr). Sumanth decides the budget question when the HIBP story is proposed for a sprint, not now.

---

## Stories in Scope

| ID | Title | Issue | Epic | Points | Owner | Dependencies |
|----|-------|-------|------|--------|-------|--------------|
| S-082 | Audit spike: `interview-ai.js` reusability + E-004/E-005 re-size | new (on approval) | E-004/E-005 | 3 | Rex | None — starts day 1 |
| S-039 | Human interview side-by-side report (renderer) | #686 | E-006 | 5 | Nova | Spike's projection-contract note; D1 (rename first, if Option A) |
| S-083 | Track B qa-report route rename (conditional — D1 Option A only) | new (on approval) | E-008 | 2 | Nova | D1 approval |
| S-084 | Threat-intel implementation planning (story breakdown) | #764 (parent) | — | 2 | Lead | Spec approved; D2 posture |
| — | Gate A brief: E-004/E-005 launch-scope decision (one page) | deliverable → #634/#697 | E-004 | 2 | Lead | S-082 spike output |
| F4 | Guard `observerJobs.cancel()`/`fail()` | #779 | E-008 | 1 | Nova | None |

**Total committed:** 15 / 20 points (13 if D1 Option B — S-083 drops out). 5 points held against S-039 growth and rename friction (client call sites).

**Points & scope notes:**

- **S-082 (3 pts, timeboxed — Rex):** What in `services/interview-ai.js` (the real shared stack: transcript→scoring, reused by mock/screening/Track B) is reusable by a **single-consumer** behavioural/integrity pipeline; a re-sized E-004/E-005 cost range **against real code**; deferral cost/risk of shipping January without them. **Explicitly NOT a shared-service design** (panel decision: building a shared service for one consumer is premature abstraction). One output is time-critical for S-039: the **projection-contract note** — `integrity_summary` as a derived, regenerable projection of a future `integrity_events` table (spec §4.3), so S-039 renders the frozen shape without locking onto populated-shape assumptions.
- **S-039 (5 pts, as filed — Nova):** Renders `ai_observer_reports` in the side-by-side report. **Honest re-scope, recorded here and to be reconciled on #686 at sprint start:** AC-1's "AI Observer Analysis" column will render the frozen §4.3 sections in their current `missing` state as **"Insufficient data / N/A"** — Sumanth's no-fake-scores standard, and the panel's defined behaviour, not a placeholder. Populated-shape rendering arrives with S-049b. AC-2 (discrepancy highlighting) applies only when both columns carry data; with missing observer sections there is nothing to highlight and the UI must say so plainly, in observational language. AC-3 (observer not enabled → interviewer column only) is fully buildable now. The GET read endpoint is built here per the panel's placement (S-039 defines the read contract) — its path is set by D1's outcome.
- **S-083 (2 pts, conditional — Nova):** Route rename + one-sprint deprecated alias + client call-site updates + tests. Small, mechanical, zero pipeline dependency. Exists only under D1 Option A; under Option B it returns to S-049b's scope on #697.
- **S-084 (2 pts — Lead):** Planning only, **no code**. Break the approved #764 spec into implementation stories (issues created, pointed, dependency-checked per the new verification rule), covering: check pipeline + `threat_intel_checks` table, AbuseIPDB integration (DPIA + notice tasks as entry conditions), recruiter review UI signals (confirm/dismiss, no auto-reject, no scores), erasure wiring (rows die with the application), and the HIBP story held behind its two gates (ToS + budget, per D2). Also carries the spec's three open questions to Sumanth in decision-ready form (jurisdiction notification approach; IP logging with DPIA + notice; confirm email+IP-only v1 scope).
- **Gate A brief (2 pts — Lead):** One page. Consumes S-082's re-sized range and deferral analysis; states the launch-scope options for E-004 (#634) / E-005 (#635) and what each means for S-049b (#697) and the January launch. The ~80-pt Phase-3 figure (E-004 57 + E-005 23) is **labelled unverified** everywhere it appears until the spike lands. **Sumanth's binding decision is required before Sprint 11 planning begins** — it is a Definition-of-Done item for this sprint, not a hope.
- **F4 / #779 (1 pt — Nova):** Mirror S-049a's status guards onto `cancel()`/`fail()` so a late cancel can't overwrite a terminal `complete`. Pattern already established in the same file; tests included.

### Dependency Chain

```
S-082 spike ──► projection-contract note ──► S-039 (#686) read contract
S-082 spike ──► Gate A brief ──► Sumanth decision (before Sprint 11 planning)
                                   └─► S-049b (#697) unblocks via #674/#681 IF ruled in-scope
D1 ──► (Option A) S-083 rename ──► S-039 (#686)
S-084 threat-intel planning ──► implementation stories (Sprint 11+, entry-condition gated)
F4 (#779) — independent, any time
```

**Sequencing:** Week 1 — Rex starts S-082; Nova starts S-083 (if D1-A) then S-039 groundwork; Lead runs S-084 in parallel. S-039's read-contract work waits for the spike's projection note (internal milestone, days not weeks). Gate A brief lands as soon as the spike closes; Sumanth's decision is chased before sprint end, not at Sprint 11's door.

---

## Architectural Review (Pre-Sprint)

Per Sumanth's standing rule, Rex reviews architectural changes before sprint planning finalizes. This sprint's architectural content is (a) Rex's own spike — he is the author, not a reviewer of it — and (b) the S-039 read contract + the D1 rename question, which comes from the panel Rex sat on; the plan surfaces D1 to Sumanth rather than re-litigating it. **Post-implementation Rex review applies as standard** to the S-039 and S-083 PRs, including being briefed on specialist fixes before merge (the Sprint 8/9 norm Sumanth checks for).

---

## Specialist Plan

**Planning-level answer (mandatory):** Sprint 10 planning itself used verification, not a dispatched specialist — every claim above was checked against GitHub, the codebase, or the vendor's own documentation (HIBP). The specialist need sits at story level:

| Story | Planned specialist | Why |
|-------|-------------------|-----|
| S-039 | `gensecai/privacy-engineer` | **Risk domain = disclosure accuracy at render time.** The renderer must never present missing analysis as present, must render consent states honestly (granted/declined/unknown — the S-048 lesson), and must not leak observer content for sessions where consent was withdrawn. Same domain that produced blockers in S-046/S-047/S-048. |
| S-082 spike | Scout (verification) | The spike's value is evidence, not opinion: reusability claims about `interview-ai.js` must be code-verified. Mirrors Rex's Sprint 9 spec-correction pattern (Scout verifying). |
| S-084 threat-intel planning | `gensecai/privacy-engineer` | **Risk domain = data-source legality.** The planning output is only as good as its gates: HIBP ToS ruling, AbuseIPDB DPIA scoping, DPDP/GDPR notice shape. She reviewed the spec; she reviews the breakdown. |
| Gate A brief | None | Lead synthesis of spike output. Rex reviews the brief's technical claims before it reaches Sumanth (standing post-implementation norm, not a specialist dispatch). |
| S-083 / F4 | None planned | Mechanical rename with an established alias pattern; a guard change copying an in-file pattern. Nova still states her specialist decision at STOP 1 for both — "none" must be her defended call, not a default. |

Personas make the final specialist decision per story (planned ≠ forced). Tight briefs required.

---

## Weighed but NOT Committed

| Item | Issue | Lead's weighing |
|------|-------|-----------------|
| **Erasure completeness: `job_applications`** | #780 (created at this planning — the issue did not exist) | The biggest remaining Art. 17 gap: `erasePersonalData()` has **zero** coverage of `job_applications.cover_letter` + `screening_answers` JSONB (code-verified 2026-10-12). It matters more, in pure compliance terms, than anything else on this list. It is **not** committed because it is unscoped — S-078's lesson is that erasure stories grow during STOP 1 scoping (8 blind-spot tables found last time), and committing an unscoped number into a decision-heavy sprint repeats the S-049 mistake in miniature. **Recommendation:** Sprint 11 lead story. As a Sprint 10 **stretch** (no commitment): if S-039/S-083 finish early, Nova runs #780's STOP 1 scoping with the privacy-engineer so Sprint 11 can commit it sized. If Sumanth prefers it committed now, it displaces S-039 or waits at the gate — his call at approval. |

## Blocked / Deferred (Explicit)

| Item | Issue | Status | Unblocks |
|------|-------|--------|----------|
| S-049b real observer analysis | #697 | **Blocked** on S-027 (#674) + S-034 (#681) and the Gate A decision | Sumanth's Gate A call → E-004 before E-005 |
| Employer vs recruiter role model | #766 | **Blocked on Sumanth** — Rex's recommendations delivered, no decision yet | Sumanth's call on Rex's role model |
| Biometric policy page promise | #777 | **Pre-launch track** (per Lead's filing) — policy page promises an unbuilt calibration baseline | Gate A / pre-launch review: remove the promise or build E-003 |
| R2 plaintext frame cleanup | #721, #739 | **Deferred to pre-launch** per Sumanth (2026-10-12) | Pre-launch checklist |
| #336 account cleanup (205/206), test data | #151 | **Deferred to pre-launch** per Sumanth | Pre-launch checklist |
| Threat-intel implementation | #764 children (via S-084) | **Blocked on planning + entry conditions** (HIBP ToS + budget; AbuseIPDB DPIA) | Sprint 11+ |

---

## Out of Scope (Explicit)

- Any E-004/E-005 implementation code — the sprint produces the *decision*, not the pipeline
- Threat-intel implementation code — S-084 is planning only
- #766 role-model implementation — blocked on Sumanth, platform track
- The S-049b advisory-lock erasure hardening — stays in #697's scope (the race remains **narrowed, not closed**; no wording anywhere in this sprint may claim otherwise)
- Counsel items (DPIA execution, BIPA public policy text) — separate legal track; S-084 *scopes* the AbuseIPDB DPIA, it does not perform it
- Pre-launch cleanup items — pre-launch track, not sprint work

---

## Risks

| Risk | Mitigation |
|------|------------|
| S-039's filed ACs promise populated analysis that cannot exist yet | Honest re-scope recorded in this plan + reconciled on #686 at sprint start; missing-state rendering is the defined behaviour |
| Gate A decision slips past sprint end → Sprint 11 planning blocked | Brief is a committed deliverable sequenced immediately after the spike; decision is a sprint DoD item |
| Spike overruns its timebox | Hard timebox (3 pts); a partial spike that re-sizes the range still feeds the brief — perfection is not the deliverable |
| HIBP finding invalidates part of an approved spec | D2 posture: v1 planning proceeds on $0 sources; HIBP story held behind ToS + budget gates; spec §3.1 correction noted for Rex |
| Rename breaks a client call site (S-083) | Deprecated alias for one sprint is part of the story, not an afterthought; call-site sweep is an AC |
| DB verification limits persist (no local Postgres; Neon TLS-blocked) | Same caveat as Sprint 9: mocked-DB tests + hand-verified SQL; real-DB pass owed before any staging promotion |

---

## Definition of Done (Sprint)

- [ ] S-082 spike delivered: `interview-ai.js` reusability verdict, re-sized E-004/E-005 range, deferral cost/risk — all code-evidenced
- [ ] Gate A brief delivered to Sumanth; **binding E-004/E-005 launch-scope decision recorded before Sprint 11 planning**
- [ ] S-039 (#686) merged: side-by-side renders real `ai_observer_reports` rows; missing sections render "Insufficient data / N/A"; #686 ACs reconciled with the honest re-scope
- [ ] D1 resolved at plan gate; S-083 merged before S-039's read contract lands (if Option A)
- [ ] S-084 delivered: threat-intel story issues created from the #764 spec, dependency-verified; entry conditions statused (HIBP cost + ToS, AbuseIPDB DPIA); spec's three open questions put to Sumanth in decision-ready form
- [ ] F4 (#779) merged: `cancel()`/`fail()` guarded with tests
- [ ] Sprint 9 retro merged (this PR)
- [ ] No open P0/P1 regressions
