# PRD — M1: Auth & Accounts

**State (verified, Scout §2): WORKS.** **Surfaces:** `routes/auth.js` (1,825 lines) · client: login / register / forgot / reset / admin-login.

## 1. Purpose & users
Identity for everyone: candidates, recruiters/employers, hiring managers, platform admins. Every other module's authorisation starts here.

## 2. End-to-end journey
Register (email/password, or Google/LinkedIn OAuth for job-seekers) → signed-JWT-state OAuth flow (iOS-WebKit-proof) → JWT issued → role dashboard → token refresh → password reset via email (M18). Employer OAuth signup is **blocked in code as ruled** (`routes/auth.js:916`, `:1173` → `/register?role=recruiter&oauth_employer_blocked=true`); employers register by email/password with company creation + domain enforcement (M2).

## 3. Current state (verified)
Email/password + OAuth both live; role CHECK allows `candidate, recruiter, employer, admin, hiring_manager` (migration 047). Refresh-token revocation exists (used by the #336 cleanup SQL pattern).

## 4. Gap to launch-ready
Small: post-auth redirect latency (#105, 6.1 s), E2E auth-suite friction (#184/#185, test-side), and the pre-launch removal of the two QA test-admin accounts (205/206 — ruled deferred, pre-launch track).

## 5. Functional requirements
- FR-M01-1: OAuth remains job-seeker-only; the employer block must not regress (regression test on both providers).
- FR-M01-2: Role assignment at registration must match the resolved #766 role model (M2 decision) — no role value may exist that RBAC cannot map.
- FR-M01-3: Password reset and refresh-token revocation remain functional end-to-end on staging before launch (M18 email dependency verified behaviourally, not assumed).

## 6. Non-functional
- Security: signed JWT state for OAuth (shipped pattern) is the required pattern for any new provider.
- Responsive: auth pages must pass the whole-app device matrix (phone/tablet/laptop) — no auth-specific exceptions.
- Privacy: no change to data collected at registration without a consent-receipt path (M19).

## 7. Dependencies (verified states)
M2 (role model — **decision-blocked**, #766) · M18 email delivery (exists; staging behaviour **unverified**) · M20 admin login surface (exists).

## 8. Sprint 11 overlap
None.

## 9. ⚠ Unverified
OAuth round-trip timing on staging (#105 was measured where?); refresh-token behaviour under the shared staging/prod DB.

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M01-1:** None new — the #766 role decision lives in PRD-M02 and binds this module's FR-M01-2.
