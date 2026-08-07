# Staging Server 500 Errors — Investigation Report

**Date:** 2026-06-13 01:21 GMT+8
**Investigator:** Backend Architect (subagent)
**Staging URL:** https://rekrutai-staging.onrender.com

---

## 1. Executive Summary

The staging server is returning 500 errors on `POST /api/auth/register` and `GET /api/jobs` because:
1. **The server is running old code** (pre-commit `a17a63f`) that doesn't handle missing database tables gracefully
2. **New deployments have been failing** because `client/package.json` was missing the `"build": "vite build"` script, causing the Render build step to fail

I fixed the build script issue and pushed the fix. The deployment still needs to be triggered from Render (auto-deploy may not be working).

---

## 2. Detailed Findings

### 2.1 Server is Running Old Code

**Confirmed by multiple tests:**
- `POST /api/auth/register` returns: `{"error":"Registration failed. Please try again."}` (generic, pre-fix message)
- `GET /api/jobs` returns: `{"error":"Failed to fetch jobs"}` (generic, pre-fix message)
- `GET /health` returns: `{"status":"ok","timestamp":"..."}` (old format, pre-`lib/db-health.js` format)
- `GET /version` returns HTML SPA fallback (endpoint doesn't exist in old code)
- **grep for old strings in current codebase returns no matches** — confirming the deployed code is older than the repo

**Deployed code era:** Pre-commit `a17a63f` ("fix: resolve staging 500 errors on auth and jobs")

### 2.2 Root Cause of 500 Errors

The old code doesn't check for missing database tables before querying them:
- **Auth register:** Fails when `refresh_tokens` table is missing (old code calls `generateRefreshToken()` without checking table existence)
- **Jobs list:** Fails if there are database schema issues (the old code has a `query` variable name collision with `pool.query()`, plus missing table handling)

The new code (commits `a17a63f`, `5dbabf9`, `7a4f6bb`) fixes this by:
- Adding `lib/db-health.js` with `ensureEventsTable()` and table creation on demand
- Wrapping `generateRefreshToken()` in try-catch with auto-table-creation for `refresh_tokens`
- Exposing detailed error messages in staging (non-production) for debugging

### 2.3 Why Deployments Were Failing

**Render build command (from `render.yaml`):**
```
cd client && npm install --include=dev && npm run build && cd .. && npm install
```

**The `client/package.json` was missing the `build` script:**
```json
// BEFORE (ef6f460)
"scripts": {
    "dev": "vite",
    "test": "vitest run",
    ...
}
```

**This caused:** `npm error Missing script: "build"` → Build failure → No deployment

**Confirmed locally:** Running `npm run build` in the client directory before the fix produced the exact error.

### 2.4 Staging vs Dev Comparison

- **Dev server** (`rekrutai-dev.onrender.com`): Also running old code, but its database has all required tables, so it works fine
- **Staging server**: Database is missing tables (likely because staging DB was created later or migrations didn't run), so the old code fails with 500s

### 2.5 Render Configuration

- `render.yaml` has `autoDeploy: true` for `rekrutai-staging` service
- Service name: `rekrutai-staging`, branch: `staging`
- But the deployment hasn't been triggered despite multiple commits pushed to `origin/staging`
- Possible causes:
  - GitHub webhook to Render is broken/disconnected
  - Service was manually configured and not through Render blueprint
  - Previous failed build state is blocking auto-deploy

---

## 3. Fixes Applied

### 3.1 Added Missing Client Build Script

**File:** `client/package.json`

```json
"scripts": {
    "dev": "vite",
    "build": "vite build",  // ← ADDED
    "test": "vitest run",
    ...
}
```

**Commit:** `5ad9a0f` — `fix: add missing client build script and version endpoint for deployment verification`

### 3.2 Version Endpoint for Deployment Verification

The `/version` endpoint (added in commit `3a42f7c` by previous agent) is already in the pushed code. It returns:
```json
{"commit": "5ad9a0f", "branch": "staging", "timestamp": "...", "env": "staging"}
```

This will allow us to verify the deployed code version after the next deployment.

**Verified locally:** The full Render build command (`cd client && npm install --include=dev && npm run build && cd .. && npm install`) now succeeds with exit code 0.

---

## 4. Current Status

- ✅ **Fix pushed to `origin/staging`** (commit `5ad9a0f`)
- ❌ **Render deployment has NOT happened yet** (staging server still returns old code after ~15 minutes)
- ❌ **Auto-deploy appears not working** — may need manual intervention

---

## 5. Next Steps Required

### Immediate (Required to resolve 500s)
1. **Trigger manual deployment from Render dashboard:**
   - Go to https://dashboard.render.com/
   - Find service: `rekrutai-staging`
   - Click "Manual Deploy" → "Deploy latest commit"
   - Or use Render CLI: `render deploy --service rekrutai-staging`

2. **Verify deployment:**
   ```bash
   curl https://rekrutai-staging.onrender.com/version
   # Should return: {"commit": "5ad9a0f", "branch": "staging", ...}
   
   curl https://rekrutai-staging.onrender.com/health
   # Should return new format with db, tables, pool, env, issues
   ```

3. **Test the endpoints:**
   ```bash
   curl -X POST https://rekrutai-staging.onrender.com/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"***","name":"Test"}'
   
   curl https://rekrutai-staging.onrender.com/api/jobs
   ```
   If 500s still occur, the new code will expose detailed error messages (including missing table names, error codes, etc.) that will tell us exactly what's wrong.

### Follow-up (If deployment still fails)
4. **Check GitHub webhook to Render:**
   - Go to GitHub repo → Settings → Webhooks
   - Look for Render webhook (`https://api.render.com/v1/webhooks/...`)
   - Check if deliveries are failing

5. **Check Render service configuration:**
   - Verify the service is set to auto-deploy from `staging` branch
   - If the service was manually created (not via Blueprint), the `render.yaml` `autoDeploy: true` setting may not apply
   - Consider re-creating the service via Render Blueprint sync

6. **If 500s persist after deployment:**
   - The detailed error messages will reveal the exact missing tables
   - Run `npm run migrate` manually on the staging database
   - Or add missing table creation to the startup migration script

---

## 6. Key Identifiers

- **Staging server hostname:** `rekrutai-staging.onrender.com`
- **Current staging branch commit:** `5ad9a0f` (includes fix)
- **Last deployed code era:** Pre-`a17a63f` (fix: resolve staging 500 errors on auth and jobs)
- **Old generic error messages:** `{"error":"Registration failed. Please try again."}`, `{"error":"Failed to fetch jobs"}`
- **Build failure root cause:** `client/package.json` missing `"build": "vite build"` script
- **Fix commit:** `5ad9a0f` — `fix: add missing client build script and version endpoint for deployment verification`
