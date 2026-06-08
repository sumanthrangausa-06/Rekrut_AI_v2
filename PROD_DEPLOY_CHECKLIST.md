# Rekrut AI v2 — Production Deployment Checklist

> **Prepared by:** DevOps Automator (subagent)  
> **Date:** 2026-06-09 02:23 CST  
> **Target Deployment:** June 19, 2026 (10 days remaining)  
> **Current Status:** 🟡 PARTIALLY READY — Active blockers require resolution before Go/No-Go  
> **Primary Deploy Target:** Render (`rekrutai-prod`) → `https://rekrutai.co`  
> **Production Branch:** `main` (diverged from `dev`)

---

## 1. Pre-Deployment Checks

### 1.1 Code Integrity & Branch State

| # | Check | Command / Action | Status | Owner | Notes |
|---|-------|------------------|--------|-------|-------|
| 1.1.1 | **Commit uncommitted changes on `dev`** | `git add` + `git commit` or `git restore` | 🔴 **BLOCKER** | BE-002 | 3 modified files: `client/src/components/layout/sidebar.tsx`, `e2e/auth-persistence.spec.ts`, `server.js` |
| 1.1.2 | Merge `dev` → `staging` | Open PR, run CI, merge | ⬜ PENDING | DO-001 | `dev` is 13 commits ahead of `staging`. Must merge to validate staging. |
| 1.1.3 | Merge `staging` → `main` | Open PR, run CI, get approval, merge | ⬜ PENDING | DO-001 | `main` and `dev` are diverged (13 commits each way). CI/CD workflows are in `dev` but **not yet confirmed in `main`**. |
| 1.1.4 | Verify `main` is clean | `git status` on `main` | ⬜ PENDING | DO-001 | No uncommitted files, no merge conflicts. |
| 1.1.5 | Syntax check server | `node -c server.js` | ✅ PASS | — | No syntax errors. |
| 1.1.6 | Syntax check all routes | `for f in routes/*.js; do node -c "$f"; done` | ✅ PASS | — | All route files valid. |
| 1.1.7 | Tag release | `git tag -a v2.0.0-20260619` | ⬜ PENDING | DO-001 | Tag the deployed commit after merge. |

**Current branch state (as of 2026-06-09 02:23):**
```
dev:     1701099 (latest) — EU AI Act compliance, E2E fixes, mobile fixes
main:    c3d46f0 — older baseline, missing migration automation + CI/CD workflows
staging: 88e53f6 — caught up with main (0 commits ahead)
```

### 1.2 Build Verification

| # | Check | Expected Result | Status | Owner | Notes |
|---|-------|---------------|--------|-------|-------|
| 1.2.1 | Clean client build | `cd client && npm install --include=dev && npm run build` → Exit 0 | ✅ PASS | — | Built in ~32s. Warning: 1 chunk ~1.57MB (index). |
| 1.2.2 | Build artifacts committed | Dist files match `client/src/` | ✅ PASS | — | Dist is committed and current. |
| 1.2.3 | Bundle size check | No chunk > 2MB (hard limit). Ideal < 600KB | ⚠️ WARNING | FE-001 | index chunk ~1.57MB — not a blocker but should be optimized post-launch. |
| 1.2.4 | TypeScript errors | `cd client && npx tsc --noEmit` | ⬜ TODO | BE-002 | Run before deploy. |
| 1.2.5 | Root `npm ci` passes | `npm ci` in workspace root | ✅ PASS | — | 0 vulnerabilities. |
| 1.2.6 | Root audit | `npm audit --audit-level moderate` | ✅ PASS | — | 0 vulnerabilities. |
| 1.2.7 | Client audit | `npm audit` (client/) | ✅ PASS | — | 0 vulnerabilities. |

### 1.3 Security Audit (Pre-Deploy Must-Fix)

| # | Check | File | Status | Owner | Notes |
|---|-------|------|--------|-------|-------|
| 1.3.1 | `x-powered-by` disabled | `server.js` | ✅ FIXED | — | `app.disable('x-powered-by')` present. |
| 1.3.2 | Helmet security headers | `server.js` | ✅ FIXED | — | CSP, HSTS, frame protection present. |
| 1.3.3 | Permissions-Policy restricted | `server.js` | ✅ FIXED | — | `camera=(self), microphone=(self)` — no wildcards. |
| 1.3.4 | CORS whitelist | `server.js` | ✅ FIXED | — | Explicit callback, rejects unknown origins. |
| 1.3.5 | Secure session cookies | `server.js` | ✅ FIXED | — | `secure: true` in production, `httpOnly`, `sameSite: lax`. |
| 1.3.6 | `npm audit --audit-level high` | CI + local | ✅ PASS | — | `vite`/`rollup` path traversal fixed. |
| 1.3.7 | CSP `connectSrc` cleanup | `server.js` | ⚠️ **NEEDS FIX** | BE-002 | `https://rekrutai-dev.onrender.com` may be in `connectSrc` for prod — should be conditional or removed. |
| 1.3.8 | Admin route brute-force protection | `routes/admin.js` | ⚠️ **GAP** | BE-002 | No dedicated rate limiter on `/api/admin` login. |
| 1.3.9 | File upload security | `routes/documents.js` | ⚠️ **GAP** | BE-002 | Verify `multer` limits, file type validation, virus scan. |

---

## 2. Environment Variables & Secrets

> **CRITICAL:** Render `rekrutai-prod` service has `autoDeploy: false`. All `sync: false` env vars must be set manually in the [Render Dashboard](https://dashboard.render.com/) **before** the first deployment.

### Tier 1 — Security (BLOCKING — must be set before deploy)

| Variable | Status | Notes |
|----------|--------|-------|
| `JWT_SECRET` | ❌ **MUST SET** | Generate 256-bit random string (≥32 chars). **DO NOT** reuse dev value. |
| `SESSION_SECRET` | ❌ **MUST SET** | Generate 256-bit random string. **DO NOT** reuse dev value. |
| `ADMIN_USERNAME` | ❌ **MUST SET** | Production admin login. |
| `ADMIN_PASSWORD` | ❌ **MUST SET** | Production admin password (strong, bcrypt if auth.js expects hash). |

### Tier 2 — Payment (BLOCKING if paid features enabled)

| Variable | Status | Notes |
|----------|--------|-------|
| `STRIPE_SECRET_KEY` | ❌ **MUST SET — LIVE KEY** | Must start with `sk_live_`. Current `.env` has test keys (`sk_test_`). **CEO approval required.** |
| `STRIPE_WEBHOOK_SECRET` | ❌ **MUST SET — LIVE** | Create webhook endpoint `https://rekrutai.co/api/billing/webhook` in Stripe dashboard first. |
| `STRIPE_PUBLISHABLE_KEY` (client) | ❌ **MUST SET — LIVE** | Client build embeds `pk_test_` currently. Must switch to `pk_live_` before production build. |

### Tier 3 — AI Providers (BLOCKING if AI features enabled)

| Variable | Status | Notes |
|----------|--------|-------|
| `POLSIA_API_KEY` | ❌ **MUST SET** | Primary AI proxy. |
| `POLSIA_API_URL` | ✅ Set in render.yaml | `https://polsia.com/api/proxy/ai` |
| `OPENAI_API_KEY` | ❌ **MUST SET** | Fallback provider. Verify quota/billing limit. |
| `OPENAI_BASE_URL` | ❌ **MUST SET** | Custom proxy if needed. |
| `OPENAI_DAILY_TOKEN_BUDGET` | ⚠️ **RECOMMENDED** | Defaults to 100K in code. Set explicitly to control costs. |
| `NVIDIA_NIM_API_KEY` | ❌ **MUST SET** | Fallback AI provider. |
| `NIM_BASE_URL` | ❌ **MUST SET** | `https://integrate.api.nvidia.com/v1` |
| `GROQ_API_KEY` | ❌ **MUST SET** | Fast fallback. |
| `CEREBRAS_API_KEY` | ❌ **MUST SET** | Enterprise fallback. |
| `DEEPGRAM_API_KEY` | ❌ **MUST SET** | TTS/STT audio features. |
| `NIM_*` model vars | ❌ **MUST SET** | 15+ model configuration variables (see `render.yaml`). |
| `NIM_TTS_BASE_URL` etc. | ❌ **MUST SET** | 5+ TTS service endpoints. |

### Tier 4 — Cloud Storage (R2)

| Variable | Status | Notes |
|----------|--------|-------|
| `R2_ACCESS_KEY_ID` | ❌ **MUST SET** | Cloudflare R2. |
| `R2_SECRET_ACCESS_KEY` | ❌ **MUST SET** | R2 secret. |
| `R2_BUCKET_NAME` | ❌ **MUST SET** | Bucket name. |
| `R2_ENDPOINT` | ❌ **MUST SET** | S3-compatible endpoint. |
| `R2_PUBLIC_URL` | ❌ **MUST SET** | Public CDN URL. Verify CORS policy allows `rekrutai.co`. |

### Tier 5 — Email/SMTP (BLOCKING if email notifications enabled)

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

### Tier 6 — OAuth (BLOCKING if social login enabled)

| Variable | Status | Notes |
|----------|--------|-------|
| `GOOGLE_CLIENT_ID` | ❌ **MUST SET** | Google Cloud Console → OAuth 2.0 credentials. |
| `GOOGLE_CLIENT_SECRET` | ❌ **MUST SET** | Rotate if previously used for dev. |
| `GOOGLE_REDIRECT_URI` | ✅ Set in render.yaml | `https://rekrutai.co/api/auth/google/callback` — **must also be registered in Google Cloud Console.** |
| `LINKEDIN_CLIENT_ID` | ❌ **MUST SET** | LinkedIn Developer Portal. |
| `LINKEDIN_CLIENT_SECRET` | ❌ **MUST SET** | Rotate if previously used for dev. |
| `LINKEDIN_REDIRECT_URI` | ✅ Set in render.yaml | `https://rekrutai.co/api/auth/linkedin/callback` — **must also be registered in LinkedIn Developer Portal.** |

### Tier 7 — Render-Auto-Set (No action needed)

| Variable | Status | Notes |
|----------|--------|-------|
| `NODE_ENV` | ✅ | `production` (render.yaml) |
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

## 3. Database Migration Steps (Neon PostgreSQL / Render PostgreSQL)

### 3.1 Pre-Migration Checklist

| # | Step | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 3.1.1 | **Take production DB snapshot** | ⬜ TODO | DO-001 | Render dashboard → `rekrutai-prod-db` → Snapshots → Create snapshot. **Do this before any migration.** |
| 3.1.2 | Confirm production DB connection | `psql "$DATABASE_URL" -c "SELECT NOW();"` | ⬜ TODO | DO-001 | Verify connectivity from local or Render shell. |
| 3.1.3 | List pending migrations | Compare `_migrations` table vs `/migrations/` folder | ⬜ TODO | DO-001 | 56+ `.js` files in repo. |
| 3.1.4 | Verify migration syntax | `node migrate.js --dry-run` (if supported) or manual review | ⬜ TODO | BE-002 | `migrate.js` uses `BEGIN/COMMIT/ROLLBACK`. |
| 3.1.5 | Verify `pgvector` extension | `CREATE EXTENSION IF NOT EXISTS vector;` | ⬜ TODO | DO-001 | Required for AI matching features. Neon supports this. |

### 3.2 Migration Execution

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

### 3.3 Post-Migration Verification

| # | Check | Expected Result | Status |
|---|-------|-----------------|--------|
| 3.3.1 | Core tables exist | `users`, `jobs`, `interviews`, `interview_questions`, `agent_data` | ⬜ TODO |
| 3.3.2 | Feature tables exist | `omniscore`, `trustscore`, `payroll`, `compliance`, `onboarding`, `matching`, etc. | ⬜ TODO |
| 3.3.3 | Seed data loaded | `notification_templates` > 0 rows | ⬜ TODO |
| 3.3.4 | Foreign key constraints | `company_id` references valid (see migration `045_fix_company_id_fk_constraints.sql`) | ⬜ TODO |
| 3.3.5 | Session table | `user_sessions` auto-created by `connect-pg-simple` | ⬜ TODO |

---

## 4. SSL / Certificate Verification

| # | Step | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 4.1 | **Custom domain DNS configured** | ⬜ TODO | DO-001 | `rekrutai.co` A/ALIAS record must point to Render's load balancer. Verify in Render dashboard → Custom Domain. |
| 4.2 | `www` redirect configured | ⬜ TODO | DO-001 | Ensure `www.rekrutai.co` → `rekrutai.co` (or vice versa, but be consistent). |
| 4.3 | Render SSL auto-provisioning | ✅ Automatic | — | Render provisions Let's Encrypt automatically once DNS resolves. |
| 4.4 | Verify SSL after deploy | ⬜ TODO | DO-001 | Valid certificate, no warnings. |
| 4.5 | HTTP → HTTPS redirect | ⬜ TODO | DO-001 | Must return 301/302 to HTTPS. |
| 4.6 | HSTS header present | ⬜ TODO | DO-001 | `Strict-Transport-Security` header present (helmet configured with `maxAge: 31536000`). |

### 4.1 Domain Security Checklist

| Service | Action Required | Status |
|---------|-----------------|--------|
| Google OAuth | Add `https://rekrutai.co/api/auth/google/callback` to authorized redirect URIs | ❌ MUST DO |
| LinkedIn OAuth | Add `https://rekrutai.co/api/auth/linkedin/callback` to authorized redirect URIs | ❌ MUST DO |
| Stripe Webhooks | Create endpoint `https://rekrutai.co/api/billing/webhook` with events: `checkout.session.completed`, `invoice.payment_failed`, `customer.subscription.deleted`, etc. | ❌ MUST DO |
| Stripe Checkout URLs | Update success/cancel URLs in Stripe checkout creation code to `https://rekrutai.co/...` | ❌ MUST DO |

---

## 5. Staging → Main Promotion Steps

### 5.1 Promotion Flow

```
feature/* → dev → staging → main (production)
```

### 5.2 Step-by-Step Promotion

| # | Step | Details | Status | Owner |
|---|------|---------|--------|-------|
| 5.2.1 | **Commit uncommitted changes on `dev`** | `git add` + `git commit` the 3 modified files, or `git restore` if not needed | 🔴 **BLOCKER** | BE-002 |
| 5.2.2 | Open PR: `dev` → `staging` | Include all latest e2e + mobile + compliance fixes | ⬜ PENDING | DO-001 |
| 5.2.3 | CI passes on `dev`→`staging` PR | Build, audit, E2E (chromium), health check | ⬜ PENDING | CI/CD |
| 5.2.4 | Merge `dev` → `staging` | Render auto-deploys to `https://rekrutai-staging.onrender.com` | ⬜ PENDING | DO-001 |
| 5.2.5 | Staging smoke tests | Run all E2E against `rekrutai-staging.onrender.com` | ⬜ PENDING | QA-001 |
| 5.2.6 | Open PR: `staging` → `main` | Require 1 approval. Include CI/CD workflows. | ⬜ PENDING | DO-001 |
| 5.2.7 | CI passes on `staging`→`main` PR | Build, audit, E2E, health check | ⬜ PENDING | CI/CD |
| 5.2.8 | Merge `staging` → `main` | Production branch now has latest code. **Does NOT auto-deploy.** | ⬜ PENDING | DO-001 + Suga (CTO) |
| 5.2.9 | Tag release | `git tag -a v2.0.0-20260619` | ⬜ PENDING | DO-001 |

### 5.3 Branch Protection (Must enable before promotion)

| Branch | Rule | Status |
|--------|------|--------|
| `main` | Require PR before merging | ⬜ VERIFY |
| `main` | Require 1 approval | ⬜ VERIFY |
| `main` | Require status checks: Build Check, Security Audit, E2E Tests | ⬜ VERIFY |
| `main` | Dismiss stale PR approvals | ⬜ VERIFY |
| `main` | Require branches to be up to date | ⬜ VERIFY |
| `main` | Allow force pushes: ❌ Disabled | ⬜ VERIFY |
| `main` | Allow deletions: ❌ Disabled | ⬜ VERIFY |
| `staging` | Require PR before merging | ⬜ VERIFY |
| `staging` | Require status checks: Build Check, Security Audit, E2E Tests | ⬜ VERIFY |
| `staging` | Allow force pushes: ❌ Disabled | ⬜ VERIFY |
| `dev` | Require PR before merging | ⬜ VERIFY |
| `dev` | Require status checks: Build Check, Security Audit | ⬜ VERIFY |
| `dev` | Allow force pushes: ❌ Disabled | ⬜ VERIFY |

> **CRITICAL:** If branch protection is not enabled, direct pushes to `main` could bypass CI/CD gates.

---

## 6. Rollback Plan (What to Do If Deployment Fails)

### 6.1 Rollback Triggers

| Condition | Severity | Action | Owner |
|-----------|----------|--------|-------|
| `/health` returns non-200 for > 2 minutes | 🔴 CRITICAL | Immediate Render dashboard rollback | DO-001 |
| 50%+ of smoke tests fail | 🔴 CRITICAL | Git revert + Render dashboard rollback | DO-001 + Suga |
| Database errors in logs | 🔴 CRITICAL | DB snapshot restore + code revert | DO-001 + BE-002 |
| Stripe payment failures | 🔴 CRITICAL | Disable Stripe webhooks + investigate | DO-001 + Ranga (CEO) |
| AI provider circuit breakers tripped | 🟡 MEDIUM | Reset via `/api/ai-health/reset` (admin) | Suga |
| E2E test suite fails on prod | 🟡 MEDIUM | Investigate before rolling back (may be test flake) | QA-001 |

### 6.2 Rollback Procedures

#### Option A: Render Dashboard (Fastest — 1–3 minutes)

1. Go to [Render Dashboard](https://dashboard.render.com/) → `rekrutai-prod`
2. Click **"Manual Deploy"** → **"Deploy a specific commit"**
3. Select the last known good commit (document before deploy)
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

### 6.3 Communication Plan

| Event | Channel | Message Template |
|-------|---------|-----------------|
| Rollback initiated | `#deployments` (Slack/Discord) | `🚨 Rollback initiated — reverting to commit [X]. Reason: [Y]. ETA: 2 min.` |
| Rollback complete | `#deployments` | `✅ Rollback complete. Production at [commit]. Health: OK. Investigating root cause.` |
| All-clear | `#deployments` | `✅ Post-rollback verification complete. Issue ticket: [link].` |

### 6.4 Rollback Time Estimates

| Step | Time |
|------|------|
| Detect failure | 1–2 minutes (health check polling) |
| Trigger rollback | 2 minutes (dashboard navigation) |
| Render deploys previous commit | 3–5 minutes |
| Verify rollback | 1 minute |
| **Total** | **7–10 minutes** |

---

## 7. Post-Deployment Verification Steps

### 7.1 Immediate Health Checks (within 2 minutes of deploy)

| # | Endpoint | Expected Result | Status |
|---|----------|-----------------|--------|
| 7.1.1 | `GET https://rekrutai.co/health` | `{"status":"ok","timestamp":"..."}` | ⬜ TODO |
| 7.1.2 | `GET https://rekrutai.co/api/health` | `{"status":"ok","timestamp":"..."}` | ⬜ TODO |
| 7.1.3 | `GET https://rekrutai.co/` | `200 OK`, React SPA loads, hero visible | ⬜ TODO |
| 7.1.4 | `GET https://rekrutai.co/login` | `200 OK`, login form renders | ⬜ TODO |
| 7.1.5 | `GET https://rekrutai.co/pricing` | `200 OK`, pricing tiers visible | ⬜ TODO |
| 7.1.6 | `GET https://rekrutai.co/about` | `200 OK`, about page loads | ⬜ TODO |

### 7.2 Functional Smoke Tests (within 15 minutes of deploy)

| # | Test | Steps | Expected Result | Status |
|---|------|-------|-----------------|--------|
| 7.2.1 | Homepage render | Load `/`, check hero, features, pricing, testimonials | All sections visible, no console errors | ⬜ TODO |
| 7.2.2 | Login flow | Use production test credentials | Login succeeds, redirects to dashboard | ⬜ TODO |
| 7.2.3 | Candidate jobs page | Login as candidate, navigate to `/candidate/jobs` | Job listings load, search/filter work | ⬜ TODO |
| 7.2.4 | Recruiter dashboard | Login as recruiter, navigate to `/recruiter/dashboard` | Dashboard loads, analytics visible | ⬜ TODO |
| 7.2.5 | Recruiter candidates | Navigate to `/recruiter/candidates` | Candidate search loads, SQL query works | ⬜ TODO |
| 7.2.6 | Dark mode toggle | Click dark mode toggle on any page | Theme switches, persists on reload | ⬜ TODO |
| 7.2.7 | Mobile responsive | Emulate iPhone 14 in DevTools | Layout adapts, no horizontal scroll | ⬜ TODO |
| 7.2.8 | Stripe pricing page | Load `/pricing` | Free / Pro / Enterprise tiers visible | ⬜ TODO |
| 7.2.9 | Registration | Create a new test account | Account created, welcome email sent (if email configured) | ⬜ TODO |
| 7.2.10 | Admin panel | Login with admin credentials at `/admin` | Admin dashboard loads, metrics visible | ⬜ TODO |

### 7.3 API Smoke Tests

| # | Endpoint | Auth | Expected Result | Status |
|---|----------|------|-----------------|--------|
| 7.3.1 | `GET /api/auth/me` | Session cookie | Returns current user object | ⬜ TODO |
| 7.3.2 | `GET /api/jobs` | Public | Returns job listings | ⬜ TODO |
| 7.3.3 | `GET /api/recruiter/candidates` | Recruiter session | Returns candidates | ⬜ TODO |
| 7.3.4 | `POST /api/ai-health/verify` | Admin | Runs AI provider verification | ⬜ TODO |
| 7.3.5 | `GET /api/admin/metrics` | Admin | Returns request metrics | ⬜ TODO |
| 7.3.6 | `GET /api/ai-health` | Admin | Returns provider circuit breaker status | ⬜ TODO |

### 7.4 Security Smoke Tests

| # | Test | Tool / Command | Expected Result | Status |
|---|------|---------------|-----------------|--------|
| 7.4.1 | Security headers | `curl -I https://rekrutai.co/` | `X-Frame-Options`, `X-Content-Type-Options`, `HSTS`, `CSP` present | ⬜ TODO |
| 7.4.2 | `x-powered-by` absent | `curl -I https://rekrutai.co/\| grep -i powered` | No match | ⬜ TODO |
| 7.4.3 | HTTPS enforcement | `curl -I http://rekrutai.co/` | Redirects to HTTPS | ⬜ TODO |
| 7.4.4 | CORS rejection | `curl -H "Origin: https://evil.com" https://rekrutai.co/api/jobs` | `403` or CORS error | ⬜ TODO |
| 7.4.5 | CSRF protection | POST to `/api/auth/logout` without CSRF token | `403` (if CSRF enforced) | ⬜ TODO |
| 7.4.6 | JWT expiration | Use expired token | `401` Unauthorized | ⬜ TODO |
| 7.4.7 | Page load time | DevTools Network tab | < 500ms static assets, < 1.5s full page | ⬜ TODO |
| 7.4.8 | Lighthouse score | Chrome DevTools Lighthouse | Performance > 85, Accessibility > 85, SEO > 90, Best Practices > 90 | ⬜ TODO |

### 7.5 E2E Test Suite on Production (Run within 1 hour of deploy)

```bash
# Run E2E tests against production (with live credentials)
BASE_URL=https://rekrutai.co npx playwright test --project=chromium
```

| Spec File | Status | Notes |
|-----------|--------|-------|
| `auth-persistence.spec.ts` | ⬜ TODO | 8 tests — auth, token, jobs browse, mobile responsive, settings |
| `candidate-critical-flow.spec.ts` | ⬜ TODO | Candidate jobs, profile, applications |
| `recruiter-critical-flow.spec.ts` | ⬜ TODO | Recruiter dashboard, candidates, job posting |
| `payment-flow.spec.ts` | ⬜ TODO | Stripe checkout flow — **use test mode or skip in live mode** |
| `public-pages.spec.ts` | ⬜ TODO | Login, register, pricing, blog, home |
| `navigation-flow.spec.ts` | ⬜ TODO | Visitor, candidate, recruiter navigation |
| `dark-mode.spec.ts` | ⬜ TODO | Known flaky — browser SIGKILL. If fails, confirm it's infrastructure, not app logic. |
| `admin-critical-flow.spec.ts` | ⬜ TODO | Admin login, metrics, activity logs — requires admin credentials |
| `candidate-profile-flow.spec.ts` | ⬜ TODO | Profile edit, document upload |
| `recruiter-job-posting-flow.spec.ts` | ⬜ TODO | Create job, edit job, view applicants |

> **Note:** `dark-mode.spec.ts` has a known SIGKILL/browser crash issue. If it fails on production, verify manually that dark mode works, and document the exception. Do not block deployment solely on this test if the failure is confirmed to be infrastructure-related.

---

## 8. Monitoring and Alerting Setup

### 8.1 Implemented Monitoring (Built-in)

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
| `GET /api/admin/token-usage` | Admin | OpenAI token budget status | ✅ Implemented |
| `GET /api/ai-health/models` | Admin | Available model list | ✅ Implemented |
| `GET /api/ai-health/failover-stats` | Admin | Failover statistics | ✅ Implemented |
| `GET /api/ai-health/predictions` | Admin | Usage predictions | ✅ Implemented |
| `GET /api/ai-health/daily-breakdown` | Admin | Daily token usage | ✅ Implemented |

### 8.2 Missing Monitoring (Post-Launch Must-Have)

| # | Tool | Purpose | Cost | Timeline | Status |
|---|------|---------|------|----------|--------|
| 8.2.1 | **UptimeRobot** (or Pingdom / Better Uptime) | External uptime monitoring for `https://rekrutai.co/health` | Free tier (50 monitors) | **Before launch** | ❌ NOT SET UP |
| 8.2.2 | **Sentry** | Error tracking (React frontend + Node.js backend) | Free tier (5K errors/month) | Within 1 week of launch | ❌ NOT SET UP |
| 8.2.3 | **Log aggregation** | Render logs are ephemeral (~7 days). Forward to Datadog / Papertrail / Splunk. | Variable | Within 2 weeks | ❌ NOT SET UP |
| 8.2.4 | **Database monitoring** | Slow query alerts, connection pool monitoring | Neon dashboard + custom | Within 2 weeks | ❌ NOT SET UP |
| 8.2.5 | **SSL expiry monitoring** | Render auto-renews, but external alert is good practice | Free (UptimeRobot can check) | Before launch | ❌ NOT SET UP |

### 8.3 Recommended UptimeRobot Setup

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

## 9. CI/CD Pipeline Status

### 9.1 Workflows Summary

| Workflow | File | Trigger | Status |
|----------|------|---------|--------|
| **CI** | `.github/workflows/ci.yml` | PR to `dev`/`staging`/`main`, push to `dev`/`staging` | ✅ Present in `dev` |
| **Deploy** | `.github/workflows/deploy.yml` | `workflow_dispatch` on `main` only | ✅ Present in `dev` |

### 9.2 CI Jobs

| Job | Purpose | Blocks Merge? | Status |
|-----|---------|---------------|--------|
| Build Check | `npm run build --prefix client` | ✅ Yes | ✅ Implemented |
| Security Audit | `npm audit --audit-level high` | ✅ Yes | ✅ Implemented |
| E2E Tests | `npx playwright test --project=chromium` | ✅ Yes | ✅ Implemented |
| Health Check | `curl https://rekrutai-dev.onrender.com/health` | ⚠️ Warns only | ✅ Implemented |

### 9.3 Deploy Workflow Steps

| Step | Details | Status |
|------|---------|--------|
| Confirmation gate | Must type `deploy-to-prod` | ✅ Implemented |
| Branch gate | Must be on `main` | ✅ Implemented |
| CI re-run | All CI jobs run again | ✅ Implemented (uses `workflow_call`) |
| Environment | `environment: production` for GitHub approval rules | ✅ Implemented |
| Post-deploy health | Polls `/health` for 10 attempts (2.5 min) | ✅ Implemented |

### 9.4 Critical Pipeline Gap

| Issue | Impact | Action Required |
|-------|--------|-----------------|
| **CI/CD workflows are NOT confirmed in `main` branch** | If `main` lacks `.github/workflows/`, the "Deploy to Production" GitHub Actions won't work. | Merge `dev` → `main` to bring `.github/workflows/` to production branch. **This is a blocker.** |

---

## 10. Known Blockers & Missing Pieces

### 🔴 CRITICAL Blockers (Must Resolve Before Deploy)

| ID | Blocker | Severity | Owner | Action Required | ETA |
|----|---------|----------|-------|-----------------|-----|
| B1 | **Branch divergence:** `main` and `dev` diverged (13 commits each way) | 🔴 CRITICAL | Suga (CTO) + DO-001 | Merge `dev` into `main` (or rebase) to bring migration fixes, CI/CD workflows, EU AI Act compliance to production branch. | June 9–10 |
| B2 | **Uncommitted changes on `dev`:** 3 modified files | 🔴 CRITICAL | BE-002 | Commit or discard `sidebar.tsx`, `auth-persistence.spec.ts`, `server.js` changes before merge. | June 9 |
| B3 | **Production secrets not set in Render:** All `sync: false` env vars are empty | 🔴 CRITICAL | DO-001 + Suga | Set all 40+ `sync: false` env vars in Render dashboard (JWT, SESSION, ADMIN, STRIPE, AI keys, Email, OAuth). | June 10–11 |
| B4 | **Stripe live keys not configured** | 🔴 CRITICAL | Ranga (CEO) | Replace `sk_test_` with `sk_live_` in production env. Create live webhook endpoint. **CEO approval required.** | June 11 |
| B5 | **Database migrations not run on prod** | 🔴 CRITICAL | DO-001 | Run `node migrate.js` on production DB via Render shell or local with prod `DATABASE_URL`. Take snapshot first. | June 12 |
| B6 | **Production DB provider mismatch:** Render PostgreSQL vs Neon | 🔴 CRITICAL | DO-001 + Suga | Confirm whether production uses Render PostgreSQL (`rekrutai-prod-db`) or Neon PostgreSQL. Update `render.yaml` or set `DATABASE_URL` manually. | June 9 |
| B7 | **CSP `connectSrc` includes dev URL in prod config** | 🟡 HIGH | BE-002 | Remove `https://rekrutai-dev.onrender.com` from `connectSrc` in production helmet config. Make conditional on `NODE_ENV`. | June 10 |
| B8 | **OAuth redirect URIs not updated in provider portals** | 🟡 HIGH | Suga | Update Google Cloud Console + LinkedIn Developer Portal to production URLs. | June 11 |
| B9 | **Branch protection not enabled** | 🟡 HIGH | DO-001 | Verify GitHub branch protection rules on `main`, `staging`, `dev`. | June 10 |
| B10 | **No external uptime monitoring** | 🟡 MEDIUM | DO-001 | Set up UptimeRobot or similar for `https://rekrutai.co/health`. | June 12–13 |

### 🟡 Non-Blockers (Can Fix Post-Launch)

| ID | Issue | Priority | Recommended Timeline |
|----|-------|----------|---------------------|
| N1 | No Sentry / error tracking | Medium | Within 1 week of launch |
| N2 | No APM / performance monitoring | Medium | Within 2 weeks |
| N3 | No log aggregation beyond Render (~7 days) | Low | Within 1 month |
| N4 | No automated backup verification | Low | Within 1 month |
| N5 | No WAF / DDoS protection beyond Render | Low | Within 1 month |
| N6 | No penetration testing | Medium | Within 1 month |
| N7 | No multi-region deployment | Low | Future roadmap |
| N8 | No database read replicas | Low | When traffic scales |
| N9 | R2 bucket backup automation | Low | Within 1 month |
| N10 | Admin route rate limiting | Medium | Within 2 weeks |
| N11 | Client build chunk size ~1.57MB | Medium | Code splitting (4–8 hours) |

---

## 11. Pre-Launch Action Plan (Next 10 Days: June 9–19)

### Days 1–2 (June 9–10): Code & Branch Hygiene

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| June 9 | Commit uncommitted changes on `dev`. Resolve `B2`. | BE-002 | Clean `dev` branch, no uncommitted files. |
| June 9 | Confirm production DB provider (Render vs Neon). Resolve `B6`. | DO-001 + Suga | Documented decision, `render.yaml` updated if needed. |
| June 9 | Fix CSP `connectSrc` to remove dev URL. Resolve `B7`. | BE-002 | Commit to `dev`, included in next merge. |
| June 10 | Open PR: `dev` → `staging`. Run CI. Merge. | DO-001 | `staging` has latest code. |
| June 10 | Open PR: `staging` → `main`. Enable branch protection. Resolve `B1`, `B9`. | DO-001 | `main` has CI/CD workflows. Branch protection enabled. |

### Days 3–4 (June 11–12): Secrets & Infrastructure

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| June 11 | Set all production secrets in Render dashboard. Resolve `B3`. | DO-001 + Suga | All `sync: false` env vars populated. |
| June 11 | Configure Stripe live keys + webhook endpoint. Resolve `B4`. | Ranga (CEO) | Stripe live mode active, webhook verified. |
| June 11 | Update OAuth redirect URIs in Google Cloud Console + LinkedIn. Resolve `B8`. | Suga | Social login works on production domain. |
| June 12 | Take production DB snapshot. Run migrations. Verify schema. Resolve `B5`. | DO-001 + BE-002 | Production DB ready, ~105 tables, `pgvector` enabled. |
| June 12 | Set up UptimeRobot monitoring. Resolve `B10`. | DO-001 | External uptime alerts active. |

### Days 5–7 (June 13–15): Final Verification

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| June 13 | Run full E2E suite against `staging` (or `main` if not auto-deployed). | QA-001 | All E2E pass (except known `dark-mode` flake). |
| June 13 | Tag release: `git tag -a v2.0.0-20260619`. | DO-001 | Release tagged. |
| June 14 | CEO Go/No-Go approval. | Ranga | Signed-off for production deploy. |
| June 15 | Production dry-run: manual deploy to `rekrutai-prod` from `main` (optional). | DO-001 | Verify build, health, smoke tests on prod infra. |

### Days 8–10 (June 16–19): Deploy Window

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| June 16–18 | (Buffer days for any last-minute fixes) | — | — |
| June 19 | **Production Deployment** | DO-001 | `rekrutai-prod` deployed, health OK, smoke tests pass. |
| June 19 | Post-deploy monitoring | DO-001 + QA-001 | 24-hour monitoring, no critical alerts. |

---

## 12. Go / No-Go Verdict

### 🚫 CURRENT VERDICT: **NO-GO**

**Primary reasons:**

1. **B1 — Branch divergence:** `main` and `dev` have diverged (13 commits each way). Critical fixes (migration automation, EU AI Act compliance, CI/CD workflows) are not on `main`.
2. **B2 — Uncommitted changes:** 3 modified files on `dev` must be resolved before merge.
3. **B3 — Production secrets not set:** All `sync: false` env vars in Render dashboard are empty. Without these, the app will fail to start or function.
4. **B4 — Stripe live mode pending:** CEO approval required for live payment processing.
5. **B5 — Database migrations not verified:** Production DB schema state is unknown. Migrations must be run and verified.
6. **B6 — DB provider mismatch:** Unclear if production uses Render PostgreSQL or Neon.

### 📋 Path to Go

| Step | Owner | Estimated Time | Cumulative ETA |
|------|-------|----------------|----------------|
| Commit uncommitted changes on `dev` | BE-002 | 15 min | 15 min |
| Decide production DB provider | DO-001 + Suga | 15 min | 30 min |
| Merge `dev` into `main` (resolve diverged branches) | Suga + DO-001 | 30–60 min | 1.5–2 hours |
| Enable branch protection | DO-001 | 15 min | 1.5–2 hours |
| Set all production secrets in Render | DO-001 + Suga | 2–3 hours | 4–5 hours |
| Configure Stripe live mode | Ranga (CEO) | 30 min | 4.5–5.5 hours |
| Fix CSP `connectSrc` | BE-002 | 15 min | 4.5–5.5 hours |
| Update OAuth redirect URIs | Suga | 15 min | 4.5–5.5 hours |
| Tag release and push | DO-001 | 5 min | 4.5–5.5 hours |
| Take production DB snapshot | DO-001 | 15 min | 4.5–5.5 hours |
| Run production DB migrations | DO-001 + BE-002 | 15 min | 4.5–5.5 hours |
| Run E2E tests against merged `main` | QA-001 | 2–4 hours | 6.5–9.5 hours |
| CEO Go/No-Go approval | Ranga | 30 min | 7–10 hours |
| **Execute deploy** | DO-001 | 5–8 min | **7–10 hours total** |

**Recommendation:** Begin the branch merge and secret configuration immediately. With 10 days remaining, the timeline is achievable but requires daily attention. Do **not** attempt production deployment until all 🔴 CRITICAL blockers are resolved.

---

## 13. Appendix: Useful Commands

```bash
# Check environment health
curl -s https://rekrutai-dev.onrender.com/health | jq .
curl -s https://rekrutai-staging.onrender.com/health | jq .
curl -s https://rekrutai.co/health | jq .

# Check security headers
curl -I https://rekrutai.co/

# Build client
cd /root/.openclaw/workspace/Rekrut_AI_v2
npm run build --prefix client

# Check bundle size
ls -lah client/dist/assets/

# Security audit
npm audit --audit-level moderate

# Check server syntax
node -c server.js
for f in routes/*.js; do node -c "$f"; done

# DB health check
psql "$DATABASE_URL" -c "SELECT NOW(), count(*) FROM users;"

# Git status
git status
git log --oneline -5
git log --oneline main..dev
git log --oneline dev..main

# Check diff between main and dev
git diff --name-only main dev
```

---

## 14. Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-06-09 | v3.0 | DevOps Automator | Fresh checklist based on current state: verified staging health, branch divergence, uncommitted changes, and render.yaml secrets gap. Updated for June 19 target. |
| 2026-06-09 | v2.0 | DevOps Automator | Previous checklist (prod-deploy-checklist.md) — updated with build verification and branch divergence findings. |
| 2026-06-08 | v1.0 | DevOps Automator | Initial checklist (PROD_DEPLOYMENT_CHECKLIST.md) — identified blockers and action plan. |

---

*This checklist is a living document. Update it as blockers are resolved and new issues are discovered.*
