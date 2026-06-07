# Rekrut AI — Production Deployment Checklist

**Owner:** DO-001 (DevOps Lead) | **Last Updated:** 2026-06-08 | **Review Cadence:** Per-Deploy

---

## Purpose

Production-ready deployment checklist for Rekrut AI (HireLoop). This document standardizes the `staging` → `main` (production) promotion pipeline on Render. **Do not deploy without completing every section.**

## Pipeline Overview

```
[dev] ──→ [staging] ──→ [production/main]
   auto-deploy    merge + auto-deploy
```

| Environment | Branch | Render Service | Auto-Deploy |
|-------------|--------|----------------|-------------|
| Development | `dev` | `rekrutai-dev` | ✅ Yes |
| Staging | `staging` | `rekrutai-staging` | ✅ Yes |
| Production | `main` | `rekrutai-prod` | ✅ Yes |

---

## 1. PRE-DEPLOY CHECKS

> **Time estimate:** 10–15 minutes
> **Owner:** Deploying Engineer (DO-001 / Suga)

### 1.1 Repository State

- [ ] `git status` on `staging` is clean (no uncommitted changes)
- [ ] Latest commit on `staging` is green (CI/tests passed if applicable)
- [ ] Branch diff review: `git log main..staging --oneline` — verify no unauthorized changes
- [ ] `client/build` or build artifacts compile without errors locally

### 1.2 Database Migrations

- [ ] All migration files in `migrations/` are **idempotent** (can run multiple times safely)
- [ ] New migrations reviewed for destructive operations (ALTER, DROP, etc.)
- [ ] Production database backup completed before deploy (Neon dashboard or `pg_dump`)
- [ ] Migration dry-run: `NODE_ENV=staging node migrate.js` passes cleanly
- [ ] No migration conflicts with `migrations/` table on production

### 1.3 Environment Variables

- [ ] All required env vars are set in Render Dashboard → `rekrutai-prod` → Environment
- [ ] No hardcoded secrets in `render.yaml` (`sync: false` or `generateValue: true` for all secrets)
- [ ] Production-only vars verified:
  - [ ] `NODE_ENV=production`
  - [ ] `DATABASE_URL` (points to `rekrutai-prod-db`)
  - [ ] `FORCE_SSL_VERIFY=true`
  - [ ] `REKRUT_AI_URL=https://rekrutai.co`
  - [ ] `FRONTEND_URL=https://rekrutai.co`
  - [ ] `CORS_ORIGINS` includes `https://rekrutai.co`
  - [ ] `STRIPE_SECRET_KEY` (live mode, not test)
  - [ ] `STRIPE_WEBHOOK_SECRET` (live endpoint secret)
  - [ ] `POLSIA_API_KEY` (production key)
  - [ ] `OPENAI_API_KEY` (or other active AI provider key)
  - [ ] `SESSION_SECRET` and `JWT_SECRET` set (not `generateValue` — consistent across restarts)
  - [ ] `ADMIN_USERNAME` and `ADMIN_PASSWORD` set
  - [ ] `EMAIL_*` / `SMTP_*` credentials (production mail provider)
  - [ ] `R2_*` (Cloudflare R2 storage) — if file uploads enabled

### 1.4 SSL & Domain

- [ ] Custom domain `rekrutai.co` configured on Render production service
- [ ] SSL certificate active and not expiring within 30 days
- [ ] Cloudflare DNS (if applicable) → Render origin routing is healthy
- [ ] `www` → apex redirect configured (or vice versa per SEO strategy)

### 1.5 Dependencies & Security

- [ ] No high/critical npm audit vulnerabilities in `npm audit --production`
- [ ] `package.json` engine version matches Render Node.js runtime
- [ ] `.env` is in `.gitignore` (never commit secrets)
- [ ] No `.env` files in client bundle (check `client/dist` or `client/build`)

### 1.6 Render Configuration

- [ ] `render.yaml` is committed and pushed to `main`
- [ ] `rekrutai-prod` service has `healthCheckPath: /health`
- [ ] `rekrutai-prod` service has `autoDeploy: true` (main branch)
- [ ] `numInstances` and `plan` reviewed for expected traffic
- [ ] Database service `rekrutai-prod-db` is provisioned and connected

---

## 2. DEPLOY STEPS

> **Time estimate:** 10–15 minutes
> **Owner:** Deploying Engineer (DO-001) | **Approver:** Ranga (CEO)

### 2.1 Merge `staging` → `main`

- [ ] Create PR: `staging` → `main`
- [ ] PR Title: `Deploy: [YYYYMMDD] — [brief description]`
- [ ] PR Body includes:
  - What's deploying (feature/fix list)
  - `git log main..staging --oneline`
  - Staging validation checklist (pass/fail)
  - Previous production commit hash
  - Rollback plan
- [ ] Ranga (CEO) approves the PR

### 2.2 Render Auto-Deploy

- [ ] Merge PR to `main` via GitHub (merge commit preferred for deploys)
- [ ] Render auto-deploy triggers for `rekrutai-prod`
- [ ] Monitor Render Dashboard build logs
- [ ] Verify build step: `npm install` + client `vite build` + server start
- [ ] Watch for Node.js version mismatch or memory limit errors

### 2.3 Deployment Health Gate

- [ ] Render service shows "Live" (green checkmark)
- [ ] Health check passes: `GET https://rekrutai.co/health` → `200 OK`
- [ ] Health check response body: `{"status":"ok","timestamp":"..."}`

---

## 3. POST-DEPLOY CHECKS

> **Time estimate:** 15–25 minutes
> **Owner:** Sunny (QA) + DO-001

### 3.1 Smoke Tests

- [ ] Homepage loads: `https://rekrutai.co` → 200, no console errors
- [ ] Login page loads: `https://rekrutai.co/login`
- [ ] Test Recruiter login: `test_recruiter@rekrutai.co` / `Test123!`
- [ ] Test Candidate login: `test_candidate@rekrutai.co` / `Test123!`
- [ ] Test Admin login: `admin@rekrutai.co` / `Test123!`
- [ ] Dashboard renders after login (no blank page / no 500 errors)
- [ ] Core navigation: Jobs, Interviews, Candidates, Settings

### 3.2 API Health

- [ ] `GET /health` → 200 OK
- [ ] `GET /api/health` → 200 OK
- [ ] `GET /api/ai-health` → 200 (AI provider status visible)
- [ ] `GET /api/admin/metrics` → 200 (admin panel data)
- [ ] No 5xx errors in first 10 minutes of traffic

### 3.3 AI Provider Integration

- [ ] Mock Interview → start session → AI responds within 10 seconds
- [ ] Quick Practice → AI feedback generated
- [ ] OmniScore calculation works
- [ ] AI Health Dashboard shows providers as "up"
- [ ] Fallback AI provider works if primary is down (circuit breaker)

### 3.4 Stripe & Payments

- [ ] Pricing page loads
- [ ] Stripe checkout session initiates
- [ ] Test payment with Stripe test card (or verify webhook logs)
- [ ] Stripe webhook endpoint: `POST /api/billing/webhook` → 200
- [ ] Verify `STRIPE_WEBHOOK_SECRET` is configured (live mode)
- [ ] Subscription status updated correctly in database

### 3.5 Email Delivery

- [ ] Password reset email sends (check SMTP provider logs)
- [ ] Notification email delivers (if applicable)
- [ ] Email rate limiting not triggered
- [ ] No SMTP authentication errors in Render logs

### 3.6 Database

- [ ] Migration logs show no errors in Render application logs
- [ ] `_migrations` table updated with new migration entries
- [ ] No connection pool exhaustion errors (`max: 25` in `lib/db.js`)
- [ ] Neon dashboard shows healthy connection count

### 3.7 Static Assets & File Uploads

- [ ] Client assets (JS/CSS) load with correct MIME types
- [ ] Cloudflare R2 uploads work (if applicable)
- [ ] Document upload in onboarding flows
- [ ] Resume/CV parsing (PDF/DOCX) functional

### 3.8 Security Headers

- [ ] `X-Frame-Options` = `DENY` (or as configured)
- [ ] `Strict-Transport-Security` present (HSTS)
- [ ] `Content-Security-Policy` loaded (helmet.js)
- [ ] `x-powered-by` header absent (Express disabled)

### 3.9 Performance

- [ ] Page load time < 3s for dashboard
- [ ] API response time < 500ms for health endpoints
- [ ] No memory leaks in Render metrics (stable RAM over 5 min)

---

## 4. ROLLBACK PLAN

> **Owner:** DO-001 (Suga) | **Decision Authority:** Ranga (CEO)
> **Target:** < 5 minutes to restore last known good state

### 4.1 Identify Last Known Good Commit

```bash
# Get last 5 commits on main
git log main --oneline -5

# Tag the bad deploy (for later analysis)
git tag -a deploy-bad-$(date +%Y%m%d-%H%M) [bad-commit]
```

### 4.2 Rollback Options

#### Option A — Fast Revert (Recommended if no DB changes)

```bash
# Revert the merge commit
git revert -m 1 [merge-commit-hash]
git push origin main
```

- Render auto-deploys the revert
- **Time:** ~3–5 minutes
- **Risk:** Low
- **When:** Code bug, no new migrations

#### Option B — Hard Reset (If revert is messy)

```bash
# Reset to last known good commit
git reset --hard [last-good-commit]
git push origin main --force-with-lease
```

- **Time:** ~2–3 minutes
- **Risk:** Medium (rewrite history)
- **When:** Multiple bad commits, revert conflicts

#### Option C — Database Rollback (If migrations ran)

- Check Neon dashboard for backups
- Restore from backup if data was corrupted
- Or create a reverse migration and run it
- **Time:** 10–30 minutes (depends on backup size)
- **Risk:** High (data loss if not careful)
- **When:** Migrations caused data corruption

### 4.3 Post-Rollback Verification

- [ ] `https://rekrutai.co/health` → 200 OK
- [ ] Smoke tests pass (login, dashboard, core pages)
- [ ] No database errors in logs
- [ ] Notify team in group chat with:
  - Rollback reason
  - Bad commit hash
  - Restored commit hash
  - Time to restore

---

## 5. WHAT'S CONFIGURED

### Render Services (`render.yaml`)

| Service | Branch | Auto-Deploy | Health Check | Plan |
|---------|--------|-------------|--------------|------|
| `rekrutai-prod` | `main` | ✅ Yes | `/health` | standard |
| `rekrutai-staging` | `staging` | ✅ Yes | `/health` | starter |
| `rekrutai-dev` | `dev` | ✅ Yes | `/health` | starter |

### Database Services

| Service | Branch | Plan | Status |
|---------|--------|------|--------|
| `rekrutai-prod-db` | `main` | standard | ✅ Provisioned |
| `rekrutai-staging-db` | `staging` | starter | ✅ Provisioned |
| `rekrutai-dev-db` | `dev` | starter | ✅ Provisioned |

### Health Check Endpoints

- `GET /health` → `{ status: "ok", timestamp: "..." }`
- `GET /api/health` → Same as above (alias)
- Used by Render for service health checks

### Application Environment

- **Node.js:** v18+ (check `package.json` engines)
- **Build:** `cd client && npm install && npm run build && cd .. && npm install`
- **Start:** `npm start` (runs `node server.js`)
- **Port:** `10000` (Render standard)
- **SSL:** Enforced in production (`FORCE_SSL_VERIFY=true`)
- **Pool:** `max: 25` PostgreSQL connections

---

## 6. KNOWN GAPS & RANGA'S APPROVAL REQUIRED

### 6.1 Missing Env Vars (Action Required)

The following environment variables are used by the application but **must be verified in Render Dashboard** before production deploy:

- `STRIPE_WEBHOOK_SECRET` — Required for Stripe webhook signature verification
- `OPENAI_API_KEY` / `NVIDIA_NIM_API_KEY` / `GROQ_API_KEY` / `CEREBRAS_API_KEY` — At least one AI provider key is required
- `DEEPGRAM_API_KEY` — Required for TTS/STT audio features
- `EMAIL_FROM_ADDRESS` / `EMAIL_FROM_NAME` — Sender identity for transactional emails
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` — OAuth login
- `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` / `LINKEDIN_REDIRECT_URI` — OAuth login
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — Admin panel access
- `JWT_SECRET` / `SESSION_SECRET` — Must be set manually (not auto-generated) for consistent sessions across restarts

### 6.2 Stripe Live Mode

- [ ] **RANGA APPROVAL REQUIRED:** Confirm `STRIPE_SECRET_KEY` is **live** key (not `sk_test_...`)
- [ ] Update Stripe webhook URL in Stripe Dashboard to `https://rekrutai.co/api/billing/webhook`
- [ ] Verify `STRIPE_WEBHOOK_SECRET` is the live endpoint secret

### 6.3 Domain & DNS

- [ ] **RANGA APPROVAL REQUIRED:** Confirm `rekrutai.co` DNS points to Render production service
- [ ] Cloudflare proxy settings (orange cloud) reviewed
- [ ] `www` redirect configured

### 6.4 Plan Upgrade

- [ ] **RANGA APPROVAL REQUIRED:** `rekrutai-prod` is on `standard` plan in `render.yaml`. Verify budget and scale.

### 6.5 Monitoring & Alerts

- [ ] **RANGA APPROVAL REQUIRED:** Set up external uptime monitoring (e.g., UptimeRobot, Pingdom) on `https://rekrutai.co/health`
- [ ] Sentry/Rollbar integration for error tracking
- [ ] Render alerting configured for build failures

### 6.6 Backups

- [ ] **RANGA APPROVAL REQUIRED:** Neon automated backup schedule confirmed
- [ ] Manual backup policy before each deploy documented

---

## 7. EMERGENCY CONTACTS

| Role | Person | When to Contact |
|------|--------|----------------|
| Decision Authority | Ranga (CEO) | Any P0 issue requiring rollback |
| Technical Execution | Suga (CTO) | Build failures, deployment issues |
| QA Verification | Sunny (QA) | Post-deploy smoke test failures |
| Coordination | Kimi (COO) | Team notifications, incident comms |

---

## 8. CHANGE LOG

| Date | Author | Change |
|------|--------|--------|
| 2026-06-08 | DO-001 | Created checklist from `DEPLOYMENTS.md` + `deployment-runbook.md` |
| 2026-06-08 | DO-001 | Updated `render.yaml` — added `healthCheckPath`, `autoDeploy: true`, missing env vars, fixed `POLSIA_BASE_URL` → `POLSIA_API_URL` |

---

**Deploy safe. Verify twice. Rollback fast.**
