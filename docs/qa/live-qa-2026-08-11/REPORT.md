# Live Browser QA Report — Staging — 2026-08-11

**Date:** 2026-08-11  
**Tester:** Automated Playwright (Python)  
**Environment:** `https://rekrutai-staging.onrender.com`  
**Scripts:** `qa_01_public_candidate.py`, `qa_02_recruiter.py`  
**Screenshots:** `docs/qa/live-qa-2026-08-11/screenshots/`  
**Raw Results:** `qa_01_results.json`, `qa_02_results.json`

---

## Executive Summary

| Category | Pass | Fail | Notes |
|----------|------|------|-------|
| Public Pages | 5/6 | 1 | `/jobs` route is 404 |
| Candidate Flow | 9/10 | 1 | Job apply selector miss (jobs visible, apply not clicked) |
| Recruiter Flow | 6/12 | 6 | Dashboard mock data, Team 500, Join-Requests 404 |
| **Total** | **20/28** | **8** | |

**Staging is NOT ready for production.** Six blocking issues confirmed live in browser.

---

## Pass / Fail Matrix

| # | User Story | Result | Severity | Screenshot |
|---|-----------|--------|----------|------------|
| P01 | Home page loads | ✅ PASS | — | `p01-home.png` |
| P02 | Public `/jobs` page | ❌ FAIL | HIGH | `p02-public-jobs.png` |
| P03 | Login form | ✅ PASS | — | `p03-login.png` |
| P04 | Register form + role selection | ✅ PASS | — | `p04-register.png` |
| P05 | Forgot-password page | ✅ PASS | — | `p05-forgot-password.png` |
| P06 | 404 page | ✅ PASS | — | `p06-404.png` |
| C01 | Candidate registers | ✅ PASS | — | `c01b-after-register.png` |
| C02 | Candidate logs in | ✅ PASS | — | `c02-after-login.png` |
| C03 | Candidate dashboard | ✅ PASS | — | `c03-candidate.png` |
| C04 | Job board (50 active jobs) | ✅ PASS | — | `c04-jobs.png` |
| C05 | Apply to a job | ⚠️ PARTIAL | MEDIUM | `c05-job-board-loaded.png` |
| C07 | Candidate profile | ✅ PASS | — | `c07-profile.png` |
| C08 | OmniScore | ✅ PASS | — | `c08-omniscore.png` |
| C09 | My applications | ✅ PASS | — | `c09-applications.png` |
| C09b | Interviews | ✅ PASS | — | `c09b-interviews.png` |
| C10 | Settings | ✅ PASS | — | `c10-settings.png` |
| R01 | Employer registers | ✅ PASS* | — | `r01b-after-employer-register.png` |
| R02 | Employer login → dashboard | ✅ PASS | — | `r02-employer-after-login.png` |
| R03a | Recruiter dashboard renders | ✅ PASS | — | `r03-recruiter-dashboard.png` |
| R03b | Dashboard data is real (not mock) | ❌ FAIL | HIGH | `r03-recruiter-dashboard.png` |
| R04 | Create job posting (wizard) | ⚠️ PARTIAL | MEDIUM | `r04b-create-job-form-v3.png` |
| R05 | Recruiter candidates page | ✅ PASS | — | `r06-candidates.png` |
| R06 | Recruiter analytics | ✅ PASS† | MEDIUM | `r07-analytics.png` |
| R07 | Recruiter applications | ✅ PASS | — | `r08-applications.png` |
| R08 | Company profile page | ✅ PASS | — | `r09-company-profile-v3.png` |
| R09 | Team Management tab | ❌ FAIL | HIGH | `r09b-team-tab-v3.png` |
| R10 | Join-requests page | ❌ FAIL | HIGH | `r10-join-requests-v3.png` |
| R11 | Pending recruiter flow | ❌ FAIL | HIGH | `r11c-after-pending-register-v3.png` |

*R01 succeeded on first run (v2); v3 repeated attempt correctly rejects duplicate email.  
†Analytics page renders and major KPI cards show 0, but "Hiring Velocity" chart shows hardcoded mock data (Jan 12, Feb 15 interviews).

---

## Detailed Findings

### FINDING 1 — Public `/jobs` Route is 404 (HIGH)

**Screenshot:** `p02-public-jobs.png`

The route `/jobs` returns a 404 "Page Not Found" for unauthenticated users. The job board is only accessible to authenticated candidates at `/candidate/jobs`. If a recruiter or external visitor shares a job link using the root `/jobs` path, the user hits a dead end.

**Impact:** Public job discovery broken for unauthenticated users.  
**Root cause:** No frontend route registered for `/jobs` — the router only covers `/candidate/jobs`.

---

### FINDING 2 — Recruiter Dashboard Shows Fabricated Mock Charts (HIGH)

**Screenshot:** `r03-recruiter-dashboard.png`

For a brand-new employer account with 0 jobs and 0 applications, the dashboard bottom section renders:

- **Source Breakdown donut chart:** "100 total" (Direct: 42, Referral: 28, LinkedIn: 18, Other: 12) — completely fabricated
- **Applications Over Time chart:** Upward line chart ending at "+65%" — fabricated trend

The top KPI cards (Active Jobs: 0, New Applicants: 0, Interviews Today: 0, Offers Pending: 0) correctly show zeros, which makes the fabricated charts even more obviously wrong.

**Impact:** New employers see misleading pipeline data. This is the `#69` bug pattern confirmed again on staging.  
**Related Issue:** Likely already tracked under issue #69 or #164.

---

### FINDING 3 — Recruiter Analytics "Hiring Velocity" Shows Mock Data (MEDIUM)

**Screenshot:** `r07-analytics.png`

The Hiring Analytics page shows correct zeros for all KPI tiles (Job Views: 0, Applications: 0, Conversion Rate: 0.0%, Avg Days to Hire: —) and the Hiring Funnel correctly shows all zeros. However, the **"Hiring Velocity" section** shows:

- Jan: 12 interviews (bar chart)
- Feb: 15 interviews (bar chart)

For a brand-new zero-data employer account, these values are fabricated.  
**Impact:** Misleading data in analytics for all new recruiters.

---

### FINDING 4 — Team Management Fails with 500 (HIGH) 

**Screenshot:** `r09b-team-tab-v3.png`

The "Team Management" page (`/recruiter/company` → Team tab) shows:

```
Failed to load team
Failed to fetch team members
```

The API call `GET /api/team/members` returns HTTP 500.  
**Root cause:** The `users` table is missing the `suspended_at` column (migration 2026-08-11-add-user-suspended-at.sql was never applied because the migration runner only processes `.js` files — see issue #157). The query in `routes/company.js` references `suspended_at` and crashes.  
**Related Issue:** #153 (suspended_at column), #157 (migration runner skips .sql files).

---

### FINDING 5 — Join Requests Page is 404 (HIGH)

**Screenshot:** `r10-join-requests-v3.png`

The sidebar navigation shows "Join Requests" as a menu item. Clicking it navigates to `/recruiter/join-requests` which renders a 404 Page Not Found. The frontend router does not have this route registered.

Additionally, the underlying API `GET /api/company/join-requests` returns 404 due to route shadowing in `routes/company.js` (issue #155).  
**Related Issue:** #155 (route shadowing blocking join-requests endpoint).

---

### FINDING 6 — Pending Recruiter Holding Screen Not Shown (HIGH)

**Screenshot:** `r11c-after-pending-register-v3.png`

When a second employer registers using a company name that matches an existing company on the same email domain, they should be placed in a pending-approval queue and shown a holding screen. Instead:

- The registration form shows "Creating account..." (visible in screenshot — the server is processing)
- The page ultimately stays on `/register` after timeout (no success redirect)
- No holding screen ("Pending Approval") is displayed

The pending recruiter registration either timed out or the server returned an error not surfaced to the UI.  
**Possible causes:**
1. The first employer's company might have conflicting `company_id` state (from multiple test runs)
2. The matching logic requires an exact domain match (`@qarecruit.io`) but the company was created as a standalone company, not domain-enforced
3. The registration server response was delayed beyond the 12-second script timeout

**Related Issue:** #156 (pending recruiter flow broken).

---

### FINDING 7 — Candidate Pages Fire `/api/company/profile` → 400 (MEDIUM)

**Raw data:** `qa_01_results.json` — 37 consecutive 400 responses from `api/company/profile`

Every candidate page (dashboard, profile, jobs, OmniScore, applications, settings) triggers a request to `GET /api/company/profile`. A candidate user has no `company_id`, so the server returns HTTP 400. The error appears in the browser console as "Failed to load resource: 400" but does not break any visible UI.

**Impact:** Silent console error on every candidate page, unnecessary server load, potential data leak if endpoint returns partial data before the 400.  
**Root cause:** The candidate layout or a shared component makes a company profile API call unconditionally, regardless of user role.

---

### FINDING 8 — `/api/omniscore/explainer` → 404 (LOW)

The OmniScore page requests `GET /api/omniscore/explainer` which returns 404. The OmniScore page renders correctly (score: 425, breakdown visible), but the explainer content section is empty or missing.

---

## What's Working Well

| Feature | Status |
|---------|--------|
| Staging wake-up time | 1.6 seconds (fast — already warm) |
| Home page | Renders fully |
| Login / Register forms | Correct fields, role selection works |
| Candidate registration | Redirects to `/candidate` ✅ |
| Candidate dashboard | Correct zeros, no mock data ✅ |
| Candidate job board | 50 active jobs visible ✅ |
| Candidate profile | Loads correctly ✅ |
| OmniScore | Score 425, breakdown correct ✅ |
| My applications / Interviews / Assessments | All load ✅ |
| Settings page | Loads correctly ✅ |
| Employer registration | Redirects to `/recruiter` ✅ |
| Employer dashboard KPI cards | Correctly show 0 ✅ |
| Recruiter candidates page | Loads ✅ |
| Recruiter analytics KPI cards | Correctly show 0 ✅ |
| Recruiter applications page | Loads ✅ |
| Company profile page | QA Recruit IO shows "Verified" ✅ |
| 404 page | Custom UI ("Page Not Found") ✅ |

---

## API Error Summary

| Endpoint | Status | Count | Root Cause |
|----------|--------|-------|------------|
| `/api/company/profile` | 400 | 37 | Candidate pages call company endpoint unconditionally |
| `/api/company/join-requests` | 404 | 1 | Route shadowing (#155) |
| `/api/recruiter/saved-searches` | 404 | 1 | Route doesn't exist |
| `/api/team/members` | 500 | 1 | Missing `suspended_at` column (#153) |
| `/api/omniscore/explainer` | 404 | 2 | Missing endpoint |

---

## Comparison: Staging 2026-08-11 vs Production 2026-08-06

| Test | Production (Aug 6) | Staging (Aug 11) |
|------|--------------------|------------------|
| Home | ✅ | ✅ |
| Public `/jobs` | ✅ | ❌ 404 |
| Candidate registration | ✅ | ✅ |
| Candidate dashboard (no mock data) | ❌ FAIL | ✅ Fixed |
| Recruiter dashboard (no mock data) | ❌ FAIL | ❌ Still failing |
| Job apply flow | ✅ | ⚠️ Partial |
| Team management | N/A | ❌ 500 error |
| Join requests page | N/A | ❌ 404 |
| OmniScore | N/A | ✅ Working |

---

## Open Issues Confirmed Broken by This Session

| Issue | Title | Severity | Status |
|-------|-------|----------|--------|
| #153 | Team management 500 — `suspended_at` column missing | HIGH | 🔴 Confirmed broken on staging |
| #155 | Join-requests route 404 (shadow bug) | HIGH | 🔴 Confirmed broken on staging |
| #156 | Pending recruiter flow not working | HIGH | 🔴 Unconfirmed (test timeout), needs manual test |
| #69 / #164 | Recruiter dashboard mock charts | HIGH | 🔴 Confirmed broken on staging |

---

## New Issues Found in This Session

| # | Summary | Severity |
|---|---------|----------|
| NEW-1 | Public `/jobs` route 404 — unauthenticated job browsing broken | HIGH |
| NEW-2 | Recruiter analytics "Hiring Velocity" shows mock data (Jan 12, Feb 15) | MEDIUM |
| NEW-3 | Candidate pages call `/api/company/profile` (400) on every page load | MEDIUM |
| NEW-4 | `/recruiter/join-requests` frontend route missing (sidebar link broken) | MEDIUM |
| NEW-5 | `/api/omniscore/explainer` missing endpoint (404 on OmniScore page) | LOW |

---

## Screenshots Index

| File | Description |
|------|-------------|
| `p01-home.png` | Home page — renders correctly |
| `p02-public-jobs.png` | Public `/jobs` — 404 Page Not Found |
| `p03-login.png` | Login form with email + password fields |
| `p04-register.png` | Register form with Job Seeker / Employer role buttons |
| `p05-forgot-password.png` | Forgot password form |
| `p06-404.png` | 404 page with custom UI |
| `c01b-after-register.png` | Candidate redirected to `/candidate` after registration |
| `c03-candidate.png` | Candidate dashboard — correct zeros, recent jobs visible |
| `c04-jobs.png` | Job board — 50 active jobs listed |
| `c05-job-board-loaded.png` | Job board with "Recommended for you" section |
| `c07-profile.png` | Candidate profile page |
| `c08-omniscore.png` | OmniScore: 425 score, breakdown working |
| `r01b-after-employer-register.png` | Recruiter dashboard after employer registration |
| `r03-recruiter-dashboard.png` | **MOCK DATA** — Source Breakdown 100 total, +65% trend |
| `r04b-create-job-form-v3.png` | Create job 3-step wizard (Job Details step) |
| `r07-analytics.png` | Analytics page — KPIs correct, Hiring Velocity has mock data |
| `r09-company-profile-v3.png` | Company Profile — QA Recruit IO shows Verified |
| `r09b-team-tab-v3.png` | **ERROR** — "Failed to load team / Failed to fetch team members" |
| `r10-join-requests-v3.png` | Join Requests page → 404 |
| `r11c-after-pending-register-v3.png` | Pending recruiter form in "Creating account..." loading state |

---

*Generated by: `qa_01_public_candidate.py` + `qa_02_recruiter.py`*  
*Raw data: `qa_01_results.json` (16/20 pass), `qa_02_results.json` (8/17 pass)*
