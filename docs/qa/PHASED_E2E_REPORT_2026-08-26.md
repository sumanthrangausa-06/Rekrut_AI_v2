# Rekrut AI — Phased E2E Test Report
**Date:** 2026-08-26
**Phase:** 1 (Candidate Flow)
**Environment:** Local (localhost:3000)

## Phase 1: Candidate Flow Results
| Spec File | Result | Notes |
|-----------|--------|-------|
| candidate-flow.spec.ts | FAIL | 5 failed, 1 skipped — Pages not redirecting to /login when unauthenticated |
| candidate-critical-flow.spec.ts | FAIL | 2 failed — Signup page text not found; registration flow broken |
| candidate-apply-flow.spec.ts | FAIL | 1 failed — Server crashed (socket hang up) during API call to create job |
| candidate-job-apply-flow.spec.ts | FAIL | 2 failed — Missing recruiter.json auth file; job results text not found |
| candidate-profile-flow.spec.ts | FAIL | 1 failed — Settings button not found; test timeout exceeded |
| candidate-full-journey.spec.ts | FAIL | 1 failed — Missing recruiter.json auth file |
| job-search-filtering.spec.ts | FAIL | 4 failed — "active jobs\|results" text not found on all tests |
| application-submission-flow.spec.ts | FAIL | 2 failed — Jobs page heading text not found |

## Phase 1 Summary
- **Total Spec Files:** 8
- **Passed:** 0
- **Failed:** 8
- **Pass Rate:** 0%
- **Total Individual Tests:** 19
- **Tests Passed:** 0
- **Tests Failed:** 19

## Failures

### 1. candidate-flow.spec.ts
- **Error:** Pages not redirecting to login when not authenticated
  - Expected pattern: `/.*\/login/`
  - Received: `http://localhost:3000/candidate` (and similar for /candidate/profile, /candidate/jobs, etc.)
  - Timeout: 5000ms
- **Root Cause:** Unauthenticated candidate routes are not redirecting to /login as expected
- **Screenshots:**
  - `test-results/candidate-flow-Candidate-F-700a1-ogin-when-not-authenticated-chromium/test-failed-1.png`
  - `test-results/candidate-flow-Candidate-F-f7e00-ogin-when-not-authenticated-chromium/test-failed-1.png`
  - `test-results/candidate-flow-Candidate-F-abe7d-ogin-when-not-authenticated-chromium/test-failed-1.png`
  - `test-results/candidate-flow-Candidate-F-f8f0d-ogin-when-not-authenticated-chromium/test-failed-1.png`
  - `test-results/candidate-flow-Candidate-F-d2567-ogin-when-not-authenticated-chromium/test-failed-1.png`

### 2. candidate-critical-flow.spec.ts
- **Error:** Signup page not showing expected text
  - Locator: `getByText(/Create an account|Sign up|Register/i).first()`
  - Expected: visible
  - Timeout: 10000ms
- **Root Cause:** Registration page may have changed or is not loading correctly
- **Screenshots:**
  - `test-results/candidate-critical-flow-Ca-2aacd-ofile-→-search-jobs-→-apply-chromium/test-failed-1.png`
  - `test-results/candidate-critical-flow-Ca-6e52c-ofile-→-search-jobs-→-apply-chromium/test-failed-1.png`

### 3. candidate-apply-flow.spec.ts
- **Error:** Server crashed during API request
  - `apiRequestContext.post: socket hang up`
  - POST `http://localhost:3000/api/jobs`
- **Root Cause:** Server crashed due to missing `role_permissions` table in database
  - Error from server log: `error: relation "role_permissions" does not exist`
- **Screenshot:**
  - `test-results/candidate-apply-flow-Candi-76e60--dashboard-and-applications-chromium/test-failed-1.png`

### 4. candidate-job-apply-flow.spec.ts
- **Error 1:** Missing recruiter auth file
  - `ENOENT: no such file or directory, open 'e2e/.auth/recruiter.json'`
- **Error 2:** Job results text not found
  - Locator: `getByText(/active jobs|results/).first()`
  - Timeout: 15000ms
- **Root Cause:** Auth setup failed to create recruiter.json (CORS errors during setup); jobs page not loading expected content
- **Screenshots:**
  - `test-results/candidate-job-apply-flow-C-6b4d1--and-verify-in-applications-chromium/test-failed-1.png`
  - `test-results/candidate-job-apply-flow-C-b2bdf-rt-jobs-then-apply-to-a-job-chromium/test-failed-1.png`

### 5. candidate-profile-flow.spec.ts
- **Error:** Settings button not found
  - Locator: `getByRole('button', { name: 'Settings' })`
  - Test timeout: 60000ms exceeded
- **Root Cause:** Profile page UI may have changed; Settings button not present
- **Screenshot:**
  - `test-results/candidate-profile-flow-can-21d5f-save-and-verify-persistence-chromium/test-failed-1.png`

### 6. candidate-full-journey.spec.ts
- **Error:** Missing recruiter auth file
  - `ENOENT: no such file or directory, open 'e2e/.auth/recruiter.json'`
- **Root Cause:** Auth setup failed to create recruiter.json
- **Screenshot:**
  - `test-results/candidate-full-journey-Can-61b49-ly-→-verify-in-applications-chromium/test-failed-1.png`

### 7. job-search-filtering.spec.ts
- **Error:** Job results text not found on all 4 tests
  - Locator: `getByText(/active jobs|results/).first()`
  - Timeout: 15000ms
- **Root Cause:** Jobs page not loading expected content; possibly no jobs in database or UI changed
- **Screenshots:**
  - `test-results/job-search-filtering-Job-S-12cff-d-and-verify-results-update-chromium/test-failed-1.png`
  - `test-results/job-search-filtering-Job-S-5116e-by-job-type-and-remote-type-chromium/test-failed-1.png`
  - `test-results/job-search-filtering-Job-S-32796--newest-and-salary-high-low-chromium/test-failed-1.png`
  - `test-results/job-search-filtering-Job-S-1ccbb-ence-level-and-company-size-chromium/test-failed-1.png`

### 8. application-submission-flow.spec.ts
- **Error:** Jobs page heading text not found on both tests
  - Locator: `getByText(/Find Your Next Opportunity|active jobs|results/i).first()`
  - Timeout: 15000ms
- **Root Cause:** Jobs page not loading expected content
- **Screenshots:**
  - `test-results/application-submission-flo-ae694-verify-in-applications-list-chromium/test-failed-1.png`
  - `test-results/application-submission-flo-fb55d-iles-with-high-completeness-chromium/test-failed-1.png`

## Infrastructure Issues Found

1. **Database Schema Missing:** `role_permissions` table does not exist — caused server crash
2. **Auth Setup Failure:** Recruiter authentication failed during setup (CORS errors in server logs)
3. **Server Stability:** Server crashed during test execution due to missing DB table
4. **CORS Configuration:** CORS errors visible in server logs during auth setup

## Recommendations

1. **Fix database schema:** Run migrations to create `role_permissions` table
2. **Fix auth redirects:** Ensure unauthenticated users are redirected to /login for protected routes
3. **Fix registration page:** Verify signup page loads with expected content
4. **Fix jobs page:** Ensure jobs page loads with expected "active jobs" or "results" text
5. **Fix auth setup:** Resolve CORS issues to allow recruiter auth setup to complete
6. **Fix profile page:** Verify Settings button is present and accessible
