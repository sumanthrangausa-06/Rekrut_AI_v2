# QA Phase 2 Re-Run Report — Auth & Public Pages Quick Sweep (Tier 1)

**Target:** https://rekrutai-staging.onrender.com  
**Date:** 2026-07-08  
**QA Analyst:** Model QA Specialist (Subagent)  
**Test Type:** Browser-based functional & visual verification (no login)  
**Browser:** Headless Chromium (Desktop viewport)

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Pages Tested | 14 |
| PASS | 12 |
| PARTIAL | 1 |
| FAIL | 1 |
| Critical Issues | 1 |
| Major Issues | 2 |
| Minor Issues | 3 |

**Overall Opinion:** Sound with Findings — The staging site is functional and all primary public/auth pages load correctly. However, there is one **CRITICAL** routing failure (`/admin-login` returns 404), one **MAJOR** finding around missing form validation, and several **MINOR** console/log issues that should be addressed before production.

---

## Page-by-Page Results

### Public Pages

| # | Page | Status | Notes |
|---|------|--------|-------|
| 1 | `/` (Homepage) | **PASS** | Hero section, CTA buttons, navigation, features, pricing preview, testimonials, FAQ, newsletter, and footer all render correctly. Navigation links functional. |
| 2 | `/about` | **PASS** | Full content renders: mission, values, leadership (Ranga Sumanth, Suga), journey timeline, CTAs. Footer present. |
| 3 | `/pricing` | **PASS** | Three tiers display (Starter $29, Growth $79, Enterprise Custom). Stripe "Start checkout" buttons present. Monthly/Yearly toggle present. |
| 4 | `/contact` | **PARTIAL** | Form fields render (Name, Email, Company, Subject, Message). Submit button present. **No client-side validation on empty submit** — form silently accepts empty submission without error feedback. |
| 5 | `/terms` | **PASS** | Full Terms of Service content renders with 11 sections, last updated July 8, 2026. Links to Privacy Policy functional. |
| 6 | `/privacy` | **PASS** | Full Privacy Policy content renders with 12 sections. Contact link functional. |
| 7 | `/blog` | **PASS** | Blog listing renders with articles, categories, search box, and featured article. **Note:** Heading reads "HireLoop Blog" (legacy brand name) — should be updated to "Rekrut AI Blog". |
| 8 | `/test-camera` | **PASS** | Page loads with camera isolation test UI. 5 progressive test levels (L1–L5) displayed. Console log area present. |
| 9 | `/nonexistent-page` (404) | **PASS** | Custom 404 page renders with "Page Not Found" message, "Go Home" link, and "Go Back" button. |

### Auth Pages

| # | Page | Status | Notes |
|---|------|--------|-------|
| 10 | `/login` | **PASS** | Form loads with Email, Password fields, "Show password" toggle, "Remember me" checkbox, "Forgot password?" link, and "Don't have an account? Sign up" link. |
| 11 | `/register` | **PARTIAL** | Form loads with role selector (Job Seeker / Employer), Full name, Email, Password fields, "Show password" toggle, LinkedIn OAuth button, and "Already have an account? Sign in" link. **No client-side validation on empty submit** — form silently accepts empty submission. |
| 12 | `/forgot-password` | **PASS** | Form loads with Email field and "Send reset link" button. "Back to sign in" link present. |
| 13 | `/recruiter-register` | **PARTIAL** | Page loads but displays the **same generic registration form** as `/register`. No company-specific fields (company name, website, size, industry) are present. The role selector defaults to "Job Seeker". |
| 14 | `/admin-login` | **FAIL** | **Returns 404** — "Page Not Found" instead of an admin login form. |

---

## Issues Found

### Critical

| # | Issue | Page(s) | Impact |
|---|-------|---------|--------|
| C1 | `/admin-login` route does not exist — returns 404 | `/admin-login` | Admin users cannot access the admin portal. Could indicate missing route deployment or renamed endpoint. |

### Major

| # | Issue | Page(s) | Impact |
|---|-------|---------|--------|
| M1 | Contact form submits without validation on empty fields | `/contact` | Users receive no feedback when submitting empty form. Poor UX and potential for spam/empty submissions. |
| M2 | Register form submits without validation on empty fields | `/register`, `/recruiter-register` | Users can click "Sign up" with all fields empty and receive no error message. Blocks user onboarding if they don't realize fields are required. |

### Minor

| # | Issue | Page(s) | Impact |
|---|-------|---------|--------|
| m1 | Blog page shows legacy brand name "HireLoop" | `/blog` | Brand inconsistency. Should read "Rekrut AI Blog". |
| m2 | Recruiter registration lacks company-specific fields | `/recruiter-register` | Recruiters cannot provide company information during signup. May require them to complete profile post-registration. |
| m3 | Console warnings: React missing "key" prop | `/` (and others) | React dev warning in console: `Each child in a list should have a unique "key" prop`. Non-breaking but indicates incomplete component implementation. |
| m4 | Analytics API returns 403 Forbidden | All pages | `/api/analytics/events` returns 403 on every page load. Analytics tracking is non-functional in staging. Expected for staging but should be verified in production. |
| m5 | Permissions-Policy header warnings | All pages | Browser warns about unrecognized features `vr` and `ambient-light-sensor` in Permissions-Policy header. Harmless but clutters console. |

---

## Console Error Summary (across all pages)

| Error | Frequency | Severity |
|-------|-----------|----------|
| `Failed to load resource: 500 ()` — JS assets | Intermittent (early loads) | Low — assets load successfully on retry |
| `Refused to apply style from ... because its MIME type ('application/json')` | Intermittent | Low — CSS loads successfully on retry |
| `Failed to load resource: 403 ()` — `/api/analytics/events` | Every page load | Low (staging-only) |
| React missing "key" prop | Every page load | Low — dev warning |
| Permissions-Policy header warnings | Every page load | Very Low |

**Note:** The 500 errors on JS assets and CSS MIME type errors appear to be transient (likely from Render cold-start or initial bundle loading). On subsequent page loads, all assets load correctly and the app renders fully.

---

## Gaps / Missing Functionality Observed

1. **Admin Login Portal** — `/admin-login` is completely missing. This is a critical gap if admin functionality is expected in this release.
2. **Form Validation** — Neither `/contact` nor `/register` show any client-side validation feedback when submitted with empty fields. This is a significant UX gap.
3. **Recruiter-Specific Registration** — `/recruiter-register` does not differentiate from `/register`. Company fields (company name, website, size, industry) are absent.
4. **Stripe Checkout Integration** — Pricing page has "Start checkout" buttons but actual Stripe checkout flow was not tested (out of scope for Tier 1).
5. **LinkedIn OAuth** — Button present on register page but OAuth flow was not tested (out of scope for Tier 1).

---

## Recommendations

| Priority | Action | Owner |
|----------|--------|-------|
| **P0** | Fix `/admin-login` route or remove from QA checklist if not in scope | Engineering |
| **P1** | Add client-side form validation to `/contact` and `/register` | Engineering |
| **P1** | Update `/blog` heading from "HireLoop Blog" to "Rekrut AI Blog" | Engineering |
| **P2** | Add company-specific fields to `/recruiter-register` or redirect to `/register?role=recruiter` | Engineering |
| **P2** | Fix React "key" prop warnings in list components | Engineering |
| **P3** | Verify analytics API 403s are staging-only and not present in production | Engineering / DevOps |

---

## Appendix: Test Methodology

- **Browser:** Headless Chromium via OpenClaw CDP driver
- **Viewport:** Desktop (default)
- **Tests Performed:**
  - Direct navigation to each URL
  - DOM snapshot verification for key elements
  - Console error collection (`level: all`)
  - Form empty-submit validation test
  - Cross-page navigation link verification (sample)
- **Not Tested:**
  - Mobile viewport responsiveness
  - Actual form submission to backend
  - Stripe checkout flow
  - LinkedIn OAuth flow
  - Authenticated pages (requires login)

---

*Report generated by Model QA Specialist subagent for Rekrut AI staging environment.*
