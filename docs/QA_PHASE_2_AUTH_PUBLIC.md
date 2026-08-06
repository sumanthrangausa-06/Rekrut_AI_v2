# QA Phase 2 Report — Auth & Public Pages Quick Sweep

**Target:** https://rekrutai-staging.onrender.com  
**Date:** 2026-07-08 04:51 GMT+8  
**QA Analyst:** Model QA Specialist (subagent)  
**Test Method:** Browser automation (headless Chromium) + curl verification  
**Overall Status:** 🔴 CRITICAL — ALL PAGES FAIL

---

## Executive Summary

The entire Rekrut AI staging site is **completely non-functional**. All 14 tested pages (public + auth) render as **blank white screens** because the JavaScript bundle assets fail to load with HTTP 500 errors, and CSS is served with an incorrect MIME type (`application/json`). The React SPA never hydrates, making every page unreachable for end users. This is a **site-wide deployment failure**.

**Note:** Direct curl requests to the same JS assets return HTTP 200, suggesting either:
- A transient server failure that recovered during testing (but browser caches the 500 errors)
- A CDN/Cloudflare caching issue where the browser hits a stale 500 response
- A conditional server error triggered by specific request headers (e.g., `Accept`, `Referer`, cookie state)

Regardless of root cause, the user-facing experience is a completely broken site.

---

## Page-by-Page Results

### Public Pages

| # | Page | URL | Status | Notes |
|---|------|-----|--------|-------|
| 1 | Homepage | `/` | **FAIL** | Blank white screen. Hero, CTA, nav not visible. JS assets 500. |
| 2 | About | `/about` | **FAIL** | Blank white screen. Same JS asset failures. |
| 3 | Pricing | `/pricing` | **FAIL** | Blank white screen. Pricing tiers, Stripe buttons not testable. |
| 4 | Contact | `/contact` | **FAIL** | Blank white screen. Form fields not testable. |
| 5 | Terms | `/terms` | **FAIL** | Blank white screen. Content not testable. |
| 6 | Privacy | `/privacy` | **FAIL** | Blank white screen. Content not testable. |
| 7 | Blog | `/blog` | **FAIL** | Blank white screen. `dangerouslySetInnerHTML` not testable. |
| 8 | Test Camera | `/test-camera` | **FAIL** | Blank white screen. Page not testable. |
| 9 | 404 | `/nonexistent-page` | **FAIL** | Blank white screen. 404 page not rendered. |

### Auth Pages

| # | Page | URL | Status | Notes |
|---|------|-----|--------|-------|
| 10 | Login | `/login` | **FAIL** | Blank white screen. Form, email/password fields not testable. |
| 11 | Register | `/register` | **FAIL** | Blank white screen. Form, validation not testable. |
| 12 | Forgot Password | `/forgot-password` | **FAIL** | Blank white screen. Email field not testable. |
| 13 | Recruiter Register | `/recruiter-register` | **FAIL** | Blank white screen. Company fields not testable. |
| 14 | Admin Login | `/admin-login` | **FAIL** | Blank white screen. Form not testable. |

---

## Issues Found

### 🔴 CRITICAL-001: Site-Wide Blank Screen — JS Assets Return HTTP 500

- **Severity:** CRITICAL
- **Scope:** All pages (14/14 tested)
- **Description:** Every page renders as a blank white screen because the JavaScript assets referenced in the HTML `<script>` tags fail to load with HTTP 500 errors. The React SPA cannot initialize.
- **Affected Assets:**
  - `assets/index-DTOJjZ5P.js` → 500
  - `assets/vendor-CLjFbpzk.js` → 500
  - `assets/react-BkDpWIrR.js` → 500
  - `assets/react-dom-D_fDjBXL.js` → 500
  - `assets/router-iMc7B80g.js` → 500
- **Browser Console Evidence:** `Failed to load resource: the server responded with a status of 500 ()` for all JS assets on every page load.
- **Business Impact:** The entire staging site is unusable. No user can access any page, register, login, or view content.
- **Root Cause Hypothesis:** The browser is hitting a stale/cached 500 response from the CDN (Cloudflare), while direct curl requests return 200. Alternatively, the server may have a conditional error path triggered by browser-specific headers or cookie state.
- **Remediation:**
  1. Purge CDN/Cloudflare cache for all `/assets/*` paths
  2. Verify asset files exist on the Render server and are correctly served
  3. Investigate server logs for the 500 errors on asset requests
  4. Add cache-busting headers or version query parameters to asset URLs
  5. Verify build output integrity — ensure the Vite build completed successfully

### 🔴 CRITICAL-002: CSS Served with Incorrect MIME Type (`application/json`)

- **Severity:** CRITICAL
- **Scope:** All pages (14/14 tested)
- **Description:** The CSS stylesheet `assets/index-EO9qE6xm.css` is refused by the browser because it is served with MIME type `application/json` instead of `text/css`.
- **Browser Console Evidence:** `Refused to apply style from '.../assets/index-EO9qE6xm.css' because its MIME type ('application/json') is not a supported stylesheet MIME type, and strict MIME checking is enabled.`
- **Business Impact:** Even if JS were to load, all styling would be missing. The site would be unstyled/unusable.
- **Remediation:**
  1. Verify the CSS file exists and is not being replaced by an error JSON response
  2. Check server MIME type configuration for `.css` files
  3. Ensure the CSS file is correctly generated in the Vite build output

### 🟡 MINOR-001: Permissions-Policy Header Warnings

- **Severity:** MINOR
- **Scope:** All pages (14/14 tested)
- **Description:** The `Permissions-Policy` header contains unrecognized features: `vr` and `ambient-light-sensor`. These are non-breaking warnings but indicate the header is outdated or contains invalid values.
- **Browser Console Evidence:** `Error with Permissions-Policy header: Unrecognized feature: 'vr'.` and `Error with Permissions-Policy header: Unrecognized feature: 'ambient-light-sensor'.`
- **Remediation:** Remove `vr` and `ambient-light-sensor` from the Permissions-Policy header, or use the modern equivalent names if supported.

---

## Technical Evidence

### HTML Structure (from curl)
The HTML page **does** load correctly and contains proper SPA markup:
- `<!DOCTYPE html>` with `<meta charset="UTF-8">` and `<meta viewport>`
- Open Graph / Twitter meta tags correctly configured
- Google Fonts preconnect (`Inter`, `Space Grotesk`)
- `<script type="module" crossorigin src="/assets/index-DTOJjZ5P.js">`
- `<link rel="modulepreload" crossorigin href="/assets/react-Bk...">`

The HTML is well-formed. The failure is purely in asset loading.

### Asset Direct Access Test
When navigating the browser directly to `https://rekrutai-staging.onrender.com/assets/index-DTOJjZ5P.js`, the JavaScript content **is visible** and loads. This confirms the asset files exist on the server. The 500 errors appear only when the assets are loaded as subresources of the HTML page.

### curl vs Browser Discrepancy
- `curl` to JS assets: HTTP 200, `application/javascript; charset=UTF-8`
- `curl` to CSS asset: HTTP 200, `text/css; charset=UTF-8`
- Browser (from HTML page): HTTP 500 for JS assets, MIME type `application/json` for CSS

This discrepancy strongly suggests a **CDN caching issue** or a **conditional server error** based on request headers (e.g., `Accept`, `Referer`, cookie state).

---

## Gaps & Untested Areas

Due to the site-wide failure, the following could not be tested and must be verified once the deployment is fixed:

1. **Form validation** — `/register`, `/login`, `/forgot-password`, `/recruiter-register`, `/contact`
2. **Stripe integration** — `/pricing` checkout buttons
3. **dangerouslySetInnerHTML** — `/blog` XSS sanitization
4. **404 page rendering** — actual 404 page content and design
5. **Navigation** — header/footer links, mobile menu, CTA buttons
6. **Camera test functionality** — `/test-camera` media permissions and UI
7. **Admin login flow** — `/admin-login` separate auth pathway
8. **Recruiter registration** — company-specific fields and validation

---

## Recommendations

| Priority | Action | Owner |
|----------|--------|-------|
| P0 | Purge CDN cache for all `/assets/*` files | DevOps |
| P0 | Verify Render server asset serving configuration | Backend |
| P0 | Check server logs for 500 errors on asset requests | Backend |
| P0 | Validate Vite build output — ensure assets are generated correctly | Frontend |
| P1 | Fix Permissions-Policy header (remove invalid features) | Frontend |
| P2 | Re-run this entire QA Phase 2 test suite after fix | QA |

---

## QA Analyst Sign-Off

**Tester:** Model QA Specialist  
**Date:** 2026-07-08 04:51 GMT+8  
**Status:** 🔴 **CRITICAL BLOCKER** — Site is completely unusable. No further Tier 1 testing can proceed until the deployment is fixed and assets load correctly.
