# Rekrut AI — Phased E2E Test Report
**Date:** $(date -u +%Y-%m-%dT%H:%M:%SZ)
**Run ID:** 2026-08-28-1700
**Branch:** $BRANCH
**Commit:** $COMMIT
**Environment:** Local (localhost:3000)

## Setup Status
- [x] Local DB ready (rekrut_e2e_phased)
- [x] Server running (port 3000)
- [x] Playwright browsers installed
- [x] Auth setup completed (4/4 passed)

## CRITICAL FINDING: Root Cause Identified

**Issue #202:** [React frontend completely broken — JS bundle 404 causes blank pages across all routes](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/202)

The React frontend application is not rendering on **any route** because the JavaScript bundle files return HTTP 404. The page stays stuck at `<div id="root"></div>`.

**Evidence:**
- Server serves index.html referencing: `/assets/index-24jZ9sVk.js`
- `client/dist/index.html` references: `/assets/index-DvgxYq4K.js`
- `client/dist/assets/` actually contains: `index-BHl95OzH.js`

Three different hashes — the build is completely inconsistent. This single root cause explains **ALL** UI-related test failures across all phases.

---

## Phase 1: Candidate Flow (8 specs)

| Spec File | Result | Notes |
|-----------|--------|-------|
| candidate-flow.spec.ts | **5 FAILED** | Auth redirects not working — pages don't redirect to /login |
| candidate-critical-flow.spec.ts | **2 FAILED** | Register page blank — "Create an account" not found |
| candidate-apply-flow.spec.ts | **1 FAILED** | Job search blank — no "active jobs" text |
| candidate-job-apply-flow.spec.ts | **2 FAILED** | Job search blank — no results text |
| candidate-profile-flow.spec.ts | **1 FAILED** | Settings button not found (page blank) |
| candidate-full-journey.spec.ts | **1 FAILED** | Register page blank |
| job-search-filtering.spec.ts | **4 FAILED** | All filters — no "active jobs" or "results" text |
| application-submission-flow.spec.ts | **2 FAILED** | Job search blank, one-click apply not found |

**Phase 1 Summary: 0 passed, 18 failed, 0 skipped**

**Root cause:** All failures traced to JS bundle 404 → React app never mounts → pages render blank.

---

## Phase 2: Recruiter Flow (8 specs)

| Spec File | Result | Notes |
|-----------|--------|-------|
| recruiter-flow.spec.ts | **3 FAILED** | Auth redirects not working |
| recruiter-critical-flow.spec.ts | **1 FAILED** | Recruiter dashboard blank |
| recruiter-job-post-flow.spec.ts | **1 FAILED** | "Post New Job" button not found (page blank) |
| recruiter-job-create-flow.spec.ts | **2 FAILED** | Post New Job button not found, title input not found |
| recruiter-job-posting-flow.spec.ts | **1 FAILED** | Page blank |
| recruiter-candidates-management.spec.ts | **4 FAILED, 3 skipped** | Page headings not found |
| recruiter-applicant-review-flow.spec.ts | **1 FAILED** | API auth: TOKEN_EXPIRED (401) |
| recruiter-analytics.spec.ts | **2 FAILED, 5 skipped** | "Hiring Analytics" heading not found |

**Phase 2 Summary: 0 passed, 15 failed, 8 skipped**

**Root cause:** UI failures traced to JS bundle 404. API auth failure (#184) is a separate issue.

---

## Phase 3: Cross Flow (10 specs)

| Spec File | Result | Notes |
|-----------|--------|-------|
| auth-persistence.spec.ts | **5 FAILED, 1 skipped** | Token persists but pages blank, job search blank |
| navigation-flow.spec.ts | **4 FAILED** | Homepage nav broken, candidate/recruiter nav blank |
| navigation.spec.ts | **5 FAILED** | All nav links — pages don't load expected content |
| payment-flow.spec.ts | **1 FAILED** | "Choose a plan" heading not found |
| payment.spec.ts | **5 FAILED, 2 passed** | Pricing page blank |
| dark-mode.spec.ts | **3 skipped** | Skipped (test logic) |
| mobile-navigation.spec.ts | **5 FAILED, 1 skipped** | Mobile nav button not found |
| settings-flow.spec.ts | **5 FAILED** | Settings page headings not found |
| password-reset-flow.spec.ts | **4 PASSED** | API-based tests — work correctly |
| smoke-test.spec.ts | **5 PASSED** | Basic health checks pass |

**Phase 3 Summary: 11 passed, 25 failed, 8 skipped**

**Root cause:** UI failures traced to JS bundle 404. Password-reset and smoke tests pass because they test API behavior or basic connectivity, not rendered UI.

---

## Overall Summary

| Metric | Count |
|--------|-------|
| Total specs run | 26 |
| Total tests run | ~77 |
| Passed | 11 |
| Failed | 58 |
| Skipped | 16 |
| Pass rate | **14.3%** |

| Category | Count |
|----------|-------|
| New GitHub issues created | 1 (#202) |
| Existing issues reproduced | 7+ (see below) |

---

## Failures Detail

### 1. Root Cause: JS Bundle Mismatch (P0)
- **Spec:** ALL UI-dependent specs
- **Error:** React app blank — `<div id="root"></div>`
- **Root cause:** `client/dist` build is inconsistent — index.html references JS files that don't exist in assets/
- **GitHub Issue:** #202
- **Recommendation:** Clean rebuild frontend (`cd client && npm run build`), verify hash consistency, restart server

### 2. Auth Redirect Failures (P1)
- **Spec:** candidate-flow, recruiter-flow, auth-persistence
- **Error:** Pages don't redirect to /login when not authenticated
- **Root cause:** Symptom of #202 — React auth guards never run because app doesn't mount
- **GitHub Issue:** Related to #184, #185
- **Recommendation:** Fix #202 first, then verify auth redirects

### 3. Register Page Blank (P1)
- **Spec:** candidate-critical-flow, candidate-full-journey, navigation
- **Error:** "Create an account" heading not found
- **Root cause:** Symptom of #202 — React app doesn't mount
- **GitHub Issue:** New pattern, tracked under #202
- **Recommendation:** Fix #202

### 4. Job Search Blank (P1)
- **Spec:** candidate-apply-flow, candidate-job-apply-flow, job-search-filtering, application-submission-flow, auth-persistence
- **Error:** "active jobs" / "results" text not found
- **Root cause:** Symptom of #202 — React app doesn't mount
- **GitHub Issue:** #195 (reproduced)
- **Recommendation:** Fix #202

### 5. Recruiter Dashboard Blank (P1)
- **Spec:** recruiter-critical-flow, recruiter-job-post-flow, recruiter-job-create-flow, recruiter-candidates-management, recruiter-analytics
- **Error:** Buttons, headings, inputs not found
- **Root cause:** Symptom of #202 — React app doesn't mount
- **GitHub Issue:** #189, #200 (reproduced)
- **Recommendation:** Fix #202

### 6. Navigation Links Broken (P1)
- **Spec:** navigation.spec.ts, navigation-flow.spec.ts
- **Error:** Links click but expected content doesn't appear
- **Root cause:** Symptom of #202 — client-side routing fails when React doesn't mount
- **GitHub Issue:** #196 (reproduced)
- **Recommendation:** Fix #202

### 7. Payment/Pricing Pages Blank (P2)
- **Spec:** payment.spec.ts, payment-flow.spec.ts
- **Error:** "Choose a plan" heading not found
- **Root cause:** Symptom of #202 — React app doesn't mount
- **GitHub Issue:** #193, #201 (reproduced)
- **Recommendation:** Fix #202

### 8. API Token Expired (P2)
- **Spec:** recruiter-applicant-review-flow, navigation-flow (API calls)
- **Error:** 401 {"error":"Invalid or expired token","code":"TOKEN_EXPIRED"}
- **Root cause:** Separate from #202 — JWT tokens used in API-based test setup are expiring mid-suite
- **GitHub Issue:** #184 (reproduced)
- **Recommendation:** Increase JWT expiry for E2E tests or implement token refresh in test setup

---

## Server Log Excerpts

```
Dashboard error: TypeError: analyticsCache.key is not a function
    at /root/.../routes/recruiter.js:120:35
[billing] subscription-status error: column "subscription_plan" does not exist
[email-service] Email not configured (neither Brevo API nor SMTP), logging only
```

Additional issues found in server logs (non-blocking for E2E but worth fixing):
- `analyticsCache.key is not a function` — tracked in #186
- `column "subscription_plan" does not exist` — database schema drift

---

## Existing Issues Reproduced

| Issue | Title | Reproduced? |
|-------|-------|-------------|
| #184 | JWT token expires during test suite | Yes (recruiter-applicant-review-flow) |
| #185 | Rate limiting blocks repeated login | Partial (auth setup passed with retries) |
| #186 | analyticsCache.key is not a function | Yes (server logs) |
| #189 | Recruiter Candidates page heading not found | Yes (recruiter-candidates-management) |
| #193 | Pricing page 'Choose a plan' not found | Yes (payment-flow) |
| #195 | Job Search Filtering timeout | Yes (job-search-filtering) |
| #196 | Candidate Navigation redirect issue | Yes (navigation-flow) |
| #200 | Recruiter job post form click timeout | Yes (recruiter-job-post-flow) |
| #201 | Payment checkout success not rendered | Yes (payment.spec.ts) |

---

## Next Steps

1. **P0 — Fix #202 immediately:**
   - `cd client && npm run build`
   - Verify `index.html` JS references match `assets/` files
   - Restart server to clear cache
   - Verify `curl http://localhost:3000/assets/index-*.js` returns 200

2. **Re-run E2E suite** after #202 is fixed to validate all UI-dependent tests

3. **Address #184** (JWT token expiry in tests) if still occurring after #202 fix

4. **Address #186** (analyticsCache error) — fix the cache initialization in recruiter.js

5. **Fix schema drift** — `subscription_plan` column missing in billing table

---

*Report generated automatically by E2E QA Automation Agent*
*Run completed: 2026-08-28T17:35Z*
