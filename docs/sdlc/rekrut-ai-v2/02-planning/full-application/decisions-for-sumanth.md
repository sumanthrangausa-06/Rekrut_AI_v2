# Decisions for Sumanth — Full-Application Pass (2026-10-13)

Every question the documentation + PRD set needs answered, consolidated. Each carries **Rex's recommendation** (marked as Rex's — the ruling is Sumanth's). Nothing here re-opens a ruling already made; ruled items are listed at the end for the record.

## A. Launch-scope decisions (what January is)

| # | Question | Rex's recommendation | Lives in |
|---|----------|----------------------|----------|
| D-M17-1 | **Post-Hire (M17) — in / defer / out at launch?** ~4,000 lines built, never scoped; payroll is regulated; erasure never examined it | **Defer** — built but unlaunched (unlinked, unmarketed); written data disposition pre-launch regardless | PRD-M17 |
| D-M05-1 | **Career Coach (M5) — in / in-with-mocks-cut / out?** Several endpoints mock-grade | **In, with mock-grade surfaces cut or labelled** | PRD-M05 |
| D-M16-1 | **Pricing model** — Atlas+Ledger A (credits) / B (seats) / C (success fee — Ledger fails it) / D (hybrid); plus memo §8 inputs (beachhead, India INR test, pilot cap…) | **A for the founding cohort → D on the memo's trigger**; January revenue planned at $0 until paid pilots convert | PRD-M16 |
| D-M21-1 | E-006 report products (#683 recruiter full report, #684 candidate qualitative) — January or post-launch? | **Post-launch** | PRD-M21 |
| D-M14-1 | Background-check depth — current platform verification, or productised BGV (#132/#133) pre-launch? | **Current depth**; #132/#133 post-launch and counsel-gated (#788) | PRD-M14 |

## B. Model & integrity decisions (how the product works)

| # | Question | Rex's recommendation | Lives in |
|---|----------|----------------------|----------|
| D-M02-1 | **Role model (#766)** — Rex's 2026-10-11 package: strip recruiter's company-admin powers; retire `employer` → migrate to `owner`; never conflate platform `admin` with company `owner`; only `owner` invites | **Adopt all four as one ruling** | PRD-M02 |
| D-M10-1 | **Scorecard split-brain end-state** — panels vs migration-125 tables; who owns reconciliation | **Panels canonical**; 125 deprecated in writing now, dropped post-launch (Sage); S-093 stays gate+resolver; Lead files the follow-up | PRD-M10 |
| D-M11-1 | **Toggle split (#334)** — Phase 2 decided separate Record/Observer toggles; code ships one | **Formally revoke the split for launch**; single toggle + consent gate stands | PRD-M11 |
| D-M12-1 | Trust-score duplication (#175) — delete `trustscore-standalone.js`? | **Delete after a one-pass caller check** | PRD-M12 |
| D-M04-1 | `candidate.js` god-file extraction — schedule post-launch (Sage) or leave indefinitely? | **Post-launch, Sage-led**, after Applications stabilises | PRD-M04 |

## C. Risk & gate decisions (what protects the launch)

| # | Question | Rex's recommendation | Lives in |
|---|----------|----------------------|----------|
| D-M20-1 | **Admin MFA (#660) — required before launch, or accepted risk?** Admin reaches the whole production DB (shared-DB architecture) | **Required before launch** (TOTP on admin login; small bounded build) | PRD-M20 |
| D-M19-1 | **Flip `RETENTION_PURGE_LIVE`** after #805's arming fix verifies (dry-run on record first)? | **Yes — arm it, in that order, before launch** (the flip remains Sumanth's manual act) | PRD-M19 |
| D-M13-1 | Coding sandbox audit (#118) — pre-launch gate for coding assessments, or fast-follow? | **Gate it** (aptitude/questionnaire unaffected) | PRD-M13 |
| D-M09-1 | Screening-sessions transcript over-send — fix S-087-style as its own story, or accept for launch? | **Fix it before launch** (same defect class Sumanth already ruled "fix it" on) | PRD-M09 |
| D-S1-1 | Full public-claims pass (no page promises what doesn't exist) — into the pre-launch checklist with #151/#336/#721? | **Yes** | PRD-S1 |

## D. Process/design decision

| # | Question | Rex's recommendation | Lives in |
|---|----------|----------------------|----------|
| D-DESIGN-1 | **DESIGN.md bootstrap** — no DESIGN.md exists; the design intake named one gated `impeccable document` run as the shared prerequisite for all UI work. Run it (one-time, gated, produces Rekrut's own DESIGN.md from the shipped UI), and if so, when — before Sprint 12's UI-heavy work? | **Run it, scheduled before the next UI-heavy build phase** (Sprint 12 planning at the latest). Until then, UI PRD sections that depend on design decisions are provisional; `impeccable`/taste/Vercel remain the per-task method (S-039 precedent) | Overview §5.4; set README |

## Already ruled — recorded here so the set visibly does not reopen them

- Gate A = B amended (cohort-only presence-only Observer; dormant capture built; re-entry contract with 2026-11-01 / 2026-12-01 checkpoints; slice-by-slice measurement; body language out; deception claims banned) — #634.
- Mock scores: practice OUT of OmniScore + readiness panel (#791); practice-fact marker with six guardrails (#792); removal scheduled separately (Sprint 12 lead pair per Sprint 11 D1; #793 inside Sprint 11).
- Module order: Interview → Applications (Sprint 11, building) → then per Sumanth's direction from this set.
- Threat-intel narrowed v1 approved; signal dark until #788; **no outreach to anyone** (counsel track paused by Sumanth, 2026-10-13).
- EU launch postponed — USA + India at launch.
- Sprint 11 plan approved incl. D1 (OmniScore pair → Sprint 12) and D2 (promotion out of sprint; Relay-owned gated production event).
- Pre-launch track parked by ruling: #151 test-data purge, #336 accounts 205/206, #721 R2 plaintext run.
