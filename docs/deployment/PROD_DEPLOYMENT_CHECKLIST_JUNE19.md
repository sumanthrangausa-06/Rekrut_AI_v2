# Rekrut AI — Production Deployment Checklist (June 19, 2026)

> **Prepared by:** DevOps Automator (DO-001)  
> **Date:** 2026-06-09  
> **Target Deployment Date:** June 19, 2026  
> **Staging Environment:** `https://rekrutai-dev.onrender.com` (verified healthy)  
> **Production Environment:** `https://rekrutai.co` (running outdated code)  
> **Status:** ⚠️ NOT READY — blockers identified below

---

## Table of Contents
1. [Staging Health Check Summary](#1-staging-health-check-summary)
2. [Production Environment Status](#2-production-environment-status)
3. [Environment Variables Checklist](#3-environment-variables-checklist)
4. [Database Migration Plan](#4-database-migration-plan)
5. [Domain / DNS & SSL](#5-domain--dns--ssl)
6. [Rollback Plan](#6-rollback-plan)
7. [Post-Deploy Smoke Tests](#7-post-deploy-smoke-tests)
8. [Deployment Execution Plan](#8-deployment-execution-plan)
9. [Critical Blockers](#9-critical-blockers)
10. [Appendix: Useful Commands](#10-appendix-useful-commands)

---

## 1. Staging Health Check Summary

Verified: **2026-06-09 01:54 GMT+8**

| Check | Endpoint | Result | Status |
|-------|----------|--------|--------|
| **Root Health** | `GET /health` | `{"status":"ok","timestamp":"..."}` | ✅ PASS |
| **API Health** | `GET /api/health` | `{"status":"ok","timestamp":"..."}` | ✅ PASS |
| **Homepage** | `GET /` | HTTP 200, title: "Rekrut AI - AI Recruiting Tools" | ✅ PASS |
| **Login Page** | `GET /login` | HTTP 200, login form renders | ✅ PASS |
| **Jobs API** | `GET /api/jobs?limit=1` | HTTP 200, returns 166 total jobs | ✅ PASS |
| **Auth API (no session)** | `GET /api/auth/me` | HTTP 401 (expected) | ✅ PASS |

### Staging Security Headers (Verified)

| Header | Expected | Actual | Status |
|--------|----------|--------|--------|
| `x-powered-by` | ABSENT | ABSENT | ✅ PASS |
| `content-security-policy` | Present | Present (helmet) | ✅ PASS |
| `strict-transport-security` | Present | `max-age=31536000; includeSubDomains; preload` | ✅ PASS |
| `x-frame-options` | `SAMEORIGIN` | `SAMEORIGIN` | ✅ PASS |
| `x-content-type-options` | `nosniff` | `nosniff` | ✅ PASS |
| `permissions-policy` | `camera=(self), microphone=(self)` | `camera=(self), microphone=(self)` | ✅ PASS |
| `referrer-policy` | `no-referrer` | `no-referrer` | ✅ PASS |

**Staging Infrastructure:**
- Render service: `rekrutai-dev` (Node.js, auto-deploy from `dev` branch)
- Render DB: `rekrutai-dev-db` (PostgreSQL starter plan)
- External DB: Neon PostgreSQL (`ep-calm-field-aipg6g97-pooler`) — connected
- Response time: < 1s (warm), ~30s cold start (expected on starter plan)

---

## 2. Production Environment Status

Verified: **2026-06-09 01:54 GMT+8**

| Check | Endpoint | Result | Status |
|-------|----------|--------|--------|
| **Root Health** | `GET /health` | `{"status":"ok"}` | ✅ PASS |
| **API Health** | `GET /api/health` | `{"error":"API endpoint not found"}` | 🔴 **FAIL — OLD CODE** |
| **Homepage** | `GET /` | HTTP 200 | ✅ PASS |
| **Jobs API** | `GET /api/jobs` | HTTP 200 | ✅ PASS |

### Production Security Headers (Critical Gap)

| Header | Expected (new code) | Actual (production) | Status |
|--------|---------------------|---------------------|--------|
| `x-powered-by` | ABSENT | `Express` | 🔴 **OLD CODE** |
| `permissions-policy` | `camera=(self), microphone=(self)` | `camera=*, microphone=*` | 🔴 **OLD CODE** |
| `content-security-policy` | Present | MISSING | 🔴 **OLD CODE** |
| `strict-transport-security` | Present | MISSING | 🔴 **OLD CODE** |
| `x-frame-options` | `SAMEORIGIN` | MISSING | 🔴 **OLD CODE** |
| `x-content-type-options` | `nosniff` | MISSING | 🔴 **OLD CODE** |
| `referrer-policy` | `no-referrer` | MISSING | 🔴 **OLD CODE** |
| `cross-origin-opener-policy` | `same-origin` | MISSING | 🔴 **OLD CODE** |

**Conclusion:** Production is running code from **~May 16, 2026** (commit `fb1fdb3`), missing 100+ commits of security fixes, mobile responsive improvements, Stripe integration, E2E tests, React migration, and Helmet middleware.

### Production Service Config (from `render.yaml`)

| Setting | Value | Status |
|---------|-------|--------|
| Service name | `rekrutai-prod` | ✅ |
| Branch | `main` | ✅ |
| Plan | `standard` | ✅ |
| `numInstances` | `1` | ⚠️ **No zero-downtime deploy** |
| `autoDeploy` | `false` | ✅ **Prevents accidental deploys** |
| `healthCheckPath` | `/health` | ✅ |
| `buildCommand` | `cd client && npm install --include=dev && npm run build && cd .. && npm install` | ✅ |
| `startCommand` | `npm start` | ⚠️ **No DB migration automation** |

---

## 3. Environment Variables Checklist

### 3.1 Auto-Set Variables (from `render.yaml`)

These are automatically configured by Render — no manual action needed:

| Variable | Dev (render.yaml) | Production (render.yaml) | Status |
|----------|-------------------|--------------------------|--------|
| `NODE_ENV` | `development` | `production` | ✅ OK |
| `PORT` | `10000` | `10000` | ✅ OK |
| `DATABASE_URL` | `rekrutai-dev-db` | `rekrutai-prod-db` | ✅ OK |
| `REKRUT_AI_URL` | `https://rekrutai-dev.onrender.com` | `https://rekrutai.co` | ✅ OK |
| `APP_URL` | `https://rekrutai-dev.onrender.com` | `https://rekrutai.co` | ✅ OK |
| `FRONTEND_URL` | `https://rekrutai-dev.onrender.com` | `https://rekrutai.co` | ✅ OK |
| `BASE_URL` | `https://rekrutai-dev.onrender.com` | `https://rekrutai.co` | ✅ OK |
| `CORS_ORIGINS` | `https://rekrutai-dev.onrender.com` | `https://rekrutai.co,https://www.rekrutai.co` | ✅ OK |
| `FORCE_SSL_VERIFY` | `false` | `true` | ✅ OK |

### 3.2 Manual / Secret Variables (`sync: false` — MUST verify in Render Dashboard)

**⚠️ CRITICAL: Cannot verify from codebase. Must check Render Dashboard → `rekrutai-prod` → Environment.**

#### Tier 1 — Authentication (Deployment fails without these)

| Variable | Dev (.env) | Production Status | Impact if Missing | Owner |
|----------|------------|-------------------|-------------------|-------|
| `JWT_SECRET` | `dev-jwt-secret-...` | ⚠️ **VERIFY** | Auth completely fails | Ranga / DevOps |
| `SESSION_SECRET` | `dev-secret-...` | ⚠️ **VERIFY** | Sessions broken, login fails | Ranga / DevOps |
| `ADMIN_USERNAME` | `admin` | ⚠️ **VERIFY** | Admin panel lockout | Ranga |
| `ADMIN_PASSWORD` | `F0ta9-...` | ⚠️ **VERIFY** | Admin panel lockout | Ranga |

#### Tier 2 — Revenue / Stripe (BLOCKER — no live payments without these)

| Variable | Dev (.env) | Production Status | Impact | Owner |
|----------|------------|-------------------|--------|-------|
| `STRIPE_SECRET_KEY` | `sk_test_...` (test) | 🔴 **BLOCKER — needs `sk_live_*`** | **Zero revenue** | Ranga |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_...` (test) | 🔴 **BLOCKER — needs `pk_live_*`** | **Zero revenue** | Ranga |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (test) | 🔴 **BLOCKER — needs live webhook secret** | Webhook validation fails | Ranga |

**External Stripe action required:**
- [ ] Create live webhook endpoint in Stripe Dashboard: `https://rekrutai.co/api/billing/webhook`
- [ ] Copy `whsec_...` from live endpoint into Render Dashboard
- [ ] Ensure webhook events: `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`

#### Tier 3 — AI / Core Features (App breaks without these)

| Variable | Dev (.env) | Production Status | Impact | Owner |
|----------|------------|-------------------|--------|-------|
| `POLSIA_API_KEY` | (empty) | ⚠️ **VERIFY** | AI features completely fail | Ranga |
| `POLSIA_API_URL` | (empty) | ⚠️ **VERIFY** | AI features completely fail | Ranga |

#### Tier 4 — AI Fallback Providers (Recommended for redundancy)

| Variable | Dev (.env) | Production Status | Impact | Owner |
|----------|------------|-------------------|--------|-------|
| `OPENAI_API_KEY` | (empty) | ⚠️ **VERIFY** | AI fallback fails | Ranga |
| `OPENAI_BASE_URL` | (empty) | ⚠️ **VERIFY** | AI fallback fails | Ranga |
| `NVIDIA_NIM_API_KEY` | (empty) | ⚠️ **VERIFY** | AI fallback fails | Ranga |
| `NIM_BASE_URL` | `https://integrate.api.nvidia.com/v1` | ⚠️ **VERIFY** | NIM calls fail | Ranga |
| `GROQ_API_KEY` | (empty) | ⚠️ **VERIFY** | AI fallback fails | Ranga |
| `CEREBRAS_API_KEY` | (empty) | ⚠️ **VERIFY** | AI fallback fails | Ranga |
| `DEEPGRAM_API_KEY` | (empty) | ⚠️ **VERIFY** | TTS/STT fails | Ranga |

#### Tier 5 — NIM Model-Specific Variables (~20 vars)

| Variable | Dev (.env) | Production Status | Notes |
|----------|------------|-------------------|-------|
| `NIM_LLM_MODEL`, `NIM_LLM_LLAMA_8B`, `NIM_LLM_LLAMA_70B`, `NIM_LLM_GEMMA`, `NIM_LLM_GPT_OSS`, `NIM_LLM_NANO_30B`, `NIM_LLM_STEP_FLASH`, `NIM_LLM_ULTRA`, `NIM_REASONING_QWQ`, `NIM_SAFETY_MODEL`, `NIM_SAFETY_REASONING`, `NIM_VISION_GEMMA`, `NIM_VISION_FALLBACK_MODEL`, `NIM_EMBED_MODEL`, `NIM_EMBED_VL`, `NIM_DOCUMENT_MODEL`, `NIM_ASR_MODEL`, `NIM_ASR_V3`, `NIM_TTS_BASE_URL`, `NIM_FASTPITCH_BASE_URL`, `NIM_MAGPIE_ZERO_BASE_URL`, `NIM_MAGPIE_FLOW_BASE_URL`, `NIM_MAGPIE_MULTI_BASE_URL` | (empty) | ⚠️ **VERIFY** | If empty, app falls back to defaults. Verify each is set if specific models are needed. |

#### Tier 6 — Email / SMTP (Transactional email)

| Variable | Dev (.env) | Production Status | Impact | Owner |
|----------|------------|-------------------|--------|-------|
| `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASS` | (empty) | ⚠️ **VERIFY** | Email notifications fail | Ranga |
| `EMAIL_FROM_ADDRESS` / `EMAIL_FROM_NAME` | (empty) | ⚠️ **VERIFY** | Email notifications fail | Ranga |
| `EMAIL_RATE_LIMIT` / `EMAIL_RATE_LIMIT_HOUR` / `EMAIL_RETRY_ATTEMPTS` / `EMAIL_RETRY_DELAY` | (empty) | ⚠️ **VERIFY** | Rate limiting defaults | Ranga |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` / `SMTP_FROM` | (empty) | ⚠️ **VERIFY** | Email notifications fail | Ranga |

#### Tier 7 — OAuth (Social login)

| Variable | Dev (.env) | Production Status | Impact | Owner |
|----------|------------|-------------------|--------|-------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | (empty) | ⚠️ **VERIFY** | Google OAuth fails | Ranga |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` / `LINKEDIN_REDIRECT_URI` | (empty) | ⚠️ **VERIFY** | LinkedIn OAuth fails | Ranga |

**External OAuth action required:**
- [ ] Google Cloud Console → Add `https://rekrutai.co` to OAuth redirect URIs
- [ ] LinkedIn Developer Portal → Add `https://rekrutai.co` to OAuth redirect URIs

#### Tier 8 — Cloudflare R2 (Document storage)

| Variable | Dev (.env) | Production Status | Impact | Owner |
|----------|------------|-------------------|--------|-------|
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` / `R2_ENDPOINT` / `R2_PUBLIC_URL` | (empty) | ⚠️ **VERIFY** | Document storage fails | Ranga |

---

## 4. Database Migration Plan (Neon PostgreSQL)

### 4.1 Migration Inventory

| Type | Count | Files | Status |
|------|-------|-------|--------|
| JavaScript migrations | 54 | `001_*.js` → `051_*.js` | ✅ Present |
| SQL migrations | 2 | `045_fix_company_id_fk_constraints.sql`, `p2_schema_hardening.sql` | ⚠️ Not tracked by runner |
| Seed scripts | 1 | `seed_notification_templates.js` | ⚠️ Not tracked by runner |
| **Total** | **57** | | |

### 4.2 Critical Migration Issues

| Issue | Severity | Details | Resolution Required |
|-------|----------|---------|---------------------|
| **Duplicate prefixes** | 🔴 **Critical** | `003_add_company_profile_fields.js` + `003_add_role_column.js` share `003`. `035_pg_sessions.js` + `035_email_notifications.js` share `035`. `040_mock_per_question_analysis.js` + `040_communication_hub.js` share `040`. `045_fix_company_id_fk_constraints.sql` + `045_p2_schema_hardening.js` share `045`. | **Rename before production deploy** to avoid non-deterministic ordering. Suggest: `003b_add_role_column.js`, `035b_pg_sessions.js`, `040b_mock_per_question_analysis.js`, `046_p2_schema_hardening.js` |
| **Non-numeric prefixes** | 🟡 **High** | `p2_schema_hardening.sql`, `p3_schema_optimizations.js`, `1739617200000_p1_interview_flow_schema.js`, `seed_notification_templates.js` sort differently than numeric files. | Verify order in `_migrations` table. Ensure `p2` and `p3` are applied after `046` or before `001` as intended. |
| **Migrations not automated** | 🔴 **Critical** | `render.yaml` `startCommand` is `npm start` (just `node server.js`). No `npm run migrate` in build or start. | **Must add `npm run migrate && npm start` to `startCommand`** before June 19. |
| **SQL files not auto-applied** | 🟡 **High** | Custom `migrate.js` only tracks `.js` files. SQL files must be applied manually or via wrapper. | Verify `p2_schema_hardening.js` wrapper exists and has been applied. Verify `045_fix_company_id_fk_constraints.sql` has been applied manually on prod. |

### 4.3 Pre-Deploy Database Steps

| # | Step | Owner | Time | Status |
|---|------|-------|------|--------|
| 4.3.1 | **Take production DB snapshot** | DO-001 | 15 min | 🔴 **NOT DONE — BLOCKER** |
| 4.3.2 | Rename duplicate migration files | DO-001 | 30 min | 🔴 **NOT DONE** |
| 4.3.3 | Add `npm run migrate` to `startCommand` in `render.yaml` | DO-001 | 15 min | 🔴 **NOT DONE** |
| 4.3.4 | Verify all migrations applied on staging | DO-001 | 15 min | ✅ **Staging up to date** |
| 4.3.5 | Run `node migrate.js` on production (dry-run) before deploy | DO-001 | 15 min | 🔴 **NOT DONE** |
| 4.3.6 | Verify `pgvector` extension installed on prod | DO-001 | 5 min | 🔴 **NOT DONE** |
| 4.3.7 | Seed notification templates on prod post-deploy | DO-001 | 5 min | 🔴 **NOT DONE** |

### 4.4 Post-Deploy Database Steps

| # | Step | Owner | Time |
|---|------|-------|------|
| 4.4.1 | Run `node migrate.js` on production (if not in `startCommand`) | DO-001 | 2 min |
| 4.4.2 | Verify `_migrations` table has all 54 JS entries | DO-001 | 1 min |
| 4.4.3 | Run `node migrations/seed_notification_templates.js` | DO-001 | 1 min |
| 4.4.4 | Verify `pgvector` extension: `CREATE EXTENSION IF NOT EXISTS vector;` | DO-001 | 1 min |

---

## 5. Domain / DNS & SSL

### 5.1 Domain Configuration

| Domain | Status | DNS Provider | Notes |
|--------|--------|--------------|-------|
| `rekrutai.co` | ✅ **ACTIVE** | Cloudflare | Production endpoint. Returning 200. |
| `www.rekrutai.co` | ⚠️ **VERIFY** | Cloudflare | Should redirect to `rekrutai.co`. Not tested yet. |
| `rekrutai-staging.onrender.com` | ✅ **ACTIVE** | Render | Staging endpoint. Returning 200. |
| `rekrutai-dev.onrender.com` | ✅ **ACTIVE** | Render | Dev endpoint. Returning 200. |

### 5.2 SSL / Certificate Status

| Check | Status | Notes |
|-------|--------|-------|
| HTTPS accessible on prod | ✅ Yes | `https://rekrutai.co` returns 200 |
| TLS certificate | ✅ Yes | Cloudflare managed (auto-renew) |
| Certificate expiry | ✅ Auto-renewed | Cloudflare handles this |
| HSTS header | 🔴 **Missing** | Production code is old; new code has `max-age=31536000` |
| `www` → apex redirect | ⚠️ **Not verified** | Must verify before June 19 |
| `CORS_ORIGINS` includes `www.rekrutai.co` | ✅ Yes | Already in `render.yaml` |

### 5.3 Pre-Deploy DNS Checks

- [ ] Verify `rekrutai.co` A/CNAME records point to Render
- [ ] Verify `www.rekrutai.co` redirect works (301 → `rekrutai.co`)
- [ ] Verify HTTPS certificate is valid and not expiring within 30 days
- [ ] Verify `CORS_ORIGINS` in `render.yaml` includes `www.rekrutai.co` (✅ already done)

---

## 6. Rollback Plan

### 6.1 Fast Rollback: Render Dashboard (1–2 minutes)

1. Go to Render Dashboard → `rekrutai-prod` service
2. Click **"Manual Deploy"** → **"Deploy a specific commit"**
3. Select commit `fb1fdb3` (last known good production commit from May 16)
4. Wait for health check (`/health` returns 200)
5. Verify `curl -s https://rekrutai.co/health` returns `{"status":"ok"}`

### 6.2 Git Revert Rollback (2–5 minutes)

```bash
git checkout main
git revert -m 1 <NEW_BAD_COMMIT> --no-edit
git push origin main
# Then trigger manual deploy in Render Dashboard
```

### 6.3 Database Rollback (if data corruption)

1. Render Dashboard → `rekrutai-prod-db` → **Snapshots**
2. Select pre-deploy snapshot (taken in step 4.3.1)
3. Click **Restore**
4. Wait for restore (5–10 minutes)
5. Restart `rekrutai-prod` service

### 6.4 Rollback Triggers

| Condition | Action | ETA |
|-----------|--------|-----|
| `/health` returns non-200 for > 2 minutes | Immediate Render dashboard rollback | 1–2 min |
| 50%+ of smoke tests fail | Git revert + investigate | 2–5 min |
| Database errors in logs | DB snapshot restore + code revert | 10–15 min |
| Stripe payment failures | Disable Stripe webhooks + investigate | 5–10 min |
| AI provider circuit breakers tripped | Reset via `/api/ai-health/reset` (admin) | 2–5 min |

---

## 7. Post-Deploy Smoke Tests

Execute these **in order** within 15 minutes of deploy completion.

### 7.1 Health & Availability (First 5 Minutes)

| # | Test | Expected Result | Command |
|---|------|-----------------|---------|
| 7.1.1 | Root health | `{"status":"ok"}` | `curl -s https://rekrutai.co/health` |
| 7.1.2 | API health | `{"status":"ok"}` | `curl -s https://rekrutai.co/api/health` |
| 7.1.3 | Homepage | 200 OK, hero visible | `curl -s https://rekrutai.co/` |
| 7.1.4 | Login page | 200 OK, form visible | `curl -s https://rekrutai.co/login` |
| 7.1.5 | Jobs API | Returns job data | `curl -s https://rekrutai.co/api/jobs?limit=1` |

### 7.2 Security Headers (Critical — Must Pass)

| # | Test | Expected | Command |
|---|------|----------|---------|
| 7.2.1 | `x-powered-by` | **ABSENT** | `curl -I https://rekrutai.co/health \| grep -i x-powered-by` (should be empty) |
| 7.2.2 | `permissions-policy` | `camera=(self), microphone=(self)` | `curl -I https://rekrutai.co/health \| grep -i permissions-policy` |
| 7.2.3 | `content-security-policy` | Present | `curl -I https://rekrutai.co/ \| grep -i content-security-policy` |
| 7.2.4 | `strict-transport-security` | `max-age=31536000` | `curl -I https://rekrutai.co/ \| grep -i strict-transport-security` |
| 7.2.5 | `x-frame-options` | `SAMEORIGIN` | `curl -I https://rekrutai.co/ \| grep -i x-frame-options` |
| 7.2.6 | `x-content-type-options` | `nosniff` | `curl -I https://rekrutai.co/ \| grep -i x-content-type-options` |

### 7.3 Functional Smoke Tests (Within 15 Minutes)

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 7.3.1 | Homepage | Load `/`, check hero, features, pricing | All sections visible, no console errors |
| 7.3.2 | Login flow | Test credentials → login → dashboard | Login succeeds, redirects correctly |
| 7.3.3 | Candidate jobs | Navigate to `/candidate/jobs` | Job listings load, search/filter work |
| 7.3.4 | Recruiter dashboard | `/recruiter/dashboard` | Dashboard loads, analytics visible |
| 7.3.5 | Dark mode toggle | Click toggle on any page | Theme switches, persists on reload |
| 7.3.6 | Mobile responsive | Emulate iPhone 14 in DevTools | Layout adapts, no horizontal scroll |
| 7.3.7 | Stripe pricing | Load `/pricing` | Free / Pro / Enterprise tiers visible |
| 7.3.8 | API endpoints | `GET /api/jobs`, `GET /api/auth/me` | Returns expected data |
| 7.3.9 | Admin panel | Login with admin credentials | Admin dashboard accessible |
| 7.3.10 | AI coaching (if Polsia key set) | Start mock interview | AI response generated |

---

## 8. Deployment Execution Plan

### 8.1 Pre-Deploy (Complete ALL before June 19)

| # | Step | Owner | Time | Status |
|---|------|-------|------|--------|
| 8.1.1 | Rename duplicate migration files | DO-001 | 30 min | 🔴 **TODO** |
| 8.1.2 | Add `npm run migrate` to `startCommand` in `render.yaml` | DO-001 | 15 min | 🔴 **TODO** |
| 8.1.3 | Commit any uncommitted changes on `main` | DO-001 | 15 min | 🔴 **TODO** (2 untracked files) |
| 8.1.4 | Tag release candidate | DO-001 | 5 min | 🔴 **TODO** |
| 8.1.5 | Push `main` to `origin` | DO-001 | 1 min | 🔴 **TODO** |
| 8.1.6 | Take production DB snapshot | DO-001 | 15 min | 🔴 **BLOCKER** |
| 8.1.7 | Set all `sync: false` env vars in Render Dashboard | DO-001 + Ranga | 2–4 hrs | 🔴 **BLOCKER** |
| 8.1.8 | **Stripe live keys** in Render Dashboard | Ranga | 30 min | 🔴 **BLOCKER** |
| 8.1.9 | Create live Stripe webhook endpoint | Ranga | 15 min | 🔴 **BLOCKER** |
| 8.1.10 | Update OAuth redirect URIs (Google, LinkedIn) | Ranga | 30 min | 🔴 **TODO** |
| 8.1.11 | Run full E2E suite against latest commit | QA | 2–4 hrs | 🔴 **TODO** |
| 8.1.12 | Ranga Go/No-Go approval | Ranga | 30 min | 🔴 **TODO** |

### 8.2 Deploy Day (June 19 — Execute in Sequence)

| # | Step | Action | ETA | Owner |
|---|------|--------|-----|-------|
| 8.2.1 | Verify `main` is clean | `git status` should show no uncommitted changes | 1 min | DO-001 |
| 8.2.2 | Trigger manual deploy in Render Dashboard | `rekrutai-prod` → Manual Deploy → Latest Commit | 1 min | DO-001 |
| 8.2.3 | Monitor build logs | Render Dashboard → Logs | 3–5 min | DO-001 |
| 8.2.4 | Wait for health check | `curl -s https://rekrutai.co/health` | 1–2 min | DO-001 |
| 8.2.5 | Verify `/api/health` | `curl -s https://rekrutai.co/api/health` (should return 200, not 404) | 1 min | DO-001 |
| 8.2.6 | Verify security headers | `curl -I https://rekrutai.co/` — `x-powered-by` must be ABSENT | 1 min | DO-001 |
| 8.2.7 | Run post-deploy smoke tests | Section 7 smoke tests | 15 min | QA + DO-001 |
| 8.2.8 | Run production DB migrations (if not in startCommand) | Render Shell → `node migrate.js` | 2 min | DO-001 |
| 8.2.9 | Seed notification templates | Render Shell → `node migrations/seed_notification_templates.js` | 1 min | DO-001 |
| 8.2.10 | Monitor error logs | Render Dashboard → Logs | Ongoing | DO-001 |

### 8.3 Build Timeline Estimate

| Phase | Duration | Notes |
|-------|----------|-------|
| Manual trigger → build start | ~30s | `autoDeploy: false` requires manual trigger |
| Build phase | 3–5 min | Client build + server install |
| Deploy + health check | 1–2 min | `/health` must return 200 |
| **Total deploy time** | **~5–8 min** | |
| Post-deploy smoke tests | 15 min | Critical path verification |
| DB migrations + seed | 3–5 min | If not in `startCommand` |
| **Total Phase 2 time** | **~25–30 min** | |

---

## 9. Critical Blockers

### 🔴 P0 — Must Fix Before June 19

| # | Blocker | Owner | Impact | Resolution |
|---|---------|-------|--------|------------|
| **B1** | **Production running 100+ commits behind** | DO-001 | Security vulnerabilities exposed, missing features, old API structure | Deploy latest `main` after all pre-deploy steps |
| **B2** | **Production DB snapshot not taken** | DO-001 | No safe rollback if data corruption | Take snapshot in Render Dashboard before deploy |
| **B3** | **Stripe live keys not configured** | Ranga | **Zero revenue capability** — no real payments | Ranga to set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` in Render Dashboard |
| **B4** | **50+ production secrets (`sync: false`) not verified** | Ranga + DO-001 | Auth, AI, OAuth, email, storage may all fail | Systematically verify each secret in Render Dashboard |
| **B5** | **Database migrations not automated** | DO-001 | Any schema change deploy will crash until `migrate` is run manually | Add `npm run migrate && npm start` to `startCommand` |
| **B6** | **Duplicate migration prefixes** | DO-001 | `003`, `035`, `040`, `045` have duplicates. Order is non-deterministic. | Rename files before production deploy |
| **B7** | **OAuth redirect URIs not updated** | Ranga | Google/LinkedIn login will fail with redirect mismatch | Update Google Cloud Console and LinkedIn Developer Portal |
| **B8** | **E2E tests not confirmed on latest `main`** | QA | Risk of broken critical flows in production | Run `npx playwright test` on latest commit before deploy |
| **B9** | **`/api/health` missing on production** | DO-001 | Old code structure doesn't have `/api/health` route | Will be fixed by deploying latest code |
| **B10** | **Uncommitted files on `main` branch** | DO-001 | `docs/DATABASE_HEALTH_REPORT.md` and `scripts/db-health-check.js` are untracked | Commit or remove before deploy |

### 🟡 P1 — High Risk (Fix Within 1 Week Before Deploy)

| # | Risk | Owner | Impact |
|---|------|-------|--------|
| **R1** | `numInstances: 1` — no zero-downtime deploys | DO-001 | Every deploy causes ~30-60s downtime |
| **R2** | No `npm audit` in build pipeline | DO-001 | Vulnerable dependencies can reach production |
| **R3** | No post-deploy smoke test automation | DO-001 | Deploy failures discovered manually |
| **R4** | Staging DB on `starter` plan | DO-001 | Staging may not mirror prod performance |
| **R5** | No branch protection on `main` | Ranga | Direct push to `main` could accidentally deploy |
| **R6** | `.env` file with test Stripe keys in working tree | DO-001 | Risk of accidental commit |
| **R7** | No error tracking (Sentry/LogRocket) | DO-001 | Production bugs discovered by users |
| **R8** | No load testing (k6/Artillery) | DO-001 | Cannot verify SLA under expected traffic |
| **R9** | `www.rekrutai.co` redirect not verified | DO-001 | Users hitting `www` may get errors |

### 🟢 P2 — Medium/Low (Fix After Launch)

| # | Risk | Owner | Impact |
|---|------|-------|--------|
| **R10** | No unit tests (client or server) | QA | UI/API regressions only caught by E2E |
| **R11** | No visual regression testing | QA | UI changes break layouts silently |
| **R12** | No accessibility automation | QA | WCAG compliance unknown |
| **R13** | No dependency update automation (Dependabot) | DO-001 | Outdated dependencies accumulate |
| **R14** | Dev environment cold-start ~30s | DO-001 | Developer experience degraded |

---

## 10. Appendix: Useful Commands

```bash
# === HEALTH CHECKS ===
# Staging
curl -s https://rekrutai-dev.onrender.com/health | jq .
curl -s https://rekrutai-staging.onrender.com/health | jq .

# Production
curl -s https://rekrutai.co/health | jq .
curl -s https://rekrutai.co/api/health | jq .

# === SECURITY HEADERS ===
curl -I https://rekrutai.co/health
curl -I https://rekrutai-dev.onrender.com/health

# === BUILD ===
cd /root/.openclaw/workspace/Rekrut_AI_v2
cd client && npm install --include=dev && npm run build
cd .. && node -c server.js
for f in routes/*.js; do node -c "$f"; done

# === GIT ===
git status
git log --oneline -5 main
git log --oneline fb1fdb3..HEAD  # commits since last prod deploy

# === E2E ===
cd /root/.openclaw/workspace/Rekrut_AI_v2
npx playwright test

# === MIGRATIONS ===
node migrate.js  # dry-run — check which are pending
# On prod (via Render Shell):
# psql $DATABASE_URL -c "SELECT * FROM _migrations ORDER BY id;"

# === BUNDLE SIZE ===
ls -lah client/dist/assets/
```

---

## 11. Go / No-Go Verdict

### 🔴 CURRENT VERDICT: NO-GO (as of 2026-06-09)

**Primary reasons:**
1. **Stripe live keys missing** — No revenue capability in production.
2. **Production DB snapshot not taken** — No safe rollback path.
3. **Database migrations not automated** — Schema changes will crash production on deploy.
4. **Duplicate migration prefixes** — Non-deterministic migration order risk.
5. **50+ production secrets not verified** — Auth, AI, OAuth, email may all fail.
6. **OAuth redirect URIs not updated** — Social login will fail.
7. **E2E tests not confirmed on latest commit** — Risk of broken flows.
8. **Uncommitted files on `main`** — Working tree is not clean.

### Path to GO

| Step | Owner | Estimated Time | Cumulative |
|------|-------|----------------|------------|
| Fix duplicate migration prefixes + add migrate to startCommand | DO-001 | 45 min | 45 min |
| Commit/clean uncommitted files on `main` | DO-001 | 15 min | 1 hr |
| Run E2E tests on latest `main` | QA | 2–4 hrs | 3–5 hrs |
| Ranga generates Stripe live keys + webhook | Ranga | 1–2 days | 1–2 days |
| Ranga sets all `sync: false` env vars in Render Dashboard | Ranga + DO-001 | 2–4 hrs | 1–2 days |
| Update OAuth redirect URIs (Google, LinkedIn) | Ranga | 30 min | 1–2 days |
| Take production DB snapshot | DO-001 | 15 min | 1–2 days |
| Ranga Go/No-Go approval | Ranga | 30 min | **1–2 days total** |
| **Execute deploy on June 19** | DO-001 | 25–30 min | — |

**Estimated time to GO:** **1–2 days** (primarily dependent on Ranga completing Stripe setup and secret configuration).

---

*Document version: 2026-06-09 v1.0 — Prepared for June 19 production deployment.*
*This is a living document. Update as blockers are resolved.*
