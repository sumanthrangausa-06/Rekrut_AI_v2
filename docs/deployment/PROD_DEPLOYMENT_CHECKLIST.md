# Rekrut AI v2 — Production Deployment Checklist

> **Prepared by:** DevOps Automator (DO-001)  
> **Date:** 2026-06-08 14:55 CST  
> **Target Deployment:** June 19, 2026 (11 days remaining)  
> **Current Status:** 🟡 PARTIALLY READY — Active blockers require resolution before Go/No-Go  
> **Primary Deploy Target:** Render (`rekrutai-prod`) → `https://rekrutai.co`  
> **Production Branch:** `main` (currently 777 commits, 3 behind `staging`)

---

## 1. Pre-Deployment Checks

### 1.1 Code Integrity & Branch State

| # | Check | Command / Action | Status | Owner | Notes |
|---|-------|------------------|--------|-------|-------|
| 1.1.1 | **Commit all uncommitted changes** | `git add` + `git commit` on `dev` | ❌ **BLOCKER** | BE-002 | `dev` has uncommitted dist artifacts + e2e/mobile fixes. Must be committed before any merge. |
| 1.1.2 | Merge `dev` → `staging` | Open PR, run CI, merge | ⬜ PENDING | DO-001 | `dev` is 2 commits ahead of `staging`. Must merge to validate staging. |
| 1.1.3 | Merge `staging` → `main` | Open PR, run CI, get approval, merge | ⬜ PENDING | DO-001 | `staging` is 3 commits ahead of `main`. CI/CD workflows are in `staging` but **not yet in `main`**. |
| 1.1.4 | Verify `main` is clean | `git status` on `main` | ⬜ PENDING | DO-001 | No uncommitted files, no merge conflicts. |
| 1.1.5 | Syntax check server | `node -c server.js` | ✅ PASS | — | No syntax errors. |
| 1.1.6 | Syntax check all routes | `for f in routes/*.js; do node -c "$f"; done` | ⬜ TODO | BE-002 | Run before deploy. |
| 1.1.7 | Tag release | `git tag -a v2.0.0-20260619` | ⬜ PENDING | DO-001 | Tag the deployed commit after merge. |

**Current branch state:**
```
main:    13812c5 (777 commits) — production baseline
staging: ffd5869 (780 commits) — contains CI/CD, E2E fixes, security headers
dev:     e5be6f6 (779 commits) — contains new e2e specs + mobile fixes (uncommitted)
```

### 1.2 Build Verification

| # | Check | Expected Result | Status | Owner |
|---|-------|---------------|--------|-------|
| 1.2.1 | Clean client build | `cd client && npm ci && npm run build` → Exit 0 | ⬜ TODO | DO-001 |
| 1.2.2 | Build artifacts committed | Dist files match `client/src/` | ❌ **BLOCKER** | BE-002 |
| 1.2.3 | Bundle size check | No chunk > 2MB (hard limit). Ideal < 600KB | ⬜ TODO | DO-001 |
| 1.2.4 | TypeScript errors | `cd client && npx tsc --noEmit` | ⬜ TODO | BE-002 |
| 1.2.5 | Root `npm ci` passes | `npm ci` in workspace root | ✅ PASS | — |

### 1.3 Security Audit (Pre-Deploy Must-Fix)

| # | Check | File | Status | Owner | Notes |
|---|-------|------|--------|-------|-------|
| 1.3.1 | `x-powered-by` disabled | `server.js:43` | ✅ FIXED | — | `app.disable('x-powered-by')` present. |
| 1.3.2 | Helmet security headers | `server.js:59` | ✅ FIXED | — | CSP, HSTS, frame protection present. |
| 1.3.3 | Permissions-Policy restricted | `server.js:85` | ✅ FIXED | — | `camera=(self), microphone=(self)` — no wildcards. |
| 1.3.4 | CORS whitelist | `server.js:78` | ✅ FIXED | — | Explicit callback, rejects unknown origins. |
| 1.3.5 | Secure session cookies | `server.js:99` | ✅ FIXED | — | `secure: true` in production, `httpOnly`, `sameSite: lax`. |
| 1.3.6 | `npm audit --audit-level high` | CI + local | ✅ PASS | — | `vite`/`rollup` path traversal fixed in recent commit. |
| 1.3.7 | CSP `connectSrc` cleanup | `server.js:72` | ⚠️ **NEEDS FIX** | BE-002 | `https://rekrutai-dev.onrender.com` is in `connectSrc` for prod — should be conditional or removed. |
| 1.3.8 | Admin route brute-force protection | `routes/admin.js` | ⚠️ **GAP** | BE-002 | No dedicated rate limiter on `/api/admin` login. |
| 1.3.9 | File upload security | `routes/documents.js` | ⚠️ **GAP** | BE-002 | Verify `multer` limits, file type validation, virus scan. |

### 1.4 Environment Variables & Secrets

> **CRITICAL:** Render `rekrutai-prod` service has `autoDeploy: false`. All `sync: false` env vars must be set manually in the [Render Dashboard](https://dashboard.render.com/) **before** the first deployment.

#### Tier 1 — Security (BLOCKING — must be set before deploy)

| Variable | Status | Notes |
|----------|--------|-------|
| `JWT_SECRET` | ❌ **MUST SET** | Generate 256-bit random string. **DO NOT** reuse `dev-jwt-secret-change-in-production-rekrutai-v2-2026`. |
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
| `NIM_*` model vars | ❌ **MUST SET** | 15+ model configuration variables (see `render.yaml`). |
| `NIM_TTS_BASE_URL` etc. | ❌ **MUST SET** | 5+ TTS service endpoints. |
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

## 2. Database Migration Steps (Neon PostgreSQL / Render PostgreSQL)

### 2.1 Pre-Migration Checklist

| # | Step | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 2.1.1 | **Take production DB snapshot** | ⬜ TODO | DO-001 | Render dashboard → `rekrutai-prod-db` → Snapshots → Create snapshot. **Do this before any migration.** |
| 2.1.2 | Confirm production DB connection | `psql "$DATABASE_URL" -c "SELECT NOW();"` | ⬜ TODO | DO-001 | Verify connectivity from local or Render shell. |
| 2.1.3 | List pending migrations | Compare `_migrations` table vs `/migrations/` folder | ⬜ TODO | DO-001 | 59+ `.js` files + 2 `.sql` files in repo. |
| 2.1.4 | Verify migration syntax | `node migrate.js --dry-run` (if supported) or manual review | ⬜ TODO | BE-002 | `migrate.js` uses `BEGIN/COMMIT/ROLLBACK`. |
| 2.1.5 | Verify `pgvector` extension | `CREATE EXTENSION IF NOT EXISTS vector;` | ⬜ TODO | DO-001 | Required for AI matching features. Neon supports this. |

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
| 2.3.1 | Core tables exist | `users`, `jobs`, `interviews`, `interview_questions`, `agent_data` | ⬜ TODO |
| 2.3.2 | Feature tables exist | `omniscore`, `trustscore`, `payroll`, `compliance`, `onboarding`, `matching`, etc. | ⬜ TODO |
| 2.3.3 | Seed data loaded | `notification_templates` > 0 rows | ⬜ TODO |
| 2.3.4 | Foreign key constraints | `company_id` references valid (see migration `045_fix_company_id_fk_constraints.sql`) | ⬜ TODO |
| 2.3.5 | Session table | `user_sessions` auto-created by `connect-pg-simple` | ⬜ TODO |

### 2.4 Seed Scripts

```bash
# If seed scripts exist, run them after migration:
# node scripts/seed_notification_templates.js  (if available)
# node scripts/seed_ai_prompts.js               (if available)
```

> **Note:** Check `/scripts/` folder for any seed scripts. If none exist, seed data must be inserted manually or via SQL dump from staging.

---

## 3. SSL / Certificate Verification

| # | Step | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 3.1 | **Custom domain DNS configured** | ⬜ TODO | DO-001 | `rekrutai.co` A/ALIAS record must point to Render's load balancer. Verify in Render dashboard → Custom Domain. |
| 3.2 | `www` redirect configured | ⬜ TODO | DO-001 | Ensure `www.rekrutai.co` → `rekrutai.co` (or vice versa, but be consistent). |
| 3.3 | Render SSL auto-provisioning | ✅ Automatic | — | Render provisions Let's Encrypt automatically once DNS resolves. |
| 3.4 | Verify SSL after deploy | `curl -I https://rekrutai.co` | ⬜ TODO | DO-001 | Valid certificate, no warnings. |
| 3.5 | HTTP → HTTPS redirect | `curl -I http://rekrutai.co` | ⬜ TODO | DO-001 | Must return 301/302 to HTTPS. |
| 3.6 | HSTS header present | `curl -I https://rekrutai.co` | ⬜ TODO | DO-001 | `Strict-Transport-Security` header present (helmet configured with `maxAge: 31536000`). |

### 3.1 Domain Security Checklist

| Service | Action Required | Status |
|---------|-----------------|--------|
| Google OAuth | Add `https://rekrutai.co/api/auth/google/callback` to authorized redirect URIs | ❌ MUST DO |
| LinkedIn OAuth | Add `https://rekrutai.co/api/auth/linkedin/callback` to authorized redirect URIs | ❌ MUST DO |
| Stripe Webhooks | Create endpoint `https://rekrutai.co/api/billing/webhook` with events: `checkout.session.completed`, `invoice.payment_failed`, `customer.subscription.deleted`, etc. | ❌ MUST DO |
| Stripe Checkout URLs | Update success/cancel URLs in Stripe checkout creation code to `https://rekrutai.co/...` | ❌ MUST DO |

---

## 4. Staging → Main Promotion Steps

### 4.1 Promotion Flow

```
feature/* → dev → staging → main (production)
```

### 4.2 Step-by-Step Promotion

| # | Step | Details | Status | Owner |
|---|------|---------|--------|-------|
| 4.2.1 | **Commit uncommitted changes on `dev`** | `git add` + `git commit` all pending changes (dist, e2e, mobile fixes) | ❌ **BLOCKER** | BE-002 |
| 4.2.2 | Open PR: `dev` → `staging` | Include all latest e2e + mobile fixes | ⬜ PENDING | DO-001 |
| 4.2.3 | CI passes on `dev`→`staging` PR | Build, audit, E2E (chromium), health check | ⬜ PENDING | CI/CD |
| 4.2.4 | Merge `dev` → `staging` | Render auto-deploys to `https://rekrutai-staging.onrender.com` | ⬜ PENDING | DO-001 |
| 4.2.5 | Staging smoke tests | Run all E2E against `rekrutai-staging.onrender.com` | ⬜ PENDING | QA-001 |
| 4.2.6 | Open PR: `staging` → `main` | Require 1 approval. Include CI/CD workflows. | ⬜ PENDING | DO-001 |
| 4.2.7 | CI passes on `staging`→`main` PR | Build, audit, E2E, health check | ⬜ PENDING | CI/CD |
| 4.2.8 | Merge `staging` → `main` | Production branch now has CI/CD pipelines. **Does NOT auto-deploy.** | ⬜ PENDING | DO-001 + Suga (CTO) |
| 4.2.9 | Tag release | `git tag -a v2.0.0-20260619` | ⬜ PENDING | DO-001 |

### 4.3 Branch Protection (Must enable before promotion)

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

## 5. Rollback Plan (What to Do If Deployment Fails)

### 5.1 Rollback Triggers

| Condition | Severity | Action | Owner |
|-----------|----------|--------|-------|
| `/health` returns non-200 for > 2 minutes | 🔴 CRITICAL | Immediate Render dashboard rollback | DO-001 |
| 50%+ of smoke tests fail | 🔴 CRITICAL | Git revert + Render dashboard rollback | DO-001 + Suga |
| Database errors in logs | 🔴 CRITICAL | DB snapshot restore + code revert | DO-001 + BE-002 |
| Stripe payment failures | 🔴 CRITICAL | Disable Stripe webhooks + investigate | DO-001 + Ranga (CEO) |
| AI provider circuit breakers tripped | 🟡 MEDIUM | Reset via `/api/ai-health/reset` (admin) | Suga |
| E2E test suite fails on prod | 🟡 MEDIUM | Investigate before rolling back (may be test flake) | QA-001 |

### 5.2 Rollback Procedures

#### Option A: Render Dashboard (Fastest — 1-3 minutes)

1. Go to [Render Dashboard](https://dashboard.render.com/) → `rekrutai-prod`
2. Click **"Manual Deploy"** → **"Deploy a specific commit"**
3. Select the last known good commit (`fb1fdb3` or the pre-deploy commit)
4. Wait for health check to pass (~2-3 minutes)
5. Verify: `curl https://rekrutai.co/health` → `200 OK`

#### Option B: Git Revert + Redeploy (3-5 minutes)

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
4. Restore time: ~15-30 minutes

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
| Detect failure | 1-2 minutes (health check polling) |
| Trigger rollback | 2 minutes (dashboard navigation) |
| Render deploys previous commit | 3-5 minutes |
| Verify rollback | 1 minute |
| **Total** | **7-10 minutes** |

---

## 6. Post-Deployment Verification Steps

### 6.1 Immediate Health Checks (within 2 minutes of deploy)

| # | Endpoint | Expected Result | Status |
|---|----------|-----------------|--------|
| 6.1.1 | `GET https://rekrutai.co/health` | `{"status":"ok","timestamp":"..."}` | ⬜ TODO |
| 6.1.2 | `GET https://rekrutai.co/api/health` | `{"status":"ok","timestamp":"..."}` | ⬜ TODO |
| 6.1.3 | `GET https://rekrutai.co/` | `200 OK`, React SPA loads, hero visible | ⬜ TODO |
| 6.1.4 | `GET https://rekrutai.co/login` | `200 OK`, login form renders | ⬜ TODO |
| 6.1.5 | `GET https://rekrutai.co/pricing` | `200 OK`, pricing tiers visible | ⬜ TODO |
| 6.1.6 | `GET https://rekrutai.co/about` | `200 OK`, about page loads | ⬜ TODO |

### 6.2 Functional Smoke Tests (within 15 minutes of deploy)

| # | Test | Steps | Expected Result | Status |
|---|------|-------|-----------------|--------|
| 6.2.1 | Homepage render | Load `/`, check hero, features, pricing, testimonials | All sections visible, no console errors | ⬜ TODO |
| 6.2.2 | Login flow | Use production test credentials | Login succeeds, redirects to dashboard | ⬜ TODO |
| 6.2.3 | Candidate jobs page | Login as candidate, navigate to `/candidate/jobs` | Job listings load, search/filter work | ⬜ TODO |
| 6.2.4 | Recruiter dashboard | Login as recruiter, navigate to `/recruiter/dashboard` | Dashboard loads, analytics visible | ⬜ TODO |
| 6.2.5 | Recruiter candidates | Navigate to `/recruiter/candidates` | Candidate search loads, SQL query works | ⬜ TODO |
| 6.2.6 | Dark mode toggle | Click dark mode toggle on any page | Theme switches, persists on reload | ⬜ TODO |
| 6.2.7 | Mobile responsive | Emulate iPhone 14 in DevTools | Layout adapts, no horizontal scroll | ⬜ TODO |
| 6.2.8 | Stripe pricing page | Load `/pricing` | Free / Pro / Enterprise tiers visible | ⬜ TODO |
| 6.2.9 | Registration | Create a new test account | Account created, welcome email sent (if email configured) | ⬜ TODO |
| 6.2.10 | Admin panel | Login with admin credentials at `/admin` | Admin dashboard loads, metrics visible | ⬜ TODO |

### 6.3 API Smoke Tests

| # | Endpoint | Auth | Expected Result | Status |
|---|----------|------|-----------------|--------|
| 6.3.1 | `GET /api/auth/me` | Session cookie | Returns current user object | ⬜ TODO |
| 6.3.2 | `GET /api/jobs` | Public | Returns job listings | ⬜ TODO |
| 6.3.3 | `GET /api/recruiter/candidates` | Recruiter session | Returns candidates | ⬜ TODO |
| 6.3.4 | `POST /api/ai-health/verify` | Admin | Runs AI provider verification | ⬜ TODO |
| 6.3.5 | `GET /api/admin/metrics` | Admin | Returns request metrics | ⬜ TODO |
| 6.3.6 | `GET /api/ai-health` | Admin | Returns provider circuit breaker status | ⬜ TODO |

### 6.4 Security Smoke Tests

| # | Test | Tool / Command | Expected Result | Status |
|---|------|---------------|-----------------|--------|
| 6.4.1 | Security headers | `curl -I https://rekrutai.co/` | `X-Frame-Options`, `X-Content-Type-Options`, `HSTS`, `CSP` present | ⬜ TODO |
| 6.4.2 | `x-powered-by` absent | `curl -I https://rekrutai.co/\| grep -i powered` | No match | ⬜ TODO |
| 6.4.3 | HTTPS enforcement | `curl -I http://rekrutai.co/` | Redirects to HTTPS | ⬜ TODO |
| 6.4.4 | CORS rejection | `curl -H "Origin: https://evil.com" https://rekrutai.co/api/jobs` | `403` or CORS error | ⬜ TODO |
| 6.4.5 | CSRF protection | POST to `/api/auth/logout` without CSRF token | `403` (if CSRF enforced) | ⬜ TODO |
| 6.4.6 | JWT expiration | Use expired token | `401` Unauthorized | ⬜ TODO |
| 6.4.7 | Page load time | DevTools Network tab | < 500ms static assets, < 1.5s full page | ⬜ TODO |
| 6.4.8 | Lighthouse score | Chrome DevTools Lighthouse | Performance > 85, Accessibility > 85, SEO > 90, Best Practices > 90 | ⬜ TODO |

### 6.5 E2E Test Suite on Production (Run within 1 hour of deploy)

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
| `GET /api/admin/token-usage` | Admin | OpenAI token budget status | ✅ Implemented |
| `GET /api/ai-health/models` | Admin | Available model list | ✅ Implemented |
| `GET /api/ai-health/failover-stats` | Admin | Failover statistics | ✅ Implemented |
| `GET /api/ai-health/predictions` | Admin | Usage predictions | ✅ Implemented |
| `GET /api/ai-health/daily-breakdown` | Admin | Daily token usage | ✅ Implemented |

### 7.2 Missing Monitoring (Post-Launch Must-Have)

| # | Tool | Purpose | Cost | Timeline | Status |
|---|------|---------|------|----------|--------|
| 7.2.1 | **UptimeRobot** (or Pingdom / Better Uptime) | External uptime monitoring for `https://rekrutai.co/health` | Free tier (50 monitors) | **Before launch** | ❌ NOT SET UP |
| 7.2.2 | **Sentry** | Error tracking (React frontend + Node.js backend) | Free tier (5K errors/month) | Within 1 week of launch | ❌ NOT SET UP |
| 7.2.3 | **Log aggregation** | Render logs are ephemeral (~7 days). Forward to Datadog / Papertrail / Splunk. | Variable | Within 2 weeks | ❌ NOT SET UP |
| 7.2.4 | **Database monitoring** | Slow query alerts, connection pool monitoring | Neon dashboard + custom | Within 2 weeks | ❌ NOT SET UP |
| 7.2.5 | **SSL expiry monitoring** | Render auto-renews, but external alert is good practice | Free (UptimeRobot can check) | Before launch | ❌ NOT SET UP |

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
| **CI** | `.github/workflows/ci.yml` | PR to `dev`/`staging`/`main`, push to `dev`/`staging` | ✅ Present in `dev`/`staging` |
| **Deploy** | `.github/workflows/deploy.yml` | `workflow_dispatch` on `main` only | ✅ Present in `dev`/`staging` |

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

### 8.4 Critical Pipeline Gap

| Issue | Impact | Action Required |
|-------|--------|-----------------|
| **CI/CD workflows are NOT in `main` branch** | If you try to run "Deploy to Production" from GitHub Actions on `main`, the workflow files won't exist. | Merge `staging` → `main` to bring `.github/workflows/` to production branch. **This is a blocker.** |

---

## 9. Known Blockers & Missing Pieces

### 🔴 CRITICAL Blockers (Must Resolve Before Deploy)

| ID | Blocker | Severity | Owner | Action Required | ETA |
|----|---------|----------|-------|-----------------|-----|
| B1 | **Uncommitted changes on `dev`** | 🔴 CRITICAL | BE-002 | Commit all dist artifacts, e2e fixes, mobile fixes. Cannot merge to staging with dirty working tree. | June 9 |
| B2 | **CI/CD workflows missing in `main`** | 🔴 CRITICAL | DO-001 | Merge `staging` → `main` PR to bring `ci.yml` + `deploy.yml` to production branch. | June 10 |
| B3 | **Production secrets not set in Render** | 🔴 CRITICAL | DO-001 + Suga | Set all `sync: false` env vars in Render dashboard (JWT, SESSION, ADMIN, STRIPE, AI keys, Email, OAuth). | June 10-11 |
| B4 | **Stripe live keys not configured** | 🔴 CRITICAL | Ranga (CEO) | Replace `sk_test_` with `sk_live_` in production env. Create live webhook endpoint. **CEO approval required.** | June 11 |
| B5 | **Database migrations not run on prod** | 🔴 CRITICAL | DO-001 | Run `node migrate.js` on production DB via Render shell or local with prod DATABASE_URL. Take snapshot first. | June 12 |
| B6 | **Production DB provider mismatch** | 🔴 CRITICAL | DO-001 + Suga | Confirm whether production uses Render PostgreSQL (`rekrutai-prod-db`) or Neon PostgreSQL. If Neon, update `render.yaml` or set `DATABASE_URL` manually. | June 9 |
| B7 | **E2E tests not run on latest commit** | 🟡 HIGH | QA-001 | Run full E2E suite against `dev` (or `staging` after merge). `dark-mode.spec.ts` has known SIGKILL flake — document exception if confirmed infrastructure-only. | June 10-11 |
| B8 | **OAuth redirect URIs not updated** | 🟡 HIGH | Suga | Update Google Cloud Console + LinkedIn Developer Portal to production URLs. | June 11 |
| B9 | **Branch protection not enabled** | 🟡 HIGH | DO-001 | Verify GitHub branch protection rules on `main`, `staging`, `dev`. | June 10 |
| B10 | **CSP `connectSrc` includes dev URL** | 🟡 MEDIUM | BE-002 | Remove `https://rekrutai-dev.onrender.com` from `connectSrc` in production helmet config. Make conditional on `NODE_ENV`. | June 10 |
| B11 | **No external uptime monitoring** | 🟡 MEDIUM | DO-001 | Set up UptimeRobot or similar for `https://rekrutai.co/health`. | June 12-13 |

### 🟡 Non-Blockers (Can Fix Post-Launch)

| ID | Issue | Priority | Recommended Timeline |
|----|-------|----------|---------------------|
| N1 | No Sentry / error tracking | Medium | Within 1 week of launch |
| N2 | No APM / performance monitoring | Medium | Within 2 weeks |
| N3 | No log aggregation | Low | Within 1 month |
| N4 | No automated backup verification | Low | Within 1 month |
| N5 | No WAF / DDoS protection beyond Render | Low | Within 1 month |
| N6 | No penetration testing | Medium | Within 1 month |
| N7 | No multi-region deployment | Low | Future roadmap |
| N8 | No database read replicas | Low | When traffic scales |
| N9 | R2 bucket backup automation | Low | Within 1 month |
| N10 | Admin route rate limiting | Medium | Within 2 weeks |

---

## 10. Pre-Launch Action Plan (Next 11 Days: June 9–19)

### Days 1–2 (June 9–10): Code & Branch Hygiene

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| June 9 | Commit all uncommitted changes on `dev`. Resolve `B1`. | BE-002 | Clean `dev` branch, no uncommitted files. |
| June 9 | Confirm production DB provider (Render vs Neon). Resolve `B6`. | DO-001 + Suga | Documented decision, `render.yaml` updated if needed. |
| June 9 | Fix CSP `connectSrc` to remove dev URL. Resolve `B10`. | BE-002 | Commit to `dev`, included in next merge. |
| June 10 | Open PR: `dev` → `staging`. Run CI. Merge. | DO-001 | `staging` has latest code. |
| June 10 | Open PR: `staging` → `main`. Enable branch protection. Resolve `B2`, `B9`. | DO-001 | `main` has CI/CD workflows. Branch protection enabled. |

### Days 3–4 (June 11–12): Secrets & Infrastructure

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| June 11 | Set all production secrets in Render dashboard. Resolve `B3`. | DO-001 + Suga | All `sync: false` env vars populated. |
| June 11 | Configure Stripe live keys + webhook endpoint. Resolve `B4`. | Ranga (CEO) | Stripe live mode active, webhook verified. |
| June 11 | Update OAuth redirect URIs in Google/LinkedIn consoles. Resolve `B8`. | Suga | OAuth social login works on production. |
| June 12 | Take production DB snapshot. Run migrations. Resolve `B5`. | DO-001 | All 59+ migrations applied, ~105 tables verified. |
| June 12 | Verify `pgvector` extension. Seed notification templates. | DO-001 | AI matching features ready. |

### Days 5–6 (June 13–14): Staging Validation

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| June 13 | Run full E2E suite on `rekrutai-staging.onrender.com`. | QA-001 | E2E report. Document `dark-mode.spec.ts` exception if needed. |
| June 13 | Verify Stripe checkout end-to-end in test mode. | QA-001 | Payment flow confirmed. |
| June 14 | Verify AI features on staging (all providers). | QA-001 | AI health check passes. |
| June 14 | Verify email notifications on staging. | QA-001 | Test email received. |
| June 14 | Run `candidate-critical-flow` + `recruiter-critical-flow` manually. | QA-001 | Core product flows confirmed. |

### Days 7–8 (June 15–16): Production Deploy

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| June 15 | Go/No-Go meeting with stakeholders. | Suga + Ranga | Approved deployment window. |
| June 15 | Trigger GitHub Actions "Deploy to Production" workflow. | DO-001 | CI passes, manual deploy instructions printed. |
| June 15 | Manual deploy via Render dashboard. | DO-001 | `rekrutai-prod` deploys `main` branch. |
| June 16 | Run all smoke tests (Section 6). | DO-001 + QA-001 | Smoke test report. |
| June 16 | Run E2E suite against production (with care on payment tests). | QA-001 | Production E2E report. |
| June 16 | Verify domain, SSL, health checks. | DO-001 | `https://rekrutai.co` fully operational. |

### Days 9–11 (June 17–19): Monitoring & Hardening

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| June 17 | Set up UptimeRobot for `/health`. Resolve `B11`. | DO-001 | External uptime monitoring active. |
| June 17 | Set up Sentry for error tracking. | DO-001 | Error tracking active. |
| June 18 | Monitor first 24–48 hours for errors. | DO-001 + QA-001 | Incident log (ideally empty). |
| June 18 | Document any issues found. | DO-001 | Post-mortem / issue tickets. |
| June 19 | Final sign-off from stakeholders. | Ranga (CEO) | Production declared live. |

---

## 11. Go/No-Go Checklist (Final Decision Gate)

Before deploying to production, **ALL** of the following must be true:

- [ ] **B1 resolved** — All uncommitted changes committed and merged to `main`.
- [ ] **B2 resolved** — CI/CD workflows (`ci.yml`, `deploy.yml`) exist in `main` branch.
- [ ] **B3 resolved** — All production secrets configured in Render dashboard.
- [ ] **B4 resolved** — Stripe live keys configured and webhook endpoint created + verified.
- [ ] **B5 resolved** — Database migrations applied to prod DB and verified (~105 tables, pgvector present).
- [ ] **B6 resolved** — Production DB provider confirmed (Render vs Neon) and correctly wired.
- [ ] **B7 resolved** — E2E tests pass on staging (allowing documented exception for `dark-mode.spec.ts` if confirmed infrastructure-only).
- [ ] **B8 resolved** — OAuth redirect URIs updated to production domain in Google/LinkedIn consoles.
- [ ] **B9 resolved** — Branch protection enabled on `main`, `staging`, `dev`.
- [ ] **B10 resolved** — CSP `connectSrc` does not include dev/staging URLs in production.
- [ ] `staging` branch is stable and passing all CI checks.
- [ ] Smoke tests pass on staging (Section 6.2).
- [ ] Rollback plan understood and documented (team knows how to deploy previous commit via Render dashboard).
- [ ] Cost expectations communicated to stakeholders (~$50-100/mo base + variable API costs).
- [ ] Team is available for first 24 hours post-deploy for incident response.
- [ ] **CEO (Ranga) approves Go/No-Go** — especially for live Stripe mode and untested protected routes.

### Decision:

- [ ] **GO** — All criteria met, deploy on schedule.
- [ ] **NO-GO** — Blockers remain, postpone deployment until resolved.
- [ ] **GO with documented exceptions** — Minor issues documented, mitigation plan in place (e.g., `dark-mode.spec.ts` SIGKILL).

---

## 12. Cost Estimate (Render Bill + External Services)

### 12.1 Render Infrastructure

| Service | Plan | Monthly Cost |
|---------|------|-------------|
| `rekrutai-prod` (Web) | Standard | ~$25/mo |
| `rekrutai-prod-db` (PostgreSQL) | Standard | ~$20-25/mo |
| **Production Subtotal** | | **~$45-50/mo** |
| `rekrutai-staging` (Web) | Starter | ~$0 (free tier) |
| `rekrutai-staging-db` (PostgreSQL) | Starter | ~$0 (free tier) |
| `rekrutai-dev` (Web) | Starter | ~$0 (free tier) |
| `rekrutai-dev-db` (PostgreSQL) | Starter | ~$0 (free tier) |
| **Non-Prod Subtotal** | | **~$0/mo** |

### 12.2 External Services (Variable)

| Service | Estimated Monthly | Notes |
|---------|-------------------|-------|
| Stripe | Per-transaction (2.9% + 30¢) | Only if you have paid users. |
| OpenAI API | $0–500 | Usage-based. Monitor via `/api/ai-health/budget`. |
| NVIDIA NIM API | $0–200 | Usage-based. |
| Groq API | $0–100 | Usage-based. |
| Cerebras API | $0–200 | Enterprise usage. |
| Deepgram (TTS/STT) | $0–50 | Usage-based. |
| Cloudflare R2 | $0.015/GB + egress | Document storage. |
| Email (Gmail/SendGrid) | $0–20 | Volume-dependent. |
| Domain (`rekrutai.co`) | ~$10-15/year | Registrar cost. |
| UptimeRobot | $0 | Free tier sufficient. |
| Sentry | $0 | Free tier (5K errors/month). |
| **External Services Subtotal** | **~$50–1,000+/mo** | Highly variable based on user volume. |

### 12.3 Total Monthly Estimate

| Scenario | Cost |
|----------|------|
| Minimal traffic (Render + low API usage) | **~$50–100/mo** |
| Moderate traffic (Render + moderate API usage) | **~$100–300/mo** |
| High traffic (Render + high API usage, many users) | **~$300–1,000+/mo** |

### 12.4 Cost Optimization Notes

- Standard plan is 1 instance. Scale to 2+ only when traffic demands it.
- Monitor AI costs aggressively via `/api/ai-health/budget` and `/api/ai-health/usage`.
- TTS audio cache is already implemented — verify it's working to reduce Deepgram calls.
- Consider implementing request caching for repeated AI queries (e.g., job description analysis).
- Set `OPENAI_DAILY_TOKEN_BUDGET` explicitly to prevent runaway API bills.

---

## Appendix A: Environment Variable Quick Reference

### Variables to Set in Render Dashboard (Production)

```bash
# === Security (GENERATE NEW — do NOT reuse dev values) ===
JWT_SECRET=<strong_random_256bit_string>
SESSION_SECRET=<strong_random_256bit_string>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong_password_or_bcrypt_hash>

# === Stripe (LIVE KEYS — not test keys) ===
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
# Client-side publishable key must also be live: pk_live_... (in client build)

# === AI Providers (verify quotas and billing on each provider) ===
POLSIA_API_KEY=...
POLSIA_API_URL=https://polsia.com/api/proxy/ai
OPENAI_API_KEY=...
OPENAI_BASE_URL=...
NVIDIA_NIM_API_KEY=...
NIM_BASE_URL=https://integrate.api.nvidia.com/v1
GROQ_API_KEY=...
CEREBRAS_API_KEY=...
DEEPGRAM_API_KEY=...

# NIM model configuration (15+ variables — see render.yaml for full list)
NIM_LLM_MODEL=...
NIM_LLM_LLAMA_8B=...
NIM_LLM_LLAMA_70B=...
NIM_LLM_GEMMA=...
NIM_LLM_GPT_OSS=...
NIM_LLM_NANO_30B=...
NIM_LLM_STEP_FLASH=...
NIM_LLM_ULTRA=...
NIM_REASONING_QWQ=...
NIM_SAFETY_MODEL=...
NIM_SAFETY_REASONING=...
NIM_VISION_GEMMA=...
NIM_VISION_FALLBACK_MODEL=...
NIM_EMBED_MODEL=...
NIM_EMBED_VL=...
NIM_DOCUMENT_MODEL=...
NIM_ASR_MODEL=...
NIM_ASR_V3=...
NIM_TTS_BASE_URL=...
NIM_FASTPITCH_BASE_URL=...
NIM_MAGPIE_ZERO_BASE_URL=...
NIM_MAGPIE_FLOW_BASE_URL=...
NIM_MAGPIE_MULTI_BASE_URL=...

# === R2 Storage ===
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
R2_ENDPOINT=...
R2_PUBLIC_URL=...

# === Email (Gmail example — use app-specific password, not login password) ===
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=noreply@rekrutai.co
SMTP_SECURE=true
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=...
EMAIL_PASS=...
EMAIL_FROM_ADDRESS=noreply@rekrutai.co
EMAIL_FROM_NAME=Rekrut AI
EMAIL_RATE_LIMIT=100
EMAIL_RATE_LIMIT_HOUR=500
EMAIL_RETRY_ATTEMPTS=3
EMAIL_RETRY_DELAY=5000

# === OAuth (must match redirect URIs registered in provider consoles) ===
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://rekrutai.co/api/auth/google/callback
LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...
LINKEDIN_REDIRECT_URI=https://rekrutai.co/api/auth/linkedin/callback

# === Monitoring (optional but recommended) ===
OPENAI_DAILY_TOKEN_BUDGET=100000
```

---

## Appendix B: Useful Commands

```bash
# === Health Checks ===
curl -s https://rekrutai.co/health | jq .
curl -s https://rekrutai-staging.onrender.com/health | jq .
curl -s https://rekrutai-dev.onrender.com/health | jq .

# === Database ===
# Run migrations locally (against prod DB — use with caution)
DATABASE_URL="prod_connection_string" node migrate.js

# Check table count
psql $DATABASE_URL -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"

# Check migrations
psql $DATABASE_URL -c "SELECT * FROM _migrations ORDER BY applied_at DESC;"

# Verify pgvector
psql $DATABASE_URL -c "SELECT * FROM pg_extension WHERE extname = 'vector';"

# === E2E Tests ===
# Run against staging
BASE_URL=https://rekrutai-staging.onrender.com npx playwright test --project=chromium

# Run against production
BASE_URL=https://rekrutai.co npx playwright test --project=chromium

# Run specific test
npx playwright test e2e/auth-persistence.spec.ts --project=chromium

# === Build ===
cd client && npm ci && npm run build

# Check bundle size
ls -lah client/dist/assets/

# === Security ===
# Check headers
curl -I https://rekrutai.co/

# Check CORS rejection
curl -H "Origin: https://evil.com" -I https://rekrutai.co/api/jobs

# === Git ===
# View branch diff
git log main..dev --oneline
git log main..staging --oneline

# Check uncommitted changes
git status
```

---

## Appendix C: File Reference

| File | Purpose | Status |
|------|---------|--------|
| `render.yaml` | Render infrastructure-as-code (3 web services + 3 DBs) | ✅ Up to date |
| `.github/workflows/ci.yml` | CI pipeline (build, audit, e2e, health) | ✅ Present (needs merge to `main`) |
| `.github/workflows/deploy.yml` | Production deploy pipeline (manual trigger) | ✅ Present (needs merge to `main`) |
| `package.json` | Root scripts: `start`, `build`, `test`, `migrate` | ✅ Up to date |
| `migrate.js` | Database migration runner (transaction-safe) | ✅ Up to date |
| `server.js` | Express server with helmet, CORS, sessions, health endpoints | ✅ Up to date |
| `playwright.config.ts` | E2E test configuration (chromium, 1 worker, 60s timeout) | ✅ Up to date |
| `.env.example` | Template for environment variables | ✅ Up to date |
| `DEPLOYMENT_PROCESS.md` | Detailed CI/CD pipeline documentation | ✅ Up to date |
| `PROD_DEPLOYMENT_CHECKLIST.md` | **This document** | ✅ Updated 2026-06-08 |

---

*Document generated by DevOps Automator (DO-001). Review with CTO (Suga) and CEO (Ranga) before Go/No-Go decision. Update as blockers are resolved.*
