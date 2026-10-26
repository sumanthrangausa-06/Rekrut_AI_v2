# Build log — #925 hold-lookup failure wording

**Story:** [FOLLOW-UP] Hold-lookup failure wording: 'refused as a precaution' vs 'legal hold active' (Lex R-1 on PR #915)
**Persona:** Nova (implementation); specialist: Lex (legal & compliance) — wording owner.
**Branch:** `nova/925-hold-wording` → dev.

## Problem
When the legal-hold *lookup itself* fails (DB error in `findActiveHold`), the erasure gate fails closed — correctly — throwing `LegalHoldError` with `holdId: null` (`lib/erasureService.js`). But both response paths answered **"Legal hold active … (GDPR Art. 17(3)(e))"**, asserting a verified hold and a legal basis that were never established. The audit payload already carried the honest `null`; only the user/admin-facing wording lied.

## Change (wording only — no behaviour, status-code, schema, or audit-shape change)
Branch on `holdId == null` in the `LEGAL_HOLD` catch paths:
- `routes/auth.js` — DELETE /delete-account: 409 + audit-failure 500.
- `routes/admin.js` — DSAR fulfil: 409 + audit-failure 500 + the `data_requests` conflict note.

Verified hold (`holdId != null`): original wording byte-identical, pinned by tests.

## Lex-confirmed final wording (lookup-failure case)
- Auth 409: "Erasure refused as a precaution: legal hold status could not be verified. Nothing was deleted. Please try again later."
- Auth 500: "Erasure refused as a precaution: legal hold status could not be verified and the conflict could not be recorded in the compliance audit trail. Nothing was deleted. Please retry so the conflict can be recorded."
- Admin 409: "Erasure refused as a precaution: legal hold status could not be verified. Erasure was NOT performed. The conflict has been recorded; verify hold status and re-fulfil."
- Admin 500: "Erasure refused as a precaution: legal hold status could not be verified, and the conflict could not be recorded in the compliance audit trail. Erasure was NOT performed. Retry the fulfilment so the conflict can be recorded."
- Admin note: "Fulfilment blocked <ts>: legal hold status could not be verified — erasure NOT performed as a precaution; conflict recorded in the compliance audit trail."

Lex tests applied: no Art. 17(3)(e) citation when unverified; no hold asserted; nothing-deleted stated; no "release the hold" remedy in the unverified case. Privacy engineer considered and skipped per Lex (wording-only, no new privacy surface).

## Tests
- Red-first: 4 new lookup-failure tests failed on pristine dev; verified-hold pins passed.
- `server/__tests__/routes/auth-delete-account-legal-hold.test.js` — extended with the #925 describe (409/500 × verified/lookup-failure).
- `server/__tests__/routes/admin-dsar-legal-hold-wording-925.test.js` — new, harness shape of `admin-dsar-fulfillment.test.js`, incl. conflict-note assertions.
- Quinn E2E: fresh-install rig, real HTTP through both routes for verified-hold and lookup-failure; user row read back undeleted (evidence on issue #925).
