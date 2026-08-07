# Rekrut AI — Production Deployment Runbook

**Owner:** DO-001 (DevOps Lead) | **Last Updated:** 2026-06-09 | **Review Cadence:** Per-Deploy
**Target Deployment:** June 19, 2026
**Pipeline:** staging → main → production (manual gated)

---

## Purpose

This runbook provides exact, copy-pasteable commands for promoting Rekrut AI from staging to production. Every step includes the command, expected output, and rollback trigger. **No improvisation. Follow the steps.**

## Prerequisites

Before opening this runbook, confirm:
- [ ] All CRITICAL blockers from `docs/PROD_DEPLOY_CHECKLIST.md` are resolved
- [ ] CEO (Ranga) has given Go/No-Go approval
- [ ] Production database snapshot has been taken
- [ ] All production secrets are set in Render Dashboard
- [ ] You have write access to `main` (or branch protection is temporarily lifted for merge)
- [ ] You have access to Render Dashboard (https://dashboard.render.com/)
- [ ] You have access to GitHub repository (https://github.com/sumanthrangausa-06/Rekrut_AI_v2)

---

## Phase 0: Pre-Flight Checks (Do Not Skip)

### 0.1 Verify Your Local Environment

```bash
# Navigate to the repository
cd /root/.openclaw/workspace/Rekrut_AI_v2

# Verify you are on a clean dev branch
git status
# Expected: "On branch dev", "nothing to commit, working tree clean"

# Verify remotes are reachable
git fetch origin
# Expected: no errors, fetches complete
```

### 0.2 Verify Branch States

```bash
# Check how far ahead/behind each branch is
echo "=== dev vs staging ==="
git log --oneline staging..dev | wc -l
echo "dev is ahead of staging by $(git log --oneline staging..dev | wc -l) commits"

echo "=== staging vs main ==="
git log --oneline main..staging | wc -l
echo "staging is ahead of main by $(git log --oneline main..staging | wc -l) commits"

echo "=== main vs dev ==="
git log --oneline dev..main | wc -l
echo "main is ahead of dev by $(git log --oneline dev..main | wc -l) commits"
```

**Expected (as of 2026-06-09):**
- `dev` ahead of `staging`: ~19 commits
- `staging` ahead of `main`: ~22 commits
- `main` ahead of `dev`: 2 unique commits (E2E robust selector improvements)

### 0.3 Verify Staging Health

```bash
# Health endpoint
curl -s https://rekrutai-staging.onrender.com/health
echo ""
# Expected: {"status":"ok","timestamp":"..."}

# Root page
curl -s -o /dev/null -w "%{http_code}" https://rekrutai-staging.onrender.com/
# Expected: 200

# API health alias
curl -s https://rekrutai-staging.onrender.com/api/health
echo ""
# Expected: {"status":"ok","timestamp":"..."}
```

### 0.4 Verify Production Current State

```bash
# Health endpoint
curl -s https://rekrutai.co/health
echo ""
# Expected: {"status":"ok","timestamp":"..."} (prod is running but on old code)

# Root page
curl -s -o /dev/null -w "%{http_code}" https://rekrutai.co/
# Expected: 200
```

### 0.5 Verify Render Dashboard Access

1. Open https://dashboard.render.com/
2. Confirm you see:
   - `rekrutai-prod` (Node web service, plan: standard, branch: main)
   - `rekrutai-prod-db` (PostgreSQL, plan: standard)
3. Click `rekrutai-prod` → Environment
4. Confirm all `sync: false` env vars are populated (see checklist Section 1.4)

---

## Phase 1: Merge dev → staging

### 1.1 Create Pull Request

```bash
# Ensure dev is up to date
git checkout dev
git pull origin dev

# Push any local commits (if applicable)
git push origin dev
```

**In GitHub:**
1. Open https://github.com/sumanthrangausa-06/Rekrut_AI_v2/pulls
2. Click **New Pull Request**
3. Base: `staging` ← Compare: `dev`
4. Title: `Deploy: 20260609 — dev → staging (render.yaml fix, mobile fixes, E2E suite)`
5. Body template:

```markdown
## What's Deploying
- Fix: `render.yaml` prod service (add `healthCheckPath`, `envVars`, `NODE_ENV`)
- Mobile UI fixes (viewport height, sheet component, filter button)
- EU AI Act compliance dashboard and endpoints
- E2E test suite expansion (20+ specs, robust selectors)
- Admin CSRF double-submit security
- Security: remove `.admin-credentials` plaintext file
- Migration prefix deduplication (003, 005, 045)

## Commits
$(git log --oneline staging..dev)

## Staging Validation
- [ ] Build passed
- [ ] Smoke tests passed
- [ ] API health check passed
- [ ] E2E suite passed (chromium)

## Rollback Plan
- Previous staging commit: $(git rev-parse staging)
- Rollback: `git revert -m 1 <merge_commit>` or Render dashboard manual deploy
```

### 1.2 CI Must Pass

Wait for GitHub Actions to complete on the PR. Required checks:
- ✅ Build Check
- ✅ Security Audit
- ✅ E2E Tests
- ✅ Health Check (dev)

**If CI fails:**
1. Do NOT merge.
2. Fix the issue on `dev`.
3. Push fix, wait for CI re-run.
4. Repeat until green.

### 1.3 Merge dev → staging

```bash
# Once PR is approved and CI is green, merge via GitHub (merge commit preferred)
# Then locally verify:
git checkout staging
git pull origin staging

git log --oneline -3
# Expected: merge commit at HEAD, followed by latest dev commits
```

### 1.4 Verify Staging Auto-Deploy

Staging auto-deploys on merge. Monitor:

```bash
# Wait 2-3 minutes for build
sleep 120

# Verify health
curl -s https://rekrutai-staging.onrender.com/health
# Expected: {"status":"ok",...}

# Verify build artifacts are fresh
curl -s https://rekrutai-staging.onrender.com/ | grep -o 'index-.*\.js'
# Should match the latest build hash in client/dist/index.html
```

### 1.5 Run Staging Smoke Tests

```bash
# Run E2E against staging
BASE_URL=https://rekrutai-staging.onrender.com npx playwright test --project=chromium

# Or use the sequential runner (recommended to avoid SIGKILL)
BASE_URL=https://rekrutai-staging.onrender.com ./e2e/run-e2e-suite.sh
```

**If smoke tests fail:**
1. Do NOT proceed to production.
2. Fix the issue on `dev` or `staging`.
3. Repeat Phase 1.

---

## Phase 2: Merge staging → main

### 2.1 Create Pull Request

```bash
# Ensure staging is up to date
git checkout staging
git pull origin staging
```

**In GitHub:**
1. Open https://github.com/sumanthrangausa-06/Rekrut_AI_v2/pulls
2. Click **New Pull Request**
3. Base: `main` ← Compare: `staging`
4. Title: `Deploy: 20260619 — staging → main (Production v2.0.0)`
5. Body template:

```markdown
## What's Deploying
Production deployment of Rekrut AI v2.0.0.

## Commits
$(git log --oneline main..staging)

## Staging Validation
- [ ] Build passed
- [ ] Smoke tests passed
- [ ] API health check passed
- [ ] E2E suite passed (chromium)
- [ ] No P0 bugs in staging

## Rollback Plan
- Previous production commit: $(git rev-parse main)
- Rollback: Render dashboard → Manual Deploy → Deploy specific commit
- Rollback time: ~3-5 minutes
- Database: Snapshot taken before deploy (verify in Render dashboard)

## Go/No-Go
- [ ] CEO (Ranga) approved
- [ ] CTO (Suga) approved
- [ ] QA (Sunny) approved
- [ ] All production secrets set in Render dashboard
- [ ] Database snapshot taken
```

### 2.2 Require Approvals

- Assign reviewers: Ranga (CEO), Suga (CTO), Sunny (QA)
- Require at least **1 approval** from Ranga or Suga before merging
- Verify all CI checks pass on the PR

### 2.3 Merge staging → main

```bash
# Once PR is approved and CI is green, merge via GitHub
git checkout main
git pull origin main

git log --oneline -5
# Expected: merge commit at HEAD, followed by staging commits
```

**Important:** `main` has `autoDeploy: false` in Render. Merging does **not** trigger production deployment. This is the gated deploy step.

### 2.4 Tag the Release

```bash
# On main, after merge
git checkout main
git pull origin main

# Create annotated tag
git tag -a "v2.0.0-20260619" -m "Production release v2.0.0

Features:
- EU AI Act compliance dashboard
- Mobile UI overhaul (responsive, h-dvh, sheet components)
- E2E test suite (20+ specs, Playwright)
- Admin security hardening (CSRF, env-only credentials)
- Migration automation on startup

Infrastructure:
- Render health checks configured
- CI/CD pipeline active
- Production secrets ready

Deployed by: $(git config user.name)
Approved by: Ranga (CEO), Suga (CTO)"

# Push tag
git push origin "v2.0.0-20260619"
```

---

## Phase 3: Production Deployment (Manual Gated)

### 3.1 Trigger GitHub Deploy Workflow (Optional but Recommended)

```bash
# This runs the CI gate again and provides a paper trail
# In GitHub Actions → Deploy to Production → Run workflow
# Type "deploy-to-prod" in the confirmation field
# Branch: main
```

### 3.2 Manual Deploy via Render Dashboard (Primary Method)

1. Open https://dashboard.render.com/
2. Navigate to **Blueprint: Rekrut AI v2** → `rekrutai-prod`
3. Click **Manual Deploy** → **Deploy latest commit**
4. Wait for build to start (~30 seconds)
5. Monitor build logs for:
   - `cd client && npm install --include=dev && npm run build && cd .. && npm install` ✅
   - `npm run migrate && npm start` ✅
   - No `NODE_ENV` warnings ✅
   - No missing env var errors ✅

### 3.3 Alternative: Render Deploy Hook (If Configured)

```bash
# If a deploy hook is configured in Render dashboard:
curl -X POST "$RENDER_DEPLOY_HOOK_URL"
# Expected: HTTP 200, JSON response with deployment status
```

### 3.4 Monitor Build Progress

```bash
# Poll Render build status via API (if you have Render API key)
# Or manually watch the dashboard
# Typical build time: 3-5 minutes
```

**If build fails:**
1. Check Render logs for the error.
2. Common causes:
   - Missing env var (`sync: false` not set in dashboard)
   - Node.js version mismatch (check `package.json` engines vs Render runtime)
   - Memory limit exceeded during client build (client build is memory-intensive)
   - Database connection failure (check `DATABASE_URL`)
3. Fix the issue, commit to `dev`, and restart from Phase 1.

---

## Phase 4: Post-Deploy Verification (Mandatory)

### 4.1 Immediate Health Checks (0–2 minutes post-deploy)

```bash
#!/bin/bash
# save as verify-prod.sh and run

set -e

BASE="https://rekrutai.co"

echo "=== Phase 4.1: Immediate Health Checks ==="

# 4.1.1 Health endpoint
response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health")
if [ "$response" = "200" ]; then
  echo "✅ 4.1.1 /health → 200"
else
  echo "❌ 4.1.1 /health → $response (expected 200)"
  exit 1
fi

# 4.1.2 Health body
body=$(curl -s "$BASE/health")
if echo "$body" | grep -q '"status":"ok"'; then
  echo "✅ 4.1.2 /health body contains status:ok"
else
  echo "❌ 4.1.2 /health body invalid: $body"
  exit 1
fi

# 4.1.3 API health alias
response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/health")
if [ "$response" = "200" ]; then
  echo "✅ 4.1.3 /api/health → 200"
else
  echo "❌ 4.1.3 /api/health → $response"
  exit 1
fi

# 4.1.4 Root page
response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/")
if [ "$response" = "200" ]; then
  echo "✅ 4.1.4 / → 200"
else
  echo "❌ 4.1.4 / → $response"
  exit 1
fi

# 4.1.5 Login page
response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/login")
if [ "$response" = "200" ]; then
  echo "✅ 4.1.5 /login → 200"
else
  echo "❌ 4.1.5 /login → $response"
  exit 1
fi

# 4.1.6 Pricing page
response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/pricing")
if [ "$response" = "200" ]; then
  echo "✅ 4.1.6 /pricing → 200"
else
  echo "❌ 4.1.6 /pricing → $response"
  exit 1
fi

echo ""
echo "✅ Phase 4.1 complete. All health checks passed."
```

### 4.2 Smoke Tests (2–15 minutes post-deploy)

```bash
#!/bin/bash
# 4.2.1 Security headers check
echo "=== Phase 4.2: Security Headers ==="
headers=$(curl -s -I "$BASE/")

if echo "$headers" | grep -qi "X-Frame-Options"; then
  echo "✅ X-Frame-Options present"
else
  echo "❌ X-Frame-Options missing"
fi

if echo "$headers" | grep -qi "Strict-Transport-Security"; then
  echo "✅ HSTS present"
else
  echo "❌ HSTS missing"
fi

if echo "$headers" | grep -qi "Content-Security-Policy"; then
  echo "✅ CSP present"
else
  echo "❌ CSP missing"
fi

if echo "$headers" | grep -qi "X-Content-Type-Options"; then
  echo "✅ X-Content-Type-Options present"
else
  echo "❌ X-Content-Type-Options missing"
fi

if echo "$headers" | grep -i "x-powered-by"; then
  echo "❌ x-powered-by should be absent"
else
  echo "✅ x-powered-by absent"
fi

# 4.2.2 HTTPS redirect
echo ""
echo "=== HTTPS Redirect ==="
redirect=$(curl -s -o /dev/null -w "%{http_code}" "http://rekrutai.co/")
if [ "$redirect" = "301" ] || [ "$redirect" = "302" ] || [ "$redirect" = "308" ]; then
  echo "✅ HTTP → HTTPS redirect active ($redirect)"
else
  echo "⚠️ HTTP → HTTPS redirect may not be active ($redirect)"
fi

# 4.2.3 CORS rejection
echo ""
echo "=== CORS Rejection ==="
cors_response=$(curl -s -o /dev/null -w "%{http_code}" -H "Origin: https://evil.com" "$BASE/api/jobs")
if [ "$cors_response" = "403" ] || [ "$cors_response" = "401" ]; then
  echo "✅ CORS rejects unknown origin ($cors_response)"
else
  echo "⚠️ CORS response for evil.com: $cors_response (expected 403/401)"
fi

echo ""
echo "✅ Phase 4.2 complete."
```

### 4.3 Functional Smoke Tests (Manual)

Perform these manually in a browser:

1. **Homepage:** Load `https://rekrutai.co/`
   - Hero section visible
   - Features grid loads
   - Pricing tiers visible
   - No console errors (F12 → Console)

2. **Login:** `https://rekrutai.co/login`
   - Login form renders
   - Try: `test_recruiter@rekrutai.co` / `Test123!`
   - Dashboard loads after login

3. **Candidate Flow:**
   - Login as candidate
   - Navigate to `/candidate/jobs`
   - Job listings load, search/filter work

4. **Recruiter Flow:**
   - Login as recruiter
   - Navigate to `/recruiter/dashboard`
   - Analytics visible, no 500 errors

5. **Admin Panel:** `https://rekrutai.co/admin`
   - Login with admin credentials
   - Metrics, activity logs, AI health visible

6. **Dark Mode:** Toggle dark mode on any page
   - Theme switches
   - Persists on reload

7. **Mobile:** DevTools → iPhone 14
   - Layout adapts
   - No horizontal scroll
   - Hamburger menu works

### 4.4 API Smoke Tests (15–30 minutes post-deploy)

```bash
#!/bin/bash
# 4.4.1 Public API
echo "=== Phase 4.4: API Smoke Tests ==="

# Jobs API (public)
response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/jobs")
if [ "$response" = "200" ]; then
  echo "✅ GET /api/jobs → 200"
else
  echo "❌ GET /api/jobs → $response"
fi

# Health API
response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/health")
if [ "$response" = "200" ]; then
  echo "✅ GET /api/health → 200"
else
  echo "❌ GET /api/health → $response"
fi

# AI Health (admin - will 401 without auth, which is expected)
response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/ai-health")
if [ "$response" = "401" ] || [ "$response" = "403" ]; then
  echo "✅ GET /api/ai-health → $response (protected, as expected)"
else
  echo "⚠️ GET /api/ai-health → $response (expected 401/403)"
fi

# Admin metrics (admin - will 401 without auth)
response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/admin/metrics")
if [ "$response" = "401" ] || [ "$response" = "403" ]; then
  echo "✅ GET /api/admin/metrics → $response (protected, as expected)"
else
  echo "⚠️ GET /api/admin/metrics → $response (expected 401/403)"
fi

echo ""
echo "✅ Phase 4.4 complete."
```

### 4.5 E2E Test Suite on Production (30–60 minutes post-deploy)

```bash
# Run against production (use production test credentials)
# WARNING: This tests against live data. Use test accounts only.

BASE_URL=https://rekrutai.co npx playwright test --project=chromium

# Or sequential runner (recommended)
BASE_URL=https://rekrutai.co ./e2e/run-e2e-suite.sh
```

**If E2E fails:**
- `dark-mode.spec.ts` has a known SIGKILL issue. If it fails, verify manually and document.
- All other tests should pass. If they fail, investigate before declaring deployment successful.

---

## Phase 5: Go/No-Go Decision

### 5.1 Decision Criteria

| Criterion | Pass | Fail | Action if Fail |
|-----------|------|------|----------------|
| `/health` returns 200 for 5+ minutes | ✅ | ❌ | Rollback immediately |
| No 5xx errors in Render logs | ✅ | ❌ | Investigate, rollback if > 10 errors/min |
| Smoke tests pass (manual) | ✅ | ❌ | Fix or rollback |
| E2E tests pass (≥ 90%) | ✅ | ❌ | Investigate flakes, rollback if real bugs |
| Security headers present | ✅ | ❌ | Fix in code, redeploy |
| Database migration clean | ✅ | ❌ | DB snapshot restore + rollback |

### 5.2 Decision Record

```markdown
# Deployment Decision Record

Date: 2026-06-19
Deployer: [Your name]
Commit: [main HEAD commit hash]
Tag: v2.0.0-20260619

## Go/No-Go
- [ ] /health stable for 5 minutes
- [ ] Zero 5xx errors in logs
- [ ] Smoke tests passed
- [ ] E2E tests passed (X/Y specs)
- [ ] Security headers verified
- [ ] DB migration clean

## Decision
[ ] GO — Production is stable. Announce launch.
[ ] NO-GO — Rollback initiated. Reason: [________]

## Signatures
- Ranga (CEO): _____________
- Suga (CTO): _____________
- Sunny (QA): _____________
```

---

## Phase 6: Rollback (If Needed)

### 6.1 Trigger Conditions

Rollback immediately if ANY of the following occur:
- `/health` returns non-200 for > 2 minutes
- 50%+ of smoke tests fail
- Database errors in logs (connection pool exhaustion, migration failures)
- Stripe payment webhooks failing
- Memory usage spikes to > 90% consistently
- Error rate > 5% (measured via `/api/admin/metrics`)

### 6.2 Rollback Commands

#### Option A: Render Dashboard (Fastest — 1–3 minutes)

```bash
# No terminal commands needed. Use Render Dashboard:
# 1. https://dashboard.render.com/ → rekrutai-prod
# 2. Click "Manual Deploy" → "Deploy a specific commit"
# 3. Select the pre-deploy commit (e.g., 7f56e99)
# 4. Wait 2-3 minutes for deploy
# 5. Verify:
curl -s https://rekrutai.co/health
# Expected: {"status":"ok",...}
```

#### Option B: Git Revert + Redeploy (3–5 minutes)

```bash
# Identify the bad merge commit
git checkout main
git log --oneline -5
# The bad commit is the merge commit at HEAD

# Revert the merge commit
# -m 1 means "revert to parent 1" (the main branch side)
git revert -m 1 <bad_merge_commit_hash> --no-edit

# Push the revert
git push origin main

# Since autoDeploy is false, manually deploy via Render Dashboard
# Or if autoDeploy were true, Render would auto-deploy the revert
```

#### Option C: Database Rollback (15–30 minutes)

```bash
# Only if migrations caused data corruption

# 1. Render Dashboard → rekrutai-prod-db → Snapshots
# 2. Select snapshot from before deployment
# 3. Click "Restore"
# 4. Wait 15-30 minutes for restore

# 5. Verify database connectivity:
psql "$DATABASE_URL" -c "SELECT NOW();"

# 6. If needed, also revert the code:
git checkout main
git revert -m 1 <bad_merge_commit> --no-edit
git push origin main
```

### 6.3 Post-Rollback Verification

```bash
#!/bin/bash
# verify-rollback.sh

echo "=== Post-Rollback Verification ==="

for i in {1..10}; do
  response=$(curl -s -o /dev/null -w "%{http_code}" https://rekrutai.co/health)
  if [ "$response" = "200" ]; then
    echo "✅ Rollback verified. /health → 200 (attempt $i)"
    exit 0
  fi
  echo "Attempt $i/10: HTTP $response, retrying in 10s..."
  sleep 10
done

echo "❌ Rollback verification failed. /health never returned 200."
exit 1
```

### 6.4 Communication Template

```markdown
🚨 **ROLLBACK INITIATED** 🚨

- **Reason:** [e.g., /health failing, database errors, 50% smoke tests failing]
- **Bad commit:** [hash]
- **Restored to:** [hash]
- **Rollback method:** [Render dashboard / git revert / DB restore]
- **Time to restore:** [X minutes]
- **Current status:** [e.g., /health → 200, smoke tests passing]
- **Next steps:** [Investigation ticket / fix in progress / ETA]

cc: @Ranga @Suga @Sunny @Kimi
```

---

## Phase 7: Post-Launch Monitoring (First 24 Hours)

### 7.1 Checklist (Every 2 Hours for First 8 Hours)

```bash
#!/bin/bash
# monitoring-check.sh — run every 2 hours

BASE="https://rekrutai.co"

echo "=== $(date) ==="

# Health
curl -s "$BASE/health"
echo ""

# Error rate (if you have admin access)
# curl -s "$BASE/api/admin/metrics" | jq '.errorRate'

# Render status (if you have API access)
# render status --service rekrutai-prod

echo "=== End ==="
```

### 7.2 Watch For

| Symptom | Threshold | Action |
|---------|-----------|--------|
| `/health` fails | > 2 failures in 5 minutes | Rollback |
| 5xx errors | > 5 per minute | Investigate logs, rollback if persists |
| Memory usage | > 85% consistently | Scale plan or investigate leak |
| Database connections | > 20 active | Check for connection leaks |
| AI provider timeouts | > 30% of requests | Check circuit breaker status |
| Stripe webhook failures | Any failures | Check Stripe dashboard, verify secret |
| Email bounces | > 5% | Check SMTP credentials, rate limits |

### 7.3 External Monitoring Setup (Post-Launch)

Set up within 24 hours of launch:

```bash
# UptimeRobot (free tier)
# Monitor 1: https://rekrutai.co/health (5 min interval)
# Monitor 2: https://rekrutai.co/ (5 min interval)
# Monitor 3: https://rekrutai.co/login (10 min interval)
# Alert: Slack webhook + email

# Sentry (free tier: 5K errors/month)
# Create project: rekrutai-prod
# Add DSN to env vars: SENTRY_DSN=https://... sentry.io/...
# Install: npm install @sentry/node @sentry/react
# Initialize in server.js and client entry point
```

---

## Appendix A: One-Command Reference

### Quick Status Check

```bash
#!/bin/bash
# Quick status check of all environments

echo "=== Dev ==="
curl -s https://rekrutai-dev.onrender.com/health
echo ""

echo "=== Staging ==="
curl -s https://rekrutai-staging.onrender.com/health
echo ""

echo "=== Production ==="
curl -s https://rekrutai.co/health
echo ""
```

### Force Redeploy (Emergency)

```bash
# If you need to force a redeploy without changing code:
# Render Dashboard → rekrutai-prod → Manual Deploy → Deploy latest commit
# Or trigger a trivial commit:
git checkout main
git commit --allow-empty -m "chore: trigger redeploy"
git push origin main
```

### View Production Logs

```bash
# Render Dashboard → rekrutai-prod → Logs
# Or via Render CLI (if installed):
render logs --service rekrutai-prod --tail
```

---

## Appendix B: Environment Variable Quick Reference

### Generate Secure Secrets

```bash
# JWT_SECRET (256-bit)
openssl rand -hex 32
# Example output: a3f7c2e1b4d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f

# SESSION_SECRET (256-bit)
openssl rand -hex 32

# ADMIN_PASSWORD (if not bcrypt hashed)
# Set a strong password, e.g., 16+ chars with mixed case, numbers, symbols
# If auth.js expects bcrypt hash, generate:
node -e "console.log(require('bcrypt').hashSync('YourStrongPassword123!', 10))"
```

### Verify Env Var in Render

```bash
# SSH into Render shell (if available)
# Or check via Render Dashboard → Environment
# Or query the application (if you have admin access):
curl -s https://rekrutai.co/api/admin/metrics | jq '.envCheck'
```

---

## Appendix C: Common Issues & Solutions

### Issue: Build fails with "Out of memory"

**Cause:** Client build (Vite) is memory-intensive.
**Solution:**
1. Upgrade Render plan from `standard` to `standard plus` (more RAM).
2. Or split build into two steps: build client locally, commit `dist/`, and skip client build on Render.

### Issue: "DATABASE_URL not set"

**Cause:** `fromDatabase` in `render.yaml` failed, or env var is not set in dashboard.
**Solution:**
1. Check Render dashboard → `rekrutai-prod` → Environment → `DATABASE_URL`.
2. If using Neon, manually set `DATABASE_URL` to Neon connection string and remove `fromDatabase` block.

### Issue: "JWT_SECRET must be set"

**Cause:** `sync: false` env var not populated in dashboard.
**Solution:**
1. Go to Render dashboard → `rekrutai-prod` → Environment.
2. Add `JWT_SECRET` with a 256-bit random string.
3. Click "Save Changes".
4. Redeploy.

### Issue: Stripe webhooks failing with 400

**Cause:** `STRIPE_WEBHOOK_SECRET` is wrong or endpoint URL is wrong.
**Solution:**
1. In Stripe dashboard, create webhook endpoint: `https://rekrutai.co/api/billing/webhook`.
2. Copy the webhook signing secret.
3. Paste it into Render dashboard as `STRIPE_WEBHOOK_SECRET`.
4. Redeploy.

### Issue: CORS errors on API requests

**Cause:** `CORS_ORIGINS` doesn't include the requesting origin.
**Solution:**
1. Check `CORS_ORIGINS` in Render dashboard.
2. Add missing origin (e.g., `https://www.rekrutai.co`).
3. Redeploy.

### Issue: Health check fails with 404

**Cause:** `healthCheckPath` is wrong or route is missing.
**Solution:**
1. Verify `render.yaml` has `healthCheckPath: /health`.
2. Verify `server.js` has `app.get('/health', ...)`.
3. The fix was committed in `989600a` — ensure it's on `main`.

---

## Appendix D: Contact Escalation

| Level | Condition | Contact | Response Time |
|-------|-----------|---------|---------------|
| L1 | Build failure, env var issue | DO-001 (DevOps) | 15 minutes |
| L2 | Application bug, API failure | Suga (CTO) | 30 minutes |
| L3 | Payment failure, data corruption | Ranga (CEO) | 1 hour |
| L4 | Security incident, breach | Ranga (CEO) + Suga (CTO) | Immediate |
| L5 | Complete outage | All hands | Immediate |

---

**Runbook Version:** 2.0.0  
**Last Verified:** 2026-06-09  
**Next Review:** 2026-06-19 (post-launch)

**Deploy safe. Verify twice. Rollback fast.**
