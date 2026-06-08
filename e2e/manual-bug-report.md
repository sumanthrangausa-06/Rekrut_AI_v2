# Bug Report: Manual Dev Testing — 2026-06-08

Captured from Ranga's manual testing on rekrutai-dev.onrender.com (mobile viewport).

## Bug 1: Filter Button Missing Label on Mobile Jobs Search
**Screenshot:** `screenshot-bug-1-filter-button.jpg` (media://inbound/031a6c6d-a1c1-4009-b9bc-3586ae0f3984.jpg)
**URL:** `/candidate/jobs` (mobile)
**Severity:** Medium
**Description:** The filter button below the search/location inputs renders as an empty white bar with only a small funnel icon. No text label is visible. Looks broken on mobile.

## Bug 2: E2E Tests Failing in CI
**Screenshot:** `screenshot-bug-2-ci-failure.jpg` (media://inbound/9ed44cf6-9638-4181-8e63-73abbc05d68e.jpg)
**Severity:** Critical
**Description:** GitHub Actions CI workflow shows E2E Tests failing with 3 annotations. Security Audit, Build Check, and Health Check all pass — only E2E fails. Need to investigate which specific tests are failing and why.

## Bug 3: Settings Notifications Tab Shows "Request Failed"
**Screenshot:** `screenshot-bug-3-settings-error.jpg` (media://inbound/1583ca44-8035-4c01-9253-986ce51f46e4.jpg)
**URL:** `/settings` (Notifications tab)
**Severity:** High
**Description:** Red error banner "Request failed" appears at the top of the Settings page when viewing the Notifications tab. The toggles render but something in the background API call is failing. This is a poor UX — the page should load preferences silently or show a more helpful error.

## Bug 4: Profile Completeness Showing 0% on Job Detail Page
**Screenshot:** `screenshot-bug-4-job-detail.jpg` (media://inbound/4f9163cc-b6f4-4937-84a8-bea82a2b2dab.jpg)
**URL:** Job detail page (e.g., `/candidate/jobs/:id`)
**Severity:** Low / Informational
**Description:** "Complete your profile for better matches" banner shows profile is 0% complete. For a new user this is expected, but the banner is very prominent. May be worth verifying the profile completion calculation is correct, or adjusting the banner timing.

## Next Steps
1. Create GitHub issues for bugs 1-3 (bug 4 may be expected behavior)
2. Spawn fix agents for each confirmed bug
3. Continue automated E2E testing to find additional issues
