# Rekrut AI — Production Deployment Checklist

> **Target Deployment Date:** June 19, 2026  
> **Prepared by:** DevOps Automator (subagent)  
> **Prepared on:** 2026-06-09  
> **Staging URL:** `https://rekrutai-staging.onrender.com`  
> **Production URL:** `https://rekrutai.co`  
> **Scope:** Research & documentation only — **DO NOT DEPLOY** until all critical blockers are resolved

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Production Readiness Score](#2-production-readiness-score)
3. [Database Migration Plan](#3-database-migration-plan)
4. [Environment Variables (Prod vs Dev/Staging)](#4-environment-variables-prod-vs-devstaging)
5. [Render Service Configuration](#5-render-service-configuration)
6. [Domain & DNS Setup](#6-domain--dns-setup)
7. [SSL Certificate Status](#7-ssl-certificate-status)
8. [Backup Strategy](#8-backup-strategy)
9. [Pre-Deploy Checklist](#9-pre-deploy-checklist)
10. [Deploy Day Runbook](#10-deploy-day-runbook)
11. [Post-Deploy Verification](#11-post-deploy-verification)
12. [Rollback Plan](#12-rollback-plan)
13. [Critical Blockers](#13-critical-blockers)
14. [Appendix: Reference Commands](#14-appendix-reference-commands)

---

## 1. Executive Summary

| Category | Status | Notes |
|----------|--------|-------|
| **Domain & SSL** | ✅ Ready | `rekrutai.co` resolves, HTTPS active via Cloudflare |
| **Render Prod Service** | ✅ Ready | `rekrutai-prod` configured on `standard` plan |
| **CI/CD Pipelines** | ✅ Ready | `ci.yml` + `deploy.yml` implemented |
| **Staging Environment** | 🔴 **DOWN** | Returns 404 — cannot validate before prod |
| **Database Migrations** | 🔴 **BLOCKED** | Not automated in `render.yaml`; duplicate prefixes exist |
| **Security Headers** | 🔴 **BLOCKED** | Production running outdated code (missing Helmet, `x-powered-by: Express` present) |
| **Production Secrets** | ⚠️ Pending | 50+ `sync: false` vars need manual verification in Render Dashboard |
| **Stripe Live Mode** | ⚠️ Pending | Ranga must confirm `sk_live_*` key + webhook endpoint |
| **E2E Test Pass Rate** | ⚠️ 85.7% | `dark-mode.spec.ts` SIGKILL failure blocks 100% pass rate |
| **Branch Sync** | ⚠️ Drift | `main` ahead of `dev`/`staging`; uncommitted files on staging |

**Verdict:** **NO-GO for June 19** until all critical blockers are resolved. Estimated fix time: 3–5 days.

---

## 2. Production Readiness Score

| Criterion | Weight | Score | Notes |
|-----------|--------|-------|-------|
| Infrastructure | 20% | 80% | Render, domain, SSL mostly configured |
| Security | 20% | 30% | Outdated code on prod, headers missing, PAT exposed |
| Database | 15% | 40% | Migration automation missing, naming conflicts |
| Environment Variables | 15% | 50% | Auto-configured vars ready; secrets unverified |
| CI/CD & Testing | 15% | 60% | Pipelines exist but untested, E2E not 100% |
| Observability & Backups | 15% | 30% | No automated backup verification, no error tracking |
| **Overall** | **100%** | **~48%** | **NOT READY** |

---

## 3. Database Migration Plan

### 3.1 Migration Engine Overview

| Component | Details |
|-----------|---------|
| **Engine** | Custom `migrate.js` (Node.js + `pg`) |
| **Tracking** | `_migrations` table in PostgreSQL |
| **Location** | `/migrations/` directory |
| **Files** | 57 total (54 JS, 2 SQL, 1 seed) |
| **Runner** | `npm run migrate` (not in `render.yaml` startCommand) |

### 3.2 Migration Inventory

| Type | Count | Examples |
|------|-------|----------|
| JavaScript | 54 | `001_add_omniscore.js`, `046_password_reset_tokens.js` |
| SQL | 2 | `045_fix_company_id_fk_constraints.sql`, `p2_schema_hardening.sql` |
| Seed | 1 | `seed_notification_templates.js` |

**Critical:** The `migrate.js` runner only tracks `.js` files. SQL files are **not** automatically applied by the runner. The `p2_schema_hardening.js` wrapper exists to apply `p2_schema_hardening.sql` programmatically.

### 3.3 Migration Issues (Must Fix Before Deploy)

| Issue | Severity | Details | Fix |
|-------|----------|---------|-----|
| **Duplicate prefixes** | 🔴 Critical | `003_*` × 2, `005_*` × 2, `045_*` × 2 | Rename files (see §3.4) |
| **Non-numeric prefixes** | 🟡 Medium | `p2_schema_hardening.sql`, `p3_schema_optimizations.js`, `seed_notification_templates.js` | Rename or ensure correct ordering |
| **SQL not auto-applied** | 🟡 Medium | `045_fix_company_id_fk_constraints.sql` must be manually verified | Check prod DB; run via shell if needed |
| **Not automated in deploy** | 🔴 Critical | `startCommand` is `npm start` only | Change to `npm run migrate && npm start` |
| **No pre-migration backup** | 🟡 Medium | No automated `pg_dump` before deploy | Add manual snapshot step (see §8) |

### 3.4 Migration Fix Commands (Execute Before Deploy)

```bash
cd /root/.openclaw/workspace/Rekrut_AI_v2/migrations

# Fix 003 duplicates
git mv 003_add_role_column.js 003b_add_role_column.js

# Fix 005 duplicates
git mv 005_oauth_refresh_tokens.js 005b_oauth_refresh_tokens.js

# Fix 045 duplicates
git mv 045_p2_schema_hardening.js 046_p2_schema_hardening.js

# Commit the fixes
git add .
git commit -m "fix(migrations): resolve duplicate prefixes 003, 005, 045

- Renamed 003_add_role_column.js → 003b_add_role_column.js
- Renamed 005_oauth_refresh_tokens.js → 005b_oauth_refresh_tokens.js
- Renamed 045_p2_schema_hardening.js → 046_p2_schema_hardening.js
- Ensures deterministic alphabetical ordering in migrate.js"
```

### 3.5 Migration Automation (Critical Fix)

**Current `render.yaml` startCommand:**
```yaml
startCommand: npm start  # → node server.js
```

**Required change:**
```yaml
startCommand: npm run migrate && npm start  # → node migrate.js && node server.js
```

**Impact:**
- Adds ~2–5s to startup time
- Migrations are idempotent (safe to run multiple times)
- If migration fails, container crashes and restarts (safe behavior)
- Zero manual intervention required on deploy

### 3.6 Migration Verification

After any migration, verify with:
```bash
# Via Render Dashboard → rekrutai-prod → Shell
psql $DATABASE_URL -c "SELECT * FROM _migrations ORDER BY id;"
```

Expected output: All 54+ JS migration filenames should be present with `applied_at` timestamps.

### 3.7 Production Migration Checklist

- [ ] Rename duplicate migration prefixes (003, 005, 045)
- [ ] Update `render.yaml` startCommand to include `npm run migrate`
- [ ] Verify `pgvector` extension installed on prod DB: `CREATE EXTENSION IF NOT EXISTS vector;`
- [ ] Verify `_migrations` table exists on prod DB
- [ ] Take pre-migration DB snapshot (see §8)
- [ ] Run `npm run migrate` on staging first to validate
- [ ] Run `npm run migrate` on production after deploy
- [ ] Seed notification templates if not already applied: `node migrations/seed_notification_templates.js`
- [ ] Verify `045_fix_company_id_fk_constraints.sql` applied (manual check if needed)

---

## 4. Environment Variables (Prod vs Dev/Staging)

### 4.1 Variables Auto-Configured in `render.yaml`

| Variable | Source | Production Value | Status |
|----------|--------|-----------------|--------|
| `NODE_ENV` | `value` | `production` | ✅ Ready |
| `PORT` | `value` | `10000` | ✅ Ready |
| `DATABASE_URL` | `fromDatabase: rekrutai-prod-db` | Auto-linked | ✅ Ready |
| `REKRUT_AI_URL` | `value` | `https://rekrutai.co` | ✅ Ready |
| `APP_URL` | `value` | `https://rekrutai.co` | ✅ Ready |
| `FRONTEND_URL` | `value` | `https://rekrutai.co` | ✅ Ready |
| `BASE_URL` | `value` | `https://rekrutai.co` | ✅ Ready |
| `CORS_ORIGINS` | `value` | `https://rekrutai.co,https://www.rekrutai.co` | ✅ Ready |
| `FORCE_SSL_VERIFY` | `value` | `true` | ✅ Ready |

### 4.2 Secrets — Must Be Set Manually in Render Dashboard

All the following are `sync: false` in `render.yaml`. They MUST be populated via the Render Dashboard **BEFORE** the first production deploy.

#### Tier 1 — Critical (App Will Fail Without These)

| Variable | Required | Who Sets | Verification |
|----------|----------|----------|--------------|
| `JWT_SECRET` | ✅ | Suga / Ranga | ≥32 random chars, consistent across restarts |
| `SESSION_SECRET` | ✅ | Suga / Ranga | ≥32 random chars, consistent across restarts |
| `ADMIN_USERNAME` | ✅ | Suga | Default admin login for `/admin` panel |
| `ADMIN_PASSWORD` | ✅ | Suga | Strong password, hashed by app |
| `STRIPE_SECRET_KEY` | ✅ | Ranga | **Must be `sk_live_*` (NOT `sk_test_*`)** |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Ranga | Live endpoint secret (`whsec_...`) from Stripe Dashboard |
| `POLSIA_API_KEY` | ✅ | Suga | Production Polsia API key |
| `POLSIA_API_URL` | ✅ | Suga | Production Polsia API base URL |

#### Tier 2 — Required for AI Features

| Variable | Required | Who Sets | Fallback Impact |
|----------|----------|----------|-----------------|
| `OPENAI_API_KEY` | ⚠️ | Suga | OpenAI fallback fails |
| `OPENAI_BASE_URL` | ⚠️ | Suga | — |
| `NVIDIA_NIM_API_KEY` | ⚠️ | Suga | NIM fallback fails |
| `NIM_BASE_URL` | ⚠️ | Suga | — |
| `GROQ_API_KEY` | ⚠️ | Suga | Groq fallback fails |
| `CEREBRAS_API_KEY` | ⚠️ | Suga | Cerebras fallback fails |
| `DEEPGRAM_API_KEY` | ⚠️ | Suga | TTS/STT audio features fail |

#### Tier 3 — Optional AI Model Routing

| Variable | Required | Notes |
|----------|----------|-------|
| `NIM_LLM_MODEL` | Optional | Default LLM model override |
| `NIM_LLM_LLAMA_8B` | Optional | Model-specific routing |
| `NIM_LLM_LLAMA_70B` | Optional | Model-specific routing |
| `NIM_LLM_GEMMA` | Optional | Model-specific routing |
| `NIM_LLM_GPT_OSS` | Optional | Model-specific routing |
| `NIM_LLM_NANO_30B` | Optional | Model-specific routing |
| `NIM_LLM_STEP_FLASH` | Optional | Model-specific routing |
| `NIM_LLM_ULTRA` | Optional | Model-specific routing |
| `NIM_REASONING_QWQ` | Optional | Model-specific routing |
| `NIM_SAFETY_MODEL` | Optional | Model-specific routing |
| `NIM_SAFETY_REASONING` | Optional | Model-specific routing |
| `NIM_VISION_GEMMA` | Optional | Model-specific routing |
| `NIM_VISION_FALLBACK_MODEL` | Optional | Model-specific routing |
| `NIM_EMBED_MODEL` | Optional | Model-specific routing |
| `NIM_EMBED_VL` | Optional | Model-specific routing |
| `NIM_DOCUMENT_MODEL` | Optional | Model-specific routing |
| `NIM_ASR_MODEL` | Optional | Model-specific routing |
| `NIM_ASR_V3` | Optional | Model-specific routing |
| `NIM_TTS_BASE_URL` | Optional | Model-specific routing |
| `NIM_FASTPITCH_BASE_URL` | Optional | Model-specific routing |
| `NIM_MAGPIE_ZERO_BASE_URL` | Optional | Model-specific routing |
| `NIM_MAGPIE_FLOW_BASE_URL` | Optional | Model-specific routing |
| `NIM_MAGPIE_MULTI_BASE_URL` | Optional | Model-specific routing |

#### Tier 4 — Optional Integrations

| Variable | Required | Notes |
|----------|----------|-------|
| `R2_ACCESS_KEY_ID` | Optional | Cloudflare R2 file uploads |
| `R2_SECRET_ACCESS_KEY` | Optional | Cloudflare R2 file uploads |
| `R2_BUCKET_NAME` | Optional | Cloudflare R2 file uploads |
| `R2_ENDPOINT` | Optional | Cloudflare R2 file uploads |
| `R2_PUBLIC_URL` | Optional | Cloudflare R2 file uploads |
| `EMAIL_HOST` | Optional | Transactional email |
| `EMAIL_PORT` | Optional | Transactional email |
| `EMAIL_USER` | Optional | Transactional email |
| `EMAIL_PASS` | Optional | Transactional email |
| `EMAIL_FROM_ADDRESS` | Optional | Transactional email |
| `EMAIL_FROM_NAME` | Optional | Transactional email |
| `EMAIL_RATE_LIMIT` | Optional | Transactional email |
| `EMAIL_RATE_LIMIT_HOUR` | Optional | Transactional email |
| `EMAIL_RETRY_ATTEMPTS` | Optional | Transactional email |
| `EMAIL_RETRY_DELAY` | Optional | Transactional email |
| `SMTP_HOST` | Optional | Alternative SMTP config |
| `SMTP_PORT` | Optional | Alternative SMTP config |
| `SMTP_USER` | Optional | Alternative SMTP config |
| `SMTP_PASS` | Optional | Alternative SMTP config |
| `SMTP_SECURE` | Optional | Alternative SMTP config |
| `SMTP_FROM` | Optional | Alternative SMTP config |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth login |
| `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth login |
| `GOOGLE_REDIRECT_URI` | Optional | Must be `https://rekrutai.co/api/auth/google/callback` |
| `LINKEDIN_CLIENT_ID` | Optional | LinkedIn OAuth login |
| `LINKEDIN_CLIENT_SECRET` | Optional | LinkedIn OAuth login |
| `LINKEDIN_REDIRECT_URI` | Optional | Must be `https://rekrutai.co/api/auth/linkedin/callback` |

### 4.3 Stripe Live Mode Checklist

- [ ] Stripe Dashboard: Products and Pricing configured for **live** mode
- [ ] Stripe Dashboard: Webhook endpoint URL set to `https://rekrutai.co/api/billing/webhook`
- [ ] Stripe Dashboard: Webhook events subscribed:
  - `checkout.session.completed`
  - `invoice.payment_succeeded`
  - `customer.subscription.updated`
- [ ] Render Dashboard: `STRIPE_SECRET_KEY` starts with `sk_live_` (NOT `sk_test_`)
- [ ] Render Dashboard: `STRIPE_WEBHOOK_SECRET` copied from live webhook endpoint detail page
- [ ] Test one live payment in Stripe Dashboard after deploy

### 4.4 Environment Variable Setup Checklist

- [ ] Navigate to Render Dashboard → `rekrutai-prod` → Environment
- [ ] Add all `sync: false` secrets from tables above
- [ ] Verify `JWT_SECRET` ≥ 32 characters
- [ ] Verify `SESSION_SECRET` ≥ 32 characters
- [ ] Verify `STRIPE_SECRET_KEY` starts with `sk_live_`
- [ ] Verify `GOOGLE_REDIRECT_URI` uses `https://rekrutai.co`
- [ ] Verify `LINKEDIN_REDIRECT_URI` uses `https://rekrutai.co`
- [ ] Document all set secrets in a secure location (NOT in repo)

---

## 5. Render Service Configuration

### 5.1 Production Service (`rekrutai-prod`)

| Config | Current Value | Recommended | Status |
|--------|--------------|-------------|--------|
| `branch` | `main` | `main` | ✅ |
| `plan` | `standard` | `standard` | ✅ |
| `numInstances` | `1` | `2` | ⚠️ Zero-downtime deploys impossible with 1 instance |
| `autoDeploy` | `false` | `false` | ✅ Prevents accidental deploys |
| `buildCommand` | `cd client && npm install --include=dev && npm run build && cd .. && npm install` | Same | ✅ |
| `startCommand` | `npm start` | `npm run migrate && npm start` | 🔴 **Must fix** |
| `healthCheckPath` | `/health` | `/health` | ✅ |
| `port` | `10000` | `10000` | ✅ |

### 5.2 Supporting Services

| Service | Type | Branch | Plan | Status |
|---------|------|--------|------|--------|
| `rekrutai-prod-db` | PostgreSQL | `main` | `standard` | ✅ Ready |
| `rekrutai-staging` | Web | `staging` | default | 🔴 **404** — DOWN |
| `rekrutai-staging-db` | PostgreSQL | `staging` | `starter` | ⚠️ Free tier may not mirror prod |
| `rekrutai-dev` | Web | `dev` | default | ✅ UP (slow cold start ~32s) |
| `rekrutai-dev-db` | PostgreSQL | `dev` | `starter` | ✅ Ready |

### 5.3 Render Configuration Checklist

- [ ] `rekrutai-prod` service exists in Render Dashboard
- [ ] `rekrutai-prod` is configured to deploy from `main` branch
- [ ] `autoDeploy: false` confirmed in Render Dashboard
- [ ] `healthCheckPath: /health` confirmed
- [ ] `rekrutai-prod-db` is on `standard` plan
- [ ] `rekrutai-staging` service is healthy (fix 404 first)
- [ ] `rekrutai-staging` autoDeploy is `true` (for fast iteration)
- [ ] Consider upgrading `numInstances` to `2` for zero-downtime deploys

---

## 6. Domain & DNS Setup

### 6.1 Primary Domain: `rekrutai.co`

| Check | Status | Notes |
|-------|--------|-------|
| DNS resolves | ✅ | Cloudflare A/AAAA records point to Render |
| Cloudflare proxy | ✅ | Orange cloud enabled |
| HTTPS accessible | ✅ | `https://rekrutai.co` returns 200 |
| Custom domain on Render | ⚠️ Presumed | Verify in Render Dashboard → `rekrutai-prod` → Custom Domains |
| `www` → apex redirect | ⚠️ Unknown | Verify or configure in Cloudflare |

### 6.2 Cloudflare DNS Configuration

Required DNS records:
```
Type: A
Name: @ (apex)
Content: <Render origin IP>
Proxy status: Proxied (orange cloud)
TTL: Auto

Type: A
Name: www
Content: <Render origin IP>
Proxy status: Proxied (orange cloud)
TTL: Auto
```

Recommended Cloudflare Page Rule:
```
URL: www.rekrutai.co/*
Setting: Forwarding URL → 301 Permanent Redirect → https://rekrutai.co/$1
```

### 6.3 Domain Checklist

- [ ] `rekrutai.co` added as Custom Domain in Render Dashboard
- [ ] Cloudflare DNS A records point to Render origin IP
- [ ] Cloudflare SSL/TLS mode set to "Full (strict)" (not "Flexible")
- [ ] `www.rekrutai.co` redirects to `rekrutai.co` (301)
- [ ] `CORS_ORIGINS` in `render.yaml` includes both apex and www variants

---

## 7. SSL Certificate Status

### 7.1 Current State

| Component | Provider | Status | Notes |
|-----------|----------|--------|-------|
| Edge SSL | Cloudflare | ✅ | Auto-managed TLS 1.3 |
| Origin SSL | Render | ✅ | Auto-managed TLS 1.2+ |
| Certificate expiry | — | ✅ | Auto-renewed by both providers |
| HSTS header | — | 🔴 **Missing** | Not present in production response |
| `strict-transport-security` | — | 🔴 Missing | Helmet configured but not deployed to prod |
| `x-powered-by: Express` | — | 🔴 Present | Confirms production is running outdated code |

### 7.2 Production Header Comparison

| Header | Dev/Staging (Expected) | Production (Actual) | Status |
|--------|------------------------|---------------------|--------|
| `x-powered-by` | **ABSENT** | `Express` | 🔴 OLD CODE |
| `permissions-policy` | `camera=(self), microphone=(self)` | `camera=*, microphone=*` | 🔴 OLD CODE |
| `content-security-policy` | Present | MISSING | 🔴 OLD CODE |
| `strict-transport-security` | Present | MISSING | 🔴 OLD CODE |
| `x-frame-options` | `SAMEORIGIN` | MISSING | 🔴 OLD CODE |
| `x-content-type-options` | `nosniff` | MISSING | 🔴 OLD CODE |

### 7.3 SSL Checklist

- [ ] Cloudflare SSL/TLS mode set to "Full (strict)"
- [ ] `FORCE_SSL_VERIFY: true` set in `render.yaml` (already done)
- [ ] `SESSION_SECRET` is strong (≥32 chars)
- [ ] `JWT_SECRET` is strong (≥32 chars)
- [ ] Session cookie `secure=true` in production (`server.js` handles this for `NODE_ENV=production`)
- [ ] After deploy, verify HSTS header present: `curl -I https://rekrutai.co/ | grep strict-transport-security`
- [ ] After deploy, verify `x-powered-by` is ABSENT
- [ ] After deploy, verify CSP header present

---

## 8. Backup Strategy

### 8.1 Current Backup State

| Backup Type | Status | Notes |
|-------------|--------|-------|
| Render automated backups (`standard` plan) | ✅ | Daily automated backups for `rekrutai-prod-db` |
| Render automated backups (`starter` plan) | ⚠️ | Less frequent for dev/staging DBs |
| Manual `pg_dump` script | ❌ Not found | No `scripts/backup-db.sh` in repo |
| Pre-migration backup in CI/CD | ❌ Not found | No backup step in `deploy.yml` |
| Neon dashboard backup | ⚠️ Unknown | Verify in Neon dashboard if using Neon directly |
| Point-in-time recovery | ⚠️ Unknown | Neon supports this; verify in dashboard |
| Database branching | ⚠️ Unknown | Neon supports branching for safe migrations; not currently used |

### 8.2 Pre-Migration Backup Policy (Manual — Required Before Deploy)

```bash
# Option 1: Manual pg_dump via Render Shell (recommended before deploy)
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).sql

# Option 2: Render Dashboard snapshot
# Render Dashboard → rekrutai-prod-db → Snapshots → Manual Snapshot
```

### 8.3 Backup Checklist

- [ ] Verify Render Dashboard shows backup history for `rekrutai-prod-db`
- [ ] Take manual snapshot before any production deploy with migrations
- [ ] Store backup retention policy (minimum 7 days)
- [ ] Consider adding `pg_dump` pre-migration step to `deploy.yml`
- [ ] Verify Neon point-in-time recovery is available as safety net
- [ ] Test restore procedure on a non-production database before June 19

---

## 9. Pre-Deploy Checklist

### 9.1 Repository Checks (Day Before Deploy)

- [ ] `dev` branch is clean (`git status` shows no uncommitted changes)
- [ ] `staging` branch is clean (no uncommitted files)
- [ ] `main` branch is clean
- [ ] `dev` → `staging` merge completed and validated
- [ ] `staging` → `main` PR created with full changelog
- [ ] All e2e tests pass on staging (100% pass rate)
- [ ] `npm audit` passes with 0 vulnerabilities
- [ ] `ci.yml` runs successfully on latest PR
- [ ] GitHub PAT exposed in `.git/config` is **revoked** and remote URL updated
- [ ] Duplicate migration prefixes are renamed and committed
- [ ] `render.yaml` startCommand includes `npm run migrate`

### 9.2 Environment Checks (Day Before Deploy)

- [ ] All Tier 1 secrets (`JWT_SECRET`, `SESSION_SECRET`, `ADMIN_*`, `STRIPE_*`) set in Render Dashboard
- [ ] `STRIPE_SECRET_KEY` starts with `sk_live_` (not `sk_test_`)
- [ ] Stripe live webhook endpoint created and `STRIPE_WEBHOOK_SECRET` copied
- [ ] Google OAuth redirect URIs updated to `https://rekrutai.co`
- [ ] LinkedIn OAuth redirect URIs updated to `https://rekrutai.co`
- [ ] `rekrutai.co` Custom Domain verified in Render Dashboard
- [ ] Cloudflare DNS records correct and proxy enabled

### 9.3 Database Checks (Day Before Deploy)

- [ ] Pre-migration snapshot taken in Render Dashboard
- [ ] `pgvector` extension verified on prod DB
- [ ] `_migrations` table exists on prod DB
- [ ] Staging migration run validated (no errors)
- [ ] `045_fix_company_id_fk_constraints.sql` applied status verified

### 9.4 Security Checks (Day Before Deploy)

- [ ] `x-powered-by` will be disabled in deployed code (verify in `server.js`)
- [ ] Helmet middleware is present in `server.js` on `main` branch
- [ ] CSP `connectSrc` does not include dev URLs (`rekrutai-dev.onrender.com`)
- [ ] `autoDeploy: false` confirmed on prod service
- [ ] Branch protection on `main` enabled (require PR + CI pass)

---

## 10. Deploy Day Runbook

### 10.1 Phase 0: Pre-Deploy (Complete ALL Before Proceeding)

| # | Step | Owner | Command / Action | ETA |
|---|------|-------|------------------|-----|
| P0.1 | Verify `main` is clean | Suga | `git checkout main && git status` | 1 min |
| P0.2 | Verify staging is healthy | Suga | `curl -s https://rekrutai-staging.onrender.com/health` | 1 min |
| P0.3 | Take production DB snapshot | Suga | Render Dashboard → rekrutai-prod-db → Snapshots → Manual Snapshot | 2 min |
| P0.4 | Verify all prod secrets set | Ranga + Suga | Render Dashboard → rekrutai-prod → Environment | 10 min |
| P0.5 | Verify Stripe live webhook | Ranga | Stripe Dashboard → Webhooks → `https://rekrutai.co/api/billing/webhook` | 5 min |
| P0.6 | Update OAuth redirect URIs | Ranga | Google Cloud + LinkedIn Developer portals | 10 min |
| P0.7 | Ranga Go/No-Go approval | Ranga | CEO sign-off required | 15 min |

### 10.2 Phase 1: Deploy

| # | Step | Owner | Command / Action | ETA |
|---|------|-------|------------------|-----|
| 1.1 | Merge staging → main | Suga | Merge PR on GitHub (merge commit, NOT squash) | 2 min |
| 1.2 | Trigger manual deploy | Suga | Render Dashboard → rekrutai-prod → Manual Deploy → "Deploy latest commit" | 1 min |
| 1.3 | Monitor build logs | Suga | Render Dashboard → rekrutai-prod → Logs | 3–5 min |
| 1.4 | Wait for `/health` | Suga | `curl -s https://rekrutai.co/health` | 1–2 min |
| 1.5 | Verify `/api/health` | Suga | `curl -s https://rekrutai.co/api/health` | 1 min |
| 1.6 | Verify security headers | Suga | `curl -I https://rekrutai.co/` | 1 min |
| 1.7 | Run DB migrations | Suga | Render Shell → `npm run migrate` | 2–5 min |
| 1.8 | Seed notification templates | Suga | Render Shell → `node migrations/seed_notification_templates.js` | 1 min |
| 1.9 | Verify `pgvector` | Suga | `psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS vector;"` | 1 min |
| 1.10 | Post-deploy smoke tests | Sunny + Suga | See §11 | 15 min |

### 10.3 Build Timeline Estimate

| Phase | Duration | Notes |
|-------|----------|-------|
| Git merge | 30s | |
| Render trigger → build start | 30s | Manual trigger required |
| Build phase | 3–5 min | Client build + server install |
| Deploy + health check | 1–2 min | `/health` must return 200 |
| **Total deploy time** | **~5–8 min** | |
| DB migrations + seed | 3–5 min | If needed |
| Post-deploy smoke tests | 15 min | Critical path verification |
| **Total Phase 1 time** | **~25–30 min** | |

---

## 11. Post-Deploy Verification

### 11.1 Health & Availability (First 5 Minutes)

| # | Test | Expected Result | Command |
|---|------|-----------------|---------|
| 11.1.1 | Root health | `{"status":"ok"}` | `curl -s https://rekrutai.co/health` |
| 11.1.2 | API health | `{"status":"ok"}` | `curl -s https://rekrutai.co/api/health` |
| 11.1.3 | Homepage | 200 OK, hero visible | `curl -s https://rekrutai.co/` |
| 11.1.4 | Login page | 200 OK, form visible | `curl -s https://rekrutai.co/login` |
| 11.1.5 | Jobs API | Returns job data | `curl -s https://rekrutai.co/api/jobs?limit=1` |

### 11.2 Security Headers (Critical — Must Pass)

| # | Test | Expected | Command |
|---|------|----------|---------|
| 11.2.1 | `x-powered-by` | **ABSENT** | `curl -I https://rekrutai.co/health \| grep -i x-powered-by` (should be empty) |
| 11.2.2 | `permissions-policy` | `camera=(self), microphone=(self)` | `curl -I https://rekrutai.co/health \| grep -i permissions-policy` |
| 11.2.3 | `content-security-policy` | Present | `curl -I https://rekrutai.co/ \| grep -i content-security-policy` |
| 11.2.4 | `strict-transport-security` | Present, max-age=31536000 | `curl -I https://rekrutai.co/ \| grep -i strict-transport-security` |
| 11.2.5 | `x-frame-options` | `SAMEORIGIN` | `curl -I https://rekrutai.co/ \| grep -i x-frame-options` |
| 11.2.6 | `x-content-type-options` | `nosniff` | `curl -I https://rekrutai.co/ \| grep -i x-content-type-options` |

### 11.3 Functional Smoke Tests (Within 15 Minutes)

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 11.3.1 | Homepage | Load `/`, check hero, features, pricing | All sections visible, no console errors |
| 11.3.2 | Login flow | Test credentials → login → dashboard | Login succeeds, redirects correctly |
| 11.3.3 | Candidate jobs | Navigate to `/candidate/jobs` | Job listings load, search/filter work |
| 11.3.4 | Recruiter dashboard | `/recruiter/dashboard` | Dashboard loads, analytics visible |
| 11.3.5 | Dark mode toggle | Click toggle on any page | Theme switches, persists on reload |
| 11.3.6 | Mobile responsive | Emulate iPhone 14 in DevTools | Layout adapts, no horizontal scroll |
| 11.3.7 | Stripe pricing | Load `/pricing` | Free / Pro / Enterprise tiers visible |
| 11.3.8 | Admin panel | Login with admin credentials | Admin dashboard accessible |
| 11.3.9 | AI coaching (if Polsia key set) | Start mock interview | AI response generated |
| 11.3.10 | OAuth (Google) | Click "Sign in with Google" | Redirects to Google, returns with auth |
| 11.3.11 | OAuth (LinkedIn) | Click "Sign in with LinkedIn" | Redirects to LinkedIn, returns with auth |

### 11.4 Database Verification (Within 30 Minutes)

| # | Test | Command | Expected |
|---|------|---------|----------|
| 11.4.1 | Migration table | `psql $DATABASE_URL -c "SELECT COUNT(*) FROM _migrations;"` | ≥ 54 rows |
| 11.4.2 | No connection errors | Render Dashboard → Logs | No `ECONNREFUSED` or pool errors |
| 11.4.3 | pgvector extension | `psql $DATABASE_URL -c "SELECT * FROM pg_extension WHERE extname='vector';"` | 1 row |

---

## 12. Rollback Plan

### 12.1 Rollback Decision Criteria

Rollback immediately if any of the following are detected within 30 minutes of deploy:

- `/health` returns non-200 for > 2 minutes
- 5xx errors in Render logs
- Database connection errors
- Stripe webhook failures
- AI provider circuit breaker stuck open
- Any P0 bug affecting user login, payments, or core workflows
- > 50% of smoke tests fail

### 12.2 Option A — Fast Render Dashboard Rollback (Recommended, < 2 min)

1. Render Dashboard → `rekrutai-prod` → "Manual Deploy"
2. Select "Deploy previous commit" (or pick a specific known-good commit)
3. Render will redeploy the previous version immediately

**Pros:** Fastest, no git history changes, no database impact if no migrations ran
**Cons:** Only works if previous commit is known-good and database schema hasn't changed

### 12.3 Option B — Git Revert + Manual Deploy (3–5 min)

```bash
# Identify the bad merge commit
git log main --oneline -5

# Revert the merge commit (-m 1 for merge commit)
git revert -m 1 [bad-merge-commit-hash]

# Push to main (does NOT auto-deploy because autoDeploy: false)
git push origin main

# Go to Render Dashboard and manually deploy the new revert commit
```

### 12.4 Option C — Database Rollback (If Migrations Caused Data Corruption)

1. Render Dashboard → `rekrutai-prod-db` → Snapshots
2. Select pre-deploy snapshot (taken in Phase 0)
3. Click Restore
4. Wait for restore (5–10 minutes)
5. Restart `rekrutai-prod` service

### 12.5 Post-Rollback Verification

```bash
# 1. Health check
curl -s https://rekrutai.co/health
# Expected: 200 OK

# 2. Smoke test — login
curl -s -X POST https://rekrutai.co/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test_recruiter@rekrutai.co","password":"Test123!"}'
# Expected: 200 OK

# 3. Check Render logs for errors
# Render Dashboard → rekrutai-prod → Logs

# 4. Notify team in group chat with:
#    - Rollback reason
#    - Bad commit hash
#    - Restored commit hash
#    - Time to restore
```

---

## 13. Critical Blockers

These **must** be resolved before any production deployment. Do not proceed past any blocker.

### 13.1 P0 — Critical Blockers (Must Fix Before June 19)

| # | Blocker | Severity | Owner | Impact | Resolution | ETA |
|---|---------|----------|-------|--------|------------|-----|
| **B1** | **Staging environment DOWN (404)** | 🔴 | Suga | Cannot validate any changes before production | Verify/fix `rekrutai-staging` service in Render Dashboard; push `staging` branch | 1–2 hrs |
| **B2** | **Security headers not deployed to prod** | 🔴 | Suga | `x-powered-by: Express` present; production vulnerable | Merge latest `main`/`dev` (which has Helmet + `app.disable('x-powered-by')`) and deploy | 1 hr |
| **B3** | **Database migrations are manual** | 🔴 | Suga | Schema-changing deploys will crash production | Change `render.yaml` startCommand to `npm run migrate && npm start` | 30 min |
| **B4** | **Duplicate migration prefixes** | 🔴 | Suga | Non-deterministic migration order; potential FK failures | Rename files (§3.4) | 30 min |
| **B5** | **GitHub PAT exposed in `.git/config`** | 🔴 | Suga | Full GitHub account compromise risk | Revoke token; update remote URL to SSH or plain HTTPS | 15 min |
| **B6** | **Production running 143+ commits behind** | 🔴 | Suga | Security vulnerabilities, missing features | Push latest `main` to origin; deploy | 30 min |
| **B7** | **E2E `dark-mode.spec.ts` SIGKILL failure** | 🔴 | Sunny | CI gate unreliable; blocks 100% pass | Add `page.close()` in auth.setup.ts, reduce workers, or split test | 2–4 hrs |

### 13.2 P1 — High Risks (Fix Within 1 Week)

| # | Risk | Owner | Impact | Resolution | ETA |
|---|------|-------|--------|------------|-----|
| **R1** | `numInstances: 1` — no zero-downtime deploys | Suga | Every deploy causes downtime | Upgrade to `numInstances: 2` in `render.yaml` | 5 min |
| **R2** | No `npm audit` in build pipeline | Suga | Vulnerable dependencies can reach production | Verify `ci.yml` audit job runs; fix any failures | 1 hr |
| **R3** | No post-deploy smoke test automation | Suga | Deploy failures discovered manually | Add `scripts/smoke-test.js` and run from `deploy.yml` | 2 hrs |
| **R4** | Staging DB on `starter` plan | Suga | Staging may not mirror prod performance | Upgrade to `standard` for staging DB | 5 min |
| **R5** | No branch protection on `main` | Ranga | Direct push to `main` could accidentally deploy | Enable "Require PR + CI pass" in GitHub Settings | 15 min |
| **R6** | `.env` file in working tree with test Stripe keys | Suga | Risk of accidental commit | Ensure `.env` is in `.gitignore` and never committed | 5 min |
| **R7** | No error tracking (Sentry/LogRocket) | Suga | Production bugs discovered by users | Add Sentry or LogRocket integration | 2 hrs |
| **R8** | No load testing (k6/Artillery) | Suga | Cannot verify SLA under expected traffic | Add k6 load testing scripts | 1 day |
| **R9** | Stripe live keys not configured | Ranga | **Zero revenue** | Set `sk_live_*` + webhook in Render Dashboard | 1 hr |
| **R10** | OAuth redirect URIs not updated | Ranga | Google/LinkedIn login will fail | Update Google Cloud + LinkedIn Developer portals | 30 min |

### 13.3 P2 — Medium/Low Risks (Fix After Launch)

| # | Risk | Owner | Impact | ETA |
|---|------|-------|--------|-----|
| **R11** | No unit tests (client or server) | Sunny | UI/API regressions only caught by E2E or manual QA | 2–3 days |
| **R12** | No visual regression testing | Sunny | UI changes break layouts silently | 1 day |
| **R13** | No accessibility automation | Sunny | WCAG compliance unknown | 2 hrs |
| **R14** | No dependency update automation (Dependabot) | Suga | Outdated dependencies accumulate | 30 min |
| **R15** | Dev environment cold-start ~32s | Suga | Developer experience degraded | Investigate instance type |
| **R16** | Documentation URL inconsistency (`hireloop-vzvw.polsia.app` vs `rekrutai.co`) | Suga | Confusion in runbooks | Update all docs to use `rekrutai.co` | 1 hr |
| **R17** | No external uptime monitoring (UptimeRobot/Pingdom) | Suga | Downtime discovered by users | 30 min |
| **R18** | Chunk size warning (1.5MB+ bundle) | Engineering | Slower page loads on mobile | Add dynamic imports | 1 day |

### 13.4 Blocker Resolution Timeline

| Day | Actions | Owner | Effort |
|-----|---------|-------|--------|
| **Mon 6/9** | Revoke GitHub PAT; fix staging 404; rename duplicate migration files; update render.yaml startCommand | Suga | 3–4 hrs |
| **Tue 6/10** | Merge `dev` → `staging`, verify staging deploys; run full staging validation | Suga + Sunny | 3–4 hrs |
| **Wed 6/11** | Fix `dark-mode.spec.ts` SIGKILL; test `ci.yml` on PR; increase `numInstances` to 2 | Sunny + Suga | 3–4 hrs |
| **Thu 6/12** | Enable branch protection on `main`; Ranga verifies all prod secrets; Stripe live setup | Ranga + Suga | 2–3 hrs |
| **Fri 6/13** | Run `npm run migrate` on prod DB (dry-run); verify `_migrations` table; take pre-deploy snapshot | Suga | 2 hrs |
| **Mon 6/16** | Lighthouse audit on staging; create PR: `staging` → `main` with full checklist | Suga | 1–2 hrs |
| **Tue 6/17** | Ranga approves PR; merge → trigger manual deploy | Ranga + Suga | 30 min |
| **Wed 6/18** | Post-deploy verification; buffer day for fixes | Sunny + Suga | 1–2 days |
| **Thu 6/19** | **GO / NO-GO decision** | Ranga | — |

---

## 14. Appendix: Reference Commands

### 14.1 Health Checks

```bash
# All environments
curl -s https://rekrutai-dev.onrender.com/health | jq .
curl -s https://rekrutai-staging.onrender.com/health | jq .
curl -s https://rekrutai.co/health | jq .

# With headers
curl -I https://rekrutai.co/health
```

### 14.2 Branch Management

```bash
# Sync staging with dev
git checkout staging && git merge --ff-only dev && git push origin staging

# Sync dev with main
git checkout dev && git merge main && git push origin dev

# Check branch status
git log --oneline --graph --decorate --all -10
```

### 14.3 Database

```bash
# Check migration status on any DB
psql $DATABASE_URL -c "SELECT * FROM _migrations ORDER BY id;"

# Run migrations locally
npm run migrate

# Pre-migration backup
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).sql

# Check pgvector
psql $DATABASE_URL -c "SELECT * FROM pg_extension WHERE extname='vector';"
```

### 14.4 Build & Test

```bash
# Local build verification
npm ci && cd client && npm ci && npm run build && cd .. && npm start

# Run E2E tests
npx playwright test

# Security audit
npm audit
```

### 14.5 Security Fixes

```bash
# Fix exposed GitHub PAT
# 1. Revoke token at https://github.com/settings/tokens
# 2. Update remote URL:
git remote set-url origin git@github.com:sumanthrangausa-06/Rekrut_AI_v2.git
# Or:
git remote set-url origin https://github.com/sumanthrangausa-06/Rekrut_AI_v2.git
```

### 14.6 Useful Files

| File | Path | Purpose |
|------|------|---------|
| `render.yaml` | `/Rekrut_AI_v2/render.yaml` | Infrastructure-as-code for all Render services |
| `server.js` | `/Rekrut_AI_v2/server.js` | Express server with Helmet, CORS, sessions |
| `migrate.js` | `/Rekrut_AI_v2/migrate.js` | Custom migration runner |
| `package.json` | `/Rekrut_AI_v2/package.json` | Dependencies, scripts, engines |
| `.env.example` | `/Rekrut_AI_v2/.env.example` | Template for all environment variables |
| `ci.yml` | `/Rekrut_AI_v2/.github/workflows/ci.yml` | Build, audit, E2E, health check |
| `deploy.yml` | `/Rekrut_AI_v2/.github/workflows/deploy.yml` | Manual production deploy with gates |
| `deployment-runbook.md` | `/Rekrut_AI_v2/docs/deployment-runbook.md` | RACI matrix, detailed runbook with edge cases |

---

*Document prepared by DevOps Automator (subagent) on 2026-06-09.*  
*This is a living document. Update it as blockers are resolved and new issues are discovered.*  
*Last updated: 2026-06-09*
