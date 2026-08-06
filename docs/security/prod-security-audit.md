# Rekrut AI v2 — Production Security Audit

**Date:** 2026-06-09  
**Auditor:** Application Security Engineer (Subagent)  
**Scope:** Full-stack application (Node.js backend + React frontend) pre-public-launch  
**Environment:** Production (https://rekrutai.co) + Staging (https://rekrutai-staging.onrender.com)  

---

## 1. Executive Summary

| Category | Status | Score |
|----------|--------|-------|
| Dependency Hygiene | ✅ PASS | 0 vulns |
| Authentication & Authorization | ✅ PASS | Solid implementation |
| Session & JWT Security | ⚠️ PASS with notes | Minor hardening opportunities |
| Input Validation & SQL Injection | ✅ PASS | Parameterized queries throughout |
| File Upload Security | ✅ PASS | Memory-only, type-restricted, offloaded to R2 |
| Rate Limiting | ✅ PASS | Distributed RL via PostgreSQL |
| Security Headers (CSP/HSTS) | 🔴 CRITICAL GAPS | Missing in production for health endpoints; weak CSP directives |
| Secret Management | 🔴 HIGH | Hardcoded dev secrets in `.env` file; exposed DB credentials |
| Error Handling | ⚠️ MEDIUM | Internal error messages leaked to clients in multiple routes |
| CORS Configuration | ✅ PASS | Strict whitelist in production |
| Cloud/Platform Config | ⚠️ INFO | Cloudflare strips some headers; review cache policies |

**Overall:** The application has a strong security foundation with modern patterns (refresh-token rotation, distributed rate limiting, parameterized queries, CSRF double-submit cookies). **Two issues must be fixed before public launch:** (1) security headers are not emitted on the health-check path and CSP allows `unsafe-inline` scripts, and (2) the `.env` file in the workspace contains real database credentials and weak development secrets.

---

## 2. Detailed Findings

### 🔴 CRITICAL-1: Helmet Security Headers Bypassed on `/health` Endpoint

| | |
|---|---|
| **Severity** | CRITICAL |
| **Location** | `server.js` lines 50–55 (health endpoint) vs. line 60 (helmet) |
| **Description** | The `/health` and `/api/health` endpoints are registered **before** `app.use(helmet(...))`. Consequently, every monitoring/health probe response omits `X-Frame-Options`, `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, and `Permissions-Policy`. |
| **Evidence** | `curl -I https://rekrutai.co/health` returns only Cloudflare headers (`server: cloudflare`, `cf-ray`, `cf-cache-status`). No `X-Frame-Options`, no `content-security-policy`, no `strict-transport-security`. Same result on staging. |
| **Impact** | While `/health` is a low-sensitivity endpoint, the absence of HSTS means a network attacker could intercept health-check traffic. More importantly, this pattern suggests the middleware order may have been cargo-culted; if other public endpoints were accidentally placed before helmet, they would also be unprotected. |
| **Fix** | Move helmet registration to the **absolute top** of the middleware stack (before `app.get('/health', ...)`), or explicitly emit the security headers inside the health handler:  |
| | ```js
| | app.get('/health', (req, res) => {
| |   res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
| |   res.setHeader('X-Content-Type-Options', 'nosniff');
| |   res.setHeader('X-Frame-Options', 'DENY');
| |   res.json({ status: 'ok', timestamp: new Date().toISOString() });
| | });
| | ``` |
| **Status** | ⬜ FIX BEFORE LAUNCH |

---

### 🔴 CRITICAL-2: CSP `script-src 'unsafe-inline'` Allows XSS Injection

| | |
|---|---|
| **Severity** | CRITICAL |
| **Location** | `server.js` line 66 |
| **Description** | The Helmet CSP directive sets `scriptSrc: ["'self'", "'unsafe-inline'"]`. This effectively disables CSP's primary defense against reflected/stored XSS because any injected `<script>` tag will execute. |
| **Evidence** | ```js
| | app.use(helmet({
| |   contentSecurityPolicy: {
| |     directives: {
| |       scriptSrc: ["'self'", "'unsafe-inline'"],  // ← renders CSP useless for scripts
| |       ...
| |     }
| |   }
| | }));
| | ``` |
| **Impact** | If an attacker finds any XSS vector (e.g., via a React `dangerouslySetInnerHTML` bug, a third-party library vulnerability, or a DOM-based sink), the browser will execute the payload despite CSP being present. |
| **Fix** | Remove `'unsafe-inline'` from `scriptSrc`. If inline scripts are absolutely required for the React build, generate a nonce per request and inject it into the HTML + CSP header, or use a strict hash for the inline script block.  |
| **Status** | ⬜ FIX BEFORE LAUNCH |

---

### 🔴 HIGH-1: `.env` File Contains Real Database Credentials & Weak Secrets

| | |
|---|---|
| **Severity** | HIGH |
| **Location** | `/root/.openclaw/workspace/Rekrut_AI_v2/.env` |
| **Description** | The `.env` file in the workspace contains a **real** Neon PostgreSQL connection string with username/password, as well as weak development-only JWT and session secrets. Although `.env` is listed in `.gitignore`, the file itself is present on the build server/workspace. If this workspace is ever mirrored, backed up, or exposed via a misconfigured volume mount, the credentials leak instantly. |
| **Evidence** | ```
| | DATABASE_URL=postgresql://neondb_owner:npg_IC0wumYoWbe4@ep-calm-field-.../neondb?sslmode=require&channel_binding=require
| | SESSION_SECRET=dev-secret-change-in-production-rekrutai-v2
| | JWT_SECRET=dev-jwt-secret-change-in-production-rekrutai-v2-2026
| | ``` |
| **Impact** | Direct database compromise; JWT forgery if the weak secret is ever used in production. |
| **Fix** | 1. **Rotate the Neon password immediately** — the current password is exposed in this file.  <br>2. Remove `.env` from the workspace entirely; rely on Render environment variables (`sync: false`) for production.  <br>3. Ensure `SESSION_SECRET` and `JWT_SECRET` are **cryptographically random** (≥256 bits, generated with `crypto.randomBytes(32).toString('hex')`) and stored **only** in the Render dashboard / secret manager.  <br>4. Add `.env` to `.dockerignore` if using Docker, and ensure CI/CD never archives it. |
| **Status** | ⬜ FIX BEFORE LAUNCH |

---

### ⚠️ MEDIUM-1: Internal Error Messages Leaked to API Clients

| | |
|---|---|
| **Severity** | MEDIUM |
| **Location** | Multiple route files (`routes/matching.js`, `routes/recruiter.js`, `routes/billing.js`, `routes/communications.js`, `routes/screening.js`, `routes/admin.js`) |
| **Description** | Several 500-error handlers return `err.message` or `error.message` directly in the JSON response body. This exposes internal implementation details (table names, column names, SQL syntax, file paths) to unauthenticated or low-privilege users. |
| **Evidence** | ```js
| | // routes/matching.js:57
| | res.status(500).json({ error: 'Failed to get recommendations', details: err.message });
| | // routes/billing.js:182
| | res.status(error.status || 500).json({ error: error.message || 'Failed to create checkout session.' });
| | // routes/admin.js (revenue endpoint)
| | res.status(500).json({ error: 'Failed to load revenue metrics', message: error.message });
| | ``` |
| **Impact** | Information disclosure aids reconnaissance for attackers mapping the API surface and database schema. |
| **Fix** | Strip `message`/`details` from production error responses. Log the full stack trace server-side (with a correlation ID), but return only a generic message to the client:  |
| | ```js
| | res.status(500).json({ error: 'Internal server error', ref: req.id });
| | ``` |
| **Status** | ⬜ FIX BEFORE LAUNCH (or within 7 days post-launch) |

---

### ⚠️ MEDIUM-2: bcrypt Salt Rounds at Minimum (10)

| | |
|---|---|
| **Severity** | MEDIUM |
| **Location** | `routes/auth.js` lines 120, 749; `routes/company.js` (registration) |
| **Description** | Password hashing uses `bcrypt.hash(password, 10)`. OWASP 2023 and NIST recommend **minimum 12 rounds** (preferably 13–14) for modern hardware. At 10 rounds, password hashes are more susceptible to offline GPU/ASIC attacks. |
| **Evidence** | `const password_hash = await bcrypt.hash(password, 10);` |
| **Impact** | If the user database is ever exfiltrated, weak hashes crack faster. |
| **Fix** | Increase to `bcrypt.hash(password, 13)` (or 12 minimum). On the next user login, transparently re-hash with the higher cost factor. |
| **Status** | ⬜ FIX BEFORE LAUNCH (or within 30 days) |

---

### ⚠️ MEDIUM-3: `Permissions-Policy` Header is Narrow but Manually Set

| | |
|---|---|
| **Severity** | MEDIUM |
| **Location** | `server.js` lines 102–104 |
| **Description** | The custom middleware sets `Permissions-Policy: camera=(self), microphone=(self)` but omits other powerful features: `geolocation`, `payment`, `usb`, `magnetometer`, `gyroscope`, `vr`, `ambient-light-sensor`, etc. |
| **Impact** | If the application (or a compromised third-party script embedded via the weak CSP) tries to access sensors, the browser will allow it by default. |
| **Fix** | Expand to a deny-by-default policy:  |
| | ```js
| | res.setHeader('Permissions-Policy',
| |   'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), vr=()');
| | ``` |
| **Status** | ⬜ LOW PRIORITY — fix within 30 days |

---

### ⚠️ LOW-1: Production API Does Not Emit `X-RateLimit-*` Headers on Health Check

| | |
|---|---|
| **Severity** | LOW |
| **Location** | Production `/health` endpoint |
| **Description** | The distributed rate limiter adds `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers on rate-limited routes, but the health endpoint is exempt. This is intentional, but the absence of `X-Content-Type-Options` and other baseline headers on the health path means external security scanners may flag the endpoint. |
| **Impact** | Scanner noise; minor compliance issue. |
| **Fix** | Apply baseline security headers to the health endpoint (see CRITICAL-1 fix). |
| **Status** | ℹ️ INFO — address with CRITICAL-1 |

---

### ✅ GOOD-1: Dependency Scan — Zero Vulnerabilities

| | |
|---|---|
| **Severity** | INFO (positive) |
| **Location** | Root `package.json` + `client/package.json` |
| **Result** | `npm audit` (both root and client) returned **0 vulnerabilities** across all severity levels. |
| **Details** | Root: 174 prod deps, 4 dev deps. Client: 13 prod deps, 180 dev deps. |
| **Recommendation** | Keep Dependabot/Renovate enabled. Re-run audit weekly. |

---

### ✅ GOOD-2: No SQL Injection — 100% Parameterized Queries

| | |
|---|---|
| **Severity** | INFO (positive) |
| **Location** | All route files under `routes/` |
| **Result** | Every database query observed uses `$1, $2, ...` parameter binding. No string concatenation into SQL was found. |
| **Details** | Examples: `pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id])` |
| **Recommendation** | Continue current pattern. Add a Semgrep/ESLint rule to block `.query()` calls with template literals or `+` concatenation. |

---

### ✅ GOOD-3: Refresh Token Rotation + Family Detection

| | |
|---|---|
| **Severity** | INFO (positive) |
| **Location** | `lib/auth.js` lines 60–90 |
| **Result** | Refresh tokens are stored as SHA-256 hashes, rotated on every use, and the entire family is revoked on reuse (token rotation detection). This is a best-practice implementation. |
| **Recommendation** | Ensure the `refresh_tokens` table has an index on `token_hash` for fast lookup. |

---

### ✅ GOOD-4: Distributed Rate Limiting via PostgreSQL

| | |
|---|---|
| **Severity** | INFO (positive) |
| **Location** | `lib/distributed-rate-limiter.js` + all AI/auth routes |
| **Result** | Rate limits are enforced in PostgreSQL, not in-memory, so they survive server restarts and work across multiple Render instances. Strict limits: 5 req/15 min for auth, 10 req/min for AI, 60 req/min for standard API. |
| **Recommendation** | Consider adding an `X-RateLimit-*` header to **all** responses (not just rate-limited ones) so clients can pre-emptively throttle. |

---

### ✅ GOOD-5: File Upload — Memory-Only + Type Whitelist + Offload to R2

| | |
|---|---|
| **Severity** | INFO (positive) |
| **Location** | `routes/documents.js` lines 15–30 |
| **Result** | Multer is configured with `memoryStorage()` (no disk writes), a 50 MB limit, and a strict MIME-type whitelist (`pdf`, `jpeg`, `png`, `webp`, `doc`, `docx`). Files are immediately streamed to Polsia R2 via `fetch()`; no persistent local storage. |
| **Recommendation** | Add a magic-number/file-signature check (first few bytes) in addition to MIME-type to prevent extension-spoofing. |

---

### ✅ GOOD-6: Session Cookie Configuration

| | |
|---|---|
| **Severity** | INFO (positive) |
| **Location** | `server.js` lines 165–175 |
| **Result** | Session cookie is `httpOnly`, `sameSite: 'lax'`, `secure: true` in production, and 7-day expiry. Session store is PostgreSQL-backed (`connect-pg-simple`). |
| **Recommendation** | Consider `sameSite: 'strict'` if the SPA does not need cross-site navigation. |

---

### ✅ GOOD-7: CORS Whitelist in Production

| | |
|---|---|
| **Severity** | INFO (positive) |
| **Location** | `server.js` lines 84–98 |
| **Result** | Production CORS origins are strictly whitelisted: `https://rekrutai.co`, `https://www.rekrutai.co`, `https://app.rekrutai.co`, `https://rekrutai-dev.onrender.com`. No wildcard (`*`). Credentials are allowed. |
| **Recommendation** | Remove `https://rekrutai-dev.onrender.com` from the production whitelist after launch. |

---

### ✅ GOOD-8: CSRF Double-Submit Cookie Pattern

| | |
|---|---|
| **Severity** | INFO (positive) |
| **Location** | `server.js` lines 116–149 |
| **Result** | CSRF tokens are generated as 256-bit random values, stored in `httpOnly` cookies, and validated against the `X-CSRF-Token` header. Safe methods (`GET`, `HEAD`, `OPTIONS`) are correctly exempted. |
| **Recommendation** | Ensure the cookie also has `secure` and `sameSite: 'strict'` attributes in production. |

---

### ✅ GOOD-9: `x-powered-by` Disabled

| | |
|---|---|
| **Severity** | INFO (positive) |
| **Location** | `server.js` line 45 |
| **Result** | `app.disable('x-powered-by')` removes the Express fingerprint from responses. |

---

### ✅ GOOD-10: Admin Panel Uses Separate Session + Rate Limiting

| | |
|---|---|
| **Severity** | INFO (positive) |
| **Location** | `routes/admin.js` lines 30–120 |
| **Result** | Admin login has its own rate limiter (5 attempts per 15-minute window), independent bcrypt hash for `ADMIN_PASSWORD`, and a separate session flag (`req.session.isAdmin`). The bridge endpoint allows JWT users with `role === 'admin'` to auto-elevate, which is convenient but should be monitored. |
| **Recommendation** | Add 2FA or IP whitelist for admin access in a future release. |

---

## 3. OWASP Top 10 Mapping

| OWASP Category | Risk Level | Notes |
|---|---|---|
| **A01: Broken Access Control** | LOW | Ownership checks present on most routes (e.g., `WHERE id = $1 AND company_id = $2`). No direct IDOR gaps found in spot checks. |
| **A02: Cryptographic Failures** | MEDIUM | Weak dev secrets in `.env`; bcrypt at 10 rounds. JWT uses HS256 with env secret — acceptable if secret is strong and rotated. |
| **A03: Injection** | LOW | 100% parameterized queries. No `eval`, `new Function`, or `child_process.exec` found. |
| **A04: Insecure Design** | LOW | Well-designed token rotation, distributed RL, and CSRF protection. Health endpoint bypasses helmet (CRITICAL-1). |
| **A05: Security Misconfiguration** | HIGH | Missing headers on health endpoint; weak CSP; `.env` with real creds in workspace. |
| **A06: Vulnerable Components** | LOW | `npm audit` = 0. Continue monitoring. |
| **A07: Authentication Failures** | LOW | Strong password policy, refresh-token rotation, account lockout via rate limiting. No brute-force gaps found. |
| **A08: Software/Data Integrity** | LOW | No unsafe deserialization. JSON bodies are parsed with `express.json()`. Consider adding `zod` or `joi` schema validation to all public endpoints. |
| **A09: Logging Failures** | MEDIUM | Auth events are logged (`auth.log`), but generic error leakage (MEDIUM-1) undermines log confidentiality. Ensure PII (email, IP) in logs is subject to GDPR retention policy. |
| **A10: SSRF** | LOW | `fetch()` calls to external AI APIs (Polsia, OpenAI, NVIDIA) are hardcoded; no user-controlled URL fetching found. |

---

## 4. Pre-Launch Checklist

| # | Item | Severity | Owner | Deadline |
|---|------|----------|-------|----------|
| 1 | Move `helmet()` before `/health` or add headers to health handler | CRITICAL | DevOps | Before launch |
| 2 | Remove `'unsafe-inline'` from `scriptSrc` in CSP; use nonce or hash | CRITICAL | Frontend | Before launch |
| 3 | Rotate Neon DB password and purge `.env` from workspace | HIGH | DevOps | Before launch |
| 4 | Generate strong `JWT_SECRET` and `SESSION_SECRET` (≥256 bits) in Render dashboard only | HIGH | DevOps | Before launch |
| 5 | Strip `err.message` / `error.message` from all production JSON error responses | MEDIUM | Backend | Before launch |
| 6 | Increase bcrypt cost factor from 10 → 13 | MEDIUM | Backend | Within 7 days |
| 7 | Expand `Permissions-Policy` to deny-by-default | MEDIUM | Backend | Within 30 days |
| 8 | Add magic-number file validation to upload handler | LOW | Backend | Within 30 days |
| 9 | Add schema validation (`zod`) to all public API endpoints | LOW | Backend | Within 30 days |
| 10 | Enable Dependabot/Renovate auto-merge for patch updates | INFO | DevOps | Ongoing |

---

## 5. Conclusion

Rekrut AI v2 is **well-architected from a security perspective** and implements many modern best practices: refresh-token rotation, distributed rate limiting, CSRF double-submit cookies, parameterized SQL, strict CORS, and memory-only file uploads. However, **two critical issues** (CSP `unsafe-inline` and missing security headers on the health endpoint) and **one high-risk issue** (hardcoded secrets in the workspace `.env` file) must be resolved before the public launch. Once these are addressed, the application will meet a strong security baseline for a production SaaS.

---

*End of audit.*
