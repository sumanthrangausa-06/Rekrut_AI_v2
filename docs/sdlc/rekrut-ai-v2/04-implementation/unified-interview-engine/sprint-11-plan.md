---
project: Unified Interview Engine
phase: 4-Implementation
sprint: 11
status: draft
created: 2026-10-13
owner: Sumanth
lead: Lead (Team Lead, smart-sdlc Phase 4)
capacity_points: 20
committed_points: 17
---

# Sprint 11 Plan — Applications Module Sprint + Interview-Module Remainder

> **Status:** Draft | **Lead:** Lead | **Phase Gate:** Requires Sumanth's approval before any story starts.
> **Method:** smart-sdlc `sprint-planning` + `writing-plans`.
> **Sprint 10 retro:** `sprint-10-retro.md` (in this PR). Sprint 10 delivered every committed item and closed with the Gate A ruling (B, amended); Sprint 11 is the first sprint planned entirely under that ruling.
> **Issue-number verification:** Every story→issue mapping below was verified via `gh issue view` title check on 2026-10-13. New stories filed at this planning (S-089 #806, S-090 #807, S-091 #808, S-092 #809, S-093 #810) and Rex's S-077 follow-ups filed individually (#801–#805) plus the S-083 alias-removal follow-up (#811) — all verified after creation. No trust-from-memory.
> **Sumanth's decisions carried forward:** (1) **Module-order rule (2026-10-12):** work proceeds module by module — the Interview module ran first; **the Applications module sprint is Sprint 11's main track**, covering that module's wiring + security + compliance wholesale. #780 is addressed here, in that whole, not piecemeal. (2) **Gate A = B amended (2026-10-13):** January Observer is cohort-only, presence-only; the analysis chain (#697/#674/#681) is parked under the re-entry contract; Sprint 11 funds enablement groundwork without displacing the Applications sprint. (3) **Mock-scores ruling (2026-10-12):** #791 "scheduled separately" — this plan states Lead's slotting recommendation as D1. (4) **Narrowed threat-intel v1 approved (2026-10-12)** with the release condition: the signal does not go live until #788 closes. (5) **Legal-hold option (a) adopted (2026-10-13):** build the hold switch (#799). (6) **No counsel outreach (2026-10-13):** "lets not send any mail to anyone" — #788 stays open, the letter stays unsent; nothing in this sprint contacts anyone.

---

## Sprint Goal

**Run the Applications module sprint (audit-first, then the module's wiring/security/compliance as one whole, anchored by the #780 erasure gap), and in parallel sequence the interview-module remainder that January depends on: cohort enablement groundwork, the threat-intel build (dark), and the compliance machinery (legal-hold) — without touching the parked Gate A analysis chain.**

---

## Decisions Sumanth Is Asked to Make at This Gate

### D1 — OmniScore track slotting: #791 + #792 to Sprint 12 (Lead recommends), or pull forward?
Sumanth ruled #791 (practice out of OmniScore + readiness panel) "scheduled separately." Lead's recommendation: **#791 + #792 are Sprint 12's lead pair** (they belong together; #792 narrows the recruiter practice endpoint to match). Sprint 11's plate is the Applications module plus enablement groundwork; the OmniScore change also deserves its own version-note moment, not a shared one. **#793 (the `interview_evaluations` pipe BUG) is different** — an unblocked correctness bug, independent of the ruling — and is sequenced inside Sprint 11 (see Sequenced Set). Note for whichever sprint lands them: #793's fix and #791's removal can both shift candidate scores; their version notes must be coordinated.

### D2 — Staging promotion: a post-sprint Relay track in three parts, gated on the jest run (Rex's shape, adopted)
Rex's pre-planning review rejected the bulk-promotion shape, and this plan adopts his correction. The facts: staging shares the production database (#151), the Render services take minutes to deploy, and the accumulated `dev` work is a dozen-plus merges with a six-migration stack. A single bulk promotion couples an Observer deploy failure to an unrelated erasure deploy failure, with a rollback that then needs its own migration story. Instead:
- **The jest first run stays in Sprint 11 (committed, Quinn + Nova, 2 pts) and is the blocking gate for everything below** — including a repair step: the jest binary isn't installed in the current environment and running it may surface already-red tests nobody has seen fail; the run targets the local PG (:55433). Budget the repair honestly inside the item.
- **Promotion is a separate, Relay-owned track AFTER the sprint**, in three promotions: **(1)** the compliance/erasure/consent stack (S-076, S-077, S-087, DSAR) — small, high-legal-value, independently verifiable by a staging DSAR exercise; **(2)** the Observer read/UI stack (S-046/S-047/S-048/S-039 + copy) — inert without cohort enablement; **(3)** the S-085 dormant-capture build **last and alone** (highest scrutiny; C-L3 discharges here; the Dormancy Evidence Pack re-runs against the staging build with the worker flag OFF).
- **The database-path question returns to Sumanth as its own gate item before Promotion 1**, with Relay's runbook costing both paths: **(A)** staging migrates the shared DB — migrations 252–257 then run against **production data**, which makes "promote to staging" a production-data operation needing explicit approval in those words; or **(B)** stand up a separate staging DB first (a Relay/Sage story of its own; staging stops sharing prod — arguably the real #151 fix). Rex's load-bearing line: *staging must never again share the production database* is the position the runbook should cost, not assume away.
So D2 asks Sumanth to endorse the shape now (jest-first, three promotions, post-sprint, Relay-owned); the A/B database-path call comes back to him costed, before Promotion 1.

### D3 — The deletion invariant (Rex's audit finding, needs Sumanth's explicit position)
Rex's audit verification surfaced a platform fact: **no route or service in the codebase deletes a `users` row administratively** — erasure via `erasePersonalData` (S-076) is the only deletion door, and every deletion-family story since has quietly assumed it. The Sprint 11 audit will verify posture N1 either way, but the *policy* is Sumanth's: **adopt the invariant** ("user data leaves this platform only through the erasure path or a retention purge — there is no administrative delete") **or reject it explicitly**. If it is ever broken casually (an admin delete endpoint added for convenience), the erasure guarantees, the legal-hold seam (#799), and the retention design all lose their single-door property at once. The plan records the question; the audit proceeds regardless, and its STOP 1 verifies which world the code actually lives in.

### Explicitly NOT decisions at this gate
- **#766 (employer vs recruiter roles)** — still blocked on Sumanth's separate decision; not in this sprint.
- **`RETENTION_PURGE_LIVE` flip** — still awaits Sumanth's separate approval; not a sprint item. (Sequencing note: the #799 legal-hold build lands in this sprint's sequenced set, and a hold check existing *before* any live purge is the safer order.)
- **Counsel engagement (#788)** — no outreach per Sumanth's 2026-10-13 ruling. The Gate A re-entry contract's checkpoints (**2026-11-01** and **2026-12-01**) stand: if counsel is still unanswered at those dates, the item escalates to Sumanth rather than expiring silently. Lead owns the escalation dates.

---

## Main Track — The Applications Module Sprint

The module's full story set is **not** presumed known. The sprint opens with an audit; stories are filed from evidence; the committed tranche below is what is already verified.

| ID | Title | Issue | Points | Owner | Dependencies |
|----|-------|-------|------|--------|--------------|
| S-088 | Applications module audit (wiring / security / compliance) | #812 | 3 | Scout + Rex | None — starts day 1 |
| — | Erasure completeness: `job_applications` + application-keyed tables (anchor fix, extended) | #780 | 5 | Nova | Audit STOP 1 confirms the delete-vs-redact set |
| — | Audit tranche-1 reserve | filed from S-088 | 4 (reserve) | Nova | S-088 exit |

**How the story set gets discovered (the method, stated plainly):** S-088 (#812) is a STOP-1-style module audit — **its schema-truth leg runs first** (Rex's sequencing amendment: the constraint/column record it produces is consumed by every later STOP 1 in the module, so no finding is re-verified downstream). It then works **three verification legs per finding** — (1) static trace (codebase-memory / code-review-graph blast radius on `job_applications`); (2) schema truth against the local-PG migrated DB (`information_schema` — this environment *can* verify schema and run an erasure dry-run locally, unlike the Neon path); (3) an authz matrix (scripted two-company + two-candidate fixtures against every route) plus an **erasure dry-run**: run `erasePersonalData` for a seeded candidate locally, then residual-PII SELECTs across `job_applications` and every related table. Findings become filed stories — **one per root cause, not per symptom** — Lead-pointed, in one filing pass at audit exit, de-duped against #780/#405/#529/#657/#136 (a comment goes there when a root cause matches an open issue). The first 4 points of filed work consume the reserve; the expected first filings are the candidate-endpoint authz/payload root cause (checklist S2/S3) and the explain-decision IDOR (S4, fast-path). Anything beyond the reserve joins the Sequenced Set in audit-priority order, and whatever does not fit rolls to Sprint 12 **named in the sprint review** — the module sprint is a commitment to the whole module, sequenced honestly across the sprint boundary if the audit proves it bigger than one sprint.

**Scout's audit scope checklist** (produced for this planning, code-verified 2026-10-13; full text with file:line anchors is the body of #812):
- **Wiring W1–W7:** three application-creation paths with the shared funnel honoured by only one (`ai-screener.js` inserts with **no `company_id`**); duplicate recruiter status endpoints with divergent side-effects; status-vocabulary drift in aggregations (pipeline-stats counts 6 of 9 stages); candidate Kanban renders rejected/withdrawn as "applied"; a dead `resume_url` field; #247's one-click-apply exists but performs no insert.
- **Security S1–S9:** the main recruiter surface **is** company-scoped (verified good) — but a candidate can **self-advance their own application to any status incl. `hired`** (S2), `GET /candidate/applications` returns `SELECT ja.*` including **`recruiter_notes`** to the candidate (S3), and `GET /compliance/explain/decision/:applicationId` is **auth-only — an IDOR returning candidate name/email/status/notes for any ID** (S4). No `deleted_at`/visibility filtering on recruiter application queries (S8) — erased candidates' applications remain fully listed.
- **Compliance C1–C7:** #780 verified **and extended** (below); DSAR export omits `job_applications` entirely (coordinate #657, don't duplicate); **no retention path exists for applications** (rejected/withdrawn PII never expires); status-change audit trails are inconsistent by path; the #788 gate is an audit constraint — no threat-intel/fraud signal may surface in any application view until the CRA determination closes (verified: none exists in the schema today).
- **Data-integrity D1–D7:** `company_id` NULL rows from the phantom creation paths; a possible `applied_via='referral'` vs CHECK-constraint conflict (hypothesis — the schema-truth leg resolves it); assessment *assignment* setting `status='shortlisted'` before the candidate sits it; a phantom `hired_at` column making time-to-hire silently always null; batch updates silently dropping foreign IDs under a 200.

**The #780 extension (recorded on #780 at this planning):** the erasure gap is wider than the `job_applications` row — `screening_responses`, `job_application_screenings`, `ai_screenings`, `outreach_attempts`, and `auto_apply_profiles` are also untouched by erasure and survive with it. The anchor fix is therefore pointed at **5**, and its STOP 1 carries the per-column **delete-vs-redact** decision (candidate-authored content + derived scores vs the company-side record — a Sumanth/Lex scoping call, not the audit's).

Boundaries: **#405** owns candidate *discovery* (search/preview/visibility); the overlap with this module is only the `job_applications`-derived recruiter candidate lists — the audit files nothing twice. **#529** (Activity Feed) is implemented in code since filing — S-088 verifies its ACs and recommends close/update; it is not a rebuild. **#151** is a boundary only (inventory test-application markers; delete nothing).

---

## Committed Side Items (start at plan approval, parallel to the main track)

| ID | Title | Issue | Points | Owner | Notes |
|----|-------|-------|------|-------|-------|
| — | Guard `observerJobs.markObserving()` | #785 | 1 | Nova | Sibling of Sprint 10's F4; same guard pattern |
| — | Biometric policy page: remove the unbuilt calibration promise | #777 | 1 | Nova | Copy fix; CE drafts, Lex signs off. Blocks enablement, not launch |
| — | PRD scope amendment (Gate A: January analysis explicitly out, vision unchanged) | deliverable → #634 | 1 | Aria | Written amendment, Sumanth-approved at this plan's gate cycle |
| — | jest first real run (discharges Lex C-L3) | task → #787 record | 2 | Quinn + Nova | Entry condition for D2's promotion |

**Committed total: 17 / 20** (main track 12 = S-088 3 + #780 5 + reserve 4; side items 5). The **3 unallocated points are deliberate slack** — Sumanth reviews every gate personally, and his review throughput is a real constraint on this sprint's velocity; the slack is the first draw for the Sequenced Set and for audit surprises. No commitments are made against unknown audit output beyond the reserve.

---

## Sequenced Set (starts in this order as capacity frees; expected to start within Sprint 11)

| # | Item | Issue | Points | Owner | Gate / note |
|---|------|-------|------|-------|-------------|
| 1 | S-094 Erasure completeness: application-keyed tables sweep (C2) | #813 | 3 | Nova | Split from #780 on Rex's review; follows #780's STOP 1 ruling |
| 2 | S-090 Threat-intel chassis (pipeline, `threat_intel_checks`, erasure wiring) | #807 | 5 | Nova | No live signal; nothing recruiter-reachable |
| 3 | S-089 Cohort Enablement (January audit spine + allow-list) | #806 | 8 (provisional — STOP 1 verifies existing coverage) | Nova | Blocks first cohort session, with #777 |
| 4 | S-091 Threat-intel internal signal (repeat-IP, per-employer silo) | #808 | 5 (Rex-amended) | Nova | Ships dark; **entry condition: #780's IP/provenance ruling** |
| 5 | #793 BUG: `interview_evaluations` pipe | #793 | 3 | Nova | Independent; coordinate version note with #791's future one |
| 6 | Legal-hold build (option (a)) | #799 | 6 (Rex-amended) | Nova | Two-seam design; append-only hold events (see #799) |
| 7 | S-093 Scorecard serving + submit-and-lock | #810 | 9 (Rex-amended) | Nova | Hiring Manager owns the lock definition; lock = server-computed boolean |
| 8 | Retention audit surface → `compliance_audit_trail` | #801 | 3 | Nova | Rex S-077 follow-up |
| 9 | `[purged]` sentinel leak (recordings API) | #802 | 2 | Nova | Rex S-077 follow-up |
| 10 | S-092 Threat-intel review UI (built dark) | #809 | 3 | Nova | **Goes live only when #788 closes** — separate Sumanth gate |

Anything in this set that has not started at sprint review rolls to Sprint 12 **in this order**, named in the review — not silently.

---

## Sprint 12 Lead Candidates (named now, planned then)

- **#791 + #792** — OmniScore practice removal + readiness panel, and the practice-fact marker (per D1 recommendation).
- **#803** retention backfills (3), **#804** `recording_objects` retry hardening (2), **#805** NODE_ENV → database-identity check (2).
- **#811** S-083 deprecated-alias removal (1).
- Applications-module audit remainder (whatever S-088 files beyond Sprint 11's reserve + sequenced capacity).
- Atlas evidence gates (15–20 discovery calls; 3–5 paid-pilot commitments) — a company-track item owned by Atlas under the Gate A ruling; tracked at the ruling's checkpoints, not pointed as engineering.

---

## Dependency Verification (panel rule — every dependency carries a verified state)

| Dependency | State | Evidence |
|---|---|---|
| `scorecards` / `scorecard_items` schema | **Verified-Exists** (migration 125); serving routes **Verified-Absent** | S-039 STOP 1, code-verified |
| `threat_intel_checks` table | **Verified-Absent** — created by S-090 | Sprint 10 S-084 breakdown |
| `legal_holds` mechanism | **Verified-Absent** platform-wide — #799 is the discovery record | Gate A design phase, Lex ruling |
| `compliance_audit_trail` as purge audit surface | Design §9 specifies it; current purge writes **Verified-Absent** | Rex S-077 review → #801 |
| `applications.ip_address` provenance | **Verified-Partially-Exists** — column + partial index (migration 202), exactly one writer, zero readers | Rex pre-planning verification → #780 flag, S-091 entry condition |
| `scorecards` FK behaviour | **Verified:** no `company_id`, no `ON DELETE` (NO ACTION) on migration 125; erasure entry owed Sprint 12 | Rex pre-planning verification → #810 |
| L-JAN audit-spine partial coverage (S-046/S-047/S-049a/S-039 surfaces) | **Unverified** — S-089 STOP 1 verifies before scoping | Gate A ownership table §A |
| jest suite | **Verified-Exists** as code; **Verified-Never-Executed** in the build environment | Nova's disclosure, PR #800 / #787 |
| Migrations 252–257 | **Verified-Exists** on `dev`; not yet run on any deployed environment | Deploy-run items for Relay (D2) |
| Counsel determination (#788) | **Open; Sumanth-Waived for outreach** (no mail, 2026-10-13) — the waiver covers *contact*, not the determination itself | #788 record |

---

## Dependency Chain

```
S-088 audit ──► filed story set ──► reserve (4) ──► sequenced (audit priority) ──► Sprint 12 remainder (named)
#780 anchor fix ──► (audit may widen; reserve absorbs)
S-090 chassis ──► S-091 signal (dark) ──► S-092 UI (dark) ──► LIVE only when #788 closes (separate gate)
jest run (C-L3) ──► D2: post-sprint Relay promotion track (3 promotions; DB-path call costed first) ──► Sumanth promotion approvals
S-089 + #777 ──► first cohort session possible (enablement itself = Gate A re-entry contract, NOT this sprint)
#799 legal-hold ──► (precondition for any future RETENTION_PURGE_LIVE flip — Sumanth's separate call)
```

---

## Architectural Review (Pre-Sprint) — Rex

Rex reviewed all six areas against `origin/dev` (tip: PR #800 merge) before this plan finalised. **Overall verdict: the sprint's shape is SOUND** — his one structural warning is carried in Risks. Per item:

| Item | Verdict | Substance |
|---|---|---|
| Applications audit-first approach | **SOUND** | Audit is a code-reading exercise, not a system — the one architectural deliverable is the *enumeration contract* (which surfaces count as "the module"). Scout's map already enumerates it. Amendments adopted: the audit's **schema-truth leg runs first** (Rex hand-verified Scout's D2 hypothesis is a live conflict class — one `information_schema` query at audit start, and every later Nova STOP 1 consumes the audit's constraint record instead of re-verifying); five audit questions answered in his review (deletion-door, phantom writers, status writers, JSONB payloads, provenance ownership) and folded into #812's legs. Points stand (audit 3 / #780 5) **with the C2 split**: #780 keeps the C1 core; the C2 sweep is filed separately as **S-094 (#813, 3)** — *Lead adopted the split*. |
| Legal-hold (#799) | **AMEND** (adopted on #799) | Two seams, not one flag: `assertNotHeld` inside `erasePersonalData`'s transaction (DSAR maps the typed error to 409) + a skip predicate in the purge paths — which cannot see the candidate-less ledger rows, so the drain asserts too. Hold records are an **append-only events table**, never a mutable boolean. Pre-hold sweep + the retro-hold race stated as ACs. Points 5 → **6**. |
| Scorecard serving (S-093) | **SOUND WITH AMENDMENTS** (adopted on #810) | Lock = **server-computed boolean** (a submitted row exists), `not_submitted` derived never stored; scoping via the `scheduled_interviews → interview_sessions.company_id` chain (migration 125 has no `company_id` and no cascade — the FK/erasure tension is real and recorded as a Sprint 12 erasure obligation). Points 8 → **9**. |
| Threat-intel build | **Chassis SOUND · S-091 AMEND · S-092 AMEND** (adopted on #808/#809) | Rex corrected a factual premise: the `threat_intel_checks` table does not exist, but IP provenance **partially does** (`applications.ip_address`, migration 202, one writer, zero readers) — S-091 is provenance-*totality* work, points 3 → **5**, with a hard entry condition on #780's IP ruling. For S-092, "dark" is build scope this sprint: invariant tests (no read path, flag fail-closed, kill-switch drill, posture on the record). |
| S-077 follow-ups (#801–#805) | **ALL FIVE CONFIRMED, points stand** | Sharpenings adopted on the issues: #801 is surfacing, not emission (purge already logs structured events); #802's real defects are purged-vs-absent indistinguishability + swallowed read failures; #803 is audit + disposition with a stop rule; #805 must fail **closed** and handle the migration-253 NULL-company COALESCE trap. |
| jest + promotion | **AMEND** (adopted as D2) | Promotion is a **post-sprint, Relay-owned track in three promotions**, not an end-of-sprint event; the jest run stays in-sprint as the blocking gate; the staging-shares-prod-DB path question returns to Sumanth costed before Promotion 1. |

Also adopted from Rex's scope-gap pass: Sprint 10 retro delivered in this PR (his S-083-alias and retro debts — the alias issue is filed as #811); the Aria PRD amendment's three hardening conditions recorded on #634; the Gate A condition shadow completed — **C-L2 (PITR restore drill) is owned by Relay in the promotion track; C-L4 (Rung-2 synthetic validation) is owned by Quinn as enablement readiness** (both pre-activation, neither pointed in this sprint, both named here so they are not lost).

---

## Specialist Plan

**Planning-level answer (mandatory):** Sprint 11 planning itself dispatched Scout (Applications module mapping) and Rex (pre-planning architecture, above) — the planning-level specialists. Story-level plan:

| Story / item | Planned specialist | Why |
|---|---|---|
| S-088 audit | `gensecai/privacy-engineer` + `ecc/security-reviewer` | The audit's domains ARE privacy (erasure reach) and security (per-route authz). Scout discovers; these two judge. Database-reviewer considered and skipped at audit level — no schema change is audited; he joins any filed migration story. |
| #780 fix | `gensecai/privacy-engineer` | Erasure completeness is her proven domain (S-076/S-078 pattern). Database-reviewer skipped: single-table DELETE + storage-ledger pattern already established — Nova defends at STOP 1. |
| S-090 / S-091 / S-092 | `gensecai/privacy-engineer` (mandatory, design check + pre-PR) | Personal-data infrastructure; the per-employer silo and dark-by-default mechanics are privacy properties, not features. Lex consulted on S-090's retention default. Security-reviewer considered for S-091's silo proof — privacy-engineer covers the silo's data-flow claim; Nova's STOP 1 makes the final call. |
| S-089 Cohort Enablement | `gensecai/privacy-engineer`; Lex (sign-off seat, not a specialist dispatch) | Consent/audit-spine correctness; the cohort promise copy carries legal weight (Lex signs, CE drafts, Quinn verifies reconciliation as owner). |
| #799 legal-hold | `gensecai/privacy-engineer` + Lex review | Compliance machinery: a hold that misses a purge path is a legal defect, not a bug. |
| S-093 scorecards | `ecc/security-reviewer` (pre-PR) | Submit-and-lock is an authorisation property (person-as-scorer enforcement must refuse server-side). Hiring Manager persona owns the definition (owner seat). UX/a11y considered — the surfaces are existing report/panel patterns; Nova defends at STOP 1. |
| jest run | None | Quinn owns the run and triage; failures route to their owning stories. |
| #801 / #802 | `gensecai/privacy-engineer` (light pass) | Audit-trail content and a PII-adjacent leak; established patterns keep it light — Nova's STOP 1 call. |
| #785 / #777 | None planned | In-file guard pattern (F4 precedent); a one-line copy fix with Lex's sign-off as the gate. Nova defends "none" at STOP 1. |

Personas make the final specialist decision per story (planned ≠ forced). Tight briefs required.

---

## Blocked / Deferred (Explicit)

| Item | Issue | Status | Unblocks |
|---|---|---|---|
| S-049b real analysis | #697 | **Parked** under the Gate A re-entry contract (also blocked by #674/#681) | Contract triggers: counsel + design + validation; Nov 1 / Dec 1 checkpoints escalate to Sumanth |
| S-027 fusion / S-034 multimodal | #674 / #681 | **Parked**, same contract | Same |
| Threat-intel signal go-live | via #809 | **Blocked on #788** (CRA determination, P0 launch-blocker) | Counsel determination — no outreach authorised; escalates per contract dates |
| Employer vs recruiter roles | #766 | **Blocked on Sumanth** | His decision on Rex's recommendations |
| R2 plaintext cleanup run | #721 | **Pre-launch track** (environment-blocked from this VM) | Pre-launch, networked environment |
| Test-data purge / #336 accounts | #151 | **Pre-launch track** | Launch checklist |
| `RETENTION_PURGE_LIVE` flip | #760 record | **Awaiting Sumanth's separate approval** | His call; #799 hold build is the safer precondition |

---

## Out of Scope (Explicit)

- Any S-049b / S-027 / S-034 build work, and any Observer **activation** — enablement groundwork only; activation is the re-entry contract's separate, dated gate.
- Counsel outreach of any kind (Sumanth, 2026-10-13).
- #766 role-model implementation.
- External threat-intel sources (AbuseIPDB / HIBP / XposedOrNot) — held behind licensing + budget gates; not built, not contacted.
- S-068/#721 deletion run; #151 test-data purge — pre-launch track.
- Staging → main promotion — D2 covers dev → staging only; main waits for staging QA + Sumanth.

---

## Risks

| Risk | Mitigation |
|---|---|
| **The sprint's real risk is not any single story — it is the seam between this sprint's builds and the parked Gate A machinery (Rex).** S-093's scope chain runs through the same `interview_sessions` rows S-085's capture registry keys off; #780's delete-vs-redact call decides what S-091 may retain; #799's hold seam sits on the same erasure door C-L1's outcome-row deviation is still open against. None of these is a dependency in the blocking sense — they are *shared-substrate* couplings, and shared-substrate couplings are exactly how a parked chain wakes up broken. | Sequencing keeps substrate-sharing stories from running concurrently (the Sequenced Set is an order, not a menu); #780's ruling lands before S-091/S-094 build; the hold seam lands before any purge-live conversation; C-L1 stays an unchecked activation-checklist line until resolved |
| Applications audit surfaces more than reserve + tranche | Remainder rolls to Sprint 12 **named at sprint review**; the module commitment is honoured by sequencing, not by pretending one sprint absorbs an unaudited module |
| Sumanth's gate throughput (he approves every story gate personally) | One build in flight per track; the sequenced set's order is the priority when his review time is the constraint |
| jest first run exposes accumulated pre-existing failures | Quinn triages inside the item's 2 pts; promotion (D2) slips rather than forcing; failures file to owning stories |
| #788 stays open (no outreach) while S-092 completes | By design: S-092 completes built-and-dark; go-live is a separate gate that cannot be reached accidentally |
| S-089 STOP 1 finds the audit spine largely unbuilt | Points are provisional *because* of this; STOP 1 reports before build, and the sequenced order absorbs re-pointing before other items start |
| Migration stack 252–257 has never run against a real DB from this environment | D2's runbook carries a staging-first run with Relay verification; the known VM limits (Neon TLS) are stated, not discovered, at promotion time |

---

## Definition of Done (Sprint)

- [ ] S-088 audit delivered: full Applications story set filed with verified dependency states; tranche dispositioned (reserve / sequenced / Sprint 12) in the sprint review
- [ ] #780 merged: `job_applications` + the C2 application-keyed tables inside erasure per the delete-vs-redact set, privacy-reviewed, with a local-PG erasure dry-run as evidence
- [ ] #785 merged; #777 merged (promise removed, Lex-signed)
- [ ] Aria's PRD scope amendment delivered and recorded on #634
- [ ] jest first real run executed and reported (C-L3 discharged); D2 promotion track handed to Relay with the database-path question costed for Sumanth's promotion gate
- [ ] Sequenced set: every item either started in order or named as rolled to Sprint 12 in the sprint review
- [ ] D1 + D3 resolved at plan gate; Sprint 10 retro merged (this PR)
- [ ] No open P0/P1 regressions
