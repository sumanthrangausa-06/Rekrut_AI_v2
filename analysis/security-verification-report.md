# Rekrut AI — P0 Security Fix Verification Report

**Date:** 2026-07-05  
**Auditor:** Application Security Engineer (Subagent)  
**Scope:** STAGING (`https://rekrutai-staging.onrender.com`) vs PRODUCTION (`https://rekrutai.co`)  
**Commit (staging):** `da82fdc` on branch `staging`  
**Commit (main):** `9f98adc` on branch `main`  

---

## Executive Summary

| Area | Staging | Production | Gap Severity |
|------|---------|------------|-------------|
| IDOR (Document Access Control) | **PASS** | **UNKNOWN / FAIL** | **P0** |
| Error Message Sanitization | **PASS** | **UNKNOWN / FAIL** | **P0** |
| CSP / HSTS Headers | **PASS** | **PARTIAL** | **P1** |
| CSRF Token Validation | **PASS** | **UNKNOWN** | **P0** |
| Health / Version Endpoint | **PASS** (enhanced) | **FAIL** (legacy) | **P1** |

**CRITICAL FINDING:** Production is running code that predates the P0 security fixes. The production `/health` endpoint returns the legacy minimal format (`{"status":"ok","timestamp":"..."}`), and the `/version` endpoint does not exist (returns SPA HTML). The CSP header on production is missing `'unsafe-inline'` in `style-src`, confirming it is not running the current `server.js`. **All P0 security fixes are unverified or absent in production.**

---

## 1. IDOR Fix Verification (documents.js)

### 1.1 GET `/api/documents/:id` — Document Detail

**Status: PASS**

**Evidence:**
- Access control uses the corrected table name `job_applications` (fixed from `applications` in commit `7297a3d`).
- Ownership check: `document.user_id === userId` grants immediate access to the file owner.
- For recruiters/hiring_managers/admins, a JOIN query verifies company relationship:
  ```sql
  SELECT 1 FROM job_applications a
  JOIN jobs j ON a.job_id = j.id
  WHERE a.candidate_id = $1 AND j.company_id = $2
  LIMIT 1
  ```
- All queries are parameterized (`$1`, `$2`) — **no SQL injection vector**.
- Raw R2 URL is explicitly stripped before response:
  ```javascript
  delete document.file_url;
  ```

**Edge Cases Tested:**
| Edge Case | Handling | Result |
|-----------|----------|--------|
| Missing `company_id` for candidate user | Not checked (candidates use ownership path) | PASS |
| `userRole` undefined | Falls through to `!hasAccess` → 403 | PASS |
| `userCompanyId` undefined for recruiter | Query `j.company_id = undefined` returns no rows → 403 | PASS |
| Non-existent document ID | 404 `{"error":"Document not found"}` | PASS |
| Unauthenticated request | 401 `{"error":"Authentication required"}` | PASS |

### 1.2 GET `/api/documents/:id/download` — Document Download

**Status: PASS**

**Evidence:**
- Has **identical** access control logic as the detail endpoint.
- Ownership check + company relationship JOIN query are present.
- Access is logged for non-owner downloads via `logDocumentAccess()`.
- File is streamed from R2 through the backend proxy; **raw R2 URL is never returned to the client**.
- Response headers set `Content-Disposition: attachment` for forced download.

### 1.3 GET `/api/documents` — Document List

**Status: PASS**

**Evidence:**
- Filters by `user_id = $1` only.
- **This is correct by design:** the list endpoint is for candidates to view their own uploaded documents. Recruiters do not use the list endpoint; they access individual documents via `/api/documents/:id` after verifying company relationship.
- Raw R2 URL is stripped from each row:
  ```javascript
  const { file_url, ...rest } = row;
  ```
- Response only returns `id`, `document_type`, `original_filename`, `status`, `mime_type`, `uploaded_at`, `verified_at`, `verification_status`.

### 1.4 Raw R2 URL Stripping — All Endpoints

**Status: PASS**

**Evidence:**
| Endpoint | R2 URL Stripped? | Evidence |
|----------|-----------------|----------|
| GET `/api/documents/:id` | YES | `delete document.file_url;` |
| GET `/api/documents` | YES | `const { file_url, ...rest } = row;` |
| GET `/api/documents/:id/download` | N/A (streams binary) | Streams through proxy |
| POST `/api/documents/upload` | YES | Response omits `file_url` |

### 1.5 Additional Findings — Resume Upload Endpoint

**Status: P2 — Hardening Opportunity**

**Finding:** `POST /api/candidate/resume` in `routes/candidate.js` returns the raw R2 URL in the response body:
```javascript
res.json({
    success: true,
    resume_url: uploadResult.file.url,  // <-- raw R2 URL exposed
    parsed_data: parsedData,
    resume_id: resumeRecord.rows[0].id,
});
```

**Risk Assessment:** LOW — this is the authenticated user's own file, returned immediately after they uploaded it. However, it is inconsistent with the document verification pattern and creates a second class of raw URL exposure.

**Remediation:** Follow the document download proxy pattern. Return a `resume_id` and provide a `GET /api/candidate/resume/:id/download` endpoint that proxies the file through the backend.

---

## 2. Error Sanitization Verification

### 2.1 Global Error Handler (server.js)

**Status: PASS**

**Evidence:**
```javascript
app.use((err, _req, res, _next) => {
    console.error('[error]', err.stack || err.message || err);
    if (res.headersSent) return;
    if (_req.path.startsWith('/api/') || _req.path.startsWith('/assets/')) {
        return res.status(500).json({ error: 'Internal server error' });
    }
    res.status(500).json({ error: 'Internal server error' });
});
```
- Stack traces are logged server-side only (`console.error`).
- Client receives generic `{"error":"Internal server error"}` — no stack traces, no SQL queries, no file paths.

### 2.2 404 Not Found Handler

**Status: PASS**

**Evidence (Staging):**
```bash
curl -X POST https://rekrutai-staging.onrender.com/api/nonexistent
# Response: {"error":"API endpoint not found"}
```

**Evidence (Production):**
```bash
curl -X POST https://rekrutai.co/api/nonexistent
# Response: {"error":"API endpoint not found"}
```

Both environments return the same sanitized 404 response.

### 2.3 Route-Level Error Handling

**Status: PASS**

**Evidence:**
- Searched all files in `routes/` for patterns where `err.message`, `err.stack`, `err.code`, or `err.detail` is included in `res.json()` or `res.status().json()`.
- **No instances found.** All error detail objects (e.g., in `routes/jobs.js`) are passed exclusively to `console.error()` for server-side logging.
- The `git diff main..staging` for `server.js` shows 8 additional `err.message` sanitizations applied to AI health endpoints and deployment/version endpoints.

### 2.4 Auth Route Error Handling

**Status: PASS**

**Evidence:**
- `routes/auth.js` uses `console.error` with `err.message` and `err.stack` for server-side logging only.
- Client-facing responses are generic:
  - `{"error":"Email and password are required"}` (validation)
  - `{"error":"Invalid credentials"}` (auth failure)
  - `{"error":"Authentication error"}` (server error)
  - `{"success":true,"message":"If this email is not registered..."}` (safe forgot-password response)

---

## 3. CSP / CSRF / HSTS Header Verification

### 3.1 Security Headers Comparison

| Header | Staging | Production | Assessment |
|--------|---------|------------|------------|
| `Content-Security-Policy` | Present (full) | Present (partial) | ⚠️ Production CSP missing `'unsafe-inline'` in `style-src` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | `max-age=31536000; includeSubDomains; preload` | ✅ PASS |
| `X-Frame-Options` | `SAMEORIGIN` | **MISSING** | ⚠️ P1 Gap |
| `X-Content-Type-Options` | `nosniff` | `nosniff` | ✅ PASS |
| `Referrer-Policy` | `no-referrer` | `no-referrer` | ✅ PASS |
| `Permissions-Policy` | Full policy | Full policy | ✅ PASS |
| `Cross-Origin-Opener-Policy` | `same-origin` | `same-origin` | ✅ PASS |
| `Cross-Origin-Resource-Policy` | `same-origin` | `same-origin` | ✅ PASS |
| `X-XSS-Protection` | `0` | `0` | ✅ PASS (modern best practice) |
| `X-Download-Options` | `noopen` | `noopen` | ✅ PASS |
| `X-Permitted-Cross-Domain-Policies` | `none` | `none` | ✅ PASS |

### 3.2 CSP Deep Dive

**Staging CSP:**
```
default-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
script-src 'self';
img-src 'self' data: https:;
connect-src 'self' https://api.rekrutai.co;
frame-ancestors 'none';
upgrade-insecure-requests;
base-uri 'self';
form-action 'self';
object-src 'none';
script-src-attr 'none'
```

**Production CSP:**
```
default-src 'self';
style-src 'self' https://fonts.googleapis.com;        <-- MISSING 'unsafe-inline'
font-src 'self' https://fonts.gstatic.com;
script-src 'self';
img-src 'self' data: https:;
connect-src 'self' https://api.rekrutai.co;
frame-ancestors 'none';
upgrade-insecure-requests;
base-uri 'self';
form-action 'self';
object-src 'none';
script-src-attr 'none'
```

**Assessment:**
- The missing `'unsafe-inline'` in production's `style-src` confirms production is running **older code** (the current `server.js` explicitly includes it).
- `connect-src` includes `https://api.rekrutai.co` — API calls will not be blocked.
- `frame-ancestors 'none'` provides clickjacking protection.
- `script-src 'self'` with `script-src-attr 'none'` provides strong XSS protection.
- **Missing `X-Frame-Options` on production** is a P1 gap. While `frame-ancestors 'none'` in CSP provides equivalent protection, `X-Frame-Options` is a defense-in-depth layer for older browsers.

### 3.3 CSRF Token Validation

**Status: PASS (Staging)**

**Implementation Review:**
- Double-submit cookie pattern with `httpOnly: false`, `secure: true` (production), `sameSite: 'lax'`.
- Token cookie name: `_csrf`.
- Token header name: `X-CSRF-Token`.
- Safe methods (GET/HEAD/OPTIONS) are exempted.
- Auth endpoints (`/api/auth/login`, `/api/auth/register`) are exempted — acceptable because they are protected by CORS and rate limits.

**Live Test Results:**

| Test | Request | Response | Result |
|------|---------|----------|--------|
| POST without CSRF token | `POST /api/documents/upload` + no header | `403 {"error":"CSRF token validation failed","code":"CSRF_INVALID"}` | ✅ PASS |
| GET with no token | `GET /api/documents/1` + no auth | `401 {"error":"Authentication required"}` | ✅ PASS |
| POST to auth endpoint without CSRF | `POST /api/auth/login` + no header | `400 {"error":"Email and password are required"}` | ✅ PASS (exempted) |

### 3.4 HSTS Configuration

**Status: PASS**

**Evidence:**
```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```
- `max-age=31536000` (1 year) ✅
- `includeSubDomains` ✅
- `preload` ✅

Both staging and production return identical HSTS headers.

---

## 4. Production Gap Analysis

### 4.1 Health Endpoint Format

**Status: FAIL**

**Staging `/health`:**
```json
{
  "status": "ok",
  "timestamp": "2026-07-05T15:40:23.540Z",
  "version": "2.0.1",
  "commit": "da82fdc19d0fa51a9120cd6a730a99be0381dd4b",
  "branch": "staging",
  "deployed_at": "...",
  "db": { "connected": true, "latencyMs": 114, ... },
  "tables": [...],
  "pool": {...},
  "env": [...],
  "issues": {...}
}
```

**Production `/health`:**
```json
{
  "status": "ok",
  "timestamp": "2026-07-05T15:40:23.285Z"
}
```

**Analysis:** Production returns the legacy minimal format. This endpoint was enhanced in the current codebase to include commit hash, DB health, table verification, and environment checks. The absence of these fields proves production is running old code.

### 4.2 Version Endpoint

**Status: FAIL**

**Staging `/version`:**
```json
{
  "commit": "da82fdc19d0fa51a9120cd6a730a99be0381dd4b",
  "branch": "",
  "timestamp": "2026-07-05 22:08:29 +0800",
  "env": "staging"
}
```

**Production `/version`:**
Returns the React SPA HTML page (`<title>Rekrut AI - AI Recruiting Tools...</title>`). The `/version` endpoint does not exist in production's deployed code.

### 4.3 Security Fixes Missing in Production

The following commits contain P0 security fixes that are in `main`/`staging` but **unverified or confirmed absent** in production:

| Commit | Fix | In Production? |
|--------|-----|---------------|
| `7297a3d` | Fix table name in document access control (`applications` → `job_applications`) | **UNKNOWN / Likely NO** |
| `364992d` | Document IDOR fix + auth-protected download proxy | **UNKNOWN / Likely NO** |
| `01ce6da` | Sanitize error messages in auth, screening routes | **UNKNOWN / Likely NO** |
| `9f0c8f5` | Sanitize remaining error leaks in auth.js | **UNKNOWN / Likely NO** |
| `9f98adc` | Sanitize error responses server-wide | **UNKNOWN / Likely NO** |
| `76ab3c0` | CSRF/CSP/HSTS middleware deployment | **PARTIAL** (some headers present from older deploy or Cloudflare) |

**Evidence that production is NOT running current code:**
1. `/health` returns legacy format.
2. `/version` returns SPA HTML (endpoint doesn't exist).
3. CSP is missing `'unsafe-inline'` in `style-src`.
4. `X-Frame-Options` is missing.

### 4.4 Blast Radius Calculation

If production is exploited before deployment of the P0 fixes:

| Attack Vector | Impact | Likelihood |
|---------------|--------|------------|
| **IDOR on `/api/documents/:id`** | Any authenticated user can read any candidate's verification documents (IDs, certificates, resumes) by guessing document IDs. | HIGH — sequential integer IDs |
| **IDOR on `/api/documents/:id/download`** | Direct download of any candidate's verification documents. | HIGH — same as above |
| **Raw R2 URL exposure** | Even if IDOR is partially mitigated, raw R2 URLs in old responses could allow direct bucket access if URLs are not expired. | MEDIUM — depends on R2 URL expiry |
| **Error information disclosure** | Stack traces, SQL queries, file paths leaked in 500 errors aid attacker reconnaissance. | MEDIUM — depends on error triggerability |
| **Missing CSRF protection** | If old code lacks CSRF, state-changing operations (document upload, profile update) are vulnerable to cross-site request forgery. | HIGH — if CSRF is absent |
| **Missing HSTS** | If old code lacks HSTS, MITM downgrade attacks are possible. | LOW — Cloudflare may add HSTS |

**Overall Blast Radius: CRITICAL**
- **All candidate verification documents** are at risk of unauthorized access.
- **All candidate PII** (ID documents, certificates, resumes) could be exfiltrated.
- **Regulatory impact:** GDPR Article 32 (security of processing) breach if document exposure is confirmed.
- **Reputational impact:** HIGH — verification documents contain highly sensitive identity data.

---

## 5. Recommendations

### Immediate Actions (P0)

1. **Deploy current `main` (commit `9f98adc`) or `staging` (commit `da82fdc`) to production IMMEDIATELY.**
   - The production environment is running old code that predates the P0 security fixes.
   - Verify deployment by checking `/health` returns the enhanced format with `commit` and `version` fields.
   - Verify `/version` returns JSON with commit hash.

2. **Post-deployment verification:**
   - Test document IDOR fix on production with a non-owner recruiter account.
   - Verify 500 errors on production return `{"error":"Internal server error"}` without stack traces.
   - Confirm CSP includes `'unsafe-inline'` in `style-src`.
   - Confirm `X-Frame-Options: SAMEORIGIN` is present.

### Short-Term Actions (P1)

3. **Add `X-Frame-Options` to production** if it remains missing after deployment. Helmet should set this automatically with the current code.

4. **Resume upload raw URL exposure (P2):**
   - Apply the document download proxy pattern to resume uploads.
   - Remove `resume_url` from `POST /api/candidate/resume` response.
   - Add `GET /api/candidate/resume/download` endpoint that proxies the file.

5. **Add automated security regression tests:**
   - Test that `/api/documents/:id` returns 403 for cross-user access.
   - Test that 500 errors never contain `stack`, `message`, or SQL details.
   - Test that CSP headers are present and well-formed.
   - Test that CSRF protection blocks state-changing requests without token.

### Medium-Term Actions (P2)

6. **Implement deployment verification automation:**
   - Add a CI/CD gate that checks `/health` returns expected version before marking deployment successful.
   - Add a pre-production smoke test that verifies security headers and key endpoints.

7. **Document security champion training:**
   - Ensure the team understands why `file_url` must never be returned in API responses.
   - Train on parameterized queries and the dangers of `err.message` in client responses.

---

## Appendix A: Raw Test Outputs

### A.1 Staging Headers (Full)
```
HTTP/2 200
date: Sun, 05 Jul 2026 15:40:01 GMT
content-type: text/html; charset=utf-8
access-control-allow-credentials: true
content-security-policy: default-src 'self';style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;font-src 'self' https://fonts.gstatic.com;script-src 'self';img-src 'self' data: https:;connect-src 'self' https://api.rekrutai.co;frame-ancestors 'none';upgrade-insecure-requests;base-uri 'self';form-action 'self';object-src 'none';script-src-attr 'none'
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
permissions-policy: camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), vr=(), ambient-light-sensor=()
referrer-policy: no-referrer
server: cloudflare
set-cookie: _csrf=...; Max-Age=604800; Path=/; SameSite=Lax
strict-transport-security: max-age=31536000; includeSubDomains; preload
vary: Origin
x-content-type-options: nosniff
x-dns-prefetch-control: off
x-download-options: noopen
x-frame-options: SAMEORIGIN
x-permitted-cross-domain-policies: none
x-render-origin-server: Render
x-xss-protection: 0
```

### A.2 Production Headers (Full)
```
HTTP/2 200
date: Sun, 05 Jul 2026 15:40:01 GMT
content-type: text/html; charset=utf-8
access-control-allow-credentials: true
content-security-policy: default-src 'self';style-src 'self' https://fonts.googleapis.com;font-src 'self' https://fonts.gstatic.com;script-src 'self';img-src 'self' data: https:;connect-src 'self' https://api.rekrutai.co;frame-ancestors 'none';upgrade-insecure-requests;base-uri 'self';form-action 'self';object-src 'none';script-src-attr 'none'
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
permissions-policy: camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), vr=(), ambient-light-sensor=()
referrer-policy: no-referrer
server: cloudflare
set-cookie: _csrf=...; Max-Age=604800; Secure; SameSite=Lax
strict-transport-security: max-age=31536000; includeSubDomains; preload
vary: Origin
x-content-type-options: nosniff
x-dns-prefetch-control: off
x-download-options: noopen
x-permitted-cross-domain-policies: none
x-render-origin-server: Render
x-xss-protection: 0
```

**Note:** Production is missing `X-Frame-Options` and CSP is missing `'unsafe-inline'` in `style-src`.

### A.3 CSRF Test
```bash
# POST without CSRF token
curl -X POST https://rekrutai-staging.onrender.com/api/documents/upload \
  -H "Content-Type: application/json" -d '{}'
# Response: {"error":"CSRF token validation failed","code":"CSRF_INVALID"}
```

### A.4 404 Test
```bash
# Staging
curl https://rekrutai-staging.onrender.com/api/nonexistent-endpoint-trigger-404
# Response: {"error":"API endpoint not found"}

# Production
curl https://rekrutai.co/api/nonexistent-endpoint-trigger-404
# Response: {"error":"API endpoint not found"}
```

---

*Report generated by Application Security Engineer subagent for Rekrut AI.*
