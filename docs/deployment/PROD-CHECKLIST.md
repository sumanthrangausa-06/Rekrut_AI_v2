# Rekrut AI v2 — Production Deployment Checklist (June 19, 2026)

> **Prepared by:** DevOps Automator (DO-001)  
> **Date:** 2026-06-08  
> **Target Deployment:** June 19, 2026 (11 days remaining)  
> **Deploy Target:** Render (`rekrutai-prod`) → `https://rekrutai.co`  
> **Production Branch:** `main`  
> **Scope:** Preparation & documentation only. Do NOT deploy.

---

## Table of Contents

1. [Environment Variables Required](#1-environment-variables-required)
2. [Database Migration Steps](#2-database-migration-steps)
3. [Build Verification Steps](#3-build-verification-steps)
4. [Rollback Plan](#4-rollback-plan)
5. [Smoke Tests Post-Deploy](#5-smoke-tests-post-deploy)
6. [Domain / DNS Verification](#6-domain--dns-verification)
7. [Hardcoded Dev/Staging URLs Found](#7-hardcoded-devstaging-urls-found)
8. [Missing Production Configs](#8-missing-production-configs)
9. [Pre-Launch Action Plan (June 9–19)](#9-pre-launch-action-plan-june-9-19)

---

## 1. Environment Variables Required

### ⚠️ How to set these
- Render `rekrutai-prod` has `autoDeploy: false`.
- All `sync: false` env vars **must be set manually** in the [Render Dashboard](https://dashboard.render.com/) **before** first deployment.
- Variables marked ✅ in `render.yaml` are auto-set; do not override unless needed.

---

### Tier 1 — Security (BLOCKING — must be set before deploy)

| Variable | Render Status | How to Generate | Notes |
|----------|--------------|-----------------|-------|
| `JWT_SECRET` | ❌ MUST SET | `openssl rand -hex 32` | 256-bit random. **Do NOT** reuse dev value. |
| `SESSION_SECRET` | ❌ MUST SET | `openssl rand -hex 32` | 256-bit random. **Do NOT** reuse dev value. |
| `ADMIN_USERNAME` | ❌ MUST SET | Choose strong username | Production admin login. |
| `ADMIN_PASSWORD` | ❌ MUST SET | Choose strong password | Verify if `auth.js` expects plain text or bcrypt hash. |

### Tier 2 — Payment (BLOCKING if paid features enabled)

| Variable | Render Status | How to Generate | Notes |
|----------|--------------|-----------------|-------|
| `STRIPE_SECRET_KEY` | ❌ MUST SET — LIVE KEY | Stripe Dashboard → Live mode | Must start with `sk_live_`. Current `.env` has `sk_test_`. **CEO approval required.** |
| `STRIPE_WEBHOOK_SECRET` | ❌ MUST SET — LIVE | Create webhook endpoint `https://rekrutai.co/api/billing/webhook` in Stripe dashboard first, then copy the signing secret. | Test mode webhook secret will not work. |

> **Note:** There is **no `STRIPE_PUBLISHABLE_KEY` in client code**. The client uses the server-provided `stripeConfigured` boolean (`/api/billing/plans`). No client-side Stripe.js integration to migrate. ✅

### Tier 3 — AI Providers (BLOCKING if AI features enabled)

| Variable | Render Status | Notes |
|----------|--------------|-------|
| `POLSIA_API_KEY` | ❌ MUST SET | Primary AI proxy. |
| `POLSIA_API_URL` | ✅ Set in render.yaml | `https://polsia.com/api/proxy/ai` |
| `OPENAI_API_KEY` | ❌ MUST SET | Fallback provider. Verify quota/billing limit. |
| `OPENAI_BASE_URL` | ❌ MUST SET | If using a proxy (e.g., `https://api.openai.com/v1`). |
| `NVIDIA_NIM_API_KEY` | ❌ MUST SET | Fallback provider. |
| `NIM_BASE_URL` | ❌ MUST SET | Default: `https://integrate.api.nvidia.com/v1` |
| `GROQ_API_KEY` | ❌ MUST SET | Fast fallback. |
| `CEREBRAS_API_KEY` | ❌ MUST SET | Enterprise fallback. |
| `DEEPGRAM_API_KEY` | ❌ MUST SET | TTS/STT audio features. |
| `NIM_*` model vars (15+) | ❌ MUST SET | See `render.yaml` for full list. Includes: `NIM_LLM_MODEL`, `NIM_LLM_LLAMA_8B`, `NIM_LLM_LLAMA_70B`, `NIM_LLM_ULTRA`, `NIM_LLM_NANO_30B`, `NIM_LLM_GPT_OSS`, `NIM_LLM_GPT_OSS_20B`, `NIM_LLM_STEP_FLASH`, `NIM_REASONING_QWQ`, `NIM_SAFETY_MODEL`, `NIM_SAFETY_REASONING`, `NIM_VISION_FALLBACK_MODEL`, `NIM_VISION_GEMMA`, `NIM_EMBED_MODEL`, `NIM_EMBED_VL`, `NIM_DOCUMENT_MODEL`, `NIM_ASR_MODEL`, `NIM_ASR_V3` |
| `NIM_TTS_BASE_URL` | ❌ MUST SET | TTS service endpoint. |
| `NIM_FASTPITCH_BASE_URL` | ❌ MUST SET | FastPitch TTS endpoint. |
| `NIM_MAGPIE_FLOW_BASE_URL` | ❌ MUST SET | Magpie Flow endpoint. |
| `NIM_MAGPIE_MULTI_BASE_URL` | ❌ MUST SET | Magpie Multi endpoint. |
| `NIM_MAGPIE_ZERO_BASE_URL` | ❌ MUST SET | Magpie Zero endpoint. |
| `OPENAI_DAILY_TOKEN_BUDGET` | ⚠️ RECOMMENDED | Defaults to 100K in code. Set explicitly to control costs. |

### Tier 4 — Cloud Storage (R2) — NOT CURRENTLY USED IN CODE

| Variable | Render Status | Notes |
|----------|--------------|-------|
| `R2_ACCESS_KEY_ID` | ❌ MUST SET | Cloudflare R2. |
| `R2_SECRET_ACCESS_KEY` | ❌ MUST SET | R2 secret. |
| `R2_BUCKET_NAME` | ❌ MUST SET | Bucket name. |
| `R2_ENDPOINT` | ❌ MUST SET | S3-compatible endpoint. |
| `R2_PUBLIC_URL` | ❌ MUST SET | Public CDN URL. |

> ⚠️ **Finding:** `R2_*` variables are listed in `render.yaml` but **not referenced anywhere in the application code**. Document uploads go to `https://polsia.com/api/proxy/r2/upload` via `POLSIA_API_KEY`. Either these R2 variables are legacy/placeholder, or there is planned direct R2 integration. **Action:** Confirm with Suga (CTO) whether R2 direct access is needed. If not, remove from `render.yaml` to reduce confusion.

### Tier 5 — Email / SMTP (BLOCKING if email notifications enabled)

| Variable | Render Status | Notes |
|----------|--------------|-------|
| `SMTP_HOST` | ❌ MUST SET | e.g., `smtp.gmail.com`, `smtp.sendgrid.net` |
| `SMTP_PORT` | ❌ MUST SET | Typically `587` (TLS) or `465` (SSL) |
| `SMTP_USER` | ❌ MUST SET | SMTP username |
| `SMTP_PASS` | ❌ MUST SET | App-specific password |
| `SMTP_FROM` | ❌ MUST SET | `noreply@rekrutai.co` |
| `SMTP_SECURE` | ❌ MUST SET | `true` for production (TLS) |
| `EMAIL_FROM_ADDRESS` | ❌ MUST SET | `noreply@rekrutai.co` (alias for SMTP_FROM) |
| `EMAIL_FROM_NAME` | ❌ MUST SET | `"Rekrut AI"` |
| `EMAIL_RATE_LIMIT` / `EMAIL_RATE_LIMIT_HOUR` | ⚠️ RECOMMENDED | Prevent abuse |
| `EMAIL_RETRY_ATTEMPTS` / `EMAIL_RETRY_DELAY` | ⚠️ RECOMMENDED | Resilience |

> **Note:** The code references both `SMTP_*` and `EMAIL_*` variants. The `routes/notifications.js` and `lib/email.js` (if any) may use one or the other. Verify which prefix the actual email library uses, or set both.

### Tier 6 — OAuth (BLOCKING if social login enabled)

| Variable | Render Status | Notes |
|----------|--------------|-------|
| `GOOGLE_CLIENT_ID` | ❌ MUST SET | Google Cloud Console → OAuth 2.0 credentials |
| `GOOGLE_CLIENT_SECRET` | ❌ MUST SET | Rotate if previously used for dev |
| `GOOGLE_REDIRECT_URI` | ✅ Set in render.yaml | `https://rekrutai.co/api/auth/google/callback` — **must also be registered in Google Cloud Console** |
| `LINKEDIN_CLIENT_ID` | ❌ MUST SET | LinkedIn Developer Portal |
| `LINKEDIN_CLIENT_SECRET` | ❌ MUST SET | Rotate if previously used for dev |
| `LINKEDIN_REDIRECT_URI` | ✅ Set in render.yaml | `https://rekrutai.co/api/auth/linkedin/callback` — **must also be registered in LinkedIn Developer Portal** |

### Tier 7 — Render-Auto-Set (No action needed unless override required)

| Variable | Status | Value in render.yaml |
|----------|--------|---------------------|
| `NODE_ENV` | ✅ | `production` |
| `PORT` | ✅ | `10000` |
| `DATABASE_URL` | ✅ | Auto-wired from `rekrutai-prod-db` (if using Render PostgreSQL) |
| `REKRUT_AI_URL` | ✅ | `https://rekrutai.co` |
| `APP_URL` | ✅ | `https://rekrutai.co` |
| `FRONTEND_URL` | ✅ | `https://rekrutai.co` |
| `BASE_URL` | ✅ | `https://rekrutai.co` |
| `CORS_ORIGINS` | ✅ | `https://rekrutai.co,https://www.rekrutai.co` |
| `FORCE_SSL_VERIFY` | ✅ | `true` |

> ⚠️ **DATABASE INFRASTRUCTURE QUESTION:** The current `.env` uses **Neon PostgreSQL** (`ep-calm-field-aipg6g97-pooler...`), but `render.yaml` defines `rekrutai-prod-db` as a **Render PostgreSQL** service. If production uses Neon instead of Render's DB, the `DATABASE_URL` in `render.yaml` will be incorrect. **Action:** Confirm production DB provider and either (a) update `render.yaml` to use `fromDatabase: rekrutai-prod-db` with Render PostgreSQL, or (b) set `DATABASE_URL` manually in Render dashboard pointing to Neon, and remove the `fromDatabase` block.

### Tier 8 — Client Environment Variables

| Variable | Status | Notes |
|----------|--------|-------|
| `VITE_API_URL` | ⚠️ RECOMMENDED | Only used in `client/src/pages/candidate/screening.tsx`. If not set, it defaults to `''` (relative URLs), which works fine when client and API are same origin. No action needed if serving client from same domain as API. |

---

## 2. Database Migration Steps

### 2.1 Pre-Migration Checklist

| # | Step | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 2.1.1 | **Take production DB snapshot** | ⬜ TODO | DO-001 | Render dashboard → `rekrutai-prod-db` → Snapshots → Create snapshot. **Do this before any migration.** |
| 2.1.2 | Confirm production DB connection | ⬜ TODO | DO-001 | `psql "$DATABASE_URL" -c "SELECT NOW();"` |
| 2.1.3 | List pending migrations | ⬜ TODO | DO-001 | Compare `_migrations` table vs `/migrations/` folder (59+ `.js` + 2 `.sql` + 1 seed). |
| 2.1.4 | Verify `pgvector` extension | ⬜ TODO | DO-001 | `CREATE EXTENSION IF NOT EXISTS vector;` — Required for AI matching. |
| 2.1.5 | Run migrations in dry-run if supported | ⬜ TODO | BE-002 | `migrate.js` uses `BEGIN/COMMIT/ROLLBACK`. Review any new migrations for destructive operations. |

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

# 6. Run seed script (if needed)
node migrations/seed_notification_templates.js
```

### 2.3 Post-Migration Verification

| # | Check | Expected Result | Status |
|---|-------|-----------------|--------|
| 2.3.1 | Core tables exist | `users`, `jobs`, `interviews`, `interview_questions`, `agent_data` | ⬜ TODO |
| 2.3.2 | Feature tables exist | `omniscore`, `trustscore`, `payroll`, `compliance`, `onboarding`, `matching`, `ai_call_log`, `ai_prompts`, `ai_prompt_versions`, `ai_ab_tests` | ⬜ TODO |
| 2.3.3 | Seed data loaded | `notification_templates` > 0 rows | ⬜ TODO |
| 2.3.4 | Session table ready | `user_sessions` auto-created by `connect-pg-simple` on first request | ⬜ TODO |
| 2.3.5 | Foreign key constraints valid | `company_id` references valid (see `045_fix_company_id_fk_constraints.sql`) | ⬜ TODO |

---

## 3. Build Verification Steps

### 3.1 Local Build Verification (Before Merge to `main`)

| # | Step | Command | Expected Result | Status |
|---|------|---------|-----------------|--------|
| 3.1.1 | Root install | `npm ci` | Exit 0, no vulnerabilities | ⬜ TODO |
| 3.1.2 | Client install | `cd client && npm ci` | Exit 0 | ⬜ TODO |
| 3.1.3 | Client build | `cd client && npm run build` | Exit 0, `dist/` generated | ⬜ TODO |
| 3.1.4 | TypeScript check | `cd client && npx tsc --noEmit` | No type errors | ⬜ TODO |
| 3.1.5 | Bundle size check | Inspect `client/dist/assets/` | No chunk > 2MB (hard limit). Ideal < 600KB. | ⬜ TODO |
| 3.1.6 | Syntax check server | `node -c server.js` | No syntax errors | ✅ PASS |
| 3.1.7 | Syntax check routes | `for f in routes/*.js; do node -c "$f"; done` | No syntax errors | ⬜ TODO |
| 3.1.8 | Security audit | `npm audit --audit-level high` | 0 high/critical vulnerabilities | ⬜ TODO |

### 3.2 CI/CD Pipeline Verification

| # | Step | Expected Result | Status |
|---|------|-----------------|--------|
| 3.2.1 | CI workflow in `main` | `.github/workflows/ci.yml` exists | ❌ **BLOCKER** — currently only in `staging`/`dev` |
| 3.2.2 | Deploy workflow in `main` | `.github/workflows/deploy.yml` exists | ❌ **BLOCKER** — currently only in `staging`/`dev` |
| 3.2.3 | Branch protection on `main` | Require PR + 1 approval + status checks | ⬜ VERIFY |
| 3.2.4 | CI passes on `staging` | Build, audit, E2E all green | ⬜ TODO |
| 3.2.5 | E2E passes on `staging` | Full suite against `rekrutai-staging.onrender.com` | ⬜ TODO |

> **CRITICAL:** The `staging` branch is 3 commits ahead of `main`. CI/CD workflows (`ci.yml`, `deploy.yml`) are **not yet in `main`**. This is a **deploy blocker**. Merge `staging` → `main` (or cherry-pick `.github/workflows/`) before production deploy.

---

## 4. Rollback Plan

### 4.1 Rollback Triggers

| Condition | Severity | Action | Time |
|-----------|----------|--------|------|
| `/health` returns non-200 for > 2 minutes | 🔴 CRITICAL | Immediate Render dashboard rollback | 1–3 min |
| 50%+ of smoke tests fail | 🔴 CRITICAL | Git revert + Render dashboard rollback | 3–5 min |
| Database errors in logs | 🔴 CRITICAL | DB snapshot restore + code revert | 15–30 min |
| Stripe payment failures | 🔴 CRITICAL | Disable Stripe webhooks + investigate | 5–10 min |
| AI provider circuit breakers tripped | 🟡 MEDIUM | Reset via `/api/ai-health/reset` (admin) | 1 min |
| E2E test suite fails on prod | 🟡 MEDIUM | Investigate before rolling back (may be test flake) | 10–20 min |

### 4.2 Rollback Procedures

#### Option A: Render Dashboard (Fastest — 1–3 minutes)

1. Go to [Render Dashboard](https://dashboard.render.com/) → `rekrutai-prod`
2. Click **"Manual Deploy"** → **"Deploy a specific commit"**
3. Select the last known good commit (`13812c5` or the pre-deploy commit)
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

### 4.3 Communication Plan

| Event | Channel | Message Template |
|-------|---------|-----------------|
| Rollback initiated | `#deployments` (Slack/Discord) | `🚨 Rollback initiated — reverting to commit [X]. Reason: [Y]. ETA: 2 min.` |
| Rollback complete | `#deployments` | `✅ Rollback complete. Production at [commit]. Health: OK. Investigating root cause.` |
| All-clear | `#deployments` | `✅ Post-rollback verification complete. Issue ticket: [link].` |

---

## 5. Smoke Tests Post-Deploy

### 5.1 Immediate Health Checks (within 2 minutes of deploy)

| # | Endpoint | Expected Result | Status |
|---|----------|-----------------|--------|
| 5.1.1 | `GET https://rekrutai.co/health` | `{"status":"ok","timestamp":"..."}` | ⬜ TODO |
| 5.1.2 | `GET https://rekrutai.co/api/health` | `{"status":"ok","timestamp":"..."}` | ⬜ TODO |
| 5.1.3 | `GET https://rekrutai.co/` | `200 OK`, React SPA loads, hero visible | ⬜ TODO |
| 5.1.4 | `GET https://rekrutai.co/login` | `200 OK`, login form renders | ⬜ TODO |
| 5.1.5 | `GET https://rekrutai.co/pricing` | `200 OK`, pricing tiers visible | ⬜ TODO |
| 5.1.6 | `GET https://rekrutai.co/about` | `200 OK`, about page loads | ⬜ TODO |

### 5.2 Functional Smoke Tests (within 15 minutes of deploy)

| # | Test | Steps | Expected Result | Status |
|---|------|-------|-----------------|--------|
| 5.2.1 | Homepage render | Load `/`, check hero, features, pricing, testimonials | All sections visible, no console errors | ⬜ TODO |
| 5.2.2 | Login flow | Use production test credentials | Login succeeds, redirects to dashboard | ⬜ TODO |
| 5.2.3 | Candidate jobs page | Login as candidate, navigate to `/candidate/jobs` | Job listings load, search/filter work | ⬜ TODO |
| 5.2.4 | Recruiter dashboard | Login as recruiter, navigate to `/recruiter/dashboard` | Dashboard loads, analytics visible | ⬜ TODO |
| 5.2.5 | Dark mode toggle | Click dark mode toggle on any page | Theme switches, persists on reload | ⬜ TODO |
| 5.2.6 | Mobile responsive | Emulate iPhone 14 in DevTools | Layout adapts, no horizontal scroll | ⬜ TODO |
| 5.2.7 | Stripe pricing page | Load `/pricing` | Free / Pro / Enterprise tiers visible; if Stripe configured, checkout works | ⬜ TODO |
| 5.2.8 | Admin panel | Login with admin credentials at `/admin` | Admin dashboard loads, metrics visible | ⬜ TODO |
| 5.2.9 | AI health check | `POST /api/ai-health/verify` (admin) | All AI providers return healthy | ⬜ TODO |

### 5.3 API Smoke Tests

| # | Endpoint | Auth | Expected Result | Status |
|---|----------|------|-----------------|--------|
| 5.3.1 | `GET /api/auth/me` | Session cookie | Returns current user object | ⬜ TODO |
| 5.3.2 | `GET /api/jobs` | Public | Returns job listings | ⬜ TODO |
| 5.3.3 | `GET /api/recruiter/candidates` | Recruiter session | Returns candidates | ⬜ TODO |
| 5.3.4 | `GET /api/admin/metrics` | Admin | Returns request metrics | ⬜ TODO |
| 5.3.5 | `GET /api/ai-health` | Admin | Returns provider circuit breaker status | ⬜ TODO |
| 5.3.6 | `GET /api/billing/plans` | Public | Returns plans + `stripeConfigured` flag | ⬜ TODO |

### 5.4 Security Smoke Tests

| # | Test | Tool / Command | Expected Result | Status |
|---|------|---------------|-----------------|--------|
| 5.4.1 | Security headers | `curl -I https://rekrutai.co/` | `X-Frame-Options`, `X-Content-Type-Options`, `HSTS`, `CSP` present | ⬜ TODO |
| 5.4.2 | `x-powered-by` absent | `curl -I https://rekrutai.co/ \| grep -i powered` | No match | ⬜ TODO |
| 5.4.3 | HTTPS enforcement | `curl -I http://rekrutai.co/` | Redirects to HTTPS (301/302) | ⬜ TODO |
| 5.4.4 | CORS rejection | `curl -H "Origin: https://evil.com" https://rekrutai.co/api/jobs` | `403` or CORS error | ⬜ TODO |
| 5.4.5 | HSTS header | `curl -I https://rekrutai.co/` | `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` | ⬜ TODO |

### 5.5 E2E Test Suite on Production (Run within 1 hour of deploy)

```bash
# Run E2E tests against production (with live credentials)
BASE_URL=https://rekrutai.co npx playwright test --project=chromium
```

| Spec File | Status | Notes |
|-----------|--------|-------|
| `auth-persistence.spec.ts` | ⬜ TODO | 8 tests — auth, token, jobs browse, mobile responsive, settings |
| `candidate-critical-flow.spec.ts` | ⬜ TODO | Candidate jobs, profile, applications |
| `recruiter-critical-flow.spec.ts` | ⬜ TODO | Recruiter dashboard, candidates, job posting |
| `public-pages.spec.ts` | ⬜ TODO | Login, register, pricing, blog, home |
| `navigation-flow.spec.ts` | ⬜ TODO | Visitor, candidate, recruiter navigation |
| `dark-mode.spec.ts` | ⬜ TODO | Known flaky — browser SIGKILL. If fails, verify manually and document exception. |
| `admin-critical-flow.spec.ts` | ⬜ TODO | Admin login, metrics, activity logs |

> ⚠️ `dark-mode.spec.ts` has a known SIGKILL/browser crash issue. If it fails on production, verify manually that dark mode works, and document the exception. Do not block deployment solely on this test if the failure is confirmed to be infrastructure-related.

---

## 6. Domain / DNS Verification

### 6.1 DNS Configuration

| # | Step | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 6.1.1 | **Custom domain DNS configured** | ⬜ TODO | DO-001 | `rekrutai.co` A/ALIAS record must point to Render's load balancer. Verify in Render dashboard → Custom Domain. |
| 6.1.2 | `www` redirect configured | ⬜ TODO | DO-001 | Ensure `www.rekrutai.co` → `rekrutai.co` (or vice versa, but be consistent). |
| 6.1.3 | Render SSL auto-provisioning | ✅ Automatic | — | Render provisions Let's Encrypt automatically once DNS resolves. |
| 6.1.4 | Verify SSL after deploy | ⬜ TODO | DO-001 | `curl -I https://rekrutai.co` → Valid certificate, no warnings. |
| 6.1.5 | HTTP → HTTPS redirect | ⬜ TODO | DO-001 | `curl -I http://rekrutai.co` → Must return 301/302 to HTTPS. |
| 6.1.6 | HSTS header present | ⬜ TODO | DO-001 | `Strict-Transport-Security` header present (helmet configured with `maxAge: 31536000`). |

### 6.2 Third-Party Service Domain Configuration

| Service | Action Required | Status |
|---------|-----------------|--------|
| Google OAuth | Add `https://rekrutai.co/api/auth/google/callback` to authorized redirect URIs | ❌ MUST DO |
| LinkedIn OAuth | Add `https://rekrutai.co/api/auth/linkedin/callback` to authorized redirect URIs | ❌ MUST DO |
| Stripe Webhooks | Create endpoint `https://rekrutai.co/api/billing/webhook` with events: `checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.deleted` | ❌ MUST DO |
| Stripe Checkout URLs | `success_url` and `cancel_url` in `routes/billing.js` use `getFrontendBaseUrl(req)` which falls back to `FRONTEND_URL` env var. Verify `FRONTEND_URL` is set to `https://rekrutai.co`. | ✅ Verified |
| Polsia AI Proxy | Verify `POLSIA_API_URL` allows requests from `https://rekrutai.co` origin | ⬜ TODO |
| R2 / Cloudflare CDN | If using direct R2, verify CORS policy allows `rekrutai.co` | ⬜ TODO |

---

## 7. Hardcoded Dev/Staging URLs Found

### 7.1 🟡 MUST FIX BEFORE PRODUCTION

| File | Line | Hardcoded URL | Issue | Fix |
|------|------|---------------|-------|-----|
| `server.js` | 88 | `https://rekrutai-dev.onrender.com` | CORS production fallback includes dev URL | **Remove** `https://rekrutai-dev.onrender.com` from the production fallback array. The array should only contain `https://rekrutai.co`, `https://www.rekrutai.co`, `https://app.rekrutai.co`. |
| `server.js` | 89 | `https://hireloop-vzvw.polsia.app` | Development CORS includes old Polsia app URL | Acceptable for dev, but verify it doesn't leak to prod. |

### 7.2 ✅ ACCEPTABLE (Dev/Test Utilities Only)

| File | Line | Hardcoded URL | Context |
|------|------|---------------|---------|
| `server.js` | 69 | `https://rekrutai-dev.onrender.com` | CSP `connectSrc` — **correctly conditional** on `NODE_ENV === 'development'`. Safe. |
| `client/vite.config.ts` | 20 | `http://localhost:3000` | Vite dev proxy. Dev-only. |
| `playwright.config.ts` | 29 | `http://localhost:3000` | E2E test baseURL. Test-only. |
| `test-action-functions.js` | 9 | `http://localhost:3000` | Test utility. Acceptable. |
| `test-login.js` | 3 | `https://rekrutai-dev.onrender.com` | Dev test script. Acceptable. |
| `test-new-endpoints.js` | 4 | `https://rekrutai-dev.onrender.com` | Dev test script. Acceptable. |
| `test-recruiter-login.js` | 3 | `https://rekrutai-dev.onrender.com` | Dev test script. Acceptable. |
| `verify-communications.js` | 2 | `https://hireloop-vzvw.polsia.app` | Dev utility script. Acceptable. |
| `verify-phase2-e2e.js` | 8 | `https://hireloop-vzvw.polsia.app` | Dev utility script. Acceptable. |
| `verify-phase2-qa.js` | 7 | `https://hireloop-vzvw.polsia.app` | Dev utility script. Acceptable. |
| `scripts/test-recruiter-analytics.js` | 3 | `http://localhost:3000` | Dev test script. Acceptable. |
| `scripts/test-stripe-flow.js` | 5 | `http://localhost:3000` | Dev test script. Acceptable. |
| `e2e/auth.setup.ts` | 87 | `http://localhost:3000` | E2E auth setup. Test-only. |
| `e2e/payment-flow.spec.ts` | 53 | `http://localhost:3000` | E2E payment mock. Test-only. |
| `e2e/debug-admin.js` | 8 | `http://localhost:3000` | E2E debug script. Test-only. |
| `e2e/.auth/candidate.json` | 5 | `http://localhost:3000` | E2E auth state. Test-only. |
| `e2e/.auth/recruiter.json` | 5 | `http://localhost:3000` | E2E auth state. Test-only. |
| `routes/auth.js` | 690 | `http://localhost:3000` | Password reset fallback URL. Acceptable — has `process.env.FRONTEND_URL` primary. |

### 7.3 ✅ PRODUCTION-HARDCODED (Correct)

| File | Line | URL | Context |
|------|------|-----|---------|
| `client/index.html` | 15 | `https://rekrutai.co/` | Open Graph / Twitter meta tags. Correct for production. |
| `client/index.html` | 22 | `https://rekrutai.co/og-image.png` | OG image. Correct. |
| `client/index.html` | 28 | `https://rekrutai.co/` | Twitter meta. Correct. |
| `client/index.html` | 31 | `https://rekrutai.co/og-image.png` | Twitter image. Correct. |
| `client/src/pages/contact.tsx` | 125 | `mailto:hello@rekrutai.co` | Contact email. Correct. |
| `client/src/pages/contact.tsx` | 272–276 | `https://twitter.com/rekrutai`, `https://linkedin.com/company/rekrutai`, etc. | Social links. Correct. |
| `client/src/pages/privacy.tsx` | 122 | `privacy@rekrutai.co` | Privacy email. Correct. |
| `client/src/pages/terms.tsx` | 166 | `legal@rekrutai.co` | Legal email. Correct. |
| `client/src/pages/terms.tsx` | 171 | `eu-representative@rekrutai.co` | EU rep email. Correct. |
| `client/src/pages/landing.tsx` | 928–937 | Social links to `rekrutai` handles. Correct. |
| `client/src/pages/recruiter/job-form.tsx` | 1258 | `rekrutai.co/recruiter/jobs` | Preview text. Correct. |
| `client/src/pages/pricing.tsx` | 340 | `mailto:hello@rekrutai.co` | Enterprise CTA. Correct. |
| `render.yaml` | — | `https://rekrutai.co` | All URL env vars. Correct. |

---

## 8. Missing Production Configs

### 🔴 CRITICAL Blockers (Must Resolve Before Deploy)

| ID | Blocker | Severity | Owner | Action Required | ETA |
|----|---------|----------|-------|-----------------|-----|
| B1 | **Uncommitted changes on `dev`** | 🔴 CRITICAL | BE-002 | Commit all dist artifacts, e2e fixes, mobile fixes. Cannot merge to staging with dirty working tree. | June 9 |
| B2 | **CI/CD workflows missing in `main`** | 🔴 CRITICAL | DO-001 | Merge `staging` → `main` PR to bring `ci.yml` + `deploy.yml` to production branch. | June 10 |
| B3 | **Production secrets not set in Render** | 🔴 CRITICAL | DO-001 + Suga | Set all `sync: false` env vars in Render dashboard (JWT, SESSION, ADMIN, STRIPE, AI keys, Email, OAuth). | June 10–11 |
| B4 | **Stripe live keys not configured** | 🔴 CRITICAL | Ranga (CEO) | Replace `sk_test_` with `sk_live_` in production env. Create live webhook endpoint. **CEO approval required.** | June 11 |
| B5 | **Database migrations not run on prod** | 🔴 CRITICAL | DO-001 | Run `node migrate.js` on production DB via Render shell or local with prod DATABASE_URL. Take snapshot first. | June 12 |
| B6 | **Production DB provider mismatch** | 🔴 CRITICAL | DO-001 + Suga | Confirm whether production uses Render PostgreSQL (`rekrutai-prod-db`) or Neon PostgreSQL. If Neon, set `DATABASE_URL` manually and remove `fromDatabase` from `render.yaml`. | June 9 |
| B7 | **CORS production fallback includes dev URL** | 🔴 CRITICAL | BE-002 | Remove `https://rekrutai-dev.onrender.com` from `server.js:88` production CORS fallback array. | June 9 |

### 🟡 HIGH Priority (Should Fix Before Deploy)

| ID | Issue | Severity | Owner | Action Required | ETA |
|----|-------|----------|-------|-----------------|-----|
| B8 | **E2E tests not run on latest commit** | 🟡 HIGH | QA-001 | Run full E2E suite against `dev` (or `staging` after merge). `dark-mode.spec.ts` has known SIGKILL flake — document exception if confirmed infrastructure-only. | June 10–11 |
| B9 | **OAuth redirect URIs not updated** | 🟡 HIGH | Suga | Update Google Cloud Console + LinkedIn Developer Portal to production URLs. | June 11 |
| B10 | **Branch protection not enabled** | 🟡 HIGH | DO-001 | Verify GitHub branch protection rules on `main`, `staging`, `dev`. | June 10 |
| B11 | **`.env.example` is incomplete** | 🟡 HIGH | BE-002 | Add missing variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `STRIPE_WEBHOOK_SECRET`, `R2_*`, `NIM_*` model vars, `OPENAI_BASE_URL`, `EMAIL_*` variants, `OPENAI_DAILY_TOKEN_BUDGET`, `FORCE_SSL_VERIFY`. | June 10 |

### 🟡 MEDIUM Priority (Fix Before Deploy If Possible)

| ID | Issue | Severity | Owner | Action Required | ETA |
|----|-------|----------|-------|-----------------|-----|
| B12 | **CSP `connectSrc` cleanup** | 🟡 MEDIUM | BE-002 | `server.js:69` already conditionally includes dev URL only in development. `server.js:88` is the actual bug. Fix B7 covers this. | June 10 |
| B13 | **No external uptime monitoring** | 🟡 MEDIUM | DO-001 | Set up UptimeRobot or similar for `https://rekrutai.co/health`. | June 12–13 |
| B14 | **R2 env vars in render.yaml but unused** | 🟡 MEDIUM | DO-001 + Suga | Confirm if direct R2 access is needed. If not, remove from `render.yaml` to reduce confusion. | June 10 |
| B15 | **Admin route brute-force protection** | 🟡 MEDIUM | BE-002 | No dedicated rate limiter on `/api/admin` login. Add `express-rate-limit` or similar. | June 12–13 |
| B16 | **File upload security** | 🟡 MEDIUM | BE-002 | Verify `multer` limits, file type validation, virus scan in `routes/documents.js`. | June 12–13 |

### 🟢 Non-Blockers (Can Fix Post-Launch)

| ID | Issue | Priority | Recommended Timeline |
|----|-------|----------|---------------------|
| N1 | No Sentry / error tracking | Medium | Within 1 week of launch |
| N2 | No APM / performance monitoring | Medium | Within 2 weeks |
| N3 | No log aggregation (Render logs are ~7 days) | Low | Within 1 month |
| N4 | No automated backup verification | Low | Within 1 month |
| N5 | No WAF / DDoS protection beyond Render | Low | Within 1 month |
| N6 | No penetration testing | Medium | Within 1 month |
| N7 | No multi-region deployment | Low | Future roadmap |
| N8 | No database read replicas | Low | When traffic scales |
| N9 | R2 bucket backup automation | Low | Within 1 month |

---

## 9. Pre-Launch Action Plan (June 9–19)

### Days 1–2 (June 9–10): Code & Branch Hygiene

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| June 9 | Commit all uncommitted changes on `dev`. Resolve B1. | BE-002 | Clean `dev` branch, no uncommitted files. |
| June 9 | Fix CORS production fallback (remove dev URL). Resolve B7. | BE-002 | Commit to `dev`. |
| June 9 | Confirm production DB provider (Render vs Neon). Resolve B6. | DO-001 + Suga | Documented decision, `render.yaml` updated if needed. |
| June 9 | Update `.env.example` with all missing vars. Resolve B11. | BE-002 | Complete `.env.example` merged to `dev`. |
| June 10 | Open PR: `dev` → `staging`. Run CI. Merge. | DO-001 | `staging` has latest code. |
| June 10 | Open PR: `staging` → `main`. Enable branch protection. Resolve B2, B10. | DO-001 | `main` has CI/CD workflows. Branch protection enabled. |

### Days 3–4 (June 11–12): Secrets & Infrastructure

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| June 11 | Set all production secrets in Render dashboard. Resolve B3. | DO-001 + Suga | All `sync: false` env vars populated. |
| June 11 | Configure Stripe live keys + webhook endpoint. Resolve B4. | Ranga (CEO) | Stripe live mode active, webhook verified. |
| June 11 | Update OAuth redirect URIs in Google Cloud Console + LinkedIn. Resolve B9. | Suga | OAuth callbacks registered for production domain. |
| June 12 | Run database migrations on production. Resolve B5. | DO-001 | All migrations applied, tables verified, snapshot taken. |
| June 12 | Seed notification templates (if not already present). | DO-001 | `notification_templates` table populated. |
| June 12 | Set up UptimeRobot (or similar) for `https://rekrutai.co/health`. Resolve B13. | DO-001 | External uptime monitoring active. |

### Days 5–6 (June 13–14): Staging Validation

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| June 13 | Run full E2E suite on `rekrutai-staging.onrender.com`. | QA-001 | E2E report. Document `dark-mode.spec.ts` exception if needed. |
| June 13 | Run security smoke tests on staging. | DO-001 | Security headers, CORS, HTTPS redirect all verified. |
| June 14 | Load test staging (light load — 50 concurrent users). | DO-001 | Performance baseline documented. |
| June 14 | Verify AI provider health on staging (`POST /api/ai-health/verify`). | DO-001 | All AI providers healthy. |

### Days 7–9 (June 15–17): Go/No-Go & Final Prep

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| June 15 | Go/No-Go meeting with Suga (CTO), Ranga (CEO), QA-001. | DO-001 | Decision: Deploy or Delay. |
| June 15 | If No-Go: document blockers, new ETA. | DO-001 | Updated plan. |
| June 16 | If Go: tag release candidate `v2.0.0-rc1`. | DO-001 | Git tag on `main`. |
| June 16 | Verify Render dashboard — all env vars set, service healthy. | DO-001 | Render dashboard green. |
| June 17 | Final DNS check — `rekrutai.co` resolves to Render. | DO-001 | DNS propagation confirmed. |
| June 17 | Prepare rollback commit hash (`13812c5` or last known good). | DO-001 | Documented fallback commit. |

### Day 10 (June 18): Deploy Window

| Time | Action | Owner | Notes |
|------|--------|-------|-------|
| 09:00 CST | Announce deploy window in `#deployments` | DO-001 | 2-hour maintenance window. |
| 09:15 CST | Take final DB snapshot | DO-001 | Last snapshot before deploy. |
| 09:30 CST | Trigger deploy via Render Dashboard → Manual Deploy | DO-001 | Deploy latest commit from `main`. |
| 09:35 CST | Monitor `/health` polling | DO-001 | Expect 200 within 2–3 minutes. |
| 09:45 CST | Run immediate smoke tests (Section 5.1) | DO-001 | All 6 health checks pass. |
| 10:00 CST | Run functional smoke tests (Section 5.2) | DO-001 + QA-001 | All 9 tests pass. |
| 10:30 CST | Run API smoke tests (Section 5.3) | DO-001 | All 6 endpoints respond correctly. |
| 11:00 CST | Run security smoke tests (Section 5.4) | DO-001 | All 5 tests pass. |
| 11:30 CST | Run E2E suite against production | QA-001 | Document any failures. |
| 12:00 CST | Go/No-Go for all-clear | DO-001 + Suga | If all clear → close maintenance window. If issues → initiate rollback (Section 4). |

### Day 11 (June 19): Post-Deploy Monitoring

| Time | Action | Owner | Notes |
|------|--------|-------|-------|
| 09:00 CST | Review Render logs for errors | DO-001 | Check for 5xx, DB connection errors, AI provider failures. |
| 09:30 CST | Review `/api/admin/metrics` | DO-001 | Request counts, latency, error rates normal. |
| 10:00 CST | Review `/api/ai-health/usage` | DO-001 | Token usage within budget. |
| 11:00 CST | Check UptimeRobot alerts | DO-001 | No downtime alerts. |
| 14:00 CST | Customer announcement (if applicable) | Marketing | "Rekrut AI is now live at rekrutai.co!" |
| EOD | Close deployment ticket, update runbook | DO-001 | Document any issues encountered for next deploy. |

---

## Appendix A: Environment Variable Inventory (Complete)

### All `process.env` references found in codebase (excluding Node/Vite/Playwright internals)

| Variable | Used In | Render Status | Required? |
|----------|---------|--------------|-----------|
| `ADMIN_PASSWORD` | `routes/admin.js`, `server.js` | ❌ MUST SET | Yes |
| `ADMIN_USERNAME` | `routes/admin.js`, `server.js` | ❌ MUST SET | Yes |
| `APP_URL` | `server.js`, `routes/billing.js` | ✅ Auto-set | Yes |
| `BASE_URL` | `render.yaml`, test scripts | ✅ Auto-set | Yes |
| `CEREBRAS_API_KEY` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `CORS_ORIGINS` | `server.js` | ✅ Auto-set | Yes |
| `DATABASE_URL` | `lib/db.js`, `server.js` | ✅ Auto-set | Yes |
| `DEEPGRAM_API_KEY` | `lib/polsia-ai.js`, `lib/tts.js` | ❌ MUST SET | If audio enabled |
| `EMAIL_FROM_ADDRESS` | `lib/email.js` (if exists) | ❌ MUST SET | If email enabled |
| `EMAIL_FROM_NAME` | `lib/email.js` (if exists) | ❌ MUST SET | If email enabled |
| `EMAIL_PASS` | `lib/email.js` (if exists) | ❌ MUST SET | If email enabled |
| `EMAIL_RATE_LIMIT` | `lib/email.js` (if exists) | ⚠️ Recommended | No |
| `EMAIL_RATE_LIMIT_HOUR` | `lib/email.js` (if exists) | ⚠️ Recommended | No |
| `EMAIL_RETRY_ATTEMPTS` | `lib/email.js` (if exists) | ⚠️ Recommended | No |
| `EMAIL_RETRY_DELAY` | `lib/email.js` (if exists) | ⚠️ Recommended | No |
| `EMAIL_USER` | `lib/email.js` (if exists) | ❌ MUST SET | If email enabled |
| `FORCE_SSL_VERIFY` | `lib/db.js` (if exists) | ✅ Auto-set | Yes |
| `FRONTEND_URL` | `routes/auth.js`, `routes/billing.js`, `server.js` | ✅ Auto-set | Yes |
| `GOOGLE_CLIENT_ID` | `routes/auth.js` | ❌ MUST SET | If OAuth enabled |
| `GOOGLE_CLIENT_SECRET` | `routes/auth.js` | ❌ MUST SET | If OAuth enabled |
| `GOOGLE_REDIRECT_URI` | `routes/auth.js` | ✅ Auto-set | If OAuth enabled |
| `GROQ_API_KEY` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `JWT_SECRET` | `lib/auth.js`, `routes/auth.js`, `server.js` | ❌ MUST SET | Yes |
| `LINKEDIN_CLIENT_ID` | `routes/auth.js` | ❌ MUST SET | If OAuth enabled |
| `LINKEDIN_CLIENT_SECRET` | `routes/auth.js` | ❌ MUST SET | If OAuth enabled |
| `LINKEDIN_REDIRECT_URI` | `routes/auth.js` | ✅ Auto-set | If OAuth enabled |
| `NIM_ASR_MODEL` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_ASR_V3` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_BASE_URL` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_DOCUMENT_MODEL` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_EMBED_MODEL` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_EMBED_VL` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_FASTPITCH_BASE_URL` | `lib/tts.js` | ❌ MUST SET | If TTS enabled |
| `NIM_LLM_GEMMA` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_LLM_GPT_OSS` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_LLM_GPT_OSS_20B` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_LLM_LLAMA_70B` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_LLM_LLAMA_8B` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_LLM_MODEL` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_LLM_NANO_30B` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_LLM_STEP_FLASH` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_LLM_ULTRA` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_MAGPIE_FLOW_BASE_URL` | `lib/tts.js` | ❌ MUST SET | If TTS enabled |
| `NIM_MAGPIE_MULTI_BASE_URL` | `lib/tts.js` | ❌ MUST SET | If TTS enabled |
| `NIM_MAGPIE_ZERO_BASE_URL` | `lib/tts.js` | ❌ MUST SET | If TTS enabled |
| `NIM_REASONING_QWQ` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_SAFETY_MODEL` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_SAFETY_REASONING` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_TTS_BASE_URL` | `lib/tts.js` | ❌ MUST SET | If TTS enabled |
| `NIM_VISION_FALLBACK_MODEL` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NIM_VISION_GEMMA` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `NODE_ENV` | `server.js`, `routes/*.js` | ✅ Auto-set | Yes |
| `NVIDIA_NIM_API_KEY` | `lib/polsia-ai.js` | ❌ MUST SET | If AI enabled |
| `OPENAI_API_KEY` | `lib/polsia-ai.js`, `lib/openai.js` | ❌ MUST SET | If AI enabled |
| `OPENAI_BASE_URL` | `lib/openai.js` (if exists) | ❌ MUST SET | If AI enabled |
| `OPENAI_DAILY_TOKEN_BUDGET` | `lib/token-budget.js` | ⚠️ Recommended | No |
| `POLSIA_API_KEY` | `lib/polsia-ai.js`, `routes/documents.js`, `server.js` | ❌ MUST SET | If AI enabled |
| `POLSIA_API_URL` | `lib/polsia-ai.js` | ✅ Auto-set | If AI enabled |
| `PORT` | `server.js` | ✅ Auto-set | Yes |
| `REKRUT_AI_URL` | `render.yaml` | ✅ Auto-set | Yes |
| `R2_ACCESS_KEY_ID` | `render.yaml` (not in code) | ❌ MUST SET | Unclear |
| `R2_BUCKET_NAME` | `render.yaml` (not in code) | ❌ MUST SET | Unclear |
| `R2_ENDPOINT` | `render.yaml` (not in code) | ❌ MUST SET | Unclear |
| `R2_PUBLIC_URL` | `render.yaml` (not in code) | ❌ MUST SET | Unclear |
| `R2_SECRET_ACCESS_KEY` | `render.yaml` (not in code) | ❌ MUST SET | Unclear |
| `SESSION_SECRET` | `server.js` | ❌ MUST SET | Yes |
| `SMTP_FROM` | `lib/email.js` (if exists) | ❌ MUST SET | If email enabled |
| `SMTP_HOST` | `lib/email.js` (if exists) | ❌ MUST SET | If email enabled |
| `SMTP_PASS` | `lib/email.js` (if exists) | ❌ MUST SET | If email enabled |
| `SMTP_PORT` | `lib/email.js` (if exists) | ❌ MUST SET | If email enabled |
| `SMTP_SECURE` | `lib/email.js` (if exists) | ❌ MUST SET | If email enabled |
| `SMTP_USER` | `lib/email.js` (if exists) | ❌ MUST SET | If email enabled |
| `STRIPE_SECRET_KEY` | `routes/billing.js` | ❌ MUST SET | If payments enabled |
| `STRIPE_WEBHOOK_SECRET` | `routes/billing.js` | ❌ MUST SET | If payments enabled |
| `VITE_API_URL` | `client/src/pages/candidate/screening.tsx` | ⚠️ Recommended | No |

---

## Appendix B: Render Service Configuration Summary

```yaml
# render.yaml (excerpt)
services:
  - type: web
    name: rekrutai-prod
    env: node
    branch: main
    buildCommand: cd client && npm install --include=dev && npm run build && cd .. && npm install
    startCommand: npm start
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 10000
      - key: DATABASE_URL
        fromDatabase:
          name: rekrutai-prod-db
          property: connectionString
      - key: REKRUT_AI_URL
        value: https://rekrutai.co
      - key: APP_URL
        value: https://rekrutai.co
      - key: FRONTEND_URL
        value: https://rekrutai.co
      - key: BASE_URL
        value: https://rekrutai.co
      - key: CORS_ORIGINS
        value: https://rekrutai.co,https://www.rekrutai.co
      - key: JWT_SECRET
        sync: false
      - key: SESSION_SECRET
        sync: false
      - key: ADMIN_USERNAME
        sync: false
      - key: ADMIN_PASSWORD
        sync: false
      - key: STRIPE_SECRET_KEY
        sync: false
      - key: STRIPE_WEBHOOK_SECRET
        sync: false
      - key: POLSIA_API_KEY
        sync: false
      - key: POLSIA_API_URL
        sync: false
      - key: OPENAI_API_KEY
        sync: false
      - key: OPENAI_BASE_URL
        sync: false
      - key: NVIDIA_NIM_API_KEY
        sync: false
      - key: NIM_BASE_URL
        sync: false
      - key: GROQ_API_KEY
        sync: false
      - key: CEREBRAS_API_KEY
        sync: false
      - key: DEEPGRAM_API_KEY
        sync: false
      - key: R2_ACCESS_KEY_ID
        sync: false
      - key: R2_SECRET_ACCESS_KEY
        sync: false
      - key: R2_BUCKET_NAME
        sync: false
      - key: R2_ENDPOINT
        sync: false
      - key: R2_PUBLIC_URL
        sync: false
      - key: SMTP_HOST
        sync: false
      - key: SMTP_PORT
        sync: false
      - key: SMTP_USER
        sync: false
      - key: SMTP_PASS
        sync: false
      - key: SMTP_FROM
        sync: false
      - key: SMTP_SECURE
        sync: false
      - key: EMAIL_FROM_ADDRESS
        sync: false
      - key: EMAIL_FROM_NAME
        sync: false
      - key: EMAIL_USER
        sync: false
      - key: EMAIL_PASS
        sync: false
      - key: EMAIL_RATE_LIMIT
        sync: false
      - key: EMAIL_RATE_LIMIT_HOUR
        sync: false
      - key: EMAIL_RETRY_ATTEMPTS
        sync: false
      - key: EMAIL_RETRY_DELAY
        sync: false
      - key: GOOGLE_CLIENT_ID
        sync: false
      - key: GOOGLE_CLIENT_SECRET
        sync: false
      - key: GOOGLE_REDIRECT_URI
        sync: false
      - key: LINKEDIN_CLIENT_ID
        sync: false
      - key: LINKEDIN_CLIENT_SECRET
        sync: false
      - key: LINKEDIN_REDIRECT_URI
        sync: false
      - key: FORCE_SSL_VERIFY
        sync: false
      - key: NIM_LLM_MODEL
        sync: false
      - key: NIM_LLM_LLAMA_8B
        sync: false
      - key: NIM_LLM_LLAMA_70B
        sync: false
      - key: NIM_LLM_ULTRA
        sync: false
      - key: NIM_LLM_NANO_30B
        sync: false
      - key: NIM_LLM_GPT_OSS
        sync: false
      - key: NIM_LLM_GPT_OSS_20B
        sync: false
      - key: NIM_LLM_STEP_FLASH
        sync: false
      - key: NIM_LLM_GEMMA
        sync: false
      - key: NIM_REASONING_QWQ
        sync: false
      - key: NIM_SAFETY_MODEL
        sync: false
      - key: NIM_SAFETY_REASONING
        sync: false
      - key: NIM_VISION_FALLBACK_MODEL
        sync: false
      - key: NIM_VISION_GEMMA
        sync: false
      - key: NIM_EMBED_MODEL
        sync: false
      - key: NIM_EMBED_VL
        sync: false
      - key: NIM_DOCUMENT_MODEL
        sync: false
      - key: NIM_ASR_MODEL
        sync: false
      - key: NIM_ASR_V3
        sync: false
      - key: NIM_TTS_BASE_URL
        sync: false
      - key: NIM_FASTPITCH_BASE_URL
        sync: false
      - key: NIM_MAGPIE_FLOW_BASE_URL
        sync: false
      - key: NIM_MAGPIE_MULTI_BASE_URL
        sync: false
      - key: NIM_MAGPIE_ZERO_BASE_URL
        sync: false
      - key: OPENAI_DAILY_TOKEN_BUDGET
        sync: false
```

> **Note:** All `sync: false` variables must be set manually in the Render Dashboard before deployment. The dashboard will show empty values until populated.

---

**End of Checklist**
