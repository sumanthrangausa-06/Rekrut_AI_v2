# Rekrut AI — Production Deployment Checklist
**Target Date:** 2026-06-19 | **Owner:** DevOps Automator | **Branch:** `staging` → `main`

---

## 1. PRE-DEPLOYMENT VERIFICATION

### 1.1 Repository & Build
- [ ] `git status` is clean on staging branch (no uncommitted changes)
- [ ] `npm run build` passes with exit code 0 (verified: ✅)
- [ ] `npm audit` shows 0 high/critical vulnerabilities (verified: ✅)
- [ ] `client/dist` build artifacts are committed and match `client/src` changes
- [ ] Branch diff reviewed: `git log main..staging --oneline` — no unauthorized changes

### 1.2 P0 Task Verification
- [ ] **Security:** CSRF double-submit on admin login, `.admin-credentials` removed, env-only auth (verified: ✅)
- [ ] **Legacy HTML migration:** `public/*.html` files are NOT served by Express (`index: false` in `server.js`) (verified: ✅)
- [ ] **SPA auth fix:** Token persistence on direct navigation, `RequireAuth` + `Protected` wrappers (verified: ✅)
- [ ] **Dev env fix:** `.env` configured, `SESSION_SECRET`/`JWT_SECRET` set, `DATABASE_URL` reachable (verified: ✅)

### 1.3 Database Readiness
- [ ] No new migrations in this deploy cycle (verify `git diff main..staging -- migrations/`)
- [ ] If migrations exist: confirm idempotency (`CREATE TABLE IF NOT EXISTS`, `UNIQUE` constraints on `_migrations`)
- [ ] Production database backup completed (Neon PITR or manual `pg_dump`)
- [ ] Migration dry-run passes on staging: `NODE_ENV=staging node migrate.js`
- [ ] Database health check clean (`scripts/db-health-check.js` run on staging) (verified: ✅)
- [ ] Critical vacuum required: `VACUUM ANALYZE trust_scores; VACUUM ANALYZE omni_scores;` (see `docs/DATABASE_HEALTH_REPORT.md`)

### 1.4 Environment Variables (Render Dashboard)
- [ ] `NODE_ENV=production`
- [ ] `DATABASE_URL` → points to production Neon database (NOT staging/dev)
- [ ] `SESSION_SECRET` → strong random string (NOT dev default)
- [ ] `JWT_SECRET` → strong random string (NOT dev default)
- [ ] `ADMIN_USERNAME` / `ADMIN_PASSWORD` → production credentials
- [ ] `STRIPE_SECRET_KEY` → **live key** (`sk_live_...`) — ⚠️ CEO approval required
- [ ] `STRIPE_PUBLISHABLE_KEY` → **live key** (`pk_live_...`)
- [ ] `STRIPE_WEBHOOK_SECRET` → live endpoint secret
- [ ] `OPENAI_API_KEY` / `POLSIA_API_KEY` / `NVIDIA_NIM_API_KEY` / `GROQ_API_KEY` → at least one AI provider active
- [ ] `DEEPGRAM_API_KEY` → required for TTS/STT audio features
- [ ] `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` → production email provider
- [ ] `FRONTEND_URL` / `REKRUT_AI_URL` → `https://rekrutai.co`
- [ ] `CORS_ORIGINS` → includes `https://rekrutai.co`
- [ ] `FORCE_SSL_VERIFY=true`
- [ ] No hardcoded secrets in `render.yaml` (`sync: false` or `generateValue: true` for secrets)

### 1.5 Infrastructure & SSL
- [ ] Custom domain `rekrutai.co` configured on Render production service
- [ ] SSL certificate active and not expiring within 30 days
- [ ] Cloudflare DNS (if used) → Render origin routing healthy
- [ ] `render.yaml` committed and synced to `main`
- [ ] `healthCheckPath: /health` configured on `rekrutai-prod`
- [ ] `autoDeploy: true` on `rekrutai-prod` (for `main` branch)
- [ ] Plan sizing reviewed for expected traffic (`standard` or higher)

---

## 2. DATABASE MIGRATION STEPS (If Applicable)

> **Current deploy:** No new migrations identified. Skip to Section 3 if confirmed.

If migrations are present:
1. **Backup:** `pg_dump "$DATABASE_URL" > backup-$(date +%Y%m%d-%H%M).sql`
2. **Dry-run:** `NODE_ENV=staging node migrate.js` (verify on staging first)
3. **Deploy window:** Run migrations immediately after code deploy (Render `postDeploy` hook or manual)
4. **Verify:** Check `_migrations` table for new entries; confirm no errors in Render logs
5. **Rollback:** If migration fails, restore from backup or run reverse migration

---

## 3. ENVIRONMENT VARIABLE CHECKLIST

| Variable | Status | Notes |
|----------|--------|-------|
| `DATABASE_URL` | ☐ | Production Neon URL |
| `SESSION_SECRET` | ☐ | Strong random, not dev default |
| `JWT_SECRET` | ☐ | Strong random, not dev default |
| `ADMIN_USERNAME` | ☐ | Production admin login |
| `ADMIN_PASSWORD` | ☐ | Production admin password |
| `STRIPE_SECRET_KEY` | ☐ | **LIVE mode** — CEO approval |
| `STRIPE_PUBLISHABLE_KEY` | ☐ | **LIVE mode** |
| `STRIPE_WEBHOOK_SECRET` | ☐ | Live endpoint secret |
| `OPENAI_API_KEY` | ☐ | Or other active AI provider |
| `POLSIA_API_KEY` | ☐ | Primary AI proxy |
| `DEEPGRAM_API_KEY` | ☐ | Audio TTS/STT |
| `SMTP_HOST` | ☐ | Production mail |
| `SMTP_USER` | ☐ | Production mail |
| `SMTP_PASS` | ☐ | Production mail |
| `NODE_ENV` | ☐ | `production` |
| `FRONTEND_URL` | ☐ | `https://rekrutai.co` |
| `REKRUT_AI_URL` | ☐ | `https://rekrutai.co` |
| `CORS_ORIGINS` | ☐ | `https://rekrutai.co` |
| `FORCE_SSL_VERIFY` | ☐ | `true` |

---

## 4. POST-DEPLOYMENT VERIFICATION (Smoke Tests)

### 4.1 Health Checks
- [ ] `GET https://rekrutai.co/health` → `200 OK` with `{"status":"ok"}`
- [ ] `GET https://rekrutai.co/api/health` → `200 OK`
- [ ] Render dashboard shows service "Live" (green)

### 4.2 Core Pages & Auth
- [ ] Homepage loads: `https://rekrutai.co/` → 200, no console errors, title correct
- [ ] Login page: `https://rekrutai.co/login` → 200, form renders
- [ ] Candidate login → dashboard renders, navigation works
- [ ] Recruiter login → dashboard renders, jobs/interviews/candidates accessible
- [ ] Admin login → admin panel accessible, CSRF token works
- [ ] Direct URL navigation (e.g., `/recruiter/jobs`) works without 404 (SPA fallback)

### 4.3 API & Business Logic
- [ ] `GET /api/ai-health` → shows AI provider status
- [ ] `GET /api/admin/metrics` → admin analytics load
- [ ] Job posting flow: create → publish → view applicants
- [ ] Candidate application flow: browse jobs → apply → confirmation
- [ ] Interview scheduling: create → invite → join
- [ ] AI interview: start session → AI responds within 10 seconds
- [ ] OmniScore calculation: generates score for candidate

### 4.4 Payments & Stripe
- [ ] Pricing page loads: `https://rekrutai.co/pricing`
- [ ] Stripe checkout session initiates with live key
- [ ] Webhook endpoint: `POST /api/billing/webhook` → 200
- [ ] Subscription status updated in database after payment

### 4.5 Security & Compliance
- [ ] `X-Frame-Options: DENY` (or configured value)
- [ ] `Strict-Transport-Security` header present
- [ ] `Content-Security-Policy` loaded via helmet.js
- [ ] `x-powered-by` header absent
- [ ] EU AI Act compliance dashboard: `https://rekrutai.co/admin/compliance` → audit logs visible
- [ ] Admin audit logs show AI decision explanations and human overrides

### 4.6 Performance
- [ ] Dashboard page load < 3 seconds (first paint)
- [ ] API response time < 500ms for health endpoints
- [ ] No memory leaks in Render metrics (stable RAM over 5 minutes)
- [ ] Chunk size warning: 1.5MB index bundle — monitor for future code-splitting

### 4.7 Database
- [ ] No migration errors in Render logs
- [ ] `_migrations` table shows correct entries
- [ ] No connection pool exhaustion errors
- [ ] Neon dashboard shows healthy connection count

---

## 5. ROLLBACK PLAN

### 5.1 Decision Authority
- **Rollback trigger:** P0 incident, health check failure, >5% error rate, CEO (Ranga) decision
- **Execution owner:** DevOps Automator (Suga)
- **Target time to restore:** < 5 minutes

### 5.2 Rollback Steps

#### Option A — Fast Revert (Recommended if no DB migrations)
```bash
# Get last known good commit
git log main --oneline -5

# Revert the merge commit
git revert -m 1 [merge-commit-hash]
git push origin main
```
- **Time:** ~3–5 minutes (Render auto-deploys revert)
- **Risk:** Low
- **When:** Code bug, no new DB changes

#### Option B — Hard Reset (If revert is messy)
```bash
# Reset to last known good commit
git reset --hard [last-good-commit]
git push origin main --force-with-lease
```
- **Time:** ~2–3 minutes
- **Risk:** Medium (rewrites history)
- **When:** Multiple bad commits, revert conflicts

#### Option C — Database Rollback (If migrations ran)
- Restore from Neon backup/PITR
- Or create and run reverse migration
- **Time:** 10–30 minutes
- **Risk:** High (data loss if not careful)
- **When:** Migrations caused data corruption

### 5.3 Post-Rollback Verification
- [ ] `https://rekrutai.co/health` → 200 OK
- [ ] Smoke tests pass (login, dashboard, core pages)
- [ ] No database errors in logs
- [ ] Notify team: rollback reason, bad commit, restored commit, time to restore

---

## 6. KNOWN BLOCKERS & RISKS

| # | Risk | Severity | Mitigation | Owner |
|---|------|----------|------------|-------|
| 1 | `STRIPE_SECRET_KEY` is test mode in `.env` | 🔴 High | Must switch to live key in Render prod dashboard | Ranga |
| 2 | `SESSION_SECRET` / `JWT_SECRET` are dev defaults | 🟡 Medium | Must be rotated to strong production secrets before deploy | Suga |
| 3 | AI provider keys mostly empty in `.env` | 🟡 Medium | At least one provider must be configured in production | Suga |
| 4 | `trust_scores` / `omni_scores` table bloat | 🟡 Medium | Run `VACUUM ANALYZE` on these tables before peak traffic | Suga |
| 5 | Chunk size warning (1.5MB index bundle) | 🟢 Low | Monitor; plan dynamic imports for next sprint | Engineering |
| 6 | 7 foreign keys without indexes | 🟢 Low | Add `CREATE INDEX CONCURRENTLY` during low-traffic window | Suga |
| 7 | External uptime monitoring not configured | 🟡 Medium | Set up UptimeRobot/Pingdom on `/health` before go-live | Suga |
| 8 | No Sentry/Rollbar error tracking | 🟢 Low | Consider integration for production observability | Suga |

---

## 7. E2E TEST VERIFICATION (Pre-Deploy)

Run the sequential E2E suite to confirm critical paths:
```bash
# Run full sequential suite
node scripts/run-e2e-sequential.js

# Or CI mode
CI=true node scripts/run-e2e-sequential.js
```

- [ ] Auth setup passes (generates `e2e/.auth/*.json`)
- [ ] Candidate flow: login → browse jobs → apply
- [ ] Recruiter flow: login → post job → view applicants
- [ ] Admin flow: login → dashboard → compliance → audit logs
- [ ] Mobile navigation: responsive breakpoints, hamburger menu, sheet panels
- [ ] All tests pass or known skips documented

---

## 8. SIGN-OFF

| Role | Name | Status | Date |
|------|------|--------|------|
| Deploy Engineer | Suga (DevOps Automator) | ☐ | |
| QA Lead | Sunny | ☐ | |
| Technical Lead | CTO | ☐ | |
| CEO / Decision Authority | Ranga | ☐ | |

**Deploy safe. Verify twice. Rollback fast.**
