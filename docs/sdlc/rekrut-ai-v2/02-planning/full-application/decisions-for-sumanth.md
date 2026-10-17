# Decisions for Sumanth — Full-Application Pass (2026-10-13)

Every question the documentation + PRD set needs answered, consolidated. Each carries **Rex's recommendation** (marked as Rex's — the ruling is Sumanth's). Nothing here re-opens a ruling already made; ruled items are listed at the end for the record.

## A. Launch-scope decisions (what January is)

| # | Question | Rex's recommendation | Lives in |
|---|----------|----------------------|----------|
| D-M17-1 | **Post-Hire (M17) — ✅ RULED by Sumanth 2026-10-13: NOT defer-and-hide.** M17 stays in the product and work continues; any part not completely ready is shown on the platform as **"releasing soon"**. The panel's data-inventory-first amendment applies (written data disposition, FR-M17-1) | **Defer** (built but unlaunched, hidden) — **NOT ADOPTED** | PRD-M17 |
| D-M05-1 | **Career Coach (M5) — in / in-with-mocks-cut / out?** Several endpoints mock-grade | **In, with mock-grade surfaces cut or labelled** | PRD-M05 |
| D-M16-1 | **Pricing model** — Atlas+Ledger A (credits) / B (seats) / C (success fee — Ledger fails it) / D (hybrid); plus memo §8 inputs (beachhead, India INR test, pilot cap…) | **A for the founding cohort → D on the memo's trigger**; January revenue planned at $0 until paid pilots convert | PRD-M16 |
| D-M21-1 | E-006 report products (#683 recruiter full report, #684 candidate qualitative) — January or post-launch? | **Post-launch** | PRD-M21 |
| D-M14-1 | Background-check depth — current platform verification, or productised BGV (#132/#133) pre-launch? | **Current depth**; #132/#133 post-launch and counsel-gated (#788) | PRD-M14 |

## B. Model & integrity decisions (how the product works)

| # | Question | Rex's recommendation | Lives in |
|---|----------|----------------------|----------|
| D-M02-1 | **Role model (#766)** — Rex's 2026-10-11 package: strip recruiter's company-admin powers; retire `employer` → migrate to `owner`; never conflate platform `admin` with company `owner`; only `owner` invites | **Adopt all four as one ruling** | PRD-M02 |
| D-M10-1 | **Scorecard "split-brain" — ✅ RESOLVED 2026-10-13 (premise falsified on verification).** Panels and migration-125 are ONE system (`routes/panels.js` serves the 125 tables incl. submit-and-lock); no second system, nothing to deprecate. The genuine remainder is report consumption — S-093 (#810), re-scoped at STOP 1 | **Panels canonical; deprecate 125** — **NOT ADOPTED** (premise false; Rex conceded on the record) | PRD-M10 |
| D-M11-1 | **Toggle split (#334)** — Phase 2 decided separate Record/Observer toggles; code ships one | **Formally revoke the split for launch**; single toggle + consent gate stands | PRD-M11 |
| D-M12-1 | Trust-score "duplication" (#175) — ✅ **RESOLVED 2026-10-13 (premise falsified).** `trustscore.js` is the LIVE company-score engine; `trustscore-standalone.js` is a deliberately separate supplementary-metrics service with its own live endpoint. **Nothing is deleted**; #175 closes as a false premise | **Delete after a one-pass caller check** — **NOT ADOPTED** (the check was run; it falsified the premise) | PRD-M12 |
| D-M12-3 | **OmniScore naming — ✅ RULED by Sumanth 2026-10-13: unification REJECTED.** Names stay split by side: candidate score = **OmniScore**; company/recruiter score = **Trust Score** — one scoring system/architecture, role-specific scores. This refined ruling supersedes Sumanth's earlier same-day "both called OmniScore" phrasing | **Unify as OmniScore** (candidate / company) — **NOT ADOPTED** (kept for decision history) | PRD-M12 §11 |
| D-M12-4 | **Two-sided completion scope** — documented per-pairing intent (company-specific candidate scores, role-connected composite, per-role peer percentile) is fragmentary in code and NOT covered by #791/#792/#793. In as a workstream / defer as named post-launch scope / drop? | **Defer as named, decided post-launch scope** — recorded as committed direction, not rushed into the launch window | PRD-M12 §4, §11 |
| D-M12-5 | Peer-percentile cohort — global today, design says per-role | **Fold into D-M12-4** (no separate half-decision) | PRD-M12 §11 |
| D-M06-2 | Candidate sees mutual fit / company score **on their application view** per application? (docs silent) | **Show it, once #791/#793 correct the inputs** | PRD-M06 |
| D-M07-1 | Company Trust Score in candidate-facing **ranking**, or display-only? (docs silent) | **Display-only at launch** (badges/company page), no ranking weight until the Feedback input's data supply is verified | PRD-M07 |
| D-M04-1 | `candidate.js` god-file extraction — schedule post-launch (Sage) or leave indefinitely? | **Post-launch, Sage-led**, after Applications stabilises | PRD-M04 |

## C. Risk & gate decisions (what protects the launch)

| # | Question | Rex's recommendation | Lives in |
|---|----------|----------------------|----------|
| D-M20-1 | **Admin MFA (#660) — ✅ RULED by Sumanth 2026-10-13: agreed, to be integrated, deferred to later — "not the priority now."** Integration needs from Sumanth: enrol his own admin account when scheduled (TOTP, $0) | **Required before launch** — **NOT ADOPTED on timing** (the panel's hard-blocker hardening set aside by the same ruling; the panel warning stands on record) | PRD-M20 |
| D-M19-1 | **Flip `RETENTION_PURGE_LIVE`** after #805's arming fix verifies (dry-run on record first)? | **Yes — arm it, in that order, before launch** (the flip remains Sumanth's manual act) | PRD-M19 |
| D-M13-1 | Coding sandbox audit (#118) — pre-launch gate for coding assessments, or fast-follow? | **Gate it** (aptitude/questionnaire unaffected) | PRD-M13 |
| D-M09-1 | Screening-sessions transcript over-send — fix S-087-style as its own story, or accept for launch? | **Fix it before launch** (same defect class Sumanth already ruled "fix it" on) | PRD-M09 |
| D-S1-1 | Full public-claims pass (no page promises what doesn't exist) — into the pre-launch checklist with #151/#336/#721? | **Yes** | PRD-S1 |

## D. Process/design decision

| # | Question | Rex's recommendation | Lives in |
|---|----------|----------------------|----------|
| D-DESIGN-1 | **DESIGN.md bootstrap** — no DESIGN.md exists; the design intake named one gated `impeccable document` run as the shared prerequisite for all UI work. Run it (one-time, gated, produces Rekrut's own DESIGN.md from the shipped UI), and if so, when — before Sprint 12's UI-heavy work? | **Run it, scheduled before the next UI-heavy build phase** (Sprint 12 planning at the latest). Until then, UI PRD sections that depend on design decisions are provisional; `impeccable`/taste/Vercel remain the per-task method (S-039 precedent) | Overview §5.4; set README |

## Already ruled — recorded here so the set visibly does not reopen them

- **Score naming (Sumanth, 2026-10-13)** — OmniScore = the candidate score; Trust Score = the company/recruiter score; one system, role-specific scores; name unification rejected (D-M12-3).
- **Post-Hire (Sumanth, 2026-10-13)** — M17 stays in the product, work continues; unfinished parts shown as "releasing soon," never defer-and-hide (D-M17-1); data-inventory-first amendment applies.
- **Admin MFA (Sumanth, 2026-10-13)** — agreed and integrable, deferred to later on his explicit scheduling call ("not the priority now"); Rex's required-before-launch recommendation and the panel's hard-blocker hardening recorded as not adopted on timing, panel warning standing (D-M20-1).
- **Careers-page fabricated company score — fix approved (Sumanth, 2026-10-13)** — strip the `|| 75` fallback, suppress the public score until it has a basis; filed as S-111/#836 (PRD-M12 §5).
- **Scorecard premise (panel verification, 2026-10-13)** — panels and migration-125 are one system; nothing to deprecate; S-093 (#810) re-scopes at STOP 1 to report consumption (D-M10-1).
- **Trust-score "duplication" (#175) — false premise (2026-10-13)** — `trustscore.js` is the live company engine; the standalone file is a separate supplementary-metrics service; nothing is deleted (D-M12-1).
- **Stripe keys correction (verified 2026-10-13)** — staging's secret is TEST class today (#98's live claim was true 2026-08-08; test keys applied Oct 3/Oct 7; remaining scope is behavioural verification only); production's secret is also TEST class — live keys required at launch (#837) (PRD-M16 §3).
- Gate A = B amended (cohort-only presence-only Observer; dormant capture built; re-entry contract with 2026-11-01 / 2026-12-01 checkpoints; slice-by-slice measurement; body language out; deception claims banned) — #634.
- **Tiered Observer model (Sumanth, 2026-10-13, "i want all three")** — ONE system, three tiers by candidate consent state: Tier 3 = consented AI assessment (per-input-class artefact; voice/face under the Gate A contract + C-05); Tier 1+2 = no-media presence (notice + objection path) + post-lock composer producing one combined qualitative candidate report from HUMAN materials; Tier 0 = presence objected → human-only. This **amends the S-046 default-deny position for Tier 1 presence only**; analysis/capture remain default-deny; objection is never a signal; human interviewer blind until scorecard lock; recruiter sees both components + discrepancies (defaults in PRD-M11 §10). Counsel C-04/C-05 remain open — PRD-M11 §8, #788.
- Mock scores: practice OUT of OmniScore + readiness panel (#791); practice-fact marker with six guardrails (#792); removal scheduled separately (Sprint 12 lead pair per Sprint 11 D1; #793 inside Sprint 11).
- Module order: Interview → Applications (Sprint 11, building) → then per Sumanth's direction from this set.
- Threat-intel narrowed v1 approved; signal dark until #788; **no outreach to anyone** (counsel track paused by Sumanth, 2026-10-13).
- EU launch postponed — USA + India at launch.
- Sprint 11 plan approved incl. D1 (OmniScore pair → Sprint 12) and D2 (promotion out of sprint; Relay-owned gated production event).
- Pre-launch track parked by ruling: #151 test-data purge, #336 accounts 205/206, #721 R2 plaintext run.
