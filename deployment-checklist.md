# Rekrut AI — Production Deployment Checklist & Execution Plan

> **Prepared by:** DevOps Automator (DO-001)  
> **Date:** 2026-06-08  
> **Target Launch Date:** June 19, 2026 (11 days)  
> **Current Status:** 🟡 PARTIALLY READY — Active blockers require resolution before Go/No-Go  
> **Production URL:** `https://rekrutai.co`  
> **Staging URL:** `https://rekrutai-staging.onrender.com`  
> **Dev URL:** `https://rekrutai-dev.onrender.com`  
> **Primary Deploy Target:** Render service `rekrutai-prod` → `https://rekrutai.co`  
> **Production Branch:** `main`  
> **Deploy Method:** Manual (autoDeploy: false) via GitHub Actions + Render Dashboard

---

## 📋 Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Pre-Deployment Phase (Days 1–9)](#3-pre-deployment-phase-days-1--9)
4. [Deployment Day Execution (Day 10)](#4-deployment-day-execution-day-10)
5. [Post-Deployment Verification (Day 10–11)](#5-post-deployment-verification-day-10--11)
6. [Rollback Plan](#6-rollback-plan)
7. [Environment Variables Reference](#7-environment-variables-reference)
8. [Monitoring & Alerting Setup](#8-monitoring--alerting-setup)
9. [Go / No-Go Decision Matrix](#9-go--no-go-decision-matrix)
10. [Appendices](#10-appendices)

---

## 1. Executive Summary

### 1.1 What This Document Is
This is the **single source of truth** for the Rekrut AI production deployment on June 19, 2026. It consolidates all prior checklists, eliminates duplication, and provides a step-by-step execution plan that any engineer can follow.

### 1.2 Current Verdict

🟡 **CONDITIONAL GO — Blockers must be resolved before deploy day.**

| Category | Status | Blockers |
|----------|--------|----------|
| Code integrity | 🟡 Conditional | Uncommitted changes on `dev`; `main` is 3+ commits behind `dev` |
| Build pipeline | ✅ Ready | `render.yaml` buildCommand fixed (`--include=dev`); CI/CD workflows in place |
| Security audit | ✅ Ready | All critical/high CVEs fixed; helmet headers configured; CORS whitelist active |
| Database | 🟡 Conditional | No snapshot taken yet; 52+ migrations pending (none new since last prod) |
| Environment secrets | 🔴 Blocked | ~30+ `sync: false` env vars must be set in Render dashboard |
| Stripe live mode | 🔴 Blocked | No live keys (`sk_live_*`) exist; CEO approval required |
| E2E tests | 🟡 Conditional | Suite exists; needs execution on current commit; dark-mode test has known flake |
| Monitoring | 🔴 Blocked | No external uptime monitoring (UptimeRobot, Sentry); no CDN |
| DNS / SSL | ✅ Ready | Custom domain `rekrutai.co` active; SSL auto-provisioned by Render |

### 1.3 Critical Path to Launch

```
Day 1  (Jun 9):  Commit uncommitted dev changes → fix CSP connectSrc → open dev→staging PR
Day 2  (Jun 10): Merge staging→main → enable branch protection → verify CI/CD in main
Day 3  (Jun 11): Set ALL production secrets in Render dashboard
Day 4  (Jun 12): Ranga provides Stripe live keys → create live webhook endpoint
Day 5  (Jun 13): Take production DB snapshot → run migrations dry-run → QA runs E2E on staging
Day 6  (Jun 14): OAuth redirect URI updates (Google + LinkedIn) → fix any E2E failures
Day 7  (Jun 15): Set up UptimeRobot → configure Sentry → set up log aggregation
Day 8  (Jun 16): Final staging smoke tests → performance audit (Lighthouse)
Day 9  (Jun 17): Final Go/No-Go meeting with Ranga → freeze code
Day 10 (Jun 19): DEPLOY DAY → execute Section 4
Day 11 (Jun 20): Post-deploy verification → monitor for 24h
```

---

## 2. Current State Analysis

### 2.1 Branch State

| Branch | Commit | Ahead/Behind | Status |
|--------|--------|--------------|--------|
| `dev` (local) | `e5be6f6` + uncommitted | 3+ commits ahead of `main` | Has uncommitted dist artifacts, mobile fixes, e2e updates |
| `dev` (origin) | `e5be6f6` | Same as local HEAD | Clean |
| `staging` (origin) | `e5be6f6` | Same as dev | Clean, auto-deploys to staging |
| `main` (origin) | `13812c5` | 3+ commits behind `dev` | Does NOT include latest e2e specs, admin flows, job-posting tests |
| Production (deployed) | `fb1fdb3` (May 16) | ~100+ commits behind `main` | Running VERY old code |

### 2.2 Environment Health

| Environment | URL | Health | Code Age | Notes |
|-------------|-----|--------|----------|-------|
| **Production** | `https://rekrutai.co` | ✅ HTTP 200 | ⚠️ **Old** (`fb1fdb3`, May 16) | Missing security fixes, new features, E2E tests |
| **Staging** | `https://rekrutai-staging.onrender.com` | ✅ `{"status":"ok"}` | ✅ Current (`staging` branch) | Healthy, auto-deploys enabled |
| **Dev** | `https://rekrutai-dev.onrender.com` | ✅ `{"status":"ok"}` | ✅ Current (`dev` branch) | Healthy, auto-deploys enabled |
| **Old Render** | `https://rekrutai.onrender.com` | ❌ SUSPENDED (503) | N/A | Suspended by owner — NOT the active endpoint |

### 2.3 Production Code Gap

Production headers reveal it is running code from **before** the security hardening:

```bash
curl -I https://rekrutai.co/
```

**Current production shows:**
- `permissions-policy: camera=*, microphone=*` → Should be `camera=(self), microphone=(self)`
- `x-powered-by: Express` → Should be **absent** (`app.disable('x-powered-by')`)
- No `helmet` CSP/HSTS headers → Should be present

This confirms production is ~100+ commits behind `main` and missing critical security fixes.

### 2.4 Build Pipeline Status

| Component | File | Status | Notes |
|-----------|------|--------|-------|
| CI workflow | `.github/workflows/ci.yml` | ✅ Present | Build, audit, E2E, health check |
| Deploy workflow | `.github/workflows/deploy.yml` | ✅ Present | Manual trigger with confirmation gate |
| Render config | `render.yaml` | ✅ Fixed | `--include=dev` added to buildCommand |
| Playwright config | `playwright.config.ts` | ✅ Ready | Chromium-only, 1 worker, 60s timeout |
| Root test script | `package.json` | ✅ Fixed | `"test": "npx playwright test"` added |

### 2.5 Known Security Posture

| Issue | File | Status | Risk |
|-------|------|--------|------|
| Hardcoded JWT fallback | `lib/auth.js` | ✅ FIXED | Throws fatal error if `JWT_SECRET` unset |
| DB SSL `rejectUnauthorized` | `lib/db.js` | ✅ FIXED | `true` in prod, `false` in dev |
| Session cookie `secure` | `server.js` | ✅ FIXED | `secure: process.env.NODE_ENV === 'production'` |
| CORS `origin: true` | `server.js` | ✅ FIXED | Explicit whitelist callback |
| Missing security headers | `server.js` | ✅ FIXED | `helmet()` with CSP, HSTS, X-Frame, X-Content-Type |
| `x-powered-by` disclosure | `server.js` | ✅ FIXED | `app.disable('x-powered-by')` present |
| Permissions-Policy | `server.js` | ✅ FIXED | `camera=(self), microphone=(self)` |
| Auth rate limiting | `routes/auth.js` | ✅ FIXED | `distributedRateLimiter` + `rateLimits.strict` |
| IDOR in documents | `routes/documents.js` | ✅ FIXED | `userCompanyId` matching enforced |
| Input validation (jobs search) | `routes/jobs.js` | ⚠️ OPEN | No `express-validator` on `limit`/`offset`/`search` — DoS risk |
| CSRF protection | Multiple | ⚠️ OPEN | No `csurf` or double-submit cookie |
| Password complexity | `routes/auth.js` | ⚠️ OPEN | Only length check (8-128); no complexity rules |
| Admin `SameSite` | `server.js` | ⚠️ OPEN | Currently `lax`; should be `Strict` for admin |
| CSP `connectSrc` dev URL | `server.js` | ⚠️ OPEN | `https://rekrutai-dev.onrender.com` still in prod CSP |

> **Security note:** Issues marked ⚠️ OPEN are medium severity. They should be fixed before launch but are not hard deployment blockers if the June 19 deadline is firm. **Flag for post-launch sprint.**

---

## 3. Pre-Deployment Phase (Days 1–9)

> **DO NOT proceed to Section 4 until ALL gates in this section pass.**

---

### 3.1 Code & Branch Hygiene (Day 1 — June 9)

#### Gate 3.1.1: Commit All Uncommitted Changes

```bash
cd /root/.openclaw/workspace/Rekrut_AI_v2
git checkout dev

# Stage all tracked changes
git add client/dist/
git add client/src/pages/candidate/
git add client/src/pages/recruiter/
git add e2e/
git add playwright.config.ts
git add PROD_DEPLOYMENT_CHECKLIST.md

# Review what will be committed
git diff --cached --stat

# Expected output: dist artifacts, mobile fixes, e2e spec updates
# Commit
git commit -m "build: commit dist artifacts + mobile responsive fixes + e2e admin/profile specs

- Rebuild client dist with manualChunks (vendor/ui split)
- Mobile responsive fixes for candidate/recruiter pages
- New E2E specs: admin-critical, admin-dashboard, candidate-profile, recruiter-job-posting
- Update playwright.config.ts for stable CI execution"

# Push to origin dev
git push origin dev
```

**Owner:** BE-002 (Backend Engineer)  
**ETA:** 30 minutes  
**Blocker if skipped:** `dev` branch cannot be merged to `staging` with a dirty working tree.

---

#### Gate 3.1.2: Fix CSP `connectSrc` for Production

In `server.js`, make the CSP `connectSrc` conditional on `NODE_ENV`:

```javascript
// BEFORE (current — dev URL in production CSP)
connectSrc: ["'self'", "https://rekrutai-dev.onrender.com", ...]

// AFTER (conditional)
connectSrc: [
  "'self'",
  ...(process.env.NODE_ENV === 'development' ? ["https://rekrutai-dev.onrender.com"] : []),
  "https://rekrutai.co",
  "https://www.rekrutai.co",
  ...
]
```

Commit and push to `dev`.

**Owner:** BE-002  
**ETA:** 15 minutes

---

#### Gate 3.1.3: Promote `dev` → `staging`

```bash
# 1. Open PR: dev → staging on GitHub
#    URL: https://github.com/sumanthrangausa-06/Rekrut_AI_v2/compare/staging...dev

# 2. CI will run automatically on the PR:
#    - Build Check
#    - Security Audit (npm audit --audit-level high)
#    - E2E Tests (chromium, 1 worker)
#    - Health Check (dev environment)

# 3. Once CI passes, merge the PR
#    Render auto-deploys staging branch to https://rekrutai-staging.onrender.com
```

**Owner:** DO-001  
**ETA:** 1–2 hours (CI time)

---

#### Gate 3.1.4: Promote `staging` → `main`

```bash
# 1. Open PR: staging → main on GitHub
#    URL: https://github.com/sumanthrangausa-06/Rekrut_AI_v2/compare/main...staging
#    REQUIRE at least 1 PR review approval

# 2. CI will run automatically on the PR
#    Required checks: Build Check, Security Audit, E2E Tests

# 3. Once CI passes + approval granted, merge to main
#    NOTE: Production does NOT auto-deploy (autoDeploy: false)
```

**Owner:** DO-001 + Suga (CTO) approval  
**ETA:** 1–2 hours  
**Critical note:** This brings CI/CD workflows into `main` if they are not already there. Verify after merge.

---

#### Gate 3.1.5: Enable Branch Protection Rules

Configure in GitHub → Settings → Branches:

| Branch | Rule | Setting |
|--------|------|---------|
| `main` | Require PR before merging | ✅ Enabled |
| `main` | Require approvals | 1 minimum |
| `main` | Require status checks | `Build Check`, `Security Audit`, `E2E Tests` |
| `main` | Dismiss stale approvals | ✅ Enabled |
| `main` | Require branches to be up to date | ✅ Enabled |
| `main` | Allow force pushes | ❌ Disabled |
| `main` | Allow deletions | ❌ Disabled |
| `staging` | Require PR before merging | ✅ Enabled |
| `staging` | Require status checks | `Build Check`, `Security Audit`, `E2E Tests` |
| `staging` | Allow force pushes | ❌ Disabled |
| `dev` | Require PR before merging | ✅ Enabled |
| `dev` | Require status checks | `Build Check`, `Security Audit` |
| `dev` | Allow force pushes | ❌ Disabled |

**Owner:** DO-001  
**ETA:** 15 minutes

---

#### Gate 3.1.6: Tag Release

```bash
# After staging → main merge is complete:
git checkout main
git pull origin main

# Tag the release
git tag -a "v2.0.0-20260619" -m "Rekrut AI v2.0.0 Production Release — June 19, 2026
git push origin --tags
```

**Owner:** DO-001  
**ETA:** 5 minutes

---

### 3.2 Build Verification (Day 2 — June 10)

#### Gate 3.2.1: Clean Local Build

```bash
cd /root/.openclaw/workspace/Rekrut_AI_v2

# Clean install and build
rm -rf client/node_modules client/dist node_modules
npm ci
cd client && npm ci --include=dev && npm run build
cd ..

# Verify exit code 0
echo "Build exit code: $?"
```

**Expected:** Exit 0, no Vite/Rollup errors.  
**Owner:** DO-001  
**ETA:** 5 minutes

---

#### Gate 3.2.2: Build Artifacts Match Committed Dist

```bash
# After clean build, compare committed dist with fresh build
git diff --stat client/dist/

# Expected: Only timestamp/hash differences in filenames.
# If significant content differences exist, commit the fresh build.
```

**Owner:** DO-001  
**ETA:** 5 minutes

---

#### Gate 3.2.3: Bundle Size Check

```bash
ls -lah client/dist/assets/

# Hard limits:
# - No single chunk > 2MB
# - Ideal: index < 600KB, vendor < 200KB, ui < 150KB
```

**Current state:** Index ~1.5MB (warning), vendor 48KB, ui 75KB.  
**Action:** If index > 2MB, split further before deploy. If 1.5MB is acceptable for launch, document and optimize post-launch.  
**Owner:** FE-001 (Frontend Engineer)  
**ETA:** 15 minutes

---

#### Gate 3.2.4: TypeScript Errors

```bash
cd client && npx tsc --noEmit

# Acceptable: ≤ 3 pre-existing errors (per QA report)
# Unacceptable: New TypeScript errors introduced in this release
```

**Owner:** BE-002 / Suga  
**ETA:** 5 minutes

---

#### Gate 3.2.5: Syntax Check All Server Files

```bash
cd /root/.openclaw/workspace/Rekrut_AI_v2
node -c server.js
for f in routes/*.js; do node -c "$f"; done
for f in lib/*.js; do node -c "$f"; done

# All must return no errors
```

**Owner:** DO-001  
**ETA:** 5 minutes

---

### 3.3 Security Audit (Day 2 — June 10)

#### Gate 3.3.1: npm Audit

```bash
npm audit --audit-level high

# Must return 0 vulnerabilities at critical/high level
# If vite/rollup path traversal appears, it must be fixed (was fixed in e67505b)
```

**Owner:** DO-001  
**ETA:** 2 minutes

---

#### Gate 3.3.2: Verify Security Headers in Code

```bash
# Confirm these are present in server.js:
grep -n "helmet" server.js
grep -n "x-powered-by" server.js
grep -n "permissions-policy" server.js
grep -n "corsOrigins" server.js

# Expected:
# - helmet() configured with CSP, HSTS, X-Frame, X-Content-Type
# - app.disable('x-powered-by')
# - camera=(self), microphone=(self)
# - CORS origin whitelist callback
```

**Owner:** DO-001  
**ETA:** 5 minutes

---

#### Gate 3.3.3: Verify No Secrets in Code

```bash
# Scan for common secret patterns
grep -rni "sk_test_\|sk_live_\|api_key.*=\|password.*=\|secret.*=" --include="*.js" --include="*.ts" --include="*.json" . \
  | grep -v "node_modules" | grep -v "dist" | grep -v ".env"

# Also check for .env files that should NOT be committed:
git ls-files | grep -E "\.env|\.credentials"

# Expected: NO .env or .credentials files in git index
```

**Owner:** DO-001  
**ETA:** 5 minutes

---

### 3.4 Database Preparation (Day 5 — June 12)

#### Gate 3.4.1: Confirm Production DB Provider

**CRITICAL DECISION:** There is a discrepancy between the local `.env` and `render.yaml`:

| Source | Database | Connection String |
|--------|----------|-------------------|
| Local `.env` | Neon PostgreSQL | `ep-calm-field-aipg6g97-pooler...` |
| `render.yaml` | Render PostgreSQL | `fromDatabase: rekrutai-prod-db` |
| Production (live) | Unknown | `rekrutai.co/api/jobs` returns data |

**Action required:**
1. Log into [Render Dashboard](https://dashboard.render.com/)
2. Check `rekrutai-prod` → Environment → `DATABASE_URL`
3. If it starts with `postgresql://...neon.tech`, production uses Neon
4. If it is auto-generated by Render, production uses Render PostgreSQL

**Decision tree:**
- **If using Neon:** Remove `fromDatabase` block from `render.yaml` for prod. Set `DATABASE_URL` manually in Render dashboard.
- **If using Render PostgreSQL:** Keep `fromDatabase: rekrutai-prod-db` in `render.yaml`. Ensure `rekrutai-prod-db` service exists.

**Owner:** DO-001 + Suga  
**ETA:** 15 minutes

---

#### Gate 3.4.2: Take Production DB Snapshot

```bash
# Via Render Dashboard (no CLI option for snapshots):
# 1. Go to https://dashboard.render.com/
# 2. Navigate to PostgreSQL service (rekrutai-prod-db or Neon)
# 3. Click "Snapshots" → "Create Snapshot"
# 4. Document the snapshot ID for rollback reference
```

**Owner:** DO-001  
**ETA:** 5 minutes  
**Blocker if skipped:** No safe rollback path if migration corrupts data.

---

#### Gate 3.4.3: Verify Migration Status

```bash
# 1. List all migration files
ls -1 migrations/ | wc -l
# Expected: 52+ files (001 through 051 plus hardening scripts)

# 2. Check if any migrations are NEW since last production deploy
# Last production commit: fb1fdb3 (May 16)
# All migrations should be from May 16 or earlier
# If new migrations exist, they MUST be run before deploy

# 3. Verify migration syntax (dry-run if supported)
# node migrate.js --dry-run  # (if migrate.js supports this)
# OR manually review SQL in each migration file
```

**Owner:** DO-001 + BE-002  
**ETA:** 30 minutes

---

#### Gate 3.4.4: Verify pgvector Extension

```bash
# Run against production DB (or staging as proxy):
psql "$DATABASE_URL" -c "SELECT * FROM pg_extension WHERE extname = 'vector';"

# Expected: 1 row returned
# If missing: CREATE EXTENSION IF NOT EXISTS vector;
```

**Owner:** DO-001  
**ETA:** 5 minutes

---

#### Gate 3.4.5: Seed Data Verification

```bash
# Check if seed data exists for critical tables:
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM notification_templates;"
# Expected: > 0 rows

psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM users WHERE role = 'admin';"
# Expected: At least 1 admin user (or admin login via ADMIN_USERNAME/PASSWORD)
```

**Owner:** DO-001  
**ETA:** 10 minutes

---

### 3.5 Environment Variables & Secrets (Days 3–4 — June 11–12)

> **CRITICAL:** All `sync: false` env vars in `render.yaml` MUST be set manually in the Render Dashboard before the first production deployment. They are NOT in git and will NOT auto-populate.

#### Gate 3.5.1: Set Tier 1 — Security Secrets (BLOCKING)

| Variable | Value Requirements | How to Generate | Verified? |
|----------|-------------------|-----------------|-----------|
| `JWT_SECRET` | ≥ 32 chars, random, base64-like | `openssl rand -base64 48` | [ ] |
| `SESSION_SECRET` | ≥ 32 chars, random, base64-like | `openssl rand -base64 48` | [ ] |
| `ADMIN_USERNAME` | Strong, unique username | Manually chosen | [ ] |
| `ADMIN_PASSWORD` | ≥ 16 chars, complex | `openssl rand -base64 24` | [ ] |

**Where to set:** Render Dashboard → `rekrutai-prod` → Environment → Add Environment Variable  
**Owner:** DO-001 + Suga  
**ETA:** 15 minutes

---

#### Gate 3.5.2: Set Tier 2 — Stripe Live Keys (BLOCKING — CEO Required)

| Variable | Value Requirements | How to Obtain | Verified? |
|----------|-------------------|---------------|-----------|
| `STRIPE_SECRET_KEY` | Must start with `sk_live_` | Stripe Dashboard → Developers → API Keys | [ ] |
| `STRIPE_PUBLISHABLE_KEY` | Must start with `pk_live_` | Stripe Dashboard → Developers → API Keys | [ ] |
| `STRIPE_WEBHOOK_SECRET` | Must start with `whsec_` | Stripe Dashboard → Webhooks → Create endpoint | [ ] |

**Stripe Webhook Endpoint Configuration:**
- Endpoint URL: `https://rekrutai.co/api/billing/webhook`
- Events to listen for:
  - `checkout.session.completed`
  - `invoice.payment_failed`
  - `customer.subscription.deleted`
  - `customer.subscription.updated`
  - `invoice.payment_succeeded`

**Where to set:** Render Dashboard → `rekrutai-prod` → Environment  
**Owner:** Ranga (CEO) generates keys; DO-001 sets them in Render  
**ETA:** 1–2 days (depends on Stripe account setup)  
**Blocker if skipped:** Zero revenue capability.

---

#### Gate 3.5.3: Set Tier 3 — AI Provider Keys (BLOCKING if AI features enabled)

| Variable | Provider | How to Obtain | Verified? |
|----------|----------|---------------|-----------|
| `POLSIA_API_KEY` | Polsia AI Proxy | https://polsia.com | [ ] |
| `POLSIA_API_URL` | Polsia AI Proxy | `https://polsia.com/api/proxy/ai` | [ ] |
| `OPENAI_API_KEY` | OpenAI | https://platform.openai.com/api-keys | [ ] |
| `OPENAI_BASE_URL` | OpenAI (optional) | If using proxy | [ ] |
| `OPENAI_DAILY_TOKEN_BUDGET` | Budget control | Recommend: 100000 | [ ] |
| `NVIDIA_NIM_API_KEY` | NVIDIA NIM | https://build.nvidia.com | [ ] |
| `NIM_BASE_URL` | NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | [ ] |
| `GROQ_API_KEY` | Groq | https://console.groq.com | [ ] |
| `CEREBRAS_API_KEY` | Cerebras | https://cerebras.ai | [ ] |
| `DEEPGRAM_API_KEY` | Deepgram | https://console.deepgram.com | [ ] |

**NIM Model Configuration (15+ variables):**

| Variable | Purpose | Verified? |
|----------|---------|-----------|
| `NIM_LLM_MODEL` | Primary LLM | [ ] |
| `NIM_LLM_LLAMA_8B` | Llama 8B model ID | [ ] |
| `NIM_LLM_LLAMA_70B` | Llama 70B model ID | [ ] |
| `NIM_LLM_GEMMA` | Gemma model ID | [ ] |
| `NIM_LLM_GPT_OSS` | GPT OSS model ID | [ ] |
| `NIM_LLM_NANO_30B` | Nano 30B model ID | [ ] |
| `NIM_LLM_STEP_FLASH` | Step Flash model ID | [ ] |
| `NIM_LLM_ULTRA` | Ultra model ID | [ ] |
| `NIM_REASONING_QWQ` | Reasoning model ID | [ ] |
| `NIM_SAFETY_MODEL` | Safety model ID | [ ] |
| `NIM_SAFETY_REASONING` | Safety reasoning model ID | [ ] |
| `NIM_VISION_GEMMA` | Vision Gemma model ID | [ ] |
| `NIM_VISION_FALLBACK_MODEL` | Vision fallback model ID | [ ] |
| `NIM_EMBED_MODEL` | Embedding model ID | [ ] |
| `NIM_EMBED_VL` | Vision-language embedding model ID | [ ] |
| `NIM_DOCUMENT_MODEL` | Document model ID | [ ] |
| `NIM_ASR_MODEL` | ASR model ID | [ ] |
| `NIM_ASR_V3` | ASR v3 model ID | [ ] |
| `NIM_TTS_BASE_URL` | TTS base URL | [ ] |
| `NIM_FASTPITCH_BASE_URL` | FastPitch base URL | [ ] |
| `NIM_MAGPIE_ZERO_BASE_URL` | Magpie Zero base URL | [ ] |
| `NIM_MAGPIE_FLOW_BASE_URL` | Magpie Flow base URL | [ ] |
| `NIM_MAGPIE_MULTI_BASE_URL` | Magpie Multi base URL | [ ] |

**Owner:** Suga (CTO) provides keys; DO-001 sets them in Render  
**ETA:** 2–4 hours

---

#### Gate 3.5.4: Set Tier 4 — Cloud Storage (R2)

| Variable | Purpose | Verified? |
|----------|---------|-----------|
| `R2_ACCESS_KEY_ID` | Cloudflare R2 access key | [ ] |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 secret key | [ ] |
| `R2_BUCKET_NAME` | R2 bucket name | [ ] |
| `R2_ENDPOINT` | R2 S3-compatible endpoint | [ ] |
| `R2_PUBLIC_URL` | Public CDN URL | [ ] |

**Owner:** DO-001 + Suga  
**ETA:** 15 minutes

---

#### Gate 3.5.5: Set Tier 5 — Email / SMTP (BLOCKING if email notifications enabled)

| Variable | Typical Value | Verified? |
|----------|---------------|-----------|
| `EMAIL_HOST` / `SMTP_HOST` | `smtp.gmail.com` or `smtp.sendgrid.net` | [ ] |
| `EMAIL_PORT` / `SMTP_PORT` | `587` (TLS) or `465` (SSL) | [ ] |
| `EMAIL_USER` / `SMTP_USER` | SMTP username | [ ] |
| `EMAIL_PASS` / `SMTP_PASS` | App-specific password (NOT Gmail login) | [ ] |
| `EMAIL_FROM_ADDRESS` / `SMTP_FROM` | `noreply@rekrutai.co` | [ ] |
| `EMAIL_FROM_NAME` | `Rekrut AI` | [ ] |
| `EMAIL_RATE_LIMIT` | `100` | [ ] |
| `EMAIL_RATE_LIMIT_HOUR` | `1000` | [ ] |
| `EMAIL_RETRY_ATTEMPTS` | `3` | [ ] |
| `EMAIL_RETRY_DELAY` | `5000` | [ ] |
| `SMTP_SECURE` | `true` (production) | [ ] |

**Owner:** DO-001 + Suga  
**ETA:** 15 minutes

---

#### Gate 3.5.6: Set Tier 6 — OAuth (BLOCKING if social login enabled)

| Variable | How to Obtain | Verified? |
|----------|---------------|-----------|
| `GOOGLE_CLIENT_ID` | Google Cloud Console → OAuth 2.0 credentials | [ ] |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console → OAuth 2.0 credentials | [ ] |
| `GOOGLE_REDIRECT_URI` | `https://rekrutai.co/api/auth/google/callback` | [ ] |
| `LINKEDIN_CLIENT_ID` | LinkedIn Developer Portal | [ ] |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn Developer Portal | [ ] |
| `LINKEDIN_REDIRECT_URI` | `https://rekrutai.co/api/auth/linkedin/callback` | [ ] |

**CRITICAL:** Both redirect URIs must be registered in their respective developer portals.

**Owner:** Suga provides credentials; DO-001 sets them in Render  
**ETA:** 30 minutes

---

#### Gate 3.5.7: Verify Auto-Set Variables (No Action Needed)

These are set automatically by `render.yaml` and do NOT need manual configuration:

| Variable | Value | Source |
|----------|-------|--------|
| `NODE_ENV` | `production` | `render.yaml` |
| `PORT` | `10000` | `render.yaml` |
| `DATABASE_URL` | Auto-generated | `fromDatabase: rekrutai-prod-db` (or set manually if Neon) |
| `REKRUT_AI_URL` | `https://rekrutai.co` | `render.yaml` |
| `APP_URL` | `https://rekrutai.co` | `render.yaml` |
| `FRONTEND_URL` | `https://rekrutai.co` | `render.yaml` |
| `BASE_URL` | `https://rekrutai.co` | `render.yaml` |
| `CORS_ORIGINS` | `https://rekrutai.co,https://www.rekrutai.co` | `render.yaml` |
| `FORCE_SSL_VERIFY` | `true` | `render.yaml` |

**Verification:**
```bash
# After deployment, verify:
curl -s https://rekrutai.co/health | jq .
# Should show production is running with correct env
```

---

### 3.6 E2E Test Execution (Days 5–6 — June 12–13)

#### Gate 3.6.1: Run E2E Suite on Staging

```bash
# Run against staging (the closest proxy to production):
cd /root/.openclaw/workspace/Rekrut_AI_v2

# Option A: Run full suite locally against staging
BASE_URL=https://rekrutai-staging.onrender.com npx playwright test --project=chromium

# Option B: Run specific critical flows
BASE_URL=https://rekrutai-staging.onrender.com npx playwright test candidate-critical-flow.spec.ts
BASE_URL=https://rekrutai-staging.onrender.com npx playwright test recruiter-critical-flow.spec.ts
BASE_URL=https://rekrutai-staging.onrender.com npx playwright test auth-persistence.spec.ts
BASE_URL=https://rekrutai-staging.onrender.com npx playwright test payment-flow.spec.ts
BASE_URL=https://rekrutai-staging.onrender.com npx playwright test admin-critical-flow.spec.ts
```

**Expected results:**
- All tests pass except `dark-mode.spec.ts` (known SIGKILL/browser crash — verify manually)
- If `dark-mode.spec.ts` fails with infrastructure error (not app logic), document the exception
- Any NEW failures in other tests are blockers

**Owner:** QA-001 / Suga  
**ETA:** 2–4 hours (full suite)

---

#### Gate 3.6.2: Run E2E Suite on Current `main` Commit

```bash
# After staging → main merge, verify main also passes:
git checkout main
npm ci
cd client && npm ci --include=dev && npm run build
cd ..

# Start local server and run tests
npm start &
sleep 5
npx playwright test --project=chromium
```

**Owner:** QA-001  
**ETA:** 2–4 hours

---

#### Gate 3.6.3: Document Test Exceptions

If `dark-mode.spec.ts` fails with SIGKILL (browser crash due to memory), document:

```markdown
## Known E2E Exception — dark-mode.spec.ts
- **Status:** Infrastructure failure, NOT application bug
- **Evidence:** Browser process SIGKILL during test execution
- **Workaround:** Manually verify dark mode toggle on staging/production
- **Decision:** Does NOT block deployment if manual verification passes
- **Owner:** QA-001
```

**Owner:** QA-001  
**ETA:** 15 minutes

---

### 3.7 DNS / SSL / Domain Verification (Day 2 — June 10)

#### Gate 3.7.1: Verify DNS Records

```bash
# Check A/CNAME records
dig rekrutai.co
dig www.rekrutai.co

# Expected: Points to Render's load balancer IP or CNAME
```

**Owner:** DO-001  
**ETA:** 5 minutes

---

#### Gate 3.7.2: Verify www Redirect

```bash
curl -I https://www.rekrutai.co
# Expected: 301/302 redirect to https://rekrutai.co/

# Also verify the inverse (if rekrutai.co is canonical):
curl -I https://rekrutai.co
# Expected: 200 OK (not redirecting to www)
```

**Owner:** DO-001  
**ETA:** 5 minutes

---

#### Gate 3.7.3: Verify SSL Certificate

```bash
# Check certificate validity
curl -I https://rekrutai.co/ 2>&1 | grep -i "SSL\|certificate"
# Or use browser DevTools → Security tab

# Expected: Valid Let's Encrypt certificate, expires > 30 days from now
```

Render auto-provisions Let's Encrypt. Verification should pass automatically.

**Owner:** DO-001  
**ETA:** 5 minutes

---

#### Gate 3.7.4: Verify HTTP → HTTPS Redirect

```bash
curl -I http://rekrutai.co/
# Expected: 301/302 redirect to https://rekrutai.co/
```

**Owner:** DO-001  
**ETA:** 2 minutes

---

### 3.8 External Service Configuration (Day 4 — June 11)

#### Gate 3.8.1: Google OAuth Redirect URI

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to APIs & Services → Credentials
3. Find the Rekrut AI OAuth 2.0 client
4. Add authorized redirect URI: `https://rekrutai.co/api/auth/google/callback`
5. Remove old dev URIs if they are no longer needed (or keep them for dev testing)
6. Save

**Owner:** Suga  
**ETA:** 15 minutes

---

#### Gate 3.8.2: LinkedIn OAuth Redirect URI

1. Go to [LinkedIn Developer Portal](https://developer.linkedin.com/)
2. Find the Rekrut AI application
3. Add authorized redirect URI: `https://rekrutai.co/api/auth/linkedin/callback`
4. Save

**Owner:** Suga  
**ETA:** 15 minutes

---

#### Gate 3.8.3: Stripe Webhook Endpoint

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/)
2. Developers → Webhooks → Add endpoint
3. Endpoint URL: `https://rekrutai.co/api/billing/webhook`
4. Select events:
   - `checkout.session.completed`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
   - `customer.subscription.updated`
   - `invoice.payment_succeeded`
5. Save and copy the webhook signing secret (`whsec_...`)
6. Set `STRIPE_WEBHOOK_SECRET` in Render dashboard

**Owner:** Ranga / DO-001  
**ETA:** 15 minutes

---

### 3.9 Monitoring & Alerting Setup (Day 7 — June 15)

#### Gate 3.9.1: Set Up UptimeRobot (External Uptime Monitoring)

**Sign up:** https://uptimerobot.com/ (Free plan: 50 monitors)

Create these monitors:

| Monitor | Type | URL | Interval | Alert Contact |
|---------|------|-----|----------|---------------|
| Health API | HTTPS | `https://rekrutai.co/health` | 5 min | Email + Slack webhook |
| Homepage | HTTPS | `https://rekrutai.co/` | 5 min | Email + Slack webhook |
| Login Page | HTTPS | `https://rekrutai.co/login` | 10 min | Email |

**Expected response:** HTTP 200, body contains `"status":"ok"` (for health endpoint)

**Owner:** DO-001  
**ETA:** 30 minutes  
**Post-launch priority:** Do this before launch if possible, but can be added within 24 hours of deploy.

---

#### Gate 3.9.2: Set Up Sentry (Error Tracking)

**Sign up:** https://sentry.io/ (Free tier: 5K errors/month)

1. Create project: `rekrutai-prod`
2. Add React SDK to frontend (`client/src/main.tsx` or entry point):
   ```javascript
   import * as Sentry from '@sentry/react';
   Sentry.init({ dsn: 'YOUR_DSN', environment: 'production' });
   ```
3. Add Node.js SDK to backend (`server.js`):
   ```javascript
   const Sentry = require('@sentry/node');
   Sentry.init({ dsn: 'YOUR_DSN', environment: 'production' });
   ```
4. Set `SENTRY_DSN` in Render dashboard

**Owner:** DO-001  
**ETA:** 1 hour  
**Post-launch priority:** Can be added within 1 week of launch.

---

#### Gate 3.9.3: Log Aggregation

Render logs are ephemeral (~7 days). Options:

| Provider | Setup | Cost | Timeline |
|----------|-------|------|----------|
| Datadog | Install Datadog agent or use log forwarding | Variable | Within 2 weeks |
| Papertrail | Add Papertrail log destination in Render | ~$7/mo | Within 2 weeks |
| Splunk | Forward logs via HTTP Event Collector | Variable | Within 1 month |

**Owner:** DO-001  
**Post-launch priority:** Within 2 weeks of launch.

---

### 3.10 Performance & CDN (Day 8 — June 16)

#### Gate 3.10.1: CDN / Asset Optimization

Currently no CDN is configured for static assets. Options:

| Option | Implementation | Impact | Timeline |
|--------|---------------|--------|----------|
| Cloudflare (recommended) | Proxy `rekrutai.co` through Cloudflare | Caching, DDoS protection, SSL | Before launch |
| Render + R2 | Serve `client/dist/` from Cloudflare R2 with public URL | Faster asset delivery | Post-launch |

**Recommended action:**
1. Set Cloudflare nameservers for `rekrutai.co`
2. Configure Cloudflare caching rules for `client/dist/assets/*` (cache 1 year, immutable)
3. Enable Cloudflare Auto Minify for JS/CSS/HTML

**Owner:** DO-001  
**ETA:** 30 minutes  
**Post-launch priority:** Can be done within 48 hours of launch if DNS change is risky.

---

#### Gate 3.10.2: Lighthouse Audit

Run Chrome DevTools Lighthouse on these pages:

| Page | Performance | Accessibility | Best Practices | SEO | Notes |
|------|-------------|---------------|----------------|-----|-------|
| `/` | > 85 | > 85 | > 90 | > 90 | Homepage |
| `/login` | > 85 | > 85 | > 90 | > 90 | Auth page |
| `/candidate/jobs` | > 85 | > 85 | > 90 | > 90 | Data-driven page |
| `/recruiter/dashboard` | > 85 | > 85 | > 90 | > 90 | Dashboard |

**Owner:** FE-001 / QA-001  
**ETA:** 30 minutes

---

## 4. Deployment Day Execution (Day 10 — June 19)

> ⚠️ **DO NOT EXECUTE THIS SECTION UNTIL ALL GATES IN SECTION 3 ARE CHECKED OFF.**

### 4.1 Pre-Deploy Final Checklist (T-30 Minutes)

| # | Check | Status | Owner |
|---|-------|--------|-------|
| 4.1.1 | All Section 3 gates are ✅ PASS | [ ] | DO-001 |
| 4.1.2 | Ranga has signed Go/No-Go document | [ ] | Ranga |
| 4.1.3 | Production DB snapshot taken (Section 3.4.2) | [ ] | DO-001 |
| 4.1.4 | All `sync: false` env vars set in Render dashboard | [ ] | DO-001 |
| 4.1.5 | Stripe live keys confirmed (`sk_live_*`) | [ ] | Ranga |
| 4.1.6 | E2E tests passed on latest commit | [ ] | QA-001 |
| 4.1.7 | No uncommitted changes on `main` | [ ] | DO-001 |
| 4.1.8 | `main` branch is tagged (`v2.0.0-20260619`) | [ ] | DO-001 |
| 4.1.9 | Branch protection enabled on `main` | [ ] | DO-001 |
| 4.1.10 | Rollback plan reviewed with team | [ ] | DO-001 + Suga |
| 4.1.11 | Communication plan ready (Slack/Discord `#deployments`) | [ ] | DO-001 |
| 4.1.12 | Low-traffic deploy window chosen (recommend: 02:00–04:00 UTC / 10:00–12:00 CST) | [ ] | DO-001 |

---

### 4.2 Deploy Step-by-Step (Execute in Sequence)

#### Step 1: Final Verification (T-0)

```bash
# Verify main is clean and ready
cd /root/.openclaw/workspace/Rekrut_AI_v2
git checkout main
git pull origin main
git status
# Expected: "nothing to commit, working tree clean"

# Verify the tag exists
git describe --tags
# Expected: v2.0.0-20260619
```

---

#### Step 2: Trigger GitHub Actions Deploy Workflow (T+0)

```bash
# Go to GitHub Actions → Deploy to Production
# URL: https://github.com/sumanthrangausa-06/Rekrut_AI_v2/actions/workflows/deploy.yml

# Click "Run workflow"
# Select branch: main
# Type in confirmation field: deploy-to-prod
# Click "Run workflow"
```

**What the workflow does:**
1. Verifies confirmation text is `deploy-to-prod`
2. Verifies branch is `main`
3. Re-runs all CI checks (build, audit, E2E, health)
4. Builds the application
5. Shows instructions for manual Render deploy
6. Waits 60 seconds, then polls production health for 10 attempts (2.5 min total)

---

#### Step 3: Manual Render Deploy (T+3 Minutes)

```bash
# Since autoDeploy is false on rekrutai-prod, manually trigger:

# Option A: Render Dashboard (Recommended)
# 1. Go to https://dashboard.render.com/
# 2. Select service: rekrutai-prod
# 3. Click "Manual Deploy" → "Deploy latest commit"
# 4. Monitor build logs for errors

# Option B: Render CLI (if installed locally)
render deploy --service rekrutai-prod

# Option C: Render Deploy Hook (if RENDER_DEPLOY_HOOK_URL is configured)
# curl -X POST $RENDER_DEPLOY_HOOK_URL
```

**Build timeline estimate:**
| Phase | Duration |
|-------|----------|
| Git push → Render webhook | ~30s |
| Build phase (client + server) | ~3–5 min |
| Deploy phase + health check | ~1–2 min |
| **Total** | **~5–8 min** |

---

#### Step 4: Monitor Build Logs (T+3 to T+8 Minutes)

```bash
# Watch Render dashboard logs for:
# ✅ "Build successful"
# ✅ "Starting service..."
# ✅ "Health check passed"
# ❌ Any npm install errors
# ❌ Any Vite build errors
# ❌ Any "PORT already in use" errors
```

---

#### Step 5: Post-Deploy Health Verification (T+8 to T+10 Minutes)

```bash
# Poll health endpoint
for i in {1..10}; do
  response=$(curl -s -o /dev/null -w "%{http_code}" https://rekrutai.co/health)
  body=$(curl -s https://rekrutai.co/health)
  echo "Attempt $i: HTTP $response — $body"
  if [ "$response" = "200" ]; then
    echo "✅ Production is healthy"
    break
  fi
  sleep 15
done

# Expected: {"status":"ok","timestamp":"..."}
```

---

## 5. Post-Deployment Verification (Day 10–11)

> **Run these checks within 15 minutes of deployment. If any check fails, initiate rollback (Section 6).**

---

### 5.1 Immediate Health Checks (T+10 Minutes)

| # | Endpoint | Command | Expected Result | Status |
|---|----------|---------|-----------------|--------|
| 5.1.1 | Health API | `curl -s https://rekrutai.co/health \| jq .` | `{"status":"ok","timestamp":"..."}` | [ ] |
| 5.1.2 | API Health Alias | `curl -s https://rekrutai.co/api/health \| jq .` | `{"status":"ok",...}` or 404 | [ ] |
| 5.1.3 | Homepage | `curl -s https://rekrutai.co/ \| head -20` | HTML with `<title>Rekrut AI` | [ ] |
| 5.1.4 | Login Page | `curl -s https://rekrutai.co/login \| head -20` | HTML with login form | [ ] |
| 5.1.5 | Pricing Page | `curl -s https://rekrutai.co/pricing \| head -20` | HTML with pricing tiers | [ ] |
| 5.1.6 | About Page | `curl -s https://rekrutai.co/about \| head -20` | HTML loads | [ ] |

---

### 5.2 Security Headers Verification (T+15 Minutes)

```bash
# Check all security headers
curl -I https://rekrutai.co/
```

| Header | Expected | Status |
|--------|----------|--------|
| `content-security-policy` | Present (from helmet) | [ ] |
| `strict-transport-security` | `max-age=31536000; includeSubDomains` | [ ] |
| `x-content-type-options` | `nosniff` | [ ] |
| `x-frame-options` | `SAMEORIGIN` | [ ] |
| `x-powered-by` | **ABSENT** | [ ] |
| `permissions-policy` | `camera=(self), microphone=(self)` | [ ] |
| `referrer-policy` | Present | [ ] |

**Verification commands:**
```bash
# Verify x-powered-by is absent
curl -I https://rekrutai.co/ | grep -i "x-powered-by"
# Expected: NO OUTPUT

# Verify HTTPS redirect
curl -I http://rekrutai.co/ | grep -i "location"
# Expected: Location: https://rekrutai.co/

# Verify CORS rejection
curl -H "Origin: https://evil.com" -I https://rekrutai.co/api/jobs
# Expected: No Access-Control-Allow-Origin header (or 403)
```

---

### 5.3 Functional Smoke Tests (T+15 to T+30 Minutes)

Execute these manually in a browser or via automated E2E:

| # | Test | Steps | Expected Result | Status |
|---|------|-------|-----------------|--------|
| 5.3.1 | Homepage render | Load `/`, check hero, features, pricing, testimonials | All sections visible, no console errors | [ ] |
| 5.3.2 | Login flow | Use production test credentials | Login succeeds, redirects to dashboard | [ ] |
| 5.3.3 | Candidate jobs | Login as candidate, navigate `/candidate/jobs` | Job listings load, search/filter work | [ ] |
| 5.3.4 | Recruiter dashboard | Login as recruiter, navigate `/recruiter/dashboard` | Dashboard loads, analytics visible | [ ] |
| 5.3.5 | Recruiter candidates | Navigate `/recruiter/candidates` | Candidate search loads, SQL query works | [ ] |
| 5.3.6 | Dark mode toggle | Click dark mode toggle | Theme switches, persists on reload | [ ] |
| 5.3.7 | Mobile responsive | Emulate iPhone 14 in DevTools | Layout adapts, no horizontal scroll | [ ] |
| 5.3.8 | Stripe pricing | Load `/pricing` | Free / Pro / Enterprise tiers visible | [ ] |
| 5.3.9 | Registration | Create new test account | Account created, welcome email sent (if email configured) | [ ] |
| 5.3.10 | Admin panel | Login with admin credentials at `/admin` | Admin dashboard loads, metrics visible | [ ] |
| 5.3.11 | Social auth (Google) | Click "Sign in with Google" | OAuth flow initiates, redirects correctly | [ ] |
| 5.3.12 | Social auth (LinkedIn) | Click "Sign in with LinkedIn" | OAuth flow initiates, redirects correctly | [ ] |

**Test credentials for production smoke testing:**
- Create a dedicated smoke-test account before deploy
- Do NOT use real user accounts for automated testing

---

### 5.4 API Smoke Tests (T+30 Minutes)

```bash
# Run these curl commands against production:

# 5.4.1 Auth me (requires session cookie)
curl -s https://rekrutai.co/api/auth/me -H "Cookie: connect.sid=YOUR_SESSION_COOKIE"
# Expected: {"id":..., "email":..., "role":...}

# 5.4.2 Public jobs
curl -s https://rekrutai.co/api/jobs | head -c 200
# Expected: JSON array of job objects

# 5.4.3 Recruiter candidates (requires recruiter session)
curl -s https://rekrutai.co/api/recruiter/candidates -H "Cookie: connect.sid=RECRUITER_SESSION"
# Expected: JSON array of candidates

# 5.4.4 AI health (admin)
curl -s https://rekrutai.co/api/ai-health -H "Cookie: connect.sid=ADMIN_SESSION"
# Expected: Provider circuit breaker status

# 5.4.5 Admin metrics (admin)
curl -s https://rekrutai.co/api/admin/metrics -H "Cookie: connect.sid=ADMIN_SESSION"
# Expected: Request counts, latency, error rates
```

---

### 5.5 E2E Test Suite on Production (T+1 Hour)

```bash
# Run full E2E suite against production (with production test credentials)
BASE_URL=https://rekrutai.co npx playwright test --project=chromium

# Run individual critical flows:
BASE_URL=https://rekrutai.co npx playwright test candidate-critical-flow.spec.ts
BASE_URL=https://rekrutai.co npx playwright test recruiter-critical-flow.spec.ts
BASE_URL=https://rekrutai.co npx playwright test auth-persistence.spec.ts
BASE_URL=https://rekrutai.co npx playwright test public-pages.spec.ts

# NOTE: Skip payment-flow.spec.ts if Stripe is in test mode
# NOTE: dark-mode.spec.ts may fail with SIGKILL — verify manually if it fails
```

| Spec File | Tests | Status | Notes |
|-----------|-------|--------|-------|
| `auth-persistence.spec.ts` | 8 | [ ] | Auth, token, jobs browse, mobile, settings |
| `candidate-critical-flow.spec.ts` | ~10 | [ ] | Jobs, profile, applications |
| `recruiter-critical-flow.spec.ts` | ~10 | [ ] | Dashboard, candidates, job posting |
| `public-pages.spec.ts` | ~8 | [ ] | Login, register, pricing, blog, home |
| `navigation-flow.spec.ts` | ~6 | [ ] | Visitor, candidate, recruiter nav |
| `admin-critical-flow.spec.ts` | ~6 | [ ] | Admin login, metrics, activity logs |
| `payment-flow.spec.ts` | ~4 | [ ] | **Skip if Stripe test mode** |
| `dark-mode.spec.ts` | ~4 | [ ] | Known SIGKILL flake — verify manually |

---

### 5.6 Performance Verification (T+2 Hours)

| Test | Tool | Expected | Status |
|------|------|----------|--------|
| Page load time (/) | DevTools Network | < 1.5s full page | [ ] |
| Static asset load | DevTools Network | < 500ms for JS/CSS | [ ] |
| Lighthouse Performance | Chrome DevTools | > 85 | [ ] |
| Lighthouse Accessibility | Chrome DevTools | > 85 | [ ] |
| Lighthouse Best Practices | Chrome DevTools | > 90 | [ ] |
| Lighthouse SEO | Chrome DevTools | > 90 | [ ] |
| API response time | DevTools / curl | < 500ms for `/api/jobs` | [ ] |
| Time to First Byte (TTFB) | WebPageTest or curl | < 200ms | [ ] |

---

### 5.7 24-Hour Monitoring (Day 11 — June 20)

After deployment, monitor continuously for 24 hours:

| Check | Frequency | Tool | Action if Anomalous |
|-------|-----------|------|---------------------|
| `/health` endpoint | Every 5 min | UptimeRobot or manual curl | Alert if > 2 consecutive failures |
| Render dashboard logs | Every 30 min | Render dashboard | Look for error spikes, 5xx errors |
| Stripe webhook logs | Every 1 hour | Stripe dashboard | Check for failed webhook deliveries |
| AI provider usage | Every 6 hours | `/api/ai-health/usage` | Check for budget overruns |
| Error rate | Every 1 hour | `/api/admin/metrics` | Alert if > 1% error rate |
| Database connections | Every 6 hours | Render DB dashboard | Alert if connection pool exhausted |

---

## 6. Rollback Plan

> **If ANY critical check fails during post-deployment verification, initiate rollback immediately.**

### 6.1 Rollback Triggers

| Condition | Severity | Action | Owner | ETA |
|-----------|----------|--------|-------|-----|
| `/health` returns non-200 for > 2 minutes | 🔴 CRITICAL | Immediate Render dashboard rollback | DO-001 | 2 min |
| 50%+ of smoke tests fail | 🔴 CRITICAL | Git revert + Render dashboard rollback | DO-001 + Suga | 5 min |
| Database errors in logs | 🔴 CRITICAL | DB snapshot restore + code revert | DO-001 + BE-002 | 15 min |
| Stripe payment failures | 🔴 CRITICAL | Disable Stripe webhooks + investigate | DO-001 + Ranga | 10 min |
| AI provider circuit breakers tripped | 🟡 MEDIUM | Reset via `/api/ai-health/reset` (admin) | Suga | 5 min |
| E2E test suite fails on prod | 🟡 MEDIUM | Investigate before rolling back (may be test flake) | QA-001 | 30 min |
| Performance degradation (> 2s load time) | 🟡 MEDIUM | Evaluate if code or infra issue; rollback if code | DO-001 | 10 min |

---

### 6.2 Rollback Option A: Render Dashboard (Fastest — 2–3 Minutes)

```bash
# 1. Go to https://dashboard.render.com/
# 2. Select service: rekrutai-prod
# 3. Click "Manual Deploy" → "Deploy a specific commit"
# 4. Select the last known good commit:
#    - If reverting THIS deployment: select the commit BEFORE the deploy (pre-deploy commit)
#    - If reverting to old stable: select fb1fdb3 (May 16 production baseline)
# 5. Wait for health check to pass (~2-3 minutes)
# 6. Verify:
curl -s https://rekrutai.co/health | jq .
# Expected: {"status":"ok"}
```

**Owner:** DO-001  
**Total ETA:** 2–3 minutes

---

### 6.3 Rollback Option B: Git Revert + Redeploy (5–8 Minutes)

```bash
# 1. Revert the problematic commit on main
git checkout main
git pull origin main

# If the deploy was a merge commit:
git revert -m 1 <bad_merge_commit_sha> --no-edit

# If the deploy was a single commit:
git revert <bad_commit_sha> --no-edit

# 2. Push the revert
git push origin main

# 3. Since autoDeploy is false, manually trigger Render deploy:
#    Go to Render Dashboard → rekrutai-prod → Manual Deploy → Deploy latest commit

# 4. Verify health
curl -s https://rekrutai.co/health | jq .
```

**Owner:** DO-001  
**Total ETA:** 5–8 minutes

---

### 6.4 Rollback Option C: Database Rollback (15–30 Minutes)

**Only use if database corruption is confirmed.**

```bash
# 1. Stop the rekrutai-prod service (Render Dashboard → Stop)

# 2. Go to Render Dashboard → rekrutai-prod-db → Snapshots

# 3. Select the pre-deploy snapshot (taken in Section 3.4.2)
#    Documented snapshot ID: ________________

# 4. Click "Restore"
#    Restore time: ~10–15 minutes

# 5. Restart rekrutai-prod service

# 6. Verify health:
curl -s https://rekrutai.co/health | jq .

# 7. If code also needs rollback, use Option A or B in parallel
```

**Owner:** DO-001 + BE-002  
**Total ETA:** 15–30 minutes

---

### 6.5 Communication Plan During Rollback

| Event | Channel | Message |
|-------|---------|---------|
| Rollback initiated | `#deployments` (Slack/Discord) | `🚨 Rollback initiated — reverting to commit [X]. Reason: [Y]. ETA: 2 min. @channel` |
| Rollback complete | `#deployments` | `✅ Rollback complete. Production at [commit]. Health: OK. Investigating root cause. @here` |
| All-clear | `#deployments` | `✅ Post-rollback verification complete. Issue ticket: [link]. Normal operations resumed.` |
| Customer impact | Support channel | `⚠️ Brief service interruption resolved. No data loss. Monitoring continues.` |

---

### 6.6 Rollback Decision Tree

```
Deployment Complete
        ↓
   Health Check?
        ↓
    ┌───┴───┐
   PASS   FAIL
    ↓       ↓
  Smoke   │
  Tests?  │
    ↓     ↓
 ┌──┴──┐  │
PASS  FAIL │
 ↓     ↓   │
GO   │     │
    │     │
    └─────┘
        ↓
  Which failure?
        ↓
   ┌────┼────┬────────┐
   │    │    │        │
  Code  DB  Stripe  Config
   │    │    │        │
   ↓    ↓    ↓        ↓
Option Option Disable  Fix
  A/B   C   webhooks  env var
   │    │    │        │
   └────┴────┴────────┘
        ↓
   Verify health
        ↓
   All-clear?
```

---

## 7. Environment Variables Reference

### 7.1 Production Environment Variables (render.yaml → rekrutai-prod)

#### Tier 1 — Security (Must Be Set Before Deploy)

| Variable | Status | How to Verify | Notes |
|----------|--------|---------------|-------|
| `JWT_SECRET` | ❌ MUST SET | `openssl rand -base64 48` | ≥ 32 chars, random, never reused from dev |
| `SESSION_SECRET` | ❌ MUST SET | `openssl rand -base64 48` | ≥ 32 chars, random, never reused from dev |
| `ADMIN_USERNAME` | ❌ MUST SET | Manually chosen | Production admin login |
| `ADMIN_PASSWORD` | ❌ MUST SET | `openssl rand -base64 24` | Strong, unique |

#### Tier 2 — Payment (Must Be Set Before Deploy)

| Variable | Status | How to Verify | Notes |
|----------|--------|---------------|-------|
| `STRIPE_SECRET_KEY` | ❌ MUST SET | Must start with `sk_live_*` | Ranga (CEO) must provide |
| `STRIPE_PUBLISHABLE_KEY` | ❌ MUST SET | Must start with `pk_live_*` | Client embeds this |
| `STRIPE_WEBHOOK_SECRET` | ❌ MUST SET | Must start with `whsec_*` | Match live webhook endpoint |

#### Tier 3 — AI Providers (Must Be Set if AI features enabled)

| Variable | Status | Notes |
|----------|--------|-------|
| `POLSIA_API_KEY` | ❌ MUST SET | Primary AI proxy |
| `POLSIA_API_URL` | ✅ Set in render.yaml | `https://polsia.com/api/proxy/ai` |
| `OPENAI_API_KEY` | ❌ MUST SET | Fallback provider |
| `OPENAI_BASE_URL` | ❌ MUST SET | If using custom proxy |
| `OPENAI_DAILY_TOKEN_BUDGET` | ⚠️ RECOMMENDED | Default 100K in code; set explicitly |
| `NVIDIA_NIM_API_KEY` | ❌ MUST SET | Fallback provider |
| `NIM_BASE_URL` | ✅ Set in render.yaml | `https://integrate.api.nvidia.com/v1` |
| `GROQ_API_KEY` | ❌ MUST SET | Fast fallback |
| `CEREBRAS_API_KEY` | ❌ MUST SET | Enterprise fallback |
| `DEEPGRAM_API_KEY` | ❌ MUST SET | TTS/STT audio features |
| `NIM_*` (15+ model vars) | ❌ MUST SET | See full list in render.yaml |
| `NIM_TTS_BASE_URL` etc. | ❌ MUST SET | 5+ TTS service endpoints |

#### Tier 4 — Cloud Storage (R2)

| Variable | Status | Notes |
|----------|--------|-------|
| `R2_ACCESS_KEY_ID` | ❌ MUST SET | Cloudflare R2 |
| `R2_SECRET_ACCESS_KEY` | ❌ MUST SET | R2 secret |
| `R2_BUCKET_NAME` | ❌ MUST SET | Bucket name |
| `R2_ENDPOINT` | ❌ MUST SET | S3-compatible endpoint |
| `R2_PUBLIC_URL` | ❌ MUST SET | Public CDN URL; verify CORS allows `rekrutai.co` |

#### Tier 5 — Email/SMTP (Must Be Set if email notifications enabled)

| Variable | Status | Notes |
|----------|--------|-------|
| `EMAIL_HOST` / `SMTP_HOST` | ❌ MUST SET | Gmail, SendGrid, Mailgun, etc. |
| `EMAIL_PORT` / `SMTP_PORT` | ❌ MUST SET | 587 (TLS) or 465 (SSL) |
| `EMAIL_USER` / `SMTP_USER` | ❌ MUST SET | SMTP username |
| `EMAIL_PASS` / `SMTP_PASS` | ❌ MUST SET | App-specific password |
| `EMAIL_FROM_ADDRESS` / `SMTP_FROM` | ❌ MUST SET | `noreply@rekrutai.co` |
| `EMAIL_FROM_NAME` | ❌ MUST SET | `Rekrut AI` |
| `EMAIL_RATE_LIMIT` | ⚠️ RECOMMENDED | Prevent abuse |
| `EMAIL_RATE_LIMIT_HOUR` | ⚠️ RECOMMENDED | Prevent abuse |
| `EMAIL_RETRY_ATTEMPTS` | ⚠️ RECOMMENDED | Resilience |
| `EMAIL_RETRY_DELAY` | ⚠️ RECOMMENDED | Resilience |
| `SMTP_SECURE` | ❌ MUST SET | `true` for production |

#### Tier 6 — OAuth (Must Be Set if social login enabled)

| Variable | Status | Notes |
|----------|--------|-------|
| `GOOGLE_CLIENT_ID` | ❌ MUST SET | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | ❌ MUST SET | Rotate if previously used for dev |
| `GOOGLE_REDIRECT_URI` | ✅ Set in render.yaml | Must also be registered in Google Console |
| `LINKEDIN_CLIENT_ID` | ❌ MUST SET | LinkedIn Developer Portal |
| `LINKEDIN_CLIENT_SECRET` | ❌ MUST SET | Rotate if previously used for dev |
| `LINKEDIN_REDIRECT_URI` | ✅ Set in render.yaml | Must also be registered in LinkedIn Portal |

#### Tier 7 — Auto-Set (No Action Needed)

| Variable | Value | Source |
|----------|-------|--------|
| `NODE_ENV` | `production` | `render.yaml` |
| `PORT` | `10000` | `render.yaml` |
| `DATABASE_URL` | Auto-generated | `fromDatabase: rekrutai-prod-db` or Neon manual |
| `REKRUT_AI_URL` | `https://rekrutai.co` | `render.yaml` |
| `APP_URL` | `https://rekrutai.co` | `render.yaml` |
| `FRONTEND_URL` | `https://rekrutai.co` | `render.yaml` |
| `BASE_URL` | `https://rekrutai.co` | `render.yaml` |
| `CORS_ORIGINS` | `https://rekrutai.co,https://www.rekrutai.co` | `render.yaml` |
| `FORCE_SSL_VERIFY` | `true` | `render.yaml` |

---

### 7.2 Database Infrastructure Question

**There is a discrepancy between local `.env` and `render.yaml`:**

- Local `.env` uses **Neon PostgreSQL**: `ep-calm-field-aipg6g97-pooler.c-4.us-east-1.aws.neon.tech`
- `render.yaml` defines **Render PostgreSQL**: `fromDatabase: rekrutai-prod-db`
- Production (live) is returning data from SOME database — which one?

**Action Required:**
1. Log into Render Dashboard → `rekrutai-prod` → Environment
2. Check the value of `DATABASE_URL`
3. If it contains `neon.tech`, production uses Neon:
   - Remove `fromDatabase` block from `render.yaml` for prod
   - Set `DATABASE_URL` manually in Render dashboard
   - Ensure Neon connection string includes `sslmode=require`
4. If it is auto-generated by Render, production uses Render PostgreSQL:
   - Keep `fromDatabase: rekrutai-prod-db` in `render.yaml`
   - Ensure `rekrutai-prod-db` service exists in Render dashboard

**Owner:** DO-001 + Suga  
**ETA:** 15 minutes

---

## 8. Monitoring & Alerting Setup

### 8.1 Built-in Monitoring (Already Implemented)

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
| `GET /api/ai-health/failover-stats` | Admin | Failover statistics | ✅ Implemented |
| `GET /api/ai-health/daily-breakdown` | Admin | Daily token usage | ✅ Implemented |

### 8.2 Missing Monitoring (Must Set Up)

| # | Tool | Purpose | Cost | Timeline | Priority |
|---|------|---------|------|----------|----------|
| 8.2.1 | **UptimeRobot** | External uptime monitoring | Free (50 monitors) | **Before launch** | 🔴 HIGH |
| 8.2.2 | **Sentry** | Error tracking (React + Node) | Free (5K errors/month) | Within 1 week | 🟡 MEDIUM |
| 8.2.3 | **Log aggregation** | Forward Render logs to Datadog/Papertrail | Variable | Within 2 weeks | 🟡 MEDIUM |
| 8.2.4 | **Database monitoring** | Slow query alerts, connection pool | Neon dashboard + custom | Within 2 weeks | 🟡 MEDIUM |
| 8.2.5 | **SSL expiry monitoring** | Alert if certificate expires | Free (UptimeRobot) | Before launch | 🟢 LOW |

---

### 8.3 UptimeRobot Recommended Setup

```
Monitor 1: HTTPS → https://rekrutai.co/health
  - Interval: 5 minutes
  - Alert contact: Slack webhook + email to DO-001
  - Expected: HTTP 200, body contains "status":"ok"

Monitor 2: HTTPS → https://rekrutai.co/
  - Interval: 5 minutes
  - Alert contact: same

Monitor 3: HTTPS → https://rekrutai.co/login
  - Interval: 10 minutes
  - Alert contact: same

Monitor 4: HTTPS → https://rekrutai.co/api/jobs
  - Interval: 10 minutes
  - Alert contact: same
```

---

## 9. Go / No-Go Decision Matrix

### 9.1 Go / No-Go Gates

| # | Gate | Required Status | Owner | Verification Method |
|---|------|-----------------|-------|---------------------|
| G1 | `dev` fully merged into `main` | ✅ PASS | DO-001 | `git log main..dev --oneline` returns empty |
| G2 | No uncommitted changes on any branch | ✅ PASS | BE-002 | `git status --short` returns empty on all branches |
| G3 | CI/CD workflows in `main` | ✅ PASS | DO-001 | `.github/workflows/ci.yml` and `deploy.yml` exist in `main` |
| G4 | Branch protection enabled | ✅ PASS | DO-001 | GitHub Settings → Branches shows rules |
| G5 | Security audit passes | ✅ PASS | DO-001 | `npm audit --audit-level high` returns 0 |
| G6 | Build passes locally | ✅ PASS | DO-001 | `npm run build` exits 0 |
| G7 | Build artifacts match committed dist | ✅ PASS | DO-001 | `git diff --stat client/dist/` shows only expected changes |
| G8 | Syntax check all server files | ✅ PASS | DO-001 | `node -c server.js` and all routes pass |
| G9 | E2E tests pass on latest commit | ✅ PASS | QA-001 | `npx playwright test --project=chromium` passes |
| G10 | Production DB snapshot taken | ✅ PASS | DO-001 | Snapshot ID documented in this checklist |
| G11 | All `sync: false` env vars set in Render | ✅ PASS | DO-001 | Render dashboard shows all env vars populated |
| G12 | Stripe live keys confirmed (`sk_live_*`) | ✅ PASS | Ranga | Keys start with `sk_live_` and `pk_live_` |
| G13 | Stripe webhook endpoint created | ✅ PASS | DO-001 | Stripe Dashboard shows `https://rekrutai.co/api/billing/webhook` |
| G14 | OAuth redirect URIs updated | ✅ PASS | Suga | Google Console + LinkedIn Portal show production URLs |
| G15 | CSP `connectSrc` does not include dev URL | ✅ PASS | BE-002 | `server.js` shows conditional connectSrc |
| G16 | DNS / SSL verified | ✅ PASS | DO-001 | `dig` + `curl -I` show correct records and valid cert |
| G17 | UptimeRobot configured | 🟡 RECOMMENDED | DO-001 | Monitors active and alerting |
| G18 | Lighthouse score > 85 | 🟡 RECOMMENDED | FE-001 | DevTools Lighthouse audit passes |
| G19 | Ranga signs Go/No-Go document | ✅ PASS | Ranga | Written or verbal approval documented |

### 9.2 Decision Rules

```
IF any of G1–G16 is FAIL → NO-GO
IF G12 (Stripe live keys) is FAIL → NO-GO (revenue = zero)
IF G10 (DB snapshot) is FAIL → NO-GO (no rollback path)
IF G9 (E2E tests) is FAIL → NO-GO (risk of broken core flows)
IF G17–G18 are FAIL → CONDITIONAL GO (can launch but fix within 48h)
IF G19 (Ranga approval) is FAIL → NO-GO

IF ALL G1–G16 + G19 PASS → GO
```

### 9.3 Current Verdict (as of 2026-06-08)

🚫 **NO-GO**

**Reasons:**
1. Uncommitted changes on `dev` branch (G2)
2. `main` is 3+ commits behind `dev` (G1)
3. Stripe live keys do not exist anywhere (G12)
4. Production DB snapshot not taken (G10)
5. E2E tests not confirmed on latest commit (G9)
6. ~30+ `sync: false` env vars not set in Render dashboard (G11)
7. Ranga Go/No-Go not obtained (G19)

**ETA to Ready:** 2–4 days (complete code hygiene + E2E run + Ranga approval + secrets setup + DB snapshot)

---

## 10. Appendices

### Appendix A: Useful Commands

```bash
# ===== Git & Branch =====
git status
git log --oneline -5 main
git log --oneline -5 dev
git log --oneline -5 staging
git diff main..dev --stat
git merge-tree $(git merge-base main dev) main dev

# ===== Build =====
cd client && npm ci --include=dev && npm run build
cd .. && npm ci

# ===== Syntax Check =====
node -c server.js
for f in routes/*.js; do node -c "$f"; done
for f in lib/*.js; do node -c "$f"; done

# ===== Security Audit =====
npm audit --audit-level high

# ===== E2E Tests =====
npx playwright test --project=chromium
npx playwright test candidate-critical-flow.spec.ts
npx playwright test recruiter-critical-flow.spec.ts
npx playwright test auth-persistence.spec.ts

# ===== E2E Against Staging =====
BASE_URL=https://rekrutai-staging.onrender.com npx playwright test --project=chromium

# ===== Health Checks =====
curl -s https://rekrutai.co/health | jq .
curl -s https://rekrutai-staging.onrender.com/health | jq .
curl -s https://rekrutai-dev.onrender.com/health | jq .

# ===== Security Headers =====
curl -I https://rekrutai.co/
curl -I http://rekrutai.co/  # Should redirect to HTTPS

# ===== Database =====
psql "$DATABASE_URL" -c "SELECT NOW(), count(*) FROM users;"
psql "$DATABASE_URL" -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
psql "$DATABASE_URL" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"

# ===== Bundle Size =====
ls -lah client/dist/assets/

# ===== Lighthouse (run in Chrome DevTools) =====
# DevTools → Lighthouse → Select categories → Generate report
```

### Appendix B: Service URLs & Dashboards

| Service | URL | Purpose |
|---------|-----|---------|
| Production | `https://rekrutai.co` | Live application |
| Staging | `https://rekrutai-staging.onrender.com` | QA / pre-prod testing |
| Dev | `https://rekrutai-dev.onrender.com` | Development auto-deploy |
| Render Dashboard | `https://dashboard.render.com/` | Infrastructure management |
| GitHub Repo | `https://github.com/sumanthrangausa-06/Rekrut_AI_v2` | Code + CI/CD |
| GitHub Actions | `https://github.com/sumanthrangausa-06/Rekrut_AI_v2/actions` | CI/CD execution |
| Stripe Dashboard | `https://dashboard.stripe.com/` | Payment management |
| Google Cloud Console | `https://console.cloud.google.com/` | OAuth credentials |
| LinkedIn Developer Portal | `https://developer.linkedin.com/` | OAuth credentials |
| Neon Dashboard | `https://console.neon.tech/` | PostgreSQL (if using Neon) |

### Appendix C: Team Responsibilities

| Role | Person | Responsibilities |
|------|--------|----------------|
| DO-001 (DevOps Lead) | DevOps Automator | Infrastructure, CI/CD, Render config, env vars, monitoring, rollback |
| BE-002 (Backend Engineer) | Suga / Backend dev | Server code, API fixes, security headers, migrations, auth |
| FE-001 (Frontend Engineer) | Suga / Frontend dev | Client build, bundle optimization, responsive fixes, React migrations |
| QA-001 (QA Engineer) | Suga / QA | E2E tests, smoke tests, manual testing, test exceptions |
| Ranga (CEO) | Ranga | Stripe live keys, business Go/No-Go, revenue decisions |
| Suga (CTO) | Suga | Technical Go/No-Go, code review, architecture decisions, OAuth setup |

### Appendix D: Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-06-08 | v1.0 | DO-001 | Initial consolidated checklist synthesizing all prior documents |

---

*This checklist is a living document. Update it as blockers are resolved and new issues are discovered. All sections must be checked off before executing Section 4 (Deployment Day).*
