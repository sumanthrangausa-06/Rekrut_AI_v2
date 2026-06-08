# Rekrut AI v2 — Production Deployment Readiness Report

> **Prepared by:** DevOps Automator (subagent)  
> **Date:** 2026-06-09 02:23 CST  
> **Target Deployment:** June 19, 2026 (10 days remaining)  
> **Current Status:** 🟡 PARTIALLY READY — Active blockers require resolution before Go/No-Go  
> **Primary Deploy Target:** Render (`rekrutai-prod`) → `https://rekrutai.co`  
> **Production Branch:** `main` (diverged from `dev`)

---

## 1. Executive Summary

Production deployment preparation is **in progress**. The staging environment (`rekrutai-dev` and `rekrutai-staging`) is healthy and responding correctly. However, **critical blockers** remain that must be resolved before any production deployment can proceed safely.

The main blockers are:
1. **Branch divergence:** `main` and `dev` have diverged (13 commits each way). `main` must be reconciled with `dev` to include critical fixes (migration automation, EU AI Act compliance, E2E improvements).
2. **Uncommitted changes on `dev`:** 3 modified files (sidebar.tsx, auth-persistence.spec.ts, server.js) need to be committed or discarded before merge.
3. **Production secrets not set:** All `sync: false` environment variables in Render dashboard are empty.
4. **Database migration path unclear:** `main` branch `render.yaml` may lack `npm run migrate` in `startCommand`.
5. **No external uptime monitoring** configured for production.

**Estimated time to resolve all blockers:** 4–6 hours of focused work (spread across 2–3 days).

---

## 2. Environment Health Verification

### 2.1 Staging Environment Status

| Environment | Service Name | URL | Health Check | Status |
|-------------|-------------|-----|--------------|--------|
| **Development** | `rekrutai-dev` | `https://rekrutai-dev.onrender.com` | `{"status":"ok","timestamp":"2026-06-08T18:24:29.649Z"}` | ✅ **HEALTHY** |
| **Staging** | `rekrutai-staging` | `https://rekrutai-staging.onrender.com` | `{"status":"ok","timestamp":"2026-06-08T18:24:50.139Z"}` | ✅ **HEALTHY** |
| **Production** | `rekrutai-prod` | `https://rekrutai.co` | Not checked (older code running) | ⚠️ **UNKNOWN** |

### 2.2 Build & Security Verification (Latest `dev` Branch)

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| Client build | `npm run build --prefix client` | Exit 0, 1 chunk ~1.57MB | ✅ PASS |
| Root audit | `npm audit --audit-level moderate` | 0 vulnerabilities | ✅ PASS |
| Client audit | `npm audit` (client/) | 0 vulnerabilities | ✅ PASS |
| Server syntax | `node -c server.js` | No errors | ✅ PASS |
| Routes syntax | `for f in routes/*.js; do node -c "$f"; done` | All valid | ✅ PASS |
| Staging health | `curl https://rekrutai-dev.onrender.com/health` | `{"status":"ok"}` | ✅ PASS |

### 2.3 Branch State (as of 2026-06-09 02:23)

```
dev:     1701099 (latest) — EU AI Act compliance, E2E fixes, mobile fixes
main:    c3d46f0 — older baseline, missing migration automation + CI/CD workflows
staging: 88e53f6 — caught up with main (0 commits ahead)
```

| Metric | Value | Status |
|--------|-------|--------|
| `dev` ahead of `main` | 13 commits | 🔴 **BLOCKER** |
| `main` ahead of `dev` | 12 commits | 🔴 **BLOCKER** |
| `staging` ahead of `main` | 0 commits | ✅ In sync |
| Uncommitted changes on `dev` | 3 files (sidebar.tsx, auth-persistence.spec.ts, server.js) | ⚠️ **WARNING** |
| CI/CD workflows in `dev` | ✅ ci.yml + deploy.yml present | ✅ PASS |
| CI/CD workflows in `main` | ❌ Unknown (may be missing) | 🔴 **BLOCKER** |

---

## 3. Production Deployment Plan

### 3.1 Services to Create on Render

The `render.yaml` blueprint defines the following production infrastructure. All services are already defined in the blueprint but must be verified/created in the Render dashboard:

| Service | Type | Name | Plan | Status |
|---------|------|------|------|--------|
| Web Service | Node.js | `rekrutai-prod` | `standard` | ⚠️ Must verify exists |
| PostgreSQL | `pserv` | `rekrutai-prod-db` | `standard` | ⚠️ Must verify exists |

**Action:** Log into [Render Dashboard](https://dashboard.render.com/) and confirm both services exist. If not, use "Blueprint" → `render.yaml` to create them.

### 3.2 Environment Variables Required for Production

The `render.yaml` defines 60+ environment variables. These fall into tiers:

#### Tier 1 — Security (BLOCKING — must be set before deploy)

| Variable | Status | Action Required |
|----------|--------|---------------|
| `JWT_SECRET` | ❌ NOT SET | Generate 256-bit random string (≥32 chars). **Never reuse dev value.** |
| `SESSION_SECRET` | ❌ NOT SET | Generate 256-bit random string. **Never reuse dev value.** |
| `ADMIN_USERNAME` | ❌ NOT SET | Set production admin username |
| `ADMIN_PASSWORD` | ❌ NOT SET | Set strong production admin password |

#### Tier 2 — Payment (BLOCKING if paid features enabled)

| Variable | Status | Action Required |
|----------|--------|---------------|
| `STRIPE_SECRET_KEY` | ❌ NOT SET | Must be `sk_live_*`. **CEO approval required.** Replace test keys. |
| `STRIPE_WEBHOOK_SECRET` | ❌ NOT SET | Create webhook endpoint `https://rekrutai.co/api/billing/webhook` in Stripe dashboard first. |
| `STRIPE_PUBLISHABLE_KEY` (client) | ❌ NOT SET | Must be `pk_live_*`. Embedded in client build. |

#### Tier 3 — AI Providers (BLOCKING if AI features enabled)

| Variable | Status | Action Required |
|----------|--------|---------------|
| `POLSIA_API_KEY` | ❌ NOT SET | Primary AI proxy key |
| `OPENAI_API_KEY` | ❌ NOT SET | Fallback provider. Verify quota/billing limit. |
| `NVIDIA_NIM_API_KEY` | ❌ NOT SET | Fallback provider |
| `GROQ_API_KEY` | ❌ NOT SET | Fast fallback |
| `CEREBRAS_API_KEY` | ❌ NOT SET | Enterprise fallback |
| `DEEPGRAM_API_KEY` | ❌ NOT SET | TTS/STT audio features |
| `NIM_*` model vars (15+) | ❌ NOT SET | All model configuration variables from `render.yaml` |
| `NIM_TTS_BASE_URL` etc. | ❌ NOT SET | 5 TTS service endpoints |

#### Tier 4 — Cloud Storage (R2)

| Variable | Status | Action Required |
|----------|--------|---------------|
| `R2_ACCESS_KEY_ID` | ❌ NOT SET | Cloudflare R2 credentials |
| `R2_SECRET_ACCESS_KEY` | ❌ NOT SET | R2 secret |
| `R2_BUCKET_NAME` | ❌ NOT SET | Bucket name |
| `R2_ENDPOINT` | ❌ NOT SET | S3-compatible endpoint |
| `R2_PUBLIC_URL` | ❌ NOT SET | Public CDN URL. Verify CORS allows `rekrutai.co`. |

#### Tier 5 — Email/SMTP (BLOCKING if email notifications enabled)

| Variable | Status | Action Required |
|----------|--------|---------------|
| `EMAIL_HOST` / `SMTP_HOST` | ❌ NOT SET | Gmail, SendGrid, Mailgun, etc. |
| `EMAIL_PORT` / `SMTP_PORT` | ❌ NOT SET | Typically 587 (TLS) or 465 (SSL) |
| `EMAIL_USER` / `SMTP_USER` | ❌ NOT SET | SMTP username |
| `EMAIL_PASS` / `SMTP_PASS` | ❌ NOT SET | App-specific password |
| `EMAIL_FROM_ADDRESS` / `SMTP_FROM` | ❌ NOT SET | `noreply@rekrutai.co` |
| `EMAIL_FROM_NAME` | ❌ NOT SET | "Rekrut AI" |
| `EMAIL_RATE_LIMIT` / `EMAIL_RATE_LIMIT_HOUR` | ❌ NOT SET | Prevent abuse |
| `EMAIL_RETRY_ATTEMPTS` / `EMAIL_RETRY_DELAY` | ❌ NOT SET | Resilience |
| `SMTP_SECURE` | ❌ NOT SET | `true` for production (TLS) |

#### Tier 6 — OAuth (BLOCKING if social login enabled)

| Variable | Status | Action Required |
|----------|--------|---------------|
| `GOOGLE_CLIENT_ID` | ❌ NOT SET | Google Cloud Console → OAuth 2.0 credentials |
| `GOOGLE_CLIENT_SECRET` | ❌ NOT SET | Rotate if previously used for dev |
| `GOOGLE_REDIRECT_URI` | ✅ Set in `render.yaml` | **Must also be registered in Google Cloud Console:** `https://rekrutai.co/api/auth/google/callback` |
| `LINKEDIN_CLIENT_ID` | ❌ NOT SET | LinkedIn Developer Portal |
| `LINKEDIN_CLIENT_SECRET` | ❌ NOT SET | Rotate if previously used for dev |
| `LINKEDIN_REDIRECT_URI` | ✅ Set in `render.yaml` | **Must also be registered in LinkedIn Developer Portal:** `https://rekrutai.co/api/auth/linkedin/callback` |

#### Tier 7 — Render-Auto-Set (No action needed)

| Variable | Production Value | Status |
|----------|-----------------|--------|
| `NODE_ENV` | `production` | ✅ |
| `PORT` | `10000` | ✅ |
| `DATABASE_URL` | Auto-wired from `rekrutai-prod-db` | ✅ |
| `REKRUT_AI_URL` | `https://rekrutai.co` | ✅ |
| `APP_URL` | `https://rekrutai.co` | ✅ |
| `FRONTEND_URL` | `https://rekrutai.co` | ✅ |
| `BASE_URL` | `https://rekrutai.co` | ✅ |
| `CORS_ORIGINS` | `https://rekrutai.co,https://www.rekrutai.co` | ✅ |
| `FORCE_SSL_VERIFY` | `true` | ✅ |

> ⚠️ **DATABASE INFRASTRUCTURE DECISION REQUIRED:** The current `.env` uses **Neon PostgreSQL**, but `render.yaml` defines `rekrutai-prod-db` as a **Render PostgreSQL** service. If production uses Neon instead of Render's DB, the `DATABASE_URL` in `render.yaml` will be incorrect. **Action:** Confirm production DB provider and either (a) keep Render PostgreSQL (update `render.yaml` if needed), or (b) set `DATABASE_URL` manually in Render dashboard pointing to Neon, and remove the `fromDatabase` block.

### 3.3 Database Migration Plan (Neon PostgreSQL / Render PostgreSQL)

#### Pre-Migration

| # | Step | Owner | Status |
|---|------|-------|--------|
| 1 | **Take production DB snapshot** | DO-001 | ⬜ TODO |
| 2 | Confirm production DB connection (`psql "$DATABASE_URL" -c "SELECT NOW();"`) | DO-001 | ⬜ TODO |
| 3 | List pending migrations (compare `_migrations` table vs `/migrations/` folder) | DO-001 | ⬜ TODO |
| 4 | Verify migration syntax (`node migrate.js --dry-run` if supported) | BE-002 | ⬜ TODO |
| 5 | Verify `pgvector` extension (`CREATE EXTENSION IF NOT EXISTS vector;`) | DO-001 | ⬜ TODO |

#### Migration Execution

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

#### Post-Migration Verification

| # | Check | Expected Result | Status |
|---|-------|-----------------|--------|
| 1 | Core tables exist | `users`, `jobs`, `interviews`, `interview_questions`, `agent_data` | ⬜ TODO |
| 2 | Feature tables exist | `omniscore`, `trustscore`, `payroll`, `compliance`, `onboarding`, `matching`, etc. | ⬜ TODO |
| 3 | Seed data loaded | `notification_templates` > 0 rows | ⬜ TODO |
| 4 | Foreign key constraints | `company_id` references valid | ⬜ TODO |
| 5 | Session table | `user_sessions` auto-created by `connect-pg-simple` | ⬜ TODO |

### 3.4 Domain / SSL Setup

| # | Step | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 1 | **Custom domain DNS configured** | ⬜ TODO | DO-001 | `rekrutai.co` A/ALIAS record must point to Render's load balancer. |
| 2 | `www` redirect configured | ⬜ TODO | DO-001 | Ensure `www.rekrutai.co` → `rekrutai.co` (or vice versa, consistent). |
| 3 | Render SSL auto-provisioning | ✅ Automatic | — | Render provisions Let's Encrypt automatically once DNS resolves. |
| 4 | Verify SSL after deploy | ⬜ TODO | DO-001 | Valid certificate, no warnings. |
| 5 | HTTP → HTTPS redirect | ⬜ TODO | DO-001 | Must return 301/302 to HTTPS. |
| 6 | HSTS header present | ⬜ TODO | DO-001 | `Strict-Transport-Security` header present (helmet configured with `maxAge: 31536000`). |

### 3.5 External Service Configuration

| Service | Action Required | Status |
|---------|-----------------|--------|
| Google OAuth | Add `https://rekrutai.co/api/auth/google/callback` to authorized redirect URIs | ❌ MUST DO |
| LinkedIn OAuth | Add `https://rekrutai.co/api/auth/linkedin/callback` to authorized redirect URIs | ❌ MUST DO |
| Stripe Webhooks | Create endpoint `https://rekrutai.co/api/billing/webhook` with events: `checkout.session.completed`, `invoice.payment_failed`, `customer.subscription.deleted`, etc. | ❌ MUST DO |
| Stripe Checkout URLs | Update success/cancel URLs in Stripe checkout creation code to `https://rekrutai.co/...` | ❌ MUST DO |

---

## 4. Critical Blockers & Missing Pieces

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

## 5. Staging → Production Promotion Path

### 5.1 Current Pipeline Architecture

```
feature/* → dev (auto-deploy: ✅) → staging (auto-deploy: ✅) → main (auto-deploy: ❌) → Render manual deploy
```

### 5.2 Required Promotion Steps

| # | Step | Details | Owner | ETA |
|---|------|---------|-------|-----|
| 1 | **Commit uncommitted changes on `dev`** | `git add` + `git commit` the 3 modified files, or discard if not needed | BE-002 | June 9 |
| 2 | **Merge `dev` → `staging`** | Open PR, run CI (build, audit, E2E), merge | DO-001 | June 10 |
| 3 | **Staging smoke tests** | Run E2E against `https://rekrutai-staging.onrender.com` | QA-001 | June 10 |
| 4 | **Merge `staging` → `main`** | Open PR, require 1 approval, run CI, merge | DO-001 + Suga | June 10 |
| 5 | **Tag release** | `git tag -a v2.0.0-20260619` on merged `main` | DO-001 | June 10 |
| 6 | **Set production secrets in Render** | Populate all `sync: false` env vars in dashboard | DO-001 + Suga | June 10–11 |
| 7 | **Configure Stripe live mode** | CEO approval, live keys, webhook endpoint | Ranga (CEO) | June 11 |
| 8 | **Update OAuth redirect URIs** | Google Cloud Console + LinkedIn Developer Portal | Suga | June 11 |
| 9 | **Take production DB snapshot** | Render dashboard → `rekrutai-prod-db` → Snapshots | DO-001 | June 12 |
| 10 | **Run production DB migrations** | `node migrate.js` via Render shell or local | DO-001 + BE-002 | June 12 |
| 11 | **Manual deploy via Render dashboard** | `rekrutai-prod` → Manual Deploy → Latest commit | DO-001 | June 12–19 |
| 12 | **Post-deploy verification** | Health checks, smoke tests, security headers | DO-001 + QA-001 | June 12–19 |
| 13 | **Set up UptimeRobot** | External uptime monitoring for `https://rekrutai.co/health` | DO-001 | June 12–13 |

---

## 6. Rollback Plan

### 6.1 Fast Rollback (Render Dashboard) — 1–3 minutes

1. Go to [Render Dashboard](https://dashboard.render.com/) → `rekrutai-prod`
2. Click **"Manual Deploy"** → **"Deploy a specific commit"**
3. Select the last known good commit (document before deploy)
4. Wait for health check to pass (~2–3 minutes)
5. Verify: `curl https://rekrutai.co/health` → `{"status":"ok"}`

### 6.2 Git Revert + Redeploy — 3–5 minutes

```bash
git checkout main
git revert -m 1 <bad_merge_commit> --no-edit
git push origin main
# Render auto-deploys if enabled; otherwise manual deploy via dashboard
```

### 6.3 Database Rollback (if migration caused corruption) — 15–30 minutes

1. Render Dashboard → `rekrutai-prod-db` → **Snapshots**
2. Select snapshot from before deployment
3. Click **Restore**
4. Restore time: ~15–30 minutes

### 6.4 Rollback Triggers

| Condition | Action | Owner | ETA |
|-----------|--------|-------|-----|
| `/health` returns non-200 for > 2 minutes | Immediate Render dashboard rollback | DO-001 | 1–3 min |
| 50%+ of smoke tests fail | Git revert + investigate | DO-001 + Suga | 3–5 min |
| Database errors in logs | DB snapshot restore + code revert | DO-001 + BE-002 | 15–30 min |
| Stripe payment failures | Disable Stripe webhooks + investigate | DO-001 + Ranga | 5–10 min |
| AI provider circuit breakers tripped | Reset via `/api/ai-health/reset` (admin) | Suga | 2–5 min |

---

## 7. Recommended Next Steps (Prioritized)

### Immediate (Today — June 9)

1. ✅ **Staging health verified** — `rekrutai-dev` and `rekrutai-staging` are healthy.
2. 🔴 **Resolve B2:** Commit or discard the 3 uncommitted files on `dev`:
   ```bash
   git checkout dev
   git status  # Review sidebar.tsx, auth-persistence.spec.ts, server.js
   git add -A  # OR selectively stage
   git commit -m "chore: pre-deploy cleanup"
   git push origin dev
   ```
3. 🔴 **Resolve B6:** Decide production database provider (Render PostgreSQL vs Neon). Update `render.yaml` or dashboard accordingly.
4. 🔴 **Resolve B1:** Begin merge of `dev` → `main`. Because branches are diverged, this requires careful conflict resolution:
   ```bash
   git checkout main
   git merge dev
   # Resolve any conflicts (likely in server.js, render.yaml, e2e files)
   git push origin main
   ```

### Day 2 (June 10)

5. 🔴 **Resolve B9:** Enable GitHub branch protection on `main`, `staging`, `dev`:
   - `main`: Require PR, 1 approval, status checks (Build Check, Security Audit, E2E Tests), no force pushes
   - `staging`: Require PR, status checks, no force pushes
   - `dev`: Require PR, status checks (Build Check, Security Audit), no force pushes
6. 🔴 **Resolve B3:** Set all `sync: false` production secrets in Render dashboard. This is the longest task — allocate 2–3 hours.
7. 🟡 **Resolve B7:** Fix CSP `connectSrc` to remove dev URL from production config (make conditional on `NODE_ENV`).
8. 🟡 **Resolve B10:** Set up UptimeRobot (free tier) monitoring `https://rekrutai.co/health`.

### Day 3–4 (June 11–12)

9. 🔴 **Resolve B4:** CEO (Ranga) approves Stripe live mode, provides `sk_live_*` and `pk_live_*` keys, creates webhook endpoint.
10. 🟡 **Resolve B8:** Update Google Cloud Console and LinkedIn Developer Portal with production redirect URIs.
11. 🔴 **Resolve B5:** Take production DB snapshot, run migrations, verify schema.

### Day 5–10 (June 13–19)

12. Execute manual production deploy via Render dashboard.
13. Run post-deploy smoke tests (Section 6 of checklist).
14. Monitor logs and health for 24–48 hours.
15. Set up Sentry and log aggregation (post-launch).

---

## 8. Go / No-Go Verdict

### 🚫 CURRENT VERDICT: **NO-GO**

**Primary reasons:**

1. **B1 — Branch divergence:** `main` and `dev` have diverged. Critical fixes (migration automation, EU AI Act compliance, CI/CD workflows) are not on `main`.
2. **B2 — Uncommitted changes:** 3 modified files on `dev` must be resolved before merge.
3. **B3 — Production secrets not set:** All `sync: false` env vars in Render dashboard are empty. Without these, the app will fail to start or function.
4. **B4 — Stripe live mode pending:** CEO approval required for live payment processing.
5. **B5 — Database migrations not verified:** Production DB schema state is unknown. Migrations must be run and verified.

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

**Recommendation:** Begin the branch merge and secret configuration immediately. With 10 days remaining, the timeline is achievable but requires daily attention.

---

## 9. Appendix: Useful Commands

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

*This report is a living document. Update it as blockers are resolved and new issues are discovered.*
