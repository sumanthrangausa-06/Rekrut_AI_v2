---
project: Rekrut AI — Full Application
phase: 2-Planning / 4-Implementation input
created: 2026-10-13
owner: Sumanth
lead: Lead (Team Lead)
status: DRAFT — at Sumanth's gate; nothing in this document is a build instruction until he rules
---

# Full-Application Build Scope — Every Module Working End-to-End

**Sumanth's ask (2026-10-13, third time today):** "we are trying to build a full application end to end both from Candidates dashboard and Recruiters dashboard. All the UI elements should work and all the wiring should work and all the modules should work. can you scope."

**The bar this scope is measured against:** every module works end-to-end — **every UI element on every screen functions, every wiring path (UI → API → data → back) is complete and verified, no dead buttons, no mock surfaces presented as real, no unwired panels, honest empty states everywhere** — across the Candidate dashboard, the Recruiter dashboard, Admin, and the public surfaces.

## How this scope was built (evidence, not memory)

| Layer | Source | What it contributed |
|---|---|---|
| Module + journey truth | Scout's full-application relearn (`00-relearn/project-knowledge-base-2026-10-13-full-application.md`, verified vs `origin/dev @ 48454fea`; 416 issues swept) | 22 modules + S1, per-module verified state, issue reconciliation |
| Requirements baseline | Rex's 23 module PRDs + application overview + decisions list (**PR #835, unmerged** — this scope treats them as the baseline; if #835 changes at its gate, affected lines re-open) | Gap-to-launch per module, decision IDs |
| Wiring truth | Scout's UI/wiring audit (2026-10-13, `origin/dev @ 48454fea`; 143 page files, ≈120 routed screens, every screen element-class-checked; 27 findings: BROKEN 9 · DEAD 6 · MOCK 8 · ABSENT 4) | The dead buttons, mock surfaces, double-prefix 404s and missing clients the PRDs could not see |
| Filed backlog | Live GitHub inventory (195 open issues, re-read 2026-10-13) + Sprint 11 plan (PR #814, approved) + S-088 audit output (#820–#834) | Every existing story, with its filed points |

**Sizing rules (so the totals can be trusted):**
1. **A filed story's own points govern** where a story exists (sized at filing with STOP-1 knowledge). Rex's PRD ranges govern unfiled gaps. Where the two materially conflict, the doc notes it (largest: Rex grouped the #780 erasure family at 5–8; the filed split #780 5 + #813 3 + #829 3 = 11 governs).
2. **One story, counted once**, in its home module; other modules cross-reference at 0 pts.
3. **Open decisions are decision-gated lines** — sized, with the ruling they wait on named. Nothing is silently assumed in either direction.
4. Ranges are honest ranges. Contingent allowances (M13) are labelled contingent. No single fake-precise number is offered anywhere.

---

## 1. The three totals

| Total | Points | What it means |
|---|---:|---|
| **Tranche 1 — Sprint 11 committed (already approved)** | **19** | The approved Sprint 11 core: S-088 audit (3, done) · #780 erasure anchor (5) · audit reserve (2) · #799 legal-hold brake (5) · jest first run (2, done as a failure ledger) · #785 (1) · Aria's PRD amendment (1, = PR #816). **This is a subset of the Launch-complete total, not additional to it.** |
| **Launch-complete total** | **391–557** | Everything needed for the January product to be **whole at the ruled scope**: both dashboards + admin + public, every module wired end-to-end, proven holes closed, fabrication-class defects (fake scores, mock surfaces, invented compliance data) eliminated, honest empty states everywhere, QA + responsive evidence, the D2 promotion gate, and the pre-launch window executed. Of this, **≈179–257 pts are already-filed stories** (Sprint 11 committed + sequenced, the S-088 audit set, Sprint 12's ruled pairs, threat-intel dark build, legacy filed defects) and **≈212–300 pts are the 73 stories filed by this scope** (Appendix A). |
| **Full-application total** | **564–822** | Launch-complete **plus** everything deferred by ruling or contract (173–265): two-sided OmniScore completion (21–34), the Tier 3 Observer analysis chain under the Gate A re-entry contract (34–55 + activation conditions 5–8), Post-Hire completion (21–34), productised BGV (21–34), god-file extraction (13–21), inline-analysis extraction (13–21), E-006 report products (16 filed), integrity dashboards (8–13), Admin MFA (5 filed — Sumanth's "later" ruling), and the smaller deferred lines. This is the whole product, finished — not the January promise. |

**Cross-check (so the delta is visible, not hidden):** Rex's PRD-only extraction totalled LAUNCH 316–524. This scope's filed-basis total is higher (391–557) for three named reasons: (1) the S-088 audit-exit story set (34 pts across #823–#834) is filed scope Rex's PRD tables under-grouped; (2) Scout's wiring audit found 27 defects the PRDs could not see (≈45 pts incl. the M13 coding client and the M18/M19 full-page mocks); (3) filed points govern over PRD re-estimates where they differ. Neither number is "wrong" — they are different bases, and this document totals on the backlog basis because the backlog is what gets built.

**Velocity honesty:** Sprint 11 runs at 20 pts/sprint capacity with Sumanth reviewing every gate personally. At that rate the Launch-complete remainder after Sprint 11 (≈372–538) is a multi-sprint programme, not a January certainty — see §6 (critical path) for what that means and what it does **not** mean. This scope prices the whole; sequencing it against the calendar is the next planning act, and parts of it will need Sumanth's explicit triage rulings (§5) rather than silent slippage.

---

## 2. Surface A — Candidate dashboard

### M1 — Auth & Accounts *(shared with Surface B; state: WORKS)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Post-auth redirect latency 6.1 s — diagnose + fix | #105 | 3–5 | — |
| E2E auth-suite friction (test-side) | #184/#185 | 2–3 | — |
| OAuth employer-block regression tests, both providers | **new** (App. A) | 2 | — |
| Staging behavioural verification: reset + refresh-token revocation | **new** [VERIFY] | 2 | D2 gate |

**M1 subtotal: 9–12 LAUNCH · 0 FULL-ONLY**

### M4 — Candidates & Profiles *(state: WORKS; god-file risk; wiring audit: 3 screens, 0 findings)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Profile-completeness contract = exactly the fields recruiters see | **new** | 2–3 | — |
| Parsed-resume accuracy spot-evaluation + document upload on staging | **new** [VERIFY] | 2–3 | D2 gate |
| Extract application writes from the 5,715-line `candidate.js` god-file (Sage-led; file frozen for new features from 2026-10-13) | **new** | 13–21 | D-M04-1 · FULL-ONLY |

**M4 subtotal: 4–6 LAUNCH · 13–21 FULL-ONLY**

### M5 — Career Coach & Candidate AI Tools *(state: BUILT, uneven; wiring audit: 5 screens, 5 findings — 2 BROKEN, 3 MOCK)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Mock-grade sweep — enumerate every mock/placeholder endpoint | **new** [VERIFY] | 2 | informs D-M05-1 |
| Contract repair: LinkedIn optimizer + career diagnosis can actually reach their backends (wrong path, wrong payload field, double-encoded body — Scout, file:line in audit) — fix vehicle for legacy #240/#249 | **new S-117** (closes #240/#249 on evidence) | 5 | — |
| Mock-grade AI engines (LinkedIn tips, career diagnosis, CV mock scoring) — cut, label, or wire to the real provider cascade; none presented as AI | **new S-118** | 3–5 | **D-M05-1** |
| *(Also open, legacy: #239 LinkedIn refresh, #246 profile features, #242 onboarding stuck, #241 verification skeleton — per-item re-verification rides the M13-style cluster discipline (§11 item 5); the wiring audit found their pages' main flows wired at this HEAD)* | #239/#246/#242/#241 | in cluster allowance, M13 pattern | — |

**M5 subtotal: 8–12 LAUNCH** *(if D-M05-1 rules "defer module", LAUNCH drops to ≈2 — hide/unlink cleanly — and the mock-engine line moves out; the two shapes are not both totalled)*

### M9 — AI Interview & Screening *(candidate runtimes; state: WORKS, analysis hand-rolled inline; wiring audit: 9 screens, 2 findings)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Screening-questionnaire page entirely broken (double-prefix 404s ×5) + job-applicants panel + QP consent receipts — one root cause, one story | **new S-126** (§E) | 3 | — |
| Screening-sessions over-send: `GET /screening/sessions` embeds full transcripts — trim; gated single-session read (S-087 pattern). *Exposure-window assessment remains a separate counsel-gated item (Lex); this fix does not close it* | **new** | 3–5 | **D-M09-1** |
| Fallback-score provenance: every AI score marked model- vs fallback-scored (precondition for #791's exclusion guardrail) | **new** | 3–5 | — |
| Fallback reachability + Quick Practice isolation verification | **new** [VERIFY] | 1–2 | — |
| In-room Share/Effects/Settings controls — implement or remove (honestly labelled today; the bar is no dead buttons) | **new** | 2 | Sumanth micro-call |
| Extract inline analysis into a real service (Sage; panel ruled leave-alone pre-launch) | **new** | 13–21 | FULL-ONLY |

**M9 subtotal: 9–14 LAUNCH · 13–21 FULL-ONLY**

### M13 — Assessments & Coding *(state: BUILT, verification debt; wiring audit: 11 screens, 1 ABSENT finding)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Feb-2026 cluster per-item re-verification, evidence per issue, no bulk close (#243 aptitude + family #239–#251) | #243 + family | 3–5 | — |
| Fixes arising from re-verification — **contingent allowance** | (same cluster) | 0–13 | — |
| Coding sandbox security audit (#118) — Step Zero first: prove whether a sandbox is even deployed per environment | #118 | 5–8 | **D-M13-1** |
| Sandbox remediation if the audit finds isolation failures — **contingent allowance** | #118 | 0–13 | D-M13-1 |
| Coding-assessment client surface: server fully built, **zero client exists** — templates/submissions/sandbox UI; enablement stays OFF until #118 dispositions | **new S-121** | 8–13 | enablement: D-M13-1 |
| Assessment/coding results named in the erasure inventory | **new** | 1–2 | — |

**M13 subtotal: 17–54 LAUNCH** *(the width is honest: two contingent allowances + one net-new client)* **· 0 FULL-ONLY**

### M14 — Verification & Background Checks *(state: BUILT + erasure-wired; wiring audit: 0 findings)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Consent receipts name what is checked + who sees it, per check type (audit + gap-fill) | **new** | 2–3 | — |
| Cross-company result-exposure sweep | **new** [VERIFY] | 1–2 | — |
| Productised BGV depth (third-party checks, adverse-action workflow) | #132/#133 | 21–34 | D-M14-1 + #788 · FULL-ONLY |

**M14 subtotal: 3–5 LAUNCH · 21–34 FULL-ONLY** *(current-depth operation is not gated by #788; only expansion is)*

### M22 — Referrals & Introductions *(state: WORKS with one live break; wiring audit: 0 findings)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Referral-first apply 500s on a CHECK violation | #824 (S-100) | 2 | — |
| Referral data in the erasure map + cross-company check | **new** | 1 | — |
| Introductions-path + referral-assessment staging verification | **new** [VERIFY] | 1–2 | D2 gate |
| *(Open sibling: #349 referral assessment links journey)* | #349 | rides #824's regression test | — |

**M22 subtotal: 4–5 LAUNCH · 0 FULL-ONLY**

---

## 3. Surface B — Recruiter dashboard

### M2 — Companies, Teams & RBAC *(state: WORKS with drift; wiring audit: 5 screens, 3 findings)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Role-model implementation: one model across DB CHECK + RBAC map; `employer` retired/migrated; conflation ended | #766 | 5–8 | **D-M02-1** |
| Ownership patches (Sumanth's recruiter-first scenario): signup owner disclosure, Rekrut-side evidence-based recovery path, suspend under audit discipline, `is_verified` no longer asserted from a domain alone | **new** | 5–8 | Sumanth confirms (a)+patches |
| Employer census + admin/owner conflation enumeration (informs the ruling) | **new** [VERIFY] | 2 | informs D-M02-1 |
| Object-authorisation convention applied to company/team mutations | **new** | 3 | — |
| Candidate company-profile page: calls a recruiter-gated endpoint with a candidate token (can never load) + dead Sign Out button | **new S-114** | 3 | — |
| Recruiter-profile page: a fully fake parallel surface (hardcoded company, local-only Save) — retire or wire to the real company page | **new S-115** | 3 | — |
| *(Open sibling: #338 company ownership hardening — domain verification + dispute; overlaps the recovery-path line — STOP 1 of the patches story reconciles, no double count)* | #338 | in patches line | — |

**M2 subtotal: 19–27 LAUNCH · 0 FULL-ONLY**

### M3 — Jobs & Careers *(state: WORKS end-to-end; wiring audit: 9 screens, 2 findings)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Salary entered ≠ salary displayed | #315 | 2–3 | — |
| Careers fabricated company score: strip the server-side `‖ 75` fallback + suppress the public score until it has a basis — **fix approved by Sumanth** | #836 (S-111) | 2 (filed) | ruled |
| Recruiter career-page substitutes an invented company (TrustScore 87, 4.6★) on ANY API error — remove the silent mock fallback (+ job-form preview mock labelled) | **new S-116** | 2 | — |
| Job-posting content check (US/India) in the create flow | **new** | 2–3 | — |
| Public career page validation/published-only verification | **new** [VERIFY] | 1–2 | — |

**M3 subtotal: 9–12 LAUNCH · 0 FULL-ONLY**
*Evidence note:* Lead verified the server-side `|| 75` at `routes/careers.js:58,209` on `origin/dev`; Scout's wiring audit checked the client files and found the `generateMockData` fallback as the client-side fabrication. Both are real, on different surfaces; they are scoped as two stories (#836 + S-116), not one.

### M6 — Applications & Pipeline *(state: WORKS WITH 3 runtime-proven P0 holes; wiring audit: 3 screens, 1 finding — Sprint 11's module)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| **P0: candidate status self-advance (incl. reversing a recruiter rejection)** | #820 (S-096) | 5 (filed) | **committed-set ruling pending** |
| **P0: explain-decision IDOR (enumerable; leaks `recruiter_notes`) + siblings (`/explain/omniscore/:userId`, auth-only `/audit/export` of all logs)** | #821 (S-097) | 3 (filed) | **committed-set ruling pending** |
| **P0: cross-company screening-send mutates another company's application** | #822 (S-098) | 2 (filed) | **committed-set ruling pending** |
| Erasure: `job_applications` core | #780 | 5 (filed) | entry: #799 merged + verified |
| Erasure: application-keyed tables sweep (C2) | #813 (S-094) | 3 (filed) | after #780 |
| Erasure: C2 extension (aptitude/coding/AI-explanations/overrides/proctoring) | #829 (S-105) | 3 (filed) | hold-first |
| Creation funnel: ai-screener phantom applications | #823 (S-099) | 3 (filed) | — |
| Duplicate recruiter status endpoints converged | #825 (S-101) | 3 (filed) | — |
| Status vocabulary drift (aggregations + stage config) | #826 (S-102) | 2 (filed) | — |
| Application state machine: transition rules + consistent audit trail | #827 (S-103) | 5 (filed) | — |
| Visibility filtering on application-derived surfaces | #828 (S-104) | 3 (filed) | — |
| Applications retention: policy + purge path for terminal-state applications | #830 (S-106) | 5 (filed) | hold-first |
| Consent/notice for reuse of past application content | #831 (S-107) | 3 (filed) | — |
| Batch status: report the shortfall, don't silently drop IDs | #832 (S-108) | 2 (filed) | — |
| Questionnaire access check: dead `user_id` clause | #833 (S-109) | 1 (filed) | — |
| `hired_at`: make time-to-hire truthful | #834 (S-110) | 2 (filed) | — |
| Object-authorisation convention: post-spine remainder | **new** | 5–8 | — |
| Candidate application view shows mutual fit + company Trust Score (after inputs corrected) | **new** | 2–3 | **D-M06-2** |
| Pipeline list payload re-audit (S-087 pattern) | **new** [VERIFY] | 2–3 | — |

**M6 subtotal: 59–64 LAUNCH · 0 FULL-ONLY** *(the largest module in the launch total — it is the Applications module whole, as Sumanth's module-order ruling intends; 50 of its points are already-filed stories)*

### M7 — Matching & Discovery *(state: WORKS with an open P1 cluster; wiring audit: 5 screens, 2 findings)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Candidates-page 10-bug cluster (fields never render, tabs ignored, stats wrong population, bulk-update 500s, preview shape) — per-item re-verify then fix | #405 | 8–13 | — |
| Pagination dead end-to-end | #414 | 2–3 | — |
| Preview/invite bypass soft-delete + candidate opt-out (privacy) | #416 | 3–5 | — |
| Practice-fact marker guardrail audit (marker never a ranking/filter/search input) | rides #792 | 1–2 | — |
| Two-sided display: Trust Score display-only, mutual fit shown, honest free-tier teaser (today: 3 invented jobs behind a blur) | **new** | 3–5 | **D-M07-1** |
| "Run screening" action posts to a backend that does not exist — build it or remove the action | **new S-120** | 3 | — |
| AI-search quality spot evaluation | **new** [VERIFY] | 2 | — |
| Full per-pairing matching consumption | **new** | 5–8 | D-M12-4 · FULL-ONLY |

**M7 subtotal: 21–33 LAUNCH · 5–8 FULL-ONLY**

### M8 — Session Engine *(state: WORKS — the unified core; wiring audit: 0 findings)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Mount-order harness failure on clean `dev`: root-cause or formally baseline | **new** | 2–3 | — |
| Lifecycle behaviour under real-DB concurrency (evidence) | **new** [VERIFY] | 2–3 | D2 gate |

**M8 subtotal: 4–6 LAUNCH · 0 FULL-ONLY**

### M10 — Human Interviews, Panels & Recordings *(state: WORKS, presence path; wiring audit: 7 screens, 1 finding — the known unwired report column)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| S-093: report reads submitted+locked panel scorecards (session resolver) + server-side AI-section gate until own scorecard locks — today the report's human column is hardcoded `missing` (honest, but permanently empty) | #810 (S-093) | 8 (filed, ceiling) | — |
| Migration-125 deprecation in writing (the "two systems" premise was falsified — panels serves the 125 tables; what remains is the written record) | **new** | 1–2 | D-M10-1 |
| Recording playback on staging + migration-125 reader sweep | **new** [VERIFY] | 2 | D2 gate |
| Drop deprecated 125 artefacts (post-launch) | **new** | 3–5 | D-M10-1 · FULL-ONLY |
| *(Open follow-up: #811 Track-B alias removal, 1-sprint expiry)* | #811 | rides S-093 sequencing | — |

**M10 subtotal: 11–12 LAUNCH · 3–5 FULL-ONLY**

### M11 — AI Observer & Integrity *(state: presence-only works; capture DORMANT; analysis ABSENT — Gate A governs)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Cohort Enablement: January audit spine (consent record, attended, "analysis: not provided") + cohort allow-list — blocks any enablement | #806 (S-089) | 8 (filed, provisional) | — |
| Tier 1: genuinely no-media presence branch (provable no-subscription) + notice/objection artefacts + tier resolver | #838 (S-112) | 8 (filed, provisional) | ruled "all three"; C-04 open |
| Tier 2: post-lock composer — combined qualitative candidate report from HUMAN scorecards only, per-statement provenance | #839 (S-113) | 6 (filed, provisional) | ruled; depends #810 |
| Tier 1+2 gate evidence pack (zero-subscription counters, tier resolution, blindness-at-API) | **new** | 3–5 | — |
| `observerJobs` terminal-state guard | #785 | 1 (filed) | — |
| Toggle-split (#334): formal revocation record — panel finding: the real residue is recording-decoupling (human interviews without the Observer get no recording today); revocation-or-decouple is Sumanth's call | #334 | 1 | **D-M11-1** |
| Tier 3: consented AI assessment — the full analysis chain (fusion #674, multimodal #681, report generation #697) | #674/#681/#697 | 34–55 | Gate A contract + C-05 · FULL-ONLY |
| S-085 activation conditions C-L1/C-L2/C-L4 (PITR evidence had no tracked issue until now) | **new** | 5–8 | contract · FULL-ONLY |

**M11 subtotal: 27–30 LAUNCH · 39–63 FULL-ONLY**

### M12 — Scoring *(state: PARTIAL — one global candidate score on the wrong inputs; wiring audit: pages render the real-but-wrong-input score faithfully — a data-correctness defect, not wiring)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Practice OUT of OmniScore + labelled readiness panel + version note (Sprint 12 lead pair, ruled) | #791 | 8–13 | ruled |
| Practice-fact marker (opt-in, 6 guardrails) + narrow the recruiter endpoint exposing full practice history | #792 | 5–8 | ruled |
| Real `interview_evaluations` reach the engine (pipe bug) | #793 | 3 (filed) | ruled defect |
| #175 close-out: the "duplicate TrustScore" premise was falsified (panel) — `trustscore.js` is the live company engine, the standalone is a separate named service; nothing is deleted | #175 | 1 | ruled (finding stands) |
| Visibility-model fidelity per surface + `company_ratings` data-supply check | **new** [VERIFY] | 2–3 | feeds D-M07-1 |
| Two-sided completion: company-specific candidate scores + role-connected composite + per-role percentile | **new** | 21–34 | **D-M12-4** · FULL-ONLY |
| *Explicit non-gap:* unifying both scores under the OmniScore name — **rejected by Sumanth's ruling** (OmniScore = candidate, Trust Score = company). 0 pts; not scoped. | — | 0 | ruled |

**M12 subtotal: 20–28 LAUNCH · 21–34 FULL-ONLY**

### M17 — Post-Hire *(state: BUILT and wired — never scoped by any ruling until today; wiring audit: 15 screens, 1 DEAD finding)*
**Sumanth's ruling (2026-10-13): NOT defer-and-hide.** Post-Hire stays in the product; unfinished parts show "releasing soon"; work continues.
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| "Releasing soon" surface: every unfinished part labelled; finished parts stay honest | **new** | 3–5 | ruled |
| Retention + erasure disposition for onboarding/payroll records (never examined — data exists whether or not UI ships) | **new** | 3–5 | — |
| Runtime verification: offer → sign → onboarding end-to-end | **new** [VERIFY] | 3–5 | D2 gate |
| Recruiter post-hire-feedback form is dead (Submit stores nothing; the candidate twin uses the real API) | **new S-122** | 2 | — |
| Full completion: payroll correctness (US + India PF/ESI/tax), e-signature depth vs #131, erasure implementation, launch-readiness | #131 + **new** verify | 21–34 | FULL-ONLY |

**M17 subtotal: 11–17 LAUNCH · 21–34 FULL-ONLY**

### M21 — Analytics & Reporting *(state: product analytics BUILT; integrity reporting absent)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Every aggregate traces to a defined, company-scoped population | **new** | 3–5 | depends #820 |
| Demographic sections: prove the payload carries the funnel fields, or cut the sections (today unverified — if absent they render permanently-zero funnels as real diversity data) | **new** [VERIFY] | 2 | — |
| E-006 report products (recruiter full report + candidate qualitative report) | #683/#684 | 16 (filed) | **D-M21-1** (panel rec: post-launch) · FULL-ONLY |
| Integrity-metrics dashboards (cannot exist honestly before M11 measurement) | #701/#702 | 8–13 | Gate A contract · FULL-ONLY |
| Two-sided company analytics (Trust Score distributions/trends) | **new** | 5–8 | FULL-ONLY |

**M21 subtotal: 5–7 LAUNCH · 29–37 FULL-ONLY**

---

## 4. Surface C — Admin / platform

### M20 — Admin & Platform Ops *(state: PARTIAL; wiring audit: 8 screens, 1 BROKEN finding)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Admin dashboard AI-health widget calls a non-existent path and renders **fake-healthy** (health defaults to 100/"healthy", stats hardcoded 0) on failure — inside #254's family, fresh evidence | #254 | 5–8 | — |
| Admin endpoint path mismatches — per-item verify-then-fix (#254 remainder; Scout: largely stale at this HEAD, one live exception above) | #254 | (in line above) | — |
| **Migration-238 fresh-DB halt** — a fresh database never receives `candidate_profiles.bio`; migrations ≥239 never apply; blocks fresh staging provisioning | **new** [BUG] | 3–5 | **fund-vs-accept is Sumanth's call** |
| Admin-route authorisation remainder + public-API key scoping/revocation/audit | **new** | 2–3 | — |
| Live public-API keys/consumers census + admin page-by-page staging health | **new** [VERIFY] | 2 | D2 gate |
| Pre-launch cleanup window (one checklist, one evidence pack): test-data purge + QA test-admin accounts 205/206 + R2 plaintext run with JSON report saved as BIPA §15(a) evidence | #151 + #336 + #721 | 5–8 | ruled pre-launch track — executes at launch, never early |
| Admin MFA (TOTP) | #660 (S-055) | 5 (filed) | **Sumanth ruled: agreed, LATER ("not the priority now")** — panel's hard-blocker warning stays on record · FULL-ONLY |

**M20 subtotal: 17–26 LAUNCH · 5 FULL-ONLY**

### M15 — Threat-Intel *(state: ABSENT — zero code, zero tables; narrowed v1 approved; signal DARK until #788)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Application-time IP capture + consent gate (HMAC per-company silo, never raw IP) | #815 (S-095) | 3 (filed) | — |
| Chassis: `threat_intel_checks` + evaluation plumbing, dark | #807 (S-090) | 5 (filed) | after S-088 audit |
| Internal signal: repeat applications to same employer from same IP (info-severity, on-application observation, never a ranking/scoring/auto-reject input) | #808 (S-091) | 3 (filed) | ships dark |
| Recruiter review UI (confirm/dismiss, dispute path) — **not built until counsel lands** | #809 (S-092) | 3 (filed) | **#788** · FULL-ONLY |
| External sources (AbuseIPDB / HIBP / XposedOrNot): all blocked at $0 by their own terms | — | 0 | needs licensing clearance + Sumanth budget call, not engineering |

**M15 subtotal: 11 LAUNCH (built dark) · 3 FULL-ONLY**

---

## 5. Surface D — Public (landing / careers / legal)

### S1 — Landing, Marketing & Legal Pages *(state: WORKS; wiring audit: 10 screens, 2 DEAD findings)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Biometric policy page promises an unbuilt 60-second calibration baseline — remove/soften (blocks any Observer enablement; also an enablement blocker, not just launch copy) | #777 | 1 (filed) | — |
| Public-claims pass: every capability claim traced to shipped code or removed (incl. the login page's placeholder partner strip) | **new** | 3–5 | **D-S1-1** |
| Terms/privacy full text vs the retention design (close read — never done) | **new** [VERIFY] | 2–3 | D-S1-1 |
| Pricing page: one plan narrative (today: candidate "Pro $19/mo" vs recruiter tiers — two stories on one page family); ships after the pricing ruling | **new** | 1–2 | **D-M16-1** |
| Contact form shows a success screen but sends nothing (no endpoint exists); footer Privacy/Terms/Help links are all `href="#"` on every authenticated page | **new S-125** | 3 | — |
| *(Careers surfaces live in M3 — #836 + S-116, counted there.)* | — | 0 | — |

**S1 subtotal: 10–14 LAUNCH · 0 FULL-ONLY**

---

## 6. Surface E — Cross-cutting

### E1 — Authorisation & RBAC platform-wide *(the repeatable defect class — overview §5.1)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| The convention itself: one object-authorisation convention + reference implementation (M6) + standing review rule | **new** | 5–8 | — |
| Platform-wide auth-only sweep (authentication treated as authorisation) beyond the proven instances — unchecked families: M9 screening reads, M13 assessment reads, M14 result reads. *Any hole proven becomes its own story at STOP 1 sizing — not pre-costed* | **new** | 5–8 | — |
| Application costs ride the module stories | M2 3 · M6 5–8 · M18 2–3 · M20 2–3 | (counted there) | — |

### E2 — Wiring integrity
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| `apiCall` double-prefix family (S-126 — §A/M9): questionnaire page + job-applicants panel + QP consent receipts | **new S-126** | 3 | — |

### E3 — M19 Consent, Privacy & Compliance *(state: STRONGEST module — two live defects; wiring audit: 7 screens, 1 full-page MOCK)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| **Recruiter compliance page is entirely mock** (1,342 lines, explicit `// Mock Data`, zero API calls — invented bias/compliance tables rendered as the company's live posture, while the real API the admin page uses sits unused) | **new S-124** | 5 | — |
| Purge arming fix: DB-identity check replaces the `NODE_ENV` gate (today the 90/30-day promise **cannot arm** on either Render service) | #805 | 2 (filed) | — |
| Legal-hold build — the brake; gates every deletion-widening story | #799 | 5 (filed) | — |
| Retention audit surface: aggregate-only entries + read surface | #801 | 2 (filed) | — |
| `[purged]` sentinel leaks into the user-facing recordings API | #802 | 2 (filed) | — |
| Retention backfills (historical `.enc` corpus + soft-deleted transcripts; dry-run first) | #803 | 3 (filed) | live run = separate gate |
| `recording_objects` retry hardening (3 named defects) | #804 | 2 (filed) | — |
| Purge dry-run evidence pack (boundary-age tests, reconciliation, storage proof, Lex's carve-out list) — the record the flip decision stands on | **new** | 1–2 | flip = **D-M19-1** (Sumanth's manual act) |
| Erasure inventory made procedural (new table without a map entry fails review) | **new** | 2–3 | — |
| DSAR completeness / audit append-only / consent-middleware verification pack | **new** [VERIFY] | 2–3 | D2 gate |

**M19 subtotal: 21–25 LAUNCH · 0 FULL-ONLY**

### E4 — M18 Notifications, Email & Communications *(state: WORKS; wiring audit: 5 screens, 1 full-inbox MOCK)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Recruiter communications page is an entirely invented inbox (hardcoded messages; reply/star/delete are local-only) while the real comms backend + real chat exist unused by it | **new S-123** | 5–8 | — |
| Staging send→deliver→track evidence run, all transactional classes (#99's residual: provider configured 2026-10-07, behaviour never evidenced) | #99 | 2–3 | D2 gate |
| Template completeness audit (reset/invite/schedule/status/offer; missing template fails loudly) | **new** | 2–3 | — |
| Chat onto the object-authorisation convention | **new** | 2–3 | — |
| Email open-tracking disclosure check | **new** [VERIFY] | 1 | — |

**M18 subtotal: 12–18 LAUNCH · 0 FULL-ONLY**

### E5 — M16 Billing & Subscriptions *(state: PARTIAL — checkout wired, metering absent; wiring audit: no wiring breaks on billing surfaces)*
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| Metering for the ruled unit (tier-based) | #698 (S-050) | 5 (filed) | **D-M16-1** |
| India pay-as-you-go billing | #699 (S-051) | 5 (filed) | **D-M16-1** |
| Overage billing with confirmation | #700 (S-052) | 3 (filed) | **D-M16-1** |
| Production Stripe live keys at launch + keys-mode line in the promotion checklist | #837 | 2–3 | launch event |
| Checkout→webhook→tier round-trip validated on staging in test mode (never evidenced) | #6 + #193 | 3–5 | — |
| Webhook idempotency + signature verification audit | **new** | 2–3 | — |
| *Correction on record:* **staging's Stripe secret is TEST class today** (verified 2026-10-13, class-only). #98's "live keys on staging" was true on 2026-08-08 and stale thereafter; this scope costs #837 (production) and the behavioural checkout verification queued in Sprint 11 — not a staging key swap. | — | 0 | — |

**M16 subtotal: 20–24 LAUNCH · 0 FULL-ONLY**

### E6 — Quinn's whole-app QA workstream *(sized as a workstream, not a per-story tax)*
| Line | Pts | Notes |
|---|---:|---|
| Test plan + journey matrix (candidate, recruiter, admin, public journeys traced to the module PRDs) | 5–8 | 143 pages, 22 modules |
| Mocked-suite execution + repair — jest's first real run was 2026-10-13 (1,201 tests, 0 product bugs) | #817: 3–5 · #818: 1–2 | #817 also discharges Lex C-L3's remainder; promotion-blocking for the S-085 code |
| E2E journey verification — both dashboards + admin + public (43 specs exist on paper; execution unproven; legacy failures #184–#195 are the baseline this discharges or re-files) | 8–13 | mocked/local tier |
| Responsive verification — phone/tablet/laptop per Sumanth's standing directive, by template family (~25 families), incl. the interview room on iPhone Chrome (his test device) | 8–13 | no systematic audit exists today |
| **D2 staging gate** — the ONLY real-DB evidence tier: full journey re-run on staging (real DB + R2 + Brevo + Stripe test mode), Relay checklist, Sumanth's gate. Discharges every [VERIFY] line marked "D2 gate" | 8–13 | promotion is a production-schema event (shared DB; migrations 252–257 at boot) |
| Defect-fix allowance inside QA (regressions the above finds, excluding module gaps already costed) | 5–8 | allowance, labelled |

**QA subtotal: 38–61 LAUNCH** *(mocked green is necessary, never sufficient — the staging gate is the only tier that can discharge real-DB/storage/email/payment claims, and this VM cannot reach Neon/R2/B2 over TLS at all)*

### E7 — Design foundation
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| DESIGN.md bootstrap — one gated `impeccable document` run; **no DESIGN.md exists anywhere today**. Sumanth directed the build phase to use the full design skill set (impeccable / taste / Vercel guidelines); those skills anchor to this file | **new** | 3–5 | **D-DESIGN-1** (before the next UI-heavy phase) |
| UI work **provisional without it** (buildable, but design decisions may re-open): M5 mock cut/label UI · M6 application-view score display · M7 candidate cards + badges · M9 screening-monitor payload UI · M11 Tier 1 artefacts + Tier 2 output presentation · M12 readiness panel · M16/S1 pricing + public pages · M17 "releasing soon" surface | — | (in module lines) | — |

### E8 — Uncounted verification pack
| Gap | Story | Pts | Gate |
|---|---|---:|---|
| #791 score-distribution impact (DB read; decides version-note wording) · trustscore divergence check (decides #175 close-out safety) · materialised-view refresh correctness · candidate-Pro purchaser census (informs D-M16-1) | **new** [VERIFY] | 6 | D2 gate / before #175 |
| E-signature legal depth vs #131 | **new** [VERIFY] | 2–3 | feeds M17's FULL-ONLY sizing (carried inside that range, not added separately) |

### E9 — Promotion track + business gates (not engineering points)
- **D2 promotion (Relay-owned):** frozen `dev` → staging as its own gated production event — migrations **252–257** reviewed one by one (254 rewrites a CHECK constraint; 257 alters `recording_objects`), jest C-L3 remainder (#817) discharged first for the capture code, Relay checklist, Sumanth's approval at the gate. Sized inside E6's staging-gate line; the act itself is a gate, not a story.
- **Atlas evidence gates (business track, 0 eng pts):** 15–20 discovery calls by 2026-11-30 + 3–5 paid-pilot commitments by 2026-12-15 (Atlas owns, Sterling closes; Ledger locks pilot→paid conversion pricing in writing before any pilot signs). Unconverted pilots by 2027-02-28 → **Gate A reopens automatically 2027-03-01**. Tracked on the new tracking issue (App. A). No outreach happens without Sumanth's approval of each send.

**Surface E subtotal (E1 10–16 + E2 3 + M19 21–25 + M18 12–18 + M16 20–24 + E6 38–61 + E7 3–5 + E8 6): 113–158 LAUNCH** *(module subtotals inside E are also in the §1 module accounting — the three totals are computed once, from the module table in §7)*

---

## 7. Totals accounting (each story counted once, in its home module)

| Module | LAUNCH | FULL-ONLY | Home surface |
|---|---:|---:|---|
| M1 Auth & Accounts | 9–12 | 0 | A |
| M2 Companies, Teams & RBAC | 19–27 | 0 | B |
| M3 Jobs & Careers | 9–12 | 0 | B |
| M4 Candidates & Profiles | 4–6 | 13–21 | A |
| M5 Career Coach & AI Tools | 8–12 | 0 | A |
| M6 Applications & Pipeline | 59–64 | 0 | B |
| M7 Matching & Discovery | 21–33 | 5–8 | B |
| M8 Session Engine | 4–6 | 0 | B |
| M9 AI Interview & Screening | 9–14 | 13–21 | A |
| M10 Human Interviews & Panels | 11–12 | 3–5 | B |
| M11 AI Observer & Integrity | 27–30 | 39–63 | B |
| M12 Scoring | 20–28 | 21–34 | B |
| M13 Assessments & Coding | 17–54 | 0 | A |
| M14 Verification & BGV | 3–5 | 21–34 | A |
| M15 Threat-Intel | 11 | 3 | C |
| M16 Billing & Subscriptions | 20–24 | 0 | E |
| M17 Post-Hire | 11–17 | 21–34 | B |
| M18 Notifications & Comms | 12–18 | 0 | E |
| M19 Consent, Privacy & Compliance | 21–25 | 0 | E |
| M20 Admin & Platform Ops | 17–26 | 5 | C |
| M21 Analytics & Reporting | 5–7 | 29–37 | B |
| M22 Referrals | 4–5 | 0 | A |
| S1 Landing & Legal | 10–14 | 0 | D |
| Cross-cutting (E1+E2+E6+E7+E8-launch) | 60–95 | 0 | E |
| **TOTAL** | **391–557** | **173–265** | |

**Full-application total: 564–822.** Tranche 1 (Sprint 11 committed, 19) sits inside the LAUNCH column. Filed-vs-new split of LAUNCH: already-filed ≈179–257 · filed by this scope (73 stories) ≈212–300.

---

## 8. Decisions Sumanth still owes — and what each one blocks

Nothing below is assumed in the totals either way; each line is sized and waiting. (Ruled items — careers fix, Post-Hire keep + "releasing soon", MFA later, scoring-name split, Observer tiers, #175 nothing-to-delete, Stripe correction — are already applied in the tables and are NOT re-listed.)

| # | Decision | Blocks / gates | Pts waiting |
|---|---|---|---:|
| 1 | **P0 trio into Sprint 11's committed set?** (Lead's recommendation: yes — they are live, runtime-proven holes) | #820/#821/#822 move from sequenced to committed | 10 (sequencing, not scope) |
| 2 | **#766 role package** (D-M02-1: strip recruiter's company-admin powers, retire `employer` → `owner`, never conflate `admin`/`owner`) + the ownership-patches confirmation ((a)+patches: disclosure, recovery path, suspend discipline) | M2 implementation + census follow-through | 10–16 |
| 3 | **Pricing** (D-M16-1: Atlas+Ledger Option A credits → D hybrid on trigger; memo §8 inputs: beachhead, India INR test, pilot cap) | Metering build shape (#698–#700 presuppose it), pricing page | 13 + 1–2 |
| 4 | **Coach scope** (D-M05-1: in with mocks cut/labelled — panel position — vs defer) | M5's mock-engine line + module shape | 3–5 (+module shape 8–12) |
| 5 | **Two-sided OmniScore completion** (D-M12-4: defer as named post-launch scope — panel position — vs build now) | FULL-ONLY placement of 21–34 + M7 pairing line 5–8 | 26–42 (tranche placement) |
| 6 | **Admin MFA timing** — already ruled "later"; listed here only because the panel's hard-blocker warning stands against it | #660 stays FULL-ONLY until re-ruled | 5 |
| 7 | **`RETENTION_PURGE_LIVE` flip** (D-M19-1: after #805 verifies + dry-run pack exists; the flip is his manual act) | The 90/30-day promise having any live enforcement | 1–2 (evidence) + the act |
| 8 | **Screening over-send fix** (D-M09-1: fix pre-launch, S-087-style — panel consensus) | The new over-send story starts | 3–5 |
| 9 | **Sandbox gate** (D-M13-1: coding feature gated on #118's audit; Step Zero = prove whether a sandbox is even deployed) | Coding client enablement (S-121 builds regardless; the feature stays OFF) | audit 5–8 + remediation 0–13 |
| 10 | **E-006 reports** (D-M21-1: post-launch — panel position) | #683/#684 tranche placement | 16 (placement) |
| 11 | **BGV depth** (D-M14-1: current depth; expansion post-launch + counsel-gated) | #132/#133 stay FULL-ONLY | 21–34 (placement) |
| 12 | **Mutual-fit display** (D-M06-2) + **company-score display-only** (D-M07-1) | Two display stories | 5–10 |
| 13 | **Scorecard end-state in writing** (D-M10-1: panels canonical) + **#334 toggle** (D-M11-1: revoke, or build the recording decoupling) | Deprecation record; the recording-without-Observer question | 2–3 (+3–5 if decouple is built) |
| 14 | **Migration-238: fund the fix, or accept it in writing** | Fresh-environment provisioning stays impossible until fixed | 3–5 |
| 15 | **DESIGN.md bootstrap timing** (D-DESIGN-1 / panel #19: before the next UI-heavy phase) | UI lines listed in E7 stay provisional | 3–5 |
| 16 | **Public-claims pass into the pre-launch checklist** (D-S1-1) | S1 claims + legal-text lines | 5–8 |
| 17 | **Merge PR #816 + PR #835** (the PRD amendment + the PRD baseline this scope stands on) | The baseline itself | — (doc gates) |
| 18 | **Counsel track (#788)** — no-outreach ruling stands; listed because it gates: threat-intel UI (#809), Tier 3 activation (C-04/C-05/C-06), BGV expansion, the over-send exposure-window assessment | Those items stay dark/parked until it moves; the Gate A contract escalates the Nov 1 / Dec 1 checkpoints to Sumanth | — (not engineering) |

---

## 9. Critical path to January (one paragraph) + the tranche map

**Critical path:** The launch is gated by a chain, not a pile: **#799 legal-hold merged + verified → the deletion-widening set (#780 family, #802, #803, backfills) may move → the P0 trio + the S-088 audit set close the Applications module's proven holes → the authz convention + platform sweep close the defect *class* behind them → Sprint 12's ruled pairs (#791/#792 score inputs; S-112/S-113 Observer tiers) land on corrected inputs → the wiring/fabrication set (S-116, S-117, S-121, S-123, S-124, S-125, S-126, #836) makes every surface honest → Quinn's QA workstream executes (mocked tier) → DESIGN.md lands before the UI-heavy remainder → the D2 promotion gate (frozen `dev`, migrations 252–257 one by one, full journey re-run on staging — the only real-DB evidence) → the pre-launch window (#151/#336/#721 + the purge flip decision + #837 live keys) → launch.** Two hard blockers sit off the engineering path and cannot be engineered around: **#777 blocks any Observer enablement**, and **#788 (counsel, no-outreach by Sumanth's ruling) keeps the threat-intel signal dark and Tier 3 parked** — January is whole without them precisely because the rulings scoped January that way. The honest calendar note: at Sprint 11's demonstrated capacity (≈20 pts/sprint, one reviewer — Sumanth — at every gate), the Launch-complete total is **more than the remaining pre-January sprints can hold**; §8's decisions are therefore not paperwork — several of them (Coach shape, E-006 placement, two-sided placement, the M13 contingent allowances once verified) are how the January scope becomes a subset Sumanth *chose*, rather than a remainder that silently slipped.

**Tranche map (sequencing, for Lead's sprint planning after Sumanth rules):**
- **T1 — Sprint 11 (approved, building):** committed 19 + sequenced set (45 filed: #813, #807, #815, #806, #777, #808, #793, #810, #801–#805) + audit set rolling per the plan's order.
- **T2 — Sprint 12 (ruled pairs lead):** #791/#792 (score inputs) → S-112/S-113 (Observer tiers) → fabrication/wiring set (S-111 filed as #836, S-116, S-117, S-126, S-125) → #799-dependent remainder → DESIGN.md bootstrap at its head if D-DESIGN-1 rules so.
- **T3 — Launch-completion sprints:** M6/M7 remainder + convention application + sweep, M5 (per ruling), M13 (per #118 disposition), M15 dark build, M16 (per pricing ruling), M17 launch lines, M19 remainder, M20/M21/S1 lines, QA workstream running across all of it.
- **T4 — D2 promotion gate + pre-launch window** (Relay-owned; Sumanth's gates).
- **FULL-ONLY:** post-launch, in the order §1 names; Tier 3 only via the Gate A re-entry contract; MFA only if re-ruled earlier.

---

## 10. Specialist decisions per surface cluster (build-time, per the standing model)

| Cluster | Specialist seat(s) at STOP 1 / review | Why |
|---|---|---|
| A — Candidate dashboard | Privacy engineer (M13/M14 data surfaces, M5 AI claims); Candidate Experience (copy on every candidate-facing fix); accessibility reviewer (responsive lines) | Candidate PII + AI-claim honesty are the cluster's risk domains |
| B — Recruiter dashboard | Security reviewer (every authz/P0 story — non-negotiable); database reviewer (M6 state machine, erasure transactions); API designer (M7/M21 payload contracts) | The proven P0 class lives here; object-level authorisation is the fix pattern |
| Interview core (M8–M12) | Privacy engineer (M11 tiers, M9 over-send + provenance); Lex (consent artefacts, C-04/C-05 tracking); Quinn (evidence packs, blindness-at-API) | Consent-gated surfaces; evidence is the deliverable, not a by-product |
| C — Admin/platform | Security reviewer (MFA remainder, public-API keys, admin authz); Relay (migration-238, promotion mechanics) | Platform keys and fresh-DB integrity are launch-infrastructure risks |
| D — Public | Lex (claims pass, legal texts, #777 wording); Candidate Experience (careers/contact honesty) | Every public sentence is a claim the product must be able to prove |
| E — Cross-cutting | Privacy engineer + Lex (erasure/retention/hold — the S-076/77/78 precedent); database reviewer (purge/backfill mechanics); Quinn (whole-app QA ownership); Aria (DESIGN.md bootstrap run) | Deletion-widening never moves without the brake verified; QA is a workstream, not a tax |

---

## 11. Disagreements & honesty box (nothing silently resolved)

1. **Stripe:** Scout's KB and Rex's PRD-M16 both record #98's "staging on LIVE keys" framing. The later verified record (2026-10-13, class-only Render check) supersedes it: **staging is test-class; production is test-class too (#837)**. This scope costs the corrected version. If the correction were wrong, M16 would need a staging key-swap line (+2–3).
2. **Careers fabrication exists on two surfaces** (server `|| 75` — Lead-verified; client `generateMockData` — Scout-verified). Rex's PRD set mentions neither; Scout's KB sweep missed the server one. Both are scoped; the hole in both source documents is recorded here so it is not repeated.
3. **M11 presence:** the KB's journey text reads as if January presence "works to the Gate A line"; PRD-M11 is explicit that today's subscribe-only path is **not** the ruled Tier 1 no-media branch (Verified-Absent). This scope costs the PRD version (S-112). Totalling from the KB alone would understate M11 by ~16–26.
4. **Sizing basis conflicts (filed governs):** #821 filed 3 vs Rex 5–8 (the filed STOP-1 sizing stands; if the siblings prove wider, STOP 1 re-points — noted on the story); #793 filed 3 vs Rex 5–8; the #780 family filed 11 vs Rex's grouped 5–8. All three are flagged rather than averaged.
5. **Legacy clusters:** the Feb-2026 cluster (#239–#254 family) is at least partially stale — Scout found several "missing" endpoints present at this HEAD (#254 largely stale; #250/#247/#252 residuals verified in the KB). The scope therefore carries **re-verification before any fix money** (M13 pattern) and never bulk-trusts or bulk-closes. The same discipline applies to #184–#195 E2E failures: they are the QA workstream's baseline to discharge or re-file, not assumed live defects.
6. **What this scope could NOT verify:** all runtime behaviour (static path/payload proofs only — the VM cannot reach Neon/R2/B2 over TLS, and has no local Postgres); M13/M17 per-page runtime health; M21's demographic payload (filed as a verify story, not assumed either way); M16 Stripe behaviour end-to-end; the migration-238 halt (S-088's report, not re-run — its story's first AC is reproduction). Every such item is carried as a [VERIFY] story with its discharge gate named, mostly the D2 staging gate.
7. **PRD baseline risk:** PR #835 is unmerged. If Sumanth's gate changes any PRD materially, the affected scope lines re-open — §8 item 17 exists for exactly this.

---

## Appendix A — Stories filed by this scope (73, on 2026-10-13)

Every NO-ISSUE gap in Scout's wiring audit, Rex's PRD extraction, and the KB's gap list now has a tracked story (issue numbers #840–#912; the filing run completed with zero failures). Each body carries its context, acceptance criteria, scope estimate, gate, and source.

### Surface A — Candidate dashboard

| Issue | Story |
|---|---|
| [#840](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/840) | OAuth employer-block regression tests (both providers) |
| [#841](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/841) | [VERIFY] Staging auth behaviour: password reset + refresh-token revocation end-to-end |
| [#850](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/850) | Profile-completeness contract: computed from exactly the fields recruiters see |
| [#851](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/851) | [VERIFY] Parsed-resume accuracy spot-evaluation + document upload on staging (R2 path) |
| [#852](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/852) | Extract application writes from the candidate.js god-file into the M6 router (Sage-led) |
| [#853](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/853) | [VERIFY] Career Coach mock-grade sweep: enumerate every mock/placeholder endpoint in M5 |
| [#854](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/854) | S-117: Profile-enhancement contract repair — LinkedIn optimizer + career diagnosis pages can actually reach their backends |
| [#855](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/855) | S-118: Mock-grade AI engines — cut, label, or wire to real (LinkedIn tips, career diagnosis, CV mock scoring) |
| [#865](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/865) | Screening-sessions over-send: trim GET /screening/sessions, transcripts behind a gated single-session read |
| [#866](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/866) | Fallback-score provenance: every AI score marked model-scored vs fallback-scored in storage |
| [#867](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/867) | [VERIFY] Which inline analysis paths still reach a fallback in production config + Quick Practice isolation |
| [#868](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/868) | In-room Share / Effects / Settings controls: implement them or remove them |
| [#869](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/869) | Extract hand-rolled inline interview analysis into a real service (Sage-led, post-launch) |
| [#877](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/877) | Assessment + coding results explicitly named in the erasure inventory |
| [#878](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/878) | S-121: Coding-assessment client surface — templates, submissions, sandbox UI (server side is fully built) |
| [#879](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/879) | Verification consent receipts: every check type names what is checked + who sees it |
| [#880](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/880) | [VERIFY] No background-check result reaches any surface beyond the requesting company (sweep) |
| [#900](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/900) | Referral data named in the erasure map + never exposed across companies |
| [#901](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/901) | [VERIFY] Referral introductions-path health + referral-assessment page on staging |

### Surface B — Recruiter dashboard

| Issue | Story |
|---|---|
| [#842](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/842) | Apply object-authorisation convention to company/team mutations |
| [#843](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/843) | [VERIFY] Employer-user census + admin/owner conflation enumeration (informs #766 ruling) |
| [#844](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/844) | S-114: Candidate company-profile page — wire to a candidate-correct endpoint + working Sign Out |
| [#845](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/845) | S-115: Recruiter-profile fake surface — retire it or wire it to the real company profile |
| [#846](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/846) | Ownership patches: signup owner disclosure + Rekrut-side recovery path + suspend audit discipline + is_verified truth |
| [#847](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/847) | Job-posting content check (US/India) inside the create flow |
| [#848](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/848) | [VERIFY] Public career page: server-side required-field validation + published-only rendering |
| [#849](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/849) | S-116: Recruiter career-page — remove the silent fabricated-company fallback on API error |
| [#856](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/856) | Object-authorisation convention: post-spine remainder across application-scoped reads/writes |
| [#857](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/857) | Candidate application view: show mutual fit + company Trust Score per application |
| [#858](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/858) | [VERIFY] Pipeline list payloads re-audit after S-087 (Applications surfaces) |
| [#859](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/859) | Two-sided display at launch scope: Trust Score badges, mutual fit, honest free-tier teaser |
| [#860](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/860) | [VERIFY] AI-search quality spot evaluation (M7) |
| [#861](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/861) | S-120: Recruiter 'Run screening' action — build the missing backend or remove the action |
| [#862](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/862) | Full per-pairing matching consumption (candidate-in-role + company score + mutual fit as matching inputs) |
| [#863](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/863) | Session-engine mount-order harness failure on clean dev: root-cause or formally baseline |
| [#864](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/864) | [VERIFY] Session lifecycle behaviour under real-DB concurrency (D2 staging gate) |
| [#870](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/870) | Migration-125 scorecard tables: formal deprecation in writing |
| [#871](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/871) | [VERIFY] Recording playback on staging (R2 path) + sweep for clients still reading migration-125 tables |
| [#872](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/872) | Drop the deprecated migration-125 scorecard artefacts (post-launch migration, Sage) |
| [#873](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/873) | Observer Tier 1+2 gate evidence pack (zero-subscription counters, tier resolution, blindness-at-API) |
| [#874](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/874) | [FOLLOW-UP] S-085 activation conditions: C-L1 outcome-rows, C-L2 PITR evidence, C-L4 Rung-2 live-room |
| [#875](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/875) | [VERIFY] Scoring visibility-model fidelity per surface + company_ratings data-supply check |
| [#876](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/876) | Two-sided OmniScore completion: company-specific candidate scores + role-connected composite + per-role peer percentile |
| [#882](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/882) | Post-Hire 'releasing soon' surface: every unfinished part labelled, finished parts honest |
| [#883](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/883) | Post-Hire + payroll retention/erasure disposition (examination + map entries) |
| [#884](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/884) | [VERIFY] Post-Hire runtime verification: offer → sign → onboarding journey end-to-end |
| [#885](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/885) | S-122: Recruiter post-hire-feedback form — wire it to the real feedback API |
| [#897](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/897) | Analytics correctness: every aggregate traces to a defined, company-scoped population |
| [#898](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/898) | [VERIFY] Recruiter analytics demographic sections: prove the data source or cut the sections |
| [#899](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/899) | Two-sided company analytics: Trust Score distribution + component trends (company-scoped) |

### Surface C — Admin / platform

| Issue | Story |
|---|---|
| [#894](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/894) | [BUG] Migration-238 fresh-DB halt: fresh databases never receive candidate_profiles.bio; migrations ≥239 never apply |
| [#895](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/895) | Admin-route authorisation remainder + public-API key scoping/revocation/audit |
| [#896](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/896) | [VERIFY] Live public-API keys/consumers census + admin page-by-page health on staging |

### Surface D — Public

| Issue | Story |
|---|---|
| [#902](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/902) | Public-claims pass: every capability claim on every public page traced to shipped code or removed |
| [#903](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/903) | [VERIFY] Terms + privacy full text vs the retention design (close read) |
| [#904](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/904) | Pricing page: single plan narrative, shipped only after the pricing ruling + Ledger cost-floor check |
| [#905](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/905) | S-125: Public dead ends — contact form actually sends + footer Privacy/Terms/Help links resolve |

### Surface E — Cross-cutting

| Issue | Story |
|---|---|
| [#881](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/881) | Stripe webhook audit: idempotency + signature verification; tier never applied from client claims |
| [#886](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/886) | Email template completeness audit: every transactional class has template + queue + tracking |
| [#887](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/887) | Chat onto the object-authorisation convention (candidate PII surface) |
| [#888](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/888) | [VERIFY] Email open-tracking disclosure present in the privacy surface |
| [#889](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/889) | S-123: Recruiter communications page — wire it to the real comms backend or retire the surface |
| [#890](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/890) | Retention purge dry-run evidence pack (the record Sumanth's flip decision stands on) |
| [#891](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/891) | Erasure inventory made procedural: new personal-data table without a map entry fails review |
| [#892](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/892) | [VERIFY] DSAR export completeness vs live DB + biometric audit append-only guarantee + consent-middleware generality |
| [#893](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/893) | S-124: Recruiter compliance page — replace the mock with the real compliance API |
| [#906](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/906) | DESIGN.md bootstrap: one gated impeccable `document` run producing Rekrut's DESIGN.md |
| [#907](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/907) | Object-authorisation convention: design + reference implementation + standing review rule |
| [#908](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/908) | Platform-wide auth-only sweep: find every endpoint treating authentication as authorisation |
| [#909](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/909) | S-126: apiCall double-prefix sweep — every '/api/…' call site 404s (questionnaire page, job-applicants panel, QP consent) |
| [#910](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/910) | [VERIFY] Uncounted verification pack: #791 score-distribution impact, trustscore divergence, materialised-view refresh, coach purchaser census |
| [#911](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/911) | [VERIFY] E-signature legal depth vs the PKCS#7 sealing request (#131) |
| [#912](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/912) | [TRACKING] Atlas evidence gates: 15–20 discovery calls + 3–5 paid-pilot commitments before launch (Gate A reopen condition) |
