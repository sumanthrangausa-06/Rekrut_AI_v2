# PRD — M17: Post-Hire — Offers, Onboarding, Payroll, E-Signature

**State (verified, Scout §2): BUILT and wired — never ruled in or out of launch scope.** **Surfaces:** `routes/onboarding.js`, `payroll.js` (1,152 lines), `signature.js`, `services/payroll-calculator.js` · client: offers, offer-management, onboarding (both sides), payroll (3 pages), SignDocument.
**This PRD exists to force the scope question (ADR-R9).** Scout takes no position; the decision box below carries Rex's recommendation.

## 1. Purpose & users
Everything after "hired": offer letters and e-signature, onboarding paperwork, and payroll runs. Users: employers (HR/owner), candidates-turned-employees.

## 2. End-to-end journey (in code)
Offer drafted → candidate signs (SignDocument, `signature.js`) → onboarding documents collected → payroll pages run calculations via `services/payroll-calculator.js`. The chain exists end-to-end in code; **runtime health was not verified this pass** (code-traced only).

## 3. Current state (verified)
~4,000+ lines of wired product, the largest surface no launch ruling has ever scoped. January scope per the module-order ruling and Gate A record is the hiring funnel (M1–M16, M18–M22) — M17 appears in none of it. Payroll carries regulatory weight the funnel doesn't: US payroll tax handling and Indian PF/ESI are compliance domains with their own correctness and liability profile (global-hiring-compliance covers them as knowledge; no review of this implementation against them exists). E-signature depth vs #131 (PKCS#7 sealing request) is unverified. **Erasure has never examined M17 records** (Scout §3.4 gap 2) — onboarding documents and payroll records sit outside the erasure map entirely, and payroll records are exactly the class retention law often *requires keeping* — the retention/hold interplay (#799) has never been analysed for this module.

## 4. Gap to launch-ready
The gap is the decision: **in / defer / out.**
- **In:** runtime verification of the full journey, erasure/retention analysis (with counsel-set payroll retention), e-signature depth review vs #131, payroll-calculation review against US + India rules — a real workstream, sized by Lead, competing directly with the launch spine.
- **Defer (built, not launched):** routes/pages exist but are excluded from the January surface (hidden/unlinked, not marketed), with the erasure-coverage question answered in writing anyway (the data exists whether or not the UI ships).
- **Out (dead weight):** formal deprecation path — data model retained for existing rows, surface scheduled for Sage-led removal.

## 5. Functional requirements (any option)
- FR-M17-1: M17 personal data (onboarding documents, payroll records) gets a written retention + erasure disposition — inside M19's map with counsel-set payroll retention periods, or explicitly exempted by a documented legal basis. Silence is the one unacceptable state.
- FR-M17-2: If the surface ships in any form, offer/signature flows are audit-logged (who signed what, when) and payroll calculations display their inputs (no unexplained money numbers — the no-fake-scores honesty rule applied to pay).
- FR-M17-3: Until D-M17-1 rules, no new M17 feature work is scheduled (scope freeze by this PRD).

## 6. Non-functional
- Compliance: payroll is regulated activity in both launch markets; an unreviewed calculator at launch is a liability, not a feature (Ledger + Lex lenses concur).
- Privacy: onboarding documents are M14-class sensitivity (IDs, bank details) — encryption/access posture must match FR-M14-1 if the module is reachable at all.

## 7. Dependencies (verified states)
M6 outcome (`hired`) as entry point (exists) · M19 erasure (**does not cover this module** — gap) · #799 legal hold (building; payroll retention is its strongest use case).

## 8. Sprint 11 overlap
None — and FR-M17-3 keeps it that way until ruled.

## 9. ⚠ Unverified
Runtime health of every M17 journey; e-signature legal depth (#131); payroll-calculator correctness against any jurisdiction's rules; whether any real data exists in M17 tables (needs DB read).

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M17-1: Post-Hire — in / defer / out at launch?**
  **Rex's recommendation: DEFER.** Ship January as the hiring platform the whole launch plan describes; keep M17 built-but-unlaunched (unlinked, unmarketed), with FR-M17-1's written data disposition done pre-launch regardless. "In" buys a second regulated product launch inside the first; "out" destroys working code a post-launch phase will want. Defer is the only option that costs January nothing and keeps the asset.
