# Rekrut AI — Phased E2E Test Report
**Date:** 2026-08-27
**Run ID:** 2026-08-27-0922
**Branch:** dev
**Commit:** 27188fc
**Environment:** Local (localhost:3000)

## Setup Status
- [x] Local DB ready (rekrut_e2e_phased)
- [x] Server running (PID active)
- [x] Playwright browsers installed
- [x] Auth setup completed (4/4 passed)

## Phase 1: Candidate Flow
| Spec File | Tests | Passed | Failed | Skipped |
|-----------|-------|--------|--------|---------|
| candidate-flow.spec.ts | 6 | 6 | 0 | 0 |
| candidate-critical-flow.spec.ts | 2 | 2 | 0 | 0 |
| candidate-apply-flow.spec.ts | 1 | 0 | 1 | 0 |
| candidate-job-apply-flow.spec.ts | 2 | 0 | 2 | 0 |
| candidate-profile-flow.spec.ts | 1 | 0 | 1 | 0 |
| candidate-full-journey.spec.ts | 1 | 1 | 0 | 0 |
| job-search-filtering.spec.ts | 4 | 0 | 4 | 0 |
| application-submission-flow.spec.ts | 2 | 0 | 0 | 2 |

**Phase 1 Summary:** 9/17 passed (52.9%)

## Phase 2: Recruiter Flow
| Spec File | Tests | Passed | Failed | Skipped |
|-----------|-------|--------|--------|---------|
| recruiter-flow.spec.ts | 3 | 3 | 0 | 0 |
| recruiter-critical-flow.spec.ts | 1 | 1 | 0 | 0 |
| recruiter-job-post-flow.spec.ts | 1 | 1 | 0 | 0 |
| recruiter-job-create-flow.spec.ts | 2 | 1 | 1 | 0 |
| recruiter-job-posting-flow.spec.ts | 1 | 1 | 0 | 0 |
| recruiter-candidates-management.spec.ts | 7 | 0 | 0 | 7 |
| recruiter-applicant-review-flow.spec.ts | 1 | 1 | 0 | 0 |
| recruiter-analytics.spec.ts | 7 | 6 | 1 | 0 |

**Phase 2 Summary:** 14/23 passed (60.9%)

## Phase 3: Cross Flow
| Spec File | Tests | Passed | Failed | Skipped | Did Not Run |
|-----------|-------|--------|--------|---------|-------------|
| auth-persistence.spec.ts | 8 | 7 | 0 | 1 | 0 |
| navigation-flow.spec.ts | 4 | 2 | 2 | 0 | 0 |
| navigation.spec.ts | 6 | 6 | 0 | 0 | 0 |
| payment-flow.spec.ts | 1 | 1 | 0 | 0 | 0 |
| payment.spec.ts | 8 | 8 | 0 | 0 | 0 |
| dark-mode.spec.ts | 3 | 2 | 0 | 1 | 0 |
| mobile-navigation.spec.ts | 9 | 9 | 0 | 0 | 0 |
| settings-flow.spec.ts | 7 | 0 | 5 | 0 | 2 |
| password-reset-flow.spec.ts | 4 | 4 | 0 | 0 | 0 |
| smoke-test.spec.ts | 5 | 5 | 0 | 0 | 0 |

**Phase 3 Summary:** 44/55 passed (80.0%)

## Overall Summary
- Total specs run: 26 spec files
- Total tests: 95
- Passed: 67
- Failed: 16
- Skipped: 12
- Did not run: 2 (max failures limit)
- Pass rate: 70.5%

## Failures Detail

### 1. candidate-apply-flow.spec.ts — Job not found in jobs list
- Error: `Created job not found in jobs list — candidate test cannot proceed`
- Screenshot: `test-results/candidate-apply-flow-*/test-failed-1.png`
- GitHub Issue: #188
- Priority: P1
- Root cause: Jobs posted by recruiter are not immediately visible in candidate job search UI. Likely a timing/indexing issue or visibility filter.

### 2. candidate-job-apply-flow.spec.ts — Seeded job not found + filter timeout
- Error 1: `Seeded job "E2E SearchApply Job <timestamp>" not found in candidate jobs list`
- Error 2: `Test timeout of 60000ms exceeded` on filter/sort verification
- Screenshot: multiple in `test-results/candidate-job-apply-flow-*/`
- GitHub Issue: #188 (job visibility), #195 (filter timeout)
- Priority: P1
- Root cause: Same job visibility issue plus search/filter UI not loading results properly.

### 3. candidate-profile-flow.spec.ts — Profile headline mismatch
- Error: `Expected: "E2E QA Engineer 1787821457854", Received: "E2E QA Engineer 1787706505966"`
- Screenshot: `test-results/candidate-profile-flow-*/test-failed-1.png`
- GitHub Issue: NEW — test uses hardcoded timestamp that doesn't match saved value
- Priority: P2
- Root cause: Test generates headline with timestamp at runtime but expects a different value. Test data isolation issue.

### 4. job-search-filtering.spec.ts — All 4 tests timeout
- Error: `Test timeout of 60000ms exceeded` — waiting for results text
- Screenshot: multiple in `test-results/job-search-filtering-*/`
- GitHub Issue: #195
- Priority: P1
- Root cause: Search/filter UI not returning results or not showing "No jobs found" empty state. All 4 filter variations timeout.

### 5. recruiter-job-create-flow.spec.ts — Job not visible to candidate
- Error: `Job "E2E RecruiterCreate Job <timestamp>" not found in candidate job search UI`
- Screenshot: `test-results/recruiter-job-create-flow-*/test-failed-1.png`
- GitHub Issue: #188
- Priority: P1
- Root cause: Same cross-user job visibility issue.

### 6. recruiter-analytics.spec.ts — Application Sources breakdown
- Error: `Expected: >= 1, Received: 0` visible elements
- Screenshot: `test-results/recruiter-analytics-*/test-failed-1.png`
- GitHub Issue: #198
- Priority: P2
- Root cause: Application Sources chart/section has no visible data elements. May be data-dependent or UI structure changed.

### 7. navigation-flow.spec.ts — Candidate Navigation URL mismatch
- Error: `Expected pattern: /.*\/candidate\/jobs/, Received: "http://localhost:3000/candidate/saved-jobs"`
- Screenshot: `test-results/navigation-flow-*/test-failed-1.png`
- GitHub Issue: #196
- Priority: P2
- Root cause: Candidate navigation clicks "Jobs" but redirects to /candidate/saved-jobs instead of /candidate/jobs.

### 8. navigation-flow.spec.ts — E2E Integration Flow API failure
- Error: `expect(received).toBeTruthy() Received: false` — job creation API returned non-ok status
- Screenshot: `test-results/navigation-flow-*/test-failed-2.png`
- GitHub Issue: #197
- Priority: P1
- Root cause: Direct API call to create job fails in cross-flow test. Possibly auth/CSRF or permission issue.

### 9. settings-flow.spec.ts — All tabs not found (5 failures)
- Error: `getByRole('tab', { name: 'Profile', exact: true })` not found
- All 5 settings tab tests fail with same root cause
- Screenshot: multiple in `test-results/settings-flow-*/`
- GitHub Issue: #190
- Priority: P1
- Root cause: Settings page UI structure changed — tabs are no longer rendered with role="tab" or tab names changed. 2 tests did not run due to max failures limit.

## Server Log Excerpts
```
Server health: ok
Database: connected
Tables: users, jobs, events, companies, refresh_tokens, user_sessions, oauth_connections
Pool: totalCount=5, idleCount=5
```
No critical server errors observed during test run.

## GitHub Issues Status
| Issue | Title | Status | Action |
|-------|-------|--------|--------|
| #188 | Jobs posted by recruiter not immediately visible to candidate | Open | Comment added |
| #195 | Job Search Filtering: all tests timeout waiting for results text | Open | Comment added |
| #196 | Candidate Navigation: redirected to /candidate/saved-jobs | Open | Comment added |
| #197 | End-to-End Integration: job creation API fails in cross-flow test | Open | Comment added |
| #198 | Recruiter Analytics: Application Sources breakdown shows 0 visible elements | Open | Comment added |
| #190 | Settings page heading not found — page structure mismatch | Open | Comment added |

## Recommendations
1. **P0 — Job Visibility (#188):** This is the most impactful failure affecting 3+ tests. Investigate why jobs posted by recruiters are not visible to candidates in search. Check job status (active vs draft), visibility filters, and indexing.
2. **P1 — Settings Page (#190):** UI structure changed. Update test selectors or fix page rendering.
3. **P1 — Job Search Filtering (#195):** Search/filter UI returns no results or empty state not rendered. Check API response and frontend rendering.
4. **P2 — Candidate Navigation (#196):** Clarify whether /candidate/jobs or /candidate/saved-jobs is the correct landing page for "Jobs" nav item.
5. **P2 — Profile Flow Test Data:** Fix hardcoded timestamp in test to use dynamic value or cleanup previous test data.
6. **P2 — Application Sources (#198):** Add seed data for analytics or update test to handle empty state gracefully.
7. **P1 — E2E Integration API (#197):** Debug why direct job creation API fails in cross-flow context but works in recruiter-only tests.

## Next Steps
- [ ] Fix job visibility issue (#188) and re-run candidate flow tests
- [ ] Fix settings page tab selectors (#190) and re-run settings tests
- [ ] Fix job search filtering (#195)
- [ ] Fix navigation flow URL expectations (#196)
- [ ] Fix profile flow test data isolation
- [ ] Re-run full E2E suite after fixes
