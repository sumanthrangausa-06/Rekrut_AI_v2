# Rekrut AI — Production Security Readiness Audit

**Date:** 2026-06-09  
**Auditor:** Application Security Engineer (sub-agent)  
**Scope:** Staging deployment (`https://rekrutai-staging.onrender.com`), codebase at `/root/.openclaw/workspace/Rekrut_AI_v2/`, auth middleware, rate limiting, CORS, secrets hygiene, and hardcoded credentials.  
**Methodology:** OWASP ASVS 4.0 Level 2, manual code review, staged HTTP probing, grep-based static analysis.

---

## 1. Executive Summary

| Category | Grade | Status |
|---|---|---|
| **Security Headers** | **A** | Production-ready (comprehensive CSP, HSTS preload, COOP, CORP) |
| **Authentication (JWT + Refresh)** | **B+** | Solid token lifecycle, but OAuth callback has a **critical missing function** |
| **Authorization (Admin)** | **B** | Functional, but admin sessions lack timeout/2FA; bridge elevation convenient but risky |
| **Rate Limiting** | **A** | Distributed PostgreSQL-backed, appropriate windows for admin login |
| **CORS** | **A** | Whitelist-based, credentials enabled, no wildcards in production defaults |
| **Secrets Hygiene** | **D** | `.env` with live secrets present in workspace; multiple test scripts with hardcoded credentials |
| **Session Management** | **B** | Secure cookie flags in production, 7-day session, no explicit server-side invalidation beyond logout |
| **Overall Security Readiness** | **C+ / 72%** | **Not production-ready until 3 critical/blocker issues are resolved** |

---

## 2. Critical Findings (Fix Before Production)

### 2.1 CRITICAL: `verifyOauthState` is referenced but never defined
- **File:** `routes/auth.js` lines 383, 508
- **Impact:** OAuth callback handlers for Google and LinkedIn will throw a `ReferenceError` the moment any user attempts OAuth login. The entire OAuth flow is non-functional and will crash the request.
- **Root Cause:** The `verifyOauthState(req, state)` check was added but the helper function was never imported or implemented.
- **Recommendation:** Implement a state-verification helper using the session cookie or a signed cookie. For example:
  ```javascript
  function verifyOauthState(req, state) {
    return req.session && req.session.oauthState && req.session.oauthState === state;
  }
  ```
  Ensure `req.session.oauthState` is populated before redirecting to the OAuth provider and cleared after use (single-use nonce).

### 2.2 HIGH: OAuth tokens transmitted in URL query parameters
- **File:** `routes/auth.js` (OAuth callback redirects)
- **Evidence:** `res.redirect(`${redirectUrl}?token=***&refresh=${refreshToken}`);`
- **Impact:** Access and refresh tokens are exposed in:
  - Browser history
  - Server access logs (if any proxy logs the URL)
  - `Referer` header on subsequent requests to third-party resources
- **Recommendation:** Instead of query parameters, use one of these patterns:
  1. **POST-based redirect:** Redirect to a page that immediately exchanges a short-lived authorization code via POST.
  2. **Fragment-based delivery:** Use `window.location.hash` and have the client strip it before the browser requests sub-resources. Less ideal but better than query params.
  3. **Cookie-based:** Set `httpOnly` session cookies on the callback response and redirect clean.

### 2.3 HIGH: `.env` file with live secrets exists in the workspace
- **File:** `/root/.openclaw/workspace/Rekrut_AI_v2/.env`
- **Impact:** Database password, JWT secret, session secret, admin password, and Stripe test keys are on disk. Even though `.gitignore` excludes `.env`, a misconfigured build or backup could leak these. In a containerized deployment, this file should be injected at runtime, not baked into the image.
- **Recommendation:**
  1. Remove `.env` from the build context (use Render/Cloudflare environment variables or a secret manager).
  2. Rotate all secrets currently stored in that file (database password, JWT secret, session secret, admin password, Stripe keys).
  3. Ensure CI/CD does not copy `.env` into Docker images or deployment bundles.

### 2.4 HIGH: Hardcoded test credentials in multiple files
- **Files:**
  - `test-login.js` → `test_candidate@rekrutai.co` / `Test123!`
  - `test-recruiter-login.js` → `test_recruiter@rekrutai.co` / `Test123!`
  - `test-new-endpoints.js` → same credentials
  - `check-password.js` → `Test@1234`
  - `scripts/test-webhook.js` → `whsec_…cdef`
  - `scripts/test-stripe-flow.js` → `whsec_…cdef`
- **Impact:** Test credentials could accidentally be deployed to production and used for brute-force or credential-stuffing attacks. Stripe webhook secrets are partially masked but still present.
- **Recommendation:**
  1. Move all test credentials to environment variables (`TEST_USER_PASSWORD`, `TEST_WEBHOOK_SECRET`).
  2. Gate test scripts behind `NODE_ENV !== 'production'` checks that throw if they are loaded in production.
  3. Remove or `.gitignore` test scripts from production deployments.

---

## 3. Security Headers Analysis (Staging)

Probed via `curl -I https://rekrutai-staging.onrender.com/api/health`

| Header | Value | Assessment |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; img-src 'self' data: https:; connect-src 'self' https://api.rekrutai.co; frame-ancestors 'none'; upgrade-insecure-requests; base-uri 'self'; form-action 'self'; object-src 'none'; script-src-attr 'none'` | ✅ Strong. `frame-ancestors 'none'` replaces deprecated X-Frame-Options. `script-src 'self'` is good but could be tightened with nonces if inline scripts are introduced. `img-src` allows any `https:` host — consider narrowing to known CDN domains. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | ✅ HSTS with preload. Good for production. |
| `X-Frame-Options` | `SAMEORIGIN` | ✅ Redundant but harmless (CSP `frame-ancestors` is primary). |
| `X-Content-Type-Options` | `nosniff` | ✅ Prevents MIME sniffing. |
| `Referrer-Policy` | `no-referrer` | ✅ No referrer leakage. |
| `Permissions-Policy` | `camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), vr=(), ambient-light-sensor=()` | ✅ Deny-by-default. Camera/micro scoped to same-origin. |
| `Cross-Origin-Opener-Policy` | `same-origin` | ✅ Prevents cross-origin window attacks. |
| `Cross-Origin-Resource-Policy` | `same-origin` | ✅ Prevents cross-origin embeds. |
| `X-XSS-Protection` | `0` | ✅ Correctly disabled (modern browsers rely on CSP). |
| `X-Download-Options` | `noopen` | ✅ IE legacy download protection. |
| `Server` | `cloudflare` | ✅ Does not leak Express version. |

**Overall:** Security headers are **production-grade**.

---

## 4. Authentication & Authorization Review

### 4.1 JWT + Refresh Token Architecture (`lib/auth.js`)
- ✅ Access tokens expire in 15 minutes (`expiresIn: '15m'`)
- ✅ Refresh tokens are 40-byte random hex, SHA-256 hashed before storage
- ✅ Token family rotation on refresh (old token revoked, new token in same family)
- ✅ Token reuse detection: if a revoked refresh token is used, the entire family is revoked
- ✅ `revokeAllTokens()` available for logout-everywhere
- ⚠️ `JWT_SECRET` is exported from `lib/auth.js` (`module.exports = { ..., JWT_SECRET }`). This is unnecessary exposure — remove it from exports.

### 4.2 Admin Panel (`routes/admin.js`)
- ✅ Admin password is bcrypt-hashed with salt rounds 13 at runtime
- ✅ Admin login rate-limited: 5 attempts per 15 minutes per IP
- ✅ Admin session relies on `express-session` with PostgreSQL store
- ⚠️ **No session timeout:** `req.session.isAdmin` is trusted indefinitely until the browser cookie expires (7 days) or the user explicitly logs out. No server-side idle timeout or absolute timeout for admin sessions.
- ⚠️ **Bridge elevation:** JWT users with `role === 'admin'` are automatically elevated to `req.session.isAdmin`. This is convenient but means a stolen JWT can permanently hijack an admin session. Consider requiring explicit admin re-authentication even for JWT-admins.
- ⚠️ **No MFA/2FA:** Admin panel has no second factor. For a production app with revenue/admin access, this is a gap.
- ⚠️ **Default admin username:** Falls back to `'admin'` if `ADMIN_USERNAME` env var is missing. This is predictable and should be required explicitly.

### 4.3 CSRF Protection (`server.js`)
- ✅ Double-submit cookie pattern implemented
- ✅ CSRF token regenerated if cookie missing
- ✅ Validated on POST/PUT/DELETE/PATCH (GET is exempted, which is correct for stateless GETs but ensure GET routes are truly read-only)
- ⚠️ CSRF cookie is `SameSite=Lax` and `Max-Age=604800` (7 days). If an attacker can force a victim to visit a malicious site, Lax cookies are sent on top-level navigation GET requests. Ensure all state-changing endpoints require non-GET methods.

### 4.4 Session Configuration (`server.js`)
- ✅ `secure: true` in production (HTTPS only)
- ✅ `httpOnly: true` (XSS can't steal session cookie)
- ✅ `sameSite: 'lax'` (CSRF mitigation)
- ⚠️ `maxAge: 7 days` — long for a recruitment platform. Consider 24 hours for candidates and 1 hour for admin sessions.
- ⚠️ `createTableIfMissing: true` on pgSession is convenient but could be a DoS vector if the DB is under load and the table creation query is slow. Pre-create tables in migrations.

---

## 5. Rate Limiting (`lib/distributed-rate-limiter.js`)

- ✅ PostgreSQL-backed (distributed across multiple server instances)
- ✅ Admin login: 5 attempts per 15 minutes per IP
- ✅ Auth endpoints: 5 requests per 15 min window (general auth rate limit)
- ✅ Cleanup interval: 5 minutes (prevents stale key buildup)
- ✅ IP extraction uses `req.ip` with `app.set('trust proxy', 1)`
- ⚠️ `trust proxy` set to `1` means only the first proxy is trusted. Cloudflare is in front, so `req.ip` should reflect the `CF-Connecting-IP` header. Ensure Render passes the correct header; otherwise rate limiting could be bypassed by changing `X-Forwarded-For` hops.

---

## 6. CORS Configuration (`server.js`)

- ✅ Whitelist-based `origin` callback
- ✅ `credentials: true` (allows cookies)
- ✅ Production defaults: `['https://rekrutai.co', 'https://www.rekrutai.co', 'https://app.rekrutai.co', 'https://rekrutai-dev.onrender.com']`
- ✅ Development defaults: `localhost` variants + `https://hireloop-vzvw.polsia.app`
- ⚠️ **Staging URL `https://rekrutai-dev.onrender.com` is present in production defaults.** If this is a staging environment, it should not be in the production CORS list. Remove it before production deployment.
- ⚠️ `process.env.CORS_ORIGINS` is not validated — if a developer accidentally sets `CORS_ORIGINS=*`, the whitelist check will fail (`*` is not an origin string), but if set to `https://evil.com`, it will be accepted. Ensure CORS_ORIGINS is set via infrastructure-as-code, not manual env var entry.

---

## 7. Secrets & Credential Hygiene

| Finding | Severity | Location |
|---|---|---|
| `.env` with live DB password, JWT secret, session secret, admin password, Stripe keys | **HIGH** | `/root/.openclaw/workspace/Rekrut_AI_v2/.env` |
| Test login credentials hardcoded | **MEDIUM** | `test-login.js`, `test-recruiter-login.js`, `test-new-endpoints.js` |
| Test password hardcoded | **MEDIUM** | `check-password.js` |
| Stripe webhook secret hardcoded (partially masked) | **MEDIUM** | `scripts/test-webhook.js`, `scripts/test-stripe-flow.js` |
| `JWT_SECRET` exported from auth module | **LOW** | `lib/auth.js` |

---

## 8. Production Readiness Scorecard

| Requirement | Met | Notes |
|---|---|---|
| Security headers present and correct | ✅ | CSP, HSTS, COOP, CORP, Referrer-Policy all good |
| No secrets in code / build artifact | ❌ | `.env` on disk; test scripts with credentials |
| Auth middleware production-ready | ⚠️ | Core JWT solid, but OAuth callback broken (missing `verifyOauthState`) |
| Admin access hardened | ⚠️ | Rate limiting + bcrypt + sessions, but no 2FA, no timeout, predictable default username |
| Rate limiting on auth endpoints | ✅ | Distributed, PostgreSQL-backed |
| CORS configured for production | ⚠️ | Good defaults, but staging URL included in production list |
| CSRF protection enabled | ✅ | Double-submit cookie |
| Session cookies secure + httpOnly | ✅ | Production flags correct |
| No hardcoded test credentials in production | ❌ | Multiple test scripts contain passwords |
| OAuth callback secure | ❌ | Tokens in URL query params; missing state verification |
| Input validation on all API routes | ⚠️ | Not comprehensively audited in this scope; spot checks suggest parameterized queries are used (good) |
| API errors do not leak secrets | ✅ | Generic error messages observed |

---

## 9. Recommendations (Prioritized)

### Immediate (Block Production Deployment)

1. **Fix OAuth callback crash.** Implement `verifyOauthState` in `routes/auth.js` (session-based nonce, single-use). Test Google and LinkedIn OAuth flows end-to-end in staging.
2. **Remove `.env` from deployment context.** Migrate all secrets to Render/Cloudflare environment variables or a secret manager. Rotate all secrets after removal.
3. **Stop transmitting tokens in OAuth redirect URLs.** Use `httpOnly` session cookie set on the callback response, then redirect to a clean URL.
4. **Remove or guard test scripts.** Either `.gitignore` them from production builds, or add a `if (process.env.NODE_ENV === 'production') throw new Error('Test scripts cannot run in production')` guard at the top of each file.

### Short-Term (1–2 Weeks Post-Launch)

5. **Add admin session idle timeout.** Enforce a 30-minute idle timeout and 4-hour absolute timeout for admin sessions. Add `req.session.lastAdminActivity` and check it in `requireAdmin`.
6. **Require explicit `ADMIN_USERNAME` env var.** Remove the `'admin'` fallback. A predictable username halves the brute-force search space.
7. **Add admin 2FA.** TOTP-based (e.g., `speakeasy` or `otplib`) is sufficient for MVP.
8. **Remove `JWT_SECRET` from `module.exports`** in `lib/auth.js`.
9. **Validate `CORS_ORIGINS`** at startup: reject wildcards, reject `http://` origins in production, log the final whitelist.
10. **Tighten `img-src` CSP.** Replace `https:` with explicit CDN domains (e.g., `https://cdn.rekrutai.co`, `https://storage.googleapis.com`, etc.).

### Medium-Term (Ongoing Security Hardening)

11. **Implement SAST/SCA in CI/CD.** Add `npm audit`, `semgrep`, or `snyk` to the pipeline. Fail builds on critical/high dependency vulnerabilities.
12. **Add automated secret scanning.** Use `truffleHog` or `git-secrets` to prevent accidental commits of `.env` files.
13. **Security regression tests.** For each fixed vulnerability, add an automated test that reproduces the attack and asserts the fix (e.g., CSRF without token should fail, admin access without session should fail, etc.).
14. **Audit all API routes for authorization.** Ensure every route that accepts an `:id` parameter verifies ownership (`req.user.id === resource.user_id`) before returning data. This was not comprehensively checked in this audit.
15. **Implement Content Security Policy nonces** if any inline `<script>` tags are added in the future. Currently `script-src 'self'` is adequate because all JS is bundled.

---

## 10. Conclusion

Rekrut AI has a **strong security foundation** — well-configured headers, distributed rate limiting, solid JWT refresh token rotation, and CSRF protection. However, **three critical issues must be resolved before production deployment:**

1. The broken OAuth callback (`verifyOauthState` missing)
2. Secrets stored in the `.env` file on disk
3. Tokens exposed in OAuth redirect URLs

Once these are fixed and the admin panel receives session timeout + 2FA, the application will be well-positioned for a secure production launch.

**Security Readiness Score: 72% (C+)** — Not yet production-ready.
