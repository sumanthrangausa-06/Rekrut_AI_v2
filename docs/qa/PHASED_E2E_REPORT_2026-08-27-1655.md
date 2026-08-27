# Rekrut AI — Phased E2E Test Report
**Date:** 2026-08-27
**Run ID:** 2026-08-27-1655
**Branch:** dev
**Commit:** db1a6dd
**Environment:** Local (localhost:3000)

## Setup Status
- [x] Local DB ready (rekrut_e2e_phased)
- [x] Server running (PID 574560)
- [x] Playwright browsers installed
- [x] Auth setup completed (4/4 passed)

## Phase 1: Candidate Flow
| Spec File | Result | Notes |
|-----------|--------|-------|
| application-submission-flow.spec.ts | SKIPPED (2) | Requires high profile completeness |
| candidate-apply-flow.spec.ts | FAIL | Created job not found in jobs list — seeding issue |
| candidate-critical-flow.spec.ts | PASS (Mobile) / FAIL (Desktop) | Desktop: Apply button not found |
| candidate-flow.spec.ts | PASS (6/6) | All redirect-to-login tests passed |
| candidate-full-journey.spec.ts | PASS | Full signup→apply journey works |
| candidate-job-apply-flow.spec.ts | FAIL (2/2) | Seeded job not found; filter returns empty |
| candidate-profile-flow.spec.ts | FAIL | Headline value mismatch (test data collision) |

**Phase 1 Summary:** 8 passed, 5 failed, 2 skipped, 4 did not run (maxFailures cap)

## Phase 2: Recruiter Flow
| Spec File | Result | Notes |
|-----------|--------|-------|
| recruiter-analytics.spec.ts | FAIL (1/6) | Application sources breakdown: 0 visible elements |
| recruiter-analytics.spec.ts | PASS (5/6) | Dashboard, funnel, velocity, OmniScore, advanced |
| recruiter-applicant-review-flow.spec.ts | PASS | Full shortlist/reject flow works |
| recruiter-candidates-management.spec.ts | SKIPPED (7/7) | Test.skip() — page structure changed |
| recruiter-critical-flow.spec.ts | PASS | Full recruiter journey works |
| recruiter-flow.spec.ts | PASS (3/3) | All redirect-to-login tests passed |
| recruiter-job-create-flow.spec.ts | FAIL (1/2) | Job not found in candidate search after creation |
| recruiter-job-create-flow.spec.ts | PASS (1/2) | Edit job + verify update works |
| recruiter-job-post-flow.spec.ts | PASS | Full post→apply→pipeline flow works |

**Phase 2 Summary:** 13 passed, 2 failed, 7 skipped

## Phase 3: Cross Flow
| Spec File | Result | Notes |
|-----------|--------|-------|
| auth-persistence.spec.ts | PASS (7/8) | Token persistence, direct nav, jobs page responsive |
| auth-persistence.spec.ts | SKIPPED (1/8) | Logout test skipped |
| dark-mode.spec.ts | PASS (2/3) | Toggle + persist works; landing page skipped |
| mobile-navigation.spec.ts | PASS (10/10) | All mobile nav tests passed |
| navigation-flow.spec.ts | FAIL (2/3) | Candidate nav → apply broken; integration flow broken |
| navigation-flow.spec.ts | PASS (1/3) | Visitor navigation works |
| navigation.spec.ts | PASS (6/6) | All basic navigation tests passed |
| password-reset-flow.spec.ts | PASS (4/4) | Full reset flow works |
| payment-flow.spec.ts | PASS (1/1) | Upgrade payment works |
| payment.spec.ts | PASS (8/8) | All Stripe flow tests passed |
| settings-flow.spec.ts | FAIL (3/3) | Tabs (Profile, Account) not found — page structure mismatch |
| smoke-test.spec.ts | DID NOT RUN | Stopped after maxFailures |

**Phase 3 Summary:** 39 passed, 5 failed, 2 skipped, 9 did not run (maxFailures cap)

## Overall Summary
- Total specs run: 96 tests across 23 spec files
- Passed: 60
- Failed: 12
- Skipped: 11
- Did not run: 13 (maxFailures cap)
- Pass rate (of tests that ran): **83.3%** (60/72)
- New GitHub issues created: 0 (all patterns match existing issues)
- Existing issues updated with reproductions: 6

## Failures Detail

### 1. Job Seeding/Search Visibility (Multiple specs)
- **Specs affected:** candidate-apply-flow, candidate-job-apply-flow, recruiter-job-create-flow, navigation-flow integration
- **Error:** "Created/Seeded job not found in jobs list"
- **GitHub Issue:** #188 — [E2E] Jobs posted by recruiter not immediately visible to candidate
- **Recommendation:** Add explicit wait/retry after job creation before candidate search; or seed jobs via API before test

### 2. Apply Button/Form Missing (Candidate Flow)
- **Specs affected:** candidate-critical-flow (Desktop), candidate-apply-flow, navigation-flow candidate nav
- **Error:** "Application/Apply/Cover Letter element not found"
- **GitHub Issue:** #196 — [E2E] Candidate Navigation: redirected to /candidate/saved-jobs instead of /candidate/jobs
- **Recommendation:** Check if apply button is conditionally rendered; verify job state (active/closed)

### 3. Settings Page Tabs Not Rendering
- **Specs affected:** settings-flow (all 3 tests)
- **Error:** "Profile/Account tab not found" — element timeout
- **GitHub Issue:** #190 — [E2E] Settings page heading not found — page structure mismatch
- **Recommendation:** Settings page may have been restructured; update selectors to match new UI

### 4. Analytics Application Sources Empty
- **Specs affected:** recruiter-analytics
- **Error:** visibleCount >= 1 failed (got 0)
- **GitHub Issue:** #198 — [E2E] Recruiter Analytics: Application Sources breakdown shows 0 visible elements
- **Recommendation:** Application sources section may be hidden when no data; add data seeding or conditional skip

### 5. Profile Headline Value Mismatch
- **Specs affected:** candidate-profile-flow
- **Error:** Expected "E2E QA Engineer 1787850214406" got "E2E QA Engineer 1787706505966"
- **GitHub Issue:** #199 — [E2E] Candidate Profile Flow: headline value mismatch between edit and verify
- **Recommendation:** Test data collision from parallel runs or stale DB; use deterministic test data or DB reset

### 6. End-to-End Integration Flow Failure
- **Specs affected:** navigation-flow
- **Error:** Test fails in ~320ms — likely early assertion failure
- **GitHub Issue:** #197 — [E2E] End-to-End Integration: job creation API fails in cross-flow test
- **Recommendation:** Check job creation API response; verify auth state between role switches

## Server Log Excerpts
Server started successfully on localhost:3000. Health check passed:
- DB connected, latency 15ms
- All required tables exist
- JWT_SECRET and SESSION_SECRET configured

No critical server errors observed during test run.

## Recommendations

### P0 (Launch Blockers)
1. **Fix job visibility delay** — Jobs created by recruiter not immediately searchable by candidate (#188)
2. **Fix apply button rendering** — Candidate cannot apply to jobs (#196)

### P1 (Critical)
3. **Fix settings page structure** — Tabs not found in current UI (#190)
4. **Fix E2E integration flow** — Cross-role job creation + apply broken (#197)

### P2 (Important)
5. **Fix analytics empty state** — Application sources needs data or conditional handling (#198)
6. **Fix profile test data** — Use deterministic values to avoid collision (#199)

### Infrastructure
7. **Increase maxFailures** for full suite runs — Current cap of 5 truncates report; consider raising to 10 for complete diagnostics
8. **Run with CI=true** to enable retries (retries: 2) for flaky tests
9. **Seed test data via API** instead of UI to reduce test runtime and flakiness

## Next Steps
- [ ] Fix #188 — job visibility after creation
- [ ] Fix #196 — candidate apply button/flow
- [ ] Fix #190 — settings page tabs
- [ ] Fix #197 — cross-flow integration
- [ ] Re-run E2E suite after fixes
- [ ] Consider running full suite without maxFailures cap for complete diagnostics
