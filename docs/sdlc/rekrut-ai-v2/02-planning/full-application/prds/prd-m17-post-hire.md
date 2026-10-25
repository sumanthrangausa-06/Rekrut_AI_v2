# PRD — M17: Post-Hire — Offers, Onboarding, Payroll, E-Signature

**State (verified, Scout §2): BUILT and wired.** **Launch scope RULED by Sumanth 2026-10-13: M17 stays in the product and work continues; any part not completely ready is shown on the platform as "releasing soon" (D-M17-1 — not defer-and-hide).** **Surfaces:** `routes/onboarding.js`, `payroll.js` (1,152 lines), `signature.js`, `services/payroll-calculator.js` · client: offers, offer-management, onboarding (both sides), payroll (3 pages), SignDocument.
**This PRD originally existed to force the scope question (ADR-R9)** — ruled 2026-10-13 (§10). The panel's data-inventory-first amendment applies throughout (FR-M17-1).

## 1. Purpose & users
Everything after "hired": offer letters and e-signature, onboarding paperwork, and payroll runs. Users: employers (HR/owner), candidates-turned-employees.

## 2. End-to-end journey (in code)
Offer drafted → candidate signs (SignDocument, `signature.js`) → onboarding documents collected → payroll pages run calculations via `services/payroll-calculator.js`. The chain exists end-to-end in code; **runtime health was not verified this pass** (code-traced only).

## 3. Current state (verified)
~4,000+ lines of wired product — until 2026-10-13 the largest surface no launch ruling had ever scoped. Sumanth's ruling keeps M17 in the product (D-M17-1); §4 states what that means per part. Payroll carries regulatory weight the funnel doesn't: US payroll tax handling and Indian PF/ESI are compliance domains with their own correctness and liability profile (global-hiring-compliance covers them as knowledge; no review of this implementation against them exists). E-signature depth vs #131 (PKCS#7 sealing request) is unverified. **Erasure has never examined M17 records** (Scout §3.4 gap 2) — onboarding documents and payroll records sit outside the erasure map entirely, and payroll records are exactly the class retention law often *requires keeping* — the retention/hold interplay (#799) has never been analysed for this module.

## 4. Gap to launch-ready
The scope question is **ruled** (keep in product — D-M17-1). The remaining gap is launch-readiness **per part**:
- **Parts shipping live in January:** runtime verification of the full journey, erasure/retention analysis (with counsel-set payroll retention), e-signature depth review vs #131, payroll-calculation review against US + India rules — a real workstream, sized by Lead.
- **Parts not ready by January:** they stay **visible in the product with a "releasing soon" surface** (the ruling's words) — never hidden, never marketed as live. The erasure-coverage question (FR-M17-1) is answered in writing anyway: the data exists whether or not the UI ships.

## 5. Functional requirements (any option)
- FR-M17-1: M17 personal data (onboarding documents, payroll records) gets a written retention + erasure disposition — inside M19's map with counsel-set payroll retention periods, or explicitly exempted by a documented legal basis. Silence is the one unacceptable state.
- FR-M17-2: If the surface ships in any form, offer/signature flows are audit-logged (who signed what, when) and payroll calculations display their inputs (no unexplained money numbers — the no-fake-scores honesty rule applied to pay).
- FR-M17-3: M17 work follows the ruling's shape — readiness work (§4) on the parts shipping live, "releasing soon" surfacing on the rest; no part may be presented as live before its §4 readiness items close for that part.

## 6. Non-functional
- Compliance: payroll is regulated activity in both launch markets; an unreviewed calculator at launch is a liability, not a feature (Ledger + Lex lenses concur).
- Privacy: onboarding documents are M14-class sensitivity (IDs, bank details) — encryption/access posture must match FR-M14-1 if the module is reachable at all.

## 7. Dependencies (verified states)
M6 outcome (`hired`) as entry point (exists) · M19 erasure (**does not cover this module** — gap) · #799 legal hold (building; payroll retention is its strongest use case).

## 8. Sprint 11 overlap
None.

## 9. ⚠ Unverified
Runtime health of every M17 journey; e-signature legal depth (#131); payroll-calculator correctness against any jurisdiction's rules; whether any real data exists in M17 tables (needs DB read).

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M17-1: Post-Hire — ✅ RULED by Sumanth 2026-10-13: NOT defer-and-hide.** *"We need to also work on post hire as well. If its not ready completely we can show it on the platform that it will be released soon."* M17 stays in the product and work continues; unfinished parts carry a "releasing soon" surface. The panel's amendments stand with the ruling: Lex's data inventory first (populated payroll tables carry obligations now), and FR-M17-1's written data disposition.
  **Rex's recommendation (DEFER — built but unlaunched, hidden) is recorded as NOT ADOPTED.**
