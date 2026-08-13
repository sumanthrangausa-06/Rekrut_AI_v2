# Rekrut AI — Code Sandbox Security Audit Report

**Issue:** #118  
**Component:** Self-Hosted Judge0 Code Sandbox (commit `534967e`)  
**Auditor:** Application Security Engineer  
**Date:** 2026-08-14  
**Branch:** `dev`  
**Scope:** `routes/sandbox.js`, `docker-compose.sandbox.yml`, `judge0-config/server.conf`, `judge0-config/workers.conf`, `migrations/117_code_sandbox.js`, `server.js`  
**Methodology:** Static code analysis; no malicious code execution. Judge0 v1.13.1 CVE history reviewed.

---

## Executive Summary

The Rekrut AI code sandbox integrates a self-hosted Judge0 instance to execute candidate-submitted code in isolated containers. While the application-layer code (`routes/sandbox.js`) demonstrates good security awareness—parameterized queries, auth middleware, ownership checks, and input sanitization—the **infrastructure layer contains critical weaknesses that undermine the entire security model**.

The most severe issues are:

1. **`privileged: true` on Judge0 workers** — gives the container full host device access, trivializing any container escape into full host root compromise.
2. **Judge0 API exposed without authentication** — port 2358 is bound to all host interfaces with `AUTHN_TOKEN` disabled, allowing direct unauthenticated access that bypasses all Rekrut rate limits and auth.
3. **Hidden test cases leaked to any authenticated user** — the test-case list endpoint has no role check and returns `stdin` and `expected_stdout` for hidden tests.

**Verdict: CRITICAL RISK — Do NOT enable in production until all CRITICAL and HIGH findings are remediated.**

---

## Methodology

1. **Static code review** of all files in scope.
2. **Attack vector modeling** against the 9 specified threat scenarios.
3. **CVE research** on Judge0 v1.13.1 (released 2024-04-18) — reviewed CVE-2024-28185, CVE-2024-28189, CVE-2024-29021. Version 1.13.1 patches these, but deployment configuration remains the dominant risk.
4. **Docker Compose security analysis** — privileged flags, volume mounts, network exposure, resource limits.
5. **API route authorization review** — role checks, IDOR vectors, information disclosure.

---

## Findings Summary

| # | Finding | Severity | Attack Vector |
|---|---------|----------|---------------|
| 1 | Container escape via `privileged: true` + Docker socket mount | **CRITICAL** | #1, #2, #8 |
| 2 | Judge0 API unauthenticated and exposed on host interface | **CRITICAL** | #1, #2, #7, #9 |
| 3 | Hidden test cases disclosed to any authenticated user | **HIGH** | #7 |
| 4 | Cross-assessment validation without access control | **HIGH** | #7, #9 |
| 5 | Judge0 server bound to all host interfaces (0.0.0.0) | **HIGH** | #1, #2, #9 |
| 6 | Rate limit bypass via X-Forwarded-For IP spoofing | **MEDIUM** | #4, #6, #9 |
| 7 | No resource limits on Judge0 workers container | **MEDIUM** | #4 |
| 8 | CORS wildcard allows cross-origin requests to Judge0 | **MEDIUM** | #9 |
| 9 | Broken async result polling (local token never mapped to Judge0) | **LOW** | Reliability |
| 10 | Source code stored unencrypted in database | **LOW** | #7 (data-at-rest) |

---

## Detailed Findings

---

### FINDING 1: Container Escape via Privileged Mode + Docker Socket Mount

**Severity:** CRITICAL  
**Attack Vectors:** #1 Container Escape, #2 Host Filesystem Access, #8 Privilege Escalation

#### Description

The `judge0-workers` service in `docker-compose.sandbox.yml` runs with two extremely dangerous configurations:

```yaml
# docker-compose.sandbox.yml:99-109
  judge0-workers:
    image: judge0/judge0:1.13.1
    container_name: rekrut-judge0-workers
    restart: unless-stopped
    command: ["./scripts/workers"]
    volumes:
      - ./judge0-config/workers.conf:/api/config/workers.conf:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    # ...
    # Workers need access to the Docker socket to spawn isolate containers
    privileged: true
```

1. **`privileged: true`** — This grants the container full access to all host devices (`/dev/*`), disables AppArmor/SELinux, and provides all Linux capabilities. It is equivalent to root on the host. From the Docker docs: "The `--privileged` flag gives all capabilities to the container, and it also lifts all the limitations enforced by the device cgroup controller."

2. **`/var/run/docker.sock:/var/run/docker.sock:ro`** — Even read-only access to the Docker socket is sufficient to spawn new containers (the socket API doesn't respect filesystem read-only mounts). An attacker with code execution inside the workers container can run:
   ```bash
   docker -H unix:///var/run/docker.sock run -v /:/host --rm -it alpine chroot /host sh
   ```
   This mounts the host root filesystem into a new container, achieving instant host compromise.

#### Attack Scenario

A candidate submits code that exploits a zero-day or misconfiguration in Judge0's sandboxing logic. Even though Judge0 v1.13.1 patched the known CVEs (2024-28185, 2024-28189, 2024-29021), new sandbox escapes in `isolate` or the language runtimes are discovered regularly. With `privileged: true`, any container escape immediately becomes **full host root access**.

#### Evidence

- `docker-compose.sandbox.yml:107`: `privileged: true`
- `docker-compose.sandbox.yml:104`: `/var/run/docker.sock:/var/run/docker.sock:ro`

#### Remediation

1. **Remove `privileged: true` immediately.** Judge0 workers do NOT need privileged mode to function. They only need:
   - The Docker socket to spawn sibling containers
   - Appropriate AppArmor/seccomp profiles
   - Specific Linux capabilities (`CAP_SYS_ADMIN`, `CAP_NET_ADMIN` if needed — but minimize)

2. **Replace with fine-grained capabilities:**
   ```yaml
   cap_add:
     - SYS_ADMIN
     - NET_ADMIN
   security_opt:
     - apparmor:docker-default
     - seccomp:./judge0-seccomp.json
   ```

3. **Use Docker-in-Docker (DinD) or rootless Podman** instead of Docker socket mounting. If Docker socket is required, use a Docker socket proxy (e.g., `tecnativa/docker-socket-proxy`) with restricted API access, not raw socket mount.

4. **Run workers as a non-root user** inside the container (`user: "1000:1000"`).

5. **Enable Docker Content Trust** and pin the Judge0 image digest, not just the tag:
   ```yaml
   image: judge0/judge0:1.13.1@sha256:<digest>
   ```

---

### FINDING 2: Judge0 API Unauthenticated and Exposed on Host Interface

**Severity:** CRITICAL  
**Attack Vectors:** #1 Container Escape, #2 Host Filesystem Access, #7 Reading Another Candidate's Data, #9 Judge0 API Abuse

#### Description

The Judge0 server configuration has authentication **completely disabled**:

```conf
# judge0-config/server.conf:20-23
# --- Authentication (disabled for local dev; enable in production) ---
# To enable: set to a strong random string and send as X-Auth-Token header
# AUTHN_TOKEN=
```

And the application code makes it optional:

```javascript
// routes/sandbox.js:33-34
const JUDGE0_AUTH_TOKEN = process.env.JUDGE0_AUTH_TOKEN || null;
```

If `JUDGE0_AUTH_TOKEN` is not set in the environment (the `.env.example` shows it commented out), the Judge0 API accepts all requests without any authentication token.

#### Attack Scenario

An attacker who discovers the Judge0 API endpoint (e.g., at `judge0.rekrutai.co:2358` or via internal network scanning) can:

1. Submit code directly to Judge0, **bypassing all Rekrut rate limits and auth checks**.
2. Set `enable_network: true` in their submission payload (if Judge0's `ALLOW_ENABLE_NETWORK` defaults to permissive) to gain outbound network from the sandbox.
3. Exhaust host resources by submitting thousands of jobs directly.
4. Exploit any future Judge0 vulnerability without needing a Rekrut account.

#### Evidence

- `judge0-config/server.conf:23`: `# AUTHN_TOKEN=` (commented out)
- `routes/sandbox.js:33`: `const JUDGE0_AUTH_TOKEN = process.env.JUDGE0_AUTH_TOKEN || null;`
- `.env.example`: `# JUDGE0_AUTH_TOKEN=your-strong-random-token-here` (commented out)

#### Remediation

1. **Enable Judge0 authentication in production:**
   ```conf
   # judge0-config/server.conf
   AUTHN_TOKEN=${JUDGE0_AUTH_TOKEN}
   ```
   Generate a 256-bit random token:
   ```bash
   openssl rand -hex 32
   ```

2. **Require the token in the application layer** (fail closed):
   ```javascript
   // routes/sandbox.js
   if (!JUDGE0_AUTH_TOKEN) {
     throw new Error('JUDGE0_AUTH_TOKEN is required in production');
   }
   ```

3. **Add the `X-Auth-Token` header to every Judge0 request** — the code already has conditional logic for this; make it unconditional.

4. **Rotate the token quarterly** and store it in a secrets manager (AWS Secrets Manager, HashiCorp Vault), not `.env`.

---

### FINDING 3: Hidden Test Cases Disclosed to Any Authenticated User

**Severity:** HIGH  
**Attack Vector:** #7 Reading Another Candidate's Submission or Test Cases

#### Description

The `GET /api/sandbox/test-cases` endpoint requires authentication but **does NOT require a recruiter/admin role**. Any authenticated user—including candidates—can list test cases for any assessment or job by providing an `assessmentId` or `jobId`.

Worse, the endpoint returns the **full test case data including `stdin` and `expected_stdout` even for hidden test cases**:

```javascript
// routes/sandbox.js:640-664
router.get(
  '/test-cases',
  authMiddleware,           // ← Any logged-in user, not just recruiters
  rateLimits.standard,
  async (req, res) => {
    // ...
    const result = await pool.query(
      `SELECT id, assessment_id, job_id, name, description,
              stdin, expected_stdout, expected_exit_code,
              is_hidden, points, order_index, created_at
       FROM sandbox_test_cases
       ${where}
       ORDER BY order_index ASC, created_at ASC`,
      [param]
    );
    res.json({ testCases: result.rows });  // ← Hidden test data fully exposed
  }
);
```

#### Attack Scenario

1. A candidate creates an account.
2. They call `GET /api/sandbox/test-cases?assessmentId=123`.
3. They receive ALL test cases, including hidden ones, with their inputs and expected outputs.
4. They can now write hardcoded solutions that pass all tests without solving the actual problem.
5. They can share the hidden test cases with other candidates, compromising the integrity of the entire assessment.

#### Evidence

- `routes/sandbox.js:640`: `router.get('/test-cases', authMiddleware, rateLimits.standard, ...)` — no `requireRole()`
- `routes/sandbox.js:652-654`: Query returns `stdin, expected_stdout` unconditionally

#### Remediation

1. **Add role restriction:**
   ```javascript
   router.get('/test-cases', authMiddleware, requireRole('recruiter', 'hiring_manager', 'employer', 'admin'), ...)
   ```

2. **For candidates, create a separate endpoint** that returns ONLY non-hidden test cases and strips `expected_stdout`:
   ```javascript
   // Candidate-safe test case view
   SELECT id, name, description, stdin, expected_exit_code, is_hidden, points, order_index
   FROM sandbox_test_cases
   WHERE assessment_id = $1 AND is_hidden = false
   ```

3. **Add assessment ownership check** — ensure the requesting recruiter owns the assessment:
   ```javascript
   const assessment = await pool.query(
     'SELECT * FROM assessments WHERE id = $1 AND created_by = $2',
     [assessmentId, req.user.id]
   );
   ```

---

### FINDING 4: Cross-Assessment Validation Without Access Control

**Severity:** HIGH  
**Attack Vectors:** #7 Reading Test Cases, #9 Judge0 API Abuse

#### Description

The `POST /api/sandbox/validate` endpoint accepts any `assessmentId` or `jobId` from the request body and fetches test cases for it **without verifying that the user has any relationship to that assessment**:

```javascript
// routes/sandbox.js:389-400
const tcQuery = assessmentId
  ? `SELECT * FROM sandbox_test_cases WHERE assessment_id = $1 ORDER BY order_index ASC`
  : `SELECT * FROM sandbox_test_cases WHERE job_id = $1 ORDER BY order_index ASC`;
const tcParam = assessmentId || jobId;

if (!tcParam) {
  return res.status(400).json({ error: 'assessmentId or jobId is required for validation' });
}

const tcResult = await pool.query(tcQuery, [tcParam]);
```

There is no check that:
- The candidate is assigned to this assessment
- The assessment belongs to the recruiter's company
- The job posting is visible to the candidate

#### Attack Scenario

1. A candidate discovers an assessment ID (e.g., `assessmentId=456`) from a job posting or URL.
2. They call `POST /api/sandbox/validate` with their code and `assessmentId=456`.
3. The endpoint runs their code against ALL test cases for that assessment, returning pass/fail for each.
4. The candidate can iteratively refine their solution against the real test cases before taking the actual assessment.
5. They can also enumerate all test case names and count, which helps them prepare.

#### Evidence

- `routes/sandbox.js:389-400`: No access control on `assessmentId`/`jobId`
- `routes/sandbox.js:420-432`: Test cases executed and results returned to caller

#### Remediation

1. **For candidates:** Validate that `assessmentAttemptId` belongs to the current user and is in-progress:
   ```javascript
   const attempt = await pool.query(
     `SELECT * FROM assessment_attempts
      WHERE id = $1 AND candidate_id = $2 AND status = 'in_progress'`,
     [assessmentAttemptId, ctx.userId]
   );
   if (attempt.rows.length === 0) {
     return res.status(403).json({ error: 'Invalid or unauthorized assessment attempt' });
   }
   ```

2. **For recruiters:** Validate assessment ownership via `company_id` or `created_by`.

3. **Do not allow `assessmentId`/`jobId` to be arbitrary integers** from unauthenticated request bodies without verification.

---

### FINDING 5: Judge0 Server Bound to All Host Interfaces

**Severity:** HIGH  
**Attack Vectors:** #1 Container Escape, #2 Host Filesystem Access, #9 Judge0 API Abuse

#### Description

The Judge0 server container binds port 2358 to **all host interfaces** (`0.0.0.0`), not just localhost:

```yaml
# docker-compose.sandbox.yml:67-68
  judge0-server:
    ports:
      - "2358:2358"
```

This means any traffic that can reach the host on port 2358 can talk directly to Judge0. If the host has a public IP (e.g., deployed on Render, AWS EC2, DigitalOcean), Judge0 is directly internet-facing.

Combined with Finding #2 (no authentication), this creates an **unauthenticated, internet-facing code execution service**.

#### Attack Scenario

1. The Rekrut app is deployed on Render (`rekrutai.onrender.com`).
2. Render assigns the app a public IP. Port 2358 is exposed.
3. An attacker scans `rekrutai.onrender.com:2358` and finds the Judge0 API.
4. They submit code directly, bypassing Rekrut entirely, and exploit any sandbox weakness.

#### Evidence

- `docker-compose.sandbox.yml:67-68`: `ports: - "2358:2358"`
- `judge0-config/server.conf:10`: `PORT=2358`

#### Remediation

1. **Bind to localhost only** if Judge0 is on the same host:
   ```yaml
   ports:
     - "127.0.0.1:2358:2358"
   ```

2. **If Judge0 runs on a separate host, use an internal network / VPC** and do NOT expose port 2358 publicly. Access it via a private IP or internal DNS.

3. **Add a reverse proxy** (nginx, traefik) in front of Judge0 with:
   - IP allowlisting (only Rekrut app servers)
   - mTLS (mutual TLS) between Rekrut app and Judge0
   - Rate limiting at the proxy level

4. **Firewall rules:** Block port 2358 at the cloud provider security group / firewall level for all IPs except the Rekrut app servers.

---

### FINDING 6: Rate Limit Bypass via X-Forwarded-For IP Spoofing

**Severity:** MEDIUM  
**Attack Vectors:** #4 Resource Exhaustion, #6 Free Compute, #9 Judge0 API Abuse

#### Description

The sandbox route extracts the client IP using the **leftmost** value in `X-Forwarded-For`, which is attacker-controlled:

```javascript
// routes/sandbox.js:167-174
function _getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();  // ← First IP: UNTRUSTED
  }
  return req.ip || req.socket?.remoteAddress || null;
}
```

The distributed rate limiter also uses the leftmost IP:

```javascript
// lib/distributed-rate-limiter.js:88
const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || ...;
```

Since `app.set('trust proxy', 1)` is configured in `server.js`, Express's `req.ip` already correctly resolves to the trusted proxy's client IP (rightmost untrusted). But these custom functions **override that safety** and trust the attacker-controlled leftmost IP.

#### Attack Scenario

1. An attacker sets `X-Forwarded-For: 1.1.1.1` for their first request — rate limit bucket for `1.1.1.1` is created.
2. They set `X-Forwarded-For: 1.1.1.2` for the second request — new bucket.
3. They can cycle through thousands of IPs, completely bypassing the 10 req/min submit limit and the 5 req/min validate limit.
4. This enables crypto mining, fork bombs, and resource exhaustion at scale.

#### Evidence

- `routes/sandbox.js:167-174`: `_getClientIp` trusts leftmost `X-Forwarded-For`
- `lib/distributed-rate-limiter.js:88`: Same issue in rate limiter
- `server.js:91`: `app.set('trust proxy', 1)` — correct Express config, but custom functions ignore it

#### Remediation

1. **Use `req.ip` exclusively** — Express handles proxy trust correctly when `trust proxy` is set:
   ```javascript
   function _getClientIp(req) {
     return req.ip || req.socket?.remoteAddress || null;
   }
   ```

2. **Fix the distributed rate limiter** to use `req.ip`:
   ```javascript
   const ip = req.ip || req.socket?.remoteAddress || 'unknown';
   ```

3. **Validate `trust proxy` configuration** — ensure it's set to the number of known proxy hops (e.g., `app.set('trust proxy', 1)` for Render, `2` for Cloudflare + Render, etc.).

---

### FINDING 7: No Resource Limits on Judge0 Workers Container

**Severity:** MEDIUM  
**Attack Vector:** #4 Resource Exhaustion

#### Description

The `judge0-workers` container has **no resource limits** defined in the Docker Compose file:

```yaml
# docker-compose.sandbox.yml:99-109
  judge0-workers:
    # ... no deploy.resources.limits, no mem_limit, no cpus
```

While Judge0's `workers.conf` sets per-submission limits (`max_cpu_time=15`, `max_memory=512000`, `max_processes_and_or_threads=60`), these limits apply **inside each sandbox container**, not to the workers container itself. A fork bomb or memory exhaustion attack that bypasses the per-submission limits (e.g., via a language runtime bug) can consume all host resources.

Additionally, there is **no per-user daily/hourly submission budget** — only per-minute rate limits.

#### Attack Scenario

1. A candidate bypasses rate limits (Finding #6) and submits thousands of jobs.
2. Each job spawns a sandbox container. The workers container coordinates them.
3. Even with 15s CPU time, 10 jobs/min from 100 spoofed IPs = 1000 jobs/min = 250 CPU-minutes/min of compute.
4. Host CPU is saturated. Other services (Rekrut app, database) become unresponsive.
5. Disk fills up from compilation artifacts, logs, and stdout captures.

#### Evidence

- `docker-compose.sandbox.yml`: No `deploy.resources.limits` on `judge0-workers`
- `routes/sandbox.js:52-55`: Per-minute rate limits only (no daily/hourly budget)
- `judge0-config/workers.conf:30-31`: Per-submission limits, not per-user or per-host

#### Remediation

1. **Add Docker resource limits to the workers container:**
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '2.0'
         memory: 4G
       reservations:
         cpus: '1.0'
         memory: 2G
   ```

2. **Add host-level limits** via cgroups or systemd slice for the Docker daemon itself.

3. **Implement per-user daily submission quotas** in the application layer:
   ```javascript
   const dailyLimit = await distributedRateLimiter.checkLimit(
     `sandbox-daily:${ctx.userId}`, 24 * 60 * 60 * 1000, 100
   );
   if (!dailyLimit.allowed) {
     return res.status(429).json({ error: 'Daily submission quota exceeded' });
   }
   ```

4. **Set a global concurrent submission limit** (e.g., max 50 queued jobs across all users).

5. **Enable disk quotas** and cleanup old sandbox containers/images aggressively.

---

### FINDING 8: CORS Wildcard Allows Cross-Origin Requests to Judge0

**Severity:** MEDIUM  
**Attack Vector:** #9 Judge0 API Abuse

#### Description

The Judge0 server configuration allows CORS from **any origin**:

```conf
# judge0-config/server.conf:26
CORS_ORIGINS=*
```

If a candidate can access Judge0 directly (Finding #5), any malicious website they visit can make cross-origin requests to Judge0 on their behalf. While this is less severe if authentication is enabled (Finding #2), it still allows:

- Status polling from arbitrary origins
- Information leakage about Judge0 version and configuration
- CSRF-like attacks if Judge0 has any state-changing GET endpoints

#### Evidence

- `judge0-config/server.conf:26`: `CORS_ORIGINS=*`

#### Remediation

1. **Restrict CORS to the Rekrut app origin only:**
   ```conf
   CORS_ORIGINS=https://rekrutai.co,https://hireloop-vzvw.polsia.app
   ```

2. **If Judge0 is never accessed by browsers directly** (only server-to-server from Rekrut), set:
   ```conf
   CORS_ORIGINS=
   ```
   (empty = no CORS, server-to-server only)

---

### FINDING 9: Broken Async Result Polling (Local Token Never Mapped to Judge0)

**Severity:** LOW  
**Attack Vector:** Reliability / Defense-in-Depth

#### Description

When a submission is sent to Judge0 with `wait=false`, Judge0 returns its own token:

```javascript
// routes/sandbox.js:267-276
let judge0Token = null;
try {
  const judge0Result = await callJudge0('/submissions?base64_encoded=false&wait=false', judge0Payload);
  judge0Token = judge0Result.token;
  // ... judge0Token is NEVER stored in the database or used again!
} catch (judgeErr) { ... }
```

But the result polling endpoint uses the **local token** (generated by `crypto.randomBytes(24)`) to query Judge0:

```javascript
// routes/sandbox.js:332-336
async function getJudge0Result(token) {
  const url = `${JUDGE0_API_URL}/submissions/${token}?base64_encoded=false&fields=*`;
  // ...
}
```

Judge0 has never seen this local token, so `getJudge0Result()` always returns 404. The catch block logs an error and returns the cached queued status. **Async submissions never receive execution results.**

#### Evidence

- `routes/sandbox.js:270`: `judge0Token = judge0Result.token;` — assigned but never persisted
- `routes/sandbox.js:332`: `getJudge0Result(token)` uses local token, not Judge0 token

#### Remediation

1. **Store the Judge0 token in the database:**
   ```sql
   ALTER TABLE sandbox_submissions ADD COLUMN judge0_token VARCHAR(100);
   ```

2. **Update the submit endpoint** to store `judge0Token`:
   ```javascript
   await pool.query(
     `UPDATE sandbox_submissions SET judge0_token = $1 WHERE token = $2`,
     [judge0Token, localToken]
   );
   ```

3. **Update `getJudge0Result`** to use the stored Judge0 token.

---

### FINDING 10: Source Code Stored Unencrypted in Database

**Severity:** LOW  
**Attack Vector:** #7 Data-at-Rest Exposure

#### Description

All candidate source code is stored as plaintext `TEXT` in PostgreSQL:

```javascript
// migrations/117_code_sandbox.js:68
source_code TEXT NOT NULL,
```

There is no encryption at the application layer. If the database is compromised (via SQL injection, credential theft, or backup exposure), all candidate submissions are readable.

This is rated LOW because:
- PostgreSQL encryption-at-rest (TDE) can be enabled at the infrastructure level
- The code does not contain secrets (it's candidate-written)
- But it could contain proprietary solutions that candidates don't want leaked

#### Remediation

1. **Enable PostgreSQL encryption-at-rest** via cloud provider (AWS RDS encryption, Neon TDE).

2. **For defense-in-depth, encrypt sensitive columns** at the application layer using AES-256-GCM:
   ```javascript
   const encrypted = encrypt(sourceCode, process.env.SANDBOX_ENCRYPTION_KEY);
   ```
   Store the ciphertext in `source_code_encrypted` and decrypt on read.

3. **Audit logging** for all accesses to `sandbox_submissions.source_code`.

---

## Attack Vector Evaluation Matrix

| # | Attack Vector | Status | Severity | Key Finding |
|---|--------------|--------|----------|-------------|
| 1 | **Container escape** | ⚠️ Vulnerable | CRITICAL | `privileged: true` + Docker socket mount trivializes escape |
| 2 | **Host filesystem access** | ⚠️ Vulnerable | CRITICAL | Same as #1 — privileged container has full host access |
| 3 | **Outbound network access from sandbox** | ⚠️ Partially vulnerable | HIGH | `DISABLE_NETWORK=true` is set, but direct Judge0 access bypasses controls |
| 4 | **Resource exhaustion** | ⚠️ Vulnerable | MEDIUM | No container limits on workers; rate limits bypassable via X-Forwarded-For |
| 5 | **State leakage between candidates** | ✅ Mitigated | — | Ownership checks on submissions prevent direct leakage |
| 6 | **Using sandbox as free compute** | ⚠️ Vulnerable | MEDIUM | 10 req/min per spoofed IP = unlimited compute; no daily quotas |
| 7 | **Reading another candidate's submission/test cases** | ⚠️ Vulnerable | HIGH | Test-case endpoint leaks hidden tests to any authenticated user |
| 8 | **Privilege escalation inside container** | ⚠️ Vulnerable | CRITICAL | `privileged: true` = root on host; no capability drop |
| 9 | **Judge0 API abuse from authenticated candidate** | ⚠️ Vulnerable | CRITICAL | Judge0 unauthenticated + exposed on host interface |

---

## Overall Risk Rating: CRITICAL

| Component | Risk Level | Rationale |
|-----------|-----------|-----------|
| Infrastructure | **CRITICAL** | Privileged containers, exposed unauthenticated API, no network segmentation |
| Application API | **HIGH** | Hidden test case leak, cross-assessment validation, rate limit bypass |
| Data Protection | **LOW** | Plaintext storage, but no direct exposure vector |
| Operational Security | **MEDIUM** | Broken async polling, missing monitoring/alerting for sandbox abuse |

**Combined Assessment:** The sandbox architecture, as currently configured, presents a **CRITICAL** risk. The combination of `privileged: true`, Docker socket access, unauthenticated Judge0 API, and host-exposed port 2358 creates a **trivial path from candidate code submission to full host compromise**. This is not a theoretical concern — the Judge0 project itself documented this exact escalation path in their CVE advisories.

---

## Recommendations Before Production Enablement

### Blockers (Must Fix)

| Priority | Action | Owner | Finding |
|----------|--------|-------|---------|
| P0 | Remove `privileged: true` from `judge0-workers`; use capabilities + AppArmor instead | DevOps / SRE | #1, #8 |
| P0 | Enable `AUTHN_TOKEN` in Judge0 server config; require `JUDGE0_AUTH_TOKEN` env var | Backend | #2, #9 |
| P0 | Bind Judge0 to `127.0.0.1:2358` only; add reverse proxy with IP allowlist | DevOps / SRE | #5, #9 |
| P0 | Add `requireRole()` to `GET /api/sandbox/test-cases`; create candidate-safe endpoint | Backend | #3 |
| P0 | Validate `assessmentAttemptId` ownership in `POST /api/sandbox/validate` | Backend | #4 |

### High Priority (Fix Before Public Launch)

| Priority | Action | Owner | Finding |
|----------|--------|-------|---------|
| P1 | Fix IP extraction to use `req.ip` only; remove X-Forwarded-For trust from rate limiter | Backend | #6 |
| P1 | Add per-user daily submission quotas (e.g., 100/day) | Backend | #4, #6 |
| P1 | Add Docker resource limits (CPU, memory, disk) to workers container | DevOps / SRE | #7 |
| P1 | Restrict `CORS_ORIGINS` to Rekrut app domains only | DevOps / SRE | #8 |
| P1 | Store Judge0 token mapping for async result polling | Backend | #9 |

### Medium Priority (Hardening)

| Priority | Action | Owner | Finding |
|----------|--------|-------|---------|
| P2 | Enable application-layer encryption for `source_code` column | Backend | #10 |
| P2 | Add sandbox abuse monitoring — alert on >X submissions/hour per user | Security / SRE | #4, #6 |
| P2 | Run Judge0 workers in a separate VPC / isolated network segment | DevOps / SRE | #1, #5 |
| P2 | Pin Judge0 image to SHA256 digest; enable Docker Content Trust | DevOps / SRE | #1 |
| P2 | Add WAF rules for SSRF patterns targeting `169.254.169.254`, `10.0.0.0/8`, etc. | Security | #3, #9 |

### Monitoring & Alerting Requirements

1. **Alert** on any request to Judge0 port 2358 from non-Rekrut app IPs.
2. **Alert** on sandbox container spawn rate > threshold (indicates abuse).
3. **Alert** on `SIGKILL` / `SIGSEGV` / runtime error spikes (indicates exploit attempts).
4. **Log** all `sandbox_submitted` and `sandbox_validated` events to the audit logger (already implemented — verify retention).
5. **Dashboard** showing: submissions/min, validate latency, error rate by status, top users by submission count.

---

## Appendix A: Secure Docker Compose Reference

```yaml
# judge0-workers — hardened configuration
  judge0-workers:
    image: judge0/judge0:1.13.1@sha256:<pin-digest-here>
    container_name: rekrut-judge0-workers
    restart: unless-stopped
    command: ["./scripts/workers"]
    user: "1000:1000"
    read_only: true
    volumes:
      - ./judge0-config/workers.conf:/api/config/workers.conf:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    depends_on:
      redis-sandbox:
        condition: service_healthy
      postgres-sandbox:
        condition: service_healthy
    networks:
      - judge0-network
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 4G
        reservations:
          cpus: '1.0'
          memory: 2G
    security_opt:
      - no-new-privileges:true
      - seccomp:./judge0-seccomp.json
    cap_drop:
      - ALL
    cap_add:
      - SYS_ADMIN       # Required for isolate namespace operations
      - NET_ADMIN       # Required for --net=none setup
      - SETUID
      - SETGID
    tmpfs:
      - /tmp:noexec,nosuid,size=1g
```

**Note:** Even with these restrictions, the Docker socket mount remains a risk. Consider migrating to **rootless Podman** or using a **Docker socket proxy** with restricted API endpoints.

---

## Appendix B: Judge0 CVE Reference

| CVE | CVSS | Description | Fixed In |
|-----|------|-------------|----------|
| CVE-2024-28185 | 10.0 | Symlink attack → arbitrary file write → sandbox escape | 1.13.1 |
| CVE-2024-28189 | 10.0 | chown on symlink → bypass CVE-2024-28185 patch | 1.13.1 |
| CVE-2024-29021 | 9.1 | SSRF → connect to internal PostgreSQL → command injection | 1.13.1 |

The deployed version (1.13.1) patches these specific CVEs, but the **deployment configuration** (`privileged: true`, exposed API) reintroduces equivalent or greater risk.

---

*Report generated by Application Security Engineer subagent. Static analysis only — no production exploitation performed.*
