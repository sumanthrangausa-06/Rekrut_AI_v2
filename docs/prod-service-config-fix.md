# Rekrut AI — Production Service Config Fix Report

> **Agent:** DevOps Automator (DO-002)  
> **Date:** 2026-06-09 06:07 CST  
> **Commit:** `43cf770` on `main`  
> **Target:** Render Cloud — https://rekrutai.co

---

## Summary

This report documents the 7 critical service configuration fixes applied to `render.yaml` based on the blockers identified by DO-001 in `prod-readiness-check.md`. Many of these fixes were already partially applied in prior commits (`a665953`, `c3d46f0`). The key change in this commit was removing the conflicting Render PostgreSQL database definition and verifying the entire production service blueprint.

---

## Changes Applied (Commit `43cf770`)

### 1. ✅ Production Plan — Already `standard` in Blueprint
- **Status:** Already correct in `render.yaml`
- **File:** `rekrutai-prod` service has `plan: standard`
- **Note:** DO-001 reported the Render API still shows `"plan": "free"`. This means the blueprint has been updated but the **deployed service has not been synced** with the latest `render.yaml`. Ranga must manually upgrade the plan in the Render Dashboard or trigger a blueprint sync.

### 2. ✅ Health Check Path — Already `/health` in Blueprint
- **Status:** Already correct in `render.yaml`
- **File:** `healthCheckPath: /health`
- **Evidence:** DO-001 verified `https://rekrutai.co/health` returns `200` with `{"status":"ok"}`
- **Note:** The task specified `/api/health`, but the actual production health endpoint is `/health` (verified live). The deployed service shows `"healthCheckPath": ""` per Render API, so the dashboard setting must be synced.

### 3. ✅ Start Command — Already Includes Migrations
- **Status:** Already correct in `render.yaml`
- **File:** `startCommand: npm run migrate && npm start`
- **Package.json:** `"migrate": "node migrate.js"` is present
- **Note:** DO-001 reported the deployed service still runs `node server.js`. The deployed start command must be synced from the blueprint so migrations run automatically on deploy.

### 4. ✅ Database Provider Mismatch — FIXED in This Commit
- **Action:** Removed the unused `rekrutai-prod-db` pserv service from `render.yaml`
- **Rationale:** Production uses **Neon PostgreSQL** (via `DATABASE_URL` with `sync: false`). The `rekrutai-prod-db` Render PostgreSQL service was orphaned and conflicting. Staging and dev database services (`rekrutai-staging-db`, `rekrutai-dev-db`) are preserved because they are actively used via `fromDatabase`.
- **Diff:**
  ```diff
  -  - type: pserv
  -    name: rekrutai-prod-db
  -    env: postgresql
  -    branch: main
  -    plan: standard
  -    ipAllowList: []
  ```

### 5. ✅ NODE_ENV — Already `production` in Blueprint
- **Status:** Already correct in `render.yaml`
- **File:** `NODE_ENV: production` is present under `rekrutai-prod` envVars
- **Note:** The deployed service may not have this synced. Verify in the Render Dashboard.

### 6. ✅ JWT_SECRET / SESSION_SECRET — Generated; Already `sync: false` in Blueprint
- **Status:** Already correct in `render.yaml` (`sync: false`)
- **Generated Values (for Ranga to set in Render Dashboard):**
  ```
  JWT_SECRET      = f7cf3cb909bfef6b63b3188182f5e0868233fb5f9f703a41788214fd6b026189
  SESSION_SECRET  = 89856c7d7fc621a077361e25bc826d076ee360e4882b01ed580991977f08303d
  ```
- **Method:** `crypto.randomBytes(32).toString('hex')` (256-bit / 64 hex characters each)
- **Warning:** These are **newly generated** and must replace any dev/staging secrets. **Never reuse secrets across environments.**
- **Action Required:** Ranga must paste these values into the Render Dashboard → Environment Variables for `rekrutai-prod`.

### 7. ✅ Missing Env Var Placeholders — All Already Present in Blueprint
- **Status:** All listed variables already present in `render.yaml` with `sync: false`
- **Verified present:**
  | Variable | Status |
  |----------|--------|
  | `POLSIA_API_KEY` | ✅ `sync: false` |
  | `POLSIA_API_URL` | ✅ `sync: false` |
  | `SMTP_HOST` | ✅ `sync: false` |
  | `SMTP_PORT` | ✅ `sync: false` |
  | `SMTP_USER` | ✅ `sync: false` |
  | `SMTP_PASS` | ✅ `sync: false` |
  | `R2_ACCESS_KEY_ID` | ✅ `sync: false` |
  | `R2_SECRET_ACCESS_KEY` | ✅ `sync: false` |
  | `R2_BUCKET_NAME` | ✅ `sync: false` |
  | `R2_ENDPOINT` | ✅ `sync: false` |
  | `R2_PUBLIC_URL` | ✅ `sync: false` |
  | `GOOGLE_CLIENT_ID` | ✅ `sync: false` |
  | `GOOGLE_CLIENT_SECRET` | ✅ `sync: false` |
  | `GOOGLE_REDIRECT_URI` | ✅ `sync: false` |
  | `LINKEDIN_CLIENT_ID` | ✅ `sync: false` |
  | `LINKEDIN_CLIENT_SECRET` | ✅ `sync: false` |
  | `LINKEDIN_REDIRECT_URI` | ✅ `sync: false` |
  | `STRIPE_WEBHOOK_SECRET` | ✅ `sync: false` |

---

## What Still Needs Manual Action by Ranga

The following items require Ranga to manually configure values in the **Render Dashboard** (https://dashboard.render.com/web/srv-d69opaer433s73d6p570) because they use `sync: false` or need dashboard-level overrides:

### 🔴 Critical — Must Set Before Deploy

| # | Item | Action | Notes |
|---|------|--------|-------|
| 1 | **Upgrade Plan to `standard`** | Dashboard → Settings → Plan → `standard` | Free plan has sleep/wake cycles; standard is required for production |
| 2 | **Sync `healthCheckPath`** | Dashboard → Settings → Health Check Path → `/health` | Must match the working endpoint |
| 3 | **Sync `startCommand`** | Dashboard → Settings → Start Command → `npm run migrate && npm start` | Ensures migrations run on deploy |
| 4 | **Set `JWT_SECRET`** | Dashboard → Environment → Add `JWT_SECRET` | Value: `f7cf3cb909bfef6b63b3188182f5e0868233fb5f9f703a41788214fd6b026189` |
| 5 | **Set `SESSION_SECRET`** | Dashboard → Environment → Add `SESSION_SECRET` | Value: `89856c7d7fc621a077361e25bc826d076ee360e4882b01ed580991977f08303d` |
| 6 | **Set `DATABASE_URL`** | Dashboard → Environment → Add `DATABASE_URL` | Neon PostgreSQL connection string |
| 7 | **Set `POLSIA_API_KEY`** | Dashboard → Environment → Add `POLSIA_API_KEY` | Primary AI provider — all AI features dead without it |
| 8 | **Set `POLSIA_API_URL`** | Dashboard → Environment → Add `POLSIA_API_URL` | AI proxy endpoint URL |

### 🟡 High Priority — Required for Full Feature Set

| # | Item | Action | Notes |
|---|------|--------|-------|
| 9 | **Stripe Live Keys** | Replace `STRIPE_SECRET_KEY` (`sk_test_*` → `sk_live_*`) and `STRIPE_PUBLISHABLE_KEY` (`pk_test_*` → `pk_live_*`) | **CEO approval required** |
| 10 | **Stripe Webhook Secret** | Set `STRIPE_WEBHOOK_SECRET` (`whsec_*` for live mode) | Must match live webhook endpoint |
| 11 | **SMTP / Email** | Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `SMTP_FROM` | Required for password resets, invites, alerts |
| 12 | **R2 / Cloudflare Storage** | Set `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, `R2_PUBLIC_URL` | Required for resume uploads, avatars, documents |
| 13 | **Google OAuth** | Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Required for social login |
| 14 | **LinkedIn OAuth** | Set `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI` | Required for social login |
| 15 | **Admin Credentials** | Set `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Default values are a security risk |

### 🟢 Medium Priority — AI Model Routing & Rate Limiting

| # | Item | Action | Notes |
|---|------|--------|-------|
| 16 | **NIM Model Configs** | Set `NIM_LLM_MODEL`, `NIM_LLM_LLAMA_8B`, `NIM_LLM_LLAMA_70B`, etc. | 24+ variables for fallback AI routing |
| 17 | **OpenAI Rate Limiting** | Set `OPENAI_DAILY_TOKEN_BUDGET` | Prevent runaway API costs |
| 18 | **Core URLs** | Verify `REKRUT_AI_URL`, `APP_URL`, `FRONTEND_URL`, `BASE_URL`, `CORS_ORIGINS` | Already in blueprint; ensure synced |
| 19 | **SSL Verification** | Verify `FORCE_SSL_VERIFY` = `true` | Already in blueprint; ensure synced |

---

## Blueprint vs. Deployed Service Gap

The `render.yaml` blueprint is now **fully correct** for production. However, DO-001 found that the **deployed service** (`rekrutai-prod`) still reflects older settings:

| Setting | Blueprint (`render.yaml`) | Deployed Service (Render API) | Status |
|---------|---------------------------|-------------------------------|--------|
| `plan` | `standard` | `free` | 🔴 Needs sync |
| `healthCheckPath` | `/health` | ` ""` | 🔴 Needs sync |
| `startCommand` | `npm run migrate && npm start` | `node server.js` | 🔴 Needs sync |
| `NODE_ENV` | `production` | Not in API response | ⚠️ Verify |
| `DATABASE_URL` | `sync: false` (Neon) | Neon URL (correct) | ✅ OK |
| `JWT_SECRET` | `sync: false` | 64-char hex (needs rotation) | ⚠️ Replace with new values |
| `SESSION_SECRET` | `sync: false` | 64-char hex (needs rotation) | ⚠️ Replace with new values |

**Recommended action:** After setting all secrets in the dashboard, trigger a **manual deploy** from the latest `main` commit (`43cf770`) to force Render to sync the blueprint settings.

---

## Pre-Deploy Checklist (Ranga)

- [ ] Upgrade `rekrutai-prod` plan from `free` → `standard` in Render Dashboard
- [ ] Set `healthCheckPath` = `/health` in Render Dashboard
- [ ] Set `startCommand` = `npm run migrate && npm start` in Render Dashboard
- [ ] Set `JWT_SECRET` = `f7cf3cb909bfef6b63b3188182f5e0868233fb5f9f703a41788214fd6b026189`
- [ ] Set `SESSION_SECRET` = `89856c7d7fc621a077361e25bc826d076ee360e4882b01ed580991977f08303d`
- [ ] Set `DATABASE_URL` = Neon production connection string
- [ ] Set `POLSIA_API_KEY` and `POLSIA_API_URL`
- [ ] Replace Stripe test keys with live keys (`sk_live_*`, `pk_live_*`) — CEO approval
- [ ] Set `STRIPE_WEBHOOK_SECRET` for live mode
- [ ] Set all SMTP credentials
- [ ] Set all R2/Cloudflare credentials
- [ ] Set Google OAuth credentials
- [ ] Set LinkedIn OAuth credentials
- [ ] Set admin credentials (`ADMIN_USERNAME`, `ADMIN_PASSWORD`)
- [ ] Set NIM model configuration variables (24+)
- [ ] Trigger manual deploy from commit `43cf770`
- [ ] Run smoke tests after deploy (health, login, AI, Stripe, OAuth, email)

---

## Appendix: Generated Secrets (Production-Only)

```bash
# Generated 2026-06-09 with: node -e "require('crypto').randomBytes(32).toString('hex')"
JWT_SECRET=f7cf3cb909bfef6b63b3188182f5e0868233fb5f9f703a41788214fd6b026189
SESSION_SECRET=89856c7d7fc621a077361e25bc826d076ee360e4882b01ed580991977f08303d
```

**⚠️ These are secrets. Store them in a password manager (e.g., 1Password, Bitwarden) and do NOT commit them to git. They are shown here only for Ranga to copy into the Render Dashboard.**

---

*Report generated by DevOps Automator (DO-002)*  
*Commit: `43cf770` on `main`*  
*Next step: Ranga to set secrets in Render Dashboard and trigger manual deploy*
