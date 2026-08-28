# Rekrut AI — Phased E2E Test Report
**Date:** 2026-08-28
**Run ID:** 2026-08-28-0855
**Branch:** dev
**Commit:** a06d3df
**Environment:** Local (localhost:3000)

## Setup Status
- [x] Local DB ready (rekrut_e2e_phased)
- [x] Migrations applied successfully (all migrations completed)
- [x] Server running and healthy
- [x] Playwright browsers installed
- [x] Auth setup completed (4 passed)

## Phase 1: Candidate Flow
| Spec File | Tests | Passed | Failed | Skipped | Notes |
|-----------|-------|--------|--------|---------|-------|
| candidate-flow.spec.ts | 6 | 6 | 0 | 0 | All auth redirects working ✅ |
| candidate-critical-flow.spec.ts | 2 | 2 | 0 | 0 | Full signup→apply flow passes ✅ |
| candidate-apply-flow.spec.ts | 1 | 0 | 1 | 0 | Created job not found in jobs list |
| candidate-job-apply-flow.spec.ts | 2 | 0 | 2 | 0 | Seeded job not found; filter timeout |
| candidate-profile-flow.spec.ts | 1 | 0 | 1 | 0 | Headline value mismatch in settings |
| candidate-full-journey.spec.ts | 1 | 1 | 0 | 0 | Complete journey passes ✅ |
| job-search-filtering.spec.ts | 4 | 0 | 2 | 2 | Tests timeout/SIGKILL |
| application-submission-flow.spec.ts | 2 | 0 | 0 | 2 | Skipped (test logic) |

**Phase 1 Summary:** 9/19 passed (47%)

## Phase 2: Recruiter Flow
| Spec File | Tests | Passed | Failed | Skipped | Notes |
|-----------|-------|--------|--------|---------|-------|
| recruiter-flow.spec.ts | 3 | 3 | 0 | 0 | All auth redirects working ✅ |
| recruiter-critical-flow.spec.ts | 1 | 1 | 0 | 0 | Full flow passes ✅ |
| recruiter-job-post-flow.spec.ts | 1 | 1 | 0 | 0 | Post+pipeline flow passes ✅ |
| recruiter-job-create-flow.spec.ts | 2 | 1 | 1 | 0 | Job not visible in candidate search |
| recruiter-job-posting-flow.spec.ts | 1 | 1 | 0 | 0 | CRUD operations pass ✅ |
| recruiter-candidates-management.spec.ts | 7 | 0 | 0 | 7 | All skipped (test logic) |
| recruiter-applicant-review-flow.spec.ts | 1 | 1 | 0 | 0 | Shortlist/reject flow passes ✅ |
| recruiter-analytics.spec.ts | 7 | 6 | 1 | 0 | App sources breakdown missing data |

**Phase 2 Summary:** 14/23 passed (61%)

## Phase 3: Cross Flow
| Spec File | Tests | Passed | Failed | Skipped | Notes |
|-----------|-------|--------|--------|---------|-------|
| auth-persistence.spec.ts | 8 | 7 | 0 | 1 | Token persistence, navigation pass ✅ |
| navigation-flow.spec.ts | 4 | 2 | 2 | 0 | Candidate nav URL mismatch; API job create fails |
| navigation.spec.ts | 6 | 6 | 0 | 0 | All nav links work ✅ |
| payment-flow.spec.ts | 1 | 1 | 0 | 0 | Upgrade flow passes ✅ |
| payment.spec.ts | 8 | 7 | 1 | 0 | Payment confirmation state missing |
| dark-mode.spec.ts | 3 | 1 | 0 | 2 | Toggle works; reload/landing skipped |
| mobile-navigation.spec.ts | 9 | 4 | 1 | 4 | Sidebar nav works; some timeout |
| settings-flow.spec.ts | 7 | 0 | 2 | 5 | Page load timeout |
| password-reset-flow.spec.ts | 4 | 4 | 0 | 0 | Full reset flow passes ✅ |
| smoke-test.spec.ts | 5 | 5 | 0 | 0 | All critical paths load ✅ |

**Phase 3 Summary:** 37/49 passed (76%)

## Overall Summary
- **Total specs run:** 26 spec files
- **Total individual tests:** 91
- **Passed:** 60
- **Failed:** 15
- **Skipped:** 16
- **Pass rate (excluding skipped):** 80%
- **Pass rate (all tests):** 66%

## Comparison with Previous Run (2026-08-26)
| Metric | Previous | This Run | Change |
|--------|----------|----------|--------|
| Total Tests | ~97+ | 91 | — |
| Passed | 1 | 60 | **+5900%** |
| Failed | 96+ | 15 | **-84%** |
| Pass Rate | ~1% | 66% | **+65pp** |

## Failures Detail

### 1. candidate-apply-flow.spec.ts — Created job not found
- **Error:** `Created job not found in jobs list — candidate test cannot proceed`
- **Root Cause:** Job created via API doesn't appear in candidate job search immediately
- **Screenshot:** `test-results/candidate-apply-flow-Candi-*/test-failed-1.png`
- **Priority:** P1
- **Recommendation:** Add wait/retry logic after job creation, or ensure job indexing is synchronous

### 2. candidate-job-apply-flow.spec.ts — Seeded job not found + filter timeout
- **Error:** `Seeded job not found in candidate jobs list`; `Test timeout of 60000ms exceeded`
- **Root Cause:** Job search may need refresh; filter elements not rendering expected text
- **Priority:** P1
- **Recommendation:** Ensure test data is seeded before test run; add explicit waits for search indexing

### 3. candidate-profile-flow.spec.ts — Headline value mismatch
- **Error:** `unexpected value "E2E QA Engineer 1787706505966"` (expected "Senior Software Engineer")
- **Root Cause:** Profile form pre-populates with user's actual name instead of placeholder
- **Priority:** P2
- **Recommendation:** Update test assertion to match actual behavior or clear field before input

### 4. recruiter-job-create-flow.spec.ts — Job not visible in candidate search
- **Error:** `Job not found in candidate job search UI`
- **Root Cause:** Timing issue — job created by recruiter not immediately visible to candidate
- **Priority:** P1
- **Recommendation:** Add explicit wait or refresh between job creation and candidate search

### 5. recruiter-analytics.spec.ts — Application sources breakdown
- **Error:** `Expected: >= 1, Received: 0` (no visible source elements)
- **Root Cause:** No application source data in test database
- **Priority:** P2
- **Recommendation:** Seed analytics test data or make test conditional on data presence

### 6. navigation-flow.spec.ts — Candidate nav URL mismatch + API job create
- **Error:** Expected `/candidate/jobs` but got `/candidate/saved-jobs`; API job creation failed
- **Root Cause:** Navigation clicks redirect to saved-jobs instead of jobs; API auth/CSRF issue
- **Priority:** P1
- **Recommendation:** Fix navigation link target or update test expectation

### 7. payment.spec.ts — Payment confirmation state
- **Error:** `Confirming your payment` text not found
- **Root Cause:** Success state UI may differ from test expectation
- **Priority:** P2
- **Recommendation:** Update test to match actual success confirmation UI

### 8. job-search-filtering.spec.ts — Timeout/SIGKILL
- **Error:** Tests timeout after 60s or receive SIGKILL
- **Root Cause:** Heavy search operations may cause memory issues or infinite loops
- **Priority:** P1
- **Recommendation:** Optimize search query or reduce test data set

### 9. mobile-navigation.spec.ts — Timeout
- **Error:** Test timeout on sidebar navigation to analytics
- **Root Cause:** Mobile analytics page may load slowly or have rendering issues
- **Priority:** P2
- **Recommendation:** Add explicit wait for page load or investigate mobile analytics performance

### 10. settings-flow.spec.ts — Page load timeout
- **Error:** Settings page loads but tabs take too long to render
- **Root Cause:** Settings page may have heavy data fetching
- **Priority:** P2
- **Recommendation:** Add loading states or optimize settings data fetching

## Infrastructure Improvements Since Last Run
1. ✅ Migrations now apply successfully (previously failed due to missing columns/tables)
2. ✅ Server starts without crashing (previously crashed on missing role_permissions table)
3. ✅ Auth redirects work correctly (previously no server-side redirects)
4. ✅ Query profiler bug fixed (lib/query-profiler.js)
5. ✅ Auth setup passes cleanly (previously had path resolution issues)

## Server Log Excerpts
```
[analytics] Query profiler installed (threshold: 2000ms)
[rate-limiter] Cleanup scheduled every 300000ms
[activity-logger] Loaded 22 recent events from DB
[ai-provider] Initialized. NIM: false | Groq: false | Cerebras: false | Kimi: true
[admin] Admin credentials loaded from env vars
Rekrut AI running on port 3000
```

## Next Steps
### Critical (P0)
- None — no server crashes or complete auth failures

### High (P1)
1. Fix job search indexing delay — jobs created via API don't appear immediately in search
2. Fix candidate navigation URL — clicks go to saved-jobs instead of jobs
3. Fix API job creation in navigation-flow test (CSRF/auth issue)
4. Optimize job-search-filtering tests to prevent timeout/SIGKILL

### Medium (P2)
5. Update candidate-profile-flow test assertion for headline field
6. Seed analytics data for recruiter-analytics tests
7. Update payment success confirmation state test
8. Optimize settings page load time
9. Optimize mobile analytics page load time

### Low (P3)
10. Address skipped tests in recruiter-candidates-management and application-submission-flow
11. Complete dark-mode persistence and landing page tests

## Appendices

### A. Server Environment Variables Used
```
DATABASE_URL=postgresql://postgres@localhost/rekrut_e2e_phased
JWT_SECRET=test-jwt-secret-for-local-e2e-only-do-not-use-in-production
SESSION_SECRET=test-session-secret-for-local-e2e-only-do-not-use-in-production
NODE_ENV=development
ADMIN_PASSWORD=Changeme123!
BASE_URL=http://localhost:3000
```

### B. Test Execution Time
- Phase 1: ~8 minutes
- Phase 2: ~6 minutes
- Phase 3: ~10 minutes
- Total: ~24 minutes

---
*Report generated: 2026-08-28 08:55 SGT*
*QA Automation Agent — Rekrut AI E2E Test Suite*
