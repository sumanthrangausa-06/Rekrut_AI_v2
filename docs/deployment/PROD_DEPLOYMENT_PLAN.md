# Rekrut AI — Production Deployment Plan

> **Owner:** DevOps Automator (Suga) | **Date:** 2026-06-08 | **Target Deploy:** June 19, 2026
> **Status:** 🟡 **PLANNING** — 3 critical blockers must be resolved before deploy
> **Decision Authority:** Ranga (CEO)

---

## 1. Executive Summary

This document is the **single source of truth** for deploying Rekrut AI to production at `https://rekrutai.co`. It covers the current Render service configuration, the complete environment variable inventory, database migration strategy, domain/SSL setup, build/deploy steps, and rollback procedures.

### Current Production Readiness: ~35% — NOT READY

| Criterion | Status | Blocker |
|-----------|--------|---------|
| Domain + SSL live | ✅ Ready | `rekrutai.co` resolves, HTTPS active |
| Render prod service configured | ✅ Ready | `rekrutai-prod` on `standard` plan |
| CI/CD pipelines exist | ✅ Ready | `ci.yml` + `deploy.yml` implemented |
| `autoDeploy: false` on prod | ✅ Ready | Fixed in `dev` branch (`ffd5869`) |
| **Staging environment healthy** | 🔴 **BLOCKED** | Returns **404** — cannot validate before prod |
| **Database migrations automated** | 🔴 **BLOCKED** | `migrate.js` NOT in `startCommand` |
| **Migration naming clean** | 🔴 **BLOCKED** | Duplicate prefixes: `003_`, `005_`, `045_` |
| Security headers deployed | 🔴 **BLOCKED** | `x-powered-by: Express` still present on prod |
| E2E pass rate | ⚠️ Pending | 85.7% (6/7); `dark-mode.spec.ts` SIGKILL |
| Prod secrets verified | ⚠️ Pending | All `sync: false` vars need manual verification |
| Stripe live mode ready | ⚠️ Pending | Ranga must confirm `sk_live_*` key |

**Verdict:** Deploy is **NO-GO** until the 4 critical blockers above are resolved. Minimum timeline to fix: **3–5 days**.

---

## 2. Current Render Service Configuration

### 2.1 Production Service (`rekrutai-prod`)

| Config | Value | Notes |
|--------|-------|-------|
| **Branch** | `main` | Only `main` deploys to production |
| **Plan** | `standard` | Sufficient for launch; consider upgrading post-launch |
| **Instances** | `1` | ⚠️ **Zero-downtime deploy impossible** — upgrade to `2` for rolling deploys |
| **Auto-Deploy** | `false` | ✅ **Manual deploy only** — prevents accidental pushes |
| **Build Command** | `cd client && npm install --include=dev && npm run build && cd .. && npm install` | Builds React frontend + installs server deps |
| **Start Command** | `npm start` (→ `node server.js`) | ⚠️ **Does NOT run migrations** — see §4 |
| **Health Check** | `/health` | Returns `{"status":"ok","timestamp":"..."}` |
| **Port** | `10000` | Render standard Node.js port |
| **Node Version** | `20` (inferred from `ci.yml`) | Verify `package.json` `engines` field |

### 2.2 Supporting Services

| Service | Type | Branch | Plan | Purpose |
|---------|------|--------|------|---------|
| `rekrutai-prod-db` | PostgreSQL | `main` | `standard` | Production database (Render-managed) |
| `rekrutai-staging` | Web | `staging` | *default* | Pre-prod validation environment |
| `rekrutai-staging-db` | PostgreSQL | `staging` | `starter` | Staging database |
| `rekrutai-dev` | Web | `dev` | *default* | Development environment |
| `rekrutai-dev-db` | PostgreSQL | `dev` | `starter` | Dev database |

### 2.3 Staging Status — CRITICAL

**`https://rekrutai-staging.onrender.com` currently returns 404.**

This means:
- No pre-production validation environment is available
- Cannot run smoke tests, E2E against staging, or QA sign-off
- Deploying to production without staging validation is **extremely high risk**

**Fix required:**
1. Verify `rekrutai-staging` service exists in Render Dashboard
2. If missing, create from `render.yaml` blueprint or manually deploy
3. Push `staging` branch to trigger auto-deploy
4. Confirm `/health` returns 200 before any production promotion

---

## 3. Environment Variables — Production

### 3.1 Variables Configured in `render.yaml` (`value` or `fromDatabase`)

| Variable | Source | Status | Notes |
|----------|--------|--------|-------|
| `NODE_ENV` | `production` | ✅ Ready | Hardcoded in `render.yaml` |
| `PORT` | `10000` | ✅ Ready | Hardcoded |
| `DATABASE_URL` | `fromDatabase: rekrutai-prod-db` | ✅ Ready | Auto-linked by Render |
| `REKRUT_AI_URL` | `https://rekrutai.co` | ✅ Ready | |
| `APP_URL` | `https://rekrutai.co` | ✅ Ready | |
| `FRONTEND_URL` | `https://rekrutai.co` | ✅ Ready | |
| `BASE_URL` | `https://rekrutai.co` | ✅ Ready | |
| `CORS_ORIGINS` | `https://rekrutai.co,https://www.rekrutai.co` | ✅ Ready | Restricted to prod domain |
| `FORCE_SSL_VERIFY` | `true` | ✅ Ready | Enforces strict SSL in `lib/db.js` |

### 3.2 Secrets — Must Be Set Manually in Render Dashboard

**All the following are `sync: false` in `render.yaml`. They MUST be populated via the Render Dashboard BEFORE the first production deploy.**

| Variable | Required? | Who Sets It | Verification Step |
|----------|-----------|-------------|-------------------|
| `JWT_SECRET` | ✅ **Critical** | Suga / Ranga | Long random string (≥32 chars). Must be consistent across restarts. |
| `SESSION_SECRET` | ✅ **Critical** | Suga / Ranga | Long random string (≥32 chars). Must be consistent across restarts. |
| `ADMIN_USERNAME` | ✅ **Critical** | Suga | Default admin login for `/admin` panel |
| `ADMIN_PASSWORD` | ✅ **Critical** | Suga | Strong password, hashed by app |
| `STRIPE_SECRET_KEY` | ✅ **Critical** | Ranga | **Must be `sk_live_*` (live mode).** Test keys will break real payments. |
| `STRIPE_WEBHOOK_SECRET` | ✅ **Critical** | Ranga | Live endpoint secret from Stripe Dashboard (`whsec_...`) |
| `POLSIA_API_KEY` | ✅ **Critical** | Suga | Production API key for Polsia integration |
| `POLSIA_API_URL` | ✅ **Critical** | Suga | Base URL for Polsia API |
| `OPENAI_API_KEY` | ⚠️ **Required** | Suga | At least one AI provider key is required for AI features |
| `OPENAI_BASE_URL` | ⚠️ Required | Suga | OpenAI API base URL (if custom) |
| `OPENAI_DAILY_TOKEN_BUDGET` | Optional | Suga | Rate limit for OpenAI usage |
| `NVIDIA_NIM_API_KEY` | ⚠️ Required | Suga | NIM inference API key |
| `NIM_BASE_URL` | ⚠️ Required | Suga | NIM base URL |
| `GROQ_API_KEY` | ⚠️ Required | Suga | Groq API key (fallback LLM) |
| `CEREBRAS_API_KEY` | ⚠️ Required | Suga | Cerebras API key (fallback LLM) |
| `DEEPGRAM_API_KEY` | ⚠️ Required | Suga | Required for TTS/STT audio features |
| `NIM_LLM_MODEL` | Optional | Suga | Default NIM LLM model |
| `NIM_LLM_LLAMA_8B` | Optional | Suga | |
| `NIM_LLM_LLAMA_70B` | Optional | Suga | |
| `NIM_LLM_GEMMA` | Optional | Suga | |
| `NIM_LLM_GPT_OSS` | Optional | Suga | |
| `NIM_LLM_NANO_30B` | Optional | Suga | |
| `NIM_LLM_STEP_FLASH` | Optional | Suga | |
| `NIM_LLM_ULTRA` | Optional | Suga | |
| `NIM_REASONING_QWQ` | Optional | Suga | |
| `NIM_SAFETY_MODEL` | Optional | Suga | |
| `NIM_SAFETY_REASONING` | Optional | Suga | |
| `NIM_VISION_GEMMA` | Optional | Suga | |
| `NIM_VISION_FALLBACK_MODEL` | Optional | Suga | |
| `NIM_EMBED_MODEL` | Optional | Suga | |
| `NIM_EMBED_VL` | Optional | Suga | |
| `NIM_DOCUMENT_MODEL` | Optional | Suga | |
| `NIM_ASR_MODEL` | Optional | Suga | |
| `NIM_ASR_V3` | Optional | Suga | |
| `NIM_TTS_BASE_URL` | Optional | Suga | |
| `NIM_FASTPITCH_BASE_URL` | Optional | Suga | |
| `NIM_MAGPIE_ZERO_BASE_URL` | Optional | Suga | |
| `NIM_MAGPIE_FLOW_BASE_URL` | Optional | Suga | |
| `NIM_MAGPIE_MULTI_BASE_URL` | Optional | Suga | |
| `R2_ACCESS_KEY_ID` | Optional | Suga | Cloudflare R2 (if file uploads enabled) |
| `R2_SECRET_ACCESS_KEY` | Optional | Suga | |
| `R2_BUCKET_NAME` | Optional | Suga | |
| `R2_ENDPOINT` | Optional | Suga | |
| `R2_PUBLIC_URL` | Optional | Suga | |
| `EMAIL_HOST` | Optional | Suga | Transactional email provider |
| `EMAIL_PORT` | Optional | Suga | |
| `EMAIL_USER` | Optional | Suga | |
| `EMAIL_PASS` | Optional | Suga | |
| `EMAIL_FROM_ADDRESS` | Optional | Suga | |
| `EMAIL_FROM_NAME` | Optional | Suga | |
| `EMAIL_RATE_LIMIT` | Optional | Suga | |
| `EMAIL_RATE_LIMIT_HOUR` | Optional | Suga | |
| `EMAIL_RETRY_ATTEMPTS` | Optional | Suga | |
| `EMAIL_RETRY_DELAY` | Optional | Suga | |
| `SMTP_HOST` | Optional | Suga | Alternative SMTP config |
| `SMTP_PORT` | Optional | Suga | |
| `SMTP_USER` | Optional | Suga | |
| `SMTP_PASS` | Optional | Suga | |
| `SMTP_SECURE` | Optional | Suga | |
| `SMTP_FROM` | Optional | Suga | |
| `GOOGLE_CLIENT_ID` | Optional | Suga | OAuth login (Google) |
| `GOOGLE_CLIENT_SECRET` | Optional | Suga | |
| `GOOGLE_REDIRECT_URI` | Optional | Suga | Must be `https://rekrutai.co/api/auth/google/callback` |
| `LINKEDIN_CLIENT_ID` | Optional | Suga | OAuth login (LinkedIn) |
| `LINKEDIN_CLIENT_SECRET` | Optional | Suga | |
| `LINKEDIN_REDIRECT_URI` | Optional | Suga | Must be `https://rekrutai.co/api/auth/linkedin/callback` |

### 3.3 Environment Variable Setup Checklist for Ranga

Before production deploy, Ranga (or Suga) must complete the following in the Render Dashboard:

- [ ] Go to [Render Dashboard](https://dashboard.render.com/) → `rekrutai-prod` → Environment
- [ ] Add all `sync: false` secrets from the table above
- [ ] **Verify `STRIPE_SECRET_KEY` starts with `sk_live_` (NOT `sk_test_`)**
- [ ] **Verify `STRIPE_WEBHOOK_SECRET` matches the live webhook endpoint in Stripe Dashboard**
- [ ] Set `GOOGLE_REDIRECT_URI` and `LINKEDIN_REDIRECT_URI` to use `https://rekrutai.co`
- [ ] Confirm `JWT_SECRET` and `SESSION_SECRET` are ≥32 characters and will not change across restarts

> ⚠️ **Stripe Live Mode Checklist:**
> - [ ] Stripe Dashboard: Products and Pricing configured for live mode
> - [ ] Stripe Dashboard: Webhook endpoint URL set to `https://rekrutai.co/api/billing/webhook`
> - [ ] Stripe Dashboard: Webhook events subscribed: `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.updated`
> - [ ] Render Dashboard: `STRIPE_WEBHOOK_SECRET` copied from the live webhook endpoint detail page

---

## 4. Database Migration Plan

### 4.1 Current Migration State

**Migration engine:** `migrate.js` (custom, idempotent, tracks applied migrations in `_migrations` table)

**Migration files location:** `/migrations/`

**Critical issue:** Migration files have **duplicate prefixes** and **non-numeric prefixes**, which causes non-deterministic application order.

#### Duplicate Prefixes (MUST FIX)

| Prefix | Files | Risk |
|--------|-------|------|
| `003` | `003_add_company_profile_fields.js` + `003_add_role_column.js` | Alphabetical sort is unstable — order changes per filesystem |
| `005` | `005_backfill_application_company_id.js` + `005_oauth_refresh_tokens.js` | Same risk |
| `045` | `045_fix_company_id_fk_constraints.sql` + `045_p2_schema_hardening.js` | Same risk |

#### Non-Numeric Prefixes (SHOULD FIX)

| File | Issue |
|------|-------|
| `1739617200000_p1_interview_flow_schema.js` | Timestamp prefix sorts after numeric files; ordering may be unexpected |
| `p2_schema_hardening.sql` | Sorts before numeric files (alphabetically) — may run too early |
| `p3_schema_optimizations.js` | Same as above |
| `seed_notification_templates.js` | Sorts before numeric files — may run too early |

### 4.2 Migration Fix Commands

Run these **before** any production deploy:

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

### 4.3 Migration Automation — CRITICAL

**Current state:** `migrate.js` is **NOT** run during deploy. If a schema-changing commit deploys, production will crash with "relation does not exist" until someone manually runs `npm run migrate` via Render shell.

#### Option A: Startup Migration (Recommended)

Change `startCommand` in `render.yaml`:

```yaml
startCommand: npm run migrate && npm start
```

**Pros:**
- Simple, always runs on boot
- Migrations are idempotent (safe to run multiple times)
- Zero manual intervention

**Cons:**
- Adds ~2–5s to startup time
- If migration fails, container crashes and restarts (which is actually the safe behavior)

#### Option B: Render Deploy Hook (Alternative)

Use Render's "Deploy Hook" feature to trigger `npm run migrate` after successful deploy but before traffic routing.

**Pros:**
- Doesn't block startup
- Can run migration on a separate process

**Cons:**
- Requires Render API integration
- Migration runs after app is live (brief inconsistency window)

#### Option C: GitHub Actions Post-Deploy Migration

Add a step to `deploy.yml` that runs `npm run migrate` against the prod DB after the Render deploy.

**Pros:**
- CI-controlled, logs visible in GitHub
- Can add pre-migration backup step

**Cons:**
- Requires `DATABASE_URL` secret in GitHub Actions
- More complex pipeline

**Recommended:** Implement **Option A** immediately. It is the industry standard for Render + Node.js + PostgreSQL deployments.

### 4.4 Pre-Migration Backup Policy

Before any production migration, create a database backup:

```bash
# Option 1: Render Dashboard backup (automatic for standard plan)
# Render PostgreSQL on standard plan includes daily automated backups.
# Verify backup history in Render Dashboard → rekrutai-prod-db → Backups.

# Option 2: Manual pg_dump (for extra safety before deploy)
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d-%H%M).sql
```

> **Note:** `rekrutai-prod-db` is on Render's `standard` plan, which includes automated daily backups. For critical deploys, run a manual `pg_dump` immediately before the migration.

### 4.5 Migration Verification

After any migration (dev, staging, or prod), verify:

```bash
# Via Render Dashboard → rekrutai-prod → Shell
psql $DATABASE_URL -c "SELECT * FROM _migrations ORDER BY id;"
```

Expected output: All migration filenames should be present with `applied_at` timestamps.

---

## 5. Domain Configuration

### 5.1 Primary Domain: `rekrutai.co`

| Check | Status | Notes |
|-------|--------|-------|
| DNS resolves | ✅ Yes | Cloudflare A/AAAA records point to Render |
| Cloudflare proxy | ✅ Yes | Orange cloud enabled |
| Custom domain on Render | ⚠️ Presumed | Verify in Render Dashboard → `rekrutai-prod` → Custom Domains |
| `www` → apex redirect | ⚠️ Unknown | Verify or configure in Cloudflare |

### 5.2 Cloudflare DNS Configuration

Ensure the following DNS records are configured in Cloudflare:

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

**Page Rules (recommended):**

```
URL: www.rekrutai.co/*
Setting: Forwarding URL → 301 Permanent Redirect → https://rekrutai.co/$1
```

### 5.3 Render Custom Domain Setup

1. Go to Render Dashboard → `rekrutai-prod` → Settings → Custom Domains
2. Add `rekrutai.co`
3. Add `www.rekrutai.co` (if needed)
4. Verify Render provides the origin IP for Cloudflare DNS
5. Wait for SSL certificate provisioning (Render auto-generates)

### 5.4 Domain Checklist

- [ ] `rekrutai.co` added as Custom Domain in Render Dashboard
- [ ] Cloudflare DNS A records point to Render origin
- [ ] `www.rekrutai.co` redirects to `rekrutai.co` (301)
- [ ] `CORS_ORIGINS` in `render.yaml` includes both `https://rekrutai.co` and `https://www.rekrutai.co`

---

## 6. SSL Certificate Setup

### 6.1 Current State

| Component | Provider | Status |
|-----------|----------|--------|
| Edge SSL | Cloudflare | ✅ Auto-managed TLS 1.3 |
| Origin SSL | Render | ✅ Auto-managed TLS 1.2+ |
| Certificate expiry | Auto-renewed | ✅ No manual renewal needed |
| HSTS header | Missing | 🔴 **Not present in response** (see §7.2) |

### 6.2 SSL Configuration Details

**Cloudflare (Edge):**
- SSL/TLS mode: **Full (strict)** recommended (encrypts traffic between Cloudflare and Render)
- Minimum TLS version: 1.2
- Certificate: Cloudflare-managed, auto-renewed

**Render (Origin):**
- Certificate: Render-managed, auto-renewed
- `FORCE_SSL_VERIFY: true` in `render.yaml` ensures strict SSL verification to PostgreSQL

### 6.3 SSL Checklist

- [ ] Cloudflare SSL/TLS mode set to "Full (strict)" (not "Flexible")
- [ ] `FORCE_SSL_VERIFY=true` set in `render.yaml` (already done)
- [ ] `SESSION_SECRET` and `JWT_SECRET` are strong (≥32 chars)
- [ ] Session cookie `secure=true` in production (configured in `server.js` for `NODE_ENV=production`)
- [ ] HSTS header enabled in `server.js` (Helmet should configure this, but verify in production response)

---

## 7. Build and Deploy Steps

### 7.1 Pipeline Architecture

```
[feature branch] → PR to dev → CI runs → Merge to dev → Render auto-deploys to dev
                                                        ↓
                                             PR: dev → staging → CI runs → Merge to staging
                                                        ↓
                                             Render auto-deploys to staging
                                                        ↓
                                             QA validation + smoke tests
                                                        ↓
                                             PR: staging → main → CI runs → Ranga approves
                                                        ↓
                                             Merge to main
                                                        ↓
                                             GitHub Actions: "Deploy to Production" workflow
                                                        ↓
                                             Manual trigger in Render Dashboard
                                                        ↓
                                             Production live
```

### 7.2 CI/CD Gates (Already Implemented)

| Workflow | File | Trigger | Jobs |
|----------|------|---------|------|
| **CI** | `.github/workflows/ci.yml` | PR to `dev`/`staging`/`main`; push to `dev`/`staging` | Build, Audit, E2E (Chromium), Health Check |
| **Deploy** | `.github/workflows/deploy.yml` | `workflow_dispatch` from `main` with `deploy-to-prod` confirmation | Verify, CI re-run, Deploy instructions, Post-deploy health check |

### 7.3 Production Deploy Steps (Step-by-Step)

#### Step 1: Pre-Deploy (Deploying Engineer — Suga)

```bash
# 1. Ensure staging is healthy
curl -s https://rekrutai-staging.onrender.com/health
# Expected: {"status":"ok","timestamp":"..."}

# 2. Verify staging branch is clean
git checkout staging
git status
# Expected: "nothing to commit, working tree clean"

# 3. Review commits since last production deploy
git log main..staging --oneline

# 4. Verify all prod env vars are set in Render Dashboard
# (see §3.3 checklist)
```

#### Step 2: Create Production PR

1. Open GitHub: `https://github.com/sumanthrangausa-06/Rekrut_AI_v2`
2. Create PR: `staging` → `main`
3. Title: `Deploy: YYYYMMDD — [brief description]`
4. Body template:

```markdown
## What's Deploying
- [List features/fixes]
- Commits: `git log main..staging --oneline`

## Staging Validation
- [ ] Build passed
- [ ] Smoke tests passed
- [ ] API health check passed
- [ ] AI providers responding
- [ ] No P0 bugs in staging

## Rollback Plan
- Previous production commit: `git rev-parse origin/main`
- Rollback: Render Dashboard → Manual Deploy → Previous commit
- Or: `git revert [merge-commit]` + push to main
```

#### Step 3: Merge and Trigger Deploy

1. Ranga approves the PR
2. Merge PR to `main` (use **merge commit**, not squash, to preserve history)
3. Go to GitHub Actions → "Deploy to Production"
4. Click "Run workflow"
5. Select `main` branch
6. Type `deploy-to-prod` in confirmation field
7. Click "Run workflow"

#### Step 4: Manual Render Deploy (Required because `autoDeploy: false`)

```bash
# Option A: Render Dashboard (Recommended)
# 1. Go to https://dashboard.render.com/
# 2. Select service: rekrutai-prod
# 3. Click "Manual Deploy" → "Deploy latest commit"
# 4. Monitor build logs

# Option B: Render CLI (if installed)
render deploy --service rekrutai-prod
```

#### Step 5: Post-Deploy Verification (Within 30 minutes)

```bash
# 1. Health check
curl -s https://rekrutai.co/health
# Expected: {"status":"ok","timestamp":"..."}

# 2. API health alias
curl -s https://rekrutai.co/api/health
# Expected: same as above

# 3. Security headers check
curl -I https://rekrutai.co/health
# Expected: NO "x-powered-by: Express"
# Expected: "strict-transport-security" present
# Expected: "content-security-policy" present

# 4. Smoke test — login → dashboard
curl -s -X POST https://rekrutai.co/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test_recruiter@rekrutai.co","password":"Test123!"}'
# Expected: 200 with JWT token
```

### 7.4 Build Steps Detail

```bash
# Render build command (from render.yaml)
cd client && npm install --include=dev && npm run build && cd .. && npm install

# What this does:
# 1. cd client              → Enter frontend directory
# 2. npm install --include=dev → Install all deps (including devDeps for Vite build)
# 3. npm run build          → Vite builds React app to client/dist/
# 4. cd ..                  → Return to server root
# 5. npm install            → Install server dependencies
```

### 7.5 Start Steps Detail

```bash
# Current start command (from render.yaml)
npm start  # → node server.js

# Recommended start command (with migration):
npm run migrate && npm start  # → node migrate.js && node server.js
```

---

## 8. Rollback Plan

### 8.1 Rollback Decision Criteria

Rollback immediately if any of the following are detected within 30 minutes of deploy:

- `https://rekrutai.co/health` returns non-200
- 5xx errors in Render logs
- Database connection errors
- Stripe webhook failures
- AI provider circuit breaker stuck open
- Any P0 bug affecting user login, payments, or core workflows

### 8.2 Rollback Options

#### Option A — Fast Render Dashboard Rollback (Recommended, < 2 min)

1. Render Dashboard → `rekrutai-prod` → "Manual Deploy"
2. Select "Deploy previous commit" (or pick a specific known-good commit)
3. Render will redeploy the previous version immediately

**Pros:** Fastest, no git history changes, no database impact if no migrations ran
**Cons:** Only works if the previous commit is known-good and the database schema hasn't changed

#### Option B — Git Revert + Push (3–5 min)

```bash
# 1. Identify the bad merge commit
git log main --oneline -5

# 2. Revert the merge commit (-m 1 for merge commit)
git revert -m 1 [bad-merge-commit-hash]

# 3. Push to main (triggers Render deploy if autoDeploy was true, but since it's false,
#    you'll need to manually deploy the revert commit via Dashboard)
git push origin main

# 4. Go to Render Dashboard and manually deploy the new revert commit
```

**Pros:** Clean git history, documented revert
**Cons:** Requires manual deploy step since autoDeploy is false

#### Option C — Hard Reset (Emergency only, 1–2 min)

```bash
# 1. Identify last known good commit
git log main --oneline -10

# 2. Reset to that commit
git reset --hard [last-good-commit-hash]

# 3. Force push (use --force-with-lease for safety)
git push origin main --force-with-lease

# 4. Manually deploy in Render Dashboard
```

**Pros:** Fastest if revert is messy
**Cons:** Rewrites history, dangerous if team is actively working on `main`

#### Option D — Database Rollback (If Migrations Caused Data Corruption)

```bash
# 1. Check Render Dashboard → rekrutai-prod-db → Backups
# 2. Restore from the most recent backup
# 3. OR create a reverse migration and run it manually:
#    npm run migrate  # (if reverse migration exists)
# 4. Verify data integrity after restore
```

**Pros:** Fixes data corruption
**Cons:** 10–30 minutes, potential data loss since last backup

### 8.3 Post-Rollback Verification

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

## 9. Critical Pre-Deploy Blockers

These **must** be resolved before deploying to production. Do not proceed past any blocker.

### Blocker 1: Staging Environment DOWN (404)

| Detail | Value |
|--------|-------|
| **Symptom** | `https://rekrutai-staging.onrender.com` returns 404 |
| **Impact** | Cannot validate any changes before production |
| **Fix** | Verify `rekrutai-staging` service in Render Dashboard; push `staging` branch to trigger deploy |
| **ETA** | 1–2 hours |
| **Owner** | Suga |

### Blocker 2: Database Migrations Not Automated

| Detail | Value |
|--------|-------|
| **Symptom** | `startCommand` is `npm start` (no `npm run migrate`) |
| **Impact** | Schema-changing deploys will crash production until manual migration runs |
| **Fix** | Change `render.yaml` `startCommand` to `npm run migrate && npm start` |
| **ETA** | 30 minutes |
| **Owner** | Suga |

### Blocker 3: Duplicate Migration Prefixes

| Detail | Value |
|--------|-------|
| **Symptom** | `003_*` × 2, `005_*` × 2, `045_*` × 2 |
| **Impact** | Non-deterministic migration order; potential FK constraint failures |
| **Fix** | Rename files to remove duplicates (see §4.2) |
| **ETA** | 30 minutes |
| **Owner** | Suga |

### Blocker 4: Security Headers Not Deployed to Production

| Detail | Value |
|--------|-------|
| **Symptom** | `x-powered-by: Express` still present in production response; HSTS missing |
| **Impact** | Production vulnerable to information disclosure, clickjacking, XSS |
| **Fix** | Merge `dev` branch (which has Helmet + `app.disable('x-powered-by')`) to `main` and deploy |
| **ETA** | 1 hour (after merge) |
| **Owner** | Suga |

### Blocker 5: GitHub PAT Exposed in `.git/config`

| Detail | Value |
|--------|-------|
| **Symptom** | `[REDACTED]` in origin URL |
| **Impact** | Full GitHub account compromise if repo is shared |
| **Fix** | Revoke token in GitHub Settings → Tokens; update remote URL to SSH or HTTPS without token |
| **ETA** | 15 minutes |
| **Owner** | Suga |

### Blocker 6: E2E Test Failure (`dark-mode.spec.ts` SIGKILL)

| Detail | Value |
|--------|-------|
| **Symptom** | Playwright test killed by OOM (7GB RAM limit) |
| **Impact** | CI gate unreliable; blocks 100% pass rate requirement |
| **Fix** | Add `page.close()` in `auth.setup.ts`, reduce workers, or split test |
| **ETA** | 2–4 hours |
| **Owner** | Sunny (QA) |

---

## 10. Production Deployment Timeline

### Phase 1: Critical Fixes (Days 1–2)

| Day | Action | Owner | Effort |
|-----|--------|-------|--------|
| **Mon 6/8** | Revoke exposed GitHub PAT | Suga | 15 min |
| **Mon 6/8** | Fix staging 404 (verify/deploy service) | Suga | 1–2 hrs |
| **Mon 6/8** | Rename duplicate migration files | Suga | 30 min |
| **Tue 6/9** | Add `npm run migrate && npm start` to `render.yaml` | Suga | 30 min |
| **Tue 6/9** | Merge `dev` → `staging`, verify staging deploys | Suga | 30 min |
| **Tue 6/9** | Run full staging validation (smoke tests, login, dashboard, AI) | Sunny + Suga | 2–3 hrs |

### Phase 2: Validation & Gates (Days 3–5)

| Day | Action | Owner | Effort |
|-----|--------|-------|--------|
| **Wed 6/10** | Fix `dark-mode.spec.ts` SIGKILL | Sunny | 2–4 hrs |
| **Wed 6/10** | Test `ci.yml` on PR to `dev` | Suga | 1–2 hrs |
| **Wed 6/10** | Increase `numInstances` to 2 for prod in `render.yaml` | Suga | 5 min |
| **Thu 6/11** | Enable branch protection on `main` (require PR + CI pass) | Ranga | 15 min |
| **Thu 6/11** | Ranga verifies all prod secrets in Render Dashboard | Ranga | 1 hr |
| **Thu 6/11** | Verify Stripe live keys and webhook endpoint | Ranga | 30 min |
| **Fri 6/12** | Run `npm run migrate` on prod DB (dry-run first) | Suga | 1 hr |
| **Fri 6/12** | Run full E2E suite against staging | Sunny | 2–3 hrs |

### Phase 3: Production Deploy (Days 8–11)

| Day | Action | Owner | Effort |
|-----|--------|-------|--------|
| **Mon 6/15** | Lighthouse audit on staging | Sunny | 1 hr |
| **Tue 6/16** | Create PR: `staging` → `main` with full checklist | Suga | 30 min |
| **Tue 6/16** | Ranga approves PR | Ranga | 15 min |
| **Wed 6/17** | Merge PR → `main` → trigger manual Render deploy | Suga | 30 min |
| **Wed 6/17** | Post-deploy verification (smoke, API, AI, Stripe) | Sunny + Suga | 2–3 hrs |
| **Thu 6/18** | Buffer day — fix any issues | Suga + Sunny | 1–2 days |
| **Fri 6/19** | **GO / NO-GO decision** | Ranga | — |

---

## 11. Post-Launch Improvements (After June 19)

| Priority | Action | Owner | Effort |
|----------|--------|-------|--------|
| 🟡 High | Add `numInstances: 2` and test rolling deploys | Suga | 1 hr |
| 🟡 High | Add Sentry or LogRocket for error tracking | Suga | 2 hrs |
| 🟡 High | Add `scripts/smoke-test.js` for post-deploy automation | Suga | 2 hrs |
| 🟡 High | Add `pg_dump` pre-migration backup step to `deploy.yml` | Suga | 2 hrs |
| 🟡 Medium | Add Vitest + React Testing Library for unit tests | Sunny | 2–3 days |
| 🟡 Medium | Add Jest + Supertest for API integration tests | Sunny | 2–3 days |
| 🟡 Medium | Add k6 load testing scripts | Suga | 1 day |
| 🟢 Low | Add Dependabot for dependency updates | Suga | 30 min |
| 🟢 Low | Add `@axe-core/playwright` for accessibility | Sunny | 2 hrs |
| 🟢 Low | Document `.env` rotation process | Suga | 1 hr |

---

## 12. Appendices

### A. Quick Reference Commands

```bash
# Health checks
curl https://rekrutai-dev.onrender.com/health
curl https://rekrutai-staging.onrender.com/health
curl https://rekrutai.co/health

# Branch status
git log --oneline --graph --decorate --all -10

# Sync staging with dev
git checkout staging && git merge --ff-only dev && git push origin staging

# Check migration status on any DB
psql $DATABASE_URL -c "SELECT * FROM _migrations ORDER BY id;"

# Local build verification
npm ci && cd client && npm ci && npm run build && cd .. && npm start

# Run migrations locally
npm run migrate
```

### B. Related Documents

| Document | Path | Purpose |
|----------|------|---------|
| CI/CD Pipeline | `DEPLOYMENT_PROCESS.md` | Detailed CI/CD workflow and branch protection |
| Staging Workflow | `STAGING_WORKFLOW.md` | How to promote `dev` → `staging` |
| Deployment Runbook | `docs/deployment-runbook.md` | RACI matrix, detailed runbook with edge cases |
| Prod Checklist | `docs/PROD_DEPLOY_CHECKLIST.md` | Per-deploy checklist with smoke tests |
| Render Blueprint | `render.yaml` | Infrastructure-as-code for all services |
| Readiness Report | `prod-deployment-readiness.md` | Full readiness assessment (35%) |
| Pipeline Report | `DEPLOYMENT_PIPELINE_REPORT.md` | Environment audit and gap analysis |

### C. Emergency Contacts

| Role | Person | Contact When |
|------|--------|-------------|
| Decision Authority | Ranga (CEO) | P0 issue requiring rollback or business decision |
| Technical Execution | Suga (CTO) | Build failures, deployment issues, infrastructure |
| QA Verification | Sunny (QA) | Post-deploy smoke test failures, test suite issues |
| Coordination | Kimi (COO) | Team notifications, incident communications |

### D. Render Service URLs

| Service | Dashboard URL | Public URL |
|---------|--------------|------------|
| Dev | `https://dashboard.render.com/web/srv-rekrutai-dev` | `https://rekrutai-dev.onrender.com` |
| Staging | `https://dashboard.render.com/web/srv-rekrutai-staging` | `https://rekrutai-staging.onrender.com` |
| Production | `https://dashboard.render.com/web/srv-rekrutai-prod` | `https://rekrutai.co` |

---

**Document Version:** 1.0 | **Last Updated:** 2026-06-08 | **Next Review:** Before every production deploy

**Deploy safe. Verify twice. Rollback fast.**
