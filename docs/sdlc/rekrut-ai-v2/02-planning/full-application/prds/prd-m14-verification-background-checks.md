# PRD — M14: Verification & Background Checks

**State (verified, Scout §2): BUILT + erasure-wired.** **Surfaces:** `routes/verification.js`, `identity-verification.js`, `background-check.js`, `services/document-verification.js` · client: identity-verification, background-check (both sides).

## 1. Purpose & users
Trust checks on candidates: identity verification (government ID + selfie), document verification, and background checks. Users: candidates (submit), recruiters (view status/results within their company's applications).

## 2. End-to-end journey
Recruiter requests / candidate initiates → candidate submits ID + selfie (`verification_requests`) → document verification service processes → status/results visible to the requesting company's recruiters → records live under the retention schedule and are **erasure-covered** (S-076's privacy catch: `verification_requests`, `verification_documents`, `identity_verifications` are all in the erasure DELETE set — government IDs and selfies were the highest-sensitivity find of Sprint 7).

## 3. Current state (verified)
Built end-to-end with the strongest erasure wiring of any PII module. Open scope: productised background-check depth (#132/#133) — the current checks are the platform's own; a fuller BGV product (third-party checks, adverse-action workflow) is unbuilt scope.

## 4. Gap to launch-ready
(1) Confirm the launch posture: identity verification in, background checks at current depth, #132/#133 depth deferred — a scope statement, below. (2) The FCRA boundary: the moment Rekrut *furnishes* check results to employers as a product, the CRA determination (#788, counsel, open) is implicated — the same determination that gates M15's signal. Current in-platform verification (employer-requested, candidate-consented) must stay clearly on the non-CRA side of the line Lex's brief describes, and any #132/#133 expansion waits for counsel.

## 5. Functional requirements
- FR-M14-1: Verification records (gov IDs, selfies) are encrypted at rest, access-scoped to the requesting company, audit-logged on read, and erased per M19 (shipped — regression-protected).
- FR-M14-2: Candidate consent precedes any check; the consent receipt names what will be checked and who sees it (global-hiring-compliance BGV standard; India consent-first default per the DPDP design coverage).
- FR-M14-3: No third-party check furnishing, adverse-action automation, or check-result resale ships before the #788 counsel determination lands.

## 6. Non-functional
- Privacy (privacy-engineer lens): this module holds the platform's most sensitive documents; retention follows the M19 schedules (counsel-confirmed legal bases remain an open counsel item from the retention review).
- Security: document download paths follow M4's encrypted-document pattern (FR-M04-2).

## 7. Dependencies (verified states)
M19 erasure/consent (exists, covers this module) · #788 counsel determination (**open** — gates expansion only, not current operation).

## 8. Sprint 11 overlap
None.

## 9. ⚠ Unverified
Document-verification accuracy/false-accept behaviour (no evaluation exists); whether any background-check result today reaches a surface beyond the requesting company (not swept this pass).

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M14-1: background-check depth at launch.** Current depth (platform verification) vs commissioning #132/#133 productised BGV pre-launch?
  **Rex's recommendation: current depth for launch; #132/#133 post-launch and counsel-gated.** BGV depth is a second product hiding inside this module, and its legal gate (#788) is the same one already blocking M15 — don't stack two counsel-gated builds into the launch window.
