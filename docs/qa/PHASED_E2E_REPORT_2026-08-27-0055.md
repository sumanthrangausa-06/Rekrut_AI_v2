# Rekrut AI — Phased E2E Test Report
**Date:** 2026-08-27
**Run ID:** 2026-08-27-0055
**Branch:** dev
**Commit:** f4ec01a
**Environment:** Local (localhost:3000)

## Setup Status
- [x] Local DB ready (rekrut_e2e_phased)
- [x] Server running (PID verified, /health returns ok)
- [x] Playwright browsers installed
- [x] Auth setup completed (4/4 passed)

## Phase 1: Candidate Flow
| Spec File | Result | Notes |
|-----------|--------|-------|
| candidate-flow | 6 PASS | All auth redirects work |
| candidate-critical-flow | 2 PASS | Desktop + mobile signup → apply |
| candidate-apply-flow | 1 FAIL | Created job not found in jobs list |
| candidate-job-apply-flow | 2 FAIL | Seeded job not found; filter/sort timeout |
| candidate-profile-flow | 1 FAIL | Headline value mismatch (stale data) |
| candidate-full-journey | 1 PASS | Complete signup → apply journey |
| job-search-filtering | 4 FAIL | All timeout waiting for results text |
| application-submission-flow | 2 SKIP | Conditional skip — no jobs available |

**Phase 1 Summary:** 10/19 passed, 8 failed, 2 skipped

## Phase 2: Recruiter Flow
| Spec File | Result | Notes |
|-----------|--------|-------|
| recruiter-flow | 3 PASS | Auth redirects work |
| recruiter-critical-flow | 1 PASS | Full recruiter pipeline |
| recruiter-job-post-flow | 1 PASS | Job post + pipeline management |
| recruiter-job-create-flow | 1 PASS, 1 FAIL | Job creation OK, visibility to candidate fails |
| recruiter-job-posting-flow | 1 PASS | Create, list, edit, verify |
| recruiter-candidates-management | 7 SKIP | Conditional skip |
| recruiter-applicant-review-flow | 1 PASS | Shortlist, reject, view profile |
| recruiter-analytics | 6 PASS, 1 FAIL | Application sources breakdown empty |

**Phase 2 Summary:** 13/22 passed, 2 failed, 7 skipped

## Phase 3: Cross Flow
| Spec File | Result | Notes |
|-----------|--------|-------|
| auth-persistence | 7 PASS, 1 SKIP | Token persistence, navigation, settings access |
| navigation-flow | 2 PASS, 2 FAIL | Candidate redirect issue; E2E integration API failure |
| navigation | 6 PASS | All nav links work |
| payment-flow | 1 PASS | Upgrade payment end-to-end |
| payment | 8 PASS | All Stripe flows |
| dark-mode | 2 PASS, 1 SKIP | Toggle + persistence |
| mobile-navigation | 9 PASS | All mobile sidebar/nav tests |
| settings-flow | 0 PASS, 5 FAIL | Profile/Account/Notifications/Privacy tabs not found |
| password-reset-flow | 4 PASS | Full forgot → reset → login |
| smoke-test | 5 PASS | Critical paths all green |

**Phase 3 Summary:** 44/55 passed, 7 failed, 2 skipped, 2 did not run (max failures)

## Overall Summary
- Total specs run: 26 files
- Tests passed: 67
- Tests failed: 17
- Tests skipped: 11
- Pass rate: 70.5%
- New GitHub issues created: 4 (#195, #196, #197, #198)
- Existing issues updated: 2 (#188, #190)

## Failures Detail

### 1. Job Visibility to Candidates (Pattern across multiple specs)
- **Specs:** candidate-apply-flow, candidate-job-apply-flow, recruiter-job-create-flow
- **Error:** "Job not found in candidate jobs list" / "not found in candidate job search UI"
- **GitHub Issue:** #188 (updated with new reproduction)
- **Recommendation:** Check job visibility logic — may be status filtering, approval workflow, or caching issue

### 2. Job Search Filtering Timeouts
- **Spec:** job-search-filtering
- **Error:** All 4 tests timeout waiting for results text
- **GitHub Issue:** #195
- **Recommendation:** Verify job search results rendering — results count text may have been removed or changed

### 3. Candidate Navigation Redirect
- **Spec:** navigation-flow
- **Error:** Redirected to /candidate/saved-jobs instead of /candidate/jobs
- **GitHub Issue:** #196
- **Recommendation:** Check candidate sidebar navigation routing

### 4. Cross-flow Integration API Failure
- **Spec:** navigation-flow
- **Error:** Job creation API returns non-success status
- **GitHub Issue:** #197
- **Recommendation:** Check recruiter auth context in cross-flow API calls

### 5. Recruiter Analytics — Application Sources
- **Spec:** recruiter-analytics
- **Error:** Application Sources section has 0 visible elements
- **GitHub Issue:** #198
- **Recommendation:** Verify analytics data fetch and chart rendering

### 6. Settings Page Tabs Not Found
- **Spec:** settings-flow
- **Error:** Profile/Account/Notifications/Privacy tabs not found (role="tab" selector)
- **GitHub Issue:** #190 (updated)
- **Recommendation:** Settings page tab structure may have changed — update selectors

### 7. Candidate Profile Stale Data
- **Spec:** candidate-profile-flow
- **Error:** Headline value mismatch (expected vs received different timestamps)
- **GitHub Issue:** N/A — test data isolation issue
- **Recommendation:** Ensure test data isolation or cleanup between runs

## Server Log Excerpts
```
Dashboard error: TypeError: analyticsCache.key is not a function
[billing] subscription-status error: column "subscription_plan" does not exist
```

## Next Steps
1. **P1:** Fix job visibility from recruiter → candidate (#188) — blocks core apply flow
2. **P1:** Fix job search filtering results rendering (#195) — blocks candidate job discovery
3. **P2:** Fix settings page tab selectors (#190) — blocks settings access
4. **P2:** Fix candidate navigation redirect (#196)
5. **P2:** Fix Application Sources analytics rendering (#198)
6. **P2:** Fix cross-flow job creation API (#197)
7. Add test data cleanup/isolation to prevent stale data in profile tests
