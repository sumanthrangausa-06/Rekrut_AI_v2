# Production Deployment Outage Report

**Date:** 2026-06-08  
**Investigated by:** DevOps Subagent  
**Production Domain:** `hireloop-vzvw.polsia.app`  
**Dev Environment:** `rekrutai-dev.onrender.com` (healthy)  
**Last Commit:** `cfbf5d9` — "e2e: playwright config updates + global teardown + prod readiness checklist"  
**Previous Commit:** `f92f3a9` — "Merge dev into main — prod deploy trigger"

---

## 1. Executive Summary

The production domain `hireloop-vzvw.polsia.app` is experiencing a **partial outage**. The React frontend SPA loads correctly, and some API endpoints respond, but **the `/api/health` endpoint (and several other API routes) consistently times out**. The dev environment is fully healthy. Investigation reveals a **deployment mismatch / multi-service confusion** where multiple production-related domains are running different versions of the code with different behavior.

**Verdict:** The production service is likely in a **partially deployed or corrupted state** following the recent large merge (`f92f3a9`). A fresh redeploy is strongly recommended.

---

## 2. What Was Checked

### 2.1 DNS / Domain Resolution
| Domain | CNAME / A Record | Status |
|--------|-----------------|--------|
| `hireloop-vzvw.polsia.app` | `polsia.onrender.com` → `gcp-us-west1-1.origin.onrender.com` → Cloudflare CDN | ✅ Resolves |
| `rekrutai.co` | `216.24.57.1` (A record) | ✅ Resolves |
| `rekrut-ai.onrender.com` | `gcp-us-west1-1.origin.onrender.com` | ✅ Resolves |
| `rekrutai-prod.onrender.com` | — | ❌ 404 / Not Found |
| `rekrutai-dev.onrender.com` | — | ✅ Healthy |

**Finding:** There are **multiple production domains** pointing to **different IP addresses and infrastructure**. `hireloop-vzvw.polsia.app` goes through Cloudflare CDN (`cdn.cloudflare.net`), while `rekrutai.co` points to a different origin (`216.24.57.1`). The `render.yaml` defines a service named `rekrutai-prod`, but that native Render URL returns 404 for all paths, indicating the service is either not running or was renamed.

### 2.2 Endpoint Health Matrix (Production)

| Endpoint | `hireloop-vzvw.polsia.app` | `rekrutai.co` | `rekrut-ai.onrender.com` | Dev |
|----------|----------------------------|---------------|--------------------------|-----|
| `GET /` (SPA) | ✅ 200 (new Vite build) | ✅ 200 | ✅ 200 | ✅ 200 |
| `GET /health` | ✅ 200 (0.3–0.8s) | ✅ 200 (0.4–0.8s) | ✅ 200 | ✅ 200 |
| `GET /api/health` | ❌ **TIMEOUT (20s)** | ❌ **404** | ❌ **404** | ✅ 200 |
| `GET /api/jobs` | ✅ 200 (1.6s) | — | — | ✅ 200 |
| `GET /api/omniscore` | ✅ 401 (0.7s) | — | — | ✅ 401 |
| `GET /api/trustscore` | ✅ 401 (0.2s) | — | — | ✅ 401 |
| `GET /api/countries` | ✅ 200 (0.7s) | — | — | ✅ 200 |
| `GET /api/auth` | ❌ **TIMEOUT (20s)** | ❌ **404** | — | — |
| `GET /api/candidate` | ❌ **TIMEOUT (20s)** | — | — | — |
| `GET /api/screening` | ❌ **TIMEOUT (20s)** | — | — | — |
| `POST /api/health` | ✅ 404 (0.3s) | ✅ 404 | — | — |
| `OPTIONS /api/health` | ✅ 204 (0.2s) | ✅ 204 | — | — |

**Finding:** The behavior is **wildly inconsistent across domains and endpoints**. On `hireloop-vzvw.polsia.app`, some API routes work perfectly while others hang indefinitely. On `rekrutai.co`, `/api/health` returns 404 (indicating old code). The fact that **POST returns 404 while GET/HEAD timeout** on the same path rules out a simple CDN block and points to a server-level issue with the Express GET route handler.

### 2.3 Build / Code Analysis
- The `/api/health` endpoint was **added in commit `f92f3a9`** (the dev merge). It did not exist in earlier code.
- The `render.yaml` `healthCheckPath` is `/health`, not `/api/health`.
- The server.js defines both `/health` and `/api/health` **identically at the top of the file**, before any middleware:
  ```js
  app.get('/health', (req, res) => { res.json({ status: 'ok', timestamp: new Date().toISOString() }); });
  app.get('/api/health', (req, res) => { res.json({ status: 'ok', timestamp: new Date().toISOString() }); });
  ```
  In theory, if the server is running and can process `/health`, it should process `/api/health` identically.

### 2.4 Environment Variable Risk (from `prod-readiness-checklist.md`)
- The new code **requires `SESSION_SECRET`** to be set. If missing, the server **throws a fatal error on startup** and will not start.
- The new code **requires `JWT_SECRET`** to be set. If missing, `lib/auth.js` throws on module load.
- The Render dashboard `sync: false` flags for these secrets mean they are **not auto-generated** and must be manually configured.
- The prod-readiness checklist explicitly flagged these as **"MANUAL CHECK REQUIRED"** and warned that the server will crash if absent.

---

## 3. Root Cause Diagnosis

### 3.1 Primary Theory: Corrupted / Partial Deployment on `hireloop-vzvw.polsia.app`

The `hireloop-vzvw.polsia.app` domain is serving the **new frontend build** (latest Vite assets, Tailwind classes, new HTML structure) but the backend is in a **degraded state** where certain Express routes hang while others work. This pattern is consistent with:

- **A deployment that failed partway through** (e.g., the build container updated static files but the Node process restarted into a bad state).
- **Render blue-green deployment stuck in transition** where the new container passes the `/health` check but has a corrupted event loop or hung async initialization for specific routes.
- **The service is in a restart loop** and occasionally serving requests from a partially-initialized container.

### 3.2 Secondary Theory: Multiple Services with Confusion

There are at least **three distinct production-facing endpoints** (`hireloop-vzvw.polsia.app`, `rekrutai.co`, `rekrut-ai.onrender.com`) running different code versions:
- `rekrutai.co` → returns 404 for `/api/health` (old code, pre-merge)
- `rekrut-ai.onrender.com` → returns 404 for `/api/health` (old code, pre-merge)
- `hireloop-vzvw.polsia.app` → has new frontend build, but backend hangs on `/api/health` (new code, broken state)

This indicates the **custom domain is not attached to the service you think it is**, or the `render.yaml` blueprint has not been correctly synchronized with the Render dashboard.

### 3.3 Why `/health` Works but `/api/health` Hangs

In the current codebase, both routes are defined identically before any middleware. The only way they can diverge is if:
1. The **running server code is different from the repo** (e.g., a hotfix, a manual dashboard change, or a cached module).
2. The **Express process is partially crashed / the event loop is blocked** for paths that hit certain route handlers.
3. There is **some proxy or Render edge behavior** that intercepts `/api/health` specifically (less likely because origin IP access with the correct Host header also reproduces the timeout).

Given that `POST /api/health` returns 404 quickly but `GET /api/health` hangs, the issue is **specific to the GET handler path** in the running server.

---

## 4. Immediate Action Plan

### 🔴 Critical (Do Now)

1. **Open the Render Dashboard and check deployment logs for `hireloop-vzvw.polsia.app` (or the service it is attached to).** Look for:
   - Crash loops (`SESSION_SECRET` missing errors)
   - Build failures during `npm start`
   - Memory or event-loop block warnings

2. **Verify Environment Variables on the LIVE service:**
   - `SESSION_SECRET` — must be a strong random string. If blank, the server will crash on startup.
   - `JWT_SECRET` — must be set. If blank, `lib/auth.js` will throw and the server won't start.
   - `DATABASE_URL` — verify connectivity.

3. **Trigger a Manual Redeploy:**
   - Go to the Render dashboard → the service serving `hireloop-vzvw.polsia.app` → Deploy → Manual Deploy → Clear Build Cache & Deploy.
   - This will force a clean build from the latest `main` commit.

4. **Confirm Custom Domain Attachment:**
   - Verify in the Render dashboard that `hireloop-vzvw.polsia.app` is attached to the correct service (`rekrutai-prod` or whatever the intended production service is).
   - The `rekrutai-prod.onrender.com` native URL returns 404, meaning that service is NOT running the correct app or is not running at all.

### 🟡 Urgent (Next 30 Minutes)

5. **Test Post-Redeploy:**
   ```bash
   curl -s https://hireloop-vzvw.polsia.app/api/health
   curl -s https://hireloop-vzvw.polsia.app/api/jobs
   curl -s https://hireloop-vzvw.polsia.app/api/auth
   ```
   All should return quickly (200 or 404, but NOT timeout).

6. **If redeploy fails:** Check the Render build logs for the exact error. The most likely fatal error is:
   ```
   Error: SESSION_SECRET environment variable is required
   ```
   If you see this, set `SESSION_SECRET` in the Render dashboard Environment tab and redeploy.

7. **Consolidate Production URLs:** Decide whether the canonical production URL is:
   - `hireloop-vzvw.polsia.app` (Polsia custom domain)
   - `rekrutai.co` (main domain)
   - `rekrut-ai.onrender.com` (Render native)
   
   Currently they are running **different code versions**, which is a recipe for confusion. Consolidate to one service and one domain.

### 🟢 Follow-Up (After Restore)

8. **Update the render.yaml or service name** to match the actual live production service.
9. **Update `DEPLOYMENTS.md`** to reflect the correct service ID, commit hash, and URL.
10. **Verify the prod-readiness checklist blockers** (Stripe live keys, DB snapshot, E2E tests) before declaring the deployment truly healthy.

---

## 5. Evidence Summary

- **Frontend:** `hireloop-vzvw.polsia.app/` returns 200 with new Vite build (`client/dist` assets) — the build step succeeded.
- **Health (`/health`):** Returns 200 with changing timestamps — a Node.js process is definitely running.
- **API Health (`/api/health`):** GET/HEAD timeout after 20s; POST/OPTIONS return immediately — the server is alive but the GET path is blocked or the handler is not executing correctly.
- **Dev Parity:** `rekrutai-dev.onrender.com/api/health` returns 200 instantly — the code itself is correct in the dev environment.
- **404 Domains:** `rekrutai.co/api/health` and `rekrut-ai.onrender.com/api/health` return 404, meaning those services are running **old code** (pre-`f92f3a9` merge).

---

## 6. Conclusion

The production outage is **not a DNS issue, not a code bug, and not a total server crash**. It is a **deployment state corruption** where the `hireloop-vzvw.polsia.app` service is running a hybrid state (new frontend, broken backend) most likely caused by a failed or stuck deployment after the large `f92f3a9` merge. A **clean manual redeploy with verified environment variables** is the fastest path to recovery.
