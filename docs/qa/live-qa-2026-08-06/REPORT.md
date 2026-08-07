# Live Production QA Report — rekrutai.co

**Date:** 2026-08-06/07
**Target:** `https://rekrutai.co` (production)
**Method:** Headless Chromium (Playwright, Python), scripted navigation + network/console capture
**Tester:** Agent (following gstack `/qa` methodology — exploration, evidence, severity taxonomy)
**Test accounts created:**
- Candidate: `qa.candidate.1786083173@gmail.com` / `QaTest123!Pass`
- Recruiter: `qa.recruiter.1786085084@gmail.com` / `QaTest123!Pass` (Company: "QA Test Co")

Artifacts: see `screenshots/` and `*.json` network/API logs in this folder.

---

## Executive Summary

Public marketing pages, auth pages, and basic navigation all work well and render cleanly on desktop and mobile. However, **the core candidate job-search feature is completely broken in production** (infinite spinner, "0 active jobs", despite the API returning real data), and **recruiter dashboards show fabricated mock data** instead of real (zero) data for new accounts — both are severe, user-facing, revenue-relevant bugs. Auth (login/registration) works but redirects are unusually slow (5–20+ seconds) and inconsistent. A sitewide analytics-tracking endpoint is broken (403 CSRF errors on nearly every page load).

| Severity | Count |
|----------|-------|
| Critical / P0 | 1 |
| High / P1 | 2 |
| Medium / P2 | 1 |
| Low / P3 | 3 |

---

## Findings

### 1. 🔴 CRITICAL — Candidate Job Board stuck on infinite spinner; shows "0 active jobs" despite API returning real data

- **Page:** `/candidate/jobs`
- **Repro:** Log in as a candidate → open Job Board. Header reads "0 active jobs" and the job list area shows a permanent loading spinner (confirmed still spinning after 10+ seconds).
- **Evidence:** `GET /api/candidate/jobs?limit=200` returns `200 {"success":true,"data":[...]}` with real job listings (confirmed in `jobs-debug3-api-log.json`), but the UI never renders them.
- **Screenshot:** `screenshots/jobs-debug3-10s.png`
- **Likely cause:** `client/src/pages/candidate/jobs.tsx` → `loadJobs()` (line ~236). Uses `Promise.allSettled([apiCall(url), apiCall('/candidate/jobs/recommended')])`; if the second call rejects/hangs in a way that affects the settle timing, or a re-render loop resets `jobs` state, the list would never populate despite a successful primary fetch. Needs React DevTools / production console inspection to confirm the exact state bug.
- **Impact:** Candidates cannot browse or apply to jobs at all — the core product loop is blocked in production.

### 2. 🟠 HIGH — OmniScore page (candidate) stuck on infinite spinner

- **Page:** `/candidate/omniscore`
- **Repro:** Log in as candidate → click OmniScore in sidebar. Page shows only a spinner, never resolves.
- **Screenshot:** `screenshots/candidate3-omniscore.png`
- **Impact:** Candidates cannot view their OmniScore breakdown (a headline product feature).
- **Note:** Dashboard shows OmniScore = 300, Profile page shows OmniScore = 75 for the same account — inconsistent values across pages (minor, noted here rather than as a separate issue).

### 3. 🟠 HIGH — Recruiter Dashboard, Candidates, and Analytics pages show fabricated/mock data instead of real zero-state

- **Pages:** `/recruiter` (dashboard), `/recruiter/candidates`, `/recruiter/analytics`
- **Repro:** Register a brand-new recruiter account (0 jobs, 0 candidates, 0 applications) → visit each page.
- **Evidence:**
  - Dashboard "Applications Over Time" chart shows an upward trend line and "+65%" for an account with 0 applications ever. "Source Breakdown" donut shows "100 total" (Direct 42, Referral 28, LinkedIn 18, Other 12) for an account with 0 candidates. "Pipeline Breakdown" x-axis labels are also truncated/cut off ("Sour", "Appl", "Scre", "Inte", "Offe", "Hire").
  - Candidates page shows misleading trend badges (`↗12%`, `↗8%`, `↘0%`, `↗15%`, `↗5%`) next to all-zero stat cards, pre-populated "Saved Searches" chips ("Senior Engineers - Remote", "High Match - Frontend") that this brand-new account never created, and candidate rows stuck in perpetual skeleton-loading shimmer instead of resolving to an empty state.
  - Analytics page "Hiring Velocity" chart shows "Jan: 12 interviews", "Feb: 15 interviews" for an account with 0 interviews ever, plus misleading trend badges on all-zero KPI cards.
- **Screenshots:** `screenshots/recruiter2-after-signup-20s.png`, `screenshots/recruiter3-candidates.png`, `screenshots/recruiter3-analytics.png`
- **Related:** This directly confirms GitHub issue [#15](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/15) ("P0 - Recruiter Analytics Dashboard...  Handle missing data gracefully — fallback to empty states, not mock data") is **still unresolved in production**, and the same mock-data pattern also affects the Dashboard and Candidates pages (broader scope than #15 as originally filed).
- **Impact:** New recruiters (i.e., every trial signup) see fake success metrics and non-functional saved searches — misleading and damages trust during the exact moment a paying customer is evaluating the product.

### 4. 🟡 MEDIUM — Slow & inconsistent post-auth redirect (login/registration)

- **Repro:** Submit login form → measured **5.35 seconds** between click and arrival at `/candidate` dashboard (see `qa_login_timing.py` output). Registration was observed taking even longer and, in one run, ended on `/login` (not the dashboard) after a 15-second wait, requiring the user to explicitly log in again with the credentials they just created; a later run with a 20-second wait did land on the dashboard directly.
- **Evidence:** `candidate-signup-api-log.json` shows `POST /api/auth/register` returns `201` with a valid JWT/access token immediately, but the SPA does not act on it right away.
- **Impact:** Every signup/login has several seconds of a blank/loading screen with no feedback, and new users may be forced through an unnecessary extra login step — meaningful drop-off risk on the most conversion-critical part of the funnel.

### 5. 🟡 MEDIUM — `/api/analytics/events` fails CSRF validation on nearly every page load

- **Evidence:** Console/network capture on 10 of 13 public pages tested shows `POST /api/analytics/events` → `403 {"error":"CSRF token validation failed","code":"CSRF_INVALID"}`. Also reproduced on authenticated candidate and recruiter sessions (visible in `candidate-flow-results.json`, `candidate-flow3-results.json`).
- **Related:** Confirms/extends GitHub issue [#49](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/49) ("Event tracking verification") — this isn't just "may have gaps", it is actively failing with a specific, reproducible error on almost every page view.
- **Impact:** No usable analytics/funnel data is being collected in production; every business metrics dashboard downstream is unreliable.

### 6. 🟢 LOW — Leftover E2E test data visible to real users in production

- **Evidence:** New candidate account's Dashboard "Recent Job Openings" and Job Board results include jobs titled "E2E Test Engineer 1780943007852 Updated", "E2E Pipeline Job 1780942973616", "E2E Critical Flow Job 1780942925457" posted by "E2E Test Co".
- **Screenshot:** `screenshots/candidate3-dashboard.png`
- **Impact:** Unprofessional appearance; real candidates see obviously fake test postings. Should be purged from the production database and E2E tests should target a separate environment/company that's excluded from public listings.

### 7. 🟢 LOW — SPA 404 pages return HTTP 200 instead of 404

- **Evidence:** `GET /this-page-does-not-exist-12345` → HTTP 200 (renders the "404 Page Not Found" UI correctly, but at the HTTP layer it's a 200).
- **Related:** Contributes to GitHub issue [#48](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/48) (SEO infra) — search engines will index broken URLs as valid pages.
- **Impact:** Minor SEO/technical debt; standard SPA caveat but worth fixing via server-side status code handling for unmatched routes.

---

## What worked well

- All public marketing pages (home, pricing, about, contact, blog, terms, privacy) load cleanly with no console errors besides the analytics 403, and render correctly on both desktop (1440×900) and mobile (375×812) viewports.
- `/register` and `/recruiter-register` correctly share one component with role-aware fields (role dropdown pre-selected, company name field appears for recruiters).
- 404 page UI, admin login page, and forgot-password page all render correctly.
- Candidate Applications, Interviews, Assessments, Profile, and Settings pages all render correct empty states for a new account (no spinners stuck, no mock data) — this makes the Job Board/OmniScore/Recruiter-dashboard bugs look like isolated component-level issues rather than a systemic problem in the whole app.
- Recruiter Jobs page shows a correct, clean empty state ("No job postings yet" / "Create Your First Job") — contrast with the Candidates/Analytics pages on the same account.

## Files in this folder
- `qa_explore.py`, `qa_candidate_flow*.py`, `qa_recruiter_flow*.py`, `qa_jobs_debug*.py`, `qa_login_timing.py`, `qa_mobile_check.py` — test scripts (reusable for regression testing)
- `public-pages-results.json`, `candidate-flow-results.json`, `candidate-flow3-results.json`, `recruiter-flow-results.json`, `recruiter-flow3-results.json` — structured results
- `candidate-signup-api-log.json`, `jobs-debug3-api-log.json` — raw API responses used as evidence
- `screenshots/` — full-page screenshots for every page tested
