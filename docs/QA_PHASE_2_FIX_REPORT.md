# QA Phase 2 Fix Report — Staging Asset 500 / Wrong MIME Type

**Service:** Rekrut AI Staging (`rekrutai-staging`)  
**URL:** https://rekrutai-staging.onrender.com  
**Date:** 2026-07-07  
**Status:** ✅ FIXED & VERIFIED

---

## 1. Problem Statement

Staging environment was completely broken — all pages showed **blank white screens**.

Reported symptoms:
1. **JS assets returned HTTP 500** when loaded as subresources from HTML pages (`<script crossorigin>`)
2. **CSS served with MIME type `application/json`** instead of `text/css` (`<link crossorigin>`)
3. **Direct `curl` to the same assets returned HTTP 200** with correct MIME types

---

## 2. Root Cause

**CORS middleware rejection of same-origin requests with `Origin` header.**

The Vite build output includes `crossorigin` attributes on `<script>` and `<link>` tags:

```html
<script type="module" crossorigin src="/assets/index-DTOJjZ5P.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-EO9qE6xm.css">
```

When the browser loads these as subresources, it sends an **`Origin: https://rekrutai-staging.onrender.com`** header (required by the `crossorigin` attribute). The Express `cors()` middleware intercepts this **before** `express.static()` is reached, checks `ALLOWED_ORIGINS`, and — because `https://rekrutai-staging.onrender.com` was **missing** from the list — throws an error.

The global error handler catches this and returns:
- `HTTP 500`
- `content-type: application/json; charset=utf-8`
- Body: `{"error":"Internal server error"}`

This is why:
- Direct `curl` (no `Origin` header) → **200 OK** ✅
- Browser subresource request (with `Origin` header) → **500 + JSON** ❌

### Server Code (Pre-Fix)

```javascript
// server.js lines 269-277
const ALLOWED_ORIGINS = [
    'https://hireloop-vzvw.polsia.app',
    'https://rekrutai-dev.onrender.com',
    // ❌ MISSING: 'https://rekrutai-staging.onrender.com'
    'https://rekrutai.co',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:3001',
];
```

---

## 3. Diagnosis Steps

| Step | Command / Action | Result |
|------|------------------|--------|
| 1 | `curl -sI https://rekrutai-staging.onrender.com/assets/react-BkDpWIrR.js` (no extra headers) | HTTP 200, `content-type: application/javascript` |
| 2 | `curl -sI ... -H "Origin: https://rekrutai-staging.onrender.com"` | HTTP 500, `content-type: application/json` |
| 3 | `curl -sI ... -H "Origin: https://rekrutai-staging.onrender.com" -H "Referer: ..."` | HTTP 500 confirmed — reproduces browser behavior |
| 4 | Checked `server.js` CORS config | `ALLOWED_ORIGINS` missing staging URL |
| 5 | Checked `client/dist/index.html` | `crossorigin` attribute present on all `<script>` and `<link>` tags |
| 6 | Checked `render.yaml` | `autoDeploy: true` for staging service |
| 7 | Checked `client/dist/assets/` file list | All expected files present and valid |
| 8 | Checked `lib/activity-logger.js` & `lib/metrics-collector.js` | Neither throws errors for `/assets/*` requests |

**Key Finding:** The `Origin` header was the sole trigger. Adding it to any curl request reproduced the exact 500 + JSON response seen in browsers.

---

## 4. Fix Applied

### Code Change

**File:** `server.js`  
**Line:** 269-277

```diff
 const ALLOWED_ORIGINS = [
     'https://hireloop-vzvw.polsia.app',
     'https://rekrutai-dev.onrender.com',
+    'https://rekrutai-staging.onrender.com',
     'https://rekrutai.co',
     'http://localhost:5173',
     'http://localhost:3000',
     'http://localhost:3001',
 ];
```

### Commit & Deploy

```bash
# Commit
git add server.js
git commit -m "fix(cors): add rekrutai-staging.onrender.com to ALLOWED_ORIGINS

Fixes 500 errors on JS/CSS assets when loaded as subresources from
browser pages. The crossorigin attribute on script/link tags causes
the browser to send Origin headers, which were rejected by CORS since
the staging URL was not in the allowed origins list."

# Merge to staging branch and push
git checkout staging
git merge dev --no-edit
git push origin staging
```

**Commit:** `e8667ce`  
**Branch:** `staging` → `origin/staging`

Render auto-deploy picked up the push and redeployed the staging service.

---

## 5. Verification

### 5.1 Health Check

```bash
curl -s https://rekrutai-staging.onrender.com/health | jq '.commit'
# → "e8667ce8..." ✅ (new commit deployed)
```

### 5.2 JS Asset (with Origin header — browser-style request)

```bash
curl -sI "https://rekrutai-staging.onrender.com/assets/react-BkDpWIrR.js" \
  -H "Origin: https://rekrutai-staging.onrender.com" \
  -H "Referer: https://rekrutai-staging.onrender.com/" \
  -H "Sec-Fetch-Dest: script" \
  -H "Sec-Fetch-Mode: no-cors" \
  -H "Sec-Fetch-Site: same-origin"
```

**Result:**
```
HTTP/2 200
date: Tue, 07 Jul 2026 21:10:12 GMT
content-type: application/javascript; charset=UTF-8
access-control-allow-credentials: true
access-control-allow-origin: https://rekrutai-staging.onrender.com
```

✅ **HTTP 200** — no more 500  
✅ **Correct MIME type** — `application/javascript`  
✅ **CORS headers present** — `access-control-allow-origin` matches staging URL

### 5.3 CSS Asset (with Origin header)

```bash
curl -sI "https://rekrutai-staging.onrender.com/assets/index-EO9qE6xm.css" \
  -H "Origin: https://rekrutai-staging.onrender.com" \
  -H "Referer: https://rekrutai-staging.onrender.com/" \
  -H "Sec-Fetch-Dest: style" \
  -H "Sec-Fetch-Mode: no-cors" \
  -H "Sec-Fetch-Site: same-origin"
```

**Result:**
```
HTTP/2 200
content-type: text/css; charset=UTF-8
access-control-allow-origin: https://rekrutai-staging.onrender.com
```

✅ **HTTP 200** — no more 500  
✅ **Correct MIME type** — `text/css` (was returning `application/json`)  
✅ **CORS headers present**

### 5.4 HTML Page Load

```bash
curl -s https://rekrutai-staging.onrender.com/ | head -5
```

**Result:** Valid HTML returned, no errors.

---

## 6. Why This Happened

1. **Vite adds `crossorigin` to all `<script type="module">` and `<link rel="stylesheet">` tags** during build (required for ES modules and proper error reporting).
2. **Browsers send `Origin` headers** when loading subresources with `crossorigin`, even for same-origin requests.
3. **The CORS middleware runs before `express.static()`** in the Express middleware stack.
4. **`ALLOWED_ORIGINS` was missing the staging URL**, causing CORS rejection.
5. **The global error handler returns JSON for `/assets/*` paths**, which explains the `application/json` MIME type on CSS requests.

---

## 7. Preventive Measures

1. **Add environment-specific origins to `ALLOWED_ORIGINS` automatically** based on `REKRUT_AI_URL` / `APP_URL` env vars:
   ```javascript
   const ALLOWED_ORIGINS = [
       ...baseOrigins,
       process.env.REKRUT_AI_URL,
       process.env.APP_URL,
   ].filter(Boolean);
   ```

2. **Consider disabling `crossorigin` on same-origin resources** if not needed (Vite config: `build.modulePreload.polyfill: false` or custom HTML transform).

3. **Add a monitoring alert** for 500 errors on `/assets/*` paths — these should never happen for static files.

4. **Add integration test** that loads the staging HTML in a headless browser and verifies all subresources load with 200.

---

## 8. Summary

| Item | Status |
|------|--------|
| Root cause identified | ✅ CORS middleware missing staging origin |
| Fix applied | ✅ Added `https://rekrutai-staging.onrender.com` to `ALLOWED_ORIGINS` |
| Code committed | ✅ `e8667ce` on `staging` branch |
| Deployed to staging | ✅ Render auto-deploy picked up the push |
| JS assets (500 → 200) | ✅ Verified with browser-style curl |
| CSS MIME type (json → css) | ✅ Verified |
| Staging page loads | ✅ HTML returns correctly |

**Staging is now fully operational.** 🚀
