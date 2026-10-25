---
project: Rekrut AI — Full Application
phase: 3-Solutioning
created: 2026-10-13
owner: Sumanth
architect: Rex
status: DRAFT — at Sumanth's gate; nothing in this document is a build instruction until he rules
method: smart-sdlc `create-epics-stories`, designed fresh from the application (see §0)
inputs:
  - "Scout's full-application relearn (00-relearn/project-knowledge-base-2026-10-13-full-application.md) — verified module states, journeys, reverse ADRs"
  - "Rex's 23 module PRDs (02-planning/full-application/prds/, PR #835) — requirements baseline, incl. 2026-10-13 tiered-Observer + scoring rulings"
  - "Scout's UI/wiring audit 2026-10-13 (143 page files, ≈120 routed screens; 27 findings: BROKEN 9 · DEAD 6 · MOCK 8 · ABSENT 4) — findings used as facts"
---

# Full Application — Epics & Stories (Phase 3 Design)

## 0. Basis — read this first

**This design is FRESH from the application.** Per Sumanth's correction (2026-10-13, 13:31 PDT — *"no previous issue can be used to work for the full application scoping"*, reversing his steer of minutes earlier): previous GitHub issues of every era — the Phase 3 set, the Sprint 9–11 sets, the legacy backlog, **and Lead's 73 scope-filings** — are **reference only**. They were read to avoid missing a known fact. They are **not** the story layer: no story below is mapped onto an old number, no filed point governs any estimate, and no old issue's premise, title, or sizing is inherited. Every epic and story here is newly specified — goal, acceptance criteria, points, dependencies with verified states — on the application's evidence alone (Scout's verified relearn, the 23 PRDs, the wiring audit's findings).

Why the correction is right, in one line: today's stale premises — staging "live Stripe keys" (false since Oct 7), the "duplicate TrustScore" (falsified), the 8-pt scorecard story priced on routes that already exist — **all propagated through old issues**. A design that inherits the backlog inherits its errors.

Three consequences, honoured throughout:

1. **Totals derive from this design** (§1), not from filed points. Variance against PR #913's filed-basis totals is explained in §6 as a basis difference — neither number is "wrong"; they were built differently, and this one now governs the build.
2. **Traceability without inheritance:** where a designed story lands on the same work an old issue describes, one line notes it — *"Comparable prior item: #NNN — not used as basis."* Nothing more.
3. **The old backlog's disposition is not decided here.** Nothing in this document proposes closing, superseding, or migrating any old issue. That is a separate explicit decision Sumanth will make later. Lead files **new** issues from this design (backlog ownership stays his); story bodies reference their parent epic (this document's §2 sections, and the epic issues Lead files from §2).

**Sprint 11 / Tranche 1 continues as approved** — its stories came from Scout's fresh runtime audit (S-088), not legacy inheritance; where this design covers the same ground, the comparable-item line says so and the sprint's work is the first build of the designed story, not a duplicate of it.

**Conventions.** Story IDs: **FS-001…** (Full-application Stories), unique to this design. Points: Fibonacci (1/2/3/5/8/13), Rex's estimates. Dependencies carry **verified states** (Verified-Exists / Verified-Absent / Decision-Open) per the 2026-10-12 panel rule — a story whose dependency lacks a verified state is blocked by definition. **[GATE: …]** marks a story that cannot start (or cannot enable) until the named ruling/condition lands. **FULL** marks post-launch tranche stories; everything else is LAUNCH tranche. A module epic is **done** when: every LAUNCH story merged → Scout wiring re-audit of the module shows zero BROKEN/DEAD/MOCK-presented-as-real findings → Quinn's module test evidence exists → closure note posted (Lead's programme rule 1, adopted as this design's epic DoD).

**Design decisions the PRDs left silent** are boxed in §5 (DD-1…DD-11) for Sumanth — each states what I decided, why, and what flipping it costs.

---

## 1. Designed totals

| Tranche | Stories | Points |
|---|---:|---:|
| **LAUNCH** — January product whole at ruled scope | 135 | **544** |
| **FULL-ONLY** — deferred by ruling or contract (post-launch) | 20 | **207** |
| **Full application** | **155** | **751** |

Per-epic rollups in §2. Variance vs PR #913 (LAUNCH 391–557, FULL 564–822): this design's LAUNCH lands near the top of the filed range and its FULL inside it — §6 itemises why (three placement differences, two arithmetic corrections to the scope's own rollups, contingencies priced instead of ranged). At ≈20 pts/sprint with Sumanth at every gate, LAUNCH remains a multi-sprint programme exceeding the pre-January sprints — the calendar fact is unchanged by the change of basis, and §4's waves are ordered so January is assembled from **finished** epics, not half-epics.

---

## 2. Epics and their stories

Epic order below is build order (waves in §4). Prior-epic note: the Phase 3 interview epics (E-001…E-009, filed 2026-10-10) cover parts of E-M08–E-M12/E-M16/E-M19 below; under the fresh-design rule they are comparable prior items at the epic level — this design's epics are newly specified and govern.

---

### E-M06 — Applications & Pipeline · LAUNCH 67 · FULL 0 · Wave W0 (in flight)

**Goal:** the hiring pipeline is authorisation-safe, erasable, and state-truthful end to end. **Done =** no actor can read or mutate an application outside their company scope; a candidate's erasure removes the full application family; every status in the system was written by an authorised transition. **Gates:** D-M06-2 (FS-041 only).

**FS-024 — Server-authoritative application status transitions · 5**
As a recruiter, I need status changes to be mine alone to make, so a candidate can never advance — or un-reject — themselves.
- [ ] Candidate-legal transitions are exactly: withdraw (and system transitions); every other status write requires a recruiter/hiring-manager role **and** company scope matching the application's owning company
- [ ] A candidate attempt to set `hired`/`offered`/any recruiter status returns 403 and writes an audit event; a recruiter's rejection cannot be altered by any candidate path (Kanban drag included)
- [ ] Regression tests prove all three S-088 fixture attacks fail
Deps: M2 scoping middleware (Verified-Exists) · Comparable prior item: #820 — not used as basis.

**FS-025 — Explain-endpoint object authorisation · 3**
As a candidate, I need my data unreachable by ID-guessing, so sequential identifiers reveal nothing.
- [ ] `/explain/*` application + OmniScore explain endpoints perform an object-level check (same-company or candidate-self) before any field is serialised; out-of-scope IDs return 404/403 with no data
- [ ] `recruiter_notes` never serialises to candidates or out-of-company recruiters on any explain payload
- [ ] Enumeration test (sequential IDs, foreign recruiter token) returns zero candidate fields
Deps: FS-024's scope pattern (designed above) · Comparable prior item: #821 (explain portion) — not used as basis.

**FS-026 — Audit-export authorisation · 2**
As a platform operator, I need the all-logs export restricted to platform admins, so an ordinary authenticated user can never download the audit trail.
- [ ] `/audit/export` requires platform `admin` (not company `owner`, not any-authenticated) and is company-scoped where a company context exists
- [ ] Export access itself is audit-logged
Deps: M20 admin auth (Verified-Exists) · Design decision DD-1 (§5) · Comparable prior item: #821 (sibling portion) — not used as basis.

**FS-027 — Screening-send company-scope enforcement · 3**
As a company, I need screening sends to touch only my own applications.
- [ ] `POST` screening-send validates the application's owning company against the caller's company before creating any session or mutating any status; cross-company attempts 403 with audit event, zero side effects (no session row, no status change on either side)
- [ ] Fixture test reproduces the S-088 cross-company attack and proves it fails atomically
Deps: M9 screening send (Verified-Exists) · Comparable prior item: #822 — not used as basis.

**FS-028 — Legal hold consulted at every purge site · 5**
As the platform, I need a hold switch that every deletion path obeys, so widening deletion can never destroy data under legal hold.
- [ ] A per-candidate/per-matter hold flag exists (the `observerCapture.js` stub's seam replaced with a real implementation); every purge/erasure-deletion site consults it per record **before** deleting
- [ ] Hold-check failure fails closed (purge stops, error surfaced) — never skips the check
- [ ] Hold covers DEK destruction for capture artefacts (a held candidate's keys are not shredded)
- [ ] Tests enumerate every purge site and prove hold blocks each one
Deps: purge sites inventory (Verified-Exists — S-077 machinery) · This is the programme's brake: FS-029/FS-035/FS-120 cannot start until this merges · Comparable prior item: #799 — not used as basis (in flight under Sprint 11; this design adopts the same requirement fresh).

**FS-029 — Application-family erasure completeness · 8**
As a candidate, I need "delete my data" to delete my applications too.
- [ ] Erasure deletes, in one transaction: `job_applications` rows plus every application-keyed personal-data table (cover letter, screening answers, notes, derived scores, proctoring/explanation artefacts per the inventory AC below), with storage objects queued via the migration-252 pending-deletions ledger
- [ ] The story's first AC is the inventory itself: the table list is enumerated from the schema and recorded on the story; any table added later joins via FS-124's procedural rule
- [ ] Seeded-fixture dry-run proves zero surviving personal fields post-erasure (the S-088 dry-run, inverted)
- [ ] Hold check (FS-028) is consulted per record
Deps: erasure service (Verified-Exists) · FS-028 (brake) · Comparable prior items: #780, #813, #829 — not used as basis.

**FS-030 — One creation path for applications · 5**
As the platform, I need exactly one way an application comes to exist, so integrity rules live in one place.
- [ ] All creation flows (direct apply, one-click, ai-screener, referral) converge on one creation function; the phantom-creation funnel is removed
- [ ] `applied_via` is validated against the CHECK constraint before insert on every path
- [ ] Duplicate-application behaviour is defined in one place and tested per source path
Deps: creation paths inventory (Verified-Exists — 3 paths, Scout/S-088) · Comparable prior item: #823 — not used as basis.

**FS-031 — Duplicate status endpoints converged · 3**
- [ ] The duplicate recruiter status endpoints are reduced to one canonical endpoint; the other returns 410 or delegates identically (no behavioural fork)
- [ ] All clients call the canonical endpoint
Comparable prior item: #825 — not used as basis.

**FS-032 — Status vocabulary single-sourced · 2**
- [ ] One status vocabulary definition feeds aggregations, stage config, and both dashboards; drift between server aggregations and client stage config is impossible by construction (shared constant + contract test)
Comparable prior item: #826 — not used as basis.

**FS-033 — Application state machine · 5**
As a hiring team, I need transitions to follow rules, so pipeline state is always explainable.
- [ ] Legal transition map exists server-side (from-state → to-state → who); illegal transitions 409 with the rule named
- [ ] Every transition writes a consistent audit-trail entry (actor, from, to, at) readable in one place
Deps: FS-024, FS-032 · Comparable prior item: #827 — not used as basis.

**FS-034 — Visibility filtering on application-derived surfaces · 3**
- [ ] Every surface derived from applications (lists, counts, exports) applies the same visibility rules as the application read itself — soft-deleted/hidden candidates never leak through an aggregate or sibling surface
Deps: FS-025 pattern · Comparable prior item: #828 — not used as basis.

**FS-035 — Terminal-application retention + purge path · 5**
- [ ] A retention policy for terminal-state applications (rejected/withdrawn/hired-closed) is implemented: age-based purge path exists, dry-run capable, hold-checked (FS-028)
- [ ] Policy values are config, matching the M19 schedule's single source
Deps: FS-028, FS-029 · Comparable prior item: #830 — not used as basis.

**FS-036 — Consent/notice for reuse of past application content · 3**
- [ ] Reusing a candidate's past application content (e.g. prefill, re-application) presents a notice and records the candidate's consent state; reuse without the artefact does not occur
Deps: M19 consent service (Verified-Exists) · Comparable prior item: #831 — not used as basis.

**FS-037 — Batch status shortfall reporting · 2**
- [ ] Batch status updates report per-ID outcomes (updated / skipped + reason); silently dropped IDs are impossible
Comparable prior item: #832 — not used as basis.

**FS-038 — Questionnaire access-check dead clause · 1**
- [ ] The dead `user_id` clause in the questionnaire access check is removed or made live — verified by a test that exercises the check's real predicate
Comparable prior item: #833 — not used as basis.

**FS-039 — `hired_at` truthfulness · 2**
- [ ] `hired_at` is set exactly when a transition to `hired` commits (FS-033's trail is the source); historical rows' treatment is stated on the story; time-to-hire computes from it only
Deps: FS-033 · Comparable prior item: #834 — not used as basis.

**FS-040 — Object-authorisation convention: application remainder · 5**
- [ ] Every application-scoped read/write not covered by FS-024–FS-027 names and performs the platform object-authorisation check (E-X FS-145's convention); a route inventory on the story shows zero unchecked application endpoints at close
Deps: FS-145 (convention — Verified-Absent until E-X W0 lands) · Comparable prior item: #856 — not used as basis.

**FS-041 — Candidate application view: mutual fit + Trust Score · 3 · [GATE: D-M06-2]**
As a candidate, I want the pairing numbers where I decide whether to proceed.
- [ ] The candidate's per-application view shows mutual fit and the company's Trust Score, computed from corrected inputs only; absence renders "Insufficient data"
Deps: FS-076/FS-078 (score input corrections) · Gate is Sumanth's D-M06-2 ruling (PRD recommendation: show) · Comparable prior item: #857 — not used as basis.

**FS-042 — Pipeline list payload re-audit · 2**
- [ ] Every pipeline list payload is re-audited against the S-087 explicit-projection rule post-spine; any `SELECT *`-class serialisation found is trimmed in this story or filed as a named defect on it
Deps: FS-024–FS-027 (spine) · Comparable prior item: #858 — not used as basis.

---

### E-M19 — Consent, Privacy & Compliance · LAUNCH 25 · FULL 0 · Wave W0–W1

**Goal:** erasure, retention and hold are complete, armed by evidence, and procedurally un-bypassable. **Done =** the published 90/30-day policy has working enforcement behind it, and no surface presents invented compliance data. **Gates:** D-M19-1 (the flip itself — Sumanth's manual act, not a story). *The hold build itself is designed as FS-028 in E-M06 (its consumers' home; DD-2) and cross-referenced here at 0 pts.*

**FS-117 — Purge arming by database identity · 3**
- [ ] The purge arms on an explicit database-identity check (which database this process is connected to), never on `NODE_ENV`; the current env-gate condition is removed
- [ ] Arm state is visible in an admin/compliance surface (armed / dry-run / off, per database)
- [ ] Tests prove: wrong-database process cannot arm; right-database process arms only with the live flag
Deps: purge cron (Verified-Exists, S-077) · Comparable prior item: #805 — not used as basis.

**FS-118 — Retention audit surface completion · 2**
- [ ] Purge events write aggregate-only entries to `compliance_audit_trail` (no per-record personal data in the audit surface) and a read surface exists for them
Deps: migration 254 trail (Verified-Exists) · Comparable prior item: #801 — not used as basis.

**FS-119 — `[purged]` sentinel leak closure · 2**
- [ ] User-facing recordings/transcript API responses render purged content as absence (field omitted/null), never as the `[purged]` marker string; a response-shape test covers both named endpoints
Comparable prior item: #802 — not used as basis.

**FS-120 — Retention backfills, dry-run first · 3**
- [ ] Historical `.enc` recording corpus and soft-deleted transcripts are brought under the retention machinery: inventory, dry-run report (counts by class/age), then live run only as a separately gated act
- [ ] Hold check (FS-028) applies to every backfilled purge
Deps: FS-028 · Comparable prior item: #803 — not used as basis.

**FS-121 — `recording_objects` retry hardening · 2**
- [ ] The three named defects (retry counter, dead-letter visibility, partial-failure state) are fixed with tests; a failed storage deletion can never silently report success
Comparable prior item: #804 — not used as basis.

**FS-122 — Recruiter compliance page on the real API · 5**
As a recruiter, I need my compliance page to show my company's actual posture, not a mock.
- [ ] The 1,342-line mock page is replaced by the real compliance API the admin surface already uses; zero mock data remains reachable; loading/empty states are honest
Deps: compliance API (Verified-Exists) · Comparable prior item: #893 — not used as basis.

**FS-123 — Purge dry-run evidence pack · 2**
- [ ] A reproducible pack exists: boundary-age seeded tests (89/90/91 d, 29/30/31 d), a never-select control set, an independent reconciliation query, storage-object deletion proof, and Lex's per-record-type carve-out list applied — this pack is the record the D-M19-1 flip decision stands on
Deps: FS-117 · Gate: feeds D-M19-1 · Comparable prior item: #890 — not used as basis.

**FS-124 — Erasure inventory made procedural · 3**
- [ ] The erasure map is a checked artefact: a review/CI rule fails any change adding a personal-data table without a map entry (delete / redact / retain-with-basis)
- [ ] The current map is audited complete against the schema at this story's close
Deps: FS-029's inventory method · Comparable prior item: #891 — not used as basis.

**FS-125 — DSAR / audit / consent-middleware verification pack · 3**
- [ ] Evidence, per item: DSAR export completeness against a live-schema fixture; biometric audit append-only guarantee tested (update/delete attempts fail); consent middleware's generality proven or its limits written into the compliance docs
Gate: discharges at the D2 staging gate (real DB) · Comparable prior item: #892 — not used as basis.

---

### E-M11 — AI Observer & Integrity · LAUNCH 32 · FULL 39 · Waves W0 (spine) / W1 (tiers)

**Goal:** one tiered Observer system per Sumanth's 2026-10-13 ruling — the recruiter controls enablement, the candidate controls the tier, no tier fabricates what it doesn't have. **Done (LAUNCH) =** Tier 1+2 live for the cohort on evidence; Tier 3 fully designed and parked on its contract. **Gates:** #777 blocks any enablement; C-04/C-05 (counsel, #788 track) gate Tier 3 classes; D-M11-1 gates FS-070/FS-071's shape.

**FS-065 — Cohort Enablement: the January audit spine · 8**
- [ ] For every cohort session: consent record, attendance, and `analysis: not provided in this release` are recorded in the audit shape PRD-M11 §4 defines; the cohort allow-list is a named-employer config whose additions require Sumanth's approval
- [ ] Enablement is impossible (server-side) for a non-cohort employer or with the spine incomplete
Deps: observer worker + gate (Verified-Exists) · Comparable prior item: #806 — not used as basis.

**FS-066 — Tier 1 no-media presence branch · 8**
As a candidate, I can have the Observer present without anything of mine being received.
- [ ] A presence branch exists that **cannot** subscribe: no media subscription/decode/record/transcribe/measure code path is reachable in Tier 1 mode (structural, not flag-based)
- [ ] Advance notice artefact (Observer named as an AI attendee) + objection path: objection → Tier 0, recorded independently of employer enablement, never a negative signal on any surface
- [ ] Tier resolution is server-authoritative from artefacts at scheduling and re-checked at join (PRD-M11 §3 state machine, incl. downgrade-only mid-session transitions)
- [ ] Only writes: attendance + `analysis_provided: false`
Deps: FS-065 spine · Counsel C-04 noted open per Sumanth's ruling (not build-blocking; an adverse answer re-opens enablement) · Comparable prior item: #838 — not used as basis.

**FS-067 — Tier 2 post-lock combined-feedback composer · 6**
As a candidate, I receive one combined qualitative report; as an interviewer, my judgement forms blind.
- [ ] The composer consumes **locked** scorecards only (via FS-059's resolver); unlocked/absent material → honest empty state, never a partial composition
- [ ] Every combined statement carries provenance to its human source field(s); the candidate surface shows the combined narrative only — no source separation, no AI labelling, no interview score
- [ ] The recruiter surface shows sources + combined version, distinguished
- [ ] Server-side blindness: an interviewer cannot retrieve any AI/combined artefact for a session before their own scorecard locks (API-level, incl. the recruiter==interviewer case via scorecard state)
Deps: FS-059, FS-060 · Comparable prior item: #839 — not used as basis.

**FS-068 — Tier 1+2 gate evidence pack · 5**
- [ ] Non-vacuous proof set: SFU offers tracks → zero subscriptions/frames/buffers/writes in Tier 1 (Dormancy-Pack style); tier-resolution state coverage (all §3 rows); blindness-at-API incl. same-person fixture; composer provenance fail-closed test; T-16 indistinguishability of Tier 0/Tier 1+2 on recruiter surfaces
- [ ] Enablement of FS-066/FS-067 is blocked until this pack passes
Deps: FS-066, FS-067 · Comparable prior item: #873 — not used as basis.

**FS-069 — `observerJobs` terminal-state guard · 1**
- [ ] `markObserving()` cannot overwrite a terminal state; test covers each terminal state
Comparable prior item: #785 — not used as basis.

**FS-070 — Toggle end-state record (#334 question) · 1 · [GATE: D-M11-1]**
- [ ] The Record/Observer toggle question is closed **in writing** in the product record: either the split is implemented or the single enablement control is recorded as the decision (PRD recommendation: revoke the split)
Gate: Sumanth's D-M11-1 ruling · Comparable prior item: #334 — not used as basis.

**FS-071 — Recording decoupling for Observer-less human interviews · 3 · [GATE: D-M11-1 alternative]**
- [ ] If ruled: recording egress starts on human-session start when Record is on, independent of Observer enablement (today a human interview without the Observer gets no recording); recording consent remains its own artefact, granular from AI-processing consent
Gate: only built if D-M11-1 rules decouple instead of revoke-only · Comparable prior item: #334 (functional residue) — not used as basis.

**FS-072 — FULL · Tier 3: capture-substrate activation + Rung 2 evidence · 8**
- [ ] Dormant capture activates only under the re-entry contract state; Rung 2 live-room validation on staging passes; kill-watchdog ≤2 s proven
Gate: Gate A re-entry contract + C-05 + Sumanth activation approval · Comparable prior items: #787/#800 (built dormant) — not used as basis.

**FS-073 — FULL · Tier 3: validated speech-pattern slice · 13**
- [ ] One measurement slice (speech pattern) activates for the cohort pilot only after Quinn's validation protocol passes on the synthetic corpus (per-measurement accuracy gates, anti-fabrication suite); latency-class measurements render `missing` where the design requires
Gate: FS-072 + validation protocol · Comparable prior item: #674 (fusion family) — not used as basis.

**FS-074 — FULL · Tier 3: analysis population of reports (S-049b remainder) · 13**
- [ ] Granted sessions' reports populate from real analysis: writer fires only for granted sessions, abort-if-job-gone race test mandatory, shared advisory lock with erasure closes the concurrent window; integrity events listed individually, no aggregate score
Gate: FS-073 · Comparable prior items: #697, #681 — not used as basis.

**FS-075 — FULL · Activation-conditions closure (C-L track) · 5**
- [ ] C-L1 outcome-rows disposition resolved per counsel C-06 or code-aligned to the design; C-L2 PITR window + bucket-versioning evidence on file (with Lex acceptance if window >30 d, incl. PITR-restore re-erasure runbook); C-L4 Rung 2 recorded
Gate: activation-blocking set from Lex's pre-merge ruling · Comparable prior item: #874 — not used as basis.

---

### E-M12 — Scoring (OmniScore / Trust Score) · LAUNCH 22 · FULL 34 · Wave W1

**Goal:** the candidate's OmniScore and the company's Trust Score run on corrected, ruled inputs — practice is not evidence, real evaluations are. **Done (LAUNCH) =** the composite's inputs are exactly the ruled ones, with the version note shipped. **Gates:** D-M12-4 gates the FULL set.

**FS-076 — Practice out of OmniScore + readiness panel · 8**
As a candidate, I need my score to reflect evaluated performance, not practice volume.
- [ ] Practice contributes zero to the composite (one-time drop for practised candidates announced as a correction with a version note)
- [ ] A labelled readiness panel sits beside the score (role, completed count, latest, trend, date; "practice — self-directed, not proctored, not part of OmniScore"); full mock and Quick Practice never averaged together; fallback-scored sessions excluded from anything recruiter-facing
- [ ] The panel never feeds ranking/filtering/matching/auto-reject (guardrail test)
Deps: FS-055 (fallback provenance) · Comparable prior item: #791 — not used as basis.

**FS-077 — Practice-fact marker + narrowed recruiter endpoint · 5**
- [ ] Marker is candidate opt-in, default OFF (fail-closed); counts/dates only — never scores or coaching content; absence renders as nothing (no marker, no empty box)
- [ ] Role-tied to the application; never a filter/sort/rank/match input
- [ ] The recruiter endpoint that exposed full practice history + scores + coaching is narrowed to this contract
Deps: FS-076 · Comparable prior item: #792 — not used as basis.

**FS-078 — Evaluations pipe repair · 5**
- [ ] Real `interview_evaluations` reach the engine through one documented pipe; a regression test proves a recorded evaluation moves its factor
- [ ] Weights stay frozen (25/20/15/10/10/10/5/5) until outcome validation exists; the score change ships under FS-076's version note discipline
Comparable prior item: #793 — not used as basis.

**FS-079 — Visibility-model fidelity + ratings data-supply check · 3**
- [ ] Per-surface verification against PRD-M12 §2's visibility table (delta hidden from both, interview scores recruiter-only, integrity observations recruiter-only); every deviation found is fixed here or filed as a named defect on this story
- [ ] `company_ratings` write-path verified: whether the Trust Score's Feedback component has any live data supply is answered with evidence (feeds D-M07-1)
Comparable prior item: #875 — not used as basis.

**FS-080 — Trust Score duplication record · 1**
- [ ] The record states, with the caller-check evidence: `trustscore.js` is the live company engine; `trustscore-standalone.js` is a separate supplementary-metrics service, renamed on its surface only if FS-081–083 touch it; nothing is deleted
Comparable prior item: #175 — not used as basis (premise falsified 2026-10-13).

**FS-081 — FULL · Two-sided completion I: role-connected composite · 13 · [GATE: D-M12-4]**
- [ ] The composite consumes role context (existing `role_scores`) so a candidate's score is stated per role where role data exists; global composite remains the fallback, labelled as such
Comparable prior item: #876 (part) — not used as basis.

**FS-082 — FULL · Two-sided completion II: company-specific candidate scores · 13 · [GATE: D-M12-4]**
- [ ] A per-pairing candidate score ("fits YOUR company") is computed from corrected inputs only (FS-076/FS-078 landed), displayed only where the computation actually ran
Deps: FS-081 · Comparable prior item: #876 (part) — not used as basis.

**FS-083 — FULL · Two-sided completion III: per-role peer percentile · 8 · [GATE: D-M12-4]**
- [ ] Peer percentile is computed within the candidate's role cohort (role taxonomy source named in the build); the global-cohort percentile is retired or labelled global
Deps: FS-081 · Comparable prior item: #876 (part) — not used as basis.

---

### E-M15 — Threat-Intel · LAUNCH 11 · FULL 3 · Waves W0–W3 (dark)

**Goal:** the narrowed-v1 chassis + one internal signal exist, cryptographically siloed, disputable by design, and **dark** until counsel lands. **Done (LAUNCH) =** built dark; nothing recruiter-visible. **Gates:** #788 (counsel, no-outreach standing) gates FS-097 only. *Ordering note: FS-094 writes into M6's creation path — it sequences **after** FS-030 (funnel consolidation) so the capture is built once, on the single creation path (see §6.4).*

**FS-094 — Application-time IP capture + consent gate · 3**
- [ ] At application creation, the source IP is stored only as `HMAC(ip, per-company key)` — raw IP never persists; the consent gate for the signal's basis is recorded per the spec (incl. India explicit-consent condition)
Deps: FS-030 (single creation path) · Comparable prior item: #815 — not used as basis.

**FS-095 — Chassis: checks table + evaluation plumbing, dark · 5**
- [ ] `threat_intel_checks` exists with provenance/timestamp/source on every row; evaluation runs inside the employer's silo only; no UI surface reads it
Deps: FS-094 · Comparable prior item: #807 — not used as basis.

**FS-096 — Internal repeat-IP signal · 3**
- [ ] Multiple applications to the same employer from the same siloed IP produce an `info`-severity observation **on the application** — never a person/IP blocklist, never an input to ranking/filtering/matching/scoring/auto-reject (guardrail test)
Deps: FS-095 · Comparable prior item: #808 — not used as basis.

**FS-097 — FULL · Recruiter review UI · 3 · [GATE: counsel determination closed]**
- [ ] Confirm/dismiss with dispute path; every state change logged; signal provenance shown on its face
Gate: does not start until the CRA determination lands · Comparable prior item: #809 — not used as basis.

---

### E-M01 — Auth & Accounts · LAUNCH 9 · FULL 0 · Wave W2

**Goal:** every sign-in path is fast, proven on staging, and regression-locked. **Done =** the employer OAuth block can never silently regress, and reset/revocation are evidenced, not assumed. **Gates:** none (D-M02-1 binds FS-005's output into FR-M01-2 — no separate M1 story).

**FS-001 — OAuth employer-block regression lock · 2**
- [ ] Automated tests on both providers prove: employer OAuth signup is blocked (redirect with the block flag), candidate OAuth completes; the block lives in code (`routes/auth.js`) and the tests fail if it is removed
Comparable prior item: #840 — not used as basis.

**FS-002 — Post-auth redirect latency: diagnose + fix · 3**
- [ ] Root cause of the 6.1 s post-auth redirect is identified and recorded on the story; post-fix redirect completes < 2 s measured on staging; no auth behaviour changes
Comparable prior item: #105 — not used as basis.

**FS-003 — Staging auth behaviour evidence · 2**
- [ ] On staging: password reset completes end-to-end via a real email; a revoked refresh token is rejected on next use; evidence captured in the run record
Gate: discharges at the D2 staging gate · Deps: M18 email (Verified-Exists; behaviour Verified-Absent until FS-113) · Comparable prior item: #841 — not used as basis.

**FS-004 — Auth E2E suite repair · 2**
- [ ] The auth E2E suite runs green headlessly with no manual fixture steps; flaky/friction cases are fixed or quarantined with a named reason on the story
Comparable prior items: #184/#185 — not used as basis.

---

### E-M02 — Companies, Teams & RBAC · LAUNCH 28 · FULL 0 · Wave W2

**Goal:** one role model, truthful ownership, no admin/owner conflation. **Done =** the DB CHECK and the RBAC map state the same model, and "who is the owner" has exactly one answer everywhere it is read. **Gates:** D-M02-1 gates FS-005 (and thereby the model's dependents).

**FS-005 — One role model, implemented · 8 · [GATE: D-M02-1]**
As a company, I need the permission model to be the one that was decided — in the database and the RBAC map alike.
- [ ] The ruled model is implemented identically in the `users.role` CHECK and the RBAC map (migration 128 lineage); no creatable role value is unmappable
- [ ] Existing `employer`-role users are migrated per the ruling with an auditable migration; nobody loses company access silently (before/after census attached — FS-006's output)
- [ ] Invite authority matches the ruling (under the panel package: differentiated invites — invite below your level, never above; all invites audited)
Deps: FS-006 (enumeration first) · Gate: Sumanth's #766 ruling (options + recommendation on file since 2026-10-11; the ownership sibling questions joined 2026-10-13) · Comparable prior item: #766 — not used as basis.

**FS-006 — Employer census + conflation enumeration · 2**
- [ ] A DB-read report exists: employer-role user count, and every site where `admin` vs `owner` (and `owner_id` vs RBAC owner row vs `users.role`) is read inconsistently — the enumeration FS-005 and the rebuilt #6 package both consume
Gate: discharges where a DB read is possible (D2/staging or a networked env) · Comparable prior item: #843 — not used as basis.

**FS-007 — Ownership truth at signup · 3**
- [ ] Company creation tells the creator, explicitly, "you are now the OWNER — what that means, and how to hand it over"; a transfer prompt is reachable from the company settings from day one
Comparable prior item: #846 (part) — not used as basis.

**FS-008 — Rekrut-side ownership recovery path · 3**
- [ ] A manual, evidence-based recovery exists: a company whose recorded owner is unreachable/refusing can have ownership reassigned by platform admin on documented evidence, Sumanth-approved per case, fully audit-logged, both parties notified
- [ ] No self-serve claim path is created (an unverified claim is not a recovery)
Deps: FS-006 · Comparable prior item: #846 (part) — not used as basis.

**FS-009 — Suspend discipline + `is_verified` truth · 3**
- [ ] Member suspend requires the same audit + notification discipline as ownership transfer (actor, reason, notice to the suspended member and the owner)
- [ ] A company is no longer stamped `is_verified = true` from signup domain alone; the flag asserts only what an inbox/domain-control step actually proved
Comparable prior item: #846 (part) — not used as basis.

**FS-010 — Candidate company-profile page wiring · 3**
- [ ] The candidate-facing company-profile page loads from a candidate-authorised endpoint (today it calls a recruiter-gated endpoint with a candidate token and can never load); its Sign Out button works
Comparable prior item: #844 — not used as basis.

**FS-011 — Recruiter-profile fake surface: retire or wire · 3**
- [ ] The hardcoded fake recruiter-profile page (local-only Save) is either wired to the real company profile or removed with its routes redirected; no reachable surface presents invented company data (design default: retire — DD-8's sibling rule; wiring is justified only if a distinct recruiter-personal profile requirement is produced)
Comparable prior item: #845 — not used as basis.

**FS-012 — Object-authorisation convention: company/team mutations · 3**
- [ ] Company/team mutation endpoints perform the platform object-authorisation check (FS-145's convention); inventory on the story shows zero unchecked mutations at close
Deps: FS-145 · Comparable prior item: #842 — not used as basis.

---

### E-M03 — Jobs & Careers · LAUNCH 12 · FULL 0 · Wave W1 (fabrication set) / W2

**Goal:** jobs and public career pages show only real data. **Done =** no fabricated company, score, or salary can render on any job surface.

**FS-013 — Salary entered = salary displayed · 3**
- [ ] The entry→display break is found and fixed; a contract test renders a job with each salary shape (range/fixed/none, both launch-market currencies) and asserts display equality
Comparable prior item: #315 — not used as basis.

**FS-014 — Careers fabricated company score: remove + suppress · 2**
- [ ] The server-side `|| 75` fallback is deleted; the public company score is suppressed until a real Trust Score basis + correction route + minimum-data threshold exist — the surface renders "Insufficient data" or nothing (ruled fix, Sumanth 2026-10-13)
Comparable prior item: #836 — not used as basis.

**FS-015 — Career-page invented-company fallback removal · 2**
- [ ] On any API error the recruiter career page renders an honest error/empty state — never a substituted invented company; the job-form preview mock is labelled as preview or removed
Comparable prior item: #849 — not used as basis.

**FS-016 — Job-posting content check in the create flow · 3**
- [ ] The create flow carries the US/India posting check (discriminatory-language patterns + required disclosures per market) as guided validation: flagged text is shown to the poster with the rule; saving a flagged post requires an explicit edit or acknowledgement recorded with the post
Design basis: PRD-M03 FR-M03-3 (checklist minimum, mechanised as guided validation — DD note §5) · Comparable prior item: #847 — not used as basis.

**FS-017 — Public career page validation + published-only proof · 2**
- [ ] Server-side required-field validation on career-page inputs; a test proves draft/unpublished jobs never render publicly
Comparable prior item: #848 — not used as basis.

---

### E-M04 — Candidates & Profiles · LAUNCH 6 · FULL 13 · Wave W2

**Goal:** profile completeness means exactly what recruiters see, and documents stay encrypted and scoped. **Done (LAUNCH) =** the completeness contract is real and resume parsing has an accuracy evidence point.

**FS-018 — Profile-completeness contract · 3**
- [ ] Completeness is computed from exactly the fields recruiters see (one field list, shared); a contract test fails if the two lists diverge
Comparable prior item: #850 — not used as basis.

**FS-019 — Parsed-resume accuracy spot-evaluation + upload evidence · 3**
- [ ] A fixed sample set of resumes is parsed and scored field-by-field against ground truth; the accuracy report is on the story; document upload is evidenced working on staging (R2 path)
Gate: staging portion discharges at D2 · Comparable prior item: #851 — not used as basis.

**FS-020 — FULL · Extract application writes from the god-file · 13 · [GATE: D-M04-1]**
- [ ] Application writes move from `routes/candidate.js` (5,715 lines) into the M6 router (Sage-led, refactor-safely: characterisation tests first, one slice at a time); `candidate.js` is frozen for new features from this design's adoption
Gate: post-launch scheduling ruling · Comparable prior item: #852 — not used as basis.

---

### E-M05 — Career Coach & AI Tools · LAUNCH 12 · FULL 0 · Wave W2

**Goal:** no mock presented as AI; every tool reaches its real backend or is honestly labelled/removed. **Done =** a candidate cannot be shown placeholder output as if it were AI coaching. **Gates:** D-M05-1 gates FS-023's disposition per surface.

**FS-021 — Mock-grade sweep · 2**
- [ ] Every M5 endpoint is classified real / mock / placeholder with file:line evidence; the inventory is the story's output and FS-023's input (today exactly one is verified mock — the LinkedIn tips endpoint — the rest are unclassified)
Comparable prior item: #853 — not used as basis.

**FS-022 — Profile-enhancement contract repair · 5**
- [ ] LinkedIn optimizer and career diagnosis pages actually reach their backends (path, payload field, and body-encoding defects fixed as one contract); an end-to-end test per page proves a real response renders
Comparable prior item: #854 — not used as basis.

**FS-023 — Mock-grade AI engines disposition · 5 · [GATE: D-M05-1]**
- [ ] Each surface on FS-021's inventory is, per the ruling: wired to the real provider cascade (`lib/ai-provider.js` only — no module-local keys), visibly labelled demo/limited, or removed from the client; coach data never reaches any recruiter surface, search index, or score input
Gate: Sumanth's Coach-shape ruling · Comparable prior item: #855 — not used as basis.

---

### E-M07 — Matching & Discovery · LAUNCH 32 · FULL 8 · Wave W2

**Goal:** discovery renders real fields, respects opt-outs, paginates honestly. **Done =** a recruiter's candidate list is exactly the population it claims to be. **Gates:** D-M07-1 (FS-046).

**FS-043 — Candidates-page defect cluster: re-verify, then fix · 13**
- [ ] Each of the ten audited defects (field-shape mismatches so photos/experience/scores/availability never render; status tabs ignored; pipeline stats counting the wrong population; bulk-update 500s; preview shape mismatch) is re-verified against current code first — live items fixed, dead items closed on the story with evidence (no bulk trust, no bulk close)
- [ ] A contract test on the candidate-card shape (API ↔ client field names) closes the snake_case/camelCase class permanently
Comparable prior item: #405 — not used as basis.

**FS-044 — Pagination end to end · 3**
- [ ] Server honours page parameters; client renders and navigates them; a test walks a multi-page result set to exhaustion with no duplicates or drops
Comparable prior item: #414 — not used as basis.

**FS-045 — Preview/invite honour soft-delete + opt-out · 5**
- [ ] Candidate preview and invite paths consume M4's visibility/opt-out settings exactly (FR-M04-1's reader side): soft-deleted and opted-out candidates are unreachable by both paths; a test per path proves it
Deps: M4 settings (Verified-Exists) · Comparable prior item: #416 — not used as basis.

**FS-046 — Two-sided display at launch scope · 5 · [GATE: D-M07-1]**
- [ ] Trust Score appears as badges/company-page display only (no ranking weight) unless ruled otherwise; mutual fit is shown where computed; the free-tier teaser shows real jobs or an honest count — never invented jobs behind a blur
Gate: Sumanth's display ruling (PRD recommendation: display-only) · Comparable prior item: #859 — not used as basis.

**FS-047 — "Run screening" action: build it or remove it · 3**
- [ ] The action either posts to a real backend that exists and is tested, or is removed from the UI — no dead action ships (design default: remove unless the screening-send path FS-027 hardened can serve it unchanged)
Comparable prior item: #861 — not used as basis.

**FS-048 — AI-search quality spot evaluation · 2**
- [ ] A fixed query set is run against AI search; relevance is scored against expected candidates; the report (not a fix) is the deliverable
Comparable prior item: #860 — not used as basis.

**FS-049 — Practice-marker guardrail audit on search · 1**
- [ ] Evidence that the practice-fact marker is not an input to any search filter/sort/rank path (code audit + one negative test per path)
Deps: FS-077 · Comparable prior item: rides #792 — noted, not used as basis.

**FS-050 — FULL · Per-pairing matching consumption · 8 · [GATE: D-M12-4]**
- [ ] Matching consumes candidate-in-role + company score + mutual fit as designed inputs, with ordering influence explainable in the UI's own terms (no hidden burial of either side)
Deps: FS-081/FS-082 · Comparable prior item: #862 — not used as basis.

---

### E-M08 — Session Engine · LAUNCH 6 · FULL 0 · Wave W2

**Goal:** the unified core is harness-green and concurrency-proven. **Done =** no "pre-existing failure" is carried unexplained into launch QA.

**FS-051 — Mount-order harness failure: root-cause or formal baseline · 3**
- [ ] The `interview-mount-order` harness failure on clean `dev` is root-caused and fixed, **or** formally baselined with the cause, the blast radius, and Sumanth's acceptance recorded — it may not remain an unexplained "pre-existing"
Comparable prior item: #863 — not used as basis.

**FS-052 — Session lifecycle under real-DB concurrency · 3**
- [ ] Lifecycle transitions are exercised concurrently against a real database (claim/heartbeat/stale paths); evidence recorded; any race found becomes a named defect on this story
Gate: discharges at the D2 staging gate (this VM cannot reach the DB) · Comparable prior item: #864 — not used as basis.

---

### E-M09 — AI Interview & Screening · LAUNCH 17 · FULL 13 · Waves W1–W2

**Goal:** AI modes run on wired pages, honest payloads, provenance-marked scores. **Done =** every score this module produces can say where it came from. **Gates:** D-M09-1 (FS-054).

**FS-053 — `apiCall` double-prefix sweep · 3**
- [ ] Every `'/api/…'` call site that 404s by double-prefix is fixed at the shared caller or the call site — the screening-questionnaire page, the job-applicants panel, and Quick Practice consent receipts are proven working end to end (the audit's three named instances), and a lint/test rule prevents the pattern's return
Comparable prior item: #909 — not used as basis.

**FS-054 — Screening-sessions over-send trim · 5 · [GATE: D-M09-1]**
- [ ] `GET /screening/sessions` returns explicit projections (no full transcripts in list payloads); full transcripts are reachable only via a gated single-session read (`canAccess`-class check + audit + `no-store`), S-087's proven pattern; the monitor page is rewired to it
- [ ] Closure evidence includes one redacted live response snapshot (Quinn's condition from the panel)
Gate: Sumanth's scope ruling (panel + PRD recommendation: fix pre-launch) · Comparable prior item: #865 — not used as basis. (The exposure-window assessment stays a separate counsel-gated item with Lex — this fix does not close it.)

**FS-055 — Fallback-score provenance · 5**
- [ ] Every AI-generated score is marked in storage as model-scored or fallback-scored at production time (all inline analysis paths inventoried); unmarked legacy rows are treated as fallback for any recruiter-facing use
Deps: none (precondition for FS-076) · Comparable prior item: #866 — not used as basis.

**FS-056 — Fallback reachability + Quick Practice isolation verification · 2**
- [ ] Evidence per inline path: whether a fallback is reachable in production configuration; Quick Practice's router isolation under the current mount order proven by test
Comparable prior item: #867 — not used as basis.

**FS-057 — In-room Share / Effects / Settings controls · 2**
- [ ] Each dead in-room control is implemented against a real requirement or removed; no inert control ships (design default: **remove** — no sharing/effects requirement exists in any PRD; see DD-3)
Comparable prior item: #868 — not used as basis.

**FS-058 — FULL · Extract inline analysis into a real service · 13**
- [ ] The hand-rolled per-feature analysis in `routes/interviews.js` is extracted into one service (Sage-led) with behaviour-preserving tests per feature; legacy heuristic fallbacks are **not** carried into the service (FS-055's marking governs the transition)
Comparable prior item: #869 — not used as basis.

---

### E-M10 — Human Interviews, Panels & Recordings · LAUNCH 12 · FULL 5 · Wave W2

**Goal:** reports consume real locked scorecards; recordings play; the record is written. **Done =** the report's human column is real data with submit-and-lock blindness enforced server-side. **Gates:** none open (D-M10-1 resolved 2026-10-13 — one system).

**FS-059 — Report consumption of locked panel scorecards · 5**
- [ ] One session resolver lets the report read the panel system's submitted+locked scorecards; the human column renders `present` / `not_submitted` / `missing` per the taxonomy (linkage-unresolved = `missing`, never "not submitted"); no Track B substitution
Deps: panels system (Verified-Exists — serves the migration-125 tables, submit-and-lock at `routes/panels.js:451`) · Comparable prior item: #810 (resolver portion) — not used as basis.

**FS-060 — AI-section gate · 3**
- [ ] A scorer cannot retrieve a session's AI/Observer section (score, narrative, integrity observations, discrepancy indicators) via UI **or API** until their own scorecard for that session is submitted and locked; enforcement is server-side and per-person (recruiter==interviewer included, via scorecard state)
Deps: FS-059's resolver · Comparable prior item: #810 (gate portion) — not used as basis. *Sequencing: FS-060 lands before FS-059 exposes any AI section to scorers (DD-6).*

**FS-061 — Migration-125 deprecation record · 1**
- [ ] The written record states: panels serves the 125 tables; the "two systems" premise was falsified (2026-10-13); the tables are the system of record until FS-064
Comparable prior item: #870 — not used as basis.

**FS-062 — Recording playback + 125-reader sweep verification · 2**
- [ ] Encrypted playback is evidenced working on staging (R2 path); every client still reading the scorecard tables outside the panels routes is inventoried on the story
Gate: staging portion at D2 · Comparable prior item: #871 — not used as basis.

**FS-063 — Track-B alias removal · 1**
- [ ] The deprecated Track-B report alias is removed after its consumer check; S-039's wiring reads the canonical source only
Comparable prior item: #811 — not used as basis.

**FS-064 — FULL · Drop deprecated 125 artefacts · 5**
- [ ] Post-launch migration retires whatever 125-era artefacts FS-061's record marks deprecated, after a fresh consumer census
Deps: FS-061 · Comparable prior item: #872 — not used as basis.

---

### E-M13 — Assessments & Coding · LAUNCH 43 · FULL 0 · Wave W2

**Goal:** assessments are verified item by item; the coding client exists and enables only behind a proven sandbox. **Done =** no Feb-cluster item is trusted or closed without evidence, and candidate code never runs on an unproven boundary. **Gates:** D-M13-1 (enablement). *16 of this epic's points are labelled contingencies (FS-087/FS-088) — they return if their verification parents find nothing (DD-4).*

**FS-084 — Feb-cluster per-item re-verification · 5**
- [ ] Every Feb-2026 cluster item is re-verified against current code, one by one, with evidence recorded per item (live / stale / already-fixed); no bulk close, no bulk trust; live items exit as named fixes under FS-088
Comparable prior item: #243 + family — not used as basis.

**FS-085 — Sandbox Step Zero: deployment inventory · 2**
- [ ] Per environment: does a sandbox (Judge0-class) actually run, reachable from the app host? One signed inventory note answers it; until then the coding feature is **off**, not "on but sandboxed"
Comparable prior item: #118 (Step Zero portion) — not used as basis.

**FS-086 — Sandbox escape-suite audit · 5**
- [ ] If FS-085 finds a deployed sandbox: an escape suite runs (network egress, host FS, resource limits, tenant isolation) and every result is dispositioned; if none is deployed anywhere, this story closes with the risk statement "feature disabled" and the suite deferred to first deployment
Gate: findings gate coding enablement (D-M13-1) · Comparable prior item: #118 (audit portion) — not used as basis.

**FS-087 — Sandbox remediation contingency · 8 · CONTINGENT**
- [ ] Priced allowance for FS-086's findings, spent only against named defects recorded on FS-086; unspent remainder returns at FS-086's disposition
Comparable prior item: #118 (remediation allowance) — not used as basis.

**FS-088 — Cluster-fix contingency · 8 · CONTINGENT**
- [ ] Priced allowance for fixes arising from FS-084's re-verification, spent only against its per-item live findings
Comparable prior item: scope's M13 cluster allowance — not used as basis.

**FS-089 — Coding-assessment client surface · 13 · [GATE: enablement = D-M13-1]**
- [ ] The client exists end to end: templates, candidate submissions, sandbox-backed run, results rendering (server side is fully built today; zero client exists); the feature flag stays OFF until FS-086 dispositions
Comparable prior item: #878 — not used as basis.

**FS-090 — Assessment/coding results in the erasure inventory · 2**
- [ ] Assessment and coding results are named entries in the erasure map (delete/redact/retain-with-basis), joining FS-124's procedural rule
Comparable prior item: #877 — not used as basis.

---

### E-M14 — Verification & Background Checks · LAUNCH 5 · FULL 21 · Wave W2

**Goal:** current-depth checks are consent-truthful and company-siloed. **Done (LAUNCH) =** every check names what is checked and who sees it, before it runs. **Gates:** D-M14-1 + counsel gate the FULL story only; current-depth operation is not gated.

**FS-091 — Consent receipts per check type · 3**
- [ ] Every check type's consent receipt names, in plain items, what will be checked and who will see the result; no check runs before its receipt exists; copy never says "verified" about the platform itself (panel copy discipline)
Comparable prior item: #879 — not used as basis.

**FS-092 — Cross-company result-exposure sweep · 2**
- [ ] Evidence that no verification/background result reaches any surface beyond the requesting company (route + payload sweep, both directions)
Comparable prior item: #880 — not used as basis.

**FS-093 — FULL · Productised BGV depth · 21 · [GATE: D-M14-1 + counsel determination]**
- [ ] Third-party checks + adverse-action workflow, built only on the counsel determination's terms; FCRA-side process (disclosure, authorisation, pre/adverse action) implemented as designed in the compliance skill basis
Gate: does not start before the determination lands · Comparable prior items: #132/#133 — not used as basis.

---

### E-M16 — Billing & Subscriptions · LAUNCH 24 · FULL 0 · Wave W2

**Goal:** billing meters the ruled unit, and keys are mode-truthful per environment. **Done =** a staging checkout is evidenced in test mode end to end, and metering exists for whatever pricing Sumanth rules. **Gates:** D-M16-1 (pricing) gates FS-098–FS-100's shape.

**FS-098 — Metering at the source of truth · 5 · [GATE: D-M16-1]**
- [ ] Usage of the ruled unit is counted at the source-of-truth record (session/application), never by client counters; the meter is auditable per company per period; both candidate units (completed interviews and active seats) are counted from day one so any A/B/D ruling is meterable without a rebuild (DD-5)
Gate: build starts on the pricing ruling · Comparable prior item: #698 — not used as basis.

**FS-099 — India pay-as-you-go billing · 5 · [GATE: D-M16-1]**
- [ ] INR pay-as-you-go path works end to end in test mode (checkout → webhook → tier/usage state), with the India pricing test's terms as config
Comparable prior item: #699 — not used as basis.

**FS-100 — Overage billing with confirmation · 3 · [GATE: D-M16-1]**
- [ ] Overage is never charged silently: the customer confirms before the charge; the confirmation artefact is stored
Comparable prior item: #700 — not used as basis.

**FS-101 — Production live keys at launch + keys-mode promotion line · 3**
- [ ] At launch (Sumanth provides LIVE keys via the Secure Vault flow): production takes real payments; the promotion checklist carries a keys-mode verification line per environment (Relay owns); until then production's test-class state is the recorded fact, not an assumption
Comparable prior item: #837 — not used as basis.

**FS-102 — Checkout → webhook → tier round-trip validation (staging, test mode) · 5**
- [ ] A staging checkout produces a `cs_test_` session, a test card completes, the webhook applies the tier, and the publishable key's class (code/config-resident) is verified — the behavioural evidence the corrected #98 record requires
Comparable prior items: #6, #193, #98 (residual scope) — not used as basis.

**FS-103 — Webhook idempotency + signature audit · 3**
- [ ] Duplicate/replayed webhooks cannot double-apply tier or usage; unsigned or bad-signature events are rejected and logged; tier never applies from client success-page claims
Comparable prior item: #881 — not used as basis.

---

### E-M17 — Post-Hire · LAUNCH 20 · FULL 29 · Wave W2

**Goal:** Post-Hire is in the product honestly — finished parts live, unfinished parts "releasing soon", records dispositioned (Sumanth's ruling: NOT defer-and-hide). **Done (LAUNCH) =** the data obligations are inventoried and dispositioned in writing, and no part presents as live before its readiness items close. **Gates:** none for LAUNCH lines.

**FS-104 — Post-Hire data inventory · 3**
- [ ] Every M17 table/record class is inventoried (offers, onboarding documents, payroll records, signatures): populated?, sensitivity class, current retention/erasure state — Lex's inventory-first amendment; FS-105 consumes it
Comparable prior item: #883 (inventory portion) — not used as basis.

**FS-105 — Retention + erasure disposition for Post-Hire records · 5**
- [ ] Each inventoried class gets a written disposition inside M19's map (delete / redact / retain-with-basis with counsel-set payroll retention periods); silence on any class fails the story
Deps: FS-104 · Comparable prior item: #883 (disposition portion) — not used as basis.

**FS-106 — "Releasing soon" surface · 5**
- [ ] Every unfinished M17 part renders a "releasing soon" surface (visible, honest, no dead forms behind it); finished parts stay live and unchanged
Comparable prior item: #882 — not used as basis.

**FS-107 — Runtime verification: offer → sign → onboarding · 5**
- [ ] The full journey is executed and evidenced end to end on staging (offer drafted → signed → onboarding documents collected); every break found becomes a named defect on this story
Gate: discharges at D2 · Comparable prior item: #884 — not used as basis.

**FS-108 — Post-hire feedback form wiring · 2**
- [ ] The recruiter post-hire-feedback form's Submit stores through the real feedback API (today it stores nothing; the candidate twin already uses the API); a submission round-trips and renders
Comparable prior item: #885 — not used as basis.

**FS-109 — FULL · Payroll correctness (US + India) · 13**
- [ ] The payroll calculator is reviewed rule-by-rule against US + India (PF/ESI/tax) requirements and corrected; every calculation displays its inputs (no unexplained money numbers)
Comparable prior item: part of the M17 completion family — no single prior item; noted as such.

**FS-110 — FULL · E-signature depth completion · 8**
- [ ] Signature depth reaches the level FS-155's legal review specifies (sealing/evidence chain), with the audit log (who signed what, when) complete
Deps: FS-155 · Comparable prior item: #131 — not used as basis.

**FS-111 — FULL · Post-Hire erasure implementation · 8**
- [ ] Whatever FS-105's disposition requires beyond map entries (deletion/redaction machinery for M17 classes) is built and hold-aware (FS-028)
Deps: FS-105 · Comparable prior item: none — new design (the disposition's build half).

---

### E-M18 — Notifications, Email & Comms · LAUNCH 18 · FULL 0 · Waves W1–W2

**Goal:** the recruiter inbox is the real comms backend; every transactional email class is templated and evidenced. **Done =** no invented message can render, and staging email is proven, not configured-and-assumed.

**FS-112 — Recruiter communications page on the real backend · 8**
- [ ] The invented inbox (hardcoded messages; reply/star/delete local-only) is wired to the real comms backend + chat that already exist, or the surface is retired (design default: wire — DD-8); zero hardcoded messages remain reachable
Comparable prior item: #889 — not used as basis.

**FS-113 — Staging email evidence run · 3**
- [ ] Every transactional class (reset, invite, schedule, status, offer) is sent on staging and evidenced delivered + tracked at controlled addresses; the run record is the deliverable (this discharges the "configured but never evidenced" state)
Gate: discharges at D2 · Comparable prior item: #99 (residual) — not used as basis.

**FS-114 — Template completeness audit · 3**
- [ ] Every transactional class has template + queue path + tracking; a missing template fails loudly in logs — a send can never silently drop
Comparable prior item: #886 — not used as basis.

**FS-115 — Chat onto the object-authorisation convention · 3**
- [ ] Chat reads/writes perform the object-authorisation check (FS-145's convention): a user can reach only conversations they are a party to; chat history treated as candidate PII
Deps: FS-145 · Comparable prior item: #887 — not used as basis.

**FS-116 — Email open-tracking disclosure check · 1**
- [ ] Evidence whether open-tracking is used and, if so, that the privacy surface discloses it; a gap found becomes a named fix on this story
Comparable prior item: #888 — not used as basis.

---

### E-M20 — Admin & Platform Ops · LAUNCH 26 · FULL 5 · Waves W2–W3

**Goal:** admin surfaces never render fake-healthy; fresh environments provision; the pre-launch window executes once, with evidence. **Done (LAUNCH) =** every admin page's calls resolve against real routes, and migration-238 no longer blocks fresh provisioning (or Sumanth has accepted it in writing). **Gates:** fund-vs-accept (FS-127); MFA re-rule (FS-131).

**FS-126 — Admin endpoint contract pass · 8**
- [ ] Every admin page's calls are verified against real routes item by item (the fake-healthy AI-health widget — non-existent path rendering health 100/"healthy" with hardcoded stats — is the named first instance); failures render honest error states; evidence per page
Comparable prior item: #254 — not used as basis.

**FS-127 — Migration-238 fresh-DB halt: fix · 5 · [GATE: fund-vs-accept]**
- [ ] First AC is reproduction: a fresh database build halts at migration 238 (`candidate_profiles.bio` never created on the fresh path; ≥239 never apply) — then the fresh path is fixed so a from-scratch build applies all migrations through current; a CI-style fresh-build check exists
Gate: if Sumanth rules accept-in-writing instead, this story is deleted, not shrunk (DD-10) · Comparable prior item: #894 — not used as basis.

**FS-128 — Admin-route authorisation remainder + public-API keys · 3**
- [ ] Remaining admin routes enforce platform-admin server-side (FS-145's convention); public API keys are scoped, revocable, and audit-logged
Deps: FS-145 · Comparable prior item: #895 — not used as basis.

**FS-129 — Public-API census + admin staging health · 2**
- [ ] Live public-API keys/consumers are censused; every admin page's staging health is evidenced page by page
Gate: staging portion at D2 · Comparable prior item: #896 — not used as basis.

**FS-130 — Pre-launch cleanup window execution · 8**
- [ ] One checklist, one window, one evidence pack: test-data purge; QA test-admin accounts removed (excluding `sumanth@rekrutai.co`); the R2 plaintext deletion run executed from a networked environment with its JSON report saved as BIPA §15(a) evidence — nothing on the checklist executes early
Gate: launch window only; each deletion's scope re-read and confirmed before execution · Comparable prior items: #151, #336, #721 — not used as basis.

**FS-131 — FULL · Admin MFA (TOTP) · 5 · [GATE: re-rule]**
- [ ] TOTP second factor for platform admin (enrolment unskippable; login without the factor is rejected server-side — Quinn's rejection test); break-glass path tested; scope of covered roles per Sumanth's enrolment decision
Gate: Sumanth ruled "agreed, later — not the priority now" (2026-10-13); the panel's hard-blocker warning stands on the record · Comparable prior item: #660 — not used as basis.

---

### E-M21 — Analytics & Reporting · LAUNCH 7 · FULL 37 · Wave W2

**Goal:** every aggregate traces to a defined, company-scoped population. **Done (LAUNCH) =** no displayed number lacks a denominator and a company boundary. **Gates:** D-M21-1 (FS-134 placement).

**FS-132 — Aggregate population correctness · 5**
- [ ] Every recruiter-facing aggregate is traced to its population definition and made company-scoped; any aggregate that cannot be traced is fixed or removed; selection-rate-adjacent numbers carry population + period labels
Deps: FS-024 (status authority) · Comparable prior item: #897 — not used as basis.

**FS-133 — Demographic sections: prove or cut · 2**
- [ ] Evidence whether the analytics payload actually carries the demographic funnel fields; if absent, the sections are cut (they may not render permanently-zero funnels as real diversity data)
Comparable prior item: #898 — not used as basis.

**FS-134 — FULL · E-006 report products · 16 · [GATE: D-M21-1]**
- [ ] Recruiter full report + candidate qualitative report built as products (the candidate report gets the Candidate Experience + copy-audit treatment); January's reports remain the M9/M10 surfaces unless ruled otherwise
Comparable prior items: #683/#684 — not used as basis.

**FS-135 — FULL · Integrity-metrics dashboards · 13**
- [ ] Dashboards summarise M11 measurements that exist and are validated (slice-by-slice rule — no dashboard before its measurement)
Deps: FS-073/FS-074 · Comparable prior items: #701/#702 — not used as basis.

**FS-136 — FULL · Two-sided company analytics · 8**
- [ ] Trust Score distributions + component trends, company-scoped (a company sees its own trend and platform aggregates — never another company's identified components); candidate-rating inputs reported only in aggregate
Comparable prior item: #899 — not used as basis.

---

### E-M22 — Referrals · LAUNCH 6 · FULL 0 · Wave W2

**Goal:** referral-first candidates can apply; referral data is erasable and siloed.

**FS-137 — Referral-first apply fix · 2**
- [ ] The referral creation path validates/normalises `applied_via` against the CHECK constraint (today the INSERT 500s); an end-to-end regression walks link → signup → apply → pipeline-visible with attribution
Deps: FS-030 (single creation path) · Comparable prior item: #824 — not used as basis.

**FS-138 — Referral data in the erasure map + exposure check · 2**
- [ ] Referral data (referrer identity, relationship) is a named erasure-map entry; a check proves it is never exposed across companies
Deps: FS-124 · Comparable prior item: #900 — not used as basis.

**FS-139 — Introductions + referral-assessment verification · 2**
- [ ] Both paths are evidenced working on staging (introductions journey; referral-assessment page)
Gate: discharges at D2 · Comparable prior item: #901 — not used as basis.

---

### E-S1 — Landing, Marketing & Legal Pages · LAUNCH 14 · FULL 0 · Waves W1 / pre-launch

**Goal:** every public sentence is provable against shipped code. **Done =** the claims pass is in the pre-launch checklist and the legal pages state the enforced retention schedule in plain words. **Gates:** D-S1-1 (FS-141/FS-142 placement), D-M16-1 (FS-143).

**FS-140 — Biometric policy page promise removal · 1**
- [ ] The 60-second calibration-baseline promise (spec-only feature) is removed or softened to truth on the public biometric policy page; this story **blocks any Observer enablement** until closed
Comparable prior item: #777 — not used as basis.

**FS-141 — Public-claims pass · 5 · [GATE: D-S1-1]**
- [ ] Every capability claim on every public page (incl. the login page's placeholder partner strip) is traced to shipped code or removed; Lex signs legal pages, the marketing pages get the read-aloud copy audit
Comparable prior item: #902 — not used as basis.

**FS-142 — Terms/privacy text vs retention design · 3 · [GATE: D-S1-1]**
- [ ] A close read of the full terms + privacy text against the retention design; every divergence is corrected or recorded as a counsel item; the biometric page carries the BIPA §15(a) schedule matching M19's enforced one (90/30 + 30-day capture sub-policy)
Comparable prior item: #903 — not used as basis.

**FS-143 — Pricing page: single narrative · 2 · [GATE: D-M16-1]**
- [ ] One plan narrative across candidate + recruiter page families (today they tell two stories); ships only after the pricing ruling + Ledger's cost-floor check; no placeholder prices
Comparable prior item: #904 — not used as basis.

**FS-144 — Public dead ends: contact form + footer links · 3**
- [ ] The contact form actually sends (a real endpoint + delivery path) or the form is removed; footer Privacy/Terms/Help links resolve on every authenticated page (today all `href="#"`)
Comparable prior item: #905 — not used as basis.

---

### E-X — Cross-Cutting Platform · LAUNCH 90 · FULL 0 · Waves W0–W3 (continuous)

**Goal:** the convention, the QA workstream, the design foundation, and the promotion gate exist as owned workstreams — not as taxes hidden inside module stories (DD-9). **Done =** the D2 promotion gate has executed on evidence and the January cut is a set of finished epics.

**FS-145 — Object-authorisation convention: design + reference implementation · 8**
- [ ] One documented convention (object check shape, error semantics, audit) + a reference implementation in M6 + a standing review rule ("new endpoints name their object check"); FS-012/FS-040/FS-115/FS-128 consume it
Wave: W0, immediately after the M6 spine — module applications may not precede it · Comparable prior item: #907 — not used as basis.

**FS-146 — Platform-wide auth-only sweep · 8**
- [ ] Every endpoint family not yet audited (screening reads, assessment reads, verification reads, and the long tail) is checked for authentication-treated-as-authorisation; any hole proven becomes its own story at STOP 1 sizing — not silently fixed here
Deps: FS-145 · Comparable prior item: #908 — not used as basis.

**FS-147 — QA workstream I: test plan + journey matrix · 8**
- [ ] Quinn's plan maps every candidate/recruiter/admin/public journey to its module PRD + test tier; the matrix is the QA workstream's index
Comparable prior item: scope E6 line — no single prior item; noted as such.

**FS-148 — QA workstream II: mocked-suite execution + repair · 5**
- [ ] The full jest suite executes in CI-class conditions (incl. the four capture-mirror suites that cannot execute today — test-code defects repaired); the failure ledger reaches zero unexplained failures (this also discharges Lex C-L3's remainder for the capture code's promotion)
Comparable prior items: #817/#818 — not used as basis.

**FS-149 — QA workstream III: E2E journey verification · 13**
- [ ] Both dashboards + admin + public journeys execute end to end (mocked/local tier) against the FS-147 matrix; every failure is fixed in its module story or re-filed as a named defect here
Comparable prior item: scope E6 line — no single prior item; noted as such.

**FS-150 — QA workstream IV: responsive verification · 13**
- [ ] Phone/tablet/laptop verification by template family (~25 families), incl. the interview room on iPhone Chrome (Sumanth's test device); failures return to their module epics as named defects
Comparable prior item: scope E6 line — no single prior item; noted as such.

**FS-151 — D2 staging gate execution · 13**
- [ ] Frozen `dev` → staging as a gated production-schema event: migrations 252–257 reviewed and run one by one; full journey re-run on staging (real DB + R2 + Brevo + Stripe test mode); Relay checklist; every story in this design marked "discharges at D2" is evidenced here or stays open
Gate: Sumanth's promotion approval; Relay-owned · Comparable prior item: none — new design (the D2 track existed as a ruling, never as a story).

**FS-152 — QA defect-fix allowance · 8**
- [ ] Priced allowance for regressions the QA workstream finds, excluding module gaps already costed in their epics; spent only against named defects on FS-149/FS-150 records
Comparable prior item: scope E6 line — noted as such.

**FS-153 — DESIGN.md bootstrap · 5 · [GATE: D-DESIGN-1]**
- [ ] One gated `impeccable document` run produces Rekrut's DESIGN.md; UI requirements in the PRDs marked provisional become anchored to it; the run is timeboxed and never gates launch-critical fixes or FS-140
Comparable prior item: #906 — not used as basis.

**FS-154 — Uncounted verification pack · 6**
- [ ] Four evidence items in one pack: FS-076's score-distribution impact (DB read; decides the version note's wording); Trust Score divergence check (decides FS-080's close-out safety); materialised-view refresh correctness; candidate-Pro purchaser census (feeds D-M16-1)
Comparable prior item: #910 — not used as basis.

**FS-155 — E-signature legal depth verification · 3**
- [ ] The signature implementation's legal depth (sealing/evidence standard) is assessed against the requirement on record; the gap statement sizes FS-110
Comparable prior item: #911 — not used as basis.

---

## 3. Open decision gates (index — the rulings that touch this design)

Every gate below is Sumanth's (or counsel's). A gated story stops **only itself**; its epic and the programme continue.

| Gate | Epics | Gated stories |
|---|---|---|
| Pricing D-M16-1 (Atlas+Ledger A→D on file) | E-M16, E-S1 | FS-098, FS-099, FS-100, FS-143 |
| Role model + ownership, D-M02-1 (#766 package) | E-M02 | FS-005 (+ FS-012 depends on its model) |
| Coach shape D-M05-1 | E-M05 | FS-023 |
| Screening over-send D-M09-1 | E-M09 | FS-054 |
| Mutual-fit display D-M06-2 · company-score display D-M07-1 | E-M06, E-M07 | FS-041, FS-046 |
| Two-sided completion D-M12-4 (+ D-M12-5 folded in) | E-M12, E-M07 | FS-081–FS-083, FS-050 |
| Sandbox gate D-M13-1 | E-M13 | FS-089 enablement (FS-086 findings) |
| BGV depth D-M14-1 + counsel determination | E-M14 | FS-093 |
| Observer toggle D-M11-1 (#334) | E-M11 | FS-070, FS-071 |
| E-006 placement D-M21-1 | E-M21 | FS-134 |
| Admin MFA scheduling (ruled "later") | E-M20 | FS-131 |
| God-file scheduling D-M04-1 | E-M04 | FS-020 |
| Migration-238 fund-vs-accept | E-M20 | FS-127 |
| DESIGN.md timing D-DESIGN-1 | E-X | FS-153 |
| Claims pass into pre-launch checklist D-S1-1 | E-S1 | FS-141, FS-142 |
| Purge flip D-M19-1 (Sumanth's manual act) | E-M19 | fed by FS-123's evidence pack |
| Counsel determinations (#788 track — **no outreach stands**) | E-M15, E-M11, E-M14 | FS-097; Tier 3 input classes (FS-072–FS-075); FS-054's exposure-window assessment (Lex, separate from the fix) |
| Gate A re-entry contract (2026-11-01 / 2026-12-01 checkpoints) | E-M11 | FS-072–FS-075 |

---

## 4. Build sequence (waves)

Aligned to PR #913's critical path (hold → deletion unfreeze → P0 set → convention → ruled pairs → fabrication set → QA → D2 → pre-launch window), with the one ordering disagreement recorded in §6.4.

- **W0 — in flight + foundations.** E-M06 spine (FS-024–FS-029; Sprint 11 Tranche 1 is building this ground now) → E-M19 purge set (FS-117–FS-121) → E-M11 spine (FS-065, FS-069) → E-X convention (FS-145, immediately after the spine — module applications FS-012/FS-040/FS-115/FS-128 may not precede it) → E-S1 FS-140 alone (enablement blocker) → E-M15 dark build (FS-094–FS-096, after FS-030 per §6.4).
- **W1 — Sprint 12 ruled pairs + honesty set.** E-M12 input fixes (FS-055 lands first, then FS-076–FS-078) → E-M11 tiers (FS-066–FS-068; FS-070/FS-071 per ruling) → fabrication set (FS-014, FS-015, FS-053, FS-112, FS-122 — no epic containing one is "done" until its set item closes) → E-X FS-153 (DESIGN.md, timeboxed, never gating).
- **W2 — launch completion.** All remaining LAUNCH stories (E-M01, E-M02, E-M03, E-M04, E-M05, E-M07, E-M08, E-M10, E-M13, E-M14, E-M16 gated items, E-M17, E-M18, E-M20, E-M21, E-M22, E-S1) + E-X QA workstream throughout (FS-147–FS-150, FS-152, FS-154, FS-155).
- **W3 — promotion + window.** FS-151 (D2 staging gate: frozen `dev`, migrations 252–257 one by one, full journey re-run — every "discharges at D2" AC in this design is evidenced here or stays open) → FS-130 (pre-launch cleanup window) → FS-101 (live keys, at the launch act).
- **FULL-ONLY — post-launch**, each behind its §3 gate: E-M12 two-sided set + FS-050 (42 pts), E-M11 Tier 3 set (39), E-M21 products (37), E-M17 completion (29), E-M14 BGV (21), FS-020 (13), FS-058 (13), FS-097 (3), FS-064 (5), FS-131 (5) = **207**.

---

## 5. ▣ DESIGN DECISIONS THE PRDs LEFT SILENT — for Sumanth

> These are points where the PRDs and rulings did not determine the design and Rex had to choose. Each is flippable; the cost of flipping is stated. They are recorded here, not buried in story text.

- **DD-1 — Audit-export homed in E-M06 (FS-026), split from the explain-IDOR story.** PRD-M20 defers its instance to "M6's convention work"; the S-088 audit surfaced it in M6's family. Split because owner and surface differ (platform admin vs candidate data). *Flip cost:* none structural — merge FS-025+FS-026 (5 pts combined either way).
- **DD-2 — The legal-hold build is one story, homed in E-M06 (FS-028), cross-referenced at 0 pts in E-M19.** The hold's consumers are deletion paths; M6's erasure is its largest. *Flip cost:* epic rollups only (programme total unchanged).
- **DD-3 — In-room Share/Effects/Settings: removal is the designed default (FS-057).** No PRD contains a sharing or effects requirement. *Flip cost:* a real requirement turns FS-057 into an implement-story (re-sized at STOP 1).
- **DD-4 — Contingencies are priced, not ranged (FS-087, FS-088, FS-152).** 24 pts of labelled contingency so the LAUNCH total is a number. Rule: spent only against named defects recorded on the parent verification story; unspent remainder returns. *Flip cost:* zeroing them returns the design to a range (LAUNCH 520–544).
- **DD-5 — Metering counts both candidate units from day one (FS-098).** The pricing ruling is open between per-interview (A) and seat-bearing hybrids; counting sessions **and** seats at the source makes any ruling meterable without a rebuild. *Flip cost:* ruling first, then metering, saves nothing measurable and risks a second metering build.
- **DD-6 — The scorecard-consumption work is two stories (FS-059 resolver, FS-060 gate), sequenced gate-before-exposure.** They close independently as builds; the gate is a binding constraint on what the resolver may expose to scorers. *Flip cost:* merging them re-creates the single 8-pt story whose premise error caused this pass.
- **DD-7 — Tier 3 is designed as four FULL stories (FS-072–FS-075), not one bundle.** The slice-by-slice rule (Gate A contract) applied to the design itself: capture activation, speech slice, report population, activation-conditions closure each carry their own gate evidence. *Flip cost:* none — bundling changes paperwork, not work.
- **DD-8 — Fake surfaces are wired where a real backend exists, retired where none does.** Recruiter comms (FS-112): wire (backend exists). Recruiter profile (FS-011): retire (no distinct requirement). *Flip cost:* per surface, at its STOP 1.
- **DD-9 — A cross-cutting epic (E-X) exists.** The authorisation convention, Quinn's QA workstream, DESIGN.md, the verification packs and the D2 gate have no module home; hiding them inside module stories is how they got under-costed historically. *Flip cost:* redistribution only — the work does not shrink.
- **DD-10 — Migration-238 is designed as fund-the-fix (FS-127).** The PRD recommendation is fund; Sumanth's alternative (accept in writing) **deletes** the story rather than shrinking it.
- **DD-11 — Post-Hire inventory and disposition are separate stories (FS-104 → FS-105).** The panel's inventory-first amendment made the inventory a precondition with its own evidence; the PRD lists them together. *Flip cost:* merge into one 8-pt story; the sequencing inside it is unchanged.

---

## 6. Variance vs PR #913 — basis difference, explained

PR #913's totals (**LAUNCH 391–557, FULL 564–822**) were built bottom-up from **filed issue points**. This design's totals (**LAUNCH 544, FULL 751**; §1) are built from **fresh per-story estimates on PRD + audit evidence**. The totals differ for four stated reasons — not because either pass invented or lost work:

**6.1 Placement (programme-neutral, epic-visible).** Three items sit in different epics than the scope placed them: the legal hold (scope: M19 → here: E-M06 FS-028, DD-2); the `apiCall` sweep (scope: cross-cutting → here: E-M09 FS-053, its module); the audit-export (scope: inside the explain-IDOR line → here: its own story FS-026, DD-1). Epic rollups move; the programme total does not.

**6.2 Re-pricing on evidence.** Where the audit proved the filed price rested on a false premise, the designed price differs and says so: the scorecard work was filed at a single 8 pts on a "schema-only" premise — designed as 5 + 3 (FS-059/FS-060) on the verified one-system reality; the evaluations-pipe fix was filed at 3 on a one-line premise — designed at 5 (FS-078: pipe rewire + factor wiring + the regression test the PRD requires); the Observer recording-decoupling residue was filed at 1 (a record) — designed as a 1-pt record **plus** a 3-pt gated build (FS-070/FS-071), because the panel proved the functional gap (no recording without Observer) is real work if ruled.

**6.3 The scope's own arithmetic.** PR #913's §7 module rollups under-add its own appendix line items in at least one place: its M19 lines sum to 26–29 against a stated 21–25 rollup. This design's per-story sums are the rollups (M19 family = 25 + FS-028's 5 = 30). Part of the apparent growth is the filed basis's arithmetic, not new scope.

**6.4 One ordering disagreement with Lead (recorded, not resolved here).** Lead's tranche map runs the threat-intel chassis inside Sprint 11, in parallel with the Applications funnel work. This design sequences **FS-094 (IP capture) after FS-030 (single creation path)**: the capture writes at application creation, and building it before the four creation paths consolidate means building it on paths FS-030 then removes — the capture would be built twice, or worse, survive on a removed path. The chassis tables (FS-095) may proceed in parallel; only the creation-path write waits. Lead owns sprint composition; the disagreement is flagged for Sumanth's programme review, and if Sprint 11's chassis lands first, FS-030 inherits the re-pointing cost explicitly.

**What would move these totals:** the pricing ruling (reshapes FS-098–FS-100), FS-085/FS-086's sandbox findings (FS-087 spends or returns), FS-084's cluster verdicts (FS-088), accept-vs-fund on FS-127 (−5), and D-M12-4 (moves 42 pts between FULL and a post-launch LAUNCH-adjacent tranche — the amount is identical either way).

**What this design does not do:** it does not dispose of the old backlog (Sumanth's separate decision), does not re-plan Sprint 11 (approved; Tranche 1's in-flight work is the first build of FS-024–FS-029's ground), and does not authorise any build — every epic enters the programme through Lead's sprint planning and Sumanth's gates, as always.

---

*Cross-links: requirements baseline — `02-planning/full-application/` (overview, decisions, 23 PRDs, PR #835); evidence basis — `00-relearn/project-knowledge-base-2026-10-13-full-application.md`; filed-basis scope (superseded as the governing basis by Sumanth's 2026-10-13 correction; retained as the programme's tranche map until Lead re-plans from this design) — `02-planning/full-application/full-application-build-scope.md` (PR #913). Companion format exemplar: `03-solutioning/unified-interview-engine/epics-stories.md`.*
