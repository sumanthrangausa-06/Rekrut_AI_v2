# Rekrut AI — Application Overview (Architecture & Current State, 2026-10-13)

**Phase:** 2-Planning (full-application pass). **Author:** Rex. **Basis:** Scout's full-application relearn, verified against `origin/dev` @ `48454fea`; runtime-proven items credited to the S-088 audit (local Postgres + local server, fixtures). **Environment caveat (applies to everything below):** this VM cannot reach Neon/R2/B2 over TLS — no real-DB or staging verification was possible; staging shares the production DB by Sumanth's design, and migrations run at boot via `render.yaml`, so **every promotion is a production-schema event** (ADR-R7).

---

## 1. System overview

Rekrut AI is a two-sided hiring platform (candidates free; employers/recruiters pay — pricing model ruled 2026-10-10, pricing *decision* still open, see M16) with a unified interview engine at its centre. Monolith shape: one Express server (74 route mounts; 65 route files in `routes/`, 7 in `server/routes/`), 45 libs, 25 services, ~230 tables across 153 migrations, a React client (143 pages, Tailwind + shadcn-style primitives, CSS-variable theming), LiveKit for live media, self-hosted Whisper for audio, Brevo for email, Stripe (hand-rolled fetch integration) for billing, and R2/B2 dual object storage behind `lib/file-storage.js`.

**Shape judgement (Rex):** the monolith is the right shape for a pre-launch, one-team product — no decomposition is recommended. The structural risks are local, not architectural: two god-files (`routes/candidate.js` 5,715 lines; `routes/admin.js` 2,534 lines) concentrate change-risk, and authorisation is hand-rolled per router (see §5.1). Both are managed as module-level requirements, not platform rewrites.

## 2. Module map (22 modules, code-defined — Scout §1)

| # | Module | State in one line |
|---|--------|-------------------|
| M1 | Auth & Accounts | Works; OAuth employer-block live per ruling |
| M2 | Companies, Teams & RBAC | Works; role model drifted — decision open (#766) |
| M3 | Jobs & Careers | Works end-to-end |
| M4 | Candidates & Profiles | Works; god-file structural risk |
| M5 | Career Coach & Candidate AI Tools | Built; several endpoints mock-grade — launch-scope question |
| M6 | Applications & Pipeline | Works WITH 3 runtime-proven P0 authorisation holes (Sprint 11 spine) |
| M7 | Matching & Discovery | Works; open P1 bug cluster (#405/#414/#416) |
| M8 | Interviews — Session Engine | Works; the unified core |
| M9 | AI Interview & Screening | Works; analysis hand-rolled inline per feature |
| M10 | Human Interviews, Panels & Recordings | Works (presence path); two parallel scorecard systems |
| M11 | AI Observer & Integrity | Presence-only works; capture built DORMANT; analysis chain spec-only (Gate A) |
| M12 | Scoring — OmniScore (two-sided), Fit, Trust | Documented model is two-sided + per-pairing; code = one global candidate score on wrong inputs (#791/#793) + fragments (role_scores, TrustScore, mutual fit) |
| M13 | Assessments & Coding | Built; Feb-2026 breakage cluster partially stale — verification debt |
| M14 | Verification & Background Checks | Built; erasure-wired |
| M15 | Threat-Intel | ABSENT — zero code; spec + dark-chassis stories only |
| M16 | Billing & Subscriptions | Checkout wired; metering absent; pricing undecided |
| M17 | Post-Hire (Offers/Onboarding/Payroll/E-Sign) | Built and wired; **never ruled in or out of launch scope** |
| M18 | Notifications, Email & Comms | Works; staging email behaviourally unverified |
| M19 | Consent, Privacy & Compliance | Strongest module; purge cannot arm (#805) + Applications erasure gap (#780) |
| M20 | Admin & Platform Ops | Console exists; path mismatches open; MFA absent (#660) |
| M21 | Analytics & Reporting | Product analytics built; integrity reporting absent (depends on M11 analysis) |
| M22 | Referrals & Introductions | Works with one live break (referral INSERT 500s, #824) |
| S1 | Landing/Marketing & Legal pages | Works; policy page over-promises (#777) |

Per-module detail, journeys, requirements, and decisions: `prds/`.

## 3. Cross-module flows

### 3.1 Candidate journey (end-to-end)
Register (M1, email/OAuth — job-seekers only for OAuth) → profile + documents, encrypted at rest (M4) → discover jobs (M3) / get matched & alerted (M7) → apply (M4 writes → M6 pipeline; **three separate INSERT paths exist**, M6) → assessments (M13) → AI screening / mock practice (M9) → human interview with panels (M8/M10, Observer presence per M11 consent) → score surfaces (M12 — two-sided by design: the candidate sees their own OmniScore and, on company/job surfaces, the **company's OmniScore** as a trust signal, plus per-pairing mutual fit) → offer & post-hire (M17, scope-undecided) — with consent receipts, DSAR and erasure spanning every step (M19), notifications throughout (M18), and optional career-coach tools alongside (M5). Practice (M9) currently feeds the score (M12) **against** the 2026-10-12 ruling — the single most visible code-vs-decision gap in the product (ADR-R1).

### 3.2 Recruiter journey (end-to-end)
Register + company creation with domain enforcement (M1/M2) → invite team (M2) → post jobs (M3) → pipeline & screening sends (M6) → candidate search/preview/invite (M7) → schedule + run interviews, panels score with submit-and-lock (M8/M10) → read reports incl. Observer sections in honest states (M10/M11 via S-039 renderer) → analytics (M21) → billing (M16). The journey **works today except where M6's proven authorisation holes sit inside it** — cross-company mutation (#822) is a recruiter-journey defect, not an edge case.

### 3.3 Data lifecycle (create → store → retain → erase)
Create: forms/uploads across M3/M4/M6/M9/M10/M14/M17. Store: Postgres (~230 tables) + R2/B2 objects, envelope-encrypted where biometric/document class (per-candidate DEKs; `lib/biometricCrypto.js`, `lib/document-crypto.js`). Retain: policy 90 d recordings / 30 d frames / 24 mo inactive embeddings (S-077 design) enforced by a purge cron that **cannot currently arm** (ADR-R3, #805) and has never been switched live (`RETENTION_PURGE_LIVE` — Sumanth's flip). Erase: DSAR endpoint + `erasureService.js` — 31 table DELETEs + storage-deletion ledger for the interview/candidate/scoring/verification/observer families; **Applications (#780 family) and Post-Hire/Payroll (unexamined) are outside it**. Legal hold: being built in Sprint 11 (#799) as the brake that must precede any deletion-widening.

## 4. Reverse ADRs — resolved into decisions or open questions

| ADR | Substance | Resolution in this set |
|-----|-----------|------------------------|
| R1 | Practice feeds OmniScore vs ruled OUT (2026-10-12) | **Decided** (Sumanth) — requirement in M12 PRD (#791/#792); code gap tracked there |
| R2 | Evaluation pipe reads a table the engine never reads (#793) | **Decided as defect** — fix requirement in M12 PRD; sequencing is Lead's (Sprint 11 D1 placed it inside Sprint 11) |
| R3 | Retention purge can never arm (`NODE_ENV` gate, #805) | **Requirement** in M19 PRD (DB-identity check replaces env gate, per Rex's S-077 follow-up); the `RETENTION_PURGE_LIVE` flip stays Sumanth's separate decision |
| R4 | Two scorecard systems; panel premise corrected (panels had submit-and-lock all along) | **Open ownership question** — M10 PRD boxes it; S-093 (#810) owns the AI-gate + resolver layer in Sprint 11 sequencing |
| R5 | `employer` role with no RBAC entry; recruiter holds owner powers (#766) | **Open decision** — M2 PRD boxes Rex's 2026-10-11 recommendations for Sumanth's ruling |
| R6 | Phase-2 decision: separate Record / Observer toggles (#334) vs shipped single `observer_enabled` | **Open decision** — M11 PRD boxes it (implement the split, or formally revoke #334) |
| R7 | Staging = production DB + migrations at boot | **Decided** (2026-10-13, Sprint 11 D2): promotion is a gated production event — frozen `dev`, Relay checklist, Sumanth's gate; carried as an M20/release requirement |
| R8 | PRD promised Observer analysis; Gate A deferred it | **Decided** (Gate A amended) — closing in writing via Aria's PRD amendment (PR #816, at Sumanth's gate); M11 PRD encodes the amended scope; #777 owns the public-page promise. **Further amended 2026-10-13:** Sumanth adopted the tiered Observer model (Tier 3 consented assessment / Tier 1+2 no-media presence + combined human feedback / Tier 0 human-only) — the S-046 position is amended for Tier 1 presence only; analysis/capture stay default-deny under the re-entry contract; counsel C-04/C-05 open (PRD-M11 §8) |
| R9 | Post-Hire exists in code; no launch ruling scopes it (~4,000+ lines) | **Open decision — forced by this set** — M17 PRD boxes in / defer / out with consequences of each |
| R10 | Test data: "remove before launch" AND "needed until launch" | **Decided as pre-launch track** — #151/#336/#721 reconcile on the pre-launch checklist (M20 PRD + release requirements); no early deletion |
| R11 | OmniScore is two-sided + per-pairing (documented design: candidate score with role/company-specific context + company score + mutual fit) vs code computes one global candidate score, with the pairing pieces as disconnected fragments (role_scores unconnected, company score under a separate "TrustScore" name, global-not-per-role percentile) | **Open decisions** — Sumanth confirmed the two-sided per-pairing definition 2026-10-13; naming (D-M12-3) and the completion scope (D-M12-4) are boxed in PRD-M12; #791/#792/#793 fix the candidate composite's inputs only and do **not** cover the pairing remainder |

## 5. Cross-cutting findings (load-bearing for Lead's planning)

### 5.1 Authorisation inconsistency is the platform's repeatable defect class
The good pattern exists (`requireRecruiter`, `requireCompanyOwnerOrRecruiter`, `verifyPanelMember` — object-level checks). The failure mode is per-router hand-rolling: M6 produced three runtime-proven object-level holes; M7 #416 bypasses soft-delete/opt-out; #821's siblings show **auth-only endpoints treated as authorisation** (audit export). Requirement (M6/M20 PRDs): adopt one object-authorisation convention for candidate/company-scoped reads and apply it router-by-router as stories land — a convention decision for Rex/Lead, not a big-bang rewrite.

### 5.2 Erasure coverage is a map, and two territories are blank
Covered: interviews, candidates/profiles, scoring, verification, observer. Blank: **Applications** (#780/#813/#829 — Sprint 11) and **Post-Hire/Payroll** (never examined — decision + likely story, M17/M19 PRDs).

### 5.3 Test reality
Jest's first real execution was 2026-10-13 (Quinn's ledger: 1,201 tests, 0 product bugs; capture mirror suites don't execute — #817; lockfile drift — #818). Before that: custom harnesses + mocked suites only. Real-DB integration is impossible from this VM; **staging QA is the only real-DB confirmation path**, and it is a production-schema event (§1 caveat). Every PRD's acceptance inherits this: mocked-suite green is necessary, never sufficient, evidence.

### 5.4 No DESIGN.md exists
Searched this pass — none anywhere. UI work pulls `impeccable`/taste/Vercel guidance per-task with no project design anchor. The bootstrap (one gated `impeccable document` run producing Rekrut's DESIGN.md) is a **decision in this set**; UI-heavy PRDs name the design-intake skills as their method and mark which of their requirements are provisional until DESIGN.md exists.

### 5.5 Environments & deploy
Render: `rekrutai-dev`, `rekrutai-staging` (free tier, no shell), `rekrutai-prod`. Deploys manual; migrations at boot. Pending deploy items when promotion happens: migrations **252–257** and Lex's C-L3 (jest first run — discharged in part 2026-10-13; the capture-mirror remainder is #817 and remains promotion-blocking for the S-085 code).

## 6. What this overview supersedes

- The v2 knowledge base's interview-engine-scoped module picture (Scout §6) — this set is whole-application.
- `02-planning/unified-interview-engine/prd.md` remains the interview-engine PRD of record, **except** the lines named in the M9/M11/M12 PRDs (notably §5.1's practice rows — see PRD-M09 §8 and PRD-M12 §8); Aria's PR #816 is the amendment vehicle for that file and is not duplicated here.
- Legacy phase epics (#94/#95/#102/#108/#116/#123/#130/#137) are un-reconciled history (Scout §3.3); the Phase-3 epic set (#631–#639) is canonical.
