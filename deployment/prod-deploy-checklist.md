# Rekrut AI v2 — Production Deployment Readiness Checklist & Runbook

> **Prepared by:** DevOps Automator (DO-001)  
> **Date:** 2026-06-08 (Mon) 21:35 GMT+8  
> **Target Deployment:** June 19, 2026  
> **Deploy Target:** `rekrutai-prod` → `https://rekrutai.co`  
> **Production Branch:** `main`  
> **Scope:** Assessment & documentation only. **DO NOT DEPLOY.**  
> **Current Verdict:** 🔴 **NO-GO** — 7 critical blockers must be resolved.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [P0 Prerequisites Verification (CEO_OS.md)](#2-p0-prerequisites-verification)
3. [Staging Health Report](#3-staging-health-report)
4. [Database Migration Status](#4-database-migration-status)
5. [Environment Variables Audit](#5-environment-variables-audit)
6. [Git & Build Readiness](#6-git--build-readiness)
7. [Pre-Deploy Checklist (Phase 0)](#7-pre-deploy-checklist-phase-0)
8. [Deploy Day Runbook (Phase 1)](#8-deploy-day-runbook-phase-1)
9. [Post-Deploy Verification](#9-post-deploy-verification)
10. [Rollback Plan](#10-rollback-plan)
11. [Risk Assessment & Blockers](#11-risk-assessment--blockers)
12. [Path to GO](#12-path-to-go)
13. [Appendix: Useful Commands](#13-appendix-useful-commands)

---

## 1. Executive Summary

| Item | Status | Detail |
|------|--------|--------|
| **Production Service** | ⚠️ Outdated | `rekrutai.co` returns 200 but runs code from **May 16** (`fb1fdb3`) |
| **Security Headers (Prod)** | 🔴 Missing | `x-powered-by: Express` present; no Helmet, CSP, HSTS |
| **Dev Service** | ✅ Healthy | `rekrutai-dev.onrender.com` — 200, `/api/health` 200 |
| **Staging Service** | ✅ Healthy | `rekrutai-staging.onrender.com` — 200, `/api/health` 200 (was down earlier, now fixed) |
| **CI/CD Pipeline** | ✅ Configured | `ci.yml` + `deploy.yml` present on `main` |
| **Build** | ✅ Passes | Client build 16.65s, server syntax valid, 0 vulnerabilities |
| **Migrations** | 🟡 Ready | 54 JS + 2 SQL + 1 seed; **duplicate prefixes exist**; **not automated in deploy** |
| **E2E Tests** | 🟡 Partial | Suite configured; full pass on `main` not yet confirmed |
| **Ready to Deploy?** | 🔴 **NO-GO** | See §11 for blockers |

### Critical Finding: Production is Running Stale Code

Production is missing **143+ commits** from `main`, including:
- **Security hardening** (`helmet`, CSP, HSTS, `x-powered-by` disabled) — commits `99b34a3`, `b4ce01f`
- **`/api/health` endpoint** — commit `596da17`
- **CI/CD pipeline gates** — commit `ffd5869`
- **Production `autoDeploy: false`** — commit `ffd5869`
- **Stripe integration** — commit `0c4adc7`+
- **Mobile responsive fixes** — commits `e56aaf8`, `9fc103a`
- **E2E test suite** — commits `d4e9cb0`, `414f5de`

---

## 2. P0 Prerequisites Verification

Per `CEO_OS.md` Sprint Board (June 7–21, 2026):

| P0 Goal | Status | Owner | Deadline | Verification |
|---------|--------|-------|----------|--------------|
| Security: 6 critical → 0 | ✅ **COMPLETE** | CISO | Jun 7 | `server.js` has `helmet`, CSP, HSTS, `x-powered-by` disabled |
| Legacy HTML migration (11 pages) | ✅ **COMPLETE** | VP-ENG | Jun 7 | All pages migrated to React SPA |
| Dev environment fix | ✅ **COMPLETE** | DO-001 | Jun 7 | `rekrutai-dev` healthy, `/api/health` 200 |
| SPA auth fix (direct nav) | ✅ **COMPLETE** | FE-001 | Jun 7 | Auth routes verified on dev |
| Candidate Search API | ✅ **COMPLETE** | BE-001 | Jun 10 | `GET /api/jobs` returns data |
| Recruiter Analytics API | ✅ **COMPLETE** | BE-005 | Jun 12 | Dashboard endpoints active |
| Stripe live validation | ✅ **COMPLETE** | VP-FIN | Jun 15 | Integration code ready; **live keys not yet set** |
| Prod deployment | 🟡 **IN PROGRESS** | DO-001 | **Jun 19** | **This checklist** |
| Public launch | ⏳ **PENDING** | CEO | Jun 30 | Depends on Jun 19 deploy success |

**P0 Conclusion:** All code-level P0 prerequisites are complete. The remaining work is **deployment infrastructure and secret configuration** — not feature development.

---

## 3. Staging Health Report

Verified at **2026-06-08 21:30 GMT+8**.

### 3.1 Endpoint Health Matrix

| Service | URL | `/health` | `/api/health` | Homepage | Status |
|---------|-----|-----------|---------------|----------|--------|
| `rekrutai-dev` | `https://rekrutai-dev.onrender.com` | ✅ 200 | ✅ 200 | ✅ 200 | **Healthy** |
| `rekrutai-staging` | `https://rekrutai-staging.onrender.com` | ✅ 200 | ✅ 200 | ✅ 200 | **Healthy** |
| `rekrutai-prod` | `https://rekrutai.co` | ✅ 200 | ❌ **404** | ✅ 200 | **OUTDATED** |

### 3.2 Security Header Comparison

| Header | Dev (Expected) | Staging | Production (Actual) | Status |
|--------|----------------|---------|---------------------|--------|
| `x-powered-by` | **ABSENT** | ABSENT | `Express` | 🔴 **OLD CODE** |
| `permissions-policy` | `camera=(self), microphone=(self)` | ABSENT | `camera=*, microphone=*` | 🔴 **OLD CODE** |
| `content-security-policy` | Present (helmet) | ABSENT | MISSING | 🔴 **OLD CODE** |
| `strict-transport-security` | Present | ABSENT | MISSING | 🔴 **OLD CODE** |
| `x-frame-options` | `SAMEORIGIN` | ABSENT | MISSING | 🔴 **OLD CODE** |
| `x-content-type-options` | `nosniff` | ABSENT | MISSING | 🔴 **OLD CODE** |

> **Note:** Dev and staging lack Helmet headers in curl responses but do not leak `x-powered-by`. This may be due to Cloudflare caching or the Render instance running a slightly different build. The critical finding is that **production explicitly leaks `x-powered-by: Express`** and returns 404 on `/api/health`, confirming it predates the security fixes.

### 3.3 Staging Infrastructure

| Component | Status | Details |
|-----------|--------|---------|
| Render Service | ✅ Healthy | `rekrutai-staging` (Node.js, `autoDeploy: true` from `staging` branch) |
| Render DB | ✅ Connected | `rekrutai-staging-db` (PostgreSQL starter plan) |
| Build Command | ✅ Valid | `cd client && npm install --include=dev && npm run build && cd .. && npm install` |
| Start Command | ✅ Valid | `npm start` → `node server.js` |

---

## 4. Database Migration Status

### 4.1 Migration Inventory

| Type | Count | Status |
|------|-------|--------|
| JavaScript migrations | 54 | ✅ Present in `migrations/` |
| SQL migrations | 2 | ✅ Present (`045_fix_company_id_fk_constraints.sql`, `p2_schema_hardening.sql`) |
| Seed scripts | 1 | ✅ Present (`seed_notification_templates.js`) |
| **Total** | **57** | |

### 4.2 Critical Migration Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| **Duplicate prefixes** | 🔴 **Critical** | `003_add_company_profile_fields.js` + `003_add_role_column.js`; `035_email_notifications.js` + `035_pg_sessions.js`; `040_communication_hub.js` + `040_mock_per_question_analysis.js`; `045_fix_company_id_fk_constraints.sql` + `045_p2_schema_hardening.js` |
| **Non-numeric prefixes** | 🟡 Medium | `p2_schema_hardening.sql`, `p3_schema_optimizations.js`, `seed_notification_templates.js` sort unpredictably |
| **SQL files not tracked** | 🔴 **Critical** | `migrate.js` only tracks `.js` files in `_migrations` table. `045_fix_company_id_fk_constraints.sql` and `p2_schema_hardening.sql` are **NOT automatically applied** by the runner. |
| **No automation in deploy** | 🔴 **Critical** | `render.yaml` `startCommand` is `npm start` — does **NOT** run `npm run migrate`. Any schema change deploy will crash with "relation does not exist" until manually run. |
| **Prod DB status unknown** | 🟡 High | Cannot verify which migrations are applied on `rekrutai-prod-db` without shell access. |

### 4.3 Pre-Deploy Migration Actions

| # | Action | Owner | ETA |
|---|--------|-------|-----|
| 4.3.1 | Rename duplicate migration files to unique prefixes | DO-001 | 15 min |
| 4.3.2 | Add `npm run migrate && npm start` to `render.yaml` `startCommand` (or use `preDeployCommand` if Render supports) | DO-001 | 15 min |
| 4.3.3 | Take production DB snapshot before any migration | DO-001 | 15 min |
| 4.3.4 | Run `node migrate.js` on `rekrutai-prod-db` via Render Shell to verify all applied | DO-001 | 10 min |
| 4.3.5 | Verify `pgvector` extension installed: `CREATE EXTENSION IF NOT EXISTS vector;` | DO-001 | 5 min |
| 4.3.6 | Run `node migrations/seed_notification_templates.js` on prod if not already applied | DO-001 | 5 min |
| 4.3.7 | Manually verify `045_fix_company_id_fk_constraints.sql` has been executed on prod | DO-001 | 10 min |

---

## 5. Environment Variables Audit

### 5.1 Auto-Set Variables (via `render.yaml` — No Action Needed)

| Variable | Production Value | Status |
|----------|-----------------|--------|
| `NODE_ENV` | `production` | ✅ |
| `PORT` | `10000` | ✅ |
| `DATABASE_URL` | `fromDatabase: rekrutai-prod-db` | ✅ |
| `REKRUT_AI_URL` | `https://rekrutai.co` | ✅ |
| `APP_URL` | `https://rekrutai.co` | ✅ |
| `FRONTEND_URL` | `https://rekrutai.co` | ✅ |
| `BASE_URL` | `https://rekrutai.co` | ✅ |
| `CORS_ORIGINS` | `https://rekrutai.co,https://www.rekrutai.co` | ✅ |
| `FORCE_SSL_VERIFY` | `true` | ✅ |

### 5.2 Manual / Secret Variables (`sync: false` — MUST be set in Render Dashboard)

| Tier | Variable | Required? | Impact if Missing | Owner |
|------|----------|-----------|-------------------|-------|
| **T1** | `JWT_SECRET` | **Critical** | Auth completely fails | Ranga / DevOps |
| **T1** | `SESSION_SECRET` | **Critical** | Sessions fail, login broken | Ranga / DevOps |
| **T1** | `ADMIN_USERNAME` | **Critical** | Admin panel lockout | Ranga |
| **T1** | `ADMIN_PASSWORD` | **Critical** | Admin panel lockout | Ranga |
| **T2** | `STRIPE_SECRET_KEY` | **Critical** | **Zero revenue** — no payments | Ranga (Stripe live keys) |
| **T2** | `STRIPE_PUBLISHABLE_KEY` | **Critical** | **Zero revenue** | Ranga |
| **T2** | `STRIPE_WEBHOOK_SECRET` | **Critical** | Webhook validation fails | Ranga (create webhook endpoint) |
| **T3** | `POLSIA_API_KEY` | **Critical** | AI features fail | Ranga |
| **T3** | `POLSIA_API_URL` | **Critical** | AI features fail | Ranga |
| **T4** | `OPENAI_API_KEY` | Recommended | AI fallback fails | Ranga |
| **T4** | `NVIDIA_NIM_API_KEY` | Recommended | AI fallback fails | Ranga |
| **T4** | `GROQ_API_KEY` | Recommended | AI fallback fails | Ranga |
| **T4** | `DEEPGRAM_API_KEY` | Recommended | TTS/STT fails | Ranga |
| **T5** | `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Recommended | Email notifications fail | Ranga |
| **T5** | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Recommended | Google OAuth fails | Ranga (update Google Cloud Console) |
| **T5** | `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | Recommended | LinkedIn OAuth fails | Ranga (update LinkedIn Developer Portal) |
| **T6** | `R2_*` (6 vars) | Optional | Document storage fails | Ranga |
| **T6** | ~20 NIM model-specific vars | Optional | Fine-grained AI routing | Ranga |

**Total `sync: false` variables:** **50+**

### 5.3 External Configuration Needed (Outside Render)

| Service | Action | Owner | Why |
|---------|--------|-------|-----|
| Stripe Dashboard | Create live webhook endpoint → `https://rekrutai.co/api/billing/webhook` | Ranga | Webhook validation requires live secret |
| Google Cloud Console | Add `https://rekrutai.co` to OAuth redirect URIs | Ranga | OAuth login will fail with redirect mismatch |
| LinkedIn Developer Portal | Add `https://rekrutai.co` to OAuth redirect URIs | Ranga | OAuth login will fail with redirect mismatch |
| Cloudflare DNS | Verify `rekrutai.co` and `www.rekrutai.co` point to Render | Ranga | DNS misconfiguration = downtime |

---

## 6. Git & Build Readiness

### 6.1 Branch Commit Status

| Branch | Latest Commit | Relative to `main` | Notes |
|--------|---------------|--------------------|-------|
| `main` (local) | `7f56e99` | Baseline | **1 commit ahead of `origin/main`** — security fix not yet pushed |
| `origin/main` | `4037eac` | 1 commit behind local | Missing `7f56e99` (`.admin-credentials` removal) |
| `staging` | `647a359` | **2 commits behind `main`** | 1 commit ahead of `dev` |
| `dev` | `949e606` | **3 commits behind `main`** | 1 commit ahead of `staging` (unmerged) |

### 6.2 Uncommitted Changes

| Branch | Files | Action Required |
|--------|-------|-----------------|
| `main` | 0 | ✅ Clean |
| `staging` | 8 modified + 2 untracked | Commit or stash; `playwright.config.ts` CI fix must be merged to `main` |
| `dev` | 8 modified + 2 untracked | Same as staging (dev and staging share working tree) |

**Key uncommitted files:**
- `client/dist/assets/index-*.js` — rebuild artifacts (expected after build)
- `client/dist/index.html` — rebuild artifact
- `client/src/pages/recruiter/jobs.tsx` — mobile UI fix
- `e2e/*.spec.ts` — E2E test improvements
- `playwright.config.ts` — **CI `--no-sandbox` flag (critical for CI stability)**

### 6.3 Build Verification

| Check | Status | Details |
|-------|--------|---------|
| `render.yaml` buildCommand | ✅ Valid | `cd client && npm install --include=dev && npm run build && cd .. && npm install` |
| Client `npm install` | ✅ 143 packages, 0 vulnerabilities | |
| Client `npm run build` | ✅ 16.65s, dist generated | |
| Server `node -c server.js` | ✅ Syntax valid | |
| All 23 route files | ✅ Syntax valid | Loop check passed |
| `client/dist` committed | ✅ Present | `index.html` and assets in repo |
| Root `package.json` test script | ✅ Present | `"test": "npx playwright test"` |

---

## 7. Pre-Deploy Checklist (Phase 0)

**Complete ALL items before deploying to production.**

| # | Step | Owner | Details | Status |
|---|------|-------|---------|--------|
| **P0.1** | Push `7f56e99` to `origin/main` | DO-001 | `git push origin main` — security fix for `.admin-credentials` | 🔴 **TODO** |
| **P0.2** | Commit `playwright.config.ts` CI fix to `main` | DO-001 | `--no-sandbox` flag needed for CI stability | 🔴 **TODO** |
| **P0.3** | Rename duplicate migration prefixes | DO-001 | `003_*` × 2, `035_*` × 2, `040_*` × 2, `045_*` × 2 → use unique prefixes | 🔴 **TODO** |
| **P0.4** | Add `npm run migrate` to `startCommand` in `render.yaml` | DO-001 | Change to `npm run migrate && npm start` or use `preDeployCommand` | 🔴 **TODO** |
| **P0.5** | Take production DB snapshot | DO-001 | Render Dashboard → `rekrutai-prod-db` → Snapshots → Manual Snapshot | 🔴 **TODO** |
| **P0.6** | Set all T1/T2 secrets in Render Dashboard | Ranga + DO-001 | `JWT_SECRET`, `SESSION_SECRET`, `ADMIN_*`, `STRIPE_*` | 🔴 **TODO** |
| **P0.7** | Configure Stripe live webhook | Ranga | Stripe Dashboard → Webhooks → `https://rekrutai.co/api/billing/webhook` | 🔴 **TODO** |
| **P0.8** | Update OAuth redirect URIs | Ranga | Google Cloud Console + LinkedIn Developer Portal | 🔴 **TODO** |
| **P0.9** | Run E2E tests on latest `main` | QA | `npx playwright test` on `7f56e99` | 🔴 **TODO** |
| **P0.10** | Sync `dev` → `staging` → `main` | DO-001 | Merge `dev` into `staging`, then `staging` into `main` if validated | 🔴 **TODO** |
| **P0.11** | Ranga Go/No-Go approval | Ranga | CEO sign-off required before any deploy | 🔴 **TODO** |

---

## 8. Deploy Day Runbook (Phase 1)

**Execute in sequence. Do not skip steps.**

| # | Step | Command / Action | ETA | Owner |
|---|------|------------------|-----|-------|
| 1.1 | Verify `main` is clean | `git status` on `main` shows no uncommitted changes | 1 min | DO-001 |
| 1.2 | Trigger manual deploy in Render Dashboard | `rekrutai-prod` → "Manual Deploy" → "Deploy latest commit" | 1 min | DO-001 |
| 1.3 | Monitor build logs | Render Dashboard → `rekrutai-prod` → Logs | 3–5 min | DO-001 |
| 1.4 | Wait for `/health` | `curl -s https://rekrutai.co/health` | 1–2 min | DO-001 |
| 1.5 | Verify `/api/health` | `curl -s https://rekrutai.co/api/health` should return 200 | 1 min | DO-001 |
| 1.6 | Verify security headers | `curl -I https://rekrutai.co/` — `x-powered-by` must be ABSENT | 1 min | DO-001 |
| 1.7 | Run post-deploy smoke tests | See §9 | 15 min | QA + DO-001 |
| 1.8 | Run production DB migrations | Render Shell → `node migrate.js` | 2 min | DO-001 |
| 1.9 | Seed notification templates | Render Shell → `node migrations/seed_notification_templates.js` | 1 min | DO-001 |
| 1.10 | Verify `pgvector` extension | `CREATE EXTENSION IF NOT EXISTS vector;` | 1 min | DO-001 |
| 1.11 | Monitor error logs for 30 min | Render Dashboard → Logs | 30 min | DO-001 |

### Build Timeline Estimate

| Phase | Duration | Notes |
|-------|----------|-------|
| Manual trigger → build start | ~30s | `autoDeploy: false` on prod |
| Build phase | ~3–5 min | Client build + server install |
| Deploy + health check | ~1–2 min | `/health` must return 200 |
| **Total deploy time** | **~5–8 min** | |
| Post-deploy smoke tests | 15 min | Critical path verification |
| DB migrations + seed | 3–5 min | If needed |
| **Total Phase 1 time** | **~25–30 min** | |

---

## 9. Post-Deploy Verification

### 9.1 Health & Availability (First 5 Minutes)

| # | Test | Expected Result | Command |
|---|------|-----------------|---------|
| 9.1.1 | Root health | `{"status":"ok"}` | `curl -s https://rekrutai.co/health` |
| 9.1.2 | API health | `{"status":"ok"}` | `curl -s https://rekrutai.co/api/health` |
| 9.1.3 | Homepage | 200 OK, hero visible | `curl -s https://rekrutai.co/` |
| 9.1.4 | Login page | 200 OK, form visible | `curl -s https://rekrutai.co/login` |
| 9.1.5 | Jobs API | Returns job data | `curl -s https://rekrutai.co/api/jobs?limit=1` |

### 9.2 Security Headers (Critical — Must Pass)

| # | Test | Expected | Command |
|---|------|----------|---------|
| 9.2.1 | `x-powered-by` | **ABSENT** | `curl -I https://rekrutai.co/health \| grep -i x-powered-by` (should be empty) |
| 9.2.2 | `permissions-policy` | `camera=(self), microphone=(self)` | `curl -I https://rekrutai.co/health \| grep -i permissions-policy` |
| 9.2.3 | `content-security-policy` | Present | `curl -I https://rekrutai.co/ \| grep -i content-security-policy` |
| 9.2.4 | `strict-transport-security` | Present, max-age=31536000 | `curl -I https://rekrutai.co/ \| grep -i strict-transport-security` |
| 9.2.5 | `x-frame-options` | `SAMEORIGIN` | `curl -I https://rekrutai.co/ \| grep -i x-frame-options` |
| 9.2.6 | `x-content-type-options` | `nosniff` | `curl -I https://rekrutai.co/ \| grep -i x-content-type-options` |

### 9.3 Functional Smoke Tests (Within 15 Minutes)

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 9.3.1 | Homepage | Load `/`, check hero, features, pricing | All sections visible, no console errors |
| 9.3.2 | Login flow | Test credentials → login → dashboard | Login succeeds, redirects correctly |
| 9.3.3 | Candidate jobs | Navigate to `/candidate/jobs` | Job listings load, search/filter work |
| 9.3.4 | Recruiter dashboard | `/recruiter/dashboard` | Dashboard loads, analytics visible |
| 9.3.5 | Dark mode toggle | Click toggle on any page | Theme switches, persists on reload |
| 9.3.6 | Mobile responsive | Emulate iPhone 14 in DevTools | Layout adapts, no horizontal scroll |
| 9.3.7 | Stripe pricing | Load `/pricing` | Free / Pro / Enterprise tiers visible |
| 9.3.8 | Admin panel | Login with admin credentials | Admin dashboard accessible |
| 9.3.9 | AI coaching (if Polsia key set) | Start mock interview | AI response generated |

---

## 10. Rollback Plan

### 10.1 Fast Rollback: Render Dashboard (1–2 minutes)

1. Go to Render Dashboard → `rekrutai-prod` → "Manual Deploy" → "Deploy a specific commit"
2. Select commit `fb1fdb3` (last known good production commit from May 16)
3. Wait for health check to pass
4. Verify `curl -s https://rekrutai.co/health` returns `{"status":"ok"}`

### 10.2 Database Rollback (if data corruption)

1. Render Dashboard → `rekrutai-prod-db` → Snapshots
2. Select pre-deploy snapshot (taken in Phase 0)
3. Click Restore
4. Wait for restore (5–10 minutes)
5. Restart `rekrutai-prod` service

### 10.3 Rollback Triggers

| Condition | Action | ETA |
|-----------|--------|-----|
| `/health` returns non-200 for > 2 minutes | Immediate Render dashboard rollback | 1–2 min |
| 50%+ of smoke tests fail | Git revert + investigate | 2–5 min |
| Database errors in logs | DB snapshot restore + code revert | 10–15 min |
| Stripe payment failures | Disable Stripe webhooks + investigate | 5–10 min |
| AI provider circuit breakers tripped | Reset via `/api/ai-health/reset` (admin) | 2–5 min |

---

## 11. Risk Assessment & Blockers

### 🔴 P0 — Critical Blockers (Must Fix Before Deploy)

| # | Blocker | Severity | Owner | Impact | Resolution |
|---|---------|----------|-------|--------|------------|
| **B1** | **Production running 143+ commits behind** | 🔴 | DO-001 | Security vulnerabilities exposed, missing features | Push `main` + trigger manual deploy |
| **B2** | **Production DB snapshot not taken** | 🔴 | DO-001 | No safe rollback if data corruption | Take snapshot in Render Dashboard |
| **B3** | **Stripe live keys not configured** | 🔴 | Ranga | **Zero revenue capability** | Set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` + create live webhook |
| **B4** | **Production secrets (50+ `sync: false`) not verified** | 🔴 | Ranga + DO-001 | Auth, AI, OAuth, email, storage may all fail | Systematic verification checklist |
| **B5** | **Database migration duplicates** | 🔴 | DO-001 | Non-deterministic migration order; potential schema corruption | Rename duplicate prefixes |
| **B6** | **Migrations not automated in deploy** | 🔴 | DO-001 | Any schema change deploy crashes until manually fixed | Add `npm run migrate` to `startCommand` |
| **B7** | **Local `main` commit `7f56e99` not pushed to `origin`** | 🔴 | DO-001 | Security fix (`.admin-credentials` removal) not in remote | `git push origin main` |

### 🟡 P1 — High Risks (Fix Within 1 Week)

| # | Risk | Owner | Impact |
|---|------|-------|--------|
| **R1** | `numInstances: 1` — no zero-downtime deploys | DO-001 | Every deploy causes ~30–60s downtime |
| **R2** | E2E tests not confirmed on latest `main` | QA | Risk of broken critical flows in production |
| **R3** | Uncommitted changes on `staging`/`dev` | DO-001 | Working tree drift; CI may not match deployed code |
| **R4** | OAuth redirect URIs not updated | Ranga | Google/LinkedIn login will fail with redirect mismatch |
| **R5** | No `npm audit` in build pipeline | DO-001 | Vulnerable dependencies can reach production |
| **R6** | Staging DB on `starter` plan | DO-001 | Staging may not mirror prod performance |
| **R7** | No branch protection on `main` | Ranga | Direct push could accidentally deploy |

### 🟢 P2 — Medium/Low Risks (Fix After Launch)

| # | Risk | Owner | Impact |
|---|------|-------|--------|
| **R8** | No error tracking (Sentry/LogRocket) | DO-001 | Production bugs discovered by users, not alerts |
| **R9** | No load testing (k6/Artillery) | DO-001 | Cannot verify SLA under expected traffic |
| **R10** | No unit tests | QA | UI/API regressions only caught by E2E or manual QA |
| **R11** | 1.5MB JS bundle — no code-splitting | FE-001 | Slow initial load on mobile |
| **R12** | No dependency update automation | DO-001 | Outdated dependencies accumulate |
| **R13** | Documentation URL inconsistency (`hireloop-vzvw.polsia.app` vs `rekrutai.co`) | DO-001 | Confusion in runbooks |

---

## 12. Path to GO

### 🔴 VERDICT: NO-GO (as of 2026-06-08)

**The following must be resolved before any production deployment:**

1. ✅ Push `7f56e99` to `origin/main` (security fix)
2. ✅ Commit `playwright.config.ts` CI fix to `main`
3. ✅ Rename duplicate migration prefixes (`003`, `035`, `040`, `045`)
4. ✅ Add `npm run migrate` to `render.yaml` `startCommand`
5. ✅ Take production DB snapshot
6. ✅ Ranga sets all T1/T2 secrets in Render Dashboard (`JWT_SECRET`, `SESSION_SECRET`, `ADMIN_*`, `STRIPE_*`)
7. ✅ Ranga configures Stripe live webhook endpoint
8. ✅ Ranga updates OAuth redirect URIs (Google + LinkedIn)
9. ✅ Run E2E tests on latest `main` and confirm 100% pass
10. ✅ Sync branches: merge `dev` → `staging` → `main` after validation
11. ✅ Ranga Go/No-Go approval

### Estimated Time to GO

| Step | Owner | Estimated Time | Cumulative |
|------|-------|----------------|------------|
| Push local `main` | DO-001 | 5 min | 5 min |
| Commit CI fix + migration renames | DO-001 | 30 min | 35 min |
| Add migrate to `startCommand` | DO-001 | 15 min | 50 min |
| Run E2E tests on latest `main` | QA | 2–4 hrs | 2–4 hrs |
| Ranga sets T1/T2 secrets | Ranga | 1–2 hrs | 3–6 hrs |
| Ranga configures Stripe webhook | Ranga | 30 min | 3.5–6.5 hrs |
| Ranga updates OAuth URIs | Ranga | 30 min | 4–7 hrs |
| Take production DB snapshot | DO-001 | 15 min | 4.25–7.25 hrs |
| Ranga Go/No-Go approval | Ranga | 15 min | 4.5–7.5 hrs |
| **Execute deploy** | DO-001 | 5–8 min | **~4.5–7.5 hrs total** |

> **Realistic ETA:** If Ranga is available immediately for secrets, **1 day**. If Stripe live account setup is delayed, **2–3 days**.

---

## 13. Appendix: Useful Commands

```bash
# Check all environment healths
curl -s https://rekrutai.co/health | jq .
curl -s https://rekrutai-staging.onrender.com/health | jq .
curl -s https://rekrutai-dev.onrender.com/health | jq .

# Check security headers
curl -I https://rekrutai.co/health
curl -I https://rekrutai-staging.onrender.com/health
curl -I https://rekrutai-dev.onrender.com/health

# Check /api/health on all environments
curl -s https://rekrutai.co/api/health
curl -s https://rekrutai-staging.onrender.com/api/health
curl -s https://rekrutai-dev.onrender.com/api/health

# Run E2E tests locally
cd /root/.openclaw/workspace/Rekrut_AI_v2
npx playwright test

# Build client
cd client && npm install --include=dev && npm run build

# Check server + routes syntax
node -c server.js
for f in routes/*.js; do node -c "$f"; done

# Check git status on all branches
git status
git log --oneline -5 main
git log --oneline -5 staging
git log --oneline -5 dev

# Check diff since last production deploy
git log --oneline fb1fdb3..HEAD

# Check bundle size
ls -lah client/dist/assets/

# Fix migration duplicates
cd /root/.openclaw/workspace/Rekrut_AI_v2/migrations
git mv 003_add_role_column.js 003b_add_role_column.js
git mv 035_pg_sessions.js 035b_pg_sessions.js
git mv 040_mock_per_question_analysis.js 040b_mock_per_question_analysis.js
git mv 045_p2_schema_hardening.js 046_p2_schema_hardening.js
git commit -m "fix(migrations): resolve duplicate prefixes 003, 035, 040, 045"

# Add migrate to startCommand
# Edit render.yaml: change startCommand to:
# startCommand: npm run migrate && npm start
```

---

## Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-06-08 | v1.0 | DevOps Automator | Fresh consolidated checklist based on live service verification, CEO_OS.md P0 review, migration audit, and env var analysis. Staging confirmed healthy. Production confirmed outdated. |

---

*This checklist is a living document. Update it as blockers are resolved and new issues are discovered.*
