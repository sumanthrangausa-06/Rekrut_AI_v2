# Rekrut AI — Production Deployment Checklist

**Owner:** DO-001 (DevOps Lead) | **Last Updated:** 2026-06-09 | **Review Cadence:** Per-Deploy
**Target Deployment:** June 19, 2026
**Deadline:** 10 days remaining

---

## Purpose

Production-ready deployment checklist for Rekrut AI (HireLoop). This document standardizes the `staging` → `main` (production) promotion pipeline on Render. **Do not deploy without completing every section.**

## Pipeline Overview

```
[dev] ──→ [staging] ──→ [production/main]
   auto-deploy    auto-deploy    manual gated
```

| Environment | Branch | Render Service | Auto-Deploy | Health Check | Plan | Status |
|-------------|--------|----------------|-------------|--------------|------|--------|
| Development | `dev` | `rekrutai-dev` | ✅ Yes | `/health` | starter | ✅ Healthy |
| Staging | `staging` | `rekrutai-staging` | ✅ Yes | `/health` | starter | ✅ Healthy |
| Production | `main` | `rekrutai-prod` | ❌ **Manual** | `/health` | standard | ⚠️ Running, needs env vars |

**Current Staging Health:**
```bash
$ curl -s https://rekrutai-staging.onrender.com/health
{"status":"ok","timestamp":"2026-06-08T17:04:49.175Z"}
```
✅ Staging is responding correctly.

**Current Production Health:**
```bash
$ curl -s https://rekrutai.co/health
{"status":"ok","timestamp":"2026-06-08T17:05:18.063Z"}
```
⚠️ Prod is running but **not on latest code** (main is 19 commits behind dev).

---

## 1. PRE-DEPLOY CHECKS

> **Time estimate:** 15–20 minutes  
> **Owner:** Deploying Engineer (DO-001 / Suga)

### 1.1 Repository State

| # | Check | Command / Action | Status | Notes |
|---|-------|------------------|--------|-------|
| 1.1.1 | `git status` on `dev` is clean | `git status` on `dev` | ✅ **PASS** | No uncommitted changes. |
| 1.1.2 | `git status` on `staging` is clean | `git status` on `staging` | ✅ **PASS** | Staging is clean. |
| 1.1.3 | `dev` → `staging` merge analysis | `git log staging..dev --oneline` | ✅ **PASS** | 19 commits ahead. Clean merge predicted. |
| 1.1.4 | `staging` → `main` merge analysis | `git log main..staging --oneline` | ✅ **PASS** | 22 commits ahead. **0 conflicts predicted.** |
| 1.1.5 | `main` has unique E2E commits to preserve | `git log dev..main --oneline` | ⚠️ **NOTE** | 2 unique commits (`414f5de`, `d4e9cb0`) with E2E robust selectors. Must be preserved in merge. |
| 1.1.6 | Syntax check server | `node -c server.js` | ✅ **PASS** | No syntax errors. |
| 1.1.7 | Syntax check all routes | `for f in routes/*.js; do node -c "$f"; done` | ⬜ **TODO** | Run before deploy. |
| 1.1.8 | `render.yaml` valid | Render YAML syntax check | ✅ **PASS** | Fixed 2026-06-09: added missing `envVars`, `healthCheckPath`, `NODE_ENV`. |
| 1.1.9 | Tag release | `git tag -a v2.0.0-20260619` | ⬜ **PENDING** | Tag after successful merge. |

**Current Branch State:**
```
main:    7f56e99 (5 commits ahead of dev, 2 unique E2E improvements)
dev:     989600a (22 commits ahead of main, 19 ahead of staging)
staging: 88e53f6 (3 commits ahead of main)
```

**Merge Readiness:**
- Dry-run merge of `dev` into `main` completed with **0 conflicts**.
- All overlapping files (`routes/admin.js`, `e2e/*.spec.ts`, `.env.example`) auto-merged cleanly.
- See `merge-conflict-analysis.md` for full details.

### 1.2 Build Verification

| # | Check | Expected Result | Status | Owner |
|---|-------|---------------|--------|-------|
| 1.2.1 | Clean client build | `cd client && npm ci && npm run build` → Exit 0 | ⬜ **TODO** | DO-001 |
| 1.2.2 | Build artifacts committed | Dist files match `client/src/` | ✅ **PASS** | Latest dist committed in `dev`. |
| 1.2.3 | Root `npm ci` passes | `npm ci` in workspace root | ✅ **PASS** | — |
| 1.2.4 | TypeScript errors | `cd client && npx tsc --noEmit` | ⬜ **TODO** | BE-002 |

### 1.3 Security Audit (Pre-Deploy Must-Fix)

| # | Check | File | Status | Notes |
|---|-------|------|--------|-------|
| 1.3.1 | `x-powered-by` disabled | `server.js` | ✅ **FIXED** | `app.disable('x-powered-by')` present. |
| 1.3.2 | Helmet security headers | `server.js` | ✅ **FIXED** | CSP, HSTS, frame protection present. |
| 1.3.3 | Permissions-Policy restricted | `server.js` | ✅ **FIXED** | `camera=(self), microphone=(self)` — no wildcards. |
| 1.3.4 | CORS whitelist | `server.js` | ✅ **FIXED** | Explicit callback, rejects unknown origins. |
| 1.3.5 | Secure session cookies | `server.js` | ✅ **FIXED** | `secure: true` in production, `httpOnly`, `sameSite: lax`. |
| 1.3.6 | `npm audit --audit-level high` | CI + local | ✅ **PASS** | `vite`/`rollup` path traversal fixed in recent commit. |
| 1.3.7 | CSP `connectSrc` cleanup | `server.js` | ✅ **FIXED** | Already conditional on `NODE_ENV` — dev URL only in development. |
| 1.3.8 | Admin route brute-force protection | `routes/admin.js` | ✅ **FIXED** | Distributed rate limiter via PostgreSQL: 15-min window, 5 max attempts on `/api/admin/login`. |
| 1.3.9 | File upload security | `routes/documents.js` | ✅ **PASS** | Multer: 50MB limit, mimetype filter (PDF/images/Word), memory storage, auth required. Virus scan = post-launch enhancement. |

### 1.4 Environment Variables & Secrets

> **CRITICAL:** Render `rekrutai-prod` service has `autoDeploy: false`. All `sync: false` env vars must be set manually in the [Render Dashboard](https://dashboard.render.com/) **before** the first deployment.

> **CRITICAL:** `render.yaml` was fixed on 2026-06-09 to add missing `envVars`, `healthCheckPath: /health`, and `NODE_ENV: production`. This fix must be on `main` before deploying.

#### Tier 1 — Security (BLOCKING — must be set before deploy)

| Variable | Status | Notes |
|----------|--------|-------|
| `JWT_SECRET` | ❌ **MUST SET** | Generate 256-bit random string. **DO NOT** reuse dev value. |
| `SESSION_SECRET` | ❌ **MUST SET** | Generate 256-bit random string. **DO NOT** reuse dev value. |
| `ADMIN_USERNAME` | ❌ **MUST SET** | Production admin login. |
| `ADMIN_PASSWORD` | ❌ **MUST SET** | Production admin password (bcrypt hashed if auth.js expects hash, otherwise plain — verify first). |

#### Tier 2 — Payment (BLOCKING if paid features enabled)

| Variable | Status | Notes |
|----------|--------|-------|
| `STRIPE_SECRET_KEY` | ❌ **MUST SET — LIVE KEY** | Must start with `sk_live_`. Current `.env` has test keys (`sk_test_`). **CEO approval required.** |
| `STRIPE_WEBHOOK_SECRET` | ❌ **MUST SET — LIVE** | Create webhook endpoint `https://rekrutai.co/api/billing/webhook` in Stripe dashboard first. |
| `STRIPE_PUBLISHABLE_KEY` (client) | ❌ **MUST SET — LIVE** | Client build embeds `pk_test_` currently. Must switch to `pk_live_` before production build. |

#### Tier 3 — AI Providers (BLOCKING if AI features enabled)

| Variable | Status | Notes |
|----------|--------|-------|
| `POLSIA_API_KEY` | ❌ **MUST SET** | Primary AI proxy. |
| `POLSIA_API_URL` | ✅ Set in render.yaml | `https://polsia.com/api/proxy/ai` |
| `OPENAI_API_KEY` | ❌ **MUST SET** | Fallback provider. Verify quota/billing limit. |
| `NVIDIA_NIM_API_KEY` | ❌ **MUST SET** | Fallback provider. |
| `GROQ_API_KEY` | ❌ **MUST SET** | Fast fallback. |
| `CEREBRAS_API_KEY` | ❌ **MUST SET** | Enterprise fallback. |
| `DEEPGRAM_API_KEY` | ❌ **MUST SET** | TTS/STT audio features. |
| `NIM_*` model vars (15+) | ❌ **MUST SET** | Model configuration variables (see `render.yaml`). |
| `NIM_TTS_BASE_URL` etc. (5+) | ❌ **MUST SET** | TTS service endpoints. |
| `OPENAI_DAILY_TOKEN_BUDGET` | ⚠️ **RECOMMENDED** | Defaults to 100K in code. Set explicitly to control costs. |

#### Tier 4 — Cloud Storage (R2)

| Variable | Status | Notes |
|----------|--------|-------|
| `R2_ACCESS_KEY_ID` | ❌ **MUST SET** | Cloudflare R2. |
| `R2_SECRET_ACCESS_KEY` | ❌ **MUST SET** | R2 secret. |
| `R2_BUCKET_NAME` | ❌ **MUST SET** | Bucket name. |
| `R2_ENDPOINT` | ❌ **MUST SET** | S3-compatible endpoint. |
| `R2_PUBLIC_URL` | ❌ **MUST SET** | Public CDN URL. Verify CORS policy allows `rekrutai.co`. |

#### Tier 5 — Email/SMTP (BLOCKING if email notifications enabled)

| Variable | Status | Notes |
|----------|--------|-------|
| `EMAIL_HOST` / `SMTP_HOST` | ❌ **MUST SET** | Gmail, SendGrid, Mailgun, etc. |
| `EMAIL_PORT` / `SMTP_PORT` | ❌ **MUST SET** | Typically 587 (TLS) or 465 (SSL). |
| `EMAIL_USER` / `SMTP_USER` | ❌ **MUST SET** | SMTP username. |
| `EMAIL_PASS` / `SMTP_PASS` | ❌ **MUST SET** | App-specific password (not Gmail login password). |
| `EMAIL_FROM_ADDRESS` / `SMTP_FROM` | ❌ **MUST SET** | `noreply@rekrutai.co` or similar. |
| `EMAIL_FROM_NAME` | ❌ **MUST SET** | "Rekrut AI" |
| `EMAIL_RATE_LIMIT` / `EMAIL_RATE_LIMIT_HOUR` | ⚠️ **RECOMMENDED** | Prevent abuse. |
| `EMAIL_RETRY_ATTEMPTS` / `EMAIL_RETRY_DELAY` | ⚠️ **RECOMMENDED** | Resilience. |
| `SMTP_SECURE` | ❌ **MUST SET** | `true` for production (TLS). |

#### Tier 6 — OAuth (BLOCKING if social login enabled)

| Variable | Status | Notes |
|----------|--------|-------|
| `GOOGLE_CLIENT_ID` | ❌ **MUST SET** | Google Cloud Console → OAuth 2.0 credentials. |
| `GOOGLE_CLIENT_SECRET` | ❌ **MUST SET** | Rotate if previously used for dev. |
| `GOOGLE_REDIRECT_URI` | ✅ Set in render.yaml | `https://rekrutai.co/api/auth/google/callback` — **must also be registered in Google Cloud Console.** |
| `LINKEDIN_CLIENT_ID` | ❌ **MUST SET** | LinkedIn Developer Portal. |
| `LINKEDIN_CLIENT_SECRET` | ❌ **MUST SET** | Rotate if previously used for dev. |
| `LINKEDIN_REDIRECT_URI` | ✅ Set in render.yaml | `https://rekrutai.co/api/auth/linkedin/callback` — **must also be registered in LinkedIn Developer Portal.** |

#### Tier 7 — Render-Auto-Set (No action needed)

| Variable | Status | Notes |
|----------|--------|-------|
| `NODE_ENV` | ✅ **FIXED** | `production` (render.yaml, fixed 2026-06-09) |
| `PORT` | ✅ | `10000` (render.yaml) |
| `DATABASE_URL` | ✅ | Auto-wired from `rekrutai-prod-db` (if using Render PostgreSQL) |
| `REKRUT_AI_URL` | ✅ | `https://rekrutai.co` |
| `APP_URL` | ✅ | `https://rekrutai.co` |
| `FRONTEND_URL` | ✅ | `https://rekrutai.co` |
| `BASE_URL` | ✅ | `https://rekrutai.co` |
| `CORS_ORIGINS` | ✅ | `https://rekrutai.co,https://www.rekrutai.co` |
| `FORCE_SSL_VERIFY` | ✅ | `true` |

> ⚠️ **DATABASE INFRASTRUCTURE QUESTION:** The current `.env` uses **Neon PostgreSQL** (`ep-calm-field-aipg6g97-pooler...`), but `render.yaml` defines `rekrutai-prod-db` as a **Render PostgreSQL** service. If production uses Neon instead of Render's DB, the `DATABASE_URL` in `render.yaml` will be incorrect. **Action:** Confirm production DB provider and either (a) update `render.yaml` to use `fromDatabase: rekrutai-prod-db` with Render PostgreSQL, or (b) set `DATABASE_URL` manually in Render dashboard pointing to Neon, and remove the `fromDatabase` block.

---

## 2. Database Migration Steps

### 2.1 Pre-Migration Checklist

| # | Step | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 2.1.1 | **Take production DB snapshot** | ⬜ **TODO** | DO-001 | Render dashboard → `rekrutai-prod-db` → Snapshots → Create snapshot. **Do this before any migration.** |
| 2.1.2 | Confirm production DB connection | `psql "$DATABASE_URL" -c "SELECT NOW();"` | ⬜ **TODO** | DO-001 | Verify connectivity from local or Render shell. |
| 2.1.3 | List pending migrations | Compare `_migrations` table vs `/migrations/` folder | ⬜ **TODO** | DO-001 | 59+ `.js` files + 2 `.sql` files in repo. |
| 2.1.4 | Verify migration syntax | `node migrate.js --dry-run` (if supported) or manual review | ⬜ **TODO** | BE-002 | `migrate.js` uses `BEGIN/COMMIT/ROLLBACK`. |
| 2.1.5 | Verify `pgvector` extension | `CREATE EXTENSION IF NOT EXISTS vector;` | ⬜ **TODO** | DO-001 | Required for AI matching features. Neon supports this. |

### 2.2 Migration Execution

```bash
# Via Render Dashboard → Shell for rekrutai-prod (or run locally with prod DATABASE_URL)
# 1. Connect to production DB shell
# 2. Run migrations
node migrate.js

# 3. Verify all tables exist
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"
# Expected: ~105 tables

# 4. Verify migrations tracking
psql "$DATABASE_URL" -c "SELECT * FROM _migrations ORDER BY applied_at DESC;"

# 5. Verify pgvector
psql "$DATABASE_URL" -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

### 2.3 Post-Migration Verification

| # | Check | Expected Result | Status |
|---|-------|-----------------|--------|
| 2.3.1 | Core tables exist | `users`, `jobs`, `interviews`, `interview_questions`, `agent_data` | ⬜ **TODO** |
| 2.3.2 | Feature tables exist | `omniscore`, `trustscore`, `payroll`, `compliance`, `onboarding`, `matching`, etc. | ⬜ **TODO** |
| 2.3.3 | Seed data loaded | `notification_templates` > 0 rows | ⬜ **TODO** |
| 2.3.4 | Foreign key constraints | `company_id` references valid | ⬜ **TODO** |
| 2.3.5 | Session table | `user_sessions` auto-created by `connect-pg-simple` | ⬜ **TODO** |

---

## 3. SSL / Certificate Verification

| # | Step | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 3.1 | Custom domain DNS configured | ⬜ **TODO** | DO-001 | `rekrutai.co` A/ALIAS record must point to Render's load balancer. Verify in Render dashboard → Custom Domain. |
| 3.2 | `www` redirect configured | ⬜ **TODO** | DO-001 | Ensure `www.rekrutai.co` → `rekrutai.co` (or vice versa, but be consistent). |
| 3.3 | Render SSL auto-provisioning | ✅ **Automatic** | — | Render provisions Let's Encrypt automatically once DNS resolves. |
| 3.4 | Verify SSL after deploy | `curl -I https://rekrutai.co` | ⬜ **TODO** | DO-001 | Valid certificate, no warnings. |
| 3.5 | HTTP → HTTPS redirect | `curl -I http://rekrutai.co/` | ⬜ **TODO** | DO-001 | Must return 301/302 to HTTPS. |
| 3.6 | HSTS header present | `curl -I https://rekrutai.co` | ⬜ **TODO** | DO-001 | `Strict-Transport-Security` header present (helmet configured with `maxAge: 31536000`). |

### 3.1 Domain Security Checklist

| Service | Action Required | Status |
|---------|-----------------|--------|
| Google OAuth | Add `https://rekrutai.co/api/auth/google/callback` to authorized redirect URIs | ❌ **MUST DO** |
| LinkedIn OAuth | Add `https://rekrutai.co/api/auth/linkedin/callback` to authorized redirect URIs | ❌ **MUST DO** |
| Stripe Webhooks | Create endpoint `https://rekrutai.co/api/billing/webhook` with events: `checkout.session.completed`, `invoice.payment_failed`, `customer.subscription.deleted`, etc. | ❌ **MUST DO** |
| Stripe Checkout URLs | Update success/cancel URLs in Stripe checkout creation code to `https://rekrutai.co/...` | ❌ **MUST DO** |

---

## 4. Staging → Main Promotion Steps

### 4.1 Promotion Flow

```
feature/* → dev → staging → main (production)
```

### 4.2 Step-by-Step Promotion

| # | Step | Details | Status | Owner |
|---|------|---------|--------|-------|
| 4.2.1 | **Fix render.yaml prod service** | Add `healthCheckPath`, `envVars`, `NODE_ENV` | ✅ **DONE** | DO-001 | Committed to `dev` as `989600a`. |
| 4.2.2 | Open PR: `dev` → `staging` | Include all latest e2e + mobile fixes + render.yaml fix | ⬜ **PENDING** | DO-001 |
| 4.2.3 | CI passes on `dev`→`staging` PR | Build, audit, E2E (chromium), health check | ⬜ **PENDING** | CI/CD |
| 4.2.4 | Merge `dev` → `staging` | Render auto-deploys to `https://rekrutai-staging.onrender.com` | ⬜ **PENDING** | DO-001 |
| 4.2.5 | Staging smoke tests | Run all E2E against `rekrutai-staging.onrender.com` | ⬜ **PENDING** | QA-001 |
| 4.2.6 | Open PR: `staging` → `main` | Require 1 approval. Include CI/CD workflows. | ⬜ **PENDING** | DO-001 |
| 4.2.7 | CI passes on `staging`→`main` PR | Build, audit, E2E, health check | ⬜ **PENDING** | CI/CD |
| 4.2.8 | Merge `staging` → `main` | **Does NOT auto-deploy** (autoDeploy: false). | ⬜ **PENDING** | DO-001 + CEO |
| 4.2.9 | Tag release | `git tag -a v2.0.0-20260619` | ⬜ **PENDING** | DO-001 |
| 4.2.10 | Manual deploy via Render Dashboard | Click "Manual Deploy" → "Deploy latest commit" | ⬜ **PENDING** | DO-001 |

### 4.3 Branch Protection (Must verify before promotion)

| Branch | Rule | Status |
|--------|------|--------|
| `main` | Require PR before merging | ⬜ **VERIFY** |
| `main` | Require 1 approval | ⬜ **VERIFY** |
| `main` | Require status checks: Build Check, Security Audit, E2E Tests | ⬜ **VERIFY** |
| `main` | Dismiss stale PR approvals | ⬜ **VERIFY** |
| `main` | Require branches to be up to date | ⬜ **VERIFY** |
| `main` | Allow force pushes: ❌ Disabled | ⬜ **VERIFY** |
| `main` | Allow deletions: ❌ Disabled | ⬜ **VERIFY** |
| `staging` | Require PR before merging | ⬜ **VERIFY** |
| `staging` | Require status checks: Build Check, Security Audit, E2E Tests | ⬜ **VERIFY** |
| `staging` | Allow force pushes: ❌ Disabled | ⬜ **VERIFY** |
| `dev` | Require PR before merging | ⬜ **VERIFY** |
| `dev` | Require status checks: Build Check, Security Audit | ⬜ **VERIFY** |
| `dev` | Allow force pushes: ❌ Disabled | ⬜ **VERIFY** |

> **CRITICAL:** If branch protection is not enabled, direct pushes to `main` could bypass CI/CD gates. Verify in GitHub Settings → Branches.

---

## 5. Rollback Plan

### 5.1 Rollback Triggers

| Condition | Severity | Action | Owner |
|-----------|----------|--------|-------|
| `/health` returns non-200 for > 2 minutes | 🔴 **CRITICAL** | Immediate Render dashboard rollback | DO-001 |
| 50%+ of smoke tests fail | 🔴 **CRITICAL** | Git revert + Render dashboard rollback | DO-001 + CEO |
| Database errors in logs | 🔴 **CRITICAL** | DB snapshot restore + code revert | DO-001 + BE-002 |
| Stripe payment failures | 🔴 **CRITICAL** | Disable Stripe webhooks + investigate | DO-001 + CEO |
| AI provider circuit breakers tripped | 🟡 **MEDIUM** | Reset via `/api/ai-health/reset` (admin) | CTO |
| E2E test suite fails on prod | 🟡 **MEDIUM** | Investigate before rolling back (may be test flake) | QA-001 |

### 5.2 Rollback Procedures

#### Option A: Render Dashboard (Fastest — 1–3 minutes)

1. Go to [Render Dashboard](https://dashboard.render.com/) → `rekrutai-prod`
2. Click **"Manual Deploy"** → **"Deploy a specific commit"**
3. Select the last known good commit (`7f56e99` or the pre-deploy commit)
4. Wait for health check to pass (~2–3 minutes)
5. Verify: `curl https://rekrutai.co/health` → `200 OK`

#### Option B: Git Revert + Redeploy (3–5 minutes)

```bash
git checkout main
git revert -m 1 <bad_merge_commit> --no-edit
git push origin main
# Render auto-deploys if enabled; otherwise manual deploy via dashboard
```

#### Option C: Database Rollback (if migration caused corruption)

1. Render Dashboard → `rekrutai-prod-db` → **Snapshots**
2. Select snapshot from before deployment
3. Click **Restore**
4. Restore time: ~15–30 minutes

> **Note:** If no new migrations were run, DB rollback is not needed. Always snapshot before migrating.

### 5.3 Communication Plan

| Event | Channel | Message Template |
|-------|---------|-----------------|
| Rollback initiated | `#deployments` (Slack/Discord) | `🚨 Rollback initiated — reverting to commit [X]. Reason: [Y]. ETA: 2 min.` |
| Rollback complete | `#deployments` | `✅ Rollback complete. Production at [commit]. Health: OK. Investigating root cause.` |
| All-clear | `#deployments` | `✅ Post-rollback verification complete. Issue ticket: [link].` |

### 5.4 Rollback Time Estimates

| Step | Time |
|------|------|
| Detect failure | 1–2 minutes (health check polling) |
| Trigger rollback | 2 minutes (dashboard navigation) |
| Render deploys previous commit | 3–5 minutes |
| Verify rollback | 1 minute |
| **Total** | **7–10 minutes** |

---

## 6. Post-Deployment Verification Steps

### 6.1 Immediate Health Checks (within 2 minutes of deploy)

| # | Endpoint | Expected Result | Status |
|---|----------|-----------------|--------|
| 6.1.1 | `GET https://rekrutai.co/health` | `{"status":"ok","timestamp":"..."}` | ⬜ **TODO** |
| 6.1.2 | `GET https://rekrutai.co/api/health` | `{"status":"ok","timestamp":"..."}` | ⬜ **TODO** |
| 6.1.3 | `GET https://rekrutai.co/` | `200 OK`, React SPA loads, hero visible | ⬜ **TODO** |
| 6.1.4 | `GET https://rekrutai.co/login` | `200 OK`, login form renders | ⬜ **TODO** |
| 6.1.5 | `GET https://rekrutai.co/pricing` | `200 OK`, pricing tiers visible | ⬜ **TODO** |
| 6.1.6 | `GET https://rekrutai.co/about` | `200 OK`, about page loads | ⬜ **TODO** |

### 6.2 Functional Smoke Tests (within 15 minutes of deploy)

| # | Test | Steps | Expected Result | Status |
|---|------|-------|-----------------|--------|
| 6.2.1 | Homepage render | Load `/`, check hero, features, pricing, testimonials | All sections visible, no console errors | ⬜ **TODO** |
| 6.2.2 | Login flow | Use production test credentials | Login succeeds, redirects to dashboard | ⬜ **TODO** |
| 6.2.3 | Candidate jobs page | Login as candidate, navigate to `/candidate/jobs` | Job listings load, search/filter work | ⬜ **TODO** |
| 6.2.4 | Recruiter dashboard | Login as recruiter, navigate to `/recruiter/dashboard` | Dashboard loads, analytics visible | ⬜ **TODO** |
| 6.2.5 | Recruiter candidates | Navigate to `/recruiter/candidates` | Candidate search loads, SQL query works | ⬜ **TODO** |
| 6.2.6 | Dark mode toggle | Click dark mode toggle on any page | Theme switches, persists on reload | ⬜ **TODO** |
| 6.2.7 | Mobile responsive | Emulate iPhone 14 in DevTools | Layout adapts, no horizontal scroll | ⬜ **TODO** |
| 6.2.8 | Stripe pricing page | Load `/pricing` | Free / Pro / Enterprise tiers visible | ⬜ **TODO** |
| 6.2.9 | Registration | Create a new test account | Account created, welcome email sent (if email configured) | ⬜ **TODO** |
| 6.2.10 | Admin panel | Login with admin credentials at `/admin` | Admin dashboard loads, metrics visible | ⬜ **TODO** |

### 6.3 API Smoke Tests

| # | Endpoint | Auth | Expected Result | Status |
|---|----------|------|-----------------|--------|
| 6.3.1 | `GET /api/auth/me` | Session cookie | Returns current user object | ⬜ **TODO** |
| 6.3.2 | `GET /api/jobs` | Public | Returns job listings | ⬜ **TODO** |
| 6.3.3 | `GET /api/recruiter/candidates` | Recruiter session | Returns candidates | ⬜ **TODO** |
| 6.3.4 | `POST /api/ai-health/verify` | Admin | Runs AI provider verification | ⬜ **TODO** |
| 6.3.5 | `GET /api/admin/metrics` | Admin | Returns request metrics | ⬜ **TODO** |
| 6.3.6 | `GET /api/ai-health` | Admin | Returns provider circuit breaker status | ⬜ **TODO** |

### 6.4 Security Smoke Tests

| # | Test | Tool / Command | Expected Result | Status |
|---|------|---------------|-----------------|--------|
| 6.4.1 | Security headers | `curl -I https://rekrutai.co/` | `X-Frame-Options`, `X-Content-Type-Options`, `HSTS`, `CSP` present | ⬜ **TODO** |
| 6.4.2 | `x-powered-by` absent | `curl -I https://rekrutai.co/\| grep -i powered` | No match | ⬜ **TODO** |
| 6.4.3 | HTTPS enforcement | `curl -I http://rekrutai.co/` | Redirects to HTTPS | ⬜ **TODO** |
| 6.4.4 | CORS rejection | `curl -H "Origin: https://evil.com" https://rekrutai.co/api/jobs` | `403` or CORS error | ⬜ **TODO** |
| 6.4.5 | CSRF protection | POST to `/api/auth/logout` without CSRF token | `403` (if CSRF enforced) | ⬜ **TODO** |
| 6.4.6 | JWT expiration | Use expired token | `401` Unauthorized | ⬜ **TODO** |
| 6.4.7 | Page load time | DevTools Network tab | < 500ms static assets, < 1.5s full page | ⬜ **TODO** |
| 6.4.8 | Lighthouse score | Chrome DevTools Lighthouse | Performance > 85, Accessibility > 85, SEO > 90, Best Practices > 90 | ⬜ **TODO** |

### 6.5 E2E Test Suite on Production (Run within 1 hour of deploy)

```bash
# Run E2E tests against production (with live credentials)
BASE_URL=https://rekrutai.co npx playwright test --project=chromium
```

| Spec File | Status | Notes |
|-----------|--------|-------|
| `auth-persistence.spec.ts` | ⬜ **TODO** | 8 tests — auth, token, jobs browse, mobile responsive, settings |
| `candidate-critical-flow.spec.ts` | ⬜ **TODO** | Candidate jobs, profile, applications |
| `recruiter-critical-flow.spec.ts` | ⬜ **TODO** | Recruiter dashboard, candidates, job posting |
| `payment-flow.spec.ts` | ⬜ **TODO** | Stripe checkout flow — **use test mode or skip in live mode** |
| `public-pages.spec.ts` | ⬜ **TODO** | Login, register, pricing, blog, home |
| `navigation-flow.spec.ts` | ⬜ **TODO** | Visitor, candidate, recruiter navigation |
| `dark-mode.spec.ts` | ⬜ **TODO** | Known flaky — browser SIGKILL. If fails, confirm it's infrastructure, not app logic. |
| `admin-critical-flow.spec.ts` | ⬜ **TODO** | Admin login, metrics, activity logs — requires admin credentials |
| `candidate-profile-flow.spec.ts` | ⬜ **TODO** | Profile edit, document upload |
| `recruiter-job-posting-flow.spec.ts` | ⬜ **TODO** | Create job, edit job, view applicants |

> **Note:** `dark-mode.spec.ts` has a known SIGKILL/browser crash issue. If it fails on production, verify manually that dark mode works, and document the exception. Do not block deployment solely on this test if the failure is confirmed to be infrastructure-related.

---

## 7. Monitoring and Alerting Setup

### 7.1 Implemented Monitoring (Built-in)

| Endpoint | Access | Purpose | Status |
|----------|--------|---------|--------|
| `GET /health` | Public | Basic liveness | ✅ Implemented |
| `GET /api/health` | Public | API health alias | ✅ Implemented |
| `GET /api/admin/metrics` | Admin | Request counts, latency, error rates | ✅ Implemented |
| `GET /api/admin/routes` | Admin | 351-endpoint route monitoring | ✅ Implemented |
| `GET /api/admin/modules` | Admin | Business metrics dashboard | ✅ Implemented |
| `GET /api/admin/activity` | Admin | Real-time + historical event logging | ✅ Implemented |
| `GET /api/ai-health` | Admin | AI provider circuit breaker status | ✅ Implemented |
| `GET /api/ai-health/usage` | Admin | Token usage breakdown | ✅ Implemented |
| `GET /api/ai-health/budget` | Admin | Budget predictions | ✅ Implemented |
| `GET /api/ai-health/models` | Admin | Available model list | ✅ Implemented |
| `GET /api/ai-health/failover-stats` | Admin | Failover statistics | ✅ Implemented |
| `GET /api/ai-health/predictions` | Admin | Usage predictions | ✅ Implemented |
| `GET /api/ai-health/daily-breakdown` | Admin | Daily token usage | ✅ Implemented |

### 7.2 Missing Monitoring (Post-Launch Must-Have)

| # | Tool | Purpose | Cost | Timeline | Status |
|---|------|---------|------|----------|--------|
| 7.2.1 | **UptimeRobot** (or Pingdom / Better Uptime) | External uptime monitoring for `https://rekrutai.co/health` | Free tier (50 monitors) | **Before launch** | ❌ **NOT SET UP** |
| 7.2.2 | **Sentry** | Error tracking (React frontend + Node.js backend) | Free tier (5K errors/month) | Within 1 week of launch | ❌ **NOT SET UP** |
| 7.2.3 | **Log aggregation** | Render logs are ephemeral (~7 days). Forward to Datadog / Papertrail / Splunk. | Variable | Within 2 weeks | ❌ **NOT SET UP** |
| 7.2.4 | **Database monitoring** | Slow query alerts, connection pool monitoring | Neon dashboard + custom | Within 2 weeks | ❌ **NOT SET UP** |
| 7.2.5 | **SSL expiry monitoring** | Render auto-renews, but external alert is good practice | Free (UptimeRobot can check) | Before launch | ❌ **NOT SET UP** |

### 7.3 Recommended UptimeRobot Setup

```
Monitor 1: HTTPS → https://rekrutai.co/health
  - Interval: 5 minutes
  - Alert contact: Slack webhook + email
  - Expected response: HTTP 200, body contains "status":"ok"

Monitor 2: HTTPS → https://rekrutai.co/ (homepage)
  - Interval: 5 minutes
  - Alert contact: same

Monitor 3: HTTPS → https://rekrutai.co/login
  - Interval: 10 minutes
```

---

## 8. CI/CD Pipeline Status

### 8.1 Workflows Summary

| Workflow | File | Trigger | Status |
|----------|------|---------|--------|
| **CI** | `.github/workflows/ci.yml` | PR to `dev`/`staging`/`main`, push to `dev`/`staging` | ✅ Present in `dev`/`staging`/`main` |
| **Deploy** | `.github/workflows/deploy.yml` | `workflow_dispatch` on `main` only | ✅ Present in `dev`/`staging`/`main` |

### 8.2 CI Jobs

| Job | Purpose | Blocks Merge? | Status |
|-----|---------|---------------|--------|
| Build Check | `npm run build --prefix client` | ✅ Yes | ✅ Implemented |
| Security Audit | `npm audit --audit-level high` | ✅ Yes | ✅ Implemented |
| E2E Tests | `npx playwright test --project=chromium` | ✅ Yes | ✅ Implemented |
| Health Check | `curl https://rekrutai-dev.onrender.com/health` | ⚠️ Warns only | ✅ Implemented |

### 8.3 Deploy Workflow Steps

| Step | Details | Status |
|------|---------|--------|
| Confirmation gate | Must type `deploy-to-prod` | ✅ Implemented |
| Branch gate | Must be on `main` | ✅ Implemented |
| CI re-run | All CI jobs run again | ✅ Implemented (uses `workflow_call`) |
| Environment | `environment: production` for GitHub approval rules | ✅ Implemented |
| Post-deploy health | Polls `/health` for 10 attempts (2.5 min) | ✅ Implemented |

> **Note:** The deploy workflow does **not** auto-deploy to Render. It only provides a gated CI check and post-deploy health verification. The actual Render deployment is triggered manually via the Render Dashboard (or CLI/hook if configured).

---

## 9. Known Blockers & Missing Pieces

### 🔴 CRITICAL Blockers (Must Resolve Before Deploy)

| ID | Blocker | Severity | Owner | Action Required | ETA |
|----|---------|----------|-------|-----------------|-----|
| B1 | **Production secrets not set in Render** | 🔴 **CRITICAL** | DO-001 + Suga | Set all `sync: false` env vars in Render dashboard (JWT, SESSION, ADMIN, STRIPE, AI keys, Email, OAuth). | June 10–11 |
| B2 | **Stripe live keys not configured** | 🔴 **CRITICAL** | CEO (Ranga) | Replace `sk_test_` with `sk_live_` in production env. Create live webhook endpoint. **CEO approval required.** | June 11 |
| B3 | **Database migrations not run on prod** | 🔴 **CRITICAL** | DO-001 | Run `node migrate.js` on production DB via Render shell or local with prod DATABASE_URL. Take snapshot first. | June 12 |
| B4 | **Production DB provider mismatch** | 🔴 **CRITICAL** | DO-001 + Suga | Confirm whether production uses Render PostgreSQL (`rekrutai-prod-db`) or Neon PostgreSQL. If Neon, update `render.yaml` or set `DATABASE_URL` manually. | June 9 |
| B5 | **CSP `connectSrc` includes dev URL** | 🟡 **HIGH** | BE-002 | Remove `https://rekrutai-dev.onrender.com` from `connectSrc` in production helmet config. Make conditional on `NODE_ENV`. | June 10 |
| B6 | **OAuth redirect URIs not updated** | 🟡 **HIGH** | Suga | Update Google Cloud Console + LinkedIn Developer Portal to production URLs. | June 11 |
| B7 | **Branch protection not verified** | 🟡 **HIGH** | DO-001 | Verify GitHub branch protection rules on `main`, `staging`, `dev`. | June 10 |
| B8 | **E2E tests not run on latest commit** | 🟡 **HIGH** | QA-001 | Run full E2E suite against `dev` (or `staging` after merge). `dark-mode.spec.ts` has known SIGKILL flake — document exception if confirmed infrastructure-only. | June 10–11 |
| B9 | **No external uptime monitoring** | 🟡 **MEDIUM** | DO-001 | Set up UptimeRobot or similar for `https://rekrutai.co/health`. | June 12–13 |
| B10 | **Admin route rate limiting** | 🟡 **MEDIUM** | BE-002 | Add dedicated rate limiter on `/api/admin` login. | June 10–11 |
| B11 | **No Sentry / error tracking** | 🟡 **MEDIUM** | DO-001 | Set up Sentry for React + Node.js. | June 12–13 |

### ✅ Recently Resolved

| ID | Issue | Resolution | Date |
|----|-------|------------|------|
| R1 | `render.yaml` missing `envVars`, `healthCheckPath`, `NODE_ENV` | Fixed in `dev` (`989600a`). Will propagate to `main` via merge. | 2026-06-09 |
| R2 | Uncommitted changes on `dev` | All changes committed. Working tree clean. | 2026-06-09 |
| R3 | Merge conflicts predicted | Dry-run shows 0 conflicts. Both directions clean. | 2026-06-09 |

### 🟡 Non-Blockers (Can Fix Post-Launch)

| ID | Issue | Priority | Recommended Timeline |
|----|-------|----------|---------------------|
| N1 | No APM / performance monitoring | Medium | Within 2 weeks |
| N2 | No log aggregation | Low | Within 1 month |
| N3 | No automated backup verification | Low | Within 1 month |
| N4 | No WAF / DDoS protection beyond Render | Low | Within 1 month |
| N5 | No penetration testing | Medium | Within 1 month |
| N6 | No multi-region deployment | Low | Future roadmap |
| N7 | No database read replicas | Low | When traffic scales |
| N8 | R2 bucket backup automation | Low | Within 1 month |
| N9 | File upload virus scanning | Medium | Within 2 weeks |

---

## 10. Pre-Launch Action Plan (Next 10 Days: June 9–19)

### Days 1–2 (June 9–10): Code & Branch Hygiene

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| June 9 | Fix `render.yaml` prod service (already done in `dev`). | DO-001 | `989600a` committed. |
| June 9 | Confirm production DB provider (Render vs Neon). Resolve B4. | DO-001 + Suga | Documented decision, `render.yaml` updated if needed. |
| June 9 | Fix CSP `connectSrc` to remove dev URL. Resolve B5. | BE-002 | Commit to `dev`, included in next merge. |
| June 10 | Open PR: `dev` → `staging`. Run CI. Merge. | DO-001 | `staging` has latest code + render.yaml fix. |
| June 10 | Open PR: `staging` → `main`. Enable branch protection. Resolve B7. | DO-001 | `main` has CI/CD workflows + latest code. Branch protection enabled. |
| June 10 | Verify branch protection on `main`, `staging`, `dev`. | DO-001 | Screenshot of GitHub branch protection settings. |

### Days 3–4 (June 11–12): Secrets & Infrastructure

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| June 11 | Set all production secrets in Render dashboard. Resolve B1. | DO-001 + Suga | All `sync: false` env vars populated. |
| June 11 | Configure Stripe live keys + webhook endpoint. Resolve B2. | CEO (Ranga) | Stripe live mode active, webhook verified. |
| June 11 | Update OAuth redirect URIs in Google Cloud + LinkedIn. Resolve B6. | Suga | OAuth apps configured for production URLs. |
| June 12 | Take production DB snapshot. Run migrations. Resolve B3. | DO-001 | DB snapshot created, migrations applied, `_migrations` table updated. |
| June 12 | Set up UptimeRobot monitoring. Resolve B9. | DO-001 | 3 monitors active (health, homepage, login). |
| June 12 | Set up Sentry. Resolve B11. | DO-001 | Sentry project created, DSN added to env vars. |

### Days 5–7 (June 13–15): Testing & Validation

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| June 13 | Run full E2E suite against staging. Resolve B8. | QA-001 | E2E report with pass/fail rates. |
| June 13 | Run smoke tests on production (before public announcement). | Sunny + DO-001 | Smoke test report. |
| June 14 | Performance testing: Lighthouse, load test. | DO-001 | Performance baseline report. |
| June 14 | Security headers verification. | DO-001 | `curl` output confirming all headers. |
| June 15 | Run payment flow test with Stripe test mode. | QA-001 | Payment flow verified. |
| June 15 | Admin panel stress test. | Sunny | Admin metrics, activity logs, AI health verified. |

### Days 8–10 (June 16–19): Go/No-Go & Launch

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| June 16 | Go/No-Go meeting with CEO, CTO, COO, QA. | Ranga (CEO) | Signed Go/No-Go decision. |
| June 16 | If Go: Merge `staging` → `main`, tag release. | DO-001 | `main` at release tag. |
| June 16 | Manual deploy via Render Dashboard. | DO-001 | Production deployed to `rekrutai.co`. |
| June 16 | Post-deploy verification (all smoke tests). | Sunny + DO-001 | Verification report. |
| June 17 | Monitor for 24 hours. Watch UptimeRobot, Sentry, Render logs. | DO-001 | Incident-free 24h report. |
| June 18 | Prepare launch announcement. | Kimi (COO) | Launch comms ready. |
| June 19 | **PUBLIC LAUNCH** | Team | Rekrut AI v2 live. |

---

## 11. Emergency Contacts

| Role | Person | When to Contact |
|------|--------|----------------|
| Decision Authority | Ranga (CEO) | Any P0 issue requiring rollback or Stripe issues |
| Technical Execution | Suga (CTO) | Build failures, deployment issues, AI provider issues |
| QA Verification | Sunny (QA) | Post-deploy smoke test failures |
| Coordination | Kimi (COO) | Team notifications, incident comms |
| DevOps Lead | DO-001 | Infrastructure, monitoring, CI/CD issues |

---

## 12. Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-06-08 | DO-001 | Created checklist from `DEPLOYMENTS.md` + `deployment-runbook.md` |
| 2026-06-08 | DO-001 | Updated `render.yaml` — added `healthCheckPath`, `autoDeploy: true`, missing env vars, fixed `POLSIA_BASE_URL` → `POLSIA_API_URL` |
| 2026-06-09 | DO-001 | **Major update:** Added staging health status, corrected `autoDeploy: false` for prod, documented `render.yaml` fix (989600a), added complete blocker list with ETAs, added 10-day action plan, updated env var tiers with current status, corrected merge analysis (0 conflicts), added recently resolved items. |

---

**Deploy safe. Verify twice. Rollback fast.**
