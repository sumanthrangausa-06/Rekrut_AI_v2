# PRD — M20: Admin & Platform Ops

**State (verified, Scout §2): PARTIAL.** **Surfaces:** `routes/admin.js` (2,534 lines), `api-keys.js`, `public-api.js`, `audit.js`, `health.js`, `docs.js` · client: 11 admin pages (dashboard, agents, ai-health, analytics, revenue, compliance, biometric-audit, email-queue…).

## 1. Purpose & users
The operator's console: platform administration, API keys + public API, audit access, health. Users: platform admins only (Sumanth + operators) — explicitly **not** company owners (that conflation is M2's #766 defect).

## 2. End-to-end journey
Admin logs in (separate admin login, M1) → console pages call admin routes → operators manage users/companies, review compliance + biometric audit, monitor AI health and revenue, manage API keys.

## 3. Current state (verified)
Console exists and mostly works. Open items: **#254** (admin endpoint path mismatches — pages calling paths that don't resolve as expected), **MFA absent** for admin accounts (#660/S-055), and the P0 #336 residue: the self-registration mint path was closed in code 2026-10-06 (`f1bca66d`); the remaining exposure is two QA test-admin accounts (205/206) in the shared production DB — cleanup **deferred to pre-launch by Sumanth's ruling**.

## 4. Gap to launch-ready
#254 disposition (per-item verify-then-fix, Feb-cluster discipline); the MFA decision (below); the pre-launch cleanup execution (#336 accounts + #151 test-data purge + #721 R2 plaintext run — one reconciled pre-launch checklist, executed from a networked environment, with the #721 JSON report saved as BIPA §15(a) evidence).

## 5. Functional requirements
- FR-M20-1: Admin surfaces are platform-admin-only, enforced server-side per route (the M6 lesson: auth-only is not authorisation — the `/audit/export` sibling found in #821's family is this module's own instance and closes under M6's convention work).
- FR-M20-2: Every admin page's calls resolve against real routes (contract pass closing #254 item by item, evidenced).
- FR-M20-3: The pre-launch cleanup is one checklist, one execution window, one evidence pack: #151 test-data purge, #336 accounts 205/206 (excluding `sumanth@rekrutai.co`), #721 deletion run + report. Nothing on it executes early (ADR-R10: test data is load-bearing until launch).
- FR-M20-4: Public API keys are scoped, revocable, and audit-logged; the public API follows the same object-authorisation convention as the web app.

## 6. Non-functional
- Security: admin is the highest-value target on the platform; the shared staging/prod DB means an admin compromise is a production compromise (compounds the MFA question).
- Operations: deploys are manual; migrations run at boot (ADR-R7) — promotion follows the D2 discipline (frozen dev, Relay checklist, Sumanth gate; migrations 252–257 pending).

## 7. Dependencies (verified states)
M1 admin auth (exists) · M19 compliance surfaces (exist) · pre-launch execution environment with working TLS to Neon/R2 (**does not exist on this VM** — execution must be scheduled where it does).

## 8. Sprint 11 overlap
None filed; the promotion track (D2) is Relay-owned post-sprint and consumes FR-M20-3's checklist at launch, not in Sprint 11.

## 9. ⚠ Unverified
#254's true live item count; public-API usage (any live keys/consumers?); admin page-by-page health on staging.

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M20-1: admin MFA (#660/S-055) — required before launch, or accepted risk?**
  **Rex's recommendation: required before launch.** Admin access reaches the production database's entire contents through a shared-DB architecture; a single phished password is the whole company. TOTP-based MFA on admin login only is a small, bounded build — the cheapest catastrophic-risk reduction left on the board.
