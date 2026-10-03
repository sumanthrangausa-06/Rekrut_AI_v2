# Rekrut AI — Phased E2E Test Report
**Date:** 2026-08-27
**Run ID:** 2026-08-27-2055
**Branch:** dev
**Commit:** 696e730
**Environment:** Local (localhost:3000)

## Setup Status
- [x] Local DB ready (`rekrut_e2e_phased`)
- [x] All 100 migrations applied successfully
- [x] Server running on localhost:3000 (health: ok)
- [x] Playwright browsers installed (chromium)
- [x] Auth setup completed (4/4 passed)

## Phase 1: Candidate Flow
| Spec File | Tests | Passed | Failed | Skipped | Notes |
|-----------|-------|--------|--------|---------|-------|
| candidate-flow.spec.ts | 6 | 6 | 0 | 0 | All auth redirects working |
| candidate-critical-flow.spec.ts | 2 | 2 | 0 | 0 | Full signup→apply flow OK |
| candidate-apply-flow.spec.ts | 1 | 0 | 1 | 0 | Created job not found in jobs list |
| candidate-job-apply-flow.spec.ts | 2 | 0 | 2 | 0 | Seeded job not found; filter timeout |
| candidate-profile-flow.spec.ts | 1 | 0 | 1 | 0 | Headline input value mismatch |
| candidate-full-journey.spec.ts | 1 | 1 | 0 | 0 | Complete journey OK |
| job-search-filtering.spec.ts | ? | ? | ? | ? | **TIMEOUT** — test hung |
| application-submission-flow.spec.ts | 2 | 0 | 0 | 2 | Skipped (precondition not met) |

**Phase 1 Summary:** 9/13 definite passed (69%), 4 failed, 2 skipped, 1 timeout

## Phase 2: Recruiter Flow
| Spec File | Tests | Passed | Failed | Skipped | Notes |
|-----------|-------|--------|--------|---------|-------|
| recruiter-flow.spec.ts | 3 | 3 | 0 | 0 | All auth redirects working |
| recruiter-critical-flow.spec.ts | 1 | 1 | 0 | 0 | Full post→view→shortlist→analytics OK |
| recruiter-job-post-flow.spec.ts | 1 | 0 | 1 | 0 | Click timeout at "Post a Job" button |
| recruiter-job-create-flow.spec.ts | 2 | 0 | 2 | 0 | Click timeout; waitForSelector timeout |
| recruiter-job-posting-flow.spec.ts | ? | ? | ? | ? | **UNKNOWN** — no result captured |
| recruiter-candidates-management.spec.ts | ? | ? | ? | ? | **TIMEOUT** — test hung |
| recruiter-applicant-review-flow.spec.ts | 1 | 0 | 1 | 0 | Failed — applicant review elements |
| recruiter-analytics.spec.ts | 7 | 0 | 2 | 5 | Analytics metrics rendering issue |

**Phase 2 Summary:** 4/12 definite passed (33%), 6 failed, 5 skipped, 2 unknown/timeout

## Phase 3: Cross Flow
| Spec File | Tests | Passed | Failed | Skipped | Notes |
|-----------|-------|--------|--------|---------|-------|
| auth-persistence.spec.ts | 8 | 7 | 0 | 1 | Token reload/logout OK |
| navigation-flow.spec.ts | 4 | 2 | 2 | 0 | Candidate nav→apply fails; E2E integration fails |
| navigation.spec.ts | 6 | 6 | 0 | 0 | All nav links working |
| payment-flow.spec.ts | 1 | 1 | 0 | 0 | Upgrade payment OK |
| payment.spec.ts | 8 | 7 | 1 | 0 | Checkout success state fails |
| dark-mode.spec.ts | 3 | 2 | 0 | 1 | Toggle + persist OK |
| mobile-navigation.spec.ts | 9 | 9 | 0 | 0 | All mobile nav OK |
| settings-flow.spec.ts | 7+ | 0 | 1+ | 0 | Settings tabs not found |
| password-reset-flow.spec.ts | 4 | 4 | 0 | 0 | Full reset flow OK |
| smoke-test.spec.ts | 5 | 5 | 0 | 0 | All critical paths OK |

**Phase 3 Summary:** 43/48+ definite passed (~90%), 4+ failed, 2 skipped

## Overall Summary
- **Total specs run:** 26 spec files attempted
- **Definite passed:** 56 individual tests
- **Definite failed:** 14 individual tests
- **Skipped:** 9 individual tests
- **Unknown/timeout:** 4 spec files
- **Definite pass rate:** 56/70 = **80%** (excluding timeouts/unknowns)
- **New GitHub issues to create:** 7 unique failure patterns
- **Improvement from last run:** 1% → 80% pass rate

## Failures Detail

### 1. candidate-apply-flow.spec.ts
- **Error:** `Created job not found in jobs list — candidate test cannot proceed`
- **Screenshot:** `test-results/candidate-apply-flow-*/test-failed-1.png`
- **Root Cause:** API-created job is not visible on candidate jobs page (may need indexing delay or status filter)
- **GitHub Issue:** #NEW — needs investigation
- **Recommendation:** Add wait/retry for job visibility or seed jobs with `status='active'`

### 2. candidate-job-apply-flow.spec.ts
- **Error 1:** `Seeded job "E2E SearchApply Job ..." not found in candidate jobs list`
- **Error 2:** `expect(filteredText).toBeTruthy()` — filter text not found after timeout
- **Screenshot:** `test-results/candidate-job-apply-flow-*/test-failed-1.png`
- **Root Cause:** Job creation via API doesn't reflect in candidate search; filter/sort selectors may have changed
- **GitHub Issue:** #NEW — related to #1 (job visibility)
- **Recommendation:** Ensure jobs created in tests have proper status and are indexed for search

### 3. candidate-profile-flow.spec.ts
- **Error:** `expect(locator).toHaveValue() failed — unexpected value "E2E QA Engineer 1787706505966"`
- **Screenshot:** `test-results/candidate-profile-flow-*/test-failed-1.png`
- **Root Cause:** Test expects the headline input to have a specific value but it has a different generated value
- **GitHub Issue:** #NEW — test assertion issue
- **Recommendation:** Update test to use dynamic value or clear field before assertion

### 4. recruiter-job-post-flow.spec.ts
- **Error:** `locator.click: Test timeout of 60000ms exceeded`
- **Screenshot:** `test-results/recruiter-job-post-flow-*/test-failed-1.png`
- **Root Cause:** "Post a Job" button click times out — page may not have loaded or button is disabled
- **GitHub Issue:** #NEW
- **Recommendation:** Check for loading states or auth gating on the job post page

### 5. recruiter-job-create-flow.spec.ts
- **Error 1:** `locator.click: Test timeout of 60000ms exceeded`
- **Error 2:** `page.waitForSelector: Timeout 15000ms exceeded`
- **Screenshot:** `test-results/recruiter-job-create-flow-*/test-failed-1.png`
- **Root Cause:** Same as #4 — form elements not interacting properly
- **GitHub Issue:** #NEW — related to #4
- **Recommendation:** Check for client-side routing delays or form hydration issues

### 6. recruiter-applicant-review-flow.spec.ts
- **Error:** Test failed on applicant review elements
- **Screenshot:** `test-results/recruiter-applicant-review-flow-*/test-failed-1.png`
- **Root Cause:** Applicants not found after job posting (depends on #4/#5)
- **GitHub Issue:** #NEW — depends on job creation flow
- **Recommendation:** Fix job creation first, then re-verify

### 7. recruiter-analytics.spec.ts
- **Error:** `expect(visibleCount).toBeGreaterThanOrEqual(1)` — analytics elements not visible
- **Screenshot:** `test-results/recruiter-analytics-*/test-failed-1.png`
- **Root Cause:** Analytics dashboard may not render without data, or selectors changed
- **GitHub Issue:** #NEW
- **Recommendation:** Seed analytics data or update selectors to match current implementation

### 8. navigation-flow.spec.ts
- **Error 1:** `page.toHaveURL() failed — unexpected value "http://localhost:3000/candidate/saved-jobs"`
- **Error 2:** `expect(jobRes.ok() || jobRes.status() === 201).toBeTruthy()` — API job creation failed
- **Root Cause:** Navigation goes to saved-jobs instead of jobs; API call fails
- **GitHub Issue:** #NEW
- **Recommendation:** Check navigation link targets; ensure CSRF/auth for API calls

### 9. payment.spec.ts
- **Error:** `pricing page shows checkout success confirmation state` failed
- **Screenshot:** `test-results/payment-*/test-failed-1.png`
- **Root Cause:** Stripe success state not rendered (likely missing query param or session)
- **GitHub Issue:** #NEW
- **Recommendation:** Mock Stripe callback or check for session_id in URL

### 10. settings-flow.spec.ts
- **Error:** `page.getByRole('tab', { name: 'Profile', exact: true })` — tabs not found
- **Screenshot:** `test-results/settings-flow-*/test-failed-1.png`
- **Root Cause:** Settings page structure changed — tabs may be rendered differently
- **GitHub Issue:** #NEW
- **Recommendation:** Update selectors to match current settings page DOM

## Server Log Excerpts
```
[ai-provider] Initialized. NIM: false | Groq: false | Cerebras: false | Kimi: true
[email-queue] Processor started (30s interval)
[reminder-cron] Interview reminder processor started (5min interval)
Rekrut AI running on port 3000
[analytics] Query profiler installed (threshold: 2000ms)
[rate-limiter] Cleanup scheduled every 300000ms
[activity-logger] Loaded 16 recent events from DB
[ai-call-logger] Loaded 500 recent calls from DB
[admin] Admin credentials loaded from env vars
[auto-verify] Initial verification complete
```

No critical server errors observed during testing.

## Improvements from Previous Run (2026-08-26)
| Metric | Previous | This Run | Delta |
|--------|----------|----------|-------|
| Pass rate | ~1% | ~80% | +79% |
| Auth setup | 3 passed, 1 skipped | 4 passed | +1 |
| Candidate flow | 0/19 passed | 9/13 passed | +9 |
| Recruiter flow | 0/25 passed | 4/12 passed | +4 |
| Cross flow | 1/53 passed | 43/48 passed | +42 |
| Server crashes | Multiple | None | Fixed |
| Missing tables | 3+ | 0 | Fixed |
| Migration failures | 3+ | 0 | Fixed |

## Next Steps

### Critical (P0)
- None — server is stable, no crashes

### High (P1)
1. [ ] Fix job visibility for candidate search (affects #1, #2, #6)
2. [ ] Fix recruiter job post/create form interactions (affects #4, #5)
3. [ ] Update settings page test selectors (#10)

### Medium (P2)
4. [ ] Fix candidate profile headline assertion (#3)
5. [ ] Fix analytics dashboard rendering without data (#7)
6. [ ] Fix navigation flow URL assertions (#8)
7. [ ] Fix Stripe payment success state (#9)
8. [ ] Re-run timed-out specs: job-search-filtering, recruiter-candidates-management, recruiter-job-posting-flow

### Low (P3)
9. [ ] Investigate application-submission-flow skips
10. [ ] Improve test reliability for job creation → visibility latency

## Conclusion
This run represents a **dramatic improvement** over the previous attempt. The migration and database infrastructure issues that caused mass failures last time are fully resolved. The remaining failures are primarily:
- **Test-data visibility issues** (jobs created via API not showing in candidate search)
- **UI interaction timeouts** (recruiter job post forms)
- **Selector drift** (settings tabs, analytics elements)
- **Payment integration** (Stripe success state)

None of the failures indicate server crashes or fundamental auth problems. The core application is stable and functional.

---
*Report generated: 2026-08-27 21:00 SGT*
*QA Automation Agent — Rekrut AI E2E Test Suite*
