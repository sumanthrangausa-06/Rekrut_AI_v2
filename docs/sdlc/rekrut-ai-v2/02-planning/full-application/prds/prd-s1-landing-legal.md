# PRD — S1 (supplementary): Landing, Marketing & Legal Pages

**State (verified, Scout §1/§2): WORKS; one legal-truth defect.** **Surfaces:** static + `routes/docs.js` · client: landing, pricing, blog, about, contact, terms, privacy, biometric-policy.
*Numbering note: Scout's inventory carries this surface as an unnumbered row under the 22 modules; it gets a supplementary PRD because it holds the platform's public legal promises — too load-bearing to fold into another module.*

## 1. Purpose & users
The public face: marketing pages that sell the product, and legal pages (terms, privacy, biometric policy) that make binding representations about it. Users: anonymous visitors, prospects, candidates checking the policy before consenting, counsel/regulators reading what we promised.

## 2. End-to-end journey
Visitor lands → reads product claims → pricing (M16) → signs up (M1). Candidate, before a biometric consent moment, may read the biometric policy — the page the consent flow's honesty depends on.

## 3. Current state (verified)
Pages work. **The defect:** `client/src/pages/biometric-policy.tsx:61` promises a **60-second calibration warm-up baseline** — E-003 calibration is spec-only, zero backing code exists (#777). The privacy/terms pages predate the retention design (policy now: 90 d recordings / 30 d frames — the S-077 alignment fixed the schedule in policy config; public-page wording vs the design's final schedule is #777's family). Marketing claims about AI analysis must also respect the Gate A truth: for January, **no analysis may be claimed anywhere** (CEO-panel amendment 1) — any landing copy implying live Observer analysis is the same defect class as #777.

## 4. Gap to launch-ready
(1) #777: remove/soften the calibration promise, or build E-003 (nobody recommends building it for January — the fix is words). It **blocks any Observer enablement** until resolved. (2) A claims pass over all public copy against shipped truth (Gate A posture, retention schedule, pricing once ruled) — Lex signs the legal pages, Beacon/Candidate Experience read the marketing pages aloud (the S-039 copy-audit pattern applied to public copy).

## 5. Functional requirements
- FR-S1-1: No public page may promise a capability that does not exist in shipped code (the #777 rule, generalised): every capability claim on legal pages traces to a shipped feature or is removed.
- FR-S1-2: The biometric policy page carries the BIPA §15(a) public retention schedule in plain words matching the enforced schedule (90/30 + capture 30-day sub-policy) — wording is Lex-reviewed; the schedule it states must equal M19's enforced one.
- FR-S1-3: Pricing page content ships only after D-M16-1 rules and Ledger's cost-floor check passes (M16 FR gates) — no placeholder prices.

## 6. Non-functional
- Responsive/legal: legal pages must be readable on phones (candidates read them at the consent moment, on the device they're interviewing on).
- Honesty: this surface is where the company's "report that never lies" standard is publicly tested — copy audit is a launch gate, not a polish task.

## 7. Dependencies (verified states)
M19 retention schedule (exists as policy; enforcement is #805's gap) · M16 pricing (**undecided**) · E-003 calibration (**spec-only** — the #777 root).

## 8. Sprint 11 overlap
#777 is a filed Sprint 11 item and an enablement blocker. The wider claims pass (FR-S1-1 remainder) is pre-launch-track scope for Lead/Relay.

## 9. ⚠ Unverified
Terms/privacy pages' full text vs the retention design (only the biometric page was read closely in prior passes); blog/about claim inventory (not swept).

## 10. ▣ DECISIONS FOR SUMANTH
- **D-S1-1:** Fold the full public-claims pass (FR-S1-1) into the **pre-launch checklist** alongside #151/#336/#721?
  **Rex's recommendation: yes.** It is the same species of work — promises reconciled with reality before real customers read them — and it is cheap exactly once, at the same gate.
