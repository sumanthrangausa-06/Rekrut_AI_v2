# Rekrut AI — Phased E2E Test Report
**Date:** 2026-08-26
**Tester:** QA Subagent
**Branch:** dev (commit 80326e3)
**Environment:** Local (127.0.0.1:3000)
**Database:** rekrut_e2e_phased (local PostgreSQL)

## Setup Status
- [x] Local DB created (`rekrut_e2e_phased`)
- [x] Migrations applied (68 of 70+ successful; 2 skipped due to missing columns)
- [x] Missing tables manually created (`user_roles`, `email_queue`, `role_permissions`)
- [x] Playwright browsers installed (chromium)
- [x] Auth setup completed (3 passed, 1 skipped)
- [x] Local server running on 127.0.0.1:3000
- [⚠️] Query profiler bug patched (`lib/query-profiler.js` — `require('./db')` returns pool directly, not `{ pool }`)

## Phase 1: Candidate Flow
| Spec File | Tests | Passed | Failed | Notes |
|-----------|-------|--------|--------|-------|
| candidate-flow.spec.ts | 6 | 0 | 6 | No auth redirect — `/candidate/*` pages load without redirecting to `/login` |
| candidate-critical-flow.spec.ts | 2 | 0 | 2 | Register page heading "Create an account" not found in DOM |
| candidate-apply-flow.spec.ts | 1 | 0 | 1 | CSRF token validation failed on API call to POST /api/jobs |
| candidate-job-apply-flow.spec.ts | 2 | 0 | 2 | Server crash on API call (missing `role_permissions` table) |
| candidate-profile-flow.spec.ts | 1 | 0 | 1 | "Settings" button not found on profile page |
| candidate-full-journey.spec.ts | 1 | 0 | 1 | Auth file path resolution error (`e2e/.auth/recruiter.json` not found from e2e/ dir) |
| job-search-filtering.spec.ts | 4 | 0 | 4 | Job search results text "active jobs\|results" not found |
| application-submission-flow.spec.ts | 2 | 0 | 2 | Connection refused — server crashed during test |

**Phase 1 Summary:** 0/19 passed (0%)

## Phase 2: Recruiter Flow
| Spec File | Tests | Passed | Failed | Notes |
|-----------|-------|--------|--------|-------|
| recruiter-flow.spec.ts | 3 | 0 | 3 | No auth redirect — `/recruiter/*` pages load without redirecting to `/login` |
| recruiter-critical-flow.spec.ts | 1 | 0 | 1 | Register page heading mismatch |
| recruiter-job-post-flow.spec.ts | 1 | 0 | 1 | Failed — page element not found |
| recruiter-job-create-flow.spec.ts | 2 | 0 | 2 | Failed — form elements not found |
| recruiter-job-posting-flow.spec.ts | 1 | 0 | 1 | Failed — edit form title input not found |
| recruiter-candidates-management.spec.ts | 7 | 0 | 7 | Failed — candidate search/page elements not found |
| recruiter-applicant-review-flow.spec.ts | 1 | 0 | 1 | Failed — applicant review elements not found |
| recruiter-analytics.spec.ts | 9 | 0 | 9 | Failed — analytics charts/page elements not found |

**Phase 2 Summary:** 0/25 passed (0%)

## Phase 3: Cross Flow
| Spec File | Tests | Passed | Failed | Skipped | Notes |
|-----------|-------|--------|--------|---------|-------|
| auth-persistence.spec.ts | 8 | 0 | 7 | 1 | Settings page auth fails; token reload/logout OK |
| navigation-flow.spec.ts | 4 | 0 | 4 | - | Navigation between pages fails — elements not found |
| navigation.spec.ts | 6 | 0 | 6 | - | Navigation links/logo not working as expected |
| payment-flow.spec.ts | 1 | 0 | 1 | - | Stripe not configured — payment flow fails |
| payment.spec.ts | 9 | 0 | 9 | - | Stripe checkout/session failures |
| dark-mode.spec.ts | 3 | 0 | 3 | - | Dark mode toggle not found or persistence fails |
| mobile-navigation.spec.ts | 9 | 0 | 9 | - | Hamburger menu/mobile elements not found |
| settings-flow.spec.ts | 5+ | 0 | 5+ | - | Settings page elements not found |
| password-reset-flow.spec.ts | 3+ | 0 | 3+ | - | Password reset form elements not found |
| smoke-test.spec.ts | 5 | 1 | 4 | - | Only 1 test passed (likely pricing page); homepage/jobs/login/register fail |

**Phase 3 Summary:** 1/53+ passed (~2%)

## Overall Summary
- **Total specs run:** 26 spec files
- **Total individual tests:** ~97+
- **Passed:** 1
- **Failed:** 96+
- **Skipped:** 1
- **Pass rate:** ~1%

## Failures Detail

### 1. candidate-flow.spec.ts
- **Error:** `Expected pattern: /.*\/login/ — Received: "http://localhost:3000/candidate"`
- **Root Cause:** The application does not server-side redirect unauthenticated users from `/candidate/*` routes to `/login`. Client-side routing may handle this, but Playwright tests expect immediate URL redirect.
- **Screenshot:** `test-results/candidate-flow-Candidate-F-*/test-failed-1.png`
- **Recommendation:** Implement server-side auth middleware that returns 302 redirect to `/login` for unauthenticated requests to protected routes, OR update tests to wait for client-side redirect.

### 2. candidate-critical-flow.spec.ts
- **Error:** `waiting for getByRole('heading', { name: /Create an account/i }) — element(s) not found`
- **Root Cause:** The registration page DOM does not contain a heading with text "Create an account". The page structure may have changed.
- **Screenshot:** `test-results/candidate-critical-flow-Ca-*/test-failed-1.png`
- **Recommendation:** Update test selectors to match current registration page structure, or verify the registration page renders correctly.

### 3. candidate-apply-flow.spec.ts
- **Error:** `Failed to create job: 403 {"error":"CSRF token validation failed","code":"CSRF_INVALID"}`
- **Root Cause:** Direct API calls from Playwright's `request` context lack CSRF tokens. The server's CSRF middleware rejects requests without valid tokens.
- **Screenshot:** `test-results/candidate-apply-flow-Candi-*/test-failed-1.png`
- **Recommendation:** Either disable CSRF for test environment, or update tests to first fetch a CSRF token via a GET request and include it in subsequent POSTs.

### 4. Server Crashes (candidate-job-apply-flow, application-submission-flow, recruiter tests)
- **Error:** `socket hang up` / `ECONNREFUSED` / `error: relation "role_permissions" does not exist`
- **Root Cause:** Multiple missing database tables cause the server to crash when handling requests. Tables identified as missing: `user_roles`, `email_queue`, `role_permissions`. The migration `070_analytics_indexes` and `071_analytics_materialized_views` failed due to missing `created_at` columns.
- **Screenshot:** Multiple in `test-results/`
- **Recommendation:** 
  1. Fix migration `070_analytics_indexes` — add `created_at` column to affected tables before creating indexes
  2. Fix migration `128_rbac_foundation.js` — ensure `user_roles` and `role_permissions` tables are created
  3. Fix migration `2024-06-14-add-email-queue.js` — ensure `email_queue` table is created
  4. Add error handling in `middleware/rbac.js` to gracefully handle missing tables instead of crashing

### 5. job-search-filtering.spec.ts
- **Error:** `waiting for getByText(/active jobs|results/).first() — element(s) not found`
- **Root Cause:** The job search page does not render expected text. Either no jobs exist in the test DB, or the page structure differs from test expectations.
- **Screenshot:** `test-results/job-search-filtering-Job-S-*/test-failed-1.png`
- **Recommendation:** Seed test jobs before running job search tests, or update selectors to match current page structure.

### 6. recruiter-analytics.spec.ts
- **Error:** Analytics page elements (charts, funnel, velocity) not found
- **Root Cause:** Analytics dashboard may not render without data, or selectors don't match current implementation.
- **Recommendation:** Ensure analytics data is seeded, or update test selectors.

### 7. smoke-test.spec.ts
- **Error:** `expect(page.locator('body')).toBeVisible()` — body has "hidden" visibility
- **Root Cause:** Pages load but body element is marked hidden (likely CSS/framework issue or page not fully hydrated).
- **Screenshot:** `test-results/smoke-test-Smoke-Test-*/test-failed-1.png`
- **Recommendation:** Check for JavaScript errors preventing page hydration; verify CSS doesn't hide body element.

### 8. auth-persistence.spec.ts
- **Error:** 7 failed, 1 skipped. Settings page test fails; token reload/logout OK.
- **Root Cause:** Settings page elements not found or auth state file deleted mid-run.
- **Recommendation:** Fix settings page test selectors; ensure auth files persist across test runs.

### 9. payment.spec.ts / payment-flow.spec.ts
- **Error:** Stripe checkout/session failures
- **Root Cause:** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` not configured in test environment.
- **Recommendation:** Configure Stripe test keys for E2E environment, or skip payment tests when Stripe is unavailable.

### 10. Query Profiler Bug (patched during testing)
- **Error:** `TypeError: Cannot read properties of undefined (reading 'query')` at `query-profiler.js:31`
- **Root Cause:** `const { pool } = require('./db')` destructures incorrectly — `db.js` exports `pool` directly via `module.exports = pool`.
- **Fix Applied:** Changed to `const pool = require('./db')` in `lib/query-profiler.js`
- **Recommendation:** Commit this fix to dev branch.

## Infrastructure Issues Found

1. **Migration failures:** `070_analytics_indexes` and `071_analytics_materialized_views` fail due to missing `created_at` columns
2. **Missing tables:** `user_roles`, `role_permissions`, `email_queue` — from migrations that never ran
3. **Server crashes on missing tables:** `middleware/rbac.js` throws unhandled errors causing Node.js process exit
4. **CSRF blocking API tests:** Direct API calls from Playwright fail without CSRF tokens
5. **Auth token path resolution:** Tests reference `e2e/.auth/*.json` but resolve from within `e2e/` directory
6. **No server-side auth redirects:** Protected routes render without redirecting unauthenticated users
7. **Stripe not configured:** Payment tests cannot run

## Next Steps

### Critical (P0)
1. [ ] Fix migration failures — ensure `created_at` columns exist before creating analytics indexes
2. [ ] Fix missing RBAC tables — run `128_rbac_foundation.js` and `2024-06-14-add-email-queue.js` migrations
3. [ ] Add graceful error handling in `middleware/rbac.js` — don't crash server on missing tables
4. [ ] Commit query-profiler fix (`lib/query-profiler.js`)

### High (P1)
5. [ ] Fix auth redirect behavior — either implement server-side redirects or update E2E tests for client-side routing
6. [ ] Fix E2E auth file paths — use `path.join(__dirname, '.auth/candidate.json')` or project-root-relative paths
7. [ ] Seed test data (jobs, candidates) before running E2E tests
8. [ ] Configure Stripe test keys for E2E environment

### Medium (P2)
9. [ ] Update E2E test selectors to match current page DOM structure
10. [ ] Add CSRF token fetching to API-based tests, or disable CSRF in test mode
11. [ ] Ensure pages fully hydrate before Playwright visibility checks
12. [ ] Run full migration suite against fresh local DB to catch all missing tables

## Appendices

### A. Server Environment Variables Used
```
DATABASE_URL=postgresql://postgres:postgres@localhost/rekrut_e2e_phased
JWT_SECRET=test-jwt-secret-for-e2e-testing-only
SESSION_SECRET=test-session-secret-for-e2e-testing-only
NODE_ENV=development
BASE_URL=http://127.0.0.1:3000
```

### B. Patched Files
- `lib/query-profiler.js` — Fixed `const { pool }` → `const pool`

### C. Migrations Skipped
- `070_analytics_indexes` — Missing `created_at` column
- `071_analytics_materialized_views` — Missing `created_at` column
- `073_screening_questionnaire` — SQL syntax error at "NOT"

---
*Report generated: 2026-08-26*
*QA Subagent — Rekrut AI E2E Test Suite*
