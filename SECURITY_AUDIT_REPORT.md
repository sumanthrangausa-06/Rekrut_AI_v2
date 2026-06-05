# Rekrut AI v2 — Security Audit Report
**Date**: 2025-06-05 | **Auditor**: Security Architect Agent | **Scope**: 26 source files

---

## 🚨 CRITICAL SEVERITY

### 1. Hardcoded JWT Fallback Secret (Authentication Bypass Risk)
**File**: `lib/auth.js` (inferred from auth.js usage, also see `routes/auth.js` token generation)
**Issue**: The codebase contains a hardcoded JWT secret fallback string `'hireloop-jwt-secret-change-in-prod'` that is used when `process.env.JWT_SECRET` is not set. An attacker who gains code or binary access can forge valid JWT tokens for any user including admins.
**Impact**: Complete authentication bypass — any user can self-issue valid tokens.
**Remediation**: Remove the fallback entirely. If `JWT_SECRET` is unset, crash on startup with a fatal error. Use `crypto.randomBytes(64).toString('hex')` on first boot if generating a new secret, or require explicit configuration.
**CVSS Approximation**: 9.1 (Critical)

---

### 2. Database SSL Certificate Verification Disabled (MITM Risk)
**File**: `lib/db.js` (~lines 5-8)
**Code**:
```js
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // ...
});
```
**Issue**: `rejectUnauthorized: false` disables TLS certificate validation for the PostgreSQL connection. An attacker on the network path (e.g., compromised infrastructure, DNS hijacking, BGP route manipulation) can intercept database traffic with a self-signed certificate and read or modify all database communications in plaintext.
**Impact**: Full database traffic exposure including credentials, PII, salary data, and interview content.
**Remediation**: Set `rejectUnauthorized: true` and provide the CA certificate via `ssl.ca` (or use `sslmode=require/verify-full` in the connection string). If using cloud-managed PostgreSQL (AWS RDS, Supabase, etc.), download and reference the provider's root CA bundle.
**CVSS Approximation**: 8.1 (High → Critical in cloud deployments)

---

### 3. Session Cookie `secure: false` (Session Hijacking)
**File**: `server.js` (~lines 47-52)
**Code**:
```js
cookie: {
  secure: false, // Allow cookies over HTTP (Render terminates TLS at proxy)
  httpOnly: true,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  sameSite: 'lax',
}
```
**Issue**: The `secure: false` flag allows the session cookie to be transmitted over unencrypted HTTP connections. While the comment notes Render terminates TLS at the proxy, this is only safe if the application is **never** reachable directly over HTTP (e.g., internal IP, health checks, or development environments). Any request that bypasses the TLS-terminating proxy exposes the session cookie to network sniffing.
**Impact**: Session hijacking via network sniffing; cookie theft leads to full account takeover.
**Remediation**: 
- Set `secure: true` unconditionally and ensure the app only runs behind a trusted TLS-terminating proxy.
- Add an environment check: if `NODE_ENV === 'production'`, require `secure: true`.
- Set `sameSite: 'strict'` for admin routes or at minimum `sameSite: 'lax'`.
**CVSS Approximation**: 7.5 (High)

---

### 4. CORS `origin: true` (Credential Theft + CSRF Bypass)
**File**: `server.js` (~lines 28-31)
**Code**:
```js
app.use(cors({
  origin: true,
  credentials: true,
}));
```
**Issue**: `origin: true` reflects the `Origin` header from any incoming request, effectively allowing **any** domain to make authenticated cross-origin requests. Combined with `credentials: true`, this means malicious websites can perform authenticated API calls on behalf of logged-in users.
**Impact**: Full Cross-Site Request Forgery (CSRF) bypass for all state-changing endpoints that rely only on session/cookie auth.
**Remediation**: Replace with an explicit whitelist:
```js
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL || 'https://rekrut.ai',
  // Add staging domains via env
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
```
**CVSS Approximation**: 8.2 (High)

---

### 5. Overly Permissive Permissions-Policy Header
**File**: `server.js` (~lines 34-37)
**Code**:
```js
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=*, microphone=*');
  next();
});
```
**Issue**: The `Permissions-Policy` header grants ALL origins (`*`) unrestricted access to the camera and microphone APIs. While the app may legitimately use these for video interviews, this policy is too broad and could be exploited by embedded iframes or malicious scripts if any XSS vulnerability exists.
**Impact**: Enables camera/microphone access for any third-party script loaded on pages, increasing XSS blast radius.
**Remediation**: Restrict to self and remove `*`. If specific third-party video providers need access, enumerate them explicitly:
```js
res.setHeader('Permissions-Policy', 'camera=(self "https://trusted-provider.com"), microphone=(self "https://trusted-provider.com")');
```
**CVSS Approximation**: 6.5 (Medium, but amplifies XSS)

---

### 6. In-Memory Rate Limiting (DoS + Brute Force)
**File**: `routes/admin.js` (~lines 33-55)
**Code**:
```js
const ipAttempts = new Map();
function adminRateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  // ... per-process Map
}
```
**Issue**: The rate limiter uses an in-memory `Map`, which means:
- Limits reset on every server restart/deploy.
- In a multi-instance deployment (Render, Kubernetes, etc.), each process maintains its own counter — an attacker gets N× the allowed attempts where N = number of instances.
- Memory grows unbounded if attackers rotate IPs (per-IP entries accumulate).
**Impact**: Brute-force attacks on admin endpoints are trivial in scaled deployments; DoS via memory exhaustion.
**Remediation**: Use a Redis-backed rate limiter (e.g., `rate-limit-redis`) or a shared store (PostgreSQL `user_sessions` table can be repurposed). Also apply rate limiting to auth endpoints (login, register, password reset).
**CVSS Approximation**: 7.1 (High)

---

## 🔴 HIGH SEVERITY

### 7. Missing Input Validation on SQL Query Construction
**File**: `routes/jobs.js` (~lines 18-50)
**Code**:
```js
let query = `
  SELECT j.*, u.company_name as poster_company
  FROM jobs j
  LEFT JOIN users u ON j.user_id = u.id
  WHERE j.status = $1
`;
const params = [status];
// ...
if (search) {
  query += ` AND (j.title ILIKE $${params.length + 1} OR j.description ILIKE $${params.length + 1})`;
  params.push(`%${search}%`);
}
if (location) {
  query += ` AND j.location ILIKE $${params.length + 1}`;
  params.push(`%${location}%`);
}
```
**Issue**: While the SQL uses parameterized queries (good), the `search`, `location`, `job_type`, `salary_min`, `salary_max` parameters come directly from `req.query` without any validation of type, length, or content. An attacker could pass extremely large strings to `search` (e.g., 10MB) causing:
- PostgreSQL query execution time to spike (DoS).
- Memory exhaustion from large `ILIKE` patterns.
- Potential for regex-based ReDoS if PostgreSQL optimizer paths are triggered.
**Impact**: Denial of Service via slow query execution.
**Remediation**: Add strict validation:
```js
const { query: q, validationResult } = require('express-validator');
// ...
router.get('/', [
  q('limit').isInt({ min: 1, max: 100 }).toInt(),
  q('offset').isInt({ min: 0 }).toInt(),
  q('search').optional().trim().isLength({ max: 200 }).escape(),
  q('location').optional().trim().isLength({ max: 100 }).escape(),
  // ...
], optionalAuth, async (req, res) => { ... });
```
**CVSS Approximation**: 6.5 (Medium, DoS)

---

### 8. Missing Authorization on Public Job Endpoints → Data Exposure
**File**: `routes/jobs.js` (~lines 18+)
**Issue**: The `GET /api/jobs` endpoint uses `optionalAuth` middleware. The endpoint returns `poster_company` and potentially other fields from the `jobs` table. If the `jobs` table contains fields intended only for internal use (e.g., internal_notes, salary_currency, contact_email, u.phone), those will be exposed to unauthenticated users because the query uses `SELECT j.*`.
**Impact**: Potential information disclosure of recruiter contact details, internal notes, or non-public salary ranges.
**Remediation**: Replace `SELECT j.*` with an explicit column whitelist. Also audit the `jobs` table schema to ensure no sensitive columns exist.

---

### 9. Missing Password Complexity Validation
**File**: `routes/auth.js` (~lines 80-120, register endpoint)
**Issue**: The registration endpoint accepts passwords without enforcing minimum complexity (length, character variety). The code shows bcrypt hashing but no validation before hashing. Attackers can create accounts with passwords like `"123456"` or `"password"`.
**Impact**: Credential stuffing, easy brute-force of weak accounts.
**Remediation**: Add password validation:
```js
function validatePassword(password) {
  if (typeof password !== 'string') return false;
  if (password.length < 12) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  return true;
}
```

---

### 10. Missing CSRF Protection for State-Changing Endpoints
**File**: Multiple (`routes/auth.js`, `routes/admin.js`, `routes/recruiter.js`, etc.)
**Issue**: The application relies on session-based authentication with cookies but has **no CSRF tokens** for POST/PUT/DELETE endpoints. While CORS is configured, the `origin: true` setting (see Critical #4) nullifies any CORS-based CSRF protection. An attacker can craft a form on any domain that submits to `/api/jobs/apply`, `/api/recruiter/jobs`, etc., and it will execute with the victim's session.
**Impact**: Cross-Site Request Forgery — attackers can change passwords, post jobs, delete data, or modify profiles on behalf of authenticated users.
**Remediation**: 
- Implement CSRF tokens (`csurf` or `double-submit cookie` pattern).
- For API-first design, use custom `X-Requested-With` or `X-CSRF-Token` headers.
- Set `SameSite=Strict` on session cookies for non-API routes.

---

### 11. Potential IDOR (Insecure Direct Object Reference) in Document Access
**File**: `routes/documents.js` (~lines 120-160, `GET /api/documents/:id`)
**Code**:
```js
const result = await pool.query(`
  SELECT ... FROM verification_documents vd
  LEFT JOIN document_verifications dv ON vd.id = dv.document_id
  LEFT JOIN verified_credentials vc ON vc.document_id = vd.id
  WHERE vd.id = $1
`, [id]);
// ...
const hasAccess = document.user_id === userId ||
  userRole === 'recruiter' || userRole === 'hiring_manager' || userRole === 'admin';
```
**Issue**: The access check grants access to **any** recruiter/admin for **any** document. A recruiter from Company A can view documents uploaded by a candidate who only applied to Company B, simply by knowing the document ID (sequential integer).
**Impact**: Unauthorized access to candidate identity documents, resumes, and certificates.
**Remediation**: Add company-based access control:
```js
const hasAccess = document.user_id === userId ||
  (['recruiter','hiring_manager','admin'].includes(userRole) &&
   await isCandidateInRecruiterPipeline(userId, userCompanyId, document.user_id));
```

---

### 12. Missing Account Lockout / Rate Limiting on Auth Endpoints
**File**: `routes/auth.js` (login endpoint)
**Issue**: The login endpoint has no rate limiting. Attackers can perform credential stuffing and brute-force attacks without any throttling. The in-memory rate limiter only exists on `admin.js` routes.
**Impact**: Credential stuffing, password brute-forcing, and enumeration of valid email addresses.
**Remediation**: Apply Redis-backed rate limiting to `/api/auth/login`, `/api/auth/register`, and `/api/auth/forgot-password`. Lock accounts after 5 failed attempts for 15 minutes.

---

### 13. Potential SQL Injection via Unvalidated `parseInt` on User-Controlled IDs
**File**: Multiple (`routes/admin.js`, `routes/compliance.js`, `routes/omniscore.js`, etc.)
**Issue**: Several endpoints use `parseInt(req.params.id)` and then pass the result to SQL queries. However, `parseInt('123abc')` returns `123`, which may bypass application-level validation but pass the integer check. More importantly, if the parsed value is `NaN`, some endpoints don't check and pass it directly to PostgreSQL, which will throw but could leak schema info in the error.
**Example** (from `compliance.js`):
```js
const targetId = Number(userId);
if (!Number.isInteger(targetId)) { ... }
```
This is **mostly safe**, but inconsistent. Some endpoints don't do this check.
**Remediation**: Centralize an `integerId` validator middleware:
```js
function validateIntegerId(paramName) {
  return (req, res, next) => {
    const val = parseInt(req.params[paramName], 10);
    if (isNaN(val) || val <= 0 || val > Number.MAX_SAFE_INTEGER) {
      return res.status(400).json({ error: 'Invalid ID' });
    }
    req.params[paramName] = val;
    next();
  };
}
```

---

### 14. Missing Security Headers
**File**: `server.js`
**Issue**: The application does not set the following security headers:
- `Content-Security-Policy` (CSP)
- `Strict-Transport-Security` (HSTS)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` or `SAMEORIGIN`
- `Referrer-Policy`
**Impact**: Increased risk of XSS, clickjacking, MIME-type sniffing attacks, and protocol downgrade attacks.
**Remediation**: Add `helmet` middleware:
```js
const helmet = require('helmet');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'nonce-<random>'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // or use nonces
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.rekrut.ai"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "blob:"],
      frameSrc: ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
```

---

## 🟡 MEDIUM SEVERITY

### 15. `trust proxy` Without IP Whitelist
**File**: `server.js` (~line 22)
**Code**:
```js
app.set('trust proxy', 1);
```
**Issue**: Setting `trust proxy` to `1` trusts the first proxy in the chain. If the app is exposed to the internet without a proxy (e.g., direct IP access, health check bypass), an attacker can spoof `X-Forwarded-For` to manipulate IP-based rate limiting, logging, and session binding.
**Impact**: IP spoofing in logs and potential rate limit bypass.
**Remediation**: Use an explicit proxy whitelist:
```js
app.set('trust proxy', ['loopback', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']);
```
Or set it from an environment variable and validate.

---

### 16. Verbose Error Responses in Multiple Routes
**File**: Multiple (e.g., `routes/notifications.js`, `routes/admin.js`, `server.js`)
**Issue**: Several endpoints return `err.message` directly to the client:
```js
res.status(500).json({ error: 'Failed to send notification', message: err.message });
```
`err.message` from database errors can leak internal information such as:
- Table names (`relation "X" does not exist`)
- Column names
- Query structure
- Database version (in some driver error messages)
**Impact**: Information disclosure aiding reconnaissance for targeted attacks.
**Remediation**: Log the full error server-side, return generic messages client-side:
```js
console.error('[notifications] Send error:', err);
res.status(500).json({ error: 'Failed to send notification', reference: req.id });
```

---

### 17. `saveUninitialized: false` + `resave: false` — Session Handling
**File**: `server.js` (~lines 44-45)
**Code**:
```js
resave: false,
saveUninitialized: false,
```
**Issue**: These settings are correct for security (don't save blank sessions), but the combination with `cookie.maxAge: 7 days` means that a session that is actively used can persist for 7 days without re-authentication. There is no session rotation or sliding expiration implemented.
**Impact**: Stolen session cookies remain valid for up to 7 days.
**Remediation**: Implement session rotation on privilege escalation or periodic rotation. Reduce maxAge to 24 hours for sensitive roles and require re-authentication.

---

### 18. Potential NoSQL Injection via `metadata` JSON Fields
**File**: `routes/analytics.js` (~lines 20-25)
**Code**:
```js
await pool.query(
  'INSERT INTO events (event_type, user_id, session_id, metadata) VALUES ($1, $2, $3, $4)',
  [event_type, user_id, session_id, JSON.stringify(metadata)]
);
```
**Issue**: The `metadata` object is stringified and stored. If later queries use `metadata->>'key'` with unsanitized input (seen in `notifications.js`), there is a theoretical risk of PostgreSQL JSON path injection if raw string concatenation is ever used.
**Current Status**: Safe (uses parameterized queries), but **fragile** — one developer change could introduce injection.
**Remediation**: Create a helper function for all JSONB queries that strictly validates keys against a whitelist.

---

### 19. Missing Request Timeout on Long-Running AI Endpoints
**File**: `routes/interviews.js`, `routes/quick-practice.js`
**Issue**: Video analysis and AI coaching endpoints can run for tens of seconds. The quick-practice route has a 38s safety timeout, but interview.js does not appear to have an equivalent. An attacker can initiate many concurrent long-running requests to exhaust connection pools.
**Impact**: Denial of Service via connection pool exhaustion.
**Remediation**: Add route-level timeouts to all AI-dependent endpoints. Use `Promise.race` with a timeout as done in `quick-practice.js`.

---

### 20. Inconsistent Authorization Patterns
**File**: Multiple
**Issue**: Authorization is implemented inconsistently across routes:
- `routes/memory.js` uses inline role checks: `if (!['recruiter', ...].includes(req.user.role))`
- `routes/admin.js` uses `requireAdmin` middleware
- `routes/notifications.js` uses `requireRecruiter` helper
- Some endpoints check `req.user?.id`, others `req.user.id` without optional chaining
**Impact**: Higher probability of authorization bypass bugs due to pattern inconsistency.
**Remediation**: Centralize all authorization in `lib/auth.js` with role hierarchy middleware:
```js
function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
```

---

### 21. File Upload — Missing Filename Sanitization
**File**: `routes/documents.js` (~lines 45-50)
**Code**:
```js
formData.append('file', req.file.buffer, {
  filename: req.file.originalname,
  contentType: req.file.mimetype
});
```
**Issue**: The `originalname` from the uploaded file is passed directly to the R2 upload. While `multer` handles the buffer safely, the filename could contain path traversal sequences (`../../evil.txt`) or special characters that may cause issues in downstream processing.
**Impact**: Path traversal in object storage keys; potential XSS if filenames are rendered unescaped.
**Remediation**: Sanitize filenames before upload:
```js
const sanitizeFilename = (name) => name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 200);
```

---

### 22. `bcrypt` Salt Rounds Not Explicitly Set
**File**: `routes/auth.js` (implied from bcrypt usage)
**Issue**: If `bcrypt.hash(password)` is called without specifying `saltRounds`, bcrypt may use a default (typically 10). At 10 rounds, modern GPUs can hash ~10K+ passwords/second. The NIST recommendation and OWASP guidance suggest at least 12+ rounds for production systems.
**Impact**: Faster offline password cracking if database is breached.
**Remediation**: Explicitly set `saltRounds`:
```js
const SALT_ROUNDS = 12; // or read from env
const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
```

---

## 🟢 LOW SEVERITY

### 23. `auth.log` File Written Synchronously
**File**: `routes/auth.js` (~lines 15-22)
**Code**:
```js
function logAuth(message) {
  try {
    fs.appendFileSync('auth.log', message + '\n');
  } catch (e) {
    console.error('Failed to write auth log', e);
  }
}
```
**Issue**: Synchronous file I/O on the authentication hot path blocks the event loop. Under load, this causes latency spikes and reduces throughput.
**Remediation**: Use async logging (`fs.appendFile` or a structured logger like `pino`/`winston`).

---

### 24. Missing API Versioning
**File**: `server.js`
**Issue**: All routes are prefixed with `/api/` without versioning (e.g., `/api/v1/auth`). Breaking changes to the API contract will force all clients to update simultaneously.
**Remediation**: Add version prefixes: `/api/v1/auth`, `/api/v2/auth`, etc.

---

### 25. `console.error` Used for Security Events
**File**: Multiple
**Issue**: Security-relevant events (failed logins, authorization failures, data exports) are logged to `console.error` instead of a tamper-resistant audit log. Console logs are often lost in containerized environments or mixed with application noise.
**Remediation**: Use the existing `AuditLogger` service for all security events consistently.

---

### 26. `max: 25` Connection Pool — Potential Exhaustion
**File**: `lib/db.js` (~line 8)
**Issue**: The connection pool is capped at 25 connections. With many long-running AI endpoints and no request timeouts, the pool can be exhausted, causing cascading failures.
**Remediation**: Monitor pool metrics. Add connection pool queue limits and health checks. Consider separate read replicas for analytics queries.

---

### 27. Health Check Exposes Timestamp
**File**: `server.js` (~lines 24-26)
**Code**:
```js
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```
**Issue**: While low risk, exposing precise server timestamps can aid in timing attacks or fingerprinting the server timezone.
**Remediation**: Return minimal health data:
```js
res.json({ status: 'ok' });
```

---

## 📊 Findings Summary Table

| ID | Severity | Category | File | Description |
|----|----------|----------|------|-------------|
| 1 | **Critical** | Auth | `lib/auth.js` / `routes/auth.js` | Hardcoded JWT fallback secret |
| 2 | **Critical** | Data/Network | `lib/db.js` | `rejectUnauthorized: false` disables TLS validation |
| 3 | **Critical** | Session | `server.js` | Session cookie `secure: false` |
| 4 | **Critical** | CORS/CSRF | `server.js` | `origin: true` allows any origin with credentials |
| 5 | **Critical** | Headers | `server.js` | Overly permissive `Permissions-Policy` |
| 6 | **Critical** | DoS | `routes/admin.js` | In-memory rate limiter doesn't scale |
| 7 | **High** | Input Validation | `routes/jobs.js` | Unvalidated query params in SQL |
| 8 | **High** | AuthZ | `routes/jobs.js` | `SELECT j.*` may expose internal fields |
| 9 | **High** | Auth | `routes/auth.js` | No password complexity requirements |
| 10 | **High** | CSRF | Multiple | No CSRF tokens on state-changing endpoints |
| 11 | **High** | AuthZ/IDOR | `routes/documents.js` | Any recruiter can access any document |
| 12 | **High** | Auth/DoS | `routes/auth.js` | No rate limiting on login/register |
| 13 | **High** | Input Validation | Multiple | Inconsistent `parseInt` validation |
| 14 | **High** | Headers | `server.js` | Missing CSP, HSTS, X-Frame-Options |
| 15 | **Medium** | Network | `server.js` | `trust proxy` without IP whitelist |
| 16 | **Medium** | Info Disclosure | Multiple | `err.message` sent to client |
| 17 | **Medium** | Session | `server.js` | 7-day session with no rotation |
| 18 | **Medium** | Injection | `routes/analytics.js` | JSON metadata injection risk (theoretical) |
| 19 | **Medium** | DoS | `routes/interviews.js` | No timeout on AI endpoints |
| 20 | **Medium** | Code Quality | Multiple | Inconsistent authorization patterns |
| 21 | **Medium** | File Upload | `routes/documents.js` | Unsanitized filename passed to storage |
| 22 | **Medium** | Auth | `routes/auth.js` | `bcrypt` salt rounds not explicit |
| 23 | **Low** | Performance | `routes/auth.js` | Synchronous file logging |
| 24 | **Low** | Design | `server.js` | No API versioning |
| 25 | **Low** | Logging | Multiple | Security events mixed with console logs |
| 26 | **Low** | Resilience | `lib/db.js` | 25-connection pool may exhaust |
| 27 | **Low** | Info Disclosure | `server.js` | Health check exposes timestamp |

---

## 🛡️ Immediate Action Items (Priority Order)

1. **Fix Critical #1**: Remove hardcoded JWT secret; crash on startup if `JWT_SECRET` is missing.
2. **Fix Critical #2**: Enable `rejectUnauthorized: true` and configure proper SSL CA bundle.
3. **Fix Critical #3**: Set `secure: true` on session cookies in production.
4. **Fix Critical #4**: Whitelist CORS origins; never use `origin: true`.
5. **Fix Critical #5**: Restrict `Permissions-Policy` to `self`.
6. **Fix Critical #6**: Replace in-memory rate limiter with Redis-backed solution.
7. **Fix High #10**: Add CSRF protection to all state-changing endpoints.
8. **Fix High #11**: Add company-scoped authorization to document access.
9. **Fix High #12**: Add rate limiting to auth endpoints + account lockout.
10. **Fix High #14**: Add `helmet` middleware with CSP, HSTS, and frame options.
11. **Fix Medium #16**: Replace all `err.message` in 500 responses with generic messages + reference IDs.
12. **Fix Medium #21**: Sanitize all uploaded filenames.

---

*This audit was performed as a static code review. Dynamic testing (penetration testing, fuzzing) is recommended to validate these findings and discover runtime-only vulnerabilities.*
