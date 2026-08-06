# UI/UX Audit Report — Rekrut AI (Dev Environment)
**Date:** 2026-07-07
**Auditor:** Suga (Frontend Developer Agent)
**Environment:** https://rekrutai-dev.onrender.com
**Branch:** dev
**Commit:** 67d064e

---

## Candidate User Pages

| # | Page | URL | Status | Notes |
|---|------|-----|--------|-------|
| 1 | Dashboard | /candidate | ✅ OK | Loads fine, shows welcome message, stats cards, recent jobs |
| 2 | Job Board | /candidate/jobs | ✅ OK | Shows 50 jobs, filters work, "Load More" button present |
| 3 | Applications | /candidate/applications | ✅ OK | Empty state shows correctly (0 applications) |
| 4 | Profile | /candidate/profile | ✅ OK | Shows profile form with personal info |
| 5 | Assessments | /candidate/assessments | ✅ OK | Shows empty state correctly |
| 6 | Interviews | /candidate/interviews | ✅ **FIXED** | Shows "My Interviews" with empty state, tabs (Upcoming/Past/Interview Tips) |
| 7 | AI Coaching | /candidate/ai-coaching | ✅ OK | Loads with AI coach questions |
| 8 | Offers | /candidate/offers | ✅ OK | Empty state shows correctly |
| 9 | Onboarding | /candidate/onboarding | ✅ **FIXED** | Shows "No Onboarding Available" with Paperwork/AI Plan tabs |
| 10 | Pay & Compensation | /candidate/payroll | ✅ **FIXED** | Shows "Payroll Not Set Up" empty state |
| 11 | OmniScore | /candidate/omniscore | ✅ OK | Shows OmniScore dashboard |
| 12 | Settings (old) | /candidate/settings | ✅ **FIXED** | Redirects to /settings |
| 13 | Settings | /settings | ✅ OK | Shows Profile, Account, Notifications, Privacy, Appearance, Billing tabs |

## Recruiter User Pages

| # | Page | URL | Status | Notes |
|---|------|-----|--------|-------|
| 1 | Dashboard | /recruiter | ✅ OK | Shows hiring dashboard with stats, charts, recent activity |
| 2 | Jobs | /recruiter/jobs | ✅ OK | Shows job listings, "Post a Job" button |
| 3 | Applications | /recruiter/applications | ✅ OK | Shows applications table with filters |
| 4 | Candidates | /recruiter/candidates | ✅ OK | Shows candidate pool with filters |
| 5 | Interviews | /recruiter/interviews | ✅ OK | Shows empty state, "Schedule Interview" button |
| 6 | Offers | /recruiter/offers | ✅ OK | Shows empty state, "Create Offer" button |
| 7 | Assessments | /recruiter/assessments | ✅ **CORRECT** | Shows "Skill Assessments" with stats, tabs (Job Assessments/Skill Tests/Skill Breakdown/Test Catalog) |
| 8 | OmniScore | /recruiter/omniscore | ✅ OK | Shows TrustScore dashboard |
| 9 | Analytics | /recruiter/analytics | ✅ OK | Shows hiring analytics with charts |
| 10 | Compliance | /recruiter/compliance | ✅ OK | Shows EU AI Act compliance dashboard |
| 11 | Company | /recruiter/company | ✅ OK | Shows company profile form |
| 12 | Onboarding | /recruiter/onboarding | ✅ **FIXED** | Shows "Onboarding Dashboard" with Employees/AI Plans tabs, empty state |
| 13 | Payroll | /recruiter/payroll | ✅ **FIXED** | Shows "Global Payroll" with Overview/Employees/Payroll Runs tabs |

---

## Issues Fixed

### 🔴 P0 — Critical (All Fixed)

1. **`/recruiter/onboarding` — Error Boundary** ✅ FIXED
   - **Root cause:** `useEffect` dependency array referenced `loadCandidates` (useCallback) declared AFTER the `useEffect`. TDZ error crashed the component.
   - **Fix:** Moved `loadCandidates` declaration before `useEffect`.
   - **Commit:** a27cacc

2. **`/recruiter/payroll` — Error Boundary** ✅ FIXED
   - **Root cause:** Same TDZ pattern — `useEffect` dependency array referenced `loadAll` (useCallback) declared after `useEffect`.
   - **Fix:** Moved `loadAll` declaration before `useEffect`.
   - **Commit:** a27cacc

3. **`/candidate/onboarding` — Infinite Loading** ✅ FIXED
   - **Root cause:** `useEffect` dependency `[loadProgress]` caused infinite re-render loop. Additionally, API call to `/onboarding/wizard/progress` could hang indefinitely without timeout.
   - **Fix:** Changed dependency to `[]`, added `withTimeout` wrapper with 10s timeout.
   - **Commit:** cfdf697, 67d064e

### 🟡 P1 — High (All Fixed)

4. **`/candidate/interviews` — Blank Page** ✅ FIXED
   - **Root cause:** `useEffect` dependency `[loadInterviews]` caused infinite re-render loop. Component would crash/re-render continuously, appearing blank.
   - **Fix:** Changed dependency to `[]`, added `withTimeout` wrapper with 10s timeout.
   - **Commit:** cfdf697, 67d064e

5. **`/candidate/payroll` — Blank Page** ✅ FIXED
   - **Root cause:** `useEffect` dependency `[loadAll]` caused infinite re-render loop. Component would crash/re-render continuously, appearing blank.
   - **Fix:** Changed dependency to `[]`, added `withTimeout` wrapper with 10s timeout.
   - **Commit:** cfdf697, 67d064e

6. **`/recruiter/assessments` — Wrong Content** ✅ VERIFIED CORRECT
   - **Finding:** Page correctly shows "Skill Assessments" with candidate test scores, skill verifications, and assessment tabs. Earlier audit observation of "Compliance content" was incorrect — likely a navigation confusion during testing.
   - **No fix needed.**

### 🟢 P2 — Medium (Already Fixed)

7. **`/candidate/settings` — 404** ✅ Already fixed with redirect to `/settings`.

8. **Console 401/403 errors** — Background API calls (`/api/settings`, `/api/billing/subscription-status`, `/api/analytics/events`) return 401/403 for candidates without billing/admin access. Not critical but noisy.

---

## Pattern Identified

**The root cause across ALL broken pages was the same anti-pattern:**

```tsx
// ❌ BAD — causes infinite re-render or TDZ error
useEffect(() => {
    loadData()
}, [loadData]) // ReferenceError: Cannot access 'loadData' before initialization

// ❌ BAD — causes infinite re-render loop
useEffect(() => {
    loadData()
}, [loadData]) // loadData is recreated every render, triggering useEffect every render

// ✅ GOOD — stable, runs once on mount
useEffect(() => {
    loadData()
}, [])

async function loadData() {
    // ...
}
```

**Additional fix:** Added `withTimeout<T>()` helper to all API calls that could hang, preventing infinite loading spinners when backend endpoints don't respond.

---

## Files Modified

1. `client/src/pages/recruiter/onboarding.tsx` — TDZ fix + withTimeout
2. `client/src/pages/recruiter/payroll.tsx` — TDZ fix + withTimeout
3. `client/src/pages/candidate/interviews.tsx` — Fixed infinite loop + withTimeout
4. `client/src/pages/candidate/onboarding.tsx` — Fixed infinite loop + withTimeout
5. `client/src/pages/candidate/payroll.tsx` — Fixed infinite loop + withTimeout

---

## Build Status

✅ **Build passes** — `npm run build` completed successfully, 17.38s

---

## Verification

All pages tested in browser after deploy. Every previously broken page now renders correctly with proper empty states.
