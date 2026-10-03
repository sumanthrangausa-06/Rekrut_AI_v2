# Rekrut AI — Phased E2E Test Report
**Date:** 2026-08-26 17:06 (Asia/Shanghai)
**Run ID:** 2026-08-26-1706
**Branch:** dev
**Commit:** c990451
**Environment:** Local (localhost:3000)

## Setup Status
- [x] Local DB ready (rekrut_e2e_phased)
- [x] Server running (localhost:3000/health → ok)
- [x] Playwright browsers installed
- [x] Auth setup completed (4 passed)

## Phase 1: Candidate Flow
| Spec File | Tests | Result | Notes |
|-----------|-------|--------|-------|
| candidate-flow.spec.ts | 6 | **PASS** | All redirect-to-login tests passed |
| candidate-critical-flow.spec.ts | 2 | **PASS** | Desktop + mobile signup → apply flow |
| candidate-apply-flow.spec.ts | 1 | **FAIL** | Created job not found in jobs list |
| candidate-job-apply-flow.spec.ts | 2 | **FAIL** | Filter timeout, no results found |
| candidate-profile-flow.spec.ts | 1 | **FAIL** | Headline value mismatch (stored: "E2E QA Engineer ...") |
| candidate-full-journey.spec.ts | 1 | **PASS** | Full signup → apply journey |
| job-search-filtering.spec.ts | — | **TIMEOUT** | Test hung (same as previous run) |
| application-submission-flow.spec.ts | 2 | **SKIP** | Both tests skipped (require prior test state) |

**Phase 1 Summary:** 9/14 passed (64%) — up from 43% in previous run

## Phase 2: Recruiter Flow
| Spec File | Tests | Result | Notes |
|-----------|-------|--------|-------|
| recruiter-flow.spec.ts | 3 | **PASS** | All redirect-to-login tests passed |
| recruiter-critical-flow.spec.ts | 1 | **PASS** | Full recruiter flow end-to-end |
| recruiter-job-post-flow.spec.ts | 1 | **PASS** | Post job → apply → pipeline flow |
| recruiter-job-create-flow.spec.ts | 2 | **1 PASS, 1 FAIL** | Job created but not found in candidate search |
| recruiter-job-posting-flow.spec.ts | 1 | **PASS** | Create, verify, edit job |
| recruiter-candidates-management.spec.ts | 7 | **SKIP** | All tests skipped (page elements not found) |
| recruiter-applicant-review-flow.spec.ts | 1 | **PASS** | View, shortlist, reject candidates |
| recruiter-analytics.spec.ts | 7 | **6 PASS, 1 FAIL** | Application sources chart not visible |

**Phase 2 Summary:** 14/21 passed (67%) — up from 27% in previous run

## Phase 3: Cross Flow
| Spec File | Tests | Result | Notes |
|-----------|-------|--------|-------|
| auth-persistence.spec.ts | 9 | **6 PASS, 1 FAIL, 2 SKIP** | Direct /candidate/jobs nav redirects to login |
| navigation-flow.spec.ts | 4 | **2 PASS, 2 FAIL** | Job API creation returns error; apply flow broken |
| navigation.spec.ts | 6 | **PASS** | All public navigation tests passed |
| payment-flow.spec.ts | 1 | **PASS** | Upgrade payment flow |
| payment.spec.ts | 8 | **PASS** | All Stripe payment tests passed |
| dark-mode.spec.ts | 3 | **2 PASS, 1 SKIP** | Landing page dark mode skipped |
| mobile-navigation.spec.ts | 9 | **PASS** | All mobile nav tests passed |
| settings-flow.spec.ts | — | **TIMEOUT** | Test hung |
| password-reset-flow.spec.ts | 4 | **PASS** | Full reset flow works |
| smoke-test.spec.ts | 5 | **PASS** | All critical paths load |

**Phase 3 Summary:** 43/53 passed (81%) — up from ~5% in previous run

## Overall Summary
- Total spec files run: 26
- Total individual tests: ~88
- Passed: 66
- Failed: 10
- Skipped: 12
- Timed out/killed: 2
- **Pass rate: ~75%** (excluding skipped/timed out: ~87%)

### Comparison with Previous Run (2026-08-26-0130)
| Metric | Previous | This Run | Change |
|--------|----------|----------|--------|
| Phase 1 | 43% | 64% | +21% |
| Phase 2 | 27% | 67% | +40% |
| Phase 3 | 5% | 81% | +76% |
| Overall | ~23% | ~75% | +52% |

## Failures Detail

### 1. candidate-apply-flow.spec.ts
- Error: Created job not found in jobs list
- GitHub Issue: Existing issue likely — job listing UI may not show newly created jobs immediately
- Priority: P1
- Recommendation: Add wait/retry logic or check for async indexing delay

### 2. candidate-job-apply-flow.spec.ts (×2)
- Error: Filter timeout, no results found
- Priority: P1
- Recommendation: Job search filter selectors may be outdated

### 3. candidate-profile-flow.spec.ts
- Error: Headline input has unexpected value "E2E QA Engineer 1787706505966"
- Priority: P2
- Recommendation: Profile form auto-generates headline; test expectation needs update

### 4. recruiter-job-create-flow.spec.ts
- Error: Job "E2E RecruiterCreate Job ..." not found in candidate job search UI
- Priority: P1
- Recommendation: Same root cause as candidate-apply-flow — job indexing delay

### 5. recruiter-analytics.spec.ts
- Error: Application Sources section visible but no chart elements rendered
- Priority: P2
- Recommendation: Chart may render conditionally based on data availability

### 6. auth-persistence.spec.ts
- Error: Direct navigation to /candidate/jobs redirects to login
- Priority: P1
- Recommendation: Storage state auth not being loaded on direct navigation

### 7. navigation-flow.spec.ts (×2)
- Error: Job creation API returns error; candidate cannot apply
- Priority: P1
- Recommendation: Cross-flow job creation failing

### 8. job-search-filtering.spec.ts — TIMEOUT
- Test hung during execution
- Priority: P2
- Recommendation: Review test for infinite loops or long waits

### 9. settings-flow.spec.ts — TIMEOUT
- Test hung during execution
- Priority: P2
- Recommendation: Review test for infinite loops or long waits

## Known Skipped Tests
- application-submission-flow (2): Requires prior test state
- recruiter-candidates-management (7): All skipped — page UI elements missing
- auth-persistence (2): Auth state variations
- dark-mode (1): Landing page variant

## Server Log Excerpts
```
Server started successfully on localhost:3000
Health check: ok (db connected, latency 10ms)
All migrations completed successfully
Auth setup: 4/4 passed
```

## Key Improvements Since Last Run
1. **Auth setup fully working** — All 4 auth setups pass (was a P0 issue)
2. **Candidate critical flow fixed** — Signup → profile → apply now works (was failing due to UI changes)
3. **Payment flow fully green** — All Stripe tests pass
4. **Mobile navigation solid** — All 9 mobile nav tests pass
5. **Password reset working** — Full flow verified
6. **Smoke tests clean** — All critical paths load

## Next Steps
- [ ] Fix job search indexing delay (affects candidate-apply-flow, recruiter-job-create-flow)
- [ ] Update candidate-profile-flow test expectation for auto-generated headline
- [ ] Fix auth-persistence direct navigation issue
- [ ] Debug job creation API failure in navigation-flow
- [ ] Review and fix timed-out tests (job-search-filtering, settings-flow)
- [ ] Unskip or fix recruiter-candidates-management tests
- [ ] Target: 90%+ pass rate on next run

---
*Report generated by E2E QA Automation Agent*
