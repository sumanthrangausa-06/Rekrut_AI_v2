# Rekrut AI — Production Security Checklist

> **Version:** 1.0  
> **Date:** 2026-06-09  
> **Source:** `prod-security-audit.md`  
> **Scope:** All Critical + High findings from the pre-launch security audit  
> **Status:** 🔴 0/3 Critical/High items fixed — **DO NOT LAUNCH**

---

## Findings Summary

| ID | Severity | Title | Fixed | Owner | Verification |
|----|----------|-------|-------|-------|--------------|
| **CRITICAL-1** | 🔴 CRITICAL | Helmet security headers bypassed on `/health` | ❌ NO | Backend Dev | `curl -I https://rekrutai.co/health` must show `strict-transport-security`, `x-frame-options`, `content-security-policy` |
| **CRITICAL-2** | 🔴 CRITICAL | CSP `script-src 'unsafe-inline'` allows XSS | ❌ NO | Frontend / Backend Dev | `curl -I https://rekrutai.co` must NOT contain `'unsafe-inline'` in `content-security-policy` |
| **HIGH-1** | 🔴 HIGH | `.env` file contains real DB credentials + weak secrets | ❌ NO | DevOps | Neon password rotated; `.env` file removed from workspace; `JWT_SECRET` / `SESSION_SECRET` regenerated |

---

## CRITICAL-1: Helmet Security Headers Bypassed on `/health`

### Finding
- **Severity:** CRITICAL
- **Location:** `server.js` lines 50–55 (health endpoint registered before `helmet()`)
- **Evidence:** `curl -I https://rekrutai.co/health` returns only Cloudflare headers. No `X-Frame-Options`, `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, or `Permissions-Policy`.
- **Impact:** HSTS missing on health endpoint means network attacker could intercept health-check traffic. Pattern suggests middleware order may be cargo-culted; other endpoints could also be unprotected.

### Fix Status: ❌ NOT FIXED

### Who Fixes It
**Backend Developer** (code change in `server.js`)

### How to Fix
1. **Option A (Preferred):** Move `app.use(helmet(...))` to the **absolute top** of the middleware stack, before `app.get('/health', ...)`. This ensures every response including `/health` gets all security headers.
2. **Option B (Minimal):** Explicitly emit the baseline security headers inside the health handler:
   ```js
   app.get('/health', (req, res) => {
     res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
     res.setHeader('X-Content-Type-Options', 'nosniff');
     res.setHeader('X-Frame-Options', 'DENY');
     res.setHeader('Content-Security-Policy', "default-src 'self'");
     res.json({ status: 'ok', timestamp: new Date().toISOString() });
   });
   ```

### How to Verify It's Fixed
```bash
# Check all baseline headers are present on /health
curl -s -I https://rekrutai.co/health | grep -iE "strict-transport-security|x-frame-options|x-content-type-options|content-security-policy"
```
Expected output (all four headers must be present):
```
strict-transport-security: max-age=31536000; includeSubDomains; preload
x-frame-options: DENY
x-content-type-options: nosniff
content-security-policy: ...
```

### Pre-Launch Gate
- ❌ **BLOCKER** — Must be fixed before public launch.

---

## CRITICAL-2: CSP `script-src 'unsafe-inline'` Allows XSS Injection

### Finding
- **Severity:** CRITICAL
- **Location:** `server.js` line 66
- **Evidence:**
  ```js
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        scriptSrc: ["'self'", "'unsafe-inline'"],  // ← renders CSP useless for scripts
        ...
      }
    }
  }));
  ```
- **Impact:** If any XSS vector exists (React `dangerouslySetInnerHTML`, third-party lib vulnerability, DOM-based sink), the browser will execute the payload despite CSP being present. `'unsafe-inline'` effectively disables script-src CSP protection.

### Fix Status: ❌ NOT FIXED

### Who Fixes It
**Frontend Developer** (primary) + **Backend Developer** (CSP configuration in `server.js`)

### How to Fix
1. **Remove `'unsafe-inline'` from `scriptSrc`** in the Helmet CSP configuration.
2. If inline scripts are required for the React build, choose one of:
   - **Nonce approach:** Generate a CSP nonce per request, inject it into the HTML `<script nonce="...">` tags, and include the nonce in the CSP header: `script-src 'self' 'nonce-...'`.
   - **Hash approach:** Compute a SHA-256 hash of the inline script block and include it in the CSP: `script-src 'self' 'sha256-...'`.
   - **External scripts only:** Move all inline scripts to external `.js` files served from the same origin.
3. Update the Helmet CSP config in `server.js`:
   ```js
   app.use(helmet({
     contentSecurityPolicy: {
       directives: {
         defaultSrc: ["'self'"],
         scriptSrc: ["'self'"],  // ← removed 'unsafe-inline'
         styleSrc: ["'self'", "'unsafe-inline'"],  // styles may still need inline (less risky)
         imgSrc: ["'self'", "data:", "https:"],
         connectSrc: ["'self'", "https://api.rekrutai.co"],
         // ... other directives
       }
     }
   }));
   ```

### How to Verify It's Fixed
```bash
# Check CSP header does NOT contain 'unsafe-inline' in script-src
curl -s -I https://rekrutai.co | grep -i "content-security-policy"
```
Expected: The `script-src` directive must NOT contain `'unsafe-inline'`. It should be `script-src 'self'` or `script-src 'self' 'nonce-...'` or `script-src 'self' 'sha256-...'`.

Also verify the React app still loads correctly in the browser (open DevTools → Console; check for CSP violation errors).

### Pre-Launch Gate
- ❌ **BLOCKER** — Must be fixed before public launch.

---

## HIGH-1: `.env` File Contains Real Database Credentials + Weak Secrets

### Finding
- **Severity:** HIGH
- **Location:** `/root/.openclaw/workspace/Rekrut_AI_v2/.env`
- **Evidence:**
  ```
  DATABASE_URL=postgresql://neondb_owner:npg_IC0wumYoWbe4@ep-calm-field-.../neondb?sslmode=require&channel_binding=require
  SESSION_SECRET=dev-secret-change-in-production-rekrutai-v2
  JWT_SECRET=dev-jwt-secret-change-in-production-rekrutai-v2-2026
  ```
- **Impact:** Direct database compromise if `.env` is ever exposed (mirror, backup, volume mount). JWT forgery if the weak secret is used in production. `.gitignore` does not protect the file on the build server/workspace.

### Fix Status: ❌ NOT FIXED

### Who Fixes It
**DevOps Engineer** (password rotation, secret generation, workspace cleanup)

### How to Fix
1. **Rotate the Neon DB password immediately.**
   - Log in to [Neon Console](https://console.neon.tech).
   - Navigate to the project → **Connection Details** → **Reset Password**.
   - Generate a new strong password.
   - Update `DATABASE_URL` in the **Render Dashboard** (not in `.env`):
     - Render Dashboard → **rekrutai-prod** → **Environment** → Edit `DATABASE_URL` with the new connection string.
   - Also update `DATABASE_URL` for staging and dev if they share the same Neon database (or if they use separate Neon databases, rotate those too).
2. **Remove `.env` from the workspace completely.**
   ```bash
   rm /root/.openclaw/workspace/Rekrut_AI_v2/.env
   ```
3. **Generate strong `JWT_SECRET` and `SESSION_SECRET` (≥256 bits).**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Run twice to get two different 64-character hex strings.
4. **Set the new secrets in Render Dashboard only.**
   - Render Dashboard → **rekrutai-prod** → **Environment**.
   - Update `JWT_SECRET` and `SESSION_SECRET` with the new random values.
   - Do NOT save these values in any local file, Slack, or email. Use a password manager or Render's secret storage.
5. **Ensure `.env` is in `.gitignore` and `.dockerignore`.**
   - Verify `.gitignore` contains `.env` and `.env.*` (except `.env.example`).
   - If using Docker, add `.env` to `.dockerignore`.
6. **Ensure CI/CD never archives `.env`.**
   - Check GitHub Actions / GitLab CI / Jenkins pipelines to confirm `.env` is not included in build artifacts or caches.

### How to Verify It's Fixed
| Check | Command / Action | Pass Criteria |
|-------|------------------|---------------|
| Neon password rotated | Neon Console → Connection Details | Old password no longer works. New password works when tested with `psql "..."`. |
| `.env` removed | `ls -la /root/.openclaw/workspace/Rekrut_AI_v2/.env` | File does not exist. |
| `.gitignore` correct | `cat /root/.openclaw/workspace/Rekrut_AI_v2/.gitignore` | Contains `.env` and `.env.local` lines. |
| `.dockerignore` correct | `cat /root/.openclaw/workspace/Rekrut_AI_v2/.dockerignore` | Contains `.env` (if Docker is used). |
| `JWT_SECRET` strong | Render Dashboard → rekrutai-prod → Environment | `JWT_SECRET` is 64-character hex, not a dictionary phrase. |
| `SESSION_SECRET` strong | Render Dashboard → rekrutai-prod → Environment | `SESSION_SECRET` is 64-character hex, not a dictionary phrase. |
| App still works | `curl https://rekrutai.co/health` | 200 OK. Login still works with new secrets. |

### Pre-Launch Gate
- ❌ **BLOCKER** — Must be fixed before public launch. Database credentials are exposed.

---

## MEDIUM Findings (Fix Within 7–30 Days)

The following are **not** launch blockers but must be tracked and resolved post-launch.

| ID | Severity | Title | Target Fix | Owner |
|----|----------|-------|------------|-------|
| MEDIUM-1 | ⚠️ MEDIUM | Internal error messages leaked to API clients | Before launch (ideal) | Backend Dev |
| MEDIUM-2 | ⚠️ MEDIUM | bcrypt salt rounds at minimum (10) | Within 7 days | Backend Dev |
| MEDIUM-3 | ⚠️ MEDIUM | `Permissions-Policy` header is narrow, missing defaults | Within 30 days | Backend Dev |
| LOW-1 | ℹ️ LOW | No `X-RateLimit-*` headers on health endpoint | Within 30 days | Backend Dev |

### MEDIUM-1: Internal Error Messages Leaked

**Finding:** Multiple route files return `err.message` or `error.message` directly in 500 JSON responses. This exposes table names, column names, SQL syntax, and file paths to unauthenticated users.

**Fix:** In production mode (`NODE_ENV=production`), strip `message`/`details` from JSON error responses. Return only a generic error + correlation ID. Log the full stack trace server-side.

```js
// Before (in production)
res.status(500).json({ error: 'Failed to get recommendations', details: err.message });

// After (in production)
const ref = req.id || crypto.randomUUID();
console.error(`[ERROR ref=${ref}]`, err);
res.status(500).json({ error: 'Internal server error', ref });
```

**Verify:** `curl` a failing endpoint and confirm no `details` or `message` field in the JSON body.

### MEDIUM-2: bcrypt Salt Rounds at Minimum (10)

**Finding:** Password hashing uses `bcrypt.hash(password, 10)`. OWASP 2023 recommends minimum 12 rounds (preferably 13–14).

**Fix:** Change to `bcrypt.hash(password, 13)`. On next user login, transparently re-hash with the higher cost factor.

**Verify:** Register a new user, inspect the password hash prefix. `$2b$13$...` indicates 13 rounds (correct). `$2b$10$...` indicates 10 rounds (still wrong).

### MEDIUM-3: `Permissions-Policy` Header is Narrow

**Finding:** Only `camera=(self)` and `microphone=(self)` are set. Missing `geolocation`, `payment`, `usb`, `magnetometer`, `gyroscope`, `vr`, etc.

**Fix:** Expand to deny-by-default:
```js
res.setHeader('Permissions-Policy',
  'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), vr=()');
```

**Verify:** `curl -I https://rekrutai.co` shows the expanded `Permissions-Policy` header.

---

## Positive Security Controls (Verified ✅)

The following are already working correctly and do **not** require fixes before launch.

| # | Control | Evidence | Status |
|---|---------|----------|--------|
| ✅ GOOD-1 | Dependency Scan — Zero Vulnerabilities | `npm audit` = 0 across root and client | ✅ PASS |
| ✅ GOOD-2 | SQL Injection — 100% Parameterized Queries | All `routes/` files use `$1, $2, ...` parameter binding | ✅ PASS |
| ✅ GOOD-3 | Refresh Token Rotation + Family Detection | `lib/auth.js` lines 60–90 | ✅ PASS |
| ✅ GOOD-4 | Distributed Rate Limiting via PostgreSQL | `lib/distributed-rate-limiter.js` | ✅ PASS |
| ✅ GOOD-5 | File Upload — Memory-Only + Type Whitelist + R2 Offload | `routes/documents.js` lines 15–30 | ✅ PASS |
| ✅ GOOD-6 | Session Cookie — `httpOnly`, `sameSite: 'lax'`, `secure: true` | `server.js` lines 165–175 | ✅ PASS |
| ✅ GOOD-7 | CORS Whitelist in Production | `server.js` lines 84–98 | ✅ PASS |
| ✅ GOOD-8 | CSRF Double-Submit Cookie Pattern | `server.js` lines 116–149 | ✅ PASS |
| ✅ GOOD-9 | `x-powered-by` Disabled | `server.js` line 45 | ✅ PASS |
| ✅ GOOD-10 | Admin Panel — Separate Session + Rate Limiting | `routes/admin.js` lines 30–120 | ✅ PASS |

---

## Pre-Launch Security Go/No-Go

| # | Gate | Status |
|---|------|--------|
| 1 | CRITICAL-1 fixed (headers on `/health`) | ❌ NOT FIXED |
| 2 | CRITICAL-2 fixed (CSP `unsafe-inline` removed) | ❌ NOT FIXED |
| 3 | HIGH-1 fixed (`.env` purged, secrets rotated) | ❌ NOT FIXED |
| 4 | `npm audit` still = 0 | ✅ PASS |
| 5 | All parameterized queries confirmed | ✅ PASS |
| 6 | Rate limiting active | ✅ PASS |
| 7 | CORS strict whitelist | ✅ PASS |
| 8 | Session cookies secure | ✅ PASS |

### 🚫 Verdict: NO-GO

**Do not launch to the public until CRITICAL-1, CRITICAL-2, and HIGH-1 are resolved.** These are all code or configuration changes that require developer intervention and cannot be automated by DevOps alone.

**Estimated fix time:**
- CRITICAL-1: 30 minutes (move helmet or add headers to health handler)
- CRITICAL-2: 1–2 hours (remove `unsafe-inline`, verify React app loads, may need nonce/hash implementation)
- HIGH-1: 30 minutes (rotate password, generate secrets, remove `.env`)

**Total:** ~2–3 hours of developer work.

---

*End of security checklist. Update status after each fix is deployed.*
