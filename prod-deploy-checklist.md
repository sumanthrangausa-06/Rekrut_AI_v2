# Rekrut AI v2 — Production Deployment Checklist

> **Prepared by:** DO-001 (DevOps Lead)  
> **Date:** 2026-06-08  
> **Current Production Commit:** `fb1fdb3` (deployed 2026-05-16)  
> **Target Production Commit:** `cfbf5d9` (main HEAD)  
> **Commits Behind:** ~100+ commits  
> **Deadline:** 2026-06-19 (11 days)  
> **Status:** 🔴 **NOT READY — Multiple blockers**

---

## Executive Summary

Production is running **code from May 16** (`fb1fdb3`) while `main` is at `cfbf5d9` (June 8) with ~100+ commits of new features, security fixes, E2E tests, mobile responsive fixes, Stripe subscriptions, and React migrations. The staging environment (`rekrutai-dev`) is healthy and running the newer code. **Before deploying to production, we must resolve critical blockers related to security verification, Stripe live keys, build consistency, and E2E validation.**

---

## 1. Environment Health Status

| Environment | URL | Health | Code Age | Notes |
|-------------|-----|--------|----------|-------|
| **Production** | `https://rekrutai.co` | ✅ HTTP 200 | ⚠️ **Old** (`fb1fdb3`, May 16) | **Running old code** — missing security fixes, new features |
| **Staging** | `https://rekrutai-dev.onrender.com` | ✅ `{"status":"ok"}` | ✅ Current (`dev` branch) | Healthy, auto-deploys from `dev` |
| **Production Render** | `https://rekrutai.onrender.com` | ❌ SUSPENDED (503) | N/A | Suspended by owner — not the active endpoint |

### ⚠️ CRITICAL FINDING: Production Running Old Code

Production headers reveal the deployed code is NOT the latest `main`:
```
permissions-policy: camera=*, microphone=*       # OLD — should be (self)
x-powered-by: Express                           # OLD — should be disabled
```

Current `server.js` (commit `cfbf5d9`) has these fixes:
- `app.disable('x-powered-by')` — present in code, NOT in production
- `Permissions-Policy: camera=(self), microphone=(self)` — present in code, NOT in production
- `helmet()` with CSP, HSTS, X-Frame-Options — present in code, NOT in production

**Conclusion:** Production is ~100+ commits behind `main`. This is the largest gap since launch.

---

## 2. Pre-Deploy Verification Checklist

### 2.1 Code Quality & Branch Sanity

| # | Step | Command / Action | Status | Notes |
|---|------|----------------|--------|-------|
| 2.1.1 | `dev` merged into `main` | `git log main..dev --oneline` | ✅ PASS | No unmerged dev commits |
| 2.1.2 | Working tree clean | `git status --short` | ✅ PASS | Only `mobile-audit-report.md` untracked (non-production) |
| 2.1.3 | Server syntax check | `node -c server.js` | ✅ PASS | No syntax errors |
| 2.1.4 | Routes syntax check | `for f in routes/*.js; do node -c "$f"; done` | ✅ PASS | All 23 route files valid |
| 2.1.5 | No merge conflicts | Review `git log --graph --oneline main` | ✅ PASS | Clean linear history |
| 2.1.6 | Client dist committed | `ls client/dist/assets/` | ✅ PASS | `index.html`, `assets/` present in repo |
| 2.1.7 | Commit dist matches build | `cd client && npm run build` → diff | ⬜ **TODO** | Verify committed dist matches fresh build |

### 2.2 Build Verification

| # | Step | Expected Result | Status | Notes |
|---|------|-----------------|--------|-------|
| 2.2.1 | Clean client build | `cd client && npm install && npm run build` → Exit 0 | ⬜ **TODO** | Must run before deploy |
| 2.2.2 | Build artifacts match committed | `git diff --stat` after build | ⬜ **TODO** | Should be zero or only expected changes |
| 2.2.3 | Chunk size check | Review `client/dist/assets/` | ⚠️ WARNING | Largest chunk ~1.5MB (index), vendor 48KB, ui 75KB. Consider splitting index further |
| 2.2.4 | Build command consistency | `render.yaml` buildCommand matches `package.json` build | ⚠️ **BLOCKER** | `render.yaml` uses `npm install` (no `--include=dev`), `package.json` uses `npm install --include=dev` |
| 2.2.5 | TypeScript errors | `cd client && npx tsc --noEmit` | ⬜ **TODO** | ≤ 3 pre-existing errors acceptable per QA report |

**🔴 BLOCKER 2.2.4 — Build Command Mismatch:**

```yaml
# render.yaml (current)
buildCommand: cd client && npm install && npm run build && cd .. && npm install

# package.json (current)
"build": "cd client && npm install --include=dev && npm run build"
```

**Problem:** `render.yaml` does NOT pass `--include=dev` to `npm install` in the client directory. Vite and its plugins are `devDependencies` in `client/package.json`. Without `--include=dev`, the build WILL FAIL on Render because `vite` won't be installed.

**Fix:** Update `render.yaml` buildCommand to:
```yaml
buildCommand: cd client && npm install --include=dev && npm run build && cd .. && npm install
```

Or alternatively, move Vite from `devDependencies` to `dependencies` in `client/package.json`.

### 2.3 Security Audit (Pre-Deploy Must-Fix)

| # | Issue | File | Status | Evidence |
|---|-------|------|--------|----------|
| 2.3.1 | Hardcoded JWT fallback | `lib/auth.js` | ✅ FIXED | Throws fatal error if `JWT_SECRET` unset |
| 2.3.2 | DB SSL `rejectUnauthorized` | `lib/db.js` | ✅ FIXED | Conditional: `true` in production, `false` in dev |
| 2.3.3 | Session cookie `secure` | `server.js` | ✅ FIXED | `secure: process.env.NODE_ENV === 'production'` |
| 2.3.4 | CORS `origin: true` | `server.js` | ✅ FIXED | Explicit whitelist callback |
| 2.3.5 | Missing security headers | `server.js` | ✅ FIXED | `helmet()` configured with CSP, HSTS, X-Frame, X-Content-Type |
| 2.3.6 | `x-powered-by` header | `server.js` | ✅ FIXED | `app.disable('x-powered-by')` present |
| 2.3.7 | Permissions-Policy overly broad | `server.js` | ✅ FIXED | `camera=(self), microphone=(self)` |
| 2.3.8 | Missing rate limiting on auth | `routes/auth.js` | ✅ FIXED | `distributedRateLimiter` + `rateLimits.strict` on auth endpoints |
| 2.3.9 | Missing input validation (jobs search) | `routes/jobs.js` | ⚠️ **OPEN** | No `express-validator` on `limit`, `offset`, `search`, `location` — DoS risk via large params |
| 2.3.10 | Missing CSRF protection | Multiple routes | ⚠️ **OPEN** | No `csurf` or double-submit cookie. Session-based auth without CSRF tokens |
| 2.3.11 | Password complexity too weak | `routes/auth.js` | ⚠️ **OPEN** | Only length check (8-128). No enforced complexity (uppercase, lowercase, number, special) |
| 2.3.12 | Missing `SameSite=Strict` for admin | `server.js` | ⚠️ **OPEN** | Currently `sameSite: 'lax'`. Admin routes should use `Strict` |

**Note:** Issues 2.3.9–2.3.12 are medium severity. They should be fixed before production launch but are not deployment blockers if the June 19 deadline is tight. **Flag for post-deploy sprint.**

### 2.4 E2E Test Execution

| # | Test Suite | File | Status | Notes |
|---|------------|------|--------|-------|
| 2.4.1 | Auth persistence | `e2e/auth-persistence.spec.ts` | ✅ PASS (last run) | `test-results/.last-run.json`: `status: "passed"` |
| 2.4.2 | Candidate flow | `e2e/candidate-flow.spec.ts` | ✅ PASS (last run) | Part of suite |
| 2.4.3 | Recruiter flow | `e2e/recruiter-flow.spec.ts` | ✅ PASS (last run) | Part of suite |
| 2.4.4 | Navigation flow | `e2e/navigation-flow.spec.ts` | ✅ PASS (last run) | Part of suite |
| 2.4.5 | Public pages | `e2e/public-pages.spec.ts` | ✅ PASS (last run) | Part of suite |
| 2.4.6 | Dark mode | `e2e/dark-mode.spec.ts` | ✅ PASS (last run) | Part of suite |
| 2.4.7 | Payment flow | `e2e/payment-flow.spec.ts` | ⚠️ **BLOCKED** | Requires Stripe live mode |
| 2.4.8 | Payment (legacy) | `e2e/payment.spec.ts` | ⚠️ **BLOCKED** | Requires Stripe live mode |
| 2.4.9 | E2E tests on THIS commit | Run `npx playwright test` against `cfbf5d9` | ⬜ **TODO** | Last run may have been on earlier commit |
| 2.4.10 | Root `package.json` test script | Add `"test": "npx playwright test"` | ⬜ **TODO** | Currently missing |

**Root `package.json` is missing a `test` script.** Add:
```json
"scripts": {
  "start": "node server.js",
  "build": "cd client && npm install --include=dev && npm run build",
  "test": "npx playwright test",
  "migrate": "node migrate.js",
  ...
}
```

---

## 3. Render Production Service Configuration

### 3.1 Service Definition (`render.yaml`)

```yaml
services:
  - type: web
    name: rekrutai-prod
    env: node
    branch: main
    buildCommand: cd client && npm install --include=dev && npm run build && cd .. && npm install
    startCommand: npm start
    healthCheckPath: /health
    plan: standard
    numInstances: 1
    autoDeploy: true
```

### 3.2 Required Fixes to `render.yaml`

| # | Fix | Current Value | Required Value | Impact |
|---|-----|---------------|----------------|--------|
| 3.2.1 | **Build command** | `cd client && npm install && npm run build && cd .. && npm install` | `cd client && npm install --include=dev && npm run build && cd .. && npm install` | **BUILD FAILURE** — Vite is a devDependency |
| 3.2.2 | Production DB plan | `standard` | `standard` | ✅ OK |
| 3.2.3 | Health check | `/health` | `/health` | ✅ OK |
| 3.2.4 | Auto-deploy | `true` | `true` | ✅ OK — push to main triggers deploy |

**Action:** Update `render.yaml` buildCommand before any push to `main`.

### 3.3 Environment Variables (`sync: false` — Must Be Set in Render Dashboard)

| Variable | Required | Status | Notes |
|----------|----------|--------|-------|
| `JWT_SECRET` | ✅ Required | ⚠️ **VERIFY** | Must be strong random string (≥32 chars). Code throws if missing. |
| `SESSION_SECRET` | ✅ Required | ⚠️ **VERIFY** | Must be strong random string (≥32 chars). Code throws if missing. |
| `ADMIN_USERNAME` | ✅ Required | ⚠️ **VERIFY** | Production admin username |
| `ADMIN_PASSWORD` | ✅ Required | ⚠️ **VERIFY** | Production admin password (hashed) |
| `STRIPE_SECRET_KEY` | ✅ Required | 🔴 **BLOCKER** | Must be **live key** (`sk_live_*`). Currently only test keys (`sk_test_*`) exist |
| `STRIPE_PUBLISHABLE_KEY` | ✅ Required | 🔴 **BLOCKER** | Must be **live key** (`pk_live_*`). Currently only test keys (`pk_test_*`) exist |
| `STRIPE_WEBHOOK_SECRET` | ✅ Required | ⚠️ **VERIFY** | Must match live webhook endpoint in Stripe Dashboard |
| `POLSIA_API_KEY` | ✅ Required | ⚠️ **VERIFY** | Primary AI proxy |
| `POLSIA_API_URL` | ✅ Required | ⚠️ **VERIFY** | `https://polsia.com/api/proxy/ai` |
| `OPENAI_API_KEY` | ⚠️ Recommended | ⚠️ **VERIFY** | Fallback AI provider |
| `OPENAI_BASE_URL` | ⚠️ Recommended | ⚠️ **VERIFY** | If using custom proxy |
| `NVIDIA_NIM_API_KEY` | ⚠️ Recommended | ⚠️ **VERIFY** | Fallback AI provider |
| `NIM_BASE_URL` | ⚠️ Recommended | ⚠️ **VERIFY** | `https://integrate.api.nvidia.com/v1` |
| `GROQ_API_KEY` | ⚠️ Recommended | ⚠️ **VERIFY** | Fast fallback AI provider |
| `CEREBRAS_API_KEY` | ⚠️ Optional | ⚠️ **VERIFY** | Enterprise fallback |
| `DEEPGRAM_API_KEY` | ⚠️ Recommended | ⚠️ **VERIFY** | Required for TTS/STT features |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | ⚠️ Recommended | ⚠️ **VERIFY** | Email notifications (6 templates, 4 auto-triggers) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ⚠️ Recommended | ⚠️ **VERIFY** | Social auth (Google OAuth) |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | ⚠️ Recommended | ⚠️ **VERIFY** | Social auth (LinkedIn OAuth) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | ⚠️ Optional | ⚠️ **VERIFY** | Cloudflare R2 storage for documents |
| `DATABASE_URL` | ✅ Auto | ✅ CONFIRMED | From `rekrutai-prod-db` (Render PostgreSQL) |
| `NODE_ENV` | ✅ Auto | ✅ CONFIRMED | Set to `production` by `render.yaml` |
| `PORT` | ✅ Auto | ✅ CONFIRMED | Set to `10000` by `render.yaml` |
| `REKRUT_AI_URL` / `APP_URL` / `FRONTEND_URL` / `BASE_URL` | ✅ Auto | ✅ CONFIRMED | `https://rekrutai.co` |
| `CORS_ORIGINS` | ✅ Auto | ✅ CONFIRMED | `https://rekrutai.co,https://www.rekrutai.co` |
| `FORCE_SSL_VERIFY` | ✅ Auto | ✅ CONFIRMED | `true` |

### 3.4 Service Plan Recommendation

| Environment | Plan | Reasoning |
|-------------|------|-----------|
| **Production** | `standard` | ✅ Configured. Supports custom domains, higher bandwidth, faster builds. Minimum for production traffic. |
| **Staging** | `starter` | ✅ Configured. Sufficient for QA testing. |
| **Dev** | `starter` | ✅ Configured. Sufficient for development. |

**Consideration:** If traffic is expected to spike at launch, consider upgrading to `pro` or enabling `numInstances: 2` with a load balancer. For now, `standard` with 1 instance is acceptable for initial launch.

---

## 4. Database Migration Plan

### 4.1 Migration Status

| Check | Status | Details |
|-------|--------|---------|
| Migration count | 52+ | Files `001` through `051` plus schema hardening scripts |
| New migrations since last prod deploy | ✅ **NONE** | All migrations are from May 16 or earlier. No new migrations in `fb1fdb3..cfbf5d9` |
| Migration syntax validation | ⬜ **TODO** | Run `node migrate.js --dry-run` or review SQL |
| Production DB backup | 🔴 **BLOCKER** | Manual snapshot MUST be taken in Render dashboard before deploy |
| Production DB connectivity | ✅ CONFIRMED | `rekrutai.co/api/jobs` returns live data — Neon PostgreSQL connection active |

### 4.2 Pre-Deploy Database Steps

| # | Step | Owner | Status |
|---|------|-------|--------|
| 4.2.1 | Take manual snapshot of `rekrutai-prod-db` | DO-001 | ⬜ **TODO** |
| 4.2.2 | Verify snapshot created successfully | DO-001 | ⬜ **TODO** |
| 4.2.3 | Run `node migrate.js --dry-run` on staging | BE-002 | ⬜ **TODO** |
| 4.2.4 | Confirm no new migrations since last prod deploy | DO-001 | ✅ **DONE** |
| 4.2.5 | Document snapshot ID for rollback reference | DO-001 | ⬜ **TODO** |

### 4.3 Rollback Database Steps (if needed)

| # | Step | Owner | ETA |
|---|------|-------|-----|
| 4.3.1 | Stop `rekrutai-prod` service | DO-001 | 1 min |
| 4.3.2 | Restore snapshot from pre-deploy backup | DO-001 | 5–10 min |
| 4.3.3 | Restart service | DO-001 | 1 min |
| 4.3.4 | Verify `/health` returns 200 | DO-001 | 2 min |

---

## 5. DNS / Domain Setup Plan

### 5.1 Current Domain Configuration

| Domain | Status | DNS Provider | Notes |
|--------|--------|--------------|-------|
| `rekrutai.co` | ✅ **ACTIVE** | Cloudflare | Production endpoint. Returning 200. |
| `www.rekrutai.co` | ⚠️ **VERIFY** | Cloudflare | Should redirect to `rekrutai.co` or serve same content |
| `rekrutai.onrender.com` | ❌ **SUSPENDED** | Render | Suspended by owner. Not the active endpoint. |

### 5.2 Domain Verification Steps

| # | Step | Command | Status |
|---|------|---------|--------|
| 5.2.1 | Verify `rekrutai.co` A/CNAME records | `dig rekrutai.co` | ⬜ **TODO** |
| 5.2.2 | Verify `www.rekrutai.co` redirect | `curl -I https://www.rekrutai.co` | ⬜ **TODO** |
| 5.2.3 | Verify HTTPS certificate valid | Browser DevTools → Security | ⬜ **TODO** |
| 5.2.4 | Verify `CORS_ORIGINS` includes `www.rekrutai.co` | `render.yaml` | ⚠️ **VERIFY** — Currently only `rekrutai.co` and `www.rekrutai.co` |

---

## 6. Stripe Live Mode Verification

### 6.1 Current Stripe Keys (Local / Repo)

```env
STRIPE_PUBLISHABLE_KEY=REDACTED_PK_TEST
STRIPE_SECRET_KEY=REDACTED_SK_TEST
STRIPE_WEBHOOK_SECRET=REDACTED_WHSEC_TEST
```

**All keys are TEST MODE.** No live keys (`sk_live_*`, `pk_live_*`) exist in the repository, `.env`, `.credentials.env`, or anywhere in the workspace.

### 6.2 Stripe Live Mode Checklist

| # | Step | Owner | Status |
|---|------|-------|--------|
| 6.2.1 | Generate live Stripe keys from Stripe Dashboard | Ranga (CEO) | 🔴 **NOT STARTED** |
| 6.2.2 | Set `STRIPE_SECRET_KEY` (live) in Render Dashboard → `rekrutai-prod` | DO-001 | ⬜ **TODO** |
| 6.2.3 | Set `STRIPE_PUBLISHABLE_KEY` (live) in Render Dashboard | DO-001 | ⬜ **TODO** |
| 6.2.4 | Create live webhook endpoint in Stripe Dashboard | Ranga / DO-001 | ⬜ **TODO** |
| 6.2.5 | Set `STRIPE_WEBHOOK_SECRET` (live) in Render Dashboard | DO-001 | ⬜ **TODO** |
| 6.2.6 | Verify webhook endpoint URL: `https://rekrutai.co/api/billing/webhook` | DO-001 | ⬜ **TODO** |
| 6.2.7 | Test payment flow with live keys (small $1 test) | Ranga / QA | ⬜ **TODO** |
| 6.2.8 | Update Stripe pricing/products in live mode | Ranga | ⬜ **TODO** |

### 6.3 Impact of Missing Live Stripe Keys

- ❌ **Zero revenue capability** — Customers cannot make real payments
- ❌ **Payment-flow E2E tests BLOCKED** — Cannot test checkout in production-like environment
- ❌ **Webhook handling untested in production** — Risk of payment failures going undetected
- ⚠️ **Test keys may accidentally leak to production** — If someone forgets to switch keys in dashboard

---

## 7. Deployment Steps (Execution Plan)

> ⚠️ **DO NOT EXECUTE UNTIL ALL BLOCKERS ARE RESOLVED**

### 7.1 Pre-Flight (Day Before Deploy)

| # | Step | Owner | Status |
|---|------|-------|--------|
| 7.1.1 | Fix `render.yaml` buildCommand (add `--include=dev`) | DO-001 | ⬜ **TODO** |
| 7.1.2 | Add `"test": "npx playwright test"` to root `package.json` | DO-001 | ⬜ **TODO** |
| 7.1.3 | Commit all fixes to `main` | DO-001 | ⬜ **TODO** |
| 7.1.4 | Tag release: `git tag -a v2.0.0-20260618 cfbf5d9` | DO-001 | ⬜ **TODO** |
| 7.1.5 | Push tag to origin: `git push origin --tags` | DO-001 | ⬜ **TODO** |
| 7.1.6 | Take production DB snapshot | DO-001 | ⬜ **TODO** |
| 7.1.7 | Verify all `sync: false` env vars in Render Dashboard | DO-001 / Ranga | ⬜ **TODO** |
| 7.1.8 | Confirm Stripe live keys in Render Dashboard | Ranga | 🔴 **BLOCKER** |
| 7.1.9 | Run full E2E suite against latest commit | QA / Suga | ⬜ **TODO** |
| 7.1.10 | Ranga approves Go/No-Go | Ranga | 🔴 **BLOCKER** |

### 7.2 Deploy Day (Execute in Sequence)

| # | Step | Command / Action | ETA | Owner |
|---|------|------------------|-----|-------|
| 7.2.1 | Push `main` to origin | `git push origin main` | 30s | DO-001 |
| 7.2.2 | Monitor Render build | `https://dashboard.render.com/web/srv-d69opaer433s73d6p570` | 3–5 min | DO-001 |
| 7.2.3 | Wait for health check | `curl -s https://rekrutai.co/health` | 1–2 min | DO-001 |
| 7.2.4 | Verify security headers | `curl -I https://rekrutai.co/` | 30s | DO-001 |
| 7.2.5 | Run smoke tests | See Section 8 | 15 min | QA / DO-001 |
| 7.2.6 | Monitor error logs | Render dashboard → Logs | Ongoing | DO-001 |

### 7.3 Build Timeline Estimate

| Phase | Duration | Notes |
|-------|----------|-------|
| Git push → Render webhook trigger | ~30s | Auto-deploy enabled |
| Build phase | ~3–5 min | Client build + server install |
| Deploy phase + health check | ~1–2 min | `/health` must return 200 |
| **Total** | **~5–8 min** | |

---

## 8. Post-Deploy Smoke Tests (Must Pass Within 15 Minutes)

### 8.1 Health & Availability

| # | Test | Expected Result | Status |
|---|------|-----------------|--------|
| 8.1.1 | `GET https://rekrutai.co/health` | `{"status":"ok","timestamp":"..."}` | ⬜ **TODO** |
| 8.1.2 | `GET https://rekrutai.co/api/health` | `{"status":"ok","timestamp":"..."}` | ⬜ **TODO** |
| 8.1.3 | `GET https://rekrutai.co/` | 200 OK, hero text visible | ⬜ **TODO** |
| 8.1.4 | `GET https://rekrutai.co/login` | 200 OK, login form visible | ⬜ **TODO** |
| 8.1.5 | `GET https://rekrutai.co/about` | 200 OK, about page loads | ⬜ **TODO** |

### 8.2 Security Headers Verification

| # | Header | Expected Value | Status |
|---|--------|----------------|--------|
| 8.2.1 | `content-security-policy` | Present (from `helmet`) | ⬜ **TODO** |
| 8.2.2 | `strict-transport-security` | Present, max-age=31536000 | ⬜ **TODO** |
| 8.2.3 | `x-content-type-options` | `nosniff` | ⬜ **TODO** |
| 8.2.4 | `x-frame-options` | `SAMEORIGIN` | ⬜ **TODO** |
| 8.2.5 | `x-powered-by` | **ABSENT** | ⬜ **TODO** |
| 8.2.6 | `permissions-policy` | `camera=(self), microphone=(self)` | ⬜ **TODO** |
| 8.2.7 | HTTPS redirect | `http://rekrutai.co/` → `https://rekrutai.co/` | ⬜ **TODO** |

### 8.3 Functional Smoke Tests

| # | Test | Steps | Expected Result | Status |
|---|------|-------|-----------------|--------|
| 8.3.1 | Homepage render | Load `/`, check hero, features, pricing, testimonials | All sections visible, no console errors | ⬜ **TODO** |
| 8.3.2 | Login flow | Use test credentials: `test_recruiter@rekrutai.co` / `Test123!` | Login succeeds, redirects to dashboard | ⬜ **TODO** |
| 8.3.3 | Candidate jobs page | Login as candidate, navigate to `/candidate/jobs` | Job listings load, search/filter work | ⬜ **TODO** |
| 8.3.4 | Recruiter dashboard | Login as recruiter, navigate to `/recruiter/dashboard` | Dashboard loads, analytics visible | ⬜ **TODO** |
| 8.3.5 | Recruiter candidates | Navigate to `/recruiter/candidates` | Candidate search loads, SQL query works | ⬜ **TODO** |
| 8.3.6 | Dark mode toggle | Click dark mode toggle on any page | Theme switches, persists on reload | ⬜ **TODO** |
| 8.3.7 | Mobile responsive | Emulate iPhone 14 in DevTools | Layout adapts, no horizontal scroll | ⬜ **TODO** |
| 8.3.8 | Stripe pricing page | Load `/pricing` | Free / Pro / Enterprise tiers visible | ⬜ **TODO** |
| 8.3.9 | API health | `GET /api/auth/me`, `GET /api/jobs` | Returns expected data | ⬜ **TODO** |

---

## 9. Rollback Procedure

### 9.1 Fast Rollback: Render Dashboard (1–2 minutes)

1. Go to [Render Dashboard](https://dashboard.render.com/web/srv-d69opaer433s73d6p570)
2. Click **"Manual Deploy"** → **"Deploy a specific commit"**
3. Select commit `fb1fdb3` (last known good production commit)
4. Wait for health check to pass
5. Verify `curl -s https://rekrutai.co/health` returns `{"status":"ok"}`

### 9.2 Git Revert Rollback (2–5 minutes)

```bash
# Revert to the last known good commit
git checkout main
git revert -m 1 cfbf5d9 --no-edit  # or revert the merge commit
git push origin main
# Render auto-deploys the reverted main
```

### 9.3 Database Rollback (if data corruption)

1. Render Dashboard → `rekrutai-prod-db` → **Snapshots**
2. Select pre-deploy snapshot (taken in step 7.1.6)
3. Click **Restore**
4. Wait for restore (5–10 minutes)
5. Restart `rekrutai-prod` service

### 9.4 Rollback Triggers

| Condition | Action | Owner | ETA |
|-----------|--------|-------|-----|
| `/health` returns non-200 for > 2 minutes | Immediate Render dashboard rollback | DO-001 | 1–2 min |
| 50%+ of smoke tests fail | Git revert + investigate | DO-001 + Suga (CTO) | 2–5 min |
| Database errors in logs | DB snapshot restore + code revert | DO-001 + BE-002 | 10–15 min |
| Stripe payment failures | Disable Stripe webhooks + investigate | DO-001 + Ranga (CEO) | 5–10 min |
| AI provider circuit breakers tripped | Reset via `/api/ai-health/reset` (admin) | Suga (CTO) | 2–5 min |

### 9.5 Communication Plan

| Event | Channel | Message |
|-------|---------|---------|
| Rollback initiated | `#deployments` (or equivalent) | `🚨 Rollback initiated — reverting to commit fb1fdb3. Reason: [X]. ETA: 2 min.` |
| Rollback complete | `#deployments` | `✅ Rollback complete. Production at fb1fdb3. Health: OK. Investigating root cause.` |
| All-clear | `#deployments` | `✅ Post-rollback verification complete. Issue ticket: [link].` |

---

## 10. Blockers & Gaps Summary

### 🔴 CRITICAL BLOCKERS (Must resolve before deploy)

| # | Blocker | Owner | Impact | ETA to Resolve |
|---|---------|-------|--------|----------------|
| **B1** | **Build command mismatch in `render.yaml`** | DO-001 | **Build WILL FAIL on Render** — Vite devDependencies not installed without `--include=dev` | 15 min |
| **B2** | **Stripe live keys do not exist** | Ranga (CEO) | **Zero revenue** — customers cannot make real payments | 1–2 days (requires Stripe account setup) |
| **B3** | **Production DB snapshot not taken** | DO-001 | **No safe rollback path** if data corruption occurs | 15 min |
| **B4** | **E2E tests not confirmed on latest commit** | QA / Suga | Risk of broken core flows in production | 2–4 hours |
| **B5** | **Ranga Go/No-Go approval** | Ranga (CEO) | Cannot proceed without CEO sign-off | 30 min (once blockers resolved) |

### 🟡 IMPORTANT WARNINGS (Should resolve before deploy)

| # | Warning | Owner | Impact | ETA to Resolve |
|---|---------|-------|--------|----------------|
| **W1** | Missing `test` script in root `package.json` | DO-001 | E2E tests not easily discoverable | 5 min |
| **W2** | Input validation missing on `routes/jobs.js` search params | BE-002 | DoS risk via large query strings | 2–4 hours |
| **W3** | CSRF protection missing | BE-002 | Session hijacking / CSRF attacks possible | 4–8 hours |
| **W4** | Password complexity only length check | BE-002 | Users can create weak passwords | 2–4 hours |
| **W5** | `www.rekrutai.co` redirect not verified | DO-001 | Potential SEO / UX issue | 15 min |
| **W6** | No release tags in git | DO-001 | Makes rollback harder, no version history | 5 min |
| **W7** | Largest JS chunk ~1.5MB | FE-001 | Slower initial page load, especially on mobile | 4–8 hours |
| **W8** | API key budget monitoring not configured | DO-001 | Unexpected $500+ API bill if traffic spikes | 2–4 hours |
| **W9** | Production Render subdomain (`rekrutai.onrender.com`) suspended | DO-001 | Potential confusion; verify correct service mapping | 15 min |

### 🟢 NON-BLOCKING (Can be fixed post-deploy)

| # | Item | Owner | Notes |
|---|------|-------|-------|
| **N1** | Missing `SameSite=Strict` for admin cookies | BE-002 | Currently `lax`. Admin routes should be stricter. |
| **N2** | Mobile project commented out in Playwright config | QA | Mobile E2E tests disabled due to memory constraints. Can run separately. |
| **N3** | `render.yaml` prod service plan is `standard` | DO-001 | Consider `pro` if traffic spikes expected. |
| **N4** | `numInstances: 1` | DO-001 | Consider 2 instances for redundancy post-launch. |

---

## 11. Environment Variable Mapping (Dev → Prod)

| Variable | Dev Value | Prod Value | Source | Notes |
|----------|-----------|------------|--------|-------|
| `NODE_ENV` | `development` | `production` | `render.yaml` | Auto-set |
| `PORT` | `3000` | `10000` | `render.yaml` | Auto-set |
| `DATABASE_URL` | Neon dev branch | `rekrutai-prod-db` | Render dashboard | Auto-generated |
| `REKRUT_AI_URL` | `https://rekrutai-dev.onrender.com` | `https://rekrutai.co` | `render.yaml` | Auto-set |
| `APP_URL` | `https://rekrutai-dev.onrender.com` | `https://rekrutai.co` | `render.yaml` | Auto-set |
| `FRONTEND_URL` | `https://rekrutai-dev.onrender.com` | `https://rekrutai.co` | `render.yaml` | Auto-set |
| `BASE_URL` | `https://rekrutai-dev.onrender.com` | `https://rekrutai.co` | `render.yaml` | Auto-set |
| `CORS_ORIGINS` | `https://rekrutai-dev.onrender.com` | `https://rekrutai.co,https://www.rekrutai.co` | `render.yaml` | Auto-set |
| `FORCE_SSL_VERIFY` | `false` | `true` | `render.yaml` | Auto-set |
| `JWT_SECRET` | `dev-jwt-secret-...` | **Strong random** | Render dashboard | `sync: false` — MUST verify |
| `SESSION_SECRET` | `dev-secret-...` | **Strong random** | Render dashboard | `sync: false` — MUST verify |
| `STRIPE_SECRET_KEY` | `sk_test_...` | `sk_live_...` | Render dashboard | **Ranga must provide** |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_...` | `pk_live_...` | Render dashboard | **Ranga must provide** |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (test) | `whsec_...` (live) | Render dashboard | Must match live webhook endpoint |
| `ADMIN_USERNAME` | `admin` | **Production value** | Render dashboard | `sync: false` — MUST verify |
| `ADMIN_PASSWORD` | `Test123!` | **Strong production password** | Render dashboard | `sync: false` — MUST verify |
| `POLSIA_API_KEY` | (empty) | **Production key** | Render dashboard | `sync: false` — MUST verify |
| `OPENAI_API_KEY` | (empty) | **Production key** | Render dashboard | `sync: false` — MUST verify |
| `NVIDIA_NIM_API_KEY` | (empty) | **Production key** | Render dashboard | `sync: false` — MUST verify |
| `GROQ_API_KEY` | (empty) | **Production key** | Render dashboard | `sync: false` — MUST verify |
| `DEEPGRAM_API_KEY` | (empty) | **Production key** | Render dashboard | `sync: false` — MUST verify |
| `SMTP_HOST` | `smtp.gmail.com` | **Production SMTP** | Render dashboard | `sync: false` — MUST verify |
| `GOOGLE_CLIENT_ID` | (empty) | **Production OAuth** | Render dashboard | `sync: false` — MUST verify |
| `LINKEDIN_CLIENT_ID` | (empty) | **Production OAuth** | Render dashboard | `sync: false` — MUST verify |

---

## 12. Go / No-Go Verdict

### 🚫 CURRENT VERDICT: **NO-GO**

**Primary reasons:**
1. **B1 — Build command mismatch:** `render.yaml` will fail to build on Render because Vite devDependencies won't be installed.
2. **B2 — Stripe live keys missing:** No live keys exist anywhere. Revenue capability is zero.
3. **B3 — Production DB snapshot not taken:** No safe rollback path.
4. **B4 — E2E tests not confirmed on latest commit:** Need to run against `cfbf5d9` before deploy.
5. **B5 — Ranga Go/No-Go pending:** CEO approval required for live mode and deployment.

### 📋 Path to Go

| Step | Owner | Estimated Time | Cumulative ETA |
|------|-------|----------------|----------------|
| Fix `render.yaml` buildCommand + add `test` script | DO-001 | 15 min | 15 min |
| Run E2E tests against `cfbf5d9` | QA / Suga | 2–4 hours | 2–4 hours |
| Ranga generates Stripe live keys | Ranga | 1–2 days | 1–2 days |
| Set all `sync: false` env vars in Render Dashboard | DO-001 + Ranga | 2–4 hours | 1–2 days |
| Take production DB snapshot | DO-001 | 15 min | 1–2 days |
| Ranga Go/No-Go approval | Ranga | 30 min | 1–2 days |
| **Execute deploy** | DO-001 | 5–8 min | **1–2 days total** |

### ⚠️ Realistic Timeline Assessment

With the June 19 deadline (11 days away), we have sufficient time IF:
- Ranga prioritizes Stripe live key generation within the next 2–3 days
- E2E tests pass on the first run (no major regressions)
- No new security vulnerabilities are discovered during pre-deploy verification

**If Stripe live keys take > 3 days to obtain, we risk cutting it close.**

---

## 13. Appendix: Useful Commands

```bash
# Check Render deploy status (production)
curl -s https://rekrutai.co/health | jq .

# Check staging
curl -s https://rekrutai-dev.onrender.com/health | jq .

# Check security headers
curl -I https://rekrutai.co/

# Run E2E tests locally
cd /root/.openclaw/workspace/Rekrut_AI_v2
npx playwright test

# Run specific test
npx playwright test auth-persistence.spec.ts

# Build client
cd client && npm install --include=dev && npm run build

# Check bundle size
ls -lah client/dist/assets/

# Check server syntax
node -c server.js
for f in routes/*.js; do node -c "$f"; done

# DB health check
psql "$DATABASE_URL" -c "SELECT NOW(), count(*) FROM users;"

# Check git status
git status
git log --oneline -5

# Check diff since last production deploy
git log --oneline fb1fdb3..HEAD
```

---

## 14. Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-06-08 | v1.0 | DO-001 | Initial checklist based on current state analysis |

---

*This checklist is a living document. Update it as blockers are resolved and new issues are discovered.*
