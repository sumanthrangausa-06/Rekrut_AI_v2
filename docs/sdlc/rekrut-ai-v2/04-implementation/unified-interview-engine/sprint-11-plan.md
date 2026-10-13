---
project: Unified Interview Engine
phase: 4-Implementation
sprint: 11
status: draft
created: 2026-10-13
owner: Sumanth
lead: Lead (Team Lead, smart-sdlc Phase 4)
capacity_points: 20
committed_points: 19
---

# Sprint 11 Plan — Applications Module Sprint + Interview-Module Remainder

> **Status:** Draft | **Lead:** Lead | **Phase Gate:** Requires Sumanth's approval before any story starts.
> **Method:** smart-sdlc `sprint-planning` + `writing-plans`.
> **Sprint 10 retro:** `sprint-10-retro.md` (in this PR). Sprint 10 delivered every committed item and closed with the Gate A ruling (B, amended); Sprint 11 is the first sprint planned entirely under that ruling.
> **Issue-number verification:** Every story→issue mapping below was verified via `gh issue view` title check on 2026-10-13. New stories filed at this planning (S-089 #806, S-090 #807, S-091 #808, S-092 #809, S-093 #810, S-094 #813, S-095 #815) and Rex's S-077 follow-ups filed individually (#801–#805) plus the S-083 alias-removal follow-up (#811) — all verified after creation. No trust-from-memory.
> **Correction note (Lead, 2026-10-13):** an earlier draft of this plan integrated a preliminary summary of Rex's review that misstated three verified facts (scorecards' serving state, application-time IP capture, #801's write side). Rex's full verified review superseded it; the affected issues carry ⚠️ correction comments (#780, #799, #801, #802, #805, #808, #809, #810), and this plan reflects only the verified version.
> **Sumanth's decisions carried forward:** (1) **Module-order rule (2026-10-12):** work proceeds module by module — the Interview module ran first; **the Applications module sprint is Sprint 11's main track**, covering that module's wiring + security + compliance wholesale. #780 is addressed here, in that whole, not piecemeal. (2) **Gate A = B amended (2026-10-13):** January Observer is cohort-only, presence-only; the analysis chain (#697/#674/#681) is parked under the re-entry contract; Sprint 11 funds enablement groundwork without displacing the Applications sprint. (3) **Mock-scores ruling (2026-10-12):** #791 "scheduled separately" — this plan states Lead's slotting recommendation as D1. (4) **Narrowed threat-intel v1 approved (2026-10-12)** with the release condition: the signal does not go live until #788 closes. (5) **Legal-hold option (a) adopted (2026-10-13):** build the hold switch (#799). (6) **No counsel outreach (2026-10-13):** "lets not send any mail to anyone" — #788 stays open, the letter stays unsent; nothing in this sprint contacts anyone.

---

## Sprint Goal

**Run the Applications module sprint (audit-first, then the module's wiring/security/compliance as one whole, anchored by the #780 erasure gap), build the legal-hold brake before any deletion widens, and sequence the interview-module remainder January depends on — cohort enablement groundwork and the threat-intel programme (chassis + capture + signal, all dark) — without touching the parked Gate A analysis chain.**

---

## Decisions Sumanth Is Asked to Make at This Gate

### D1 — OmniScore track slotting: #791 + #792 to Sprint 12 (Lead recommends), or pull forward?
Sumanth ruled #791 (practice out of OmniScore + readiness panel) "scheduled separately." Lead's recommendation: **#791 + #792 are Sprint 12's lead pair** (they belong together; #792 narrows the recruiter practice endpoint to match). Sprint 11's plate is the Applications module plus enablement groundwork; the OmniScore change also deserves its own version-note moment, not a shared one. **#793 (the `interview_evaluations` pipe BUG) is different** — an unblocked correctness bug, independent of the ruling — and is sequenced inside Sprint 11 (see Sequenced Set). Note for whichever sprint lands them: #793's fix and #791's removal can both shift candidate scores; their version notes must be coordinated.

### D2 — Promotion is NOT a Sprint 11 item (Rex's position, adopted)
Rex's pre-planning review splits what an earlier draft had bundled: the **jest first run is in-sprint** (committed below — it is also Lex C-L3's discharge path), but **promotion is a Relay-owned track after the sprint ends**, against a frozen `dev`. The load-bearing fact: `render.yaml`'s start command is `npm run migrate && npm start`, so a staging deploy runs migrations 252–257 **against the shared staging/production database at boot** — a production-schema event needing its own Relay checklist and migration-by-migration review (254 rewrites a CHECK constraint; 257 alters `recording_objects`), not a sprint side-effect. Keeping promotion out also stops this sprint's *own* new migrations (legal-holds, threat-intel) being swept into the same promotion un-QA'd. D2 asks Sumanth to endorse that shape; the promotion itself returns to him as its own gate with Relay's checklist.

### Explicitly NOT decisions at this gate
- **#766 (employer vs recruiter roles)** — still blocked on Sumanth's separate decision; not in this sprint.
- **`RETENTION_PURGE_LIVE` flip** — still awaits Sumanth's separate approval; not a sprint item. (Sequencing note: the #799 legal-hold build lands in this sprint and is verified *before* any deletion widens — the brake exists before the accelerator is touched again.)
- **Counsel engagement (#788)** — no outreach per Sumanth's 2026-10-13 ruling. The Gate A re-entry contract's checkpoints (**2026-11-01** and **2026-12-01**) stand: if counsel is still unanswered at those dates, the item escalates to Sumanth rather than expiring silently. Lead owns the escalation dates.

---

## Main Track — The Applications Module Sprint

The module's full story set is **not** presumed known. The sprint opens with an audit; stories are filed from evidence; the committed tranche below is what is already verified.

| ID | Title | Issue | Points | Owner | Dependencies |
|----|-------|-------|------|--------|--------------|
| S-088 | Applications module audit (wiring / security / compliance) | #812 | 3 | Scout + Rex | None — starts day 1 |
| — | Erasure completeness: `job_applications` + application-keyed tables (anchor fix, extended) | #780 | 5 | Nova | **Entry condition: #799 legal-hold merged + verified** (Rex's sequencing rule) |
| — | Audit tranche-1 reserve | filed from S-088 | 2 (reserve) | Nova | S-088 exit; same hold-first rule for any erasure-scope filing |

**How the story set gets discovered (the method, stated plainly):** S-088 (#812) is a STOP-1-style module audit — **its schema-truth leg runs first** (the constraint/column record it produces is consumed by every later STOP 1 in the module, so no finding is re-verified downstream). It then works **three verification legs per finding** — (1) static trace (codebase-memory / code-review-graph blast radius on `job_applications`); (2) schema truth against the local-PG migrated DB (`information_schema` — this environment *can* verify schema and run an erasure dry-run locally, unlike the Neon path); (3) an authz matrix (scripted two-company + two-candidate fixtures against every route) plus an **erasure dry-run**: run `erasePersonalData` for a seeded candidate locally, then residual-PII SELECTs across `job_applications` and every related table. Findings become filed stories — **one per root cause, not per symptom** — Lead-pointed, in one filing pass at audit exit, de-duped against #780/#405/#529/#657/#136 (a comment goes there when a root cause matches an open issue). The first 2 points of filed work consume the reserve; the expected first filings are the candidate-endpoint authz/payload root cause (checklist S2/S3) and the explain-decision IDOR (S4, fast-path). Anything beyond the reserve joins the Sequenced Set in audit-priority order, and whatever does not fit rolls to Sprint 12 **named in the sprint review** — the module sprint is a commitment to the whole module, sequenced honestly across the sprint boundary if the audit proves it bigger than one sprint. Rex's amendment, adopted: the audit carries an **exit criterion** — a filed story set where every dependency carries a verified exists/absent state (the Sprint 9 rule); the audit itself is not exempt from the discipline it exists to enforce.

**Scout's audit scope checklist** (produced for this planning, code-verified 2026-10-13; full text with file:line anchors is the body of #812):
- **Wiring W1–W7:** three application-creation paths with the shared funnel honoured by only one (`ai-screener.js` inserts with **no `company_id`**); duplicate recruiter status endpoints with divergent side-effects; status-vocabulary drift in aggregations (pipeline-stats counts 6 of 9 stages); candidate Kanban renders rejected/withdrawn as "applied"; a dead `resume_url` field; #247's one-click-apply exists but performs no insert.
- **Security S1–S9:** the main recruiter surface **is** company-scoped (verified good) — but a candidate can **self-advance their own application to any status incl. `hired`** (S2), `GET /candidate/applications` returns `SELECT ja.*` including **`recruiter_notes`** to the candidate (S3), and `GET /compliance/explain/decision/:applicationId` is **auth-only — an IDOR returning candidate name/email/status/notes for any ID** (S4). No `deleted_at`/visibility filtering on recruiter application queries (S8) — erased candidates' applications remain fully listed.
- **Compliance C1–C7:** #780 verified **and extended** (below); DSAR export omits `job_applications` entirely (coordinate #657, don't duplicate); **no retention path exists for applications** (rejected/withdrawn PII never expires); status-change audit trails are inconsistent by path; the #788 gate is an audit constraint — no threat-intel/fraud signal may surface in any application view until the CRA determination closes (verified: none exists in the schema today).
- **Data-integrity D1–D7:** `company_id` NULL rows from the phantom creation paths; a possible `applied_via='referral'` vs CHECK-constraint conflict (hypothesis — the schema-truth leg resolves it); assessment *assignment* setting `status='shortlisted'` before the candidate sits it; a phantom `hired_at` column making time-to-hire silently always null; batch updates silently dropping foreign IDs under a 200.

**The #780 extension (recorded on #780 at this planning):** the erasure gap is wider than the `job_applications` row — `screening_responses`, `job_application_screenings`, `ai_screenings`, `outreach_attempts`, and `auto_apply_profiles` are also untouched by erasure and survive with it. On Rex's review the fix is split by payload family (the S-076/S-078 precedent): #780 keeps the C1 core at **5 pts**; the C2 sweep is **S-094 (#813, 3 pts)**, sequenced immediately after #780's STOP 1 ruling. The per-column **delete-vs-redact** decision (candidate-authored content + derived scores vs the company-side record) is a Sumanth/Lex scoping call carried at #780's STOP 1, not the audit's. One name collision the audit resolves first (Rex): `job_applications.screening_answers` (JSONB column, migration 022) is **not** the `screening_answers` table erasure already deletes.

Boundaries: **#405** owns candidate *discovery* (search/preview/visibility); the overlap with this module is only the `job_applications`-derived recruiter candidate lists — the audit files nothing twice. **#529** (Activity Feed) is implemented in code since filing — S-088 verifies its ACs and recommends close/update; it is not a rebuild. **#151** is a boundary only (inventory test-application markers; delete nothing).

---

## Committed Builds & Side Items (start at plan approval)

| ID | Title | Issue | Points | Owner | Notes |
|----|-------|-------|------|-------|-------|
| — | **Legal-hold build (option (a)) — the brake, built first** | #799 | 5 | Nova | Replaces the `isLegalHoldActive` stub with the real service; per-row consult at every purge site; fail-closed. **Gates every deletion-widening build below and in the Sequenced Set** |
| — | jest first real run → **failure ledger** | task → #787 record | 2 | Quinn + Nova | The sprint's first task, timeboxed. Deliverable is the ledger: capture-family + new-sprint tests green, pre-existing failures filed + baselined. No story is held hostage to a fully green suite |
| — | Guard `observerJobs.markObserving()` | #785 | 1 | Nova | Sibling of Sprint 10's F4; same guard pattern |
| — | PRD scope amendment (Gate A: January analysis explicitly out, vision unchanged) | deliverable → #634 | 1 | Aria | Hardening conditions recorded on #634 (Lex's 61 requirements by reference; L-JAN gap record attached; Quinn's protocol cited as contract) |

**Committed total: 19 / 20** (main track 10 = S-088 3 + #780 5 + reserve 2; brake + side items 9). The 1 unallocated point plus the reserve are the only slack, deliberately: Sumanth reviews every gate personally, and his review throughput is a real constraint on this sprint's velocity. No commitments are made against unknown audit output beyond the reserve.

---

## Sequenced Set (starts in this order as capacity frees; expected to start within Sprint 11)

| # | Item | Issue | Points | Owner | Gate / note |
|---|------|-------|------|-------|-------------|
| 1 | S-094 Erasure completeness: application-keyed tables sweep (C2) | #813 | 3 | Nova | After #780's ruling; hold-first rule applies |
| 2 | S-090 Threat-intel chassis (pipeline, `threat_intel_checks`, erasure wiring) | #807 | 5 | Nova | **After the audit** (its erasure wiring consumes the audit's redaction ruling); no live signal |
| 3 | S-095 Application-time IP capture + consent gate | #815 | 3 | Nova | New PII collection: DPIA + notice + India consent gate; auto-apply paths excluded |
| 4 | S-089 Cohort Enablement (January audit spine + allow-list) | #806 | 8 (provisional — STOP 1 verifies existing coverage) | Nova | Blocks first cohort session, with #777 |
| 5 | Biometric policy page: remove the unbuilt calibration promise | #777 | 1 | Nova | Copy fix; CE drafts, Lex signs off. Blocks enablement, not launch |
| 6 | S-091 Threat-intel internal signal (repeat-IP, HMAC silo) | #808 | 3 | Nova | After S-095; ships dark |
| 7 | #793 BUG: `interview_evaluations` pipe | #793 | 3 | Nova | Independent; coordinate version note with #791's future one |
| 8 | S-093 Scorecard AI-section gate + session-scoped serving | #810 | 8 (ceiling; Rex's realistic scope ≈6) | Nova | Panels CRUD/submit-lock already exist — this is the gate + resolver, not greenfield (see #810 correction) |
| 9 | Retention audit entries: per-entity + read surface | #801 | 2 (re-scoped) | Nova | Write side already lands in `compliance_audit_trail` (see #801 correction) |
| 10 | `[purged]` sentinel leak (recordings API) | #802 | 2 | Nova | Hold-first rule applies (deletion-adjacent) |
| 11 | Retention backfills (dry-run first) | #803 | 3 | Nova | Hold-first rule applies; live run is a separate Sumanth gate |
| 12 | `recording_objects` retry defects (3 named) | #804 | 2 | Nova | Narrowed per Rex (see #804) |
| 13 | `NODE_ENV` gate → env-identity + DB marker | #805 | 2 | Nova | Fail-closed; reuses `observerEnvIdentity` |

Anything in this set that has not started at sprint review rolls to Sprint 12 **in this order**, named in the review — not silently.

---

## Sprint 12 Lead Candidates (named now, planned then)

- **#791 + #792** — OmniScore practice removal + readiness panel, and the practice-fact marker (per D1 recommendation).
- **S-092 (#809)** — threat-intel recruiter review UI, **only after #788 closes** (deferred out of Sprint 11 on Rex's review: a hidden UI buys nothing while dark, and the determination may change what may be furnished).
- Applications-module audit remainder (whatever S-088 files beyond Sprint 11's reserve + sequenced capacity).
- **#811** S-083 deprecated-alias removal (1).
- Atlas evidence gates (15–20 discovery calls; 3–5 paid-pilot commitments) — a company-track item owned by Atlas under the Gate A ruling; tracked at the ruling's checkpoints, not pointed as engineering.

---

## Dependency Verification (panel rule — every dependency carries a verified state)

| Dependency | State | Evidence |
|---|---|---|
| Scorecard routes (draft / submit-lock / peer-reveal) | **Verified-Exists** (`routes/panels.js`, mounted `/api/panels`) | Rex pre-planning verification → #810 correction |
| AI-section gate on a scorer's own submission | **Verified-Absent** — the S-093 build | Rex verification; S-039 column shipped unserved (`674f38f2`) |
| `legal_holds` table / mechanism | **Verified-Absent**; the check **seam exists as a stub returning `false`** (`lib/observerCapture.js:145-160`) | Rex verification → #799 |
| `threat_intel_checks` table / pipeline | **Verified-Absent** (spec only) | Rex verification; created by S-090 |
| Application-time IP capture | **Verified-Absent** — no IP at any of the 3 insert sites, no IP column | Rex verification → S-095 (#815) |
| `compliance_audit_trail` purge writes | **Verified-Exists** (migrations 129 + 254; aggregate-only entries; read surface absent) | Rex verification → #801 re-scope |
| `recording_objects` registry / `pending_storage_deletions` | **Verified-Exists** (migrations 253 + 257, 252) | Rex verification |
| L-JAN audit-spine partial coverage (S-046/S-047/S-049a/S-039 surfaces) | **Unverified** — S-089 STOP 1 verifies before scoping | Gate A ownership table §A |
| jest suite | **Verified-Exists** as code (109 server test files); **Verified-Never-Executed** in the build environment | Lex C-L3; Nova's disclosure, PR #800 |
| Migrations 252–257 | **Verified-Exists** on `dev`; not yet run on any deployed environment | Relay's post-sprint promotion track (D2) |
| Counsel determination (#788) | **Open; Sumanth-Waived for outreach** (no mail, 2026-10-13) — the waiver covers *contact*, not the determination itself | #788 record |

---

## Dependency Chain

```
S-088 audit (schema-truth leg first) ──► filed story set ──► reserve (2) ──► sequenced (audit priority) ──► Sprint 12 remainder (named)
#799 legal-hold (verified) ──► #780 erasure build ──► S-094 sweep; also gates #802/#803 builds
jest run ──► failure ledger ──► (post-sprint) Relay promotion track, frozen dev, Sumanth's gate
Audit's ja redaction ruling ──► S-090 chassis ──► S-095 IP capture ──► S-091 signal (dark) ──► S-092 UI only after #788 closes
S-089 + #777 ──► first cohort session possible (enablement itself = Gate A re-entry contract, NOT this sprint)
```

---

## Architectural Review (Pre-Sprint) — Rex

Rex reviewed all six areas against `origin/dev` (tip: PR #800 merge) before this plan finalised. **Overall verdict: the sprint's shape is SOUND with amendments — no blocks.** Per item:

| Item | Verdict | Substance |
|---|---|---|
| Applications audit-first approach | **SOUND** | Audit-first is right (S-076/S-078 both grew during scoping; #780's own body anticipates it). The audit is a code-reading exercise whose one architectural deliverable is the *enumeration contract* — which surfaces count as "the module" (Scout's map enumerates it). Five audit questions answered in his review (data model, route/authz, storage objects, event flows, lifecycle) and folded into #812. Points stand (audit 3 / #780 5) **with the C2 split** — *Lead adopted it* (S-094, #813). |
| Legal-hold (#799) | **AMEND** (adopted on #799) | A correction that helps: the seam already exists — `isLegalHoldActive` is a stub returning `false`, already consulted by the capture purges. #799 replaces the stub's body; one canonical `lib/legalHold.js` + `legal_holds` table; **per-row consult at every purge site** (there is no choke point: ≥6 purge functions + erasureService + the ledger sweep); held rows skipped + counted + audited; **DEK destruction is deletion and is covered**; hold-check errors **fail closed**; hold vs a DSAR request is surfaced as an Art. 17(3)(e) conflict, never silently resolved. Points: **5 with scope pinned** (set/release API in; admin UI explicitly out). |
| Scorecard serving (S-093) | **AMEND — premise corrected** (adopted on #810) | Scorecards are **not** schema-only: the panels implementation (draft, submit-and-lock, peer-reveal, aggregate) exists and is mounted. What's missing is narrower and sharper: the **AI-section gate** (nothing withholds the AI section from a scorer until *their own* card is submitted), **session-scoped serving**, and the **recruiter-surface bypass** (gating `panels.js` alone would be theatre). Enforcement is server-side at the AI-section serving routes, reusing the existing `draft → submitted` state machine; non-scorers are explicitly unrestricted. Points: realistic ≈6, **8 kept as ceiling** (the +2 constraint work is not cut; the phantom CRUD is). |
| Threat-intel build | **AMEND — a prerequisite was missing** (adopted on #807/#808/#809/#815) | The signal's input does not exist: **no IP is captured at application time** → new prerequisite story **S-095** (capture + consent gate, 3). Silo by **cryptography, not discipline**: persist `HMAC(ip, company-scoped key)`, never the raw IP; equality matching still works; the negative cross-company test is an AC. Dark mechanics in depth: server serializer first, single default-false visibility flag second — and the **review UI (S-092) is deferred behind #788**, not built dark (a hidden UI buys nothing; the determination may change what may be furnished). Chassis (5) runs **after the audit**, consuming its redaction ruling. In-sprint programme re-cut: 5 + 3 + 3, UI out. |
| S-077 follow-ups (#801–#805) | **Mixed — two confirmed, one re-scoped, two narrowed/sharpened** | **#801 AMEND/partially stale:** purge events already land in `compliance_audit_trail` (migration 254 + a real-DB integration test) — the remainder is aggregate-only entries + no read surface; **3 → 2, re-scoped**. **#802 CONFIRMED** exactly (writer `euComplianceService.js:656`; readers `recordings.js:699` raw, `:458` counting purged as live; check the `:495` highlights join). **#803 CONFIRMED**, 3 pts, **dry-run-first gate** (the code's own comment tracks this follow-up). **#804 AMEND — narrower:** basic retry exists; the real defects are exactly three (no attempts/backoff/dead-letter; `purgedCount++` on soft-fail; SKIP LOCKED outside a transaction). **#805 CONFIRMED and worse:** the gate is `server.js:1012` and `NODE_ENV` is unset on both Render services (proven in S-085 STOP 1) — the live purge can never arm as designed today; fix reuses `lib/observerEnvIdentity.js` + a DB-resident marker, fail-closed. |
| jest + promotion | **AMEND — split them** (adopted as D2 + the committed jest item) | Jest first run: **first story of the sprint, timeboxed**, deliverable = a **failure ledger** (capture-family + new tests green; pre-existing filed/baselined) — never a fully-green-suite hostage condition. Promotion: **out of the sprint entirely**, Relay-owned afterwards, against a frozen `dev` (the migrate-at-boot fact in D2). |

**Rex's biggest-risk statement is carried as this plan's first Risk**, with his hard sequencing rule adopted as a plan rule: *the legal-hold story lands, verified, before any deletion-widening build starts.*

Also adopted from Rex's scope-gap pass: Sprint 10 retro delivered in this PR; the alias-removal issue filed (#811); the Aria PRD amendment's three hardening conditions recorded on #634; the Gate A condition shadow completed — **C-L2 (PITR restore drill) is owned by Relay in the promotion track; C-L4 (Rung-2 synthetic validation) is owned by Quinn as enablement readiness** (both pre-activation, neither pointed in this sprint, both named here so they are not lost).

---

## Specialist Plan

**Planning-level answer (mandatory):** Sprint 11 planning itself dispatched Scout (Applications module mapping) and Rex (pre-planning architecture, above) — the planning-level specialists. Story-level plan:

| Story / item | Planned specialist | Why |
|---|---|---|
| S-088 audit | `gensecai/privacy-engineer` + `ecc/security-reviewer` | The audit's domains ARE privacy (erasure reach) and security (per-route authz). Scout discovers; these two judge. Database-reviewer considered and skipped at audit level — no schema change is audited; he joins any filed migration story. |
| #799 legal-hold | `gensecai/privacy-engineer` + Lex review | Compliance machinery: a hold that misses a purge path (or a DEK destruction) is a legal defect, not a bug. Rex's checklist on #799 is the review's spine. |
| #780 / S-094 fixes | `gensecai/privacy-engineer` | Erasure completeness is her proven domain (S-076/S-078 pattern). Database-reviewer skipped: established DELETE + storage-ledger patterns — Nova defends at STOP 1. |
| S-090 / S-095 / S-091 | `gensecai/privacy-engineer` (mandatory, design check + pre-PR) | S-095 is **new PII collection** (DPIA/consent domain); S-091's HMAC silo is a privacy property, not a feature. Lex consulted on S-090's retention default. Security-reviewer considered for the silo proof — privacy-engineer covers the data-flow claim; Nova's STOP 1 makes the final call. |
| S-089 Cohort Enablement | `gensecai/privacy-engineer`; Lex (sign-off seat, not a specialist dispatch) | Consent/audit-spine correctness; the cohort promise copy carries legal weight (Lex signs, CE drafts, Quinn verifies reconciliation as owner). |
| S-093 scorecards | `ecc/security-reviewer` (pre-PR) | The AI-section gate is an authorisation property (person-as-scorer enforcement must refuse server-side, incl. the recruiter-surface bypass). Hiring Manager persona owns the constraint definition (owner seat). UX/a11y considered — the surfaces are existing report/panel patterns; Nova defends at STOP 1. |
| jest run | None | Quinn owns the run and the ledger; failures route to their owning stories. |
| #801 / #802 | `gensecai/privacy-engineer` (light pass) | Audit-trail content and a PII-adjacent leak; established patterns keep it light — Nova's STOP 1 call. |
| #785 / #777 | None planned | In-file guard pattern (F4 precedent); a one-line copy fix with Lex's sign-off as the gate. Nova defends "none" at STOP 1. |

Personas make the final specialist decision per story (planned ≠ forced). Tight briefs required.

---

## Blocked / Deferred (Explicit)

| Item | Issue | Status | Unblocks |
|---|---|---|---|
| S-049b real analysis | #697 | **Parked** under the Gate A re-entry contract (also blocked by #674/#681) | Contract triggers: counsel + design + validation; Nov 1 / Dec 1 checkpoints escalate to Sumanth |
| S-027 fusion / S-034 multimodal | #674 / #681 | **Parked**, same contract | Same |
| Threat-intel signal go-live | via #808/#809 | **Blocked on #788** (CRA determination, P0 launch-blocker); the review UI itself is deferred behind it on Rex's review | Counsel determination — no outreach authorised; escalates per contract dates |
| Employer vs recruiter roles | #766 | **Blocked on Sumanth** | His decision on Rex's recommendations |
| R2 plaintext cleanup run | #721 | **Pre-launch track** (environment-blocked from this VM) | Pre-launch, networked environment |
| Test-data purge / #336 accounts | #151 | **Pre-launch track** | Launch checklist |
| `RETENTION_PURGE_LIVE` flip | #760 record | **Awaiting Sumanth's separate approval** | His call; the #799 hold build is its verified precondition in this sprint |
| dev → staging promotion | Relay track | **Post-sprint, Relay-owned** (D2) — gated on the jest failure ledger | Sprint end + Sumanth's promotion gate |

---

## Out of Scope (Explicit)

- Any S-049b / S-027 / S-034 build work, and any Observer **activation** — enablement groundwork only; activation is the re-entry contract's separate, dated gate.
- Counsel outreach of any kind (Sumanth, 2026-10-13).
- #766 role-model implementation.
- External threat-intel sources (AbuseIPDB / HIBP / XposedOrNot) — held behind licensing + budget gates; not built, not contacted.
- S-068/#721 deletion run; #151 test-data purge — pre-launch track.
- Admin UI for legal holds — explicitly out of #799's pinned scope (+2–3 if ever added, as a new story).
- Staging → main promotion — not planned here at all; main waits for staging QA + Sumanth after the Relay track.

---

## Risks

| Risk | Mitigation |
|---|---|
| **The sprint builds the brake and steps on the accelerator in the same sprint (Rex).** Sprint 11 simultaneously widens deletion (Applications erasure/redaction, S-077 follow-ups), builds legal hold — the only mechanism that makes automated deletion safe under a preservation duty — and starts a new PII collection (application IPs). If any deletion-widening build merges before the hold wiring is merged *and verified at every purge site*, the sprint re-opens the exact exposure #799 was filed to close, with more data flowing into purges than before. | **Hard sequencing rule (adopted):** #799 is a committed build that goes first; #780/S-094/#802/#803 builds carry the entry condition "#799 merged + verified." The audit (reading) and jest (testing) tracks are unaffected — they widen nothing. |
| Applications audit surfaces more than reserve + tranche | Remainder rolls to Sprint 12 **named at sprint review**; the module commitment is honoured by sequencing, not by pretending one sprint absorbs an unaudited module |
| Sumanth's gate throughput (he approves every story gate personally) | One build in flight per track; the sequenced set's order is the priority when his review time is the constraint |
| jest first run exposes accumulated pre-existing failures | By design: the deliverable is the failure **ledger**, not a green suite (S-039 already baselined 9 failures in 2 unrelated client files). Promotion waits for the ledger's capture-family triage, not for universal green |
| #788 stays open (no outreach) while threat-intel builds complete | By design: chassis/capture/signal complete dark; the UI isn't even built until the determination lands (Rex) — go-live cannot be reached accidentally |
| S-089 STOP 1 finds the audit spine largely unbuilt | Points are provisional *because* of this; STOP 1 reports before build, and the sequenced order absorbs re-pointing before other items start |
| Migration stack 252–257 has never run against a real DB from this environment | It runs first in Relay's post-sprint track with a migration-by-migration checklist against the shared DB (D2) — stated now, not discovered at promotion time |

---

## Definition of Done (Sprint)

- [ ] S-088 audit delivered: full Applications story set filed with verified dependency states; tranche dispositioned (reserve / sequenced / Sprint 12) in the sprint review
- [ ] #799 merged and verified at every purge site (incl. DEK destruction + ledger sweep, fail-closed test) — **before** any deletion-widening build starts
- [ ] #780 merged (C1 core): `job_applications` inside erasure per the delete-vs-redact set, privacy-reviewed, with a local-PG erasure dry-run as evidence; S-094 (C2 sweep) started or explicitly rolled by name
- [ ] jest first real run executed; failure ledger delivered and baselined (C-L3 discharge path recorded); promotion track handed to Relay
- [ ] #785 merged; Aria's PRD scope amendment delivered and recorded on #634
- [ ] Sequenced set: every item either started in order or named as rolled to Sprint 12 in the sprint review
- [ ] D1 resolved at plan gate; Sprint 10 retro merged (this PR)
- [ ] No open P0/P1 regressions
