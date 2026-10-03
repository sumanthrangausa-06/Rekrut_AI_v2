# Rekrut AI — Phased E2E Test Report
**Date:** 2026-08-28
**Run ID:** 2026-08-28-1323
**Branch:** dev
**Commit:** b34da7d
**Environment:** Local (localhost:3000)

## Setup Status
- [x] Local DB ready (`rekrut_e2e_phased`)
- [x] All migrations applied successfully
- [x] Server running (health check passed)
- [x] Playwright browsers installed
- [x] Auth setup completed (4 passed)

## Phase 1: Candidate Flow
| Spec File | Tests | Passed | Failed | Skipped | Notes |
|-----------|-------|--------|--------|---------|-------|
| candidate-flow.spec.ts | 6 | 6 | 0 | 0 | Auth redirects working |
| candidate-critical-flow.spec.ts | 2 | 2 | 0 | 0 | Desktop + mobile signup → apply |
| candidate-apply-flow.spec.ts | 1 | 0 | 1 | 0 | Created job not found in jobs list |
| candidate-job-apply-flow.spec.ts | 2 | 0 | 2 | 0 | Seeded job not found; filter timeout |
| candidate-profile-flow.spec.ts | 1 | 0 | 1 | 0 | Headline value mismatch (stale data) |
| candidate-full-journey.spec.ts | 1 | 1 | 0 | 0 | Full signup → apply journey |
| job-search-filtering.spec.ts | 4 | 0 | 4 | 0 | All timeout waiting for results text |
| application-submission-flow.spec.ts | 2 | 0 | 0 | 2 | Skipped (depends on prior flows) |

**Phase 1 Summary:** 9/19 passed (47%)

## Phase 2: Recruiter Flow
| Spec File | Tests | Passed | Failed | Skipped | Notes |
|-----------|-------|--------|--------|---------|-------|
| recruiter-flow.spec.ts | 3 | 3 | 0 | 0 | Auth redirects working |
| recruiter-critical-flow.spec.ts | 1 | 1 | 0 | 0 | Full recruiter pipeline |
| recruiter-job-post-flow.spec.ts | 1 | 1 | 0 | 0 | Post → apply → pipeline |
| recruiter-job-create-flow.spec.ts | 2 | 1 | 1 | 0 | Job not visible in candidate search |
| recruiter-job-posting-flow.spec.ts | 1 | 1 | 0 | 0 | Create → edit → verify |
| recruiter-candidates-management.spec.ts | 7 | 0 | 0 | 7 | All skipped |
| recruiter-applicant-review-flow.spec.ts | 1 | 1 | 0 | 0 | View → shortlist → reject |
| recruiter-analytics.spec.ts | 7 | 6 | 1 | 0 | Application sources: 0 visible |

**Phase 2 Summary:** 14/23 passed (61%)

## Phase 3: Cross Flow
| Spec File | Tests | Passed | Failed | Skipped | Notes |
|-----------|-------|--------|--------|---------|-------|
| auth-persistence.spec.ts | 8 | 7 | 0 | 1 | Token persist, navigation, settings |
| navigation-flow.spec.ts | 4 | 2 | 2 | 0 | Candidate nav URL mismatch; API fail |
| navigation.spec.ts | 6 | 6 | 0 | 0 | All nav links working |
| payment-flow.spec.ts | 1 | 1 | 0 | 0 | Upgrade payment end-to-end |
| payment.spec.ts | 8 | 8 | 0 | 0 | All Stripe flows |
| dark-mode.spec.ts | 3 | 2 | 0 | 1 | Toggle + persist works |
| mobile-navigation.spec.ts | 9 | 9 | 0 | 0 | All mobile nav tests pass |
| settings-flow.spec.ts | 7 | 0 | 5 | 2 | Tabs not found (Profile, Account, etc.) |
| password-reset-flow.spec.ts | 4 | 4 | 0 | 0 | Full reset flow works |
| smoke-test.spec.ts | 5 | 5 | 0 | 0 | All critical paths load |

**Phase 3 Summary:** 44/55 passed (80%)

## Overall Summary
- **Total specs run:** 26 spec files
- **Total individual tests:** 97
- **Passed:** 67
- **Failed:** 17
- **Skipped/Did not run:** 13
- **Pass rate:** 69.1%
- **New GitHub issues created:** 0
- **Existing issues updated:** 7

## Failures Detail

### 1. candidate-apply-flow.spec.ts
- **Error:** `Created job not found in jobs list — candidate test cannot proceed`
- **Root Cause:** Job created via API not immediately visible in candidate jobs list
- **GitHub Issue:** #188 (updated)
- **Recommendation:** Add polling/wait for job indexing, or seed jobs before test

### 2. candidate-job-apply-flow.spec.ts
- **Error 1:** `Seeded job "E2E SearchApply Job ..." not found in candidate jobs list`
- **Error 2:** `Test timeout — filtered results text not found`
- **GitHub Issue:** #188, #195 (updated)
- **Recommendation:** Fix job visibility latency; check job search page rendering

### 3. candidate-profile-flow.spec.ts
- **Error:** `Expected: "E2E QA Engineer 1787893507178" but Received: "E2E QA Engineer 1787706505966"`
- **Root Cause:** Stale test data from previous run — profile retains old headline
- **GitHub Issue:** #199 (updated)
- **Recommendation:** Use deterministic test data or reset profile before test

### 4. job-search-filtering.spec.ts (×4 failures)
- **Error:** All tests timeout waiting for `/results?|No jobs found/` text
- **Root Cause:** Job search page doesn't render expected text
- **GitHub Issue:** #195 (updated)
- **Recommendation:** Verify job search page DOM; seed test jobs if needed

### 5. recruiter-job-create-flow.spec.ts
- **Error:** `Job "E2E RecruiterCreate Job ..." not found in candidate job search UI`
- **Root Cause:** Job created by recruiter not visible to candidate
- **GitHub Issue:** #188 (updated)
- **Recommendation:** Check job publishing/visibility logic

### 6. recruiter-analytics.spec.ts
- **Error:** `Expected: >= 1 visible elements, Received: 0` for Application Sources breakdown
- **Root Cause:** Analytics section renders but contains no visible data elements
- **GitHub Issue:** #198 (updated)
- **Recommendation:** Check if Application Sources chart renders data correctly

### 7. navigation-flow.spec.ts — Candidate Navigation
- **Error:** `Expected: /.*\/candidate\/jobs/ but Received: "http://localhost:3000/candidate/saved-jobs"`
- **Root Cause:** Candidate dashboard "Jobs" nav link goes to saved-jobs instead of jobs board
- **GitHub Issue:** #196 (updated)
- **Recommendation:** Fix navigation link target in candidate sidebar

### 8. navigation-flow.spec.ts — E2E Integration
- **Error:** `expect(received).toBeTruthy() received false` — job creation API call failed
- **Root Cause:** Direct API call to create job returned non-OK status
- **GitHub Issue:** #197 (updated)
- **Recommendation:** Check job creation API requires auth/CSRF; fix test setup

### 9. settings-flow.spec.ts (×5 failures)
- **Error:** `getByRole('tab', { name: 'Profile', exact: true })` not found
- **Root Cause:** Settings page doesn't use shadcn Tabs with role="tab"
- **GitHub Issue:** #190 (updated)
- **Recommendation:** Update test selectors to match actual settings page DOM

## Comparison with Previous Run (2026-08-26)
| Metric | 2026-08-26 | 2026-08-28 | Change |
|--------|-----------|-----------|--------|
| Phase 1 Pass Rate | 0% | 47% | +47% |
| Phase 2 Pass Rate | 0% | 61% | +61% |
| Phase 3 Pass Rate | ~2% | 80% | +78% |
| Overall Pass Rate | ~1% | 69% | +68% |

**Major improvements since last run:**
- Server-side auth redirects now working (candidate-flow, recruiter-flow pass)
- Candidate critical flow (signup → apply) now passes
- Recruiter critical flow (post job → pipeline) now passes
- Payment/Stripe tests all pass
- Mobile navigation tests all pass
- Password reset flow passes
- Smoke tests all pass

## Server Log Excerpts
- `analyticsCache.key is not a function` at routes/recruiter.js:120 — non-fatal but logged
- Email service not configured (expected in test env)
- Rate limiter cleaning expired buckets normally

## Next Steps

### P1 (Fix existing issues)
1. [ ] #188 — Job visibility latency between recruiter post and candidate search
2. [ ] #195 — Job search filtering page rendering
3. [ ] #199 — Candidate profile stale data / deterministic test values
4. [ ] #198 — Recruiter analytics Application Sources chart
5. [ ] #196 — Candidate navigation link to /candidate/jobs vs /candidate/saved-jobs
6. [ ] #197 — E2E integration API job creation failure
7. [ ] #190 — Settings page tab selectors

### P2 (Skipped tests)
8. [ ] recruiter-candidates-management (7 skipped) — candidates page structure changed
9. [ ] application-submission-flow (2 skipped) — depends on apply flow fixes

---
*Report generated: 2026-08-28 13:23 SGT*
*E2E QA Automation Agent — Rekrut AI*
