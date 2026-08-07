# Security Review Report — Staging Branch Commit `4c397c0`

**Reviewer:** SEC-001 (Application Security Engineer)  
**Date:** 2026-06-09  
**Commit:** `4c397c00e08a4224ddcb32995b99798f17720b52`  
**Branch:** `staging`  
**Scope:** `routes/admin.js`, `routes/auth.js`, `routes/communications.js`, `routes/company.js`, `routes/matching.js`, `routes/recruiter.js`, `routes/screening.js`, `server.js`

---

## Executive Summary

The commit introduces meaningful security hardening: upgraded bcrypt cost factors, tightened `Permissions-Policy` headers, and a new secure error-response pattern using cryptographically random reference IDs. Audit logging is present for AI-driven matching and screening decisions.

However, **three findings require action before merge** (1 Critical, 2 High), and several medium-priority gaps should be addressed in a follow-up sprint.

---

## Findings

### 🔴 CRITICAL: SQL Injection via String Concatenation (`routes/recruiter.js`)

**Location:** `routes/recruiter.js` — `dashboard` and `analytics` routes  
**Pattern:**
```javascript
const days = req.query.days ? parseInt(req.query.days) : 30;
const dateFilter = days > 0 ? `AND applied_at >= NOW() - INTERVAL '${days} days'` : '';
// ... later interpolated into SQL:
await pool.query(`... WHERE company_id = $1 ${dateFilter} ...`, [companyId]);
```

**Risk:** Although `parseInt()` is used, this is a **non-parameterized SQL interpolation pattern**. PostgreSQL `INTERVAL` expressions can be manipulated in subtle ways (e.g., timezone suffixes, special interval syntax), and this pattern is a **time-bomb** — any future refactor that removes `parseInt()` or changes the interpolation becomes immediately exploitable. It also violates the principle of parameterized queries everywhere.

**Fix:** Pass `days` as a parameterized value:
```javascript
const days = parseInt(req.query.days, 10) || 30;
let dateFilter = '';
const params = [companyId];
if (days > 0) {
  params.push(days);
  dateFilter = `AND applied_at >= NOW() - INTERVAL $${params.length} days`;
}
await pool.query(`... WHERE company_id = $1 ${dateFilter} ...`, params);
```

**Status:** `FIX BEFORE MERGE`

---

### 🟠 HIGH: Insecure Randomness for Temporary Passwords (`routes/company.js`)

**Location:** `routes/company.js:548` — team invite route  
**Pattern:**
```javascript
const tempPassword = Math.random().toString(36).slice(-8);
```

**Risk:** `Math.random()` is **not cryptographically secure**. Temporary passwords are sensitive credentials and should be generated from the CSPRNG.

**Fix:**
```javascript
const tempPassword = crypto.randomBytes(6).toString('base64url').slice(0, 8);
// or for readability:
const tempPassword = crypto.randomBytes(4).toString('hex');
```

**Status:** `FIX BEFORE MERGE`

---

### 🟠 HIGH: Insecure Randomness for Video Room IDs (`routes/recruiter.js`)

**Location:** `routes/recruiter.js:776` and `:1260`  
**Pattern:**
```javascript
const roomId = `Rekrut AI-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`;
```

**Risk:** `Math.random()` provides only 48 bits of entropy and is predictable. Room IDs may be guessable, allowing unauthorized parties to join video interviews.

**Fix:**
```javascript
const roomId = `Rekrut AI-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('base64url')}`;
```

**Status:** `FIX BEFORE MERGE`

---

### 🟡 MEDIUM: Missing Secure Error Response Pattern (`routes/auth.js`, `routes/company.js`)

**Location:** All error handlers in `routes/auth.js` and `routes/company.js`  
**Pattern:** Error handlers still return raw error messages or stack traces without a correlation reference ID.

**Risk:** In production (`NODE_ENV=production`), this can leak internal implementation details (file paths, database schemas, third-party library versions) to attackers. The new `sendError` pattern with `crypto.randomUUID()` should be adopted everywhere.

**Example fix (auth.js):**
```javascript
function sendError(res, err, prefix) {
  const ref = crypto.randomUUID();
  console.error(`[ERROR ref=${ref}] ${prefix}:`, err);
  if (process.env.NODE_ENV === 'production') {
    res.status(500).json({ error: 'Internal server error', ref });
  } else {
    res.status(500).json({ error: 'Operation failed', message: err.message, ref });
  }
}
```

**Status:** `FIX IN FOLLOW-UP SPRINT`

---

### 🟡 MEDIUM: Missing Secure Error Response Pattern in Partially Updated Routes (`routes/screening.js`)

**Location:** `GET /api/screening/:job_id`, `POST /api/screening/questions`, `POST /api/screening/compare`  
**Pattern:** These routes still use the old error pattern:
```javascript
} catch (err) {
  console.error('[screening/get] Error:', err);
  res.status(500).json({ error: 'Failed to get screenings' });
}
```

**Risk:** Inconsistent error handling. The `analyze` and `batch` routes were updated but these three were missed, meaning they still leak raw error objects to the console and lack traceable reference IDs for incident response.

**Status:** `FIX IN FOLLOW-UP SPRINT`

---

### 🟡 MEDIUM: Missing EU AI Act Audit Logging for AI Communications (`routes/communications.js`)

**Location:** All `POST` routes in `routes/communications.js` (generate, send, pipeline, bulk, sequences)  
**Pattern:** No `AuditLogger.log()` calls for AI-generated offer letters, rejections, outreach messages, or follow-ups.

**Risk:** The matching and screening routes log every AI decision to `audit_logs`, but communications — which directly affect candidates' employment outcomes — do not. This creates a **compliance gap** under the EU AI Act (high-risk AI systems must have decision audit trails) and reduces accountability for AI-generated content that could be discriminatory or defamatory.

**Fix:** Add `AuditLogger.log()` calls for each communication generation/send, capturing:
- `actionType: 'ai_communication_generated'` or `'ai_communication_sent'`
- `candidate_id`, `job_id`, `type` (outreach, rejection, offer_letter)
- `model_version` (from `commGenerator` if available)
- `req` object for IP/timestamp

**Status:** `FIX IN FOLLOW-UP SPRINT` (compliance requirement)

---

### 🟡 MEDIUM: No Global Rate Limiting

**Location:** `server.js`  
**Pattern:** Rate limiting is applied only to specific auth routes (`/register`, `/login`, `/reset-password`). No global middleware protects other endpoints.

**Risk:** Bulk operations (`/api/communications/bulk`, `/api/screening/batch`, `/api/matching/candidates/:jobId`) are computationally expensive and can be abused for DoS or brute-force enumeration of candidate data.

**Fix:** Add a global `express-rate-limit` or `distributedRateLimiter` middleware to all non-auth routes, with tiered limits:
- `GET` routes: 100 req/min per IP
- `POST` / `PUT` / `DELETE`: 30 req/min per IP
- Bulk/AI endpoints: 10 req/min per authenticated user

**Status:** `FIX IN FOLLOW-UP SPRINT`

---

### 🟡 LOW: Overly Permissive Body Parser Limit (`server.js`)

**Location:** `server.js:110`  
**Pattern:**
```javascript
app.use(express.json({ limit: '50mb' }));
```

**Risk:** 50MB JSON payloads can be used for memory exhaustion DoS. Most API endpoints do not require >1MB payloads. Document upload routes should use dedicated streaming middleware.

**Fix:**
```javascript
app.use(express.json({ limit: '1mb' }));
// Document upload routes:
// app.use('/api/documents/upload', express.raw({ type: 'application/pdf', limit: '10mb' }));
```

**Status:** `RECOMMEND`

---

### 🟡 LOW: Missing Audit Logging on Some Admin Data Access Routes

**Location:** `routes/admin.js` — `/revenue`, `/agents`, `/team-status`, `/compliance/*` (read-only)  
**Pattern:** `logAuthEvent` is used for login/bridge events, but data access to sensitive endpoints (revenue metrics, AI agent status, compliance reports) is not logged.

**Risk:** Insider threats or compromised admin accounts could exfiltrate data without leaving an audit trail.

**Fix:** Add `logAuthEvent('admin_data_access', ...)` or `AuditLogger.log()` to all admin read endpoints that expose sensitive business data.

**Status:** `RECOMMEND`

---

## Positive Security Changes (Verified)

| Change | File(s) | Assessment |
|---|---|---|
| **Bcrypt cost factor increased to 13** | `auth.js`, `company.js`, `admin.js` | ✅ Good. Cost 13 is appropriate for 2026. |
| **Secure error response pattern** | `admin.js`, `communications.js`, `matching.js`, `recruiter.js`, `screening.js` (partial) | ✅ Good. Reference IDs + production-safe error messages. |
| **Permissions-Policy deny-by-default** | `server.js` | ✅ Good. Explicitly blocks geolocation, payment, USB, gyroscope, VR, ambient-light-sensor. Camera/microphone limited to `self`. |
| **Audit logging for AI matching** | `routes/matching.js` | ✅ Good. Every `matching_decision` and `ai_explanation_generated` is logged. |
| **Audit logging for AI screening** | `routes/screening.js` | ✅ Good. `screening_decision` logged with candidate, job, fit_score, model_version. |
| **Helmet security headers** | `server.js` | ✅ Good. CSP, HSTS (1y, preload), frame-ancestors `none`, x-powered-by disabled. |
| **CSRF double-submit cookie** | `server.js` | ✅ Good. Token exposed to frontend, validated on state-changing methods. |
| **Session security config** | `server.js` | ✅ Good. `httpOnly`, `sameSite: lax`, `secure` in production, 7-day expiry. |
| **CORS whitelist** | `server.js` | ✅ Good. Explicit origin list in production; no wildcard with credentials. |
| **Admin rate limiting** | `routes/admin.js` | ✅ Good. Distributed PostgreSQL-backed rate limiter on login (5 attempts / 15 min). |
| **OAuth state validation** | `routes/auth.js` | ✅ Good. `crypto.randomBytes` for state, session-stored for callback validation. |
| **Auth middleware on all routes** | All changed routes | ✅ Verified. All routes in scope use `authMiddleware` or `requireAdmin`/`requireRecruiter`. |

---

## Static Analysis Summary

| Check | Result |
|---|---|
| SQL injection (string concatenation) | 🔴 **1 hit** in `recruiter.js` (`dateFilter` interpolation) |
| XSS (innerHTML, dangerouslySetInnerHTML) | ✅ None in changed server files |
| `eval()` / `new Function()` | ✅ None in changed server files |
| Deserialization of untrusted data | ✅ None in changed server files |
| `Math.random()` for security tokens | 🟠 **2 hits** in `company.js` and `recruiter.js` |
| Insecure direct object reference (IDOR) | 🟡 Partial — some routes check `company_id` ownership, but manual review recommended for `/api/recruiter/*` candidate endpoints |
| Missing authorization on admin routes | ✅ None — all admin routes use `requireAdmin` |
| Hardcoded secrets | ✅ None in changed files |

---

## Recommendations Summary

### Fix Before Merge (Blocking)
1. **Refactor `recruiter.js` `dateFilter` to use parameterized queries** — eliminate SQL string interpolation.
2. **Replace `Math.random()` with `crypto.randomBytes()`** for temp passwords (`company.js`) and room IDs (`recruiter.js`).

### Fix in Follow-Up Sprint (Non-blocking)
3. Adopt `sendError` pattern in `auth.js` and `company.js`.
4. Adopt `sendError` pattern in remaining `screening.js` routes (`GET /:job_id`, `POST /questions`, `POST /compare`).
5. Add `AuditLogger.log()` to all AI communication generation/send endpoints (`routes/communications.js`).
6. Implement global rate limiting middleware (tiered by method/endpoint).
7. Reduce `express.json` limit from `50mb` to `1mb` (with dedicated streaming for document uploads).
8. Add audit logging to admin read endpoints that expose sensitive data.

---

## Sign-off

**Security Reviewer:** SEC-001  
**Assessment:** The commit is a **net-positive security improvement** but contains **one critical and two high-severity findings that must be fixed before merge to staging.** All other findings are medium/low and should be tracked in the next sprint.

**Next Review:** Re-review after fixes for items 1–2 are committed.
