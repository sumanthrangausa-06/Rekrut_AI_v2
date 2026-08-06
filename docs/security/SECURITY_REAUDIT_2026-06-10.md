# Rekrut AI — Security Re-Audit Report

**Date:** 2026-06-10  
**Auditor:** Application Security Engineer (sub-agent)  
**Scope:** Full codebase at `/root/.openclaw/workspace/Rekrut_AI_v2/` and client subdirectory  
**Methodology:** OWASP ASVS 4.0 Level 2, `npm audit`, manual code review, grep-based static analysis

---

## 1. Executive Summary

| Category | Status |
|---|---|
| **npm audit (root)** | ✅ 0 vulnerabilities (0 critical, 0 high) |
| **npm audit (client)** | ✅ 0 vulnerabilities (0 critical, 0 high) |
| **Security Headers** | ✅ Production-grade (CSP, HSTS, COOP, CORP) |
| **Rate Limiting / CSRF** | ✅ Functional |
| **JWT + Session Architecture** | ✅ Solid (15-min expiry, rotation, secure cookies) |
| **Previous "6 Critical" Fixes** | ❌ **NONE VERIFIED AS FIXED** — all still present |
| **New Findings** | ⚠️ 1 new medium-severity issue (unauthenticated TTS route) |

**Overall Security Posture: NOT PRODUCTION-READY.** The previously identified vulnerabilities remain unresolved, and a new unauthenticated endpoint has been introduced.

---

## 2. Vulnerability Count by Severity

| Severity | Count | Status |
|---|---|---|
| **Critical** | 1 | Unresolved (OAuth state verification crash) |
| **High** | 3 | Unresolved (secrets on disk, tokens in URL, hardcoded credentials) |
| **Medium** | 3 | 1 new, 2 unresolved from previous audit |
| **Low** | 1 | Unresolved (JWT_SECRET export) |
| **Total** | **8** | **0 fixed, 1 new** |

---

## 3. Previous Findings — Verification Status

### 3.1 ❌ CRITICAL: `verifyOauthState` is still NOT defined (OAuth crash)
- **File:** `routes/auth.js` lines 404, 544
- **Previous audit finding:** 2026-06-09 — CRITICAL
- **Status:** NOT FIXED
- **Evidence:** The function `verifyOauthState(req, state)` is still called at both Google and LinkedIn OAuth callbacks but is **neither imported nor defined anywhere** in the codebase. The `grep` search for `function verifyOauthState` returns zero results. The `req.session.oauth_state = state` is still set in the OAuth URL handlers, but the verification function is missing.
- **Impact:** Any user attempting OAuth login will trigger a `ReferenceError`, crashing the request and making OAuth completely non-functional.
- **Required Fix:**
  ```javascript
  function verifyOauthState(req, state) {
    return req.session && req.session.oauth_state === state;
  }
  ```
  Call this before the callback exchange. Clear `req.session.oauth_state` after successful use (single-use nonce).

---

### 3.2 ❌ HIGH: OAuth tokens still transmitted in URL query parameters
- **File:** `routes/auth.js` lines 492, 629
- **Previous audit finding:** 2026-06-09 — HIGH
- **Status:** NOT FIXED
- **Evidence:** Both Google and LinkedIn callbacks still execute:
  ```javascript
  res.redirect(`${redirectUrl}?token=${accessToken}&refresh=${refreshToken}`);
  ```
- **Impact:** Tokens are exposed in browser history, server access logs, and `Referer` headers on subsequent requests. Refresh tokens in URL query params are especially dangerous.
- **Required Fix:** Use `httpOnly` session cookies for the callback response, then redirect to a clean URL. Or use a POST-based redirect with a short-lived authorization code.

---

### 3.3 ❌ HIGH: `.env` file with live secrets still exists on disk
- **File:** `/root/.openclaw/workspace/Rekrut_AI_v2/.env`
- **Previous audit finding:** 2026-06-09 — HIGH
- **Status:** NOT FIXED
- **Evidence:** The `.env` file still contains:
  - Full `DATABASE_URL` with embedded password
  - `JWT_SECRET` (hardcoded weak value: `dev-jwt-secret-change-in-production-rekrutai-v2-2026`)
  - `SESSION_SECRET` (hardcoded weak value: `dev-secret-change-in-production-rekrutai-v2`)
  - `ADMIN_PASSWORD` (`F0ta9-l80TOHFrqQkBZsqw`)
  - `KIMI_API_KEY` (live key exposed)
  - `POLSIA_API_KEY` (live key exposed)
  - `CARTESIA_API_KEY` (live key exposed)
  - Stripe test keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`)
- **Impact:** Any attacker with filesystem access or a build-context leak gains full database, admin, and payment system access. The `.gitignore` does exclude `.env`, but the file is still present in the working directory and could be copied into deployment bundles.
- **Required Fix:**
  1. Remove `.env` from the build/deployment context entirely.
  2. Inject secrets via Render environment variables (`sync: false` is already configured in `render.yaml` — use it).
  3. **Rotate ALL secrets** currently in `.env` (database password, JWT secret, session secret, admin password, Stripe keys, API keys).
  4. Add `.env` to `.dockerignore` if a Dockerfile is introduced later.

---

### 3.4 ❌ HIGH: Hardcoded test credentials still in multiple files
- **Previous audit finding:** 2026-06-09 — HIGH
- **Status:** NOT FIXED
- **Evidence:** All files still contain plaintext credentials:
  | File | Credential |
  |---|---|
  | `test-login.js` | `test_candidate@rekrutai.co` / `Test123!` |
  | `test-recruiter-login.js` | `test_recruiter@rekrutai.co` / `Test123!` |
  | `test-new-endpoints.js` | Same credentials as above |
  | `check-password.js` | `Test@1234` |
  | `scripts/test-candidate-search.js` | `Test1234!` |
  | `scripts/test-recruiter-analytics.js` | `Test1234!` |
  | `scripts/test-stripe-flow.js` | `Test1234!` |
  | `scripts/test-webhook.js` | `whsec_…` (partially masked) |
- **Impact:** Test credentials could be accidentally deployed and used for brute-force or credential-stuffing attacks.
- **Required Fix:** Move all test credentials to environment variables (`TEST_USER_PASSWORD`, `TEST_WEBHOOK_SECRET`). Add `if (process.env.NODE_ENV === 'production') throw new Error('Test scripts cannot run in production')` guard at the top of each file.

---

### 3.5 ❌ MEDIUM: Admin sessions still lack timeout
- **File:** `routes/admin.js`
- **Previous audit finding:** 2026-06-09 — MEDIUM
- **Status:** NOT FIXED
- **Evidence:** `req.session.isAdmin` is set to `true` and never checked for idle or absolute timeout. The session cookie expires after 7 days, but there is no server-side enforcement of admin session limits.
- **Required Fix:** Add a 30-minute idle timeout and 4-hour absolute timeout for admin sessions. Check `req.session.lastAdminActivity` in `requireAdmin` middleware.

---

### 3.6 ❌ LOW: `JWT_SECRET` still exported from `lib/auth.js`
- **File:** `lib/auth.js` line 195
- **Previous audit finding:** 2026-06-09 — LOW
- **Status:** NOT FIXED
- **Evidence:** `JWT_SECRET` is still in `module.exports`.
- **Required Fix:** Remove `JWT_SECRET` from the exports object. Only auth functions should be exported.

---

### 3.7 ❌ MEDIUM: Staging URL still in production CORS defaults
- **File:** `server.js`
- **Previous audit finding:** 2026-06-09 — MEDIUM
- **Status:** NOT FIXED
- **Evidence:** `https://rekrutai-dev.onrender.com` is still in the production CORS fallback list.
- **Required Fix:** Remove staging/dev URLs from production CORS defaults.

---

## 4. NEW Findings (Not in Previous Audit)

### 4.1 ⚠️ MEDIUM: `voice-notifications` routes lack authentication
- **File:** `routes/voice-notifications.js`
- **New since:** 2026-06-09 audit (Cartesia TTS integration added)
- **Evidence:** Both endpoints are mounted without any auth middleware:
  - `POST /api/notifications/voice` — generates TTS audio via Cartesia API (uses `CARTESIA_API_KEY`)
  - `GET /api/notifications/voice/:cacheKey` — serves cached audio files
  - `GET /api/notifications/voice/status` — exposes cache stats and API key configuration status
- **Impact:**
  - **Unauthenticated TTS generation:** Any anonymous user can consume Cartesia API quota by POSTing arbitrary text. This is a direct cost-attack vector (financial drain).
  - **Cache enumeration:** The `cacheKey` is a SHA-256 hash, but the `/status` endpoint reveals `cachedFiles` count and `cacheSizeMB`, allowing reconnaissance.
  - **Cache poisoning / DoS:** Malicious actors can fill the `/tmp/cartesia-cache` directory with arbitrary audio files, potentially exhausting disk space.
- **Required Fix:** Add `authMiddleware` to the `POST /voice` and `GET /voice/status` routes. The `GET /voice/:cacheKey` can remain public if the audio content is non-sensitive, but consider rate-limiting it. Add input validation on `text` (max length, content checks) to prevent abuse.

---

## 5. What Has NOT Changed (Good Security)

These controls remain correctly configured and are working as intended:

- ✅ **Security headers:** CSP, HSTS preload, COOP, CORP, Referrer-Policy, Permissions-Policy all present and correct
- ✅ **Rate limiting:** Distributed PostgreSQL-backed rate limiting functional on auth endpoints
- ✅ **CSRF protection:** Double-submit cookie pattern still working
- ✅ **Session cookies:** `secure: true` in production, `httpOnly: true`, `sameSite: 'lax'`
- ✅ **JWT lifecycle:** 15-minute access token expiry, refresh token rotation, family-based revocation, reuse detection
- ✅ **Admin password hashing:** bcrypt with salt rounds 13 at runtime
- ✅ **Admin login rate limiting:** 5 attempts per 15 minutes per IP
- ✅ **No npm vulnerabilities:** 0 critical, 0 high, 0 moderate, 0 low in both root and client

---

## 6. Dependency Analysis — New Additions

Since the last audit, the following new dependencies/routes were added (based on git diff):

| Addition | Risk Assessment |
|---|---|
| `routes/voice-notifications.js` | ⚠️ **MEDIUM** — No auth, unauthenticated API consumption |
| `routes/tts.js` | ✅ LOW — Uses `authMiddleware`, input validation present (`text.length > 5000` check) |
| `services/tts-service.js` | ✅ LOW — Proper error handling, no credential exposure observed |
| `lib/activity-logger.js` | ✅ LOW — Audit logging, no security issues |
| `lib/metrics-collector.js` | ✅ LOW — Metrics collection, no security issues |
| `lib/ai-provider.js` / `lib/polsia-ai.js` | ✅ LOW — API key references use `process.env`, no hardcoded secrets |
| `client` package.json | ✅ LOW — Minimal dependencies, no audit vulnerabilities |

---

## 7. Recommended Action Plan

### Immediate (Block Production — This Week)

1. **Implement `verifyOauthState`** in `routes/auth.js` and test both Google and LinkedIn OAuth end-to-end in staging.
2. **Stop putting tokens in OAuth redirect URLs.** Use `httpOnly` session cookies on the callback response, then redirect clean.
3. **Remove `.env` from the deployment context.** Use Render env vars (`sync: false`) exclusively. Rotate ALL secrets immediately after removal.
4. **Add `authMiddleware` to `routes/voice-notifications.js`** — protect `POST /voice`, `GET /voice/status`. Rate-limit `GET /voice/:cacheKey`.
5. **Guard or remove test scripts.** Add `NODE_ENV === 'production'` guards or `.gitignore` them from builds.

### Short-Term (1–2 Weeks)

6. Add admin session idle timeout (30 min) and absolute timeout (4 hours).
7. Remove `JWT_SECRET` from `lib/auth.js` exports.
8. Remove staging URLs from production CORS defaults.
9. Validate `CORS_ORIGINS` at startup: reject wildcards and `http://` origins in production.

### Medium-Term (Ongoing)

10. Implement SAST/SCA in CI/CD (`npm audit`, `semgrep`, `truffleHog`).
11. Add security regression tests for each fixed vulnerability.
12. Audit all API routes for authorization (ensure `req.user.id === resource.user_id` on every `:id` route).

---

## 8. Conclusion

**The previously identified vulnerabilities have NOT been fixed.** The codebase is in the same security posture as the 2026-06-09 audit, with the addition of one new medium-severity issue (unauthenticated TTS route). 

**No npm dependency vulnerabilities exist** (0 across both root and client), which is a positive finding. However, the application cannot be considered production-ready until the OAuth state verification crash, secrets on disk, and token-in-URL issues are resolved.

**Security Readiness Score: 68% (D+)** — Regressed from 72% due to the new unauthenticated TTS endpoint.
