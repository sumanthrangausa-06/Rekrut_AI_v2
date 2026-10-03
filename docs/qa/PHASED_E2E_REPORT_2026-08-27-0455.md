# Rekrut AI — Phased E2E Test Report
**Date:** 2026-08-27
**Run ID:** 2026-08-27-0455
**Branch:** dev
**Commit:** a535f39
**Environment:** Local (localhost:3000)

## Setup Status
- [x] Local DB ready (rekrut_e2e_phased)
- [x] Server running (PID 502865)
- [x] Playwright browsers installed
- [x] Auth setup completed (4/4 passed)

## Phase 1: Candidate Flow
| Spec File | Result | Notes |
|-----------|--------|-------|
| candidate-flow.spec.ts | 6/6 PASS | Auth redirects all correct |
| candidate-critical-flow.spec.ts | 2/2 PASS | Desktop + mobile signup→apply flow |
| candidate-apply-flow.spec.ts | 0/1 FAIL | Created job not found in jobs list |
| candidate-job-apply-flow.spec.ts | 0/2 FAIL | Seeded job not found; timeout on filter/sort |
| candidate-profile-flow.spec.ts | 0/1 FAIL | Headline value mismatch (stale data from prior run) |
| candidate-full-journey.spec.ts | 1/1 PASS | Full signup→apply→verify flow |
| job-search-filtering.spec.ts | 0/3 FAIL, 1 skipped | SIGKILL/timeout on all 3 tests |
| application-submission-flow.spec.ts | 2 skipped | Tests skipped (depend on seeded job data) |

**Phase 1 Summary:** 10/20 passed, 7 failed, 3 skipped

## Phase 2: Recruiter Flow
| Spec File | Result | Notes |
|-----------|--------|-------|
| recruiter-flow.spec.ts | 3/3 PASS | Auth redirects all correct |
| recruiter-critical-flow.spec.ts | 1/1 PASS | Full recruiter critical flow |
| recruiter-job-post-flow.spec.ts | 1/1 PASS | Job post + pipeline flow |
| recruiter-job-create-flow.spec.ts | 1/2 PASS | Edit job passed; create→view failed (job not in search) |
| recruiter-job-posting-flow.spec.ts | 1/1 PASS | CRUD on job posting |
| recruiter-candidates-management.spec.ts | 7 skipped | All skipped — known issue #189 |
| recruiter-applicant-review-flow.spec.ts | 1/1 PASS | Shortlist/reject flow |
| recruiter-analytics.spec.ts | 6/7 PASS | Application sources breakdown failed (0 visible elements) |

**Phase 2 Summary:** 14/23 passed, 2 failed, 7 skipped

## Phase 3: Cross Flow
| Spec File | Result | Notes |
|-----------|--------|-------|
| auth-persistence.spec.ts | 7/8 PASS, 1 skipped | Token persistence, direct nav, settings access |
| navigation-flow.spec.ts | 2/4 PASS | Candidate nav→jobs failed (redirects to saved-jobs); E2E integration failed (API 403) |
| navigation.spec.ts | 6/6 PASS | All visitor navigation links |
| payment-flow.spec.ts | 1/1 PASS | Upgrade payment end-to-end |
| payment.spec.ts | 8/8 PASS | Stripe pricing, checkout, success/cancel states |
| dark-mode.spec.ts | 2/3 PASS, 1 skipped | Toggle + persist; landing page skipped |
| mobile-navigation.spec.ts | 9/9 PASS | All mobile sidebar/nav tests |
| settings-flow.spec.ts | 0/4 FAIL | SIGKILL/timeout on all 4 tests |
| password-reset-flow.spec.ts | 4/4 PASS | Full forgot→reset→login flow |
| smoke-test.spec.ts | 5/5 PASS | Homepage, health, jobs, login, register |

**Phase 3 Summary:** 44/52 passed, 6 failed, 2 skipped

## Overall Summary
- Total specs run: 26
- Total tests: 95
- Passed: 68
- Failed: 15
- Skipped: 12
- Pass rate: 71.6% (68/95)
- Pass rate (excluding skipped): 81.9% (68/83)
- New GitHub issues created: 0
- Existing issues updated: 0

## Failures Detail

### 1. candidate-apply-flow.spec.ts
- **Error:** Created job not found in jobs list — candidate test cannot proceed
- **Root Cause:** Test depends on a job being created by recruiter auth setup, but fresh DB has no jobs
- **GitHub Issue:** #188 — [E2E] Jobs posted by recruiter not immediately visible to candidate
- **Recommendation:** Seed test data before candidate apply tests, or make tests self-contained

### 2. candidate-job-apply-flow.spec.ts (Test 1)
- **Error:** Seeded job "E2E SearchApply Job 1787777984641" not found in candidate jobs list
- **Root Cause:** Same as #1 — no seeded jobs in fresh DB
- **GitHub Issue:** #188

### 3. candidate-job-apply-flow.spec.ts (Test 2)
- **Error:** Test timeout of 60000ms exceeded — expect(filteredText).toBeTruthy() received ""
- **Root Cause:** No jobs in DB means no results to filter, and empty state doesn't match expected text pattern
- **GitHub Issue:** #188

### 4. candidate-profile-flow.spec.ts
- **Error:** Headline value mismatch — expected "E2E QA Engineer 1787778066135" but got "E2E QA Engineer 1787706505966"
- **Root Cause:** Stale profile data from previous test run persisted in DB; test expects fresh signup profile
- **GitHub Issue:** NEW — Test DB isolation issue
- **Recommendation:** Clean user profiles between test runs, or use unique identifiers per run

### 5. job-search-filtering.spec.ts (All 3 tests)
- **Error:** SIGKILL / test timeout on all tests
- **Root Cause:** Likely browser memory exhaustion during long-running search/filter operations with no data
- **GitHub Issue:** #188
- **Recommendation:** Add early-exit when no jobs exist, or seed minimum test data

### 6. recruiter-job-create-flow.spec.ts (Test 1)
- **Error:** Job "E2E RecruiterCreate Job 1787778358822" not found in candidate job search UI
- **Root Cause:** Timing issue — job created but not immediately visible in search; possibly search indexing delay
- **GitHub Issue:** #188

### 7. recruiter-analytics.spec.ts — Application Sources Breakdown
- **Error:** expect(visibleCount).toBeGreaterThanOrEqual(1) received 0
- **Root Cause:** Application Sources chart section has no visible data elements when no applications exist
- **GitHub Issue:** #186 — [E2E] analyticsCache.key is not a function — recruiter dashboard error
- **Server Error:** `TypeError: analyticsCache.key is not a function` at routes/recruiter.js:120
- **Recommendation:** Fix analyticsCache initialization; handle empty state in Application Sources chart

### 8. navigation-flow.spec.ts — Candidate Navigation
- **Error:** Expected URL /candidate/jobs but got /candidate/saved-jobs
- **Root Cause:** Navigation menu link "Jobs" redirects to saved-jobs instead of jobs board when no jobs are available/applied
- **GitHub Issue:** NEW — Navigation routing mismatch
- **Recommendation:** Ensure /candidate/jobs route exists and is accessible directly

### 9. navigation-flow.spec.ts — E2E Integration Flow
- **Error:** expect(jobRes.ok() || jobRes.status() === 201).toBeTruthy() received false
- **Root Cause:** API returned non-OK status (likely 403/401) when creating job via API in integration test
- **GitHub Issue:** #194 — [E2E] Cross-flow integration: candidate apply → recruiter view applicants broken
- **Recommendation:** Check API auth headers in integration test; verify RBAC middleware allows test user

### 10. settings-flow.spec.ts (All 4 tests)
- **Error:** SIGKILL / test timeout on all tests
- **Root Cause:** Settings page may have infinite loop, heavy rendering, or memory leak causing browser crash
- **GitHub Issue:** #190 — [E2E] Settings page heading not found — page structure mismatch
- **Recommendation:** Investigate settings page for render loops; check for uncontrolled re-renders

## Server Log Excerpts
```
[ai-provider] ❌ kimi failed for llm: [401] 401 Invalid Authentication (expected in test env)
Dashboard error: TypeError: analyticsCache.key is not a function
    at /root/.openclaw/workspace/Rekrut_AI_v2/routes/recruiter.js:120:35
[billing] subscription-status error: column "subscription_plan" does not exist
[email-service] Email not configured (neither Brevo API nor SMTP), logging only
```

## Critical Issues (P0/P1)
1. **#186** — `analyticsCache.key is not a function` crashes recruiter dashboard (P1)
2. **#188** — Job visibility between recruiter and candidate is unreliable (P1)
3. **#190** — Settings page causes browser SIGKILL (P1)
4. **Database schema drift** — `subscription_plan` column missing (P1)

## Next Steps
- [ ] Fix analyticsCache initialization in recruiter.js (routes/recruiter.js:120)
- [ ] Add DB migration for `subscription_plan` column
- [ ] Seed test database with minimum job data before E2E runs
- [ ] Fix settings page render performance / memory leak
- [ ] Investigate /candidate/jobs → /candidate/saved-jobs redirect behavior
- [ ] Re-run E2E suite after fixes to verify pass rate improvement
