# E2E Test Results — Rekrut AI v2

**Run Date:** 2026-06-08  
**Test Runner:** Playwright (Chromium, 1 worker)  
**Strategy:** Individual spec files (per-file execution to avoid SIGKILL/memory limits)  
**Total Spec Files Run:** 25  

---

## ✅ Passing Files (18/25)

| # | File | Passed | Skipped | Notes |
|---|------|--------|---------|-------|
| 1 | `admin-critical-flow.spec.ts` | 2 | 2 | Auth setup skipped (valid) |
| 2 | `navigation-flow.spec.ts` | 6 | 2 | Full end-to-end integration passes |
| 3 | `admin-dashboard-flow.spec.ts` | 1 | 2 | Dashboard loads |
| 4 | `ai-coaching-flow.spec.ts` | 3 | 2 | All tabs load correctly |
| 5 | `auth-persistence.spec.ts` | 8 | 2 | Token persistence, logout, settings |
| 6 | `candidate-critical-flow.spec.ts` | 2 | 2 | Desktop + mobile signup→apply flow |
| 7 | `candidate-flow.spec.ts` | 6 | 2 | All redirect-to-login checks pass |
| 8 | `candidate-profile-flow.spec.ts` | 1 | 2 | Edit/save profile OK |
| 9 | `dark-mode.spec.ts` | 2 | 3 | Dark mode toggle + persistence |
| 10 | `navigation.spec.ts` | 6 | 2 | Public nav links all work |
| 11 | `payment-flow.spec.ts` | 1 | 2 | Recruiter upgrade payment OK |
| 12 | `payment.spec.ts` | 8 | 2 | Stripe checkout, success/cancel states |
| 13 | `public-pages.spec.ts` | 5 | 2 | Login, register, pricing, blog, home |
| 14 | `recruiter-critical-flow.spec.ts` | 1 | 2 | Signup→post job→shortlist |
| 15 | `recruiter-flow.spec.ts` | 3 | 2 | Redirect-to-login checks |
| 16 | `debug-candidate.spec.ts` | 1 | 2 | **Jobs page has 10 cards** |
| 17 | `debug-jobs-html.spec.ts` | 1 | 2 | **10 cursor-pointer, 15 job/card elements** |
| 18 | `debug-localStorage.spec.ts` | 1 | 2 | API returns 50 jobs, token valid |

---

## ❌ Failing Files (6/25)

| # | File | Failed | Passed | Skipped | Key Error |
|---|------|--------|--------|---------|-----------|
| 1 | `application-submission-flow.spec.ts` | 1 | 0 | 3 | `count=0` — no job cards found on jobs page |
| 2 | `job-search-filtering.spec.ts` | 4 | 2 | 0 | 0 results on jobs page; 1 timeout waiting for `select` filter |
| 3 | `mobile-navigation.spec.ts` | 5 | 1 | 2 | **Server crash** (`ERR_CONNECTION_REFUSED`) after pricing page failure; maxFailures triggered |
| 4 | `recruiter-analytics.spec.ts` | 1 | 8 | 2 | `ENOENT: e2e/.auth/recruiter.json` missing during final test |
| 5 | `recruiter-job-post-flow.spec.ts` | 1 | 0 | 2 | `Active Jobs` text not found after posting job |
| 6 | `recruiter-job-posting-flow.spec.ts` | 1 | 0 | 2 | **120s timeout** waiting for job edit form placeholder |

---

## ⚠️ Skipped-Only Files (1/25)

| File | Skipped | Reason |
|------|---------|--------|
| `candidate-apply-flow.spec.ts` | 1 | Test skipped itself because created job was not found or already applied |

---

## 🔴 Critical Issues Found

### 1. Server Instability (CRITICAL)
**File:** `mobile-navigation.spec.ts`  
**Symptom:** After the first test failure (`Pricing|Plans` heading not found), the server crashed and all subsequent tests got `ERR_CONNECTION_REFUSED`.  
**Impact:** Any test suite that hits 5 failures will abort entirely due to `maxFailures: 5`.  
**Likely Cause:** The first failure may trigger an unhandled exception or the mobile viewport causes a server-side crash. The web server (`node server.js`) died and had to be manually restarted.

### 2. Jobs Page Data Flakiness (HIGH)
**Files:** `application-submission-flow.spec.ts`, `job-search-filtering.spec.ts`, `candidate-apply-flow.spec.ts`  
**Symptom:** Tests expect >0 jobs but find 0.  
**But:** Debug tests (`debug-candidate.spec.ts`, `debug-jobs-html.spec.ts`, `debug-localStorage.spec.ts`) run minutes later and confirm **10 job cards and 50 API jobs exist**.  
**Likely Cause:** Either (a) the server was restarted between test runs and lost seeded data, (b) there's a race condition where jobs aren't loaded immediately, or (c) the `.cursor-pointer` selector is unreliable for some page states.  
**Note:** The debug tests explicitly show `JOB CARDS COUNT: 10` and `API JOB COUNT: 50`, so the data exists but the failing tests may be running at a moment when the page hasn't fully hydrated.

### 3. Missing Auth State File (MEDIUM)
**File:** `recruiter-analytics.spec.ts` (test 11 of 11)  
**Symptom:** `ENOENT: e2e/.auth/recruiter.json`  
**Likely Cause:** The auth setup was skipped because it thought the file was valid, but something deleted it before the last test. Possibly a cleanup script or another process. The file was present for all prior tests in the same file.

### 4. Job Posting UI Regression (MEDIUM)
**File:** `recruiter-job-post-flow.spec.ts`  
**Symptom:** After posting a job and navigating to `/recruiter/jobs`, the text `Active Jobs` is not found.  
**Likely Cause:** The page may now use different copy (e.g., "My Jobs", "Posted Jobs", "Job Listings") or the page structure changed.

### 5. Job Edit Flow Timeout (MEDIUM)
**File:** `recruiter-job-posting-flow.spec.ts`  
**Symptom:** 120s timeout waiting for `getByPlaceholder(/e.g. Senior Software Engineer/i)` during the edit step.  
**Likely Cause:** The edit modal/page may not render the expected placeholder, or the edit flow is broken (e.g., job doesn't open in edit mode, or the form is slow to load).

---

## 📊 Coverage Summary

| Domain | Tests | Status | Notes |
|--------|-------|--------|-------|
| **Auth & Login** | 30+ | ✅ Solid | Login, register, token persistence, logout, redirects all pass |
| **Navigation** | 15+ | ✅ Solid | Public nav, candidate nav, recruiter nav pass |
| **Admin Panel** | 4 | ✅ Solid | Dashboard, analytics, agents all load |
| **Candidate Profile** | 2 | ✅ Solid | Edit/save profile works |
| **AI Coaching** | 3 | ✅ Solid | All tabs load and switch |
| **Payment / Stripe** | 9 | ✅ Solid | Pricing, checkout, success/cancel all pass |
| **Public Pages** | 5 | ✅ Solid | Home, login, register, pricing, blog |
| **Recruiter Analytics** | 8 | ✅ Solid | Charts, funnel, metrics, filters render |
| **Recruiter Job Posting** | 2 | ❌ Broken | Job listing and edit flows fail |
| **Job Search / Filtering** | 4 | ❌ Broken | 0 results found; UI selectors may be stale |
| **Application Submission** | 2 | ❌ Broken | Can't find jobs to apply to |
| **Mobile Navigation** | 5 | ❌ Broken | Server crashes; pricing page missing |

---

## 🎯 Recommendations

1. **Investigate server crash:** Run `mobile-navigation.spec.ts` in isolation and monitor server logs. The crash after the pricing page test suggests an unhandled exception in the server.
2. **Fix job page flakiness:** Add explicit waits or use `page.waitForResponse` for the jobs API before asserting job card counts. The debug tests prove the data exists, so it's a timing/loading issue.
3. **Audit UI copy:** Verify `Active Jobs`, `Pricing|Plans`, and `All Types` select element still exist in the current UI. Update selectors if copy changed.
4. **Fix job edit flow:** Check why the edit form placeholder isn't found. The 120s timeout suggests the edit modal may not open at all.
5. **Investigate auth file deletion:** Ensure no process deletes `e2e/.auth/*.json` during test runs. Consider adding a retry/regeneration step if the file goes missing.
6. **Retry failing tests individually:** After fixes, re-run the 6 failing files in isolation to confirm.

---

*QA Specialist — Model QA Specialist*  
*Date: 2026-06-08*
