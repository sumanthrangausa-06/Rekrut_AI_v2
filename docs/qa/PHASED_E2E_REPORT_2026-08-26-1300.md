# Rekrut AI — Phased E2E Test Report
**Date:** 2026-08-26
**Run ID:** 2026-08-26-1300
**Branch:** dev
**Commit:** 359f783
**Environment:** Local (localhost:3000)
**Database:** rekrut_e2e_phased (local PostgreSQL)

## Setup Status
- [x] Local DB ready
- [x] Server running
- [x] Playwright browsers installed
- [x] Auth setup completed (3 passed, 1 skipped)
- [x] Migrations applied successfully (all 100+ migrations)

## Phase 1: Candidate Flow
| Spec File | Tests | Passed | Failed | Skipped | Notes |
|-----------|-------|--------|--------|---------|-------|
| candidate-flow.spec.ts | 6 | 6 | 0 | 0 | All auth redirects working correctly |
| candidate-critical-flow.spec.ts | 2 | 0 | 2 | 0 | Timeout waiting for "Save Changes" button |
| candidate-apply-flow.spec.ts | 1 | 0 | 1 | 0 | Created job not found in jobs list |
| candidate-job-apply-flow.spec.ts | 2 | 0 | 2 | 0 | Timeout on apply; no results text found |
| candidate-profile-flow.spec.ts | 1 | 0 | 1 | 0 | Timeout waiting for "Save Changes" button |
| candidate-full-journey.spec.ts | 1 | 0 | 1 | 0 | SIGKILL during run (memory) |
| job-search-filtering.spec.ts | 4 | 0 | 4 | 0 | SIGKILL during run (memory) |
| application-submission-flow.spec.ts | 2 | 0 | 0 | 2 | Skipped (dependencies) |

**Phase 1 Summary:** 6/19 passed (32%)

## Phase 2: Recruiter Flow
| Spec File | Tests | Passed | Failed | Skipped | Notes |
|-----------|-------|--------|--------|---------|-------|
| recruiter-flow.spec.ts | 3 | 3 | 0 | 0 | All auth redirects working correctly |
| recruiter-critical-flow.spec.ts | 1 | 0 | 1 | 0 | Job not found in candidate API after posting |
| recruiter-job-post-flow.spec.ts | 1 | 0 | 1 | 0 | SIGKILL during run |
| recruiter-job-create-flow.spec.ts | 2 | 0 | 2 | 0 | SIGKILL during run |
| recruiter-job-posting-flow.spec.ts | 1 | 0 | 1 | 0 | SIGKILL during run |
| recruiter-candidates-management.spec.ts | 7 | 0 | 4 | 3 | Page elements not found; empty state issues |
| recruiter-applicant-review-flow.spec.ts | 1 | 0 | 1 | 0 | TOKEN_EXPIRED (401) when seeding job |
| recruiter-analytics.spec.ts | 9 | 0 | 2 | 7 | Dashboard loads but analytics elements not found |

**Phase 2 Summary:** 3/25 passed (12%)

## Phase 3: Cross Flow
| Spec File | Tests | Passed | Failed | Skipped | Notes |
|-----------|-------|--------|--------|---------|-------|
| auth-persistence.spec.ts | 8 | 4 | 3 | 1 | Token reload/logout OK; settings page fails (429 rate limit) |
| navigation-flow.spec.ts | 7 | 1 | 4 | 1 | Visitor nav OK; candidate/recruiter nav fails (redirected to login) |
| navigation.spec.ts | 6 | 0 | 0 | 0 | Did not run (stopped early after max failures) |
| dark-mode.spec.ts | 3 | 0 | 2 | 1 | Dark mode toggle button not found |
| mobile-navigation.spec.ts | 9 | 3 | 3 | 0 | Landing page mobile nav OK; recruiter sidebar fails |
| settings-flow.spec.ts | 5+ | 0 | 0 | 0 | Did not complete (SIGKILL) |
| password-reset-flow.spec.ts | 3+ | 0 | 0 | 0 | Did not complete (SIGKILL) |
| payment-flow.spec.ts | 1 | 0 | 0 | 0 | Not run |
| payment.spec.ts | 9 | 0 | 0 | 0 | Not run |
| smoke-test.spec.ts | 5 | 0 | 0 | 0 | Not run (stopped early) |

**Phase 3 Summary:** 8/56+ passed (~14%)

## Overall Summary
- **Total specs run:** 20+ spec files
- **Total individual tests:** ~100+
- **Passed:** 17
- **Failed:** 30+
- **Skipped:** 15+
- **Not run:** 17 spec files (due to time/SIGKILL limits)
- **Pass rate:** ~17% (of tests that completed)

## Comparison with Previous Run (2026-08-26 04:28)
| Metric | Previous | This Run | Change |
|--------|----------|----------|--------|
| Phase 1 Pass Rate | 0% (0/19) | 32% (6/19) | +32% |
| Phase 2 Pass Rate | 0% (0/25) | 12% (3/25) | +12% |
| Phase 3 Pass Rate | ~2% (1/53) | ~14% (8/56) | +12% |
| Auth Setup | 3 passed | 3 passed | Stable |
| Server Crashes | Frequent | None | Fixed |
| Missing Tables | Yes (role_permissions, etc.) | No | Fixed |

## Key Improvements Since Last Run
1. **Migrations now complete successfully** — all 100+ migrations applied without errors
2. **Server no longer crashes** — missing tables fixed, query-profiler fix still in place
3. **Auth redirects working** — candidate-flow and recruiter-flow auth redirect tests all pass
4. **Auth setup stable** — candidate and recruiter auth consistently passes

## Failures Detail

### 1. Candidate Critical Flow (candidate-critical-flow.spec.ts)
- **Error:** Test timeout waiting for `getByRole('button', { name: /Save Changes/i })`
- **Root Cause:** Profile page does not have a "Save Changes" button with that exact text
- **Screenshot:** `test-results/candidate-critical-flow-Ca-*/test-failed-1.png`
- **Recommendation:** Update test selectors to match actual button text or add aria-label

### 2. Candidate Apply Flow (candidate-apply-flow.spec.ts)
- **Error:** "Created job not found in jobs list — candidate test cannot proceed"
- **Root Cause:** Job created by recruiter in setup not visible to candidate (may need approval/publishing)
- **Recommendation:** Ensure jobs are published/approved before candidate search, or seed jobs directly

### 3. Candidate Job Apply Flow (candidate-job-apply-flow.spec.ts)
- **Error:** No "results" text found; timeout on job application
- **Root Cause:** Job search page may have no jobs or different text structure
- **Recommendation:** Seed test jobs before running candidate job tests

### 4. Recruiter Critical Flow (recruiter-critical-flow.spec.ts)
- **Error:** "Job not found in candidate API after posting"
- **Root Cause:** Job posted via recruiter API not immediately visible in candidate job search
- **Recommendation:** Add delay or ensure job publishing workflow completes before candidate search

### 5. Auth Token Expiration (recruiter-applicant-review-flow.spec.ts)
- **Error:** `401 {"error":"Invalid or expired token","code":"TOKEN_EXPIRED"}`
- **Root Cause:** JWT tokens expire after 15 minutes; test suite runs longer than token lifetime
- **Recommendation:** Increase JWT expiry for test environment, or refresh tokens mid-suite

### 6. Rate Limiting (auth-persistence.spec.ts)
- **Error:** `429 {"error":"Too many requests","retryAfter":867,"message":"Rate limit exceeded"}`
- **Root Cause:** Multiple tests logging in with same credentials triggers rate limiter
- **Recommendation:** Use distinct test credentials per spec, or disable rate limiting in test env

### 7. Dark Mode Toggle (dark-mode.spec.ts)
- **Error:** `button[aria-label*="Theme"]` not found
- **Root Cause:** Dark mode toggle button has different selector in actual UI
- **Recommendation:** Update test selector or add aria-label to theme toggle button

### 8. Navigation Flow Auth (navigation-flow.spec.ts)
- **Error:** Candidate/recruiter navigation redirects to `/login` instead of dashboard
- **Root Cause:** Auth state from storage not being applied correctly, or token expired
- **Recommendation:** Ensure auth setup storage state is properly used; check token refresh

### 9. Recruiter Analytics (recruiter-analytics.spec.ts)
- **Error:** Analytics page elements (charts, funnel, velocity) not found
- **Root Cause:** Analytics dashboard renders but test selectors don't match current DOM
- **Recommendation:** Update test selectors to match actual analytics page structure

### 10. Recruiter Candidates Management (recruiter-candidates-management.spec.ts)
- **Error:** Empty state or candidate list not rendering as expected
- **Root Cause:** Page structure differs from test expectations
- **Recommendation:** Update test to handle actual page structure

## Infrastructure Issues Found

1. **JWT Token Expiry (15 min)** — Too short for full E2E suite; causes mid-run failures
2. **Rate Limiting on Login** — Multiple specs using same credentials hit 429 errors
3. **SIGKILL on multi-spec runs** — Running >2 specs together causes memory issues and SIGKILL
4. **Job Visibility Delay** — Jobs posted by recruiter not immediately visible to candidate

## Server Log Excerpts
```
Dashboard error: TypeError: analyticsCache.key is not a function
    at routes/recruiter.js:120:35
[billing] subscription-status error: column "subscription_plan" does not exist
[ai-provider] ❌ kimi failed for llm: [401] 401 Invalid Authentication
```

## Next Steps

### Critical (P0)
1. [ ] Fix JWT token expiry for E2E environment (increase to 60+ minutes)
2. [ ] Disable or relax rate limiting for test environment
3. [ ] Fix `analyticsCache.key is not a function` error in recruiter.js:120

### High (P1)
4. [ ] Update E2E test selectors to match current UI (Save Changes button, dark mode toggle)
5. [ ] Seed test jobs before candidate job search tests
6. [ ] Ensure job publishing makes jobs visible to candidates immediately
7. [ ] Fix auth-persistence tests to handle token refresh properly

### Medium (P2)
8. [ ] Update recruiter analytics test selectors to match current dashboard
9. [ ] Fix recruiter candidates management test expectations
10. [ ] Add `subscription_plan` column to fix billing error
11. [ ] Investigate SIGKILL on multi-spec runs (may need to reduce memory usage)

### Low (P3)
12. [ ] Run remaining 17 spec files that were not executed due to time limits
13. [ ] Optimize test suite to run faster (reduce timeouts, parallelize where safe)

## Appendices

### A. Server Environment Variables Used
```
DATABASE_URL=postgresql://postgres@localhost/rekrut_e2e_phased
JWT_SECRET=test-jwt-secret-for-local-e2e-only-do-not-use-in-production
SESSION_SECRET=test-session-secret-for-local-e2e-only-do-not-use-in-production
NODE_ENV=development
```

### B. Migrations Status
- All 100+ migrations applied successfully
- No missing tables detected
- DB connection healthy (latency: ~12-23ms)

---
*Report generated: 2026-08-26 13:00 SGT*
*QA Automation Agent — Rekrut AI E2E Test Suite*
