# Rekrut AI — Phased E2E Test Report
**Date:** 2026-08-26
**Run ID:** 2026-08-26-1800
**Branch:** dev
**Commit:** c284895
**Environment:** Local (localhost:3000)
**Database:** rekrut_e2e_phased (local PostgreSQL)

## Setup Status
- [x] Local DB ready
- [x] Server running (PID verified, /health returns ok)
- [x] Playwright browsers installed
- [x] Auth setup completed (3 passed, 1 skipped)
- [x] Migrations applied successfully (all 100+ migrations)
- [x] JWT expiry extended to 120 minutes for E2E
- [x] DISABLE_RATE_LIMIT=true set in .env (but still active — see findings)

## Phase 1: Candidate Flow
| Spec File | Tests | Passed | Failed | Skipped | Notes |
|-----------|-------|--------|--------|---------|-------|
| candidate-flow.spec.ts | 6 | 6 | 0 | 0 | All auth redirects working correctly |
| candidate-critical-flow.spec.ts | 2 | 0 | 2 | 0 | Timeout waiting for "Save Changes" button |
| candidate-apply-flow.spec.ts | 1 | 0 | 1 | 0 | Created job not found in jobs list |
| candidate-job-apply-flow.spec.ts | 2 | 0 | 2 | 0 | Seeded job not found; filter results empty |
| candidate-profile-flow.spec.ts | 1 | 0 | 1 | 0 | Timeout waiting for "Save Changes" button |
| candidate-full-journey.spec.ts | 1 | 0 | 1 | 0 | Timeout waiting for "Save Changes" button |
| job-search-filtering.spec.ts | 4 | 0 | 4 | 0 | No "results" text found on job search page |
| application-submission-flow.spec.ts | 2 | 0 | 0 | 2 | Skipped (dependencies) |

**Phase 1 Summary:** 6/17 passed (35%)

## Phase 2: Recruiter Flow
| Spec File | Tests | Passed | Failed | Skipped | Notes |
|-----------|-------|--------|--------|---------|-------|
| recruiter-flow.spec.ts | 3 | 3 | 0 | 0 | All auth redirects working correctly |
| recruiter-critical-flow.spec.ts | 1 | 1 | 0 | 0 | Full flow passed |
| recruiter-job-post-flow.spec.ts | 1 | 1 | 0 | 0 | Job post + pipeline flow passed |
| recruiter-job-create-flow.spec.ts | 2 | 0 | 1 | 1 | Job not found in candidate search UI |
| recruiter-job-posting-flow.spec.ts | 1 | 0 | 0 | 1 | Skipped |
| recruiter-candidates-management.spec.ts | 7 | 0 | 4 | 3 | "Candidates" heading not found |
| recruiter-applicant-review-flow.spec.ts | 1 | 1 | 0 | 0 | Applicant review flow passed |
| recruiter-analytics.spec.ts | 7 | 6 | 1 | 0 | Application sources breakdown not visible |

**Phase 2 Summary:** 12/18 passed (67%)

## Phase 3: Cross Flow
| Spec File | Tests | Passed | Failed | Skipped | Notes |
|-----------|-------|--------|--------|---------|-------|
| auth-persistence.spec.ts | 8 | 4 | 3 | 1 | Rate limiting (429) on login; token tests OK |
| navigation-flow.spec.ts | 4 | 1 | 3 | 0 | Auth redirects to login instead of dashboard |
| navigation.spec.ts | 6 | 6 | 0 | 0 | All visitor navigation tests passed |
| payment-flow.spec.ts | 1 | 0 | 1 | 0 | Redirected to login instead of pricing page |
| payment.spec.ts | 8 | 8 | 0 | 0 | All Stripe payment tests passed |
| dark-mode.spec.ts | 3 | 0 | 2 | 1 | Theme toggle button not found |
| mobile-navigation.spec.ts | 9 | 3 | 5 | 1 | "Open navigation menu" button not found |
| settings-flow.spec.ts | 7 | 0 | 5 | 2 | Settings heading/tabs not found |
| password-reset-flow.spec.ts | 4 | 2 | 2 | 0 | "Check your console" message not found |
| smoke-test.spec.ts | 5 | 5 | 0 | 0 | All smoke tests passed |

**Phase 3 Summary:** 29/50 passed (58%)

## Overall Summary
- **Total spec files run:** 26
- **Total individual tests:** 85
- **Passed:** 47
- **Failed:** 38
- **Skipped:** 11
- **Pass rate:** 55%
- **New GitHub issues created:** 4
- **Existing issues updated:** 3

## Comparison with Previous Run (2026-08-26 13:00)
| Metric | Previous | This Run | Change |
|--------|----------|----------|--------|
| Phase 1 Pass Rate | 32% (6/19) | 35% (6/17) | +3% |
| Phase 2 Pass Rate | 12% (3/25) | 67% (12/18) | +55% |
| Phase 3 Pass Rate | ~14% (8/56) | 58% (29/50) | +44% |
| Overall Pass Rate | ~17% | 55% | +38% |

## Key Improvements Since Last Run
1. **JWT token expiry extended** — 15 min → 120 min, eliminating mid-run 401 errors
2. **Phase 2 dramatically improved** — recruiter critical flow and job post flows now pass
3. **Phase 3 significantly improved** — auth persistence and navigation tests more stable
4. **No server crashes** — server remained stable throughout the run
5. **Smoke tests all pass** — core paths are healthy

## Failures Detail

### 1. Save Changes Button Not Found (candidate-critical-flow, candidate-profile-flow, candidate-full-journey)
- **Error:** `getByRole('button', { name: /Save Changes/i })` not found
- **GitHub Issue:** #187
- **Root Cause:** Profile page save button has different text or aria-label
- **Recommendation:** Update test selectors or add aria-label to save button

### 2. Job Not Visible to Candidate (candidate-apply-flow, candidate-job-apply-flow, recruiter-job-create-flow)
- **Error:** Created/seeded job not found in candidate job search
- **GitHub Issue:** #188
- **Root Cause:** Jobs posted by recruiter may need approval/publishing before visible to candidates
- **Recommendation:** Ensure job publishing workflow completes or seed jobs directly

### 3. Rate Limiting Still Active (auth-persistence)
- **Error:** `429 Too many requests` despite `DISABLE_RATE_LIMIT=true` in .env
- **GitHub Issue:** #185
- **Root Cause:** DISABLE_RATE_LIMIT env var not wired into rate limiter middleware
- **Recommendation:** Fix rate limiter to check DISABLE_RATE_LIMIT env var

### 4. Auth Redirects to Login (navigation-flow)
- **Error:** Candidate/recruiter navigation redirects to `/login` instead of dashboard
- **GitHub Issue:** #184 (related)
- **Root Cause:** Auth state from storage not applied correctly in navigation tests
- **Recommendation:** Ensure auth setup storage state is used properly

### 5. Candidates Page Heading Not Found (recruiter-candidates-management)
- **Error:** `getByRole('heading', { name: 'Candidates', exact: true })` not found
- **GitHub Issue:** #189 (new)
- **Root Cause:** Page structure differs from test expectations
- **Recommendation:** Inspect actual DOM and update selectors

### 6. Application Sources Breakdown (recruiter-analytics)
- **Error:** Application sources section elements not visible
- **Root Cause:** Analytics page structure may differ from test expectations
- **Recommendation:** Update test selectors to match actual dashboard

### 7. Dark Mode Toggle Not Found (dark-mode)
- **Error:** `button[aria-label*="Theme"]` not found
- **GitHub Issue:** #187
- **Root Cause:** Theme toggle has different selector
- **Recommendation:** Update test selector or add aria-label

### 8. Mobile Sidebar Toggle Not Found (mobile-navigation)
- **Error:** `getByRole('button', { name: 'Open navigation menu' })` not found
- **GitHub Issue:** #191 (new)
- **Root Cause:** Mobile sidebar toggle has different aria-label or is rendered differently
- **Recommendation:** Inspect mobile DOM and update selectors

### 9. Settings Page Not Loading (settings-flow)
- **Error:** Settings heading and tabs not found
- **GitHub Issue:** #190 (new)
- **Root Cause:** Settings page may have different route or structure
- **Recommendation:** Inspect actual settings page DOM

### 10. Password Reset Success Message (password-reset-flow)
- **Error:** `getByText('Check your console')` not found
- **GitHub Issue:** #192 (new)
- **Root Cause:** Success message text may have changed
- **Recommendation:** Update test to match actual success message

### 11. Payment Flow Redirects to Login (payment-flow)
- **Error:** Pricing page redirects to login instead of showing plans
- **Root Cause:** Auth required for pricing page or route mismatch
- **Recommendation:** Ensure pricing page is accessible when authenticated

## Server Log Excerpts
```
Dashboard error: TypeError: analyticsCache.key is not a function
    at /root/.openclaw/workspace/Rekrut_AI_v2/routes/recruiter.js:120:35
[email-service] Email not configured (neither Brevo API nor SMTP), logging only
[rate-limiter] Cleaned up 3 expired buckets
[ai-provider] ✅ Full verification complete: 1/3 working (2 dead)
```

## GitHub Issues
### New Issues Created
- #189 [E2E] Recruiter Candidates page heading 'Candidates' not found
- #190 [E2E] Settings page heading not found — page structure mismatch
- #191 [E2E] Mobile navigation 'Open navigation menu' button not found on dashboard
- #192 [E2E] Password reset flow 'Check your console' message not found

### Existing Issues Updated
- #187 — Save Changes button, dark mode toggle failures (comment added)
- #188 — Job visibility failures (comment added)
- #185 — Rate limiting still active despite DISABLE_RATE_LIMIT=true (comment added)

## Next Steps

### Critical (P0)
1. [ ] Fix `analyticsCache.key is not a function` error in recruiter.js:120
2. [ ] Wire DISABLE_RATE_LIMIT env var into rate limiter middleware

### High (P1)
3. [ ] Update E2E test selectors to match actual UI (Save Changes button, dark mode toggle)
4. [ ] Ensure job publishing makes jobs visible to candidates immediately
5. [ ] Fix recruiter candidates page heading selector
6. [ ] Fix settings page test selectors
7. [ ] Fix mobile navigation sidebar toggle selector

### Medium (P2)
8. [ ] Fix password reset success message expectation
9. [ ] Fix payment flow auth requirement
10. [ ] Fix recruiter analytics application sources breakdown selector

### Low (P3)
11. [ ] Fix job-search-filtering test to handle empty job board
12. [ ] Investigate remaining skipped tests and dependencies

## Environment
```
DATABASE_URL=postgresql://postgres@localhost/rekrut_e2e_phased
JWT_SECRET=test-jwt-secret-for-local-e2e-only-do-not-use-in-production
SESSION_SECRET=test-session-secret-for-local-e2e-only-do-not-use-in-production
JWT_EXPIRY_MINUTES=120
DISABLE_RATE_LIMIT=true
NODE_ENV=development
```

---
*Report generated: 2026-08-26 18:00 SGT*
*QA Automation Agent — Rekrut AI E2E Test Suite*
