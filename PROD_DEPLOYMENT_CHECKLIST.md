# Rekrut AI v2 — Production Deployment Readiness Checklist

> **Generated:** 2026-06-08 by DevOps Automator
> **Deadline:** June 19, 2026 (11 days remaining)
> **Status:** 🟡 PARTIALLY READY — Blockers identified, action required

---

## 🏗️ 1. Render Infrastructure

### 1.1 Production Service Exists
- [x] **Service defined in `render.yaml`**: `rekrutai-prod` (type: web, env: node, plan: standard)
- [x] **Branch**: `main`
- [x] **Auto-deploy**: `false` (manual deploy only — correct for production safety)
- [x] **Health check**: `/health` endpoint configured
- [x] **Instance count**: 1 (standard plan)
- [ ] ⚠️ **Confirm service actually deployed on Render**: The `render.yaml` defines the service, but verify it exists in the Render dashboard at https://dashboard.render.com/
- [ ] ⚠️ **Verify service is healthy**: `curl https://rekrutai.co/health` (currently may return 404 if never deployed)

### 1.2 Production Database
- [x] **Database defined in `render.yaml`**: `rekrutai-prod-db` (type: pserv, env: postgresql, plan: standard)
- [x] **Database connection**: Render auto-wires `DATABASE_URL` from `rekrutai-prod-db`
- [ ] ⚠️ **Confirm database provisioned**: Check Render dashboard for `rekrutai-prod-db` status
- [ ] ⚠️ **Run migrations on prod DB**: `npm run migrate` (via Render shell or manual trigger)
- [ ] ⚠️ **Verify pgvector extension**: Required for AI matching — `CREATE EXTENSION IF NOT EXISTS vector;`
- [ ] ⚠️ **Seed required data**: Notification templates, system prompts, etc. (see `seed_notification_templates.js`)

### 1.3 Staging vs Dev Services (for reference)
- **rekrutai-staging**: `staging` branch, auto-deploy enabled, starter plan, URL: https://rekrutai-staging.onrender.com ✅ Active
- **rekrutai-dev**: `dev` branch, auto-deploy enabled, starter plan, URL: https://rekrutai-dev.onrender.com ✅ Active
- **rekrutai-prod**: `main` branch, auto-deploy disabled, standard plan, URL: https://rekrutai.co 🟡 Awaiting first deploy

---

## 🔐 2. Environment Variables (Critical)

### 2.1 Production-Specific Config (Already Set in render.yaml)
| Variable | render.yaml Value | Status |
|----------|-------------------|--------|
| `NODE_ENV` | `production` | ✅ |
| `PORT` | `10000` | ✅ |
| `REKRUT_AI_URL` | `https://rekrutai.co` | ✅ |
| `APP_URL` | `https://rekrutai.co` | ✅ |
| `FRONTEND_URL` | `https://rekrutai.co` | ✅ |
| `BASE_URL` | `https://rekrutai.co` | ✅ |
| `CORS_ORIGINS` | `https://rekrutai.co,https://www.rekrutai.co` | ✅ |
| `FORCE_SSL_VERIFY` | `true` | ✅ |

### 2.2 Secrets Requiring Manual Configuration (sync: false)
> ⚠️ **CRITICAL**: These MUST be set in the Render dashboard before first deployment. All are marked `sync: false` in `render.yaml`.

#### Tier 1 — Security (BLOCKING)
- [ ] **JWT_SECRET** — Strong random string (256-bit minimum). Currently uses `dev-jwt-secret...` in dev.
- [ ] **SESSION_SECRET** — Strong random string (256-bit minimum). Currently uses `dev-secret...` in dev.
- [ ] **ADMIN_USERNAME** — Production admin login username
- [ ] **ADMIN_PASSWORD** — Production admin login password (bcrypt hashed or plain — verify auth.js)

#### Tier 2 — Payment (BLOCKING if paid features enabled)
- [ ] **STRIPE_SECRET_KEY** — Live key (`sk_live_...`), NOT the test key currently in `.env`
- [ ] **STRIPE_WEBHOOK_SECRET** — Live webhook endpoint secret from Stripe dashboard
- [ ] ⚠️ **Stripe publishable key** — Must be embedded in client build (verify `client/src/` references correct key)

#### Tier 3 — AI Providers (BLOCKING if AI features enabled)
- [ ] **POLSIA_API_KEY** — Primary AI proxy key
- [ ] **POLSIA_API_URL** — Polsia API endpoint
- [ ] **OPENAI_API_KEY** — OpenAI fallback
- [ ] **OPENAI_BASE_URL** — Custom base URL (if any)
- [ ] **NVIDIA_NIM_API_KEY** — NVIDIA NIM fallback
- [ ] **NIM_BASE_URL** — NIM API endpoint
- [ ] **GROQ_API_KEY** — Groq fallback
- [ ] **CEREBRAS_API_KEY** — Cerebras fallback
- [ ] **DEEPGRAM_API_KEY** — Required for TTS/STT audio features
- [ ] **NIM_LLM_MODEL** through **NIM_ASR_V3** — Model configuration variables (15+ vars)
- [ ] **NIM_TTS_BASE_URL** through **NIM_MAGPIE_MULTI_BASE_URL** — TTS service endpoints (5+ vars)

#### Tier 4 — Cloud Storage (R2)
- [ ] **R2_ACCESS_KEY_ID** — Cloudflare R2 access key
- [ ] **R2_SECRET_ACCESS_KEY** — R2 secret key
- [ ] **R2_BUCKET_NAME** — Bucket name
- [ ] **R2_ENDPOINT** — R2 S3-compatible endpoint
- [ ] **R2_PUBLIC_URL** — Public CDN URL for file serving

#### Tier 5 — Email/SMTP (BLOCKING if email notifications enabled)
- [ ] **EMAIL_HOST** / **SMTP_HOST** — Mail provider (e.g., Gmail, SendGrid, Mailgun)
- [ ] **EMAIL_PORT** / **SMTP_PORT** — SMTP port
- [ ] **EMAIL_USER** / **SMTP_USER** — SMTP username
- [ ] **EMAIL_PASS** / **SMTP_PASS** — SMTP password (app-specific for Gmail)
- [ ] **EMAIL_FROM_ADDRESS** / **SMTP_FROM** — From address
- [ ] **EMAIL_FROM_NAME** — From display name
- [ ] **EMAIL_RATE_LIMIT** / **EMAIL_RATE_LIMIT_HOUR** / **EMAIL_RETRY_ATTEMPTS** / **EMAIL_RETRY_DELAY** — Rate limiting
- [ ] **SMTP_SECURE** — TLS/SSL flag

#### Tier 6 — OAuth (BLOCKING if social login enabled)
- [ ] **GOOGLE_CLIENT_ID** — Google OAuth app ID
- [ ] **GOOGLE_CLIENT_SECRET** — Google OAuth secret
- [ ] **GOOGLE_REDIRECT_URI** — Must be `https://rekrutai.co/api/auth/google/callback`
- [ ] **LINKEDIN_CLIENT_ID** — LinkedIn OAuth app ID
- [ ] **LINKEDIN_CLIENT_SECRET** — LinkedIn OAuth secret
- [ ] **LINKEDIN_REDIRECT_URI** — Must be `https://rekrutai.co/api/auth/linkedin/callback`

#### Tier 7 — Monitoring / Budgeting
- [ ] **OPENAI_DAILY_TOKEN_BUDGET** — Daily token limit (if not set, defaults to 100K in code)

### 2.3 Secrets Audit Checklist
- [ ] **Generate new production secrets** — Do NOT reuse dev/staging secrets (JWT_SECRET, SESSION_SECRET, ADMIN_PASSWORD)
- [ ] **Rotate Stripe keys** — Use live keys, not test keys
- [ ] **Verify AI API keys** — Ensure production quota limits on all providers
- [ ] **Set OAuth redirect URIs** — Update Google/LinkedIn app settings to point to production domain
- [ ] **Test email provider** — Send test email from production to verify SMTP credentials
- [ ] **R2 bucket permissions** — Verify CORS and public-read policies for file uploads

---

## 🗄️ 3. Database & Migrations

### 3.1 Migration Readiness
- [x] **Migration runner**: `migrate.js` with `_migrations` tracking table ✅
- [x] **Migration count**: 59+ `.js` files + 2 `.sql` files in `/migrations/` ✅
- [x] **Migration pattern**: Ordered numeric + timestamp prefixes ✅
- [x] **Core tables**: users, jobs, interviews, interview_questions, agent_data created in migrate.js ✅
- [x] **Feature tables**: All covered via migrations (omniscore, trustscore, payroll, compliance, onboarding, etc.) ✅
- [ ] ⚠️ **Run migrations on prod DB before deploy** — Run `node migrate.js` via Render shell or include in build step
- [ ] ⚠️ **Verify all 105 tables exist** — Query `information_schema.tables` to confirm
- [ ] ⚠️ **Verify pgvector extension** — Required for AI matching features
- [ ] ⚠️ **Run `seed_notification_templates.js`** — Seed default email/notification templates
- [ ] ⚠️ **Verify foreign key constraints** — Especially company_id references (see migration `045_fix_company_id_fk_constraints.sql`)

### 3.2 Database Migration Risk Assessment
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Migration fails on prod | Low | Run on staging first, test rollback. `migrate.js` uses transactions (BEGIN/COMMIT/ROLLBACK) |
| Missing pgvector | Low | Neon supports pgvector — verify with `CREATE EXTENSION` |
| Schema mismatch | Low | Staging DB is running same migrations — verify parity |
| Seed data missing | Medium | Run seed scripts manually after migration |

### 3.3 Post-Migration Verification
- [ ] `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';` → ~105 tables
- [ ] `SELECT * FROM _migrations ORDER BY applied_at DESC;` → All migrations applied
- [ ] `SELECT extname FROM pg_extension;` → includes `vector`
- [ ] `SELECT COUNT(*) FROM notification_templates;` → > 0 (seeded)
- [ ] `SELECT COUNT(*) FROM ai_prompts;` → > 0 (seeded if applicable)

---

## 🌐 4. Domain & SSL

### 4.1 Custom Domain
- [x] **Domain configured**: `rekrutai.co` in `render.yaml` env vars
- [x] **CORS origins**: `https://rekrutai.co,https://www.rekrutai.co` in render.yaml
- [x] **Server CSP**: Connects to `https://api.rekrutai.co` in `server.js` helmet config
- [ ] ⚠️ **DNS configured**: A/ALIAS record pointing to Render's load balancer
- [ ] ⚠️ **www redirect**: Ensure `www.rekrutai.co` → `rekrutai.co` (or vice versa)
- [ ] ⚠️ **Verify domain in Render dashboard**: Settings → Custom Domain → Verify

### 4.2 SSL Certificate
- [x] **Render auto-manages SSL**: Render provisions Let's Encrypt certificates automatically for custom domains ✅
- [x] **SSL enforcement**: `FORCE_SSL_VERIFY: true` on production ✅
- [x] **HSTS headers**: `maxAge: 31536000`, `includeSubDomains: true`, `preload: true` in helmet ✅
- [ ] ⚠️ **Verify SSL after deploy**: `curl -I https://rekrutai.co` → HTTP 200, valid certificate
- [ ] ⚠️ **Redirect HTTP → HTTPS**: Verify `http://rekrutai.co` redirects to HTTPS

### 4.3 Domain Security
- [ ] **Google OAuth redirect URI**: Add `https://rekrutai.co/api/auth/google/callback` to Google Cloud Console
- [ ] **LinkedIn OAuth redirect URI**: Add `https://rekrutai.co/api/auth/linkedin/callback` to LinkedIn Developer Portal
- [ ] **Stripe webhook endpoint**: Create `https://rekrutai.co/api/billing/webhook` in Stripe dashboard
- [ ] **Stripe success/cancel URLs**: Update to `https://rekrutai.co/...` in Stripe checkout config

---

## 📊 5. Monitoring, Logging & Health Checks

### 5.1 Health Checks (Implemented)
- [x] **Basic health**: `GET /health` → `{ status: 'ok', timestamp: '...' }` ✅
- [x] **API health alias**: `GET /api/health` → same response ✅
- [x] **Render health check**: `healthCheckPath: /health` configured in `render.yaml` ✅
- [ ] ⚠️ **Verify health check works on prod**: `curl https://rekrutai.co/health` after deploy

### 5.2 Admin Monitoring Endpoints (Implemented)
- [x] **Metrics**: `GET /api/admin/metrics` (requireAdmin) — request counts, latency, error rates ✅
- [x] **Route metrics**: `GET /api/admin/routes` — 351-endpoint monitoring ✅
- [x] **Module metrics**: `GET /api/admin/modules` — business metrics dashboard ✅
- [x] **Activity log**: `GET /api/admin/activity` — real-time + historical event logging ✅
- [x] **AI health**: `GET /api/ai-health` — provider circuit breaker status ✅
- [x] **AI usage**: `GET /api/ai-health/usage` — token usage breakdown ✅
- [x] **AI budget**: `GET /api/ai-health/budget` — budget predictions ✅
- [x] **Token usage**: `GET /api/admin/token-usage` — OpenAI token budget status ✅
- [x] **Database query stats**: `lib/db.js` tracks total queries, slow queries, QPM ✅

### 5.3 Missing Monitoring (Gaps)
- [ ] **Uptime monitoring**: No external uptime checker (e.g., UptimeRobot, Pingdom, Better Uptime)
- [ ] **Alerting**: No alerts on health check failures or high error rates
- [ ] **Error tracking**: No Sentry, LogRocket, or Rollbar integration for frontend/backend errors
- [ ] **Performance monitoring**: No APM tool (e.g., New Relic, Datadog) for tracing slow requests
- [ ] **Log aggregation**: No centralized logging (e.g., Datadog, Splunk, Papertrail). Render logs are ephemeral.
- [ ] **Database monitoring**: No query performance monitoring or slow query alerts
- [ ] **SSL expiry monitoring**: Render auto-renews, but no external alert for expiry

### 5.4 Recommended Monitoring Setup (Post-Launch)
- [ ] **UptimeRobot**: Free tier — 50 monitors, 5-minute checks. Monitor `https://rekrutai.co/health`
- [ ] **Sentry**: Error tracking for React + Node.js (free tier: 5K errors/month)
- [ ] **Render Log Streams**: Configure log forwarding to external service (e.g., Datadog, Papertrail)
- [ ] **Custom alerts**: Add webhook to admin activity feed for critical errors
- [ ] **Database health check**: Add `GET /api/health` check that queries DB to verify connectivity

---

## 💾 6. Backups & Disaster Recovery

### 6.1 Database Backups (Render PostgreSQL)
- [x] **Render provides automatic backups**: Standard plan includes daily backups ✅
- [ ] ⚠️ **Verify backup schedule**: Check Render dashboard for `rekrutai-prod-db` backup settings
- [ ] ⚠️ **Verify backup retention**: Standard plan = 7 days of backups
- [ ] ⚠️ **Test restore procedure**: Restore a backup to a test database to verify integrity
- [ ] ⚠️ **Document restore steps**: Create a runbook for restoring from backup

### 6.2 Disaster Recovery Plan
- [ ] **RPO (Recovery Point Objective)**: Daily backups = max 24h data loss
- [ ] **RTO (Recovery Time Objective)**: Render restore time ~15-30 minutes
- [ ] **Rollback procedure**: Documented in `DEPLOYMENT_PROCESS.md` — deploy previous commit via Render dashboard
- [ ] **Database failover**: Neon provides read replicas — verify if configured
- [ ] **Multi-region**: Not currently implemented (single US region)

### 6.3 Missing Backup Coverage
- [ ] **R2 bucket backups**: No automated backup of uploaded files/documents
- [ ] **Code backup**: GitHub is the source of truth, but no automated backup to secondary repo
- [ ] **Environment variables backup**: No backup of Render env vars — document in 1Password/Vault
- [ ] **Stripe data backup**: Subscription data is in Stripe, but local cache should be backed up

---

## 🔒 7. Security Hardening

### 7.1 Implemented Security (Good)
- [x] **Helmet.js**: CSP, HSTS, frame protection, x-powered-by disabled ✅
- [x] **CORS**: Whitelist-based, credentials enabled ✅
- [x] **CSRF protection**: Double-submit cookie pattern, enforced for session-based requests ✅
- [x] **JWT**: Bearer token auth with secret ✅
- [x] **Session management**: PostgreSQL-backed sessions with `connect-pg-simple`, 7-day expiry ✅
- [x] **Secure cookies**: `secure: true`, `httpOnly: true`, `sameSite: 'lax'` in production ✅
- [x] **SSL verification**: `FORCE_SSL_VERIFY: true` on production ✅
- [x] **Rate limiting**: Distributed rate limiter with cleanup ✅
- [x] **Input validation**: `express-validator` used on routes ✅
- [x] **Password hashing**: `bcryptjs` used in auth ✅
- [x] **Permissions policy**: Camera/microphone restricted to same-origin ✅
- [x] **Trust proxy**: `app.set('trust proxy', 1)` for Render reverse proxy ✅
- [x] **npm audit**: CI blocks on critical/high vulnerabilities ✅

### 7.2 Security Gaps (Needs Action)
- [ ] **Content Security Policy refinement**: `connectSrc` includes `https://rekrutai-dev.onrender.com` in prod — should be removed or conditional
- [ ] **Security headers audit**: Verify `Referrer-Policy`, `Feature-Policy` are set
- [ ] **Penetration testing**: No external security audit or pentest scheduled
- [ ] **Dependency scanning**: Only `npm audit` — no Snyk or Dependabot alerts configured
- [ ] **Secret scanning**: GitHub secret scanning not confirmed enabled
- [ ] **DDoS protection**: Render has basic DDoS, but no Cloudflare or similar in front
- [ ] **WAF**: No Web Application Firewall configured
- [ ] **API rate limiting per user**: Current rate limiter may be global, not per-user/IP
- [ ] **SQL injection audit**: Verify all routes use parameterized queries (most do via `pool.query`)
- [ ] **XSS audit**: Verify all user input is sanitized before rendering
- [ ] **File upload security**: `multer` is used — verify file type/size limits and scan for malware
- [ ] **Admin panel brute force**: No rate limiting specifically on `/api/admin` routes

### 7.3 Secrets Management
- [ ] **Password manager**: Store all production env vars in 1Password/Bitwarden/Vault
- [ ] **Team access**: Document who has access to Render dashboard and Stripe dashboard
- [ ] **2FA enforcement**: Enable 2FA on all accounts (GitHub, Render, Stripe, Google Cloud, LinkedIn)
- [ ] **API key rotation schedule**: Plan quarterly rotation of AI provider keys, OAuth secrets
- [ ] **Stripe webhook signing**: Verify webhook signature validation in `routes/billing.js`

---

## 🚀 8. CI/CD Pipeline

### 8.1 Current Pipeline (Implemented on dev/staging)
- [x] **CI workflow**: `.github/workflows/ci.yml` — build, audit, e2e, health check ✅
- [x] **Deploy workflow**: `.github/workflows/deploy.yml` — manual trigger, confirmation gate, post-deploy health check ✅
- [x] **Concurrency control**: `cancel-in-progress: true` ✅
- [x] **E2E tests**: Playwright with Chromium, retries=2 in CI ✅
- [x] **Build before E2E**: Build gate ensures no compilation errors ✅
- [x] **Security audit**: `npm audit --audit-level high` blocks CI ✅

### 8.2 Pipeline Gap — CRITICAL
- [ ] ⚠️ **CI/CD workflows NOT in `main` branch**: The `.github/workflows/` directory exists in `dev` and `staging` branches but the `main` branch does NOT have these workflows yet (confirmed by `git diff main..staging --stat` showing `ci.yml` and `deploy.yml` as new files)
- [ ] **Impact**: If you deploy `main` to production, the CI/CD pipeline is missing. The production deploy workflow will not be available in GitHub Actions until `main` is updated.
- [ ] **Action Required**: Merge `staging` → `main` to bring CI/CD workflows to production branch, OR cherry-pick `.github/workflows/` into `main` first.

### 8.3 Branch Protection Status (Needs Verification)
- [ ] **main branch protection**: Require PR, 1 approval, status checks (Build Check, Security Audit, E2E Tests)
- [ ] **staging branch protection**: Require PR, status checks (Build Check, Security Audit, E2E Tests)
- [ ] **dev branch protection**: Require PR, status checks (Build Check, Security Audit)
- [ ] **Force push disabled**: On all three branches
- [ ] **Branch deletion disabled**: On `main` and `staging`

### 8.4 Staging → Main Promotion
- [ ] **Current status**: `staging` is 3 commits ahead of `main` (780 vs 777 commits)
- [ ] **Merge strategy**: Open PR from `staging` → `main`, require review, run CI
- [ ] **Verify no breaking changes**: The diff shows CI/CD files, E2E improvements, documentation, and route changes — review for breaking changes
- [ ] **Post-merge CI**: Ensure CI passes on `main` after merge

### 8.5 Post-Deploy Verification
- [ ] **GitHub Actions health check**: Deploy workflow polls `https://rekrutai.co/health` for 10 attempts
- [ ] **Manual verification**: Visit `https://rekrutai.co` and run through critical flows
- [ ] **Staging parity check**: Compare staging and production responses for key endpoints

---

## 🔄 9. Rollback Plan

### 9.1 Rollback Procedures (Documented in DEPLOYMENT_PROCESS.md)
- [x] **Immediate rollback**: Render Dashboard → `rekrutai-prod` → Manual Deploy → Deploy previous commit ✅
- [x] **Short-term rollback**: Revert problematic PR on `main`, redeploy ✅
- [x] **Long-term fix**: Investigate in staging before re-deploying ✅

### 9.2 Rollback Checklist
- [ ] **Identify failure**: Health check fails, error spike, or user-reported issue
- [ ] **Stop traffic**: If using Render custom domain, no load balancer to disable — but can deploy previous commit quickly
- [ ] **Deploy previous commit**: Render dashboard → Manual Deploy → Previous commit (2-3 minutes)
- [ ] **Verify rollback**: Health check passes, critical flows work
- [ ] **Investigate root cause**: Check logs, reproduce in staging
- [ ] **Communicate**: Notify team via Slack/Discord if applicable

### 9.3 Rollback Time Estimates
| Step | Time |
|------|------|
| Detect failure | ~1-2 minutes (health check polling) |
| Trigger rollback | ~2 minutes (Render dashboard) |
| Render deploys previous commit | ~3-5 minutes |
| Verify rollback | ~1 minute |
| **Total** | **~7-10 minutes** |

---

## 🧪 10. Smoke Tests (Post-Deploy)

### 10.1 Critical Path Tests
- [ ] **Health check**: `curl https://rekrutai.co/health` → `{"status":"ok"}`
- [ ] **API health**: `curl https://rekrutai.co/api/health` → `{"status":"ok"}`
- [ ] **Homepage loads**: `https://rekrutai.co` → React SPA loads, no 503 errors
- [ ] **Public pages**: `/`, `/login`, `/register`, `/pricing` all load
- [ ] **Registration**: Create a test account → success
- [ ] **Login**: Authenticate with test account → JWT/session established
- [ ] **Candidate jobs**: `/candidate/jobs` → job list renders
- [ ] **Recruiter dashboard**: `/recruiter/dashboard` → dashboard renders (with recruiter account)
- [ ] **Stripe checkout**: `/pricing` → click plan → redirects to Stripe checkout
- [ ] **Admin panel**: `/admin` → login with admin credentials → dashboard loads
- [ ] **Database connectivity**: Login requires DB → confirms DB connection works
- [ ] **AI health**: `GET /api/ai-health` (admin) → providers respond

### 10.2 Security Tests
- [ ] **HTTPS only**: `http://rekrutai.co` redirects to HTTPS
- [ ] **CORS headers**: API requests from `https://rekrutai.co` succeed
- [ ] **CSP headers**: Check Response Headers for `Content-Security-Policy`
- [ ] **CSRF protection**: POST to `/api/auth/logout` without CSRF token → 403
- [ ] **JWT expiration**: Old token rejected after expiry

### 10.3 E2E Test Suite (Run on Production)
- [ ] **Run E2E against prod**: `npx playwright test --project=chromium` with `baseURL: https://rekrutai.co`
- [ ] **Auth tests**: `auth-persistence.spec.ts` passes
- [ ] **Candidate tests**: `candidate-critical-flow.spec.ts` passes
- [ ] **Recruiter tests**: `recruiter-critical-flow.spec.ts` passes
- [ ] **Payment tests**: `payment-flow.spec.ts` passes (with test Stripe keys or live in test mode)
- [ ] **Admin tests**: `admin-critical-flow.spec.ts` — needs admin credentials set first

---

## 💰 11. Cost Estimate (Render Bill)

### 11.1 Production Costs
| Service | Plan | Monthly Cost |
|---------|------|-------------|
| `rekrutai-prod` (Web) | Standard | ~$25/mo |
| `rekrutai-prod-db` (PostgreSQL) | Standard | ~$20-25/mo |
| **Production Subtotal** | | **~$45-50/mo** |

### 11.2 Non-Production Costs
| Service | Plan | Monthly Cost |
|---------|------|-------------|
| `rekrutai-staging` (Web) | Starter | ~$0 (free tier) |
| `rekrutai-staging-db` (PostgreSQL) | Starter | ~$0 (free tier) |
| `rekrutai-dev` (Web) | Starter | ~$0 (free tier) |
| `rekrutai-dev-db` (PostgreSQL) | Starter | ~$0 (free tier) |
| **Non-Prod Subtotal** | | **~$0/mo** |

### 11.3 External Service Costs (Estimated)
| Service | Estimated Monthly |
|---------|-------------------|
| Stripe (payment processing) | Per-transaction (2.9% + 30¢) |
| OpenAI API | Usage-based ($0-500 depending on volume) |
| NVIDIA NIM API | Usage-based ($0-200 depending on volume) |
| Groq API | Usage-based ($0-100 depending on volume) |
| Deepgram (TTS/STT) | Usage-based ($0-50 depending on volume) |
| Cloudflare R2 (storage) | $0.015/GB + egress |
| Email (Gmail/SendGrid) | ~$0-20 depending on volume |
| Neon PostgreSQL (if using Neon directly) | May overlap with Render DB cost |
| Domain (rekrutai.co) | ~$10-15/year |
| **External Services** | **~$50-870/mo** (variable) |

### 11.4 Total Monthly Estimate
| Scenario | Cost |
|----------|------|
| **Minimal traffic** (Render + low API usage) | **~$50-100/mo** |
| **Moderate traffic** (Render + moderate API usage) | **~$100-300/mo** |
| **High traffic** (Render + high API usage, many users) | **~$300-1000/mo** |

### 11.5 Cost Optimization Notes
- Standard plan is currently 1 instance. Scale to 2+ only when traffic demands it.
- Consider Render's "Pro" plan if > 100K requests/month or need more CPU.
- AI provider costs are the biggest variable — monitor via `/api/ai-health/budget`.
- Consider caching strategies (TTS audio cache already implemented) to reduce API calls.

---

## 📝 12. Known Gaps & Blockers

### Blockers (Must Fix Before Deploy)
| # | Blocker | Severity | Owner | Action Required |
|---|---------|----------|-------|-----------------|
| B1 | **CI/CD workflows missing in `main` branch** | 🔴 CRITICAL | DevOps | Merge `staging` → `main` or cherry-pick `.github/workflows/` |
| B2 | **Production secrets not set in Render** | 🔴 CRITICAL | Suga/Ranga | Set all `sync: false` env vars in Render dashboard |
| B3 | **Stripe live keys not configured** | 🔴 CRITICAL | Suga | Replace test keys with live keys in production env |
| B4 | **E2E dark-mode test SIGKILL failure** | 🟡 MEDIUM | QA | Known infrastructure issue — re-run with `--workers=1` or document exception |
| B5 | **Database migrations not run on prod** | 🔴 CRITICAL | DevOps | Run `node migrate.js` via Render shell before first deploy |
| B6 | **Seed data not loaded** | 🟡 MEDIUM | DevOps | Run `seed_notification_templates.js` after migrations |
| B7 | **OAuth redirect URIs not updated** | 🟡 MEDIUM | Suga | Update Google/LinkedIn app settings to production URLs |
| B8 | **Admin credentials not set** | 🟡 MEDIUM | Suga | Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in Render env vars |
| B9 | **Branch protection not confirmed** | 🟡 MEDIUM | DevOps | Verify GitHub branch protection rules are enabled |
| B10 | **No external uptime monitoring** | 🟡 MEDIUM | DevOps | Set up UptimeRobot or similar after deploy |

### Non-Blockers (Can Fix Post-Launch)
| # | Issue | Priority | Recommended Timeline |
|---|-------|----------|---------------------|
| N1 | No centralized error tracking (Sentry) | Medium | Within 1 week of launch |
| N2 | No APM/performance monitoring | Medium | Within 2 weeks |
| N3 | No log aggregation | Low | Within 1 month |
| N4 | No automated backup verification | Low | Within 1 month |
| N5 | No WAF/DDoS protection beyond Render | Low | Within 1 month |
| N6 | No pen testing or security audit | Medium | Within 1 month |
| N7 | Code splitting for client bundle | Low | Within 1 month |
| N8 | Multi-region deployment | Low | Future roadmap |
| N9 | Database read replicas | Low | When traffic scales |
| N10 | R2 file backup automation | Low | Within 1 month |

---

## 📋 13. Pre-Launch Action Plan (Next 11 Days)

### Day 1-2 (June 9-10): Infrastructure Setup
1. [ ] Set all production secrets in Render dashboard (B2)
2. [ ] Run migrations on `rekrutai-prod-db` (B5)
3. [ ] Load seed data (B6)
4. [ ] Update OAuth redirect URIs in Google/LinkedIn consoles (B7)
5. [ ] Configure Stripe webhook endpoint and live keys (B3)
6. [ ] Set admin credentials (B8)

### Day 3-4 (June 11-12): CI/CD & Branch Management
1. [ ] Merge `staging` → `main` PR (brings CI/CD workflows) (B1)
2. [ ] Verify CI passes on `main`
3. [ ] Enable branch protection on `main`, `staging`, `dev` (B9)
4. [ ] Verify deploy workflow appears in GitHub Actions

### Day 5-6 (June 13-14): Staging Validation
1. [ ] Run full E2E suite on `rekrutai-staging.onrender.com`
2. [ ] Verify Stripe checkout flow end-to-end (test mode)
3. [ ] Verify AI features work on staging (all providers)
4. [ ] Verify email notifications work on staging
5. [ ] Run `candidate-critical-flow` and `recruiter-critical-flow` manually

### Day 7-8 (June 15-16): Production Deploy
1. [ ] Trigger GitHub Actions "Deploy to Production" workflow
2. [ ] Manual deploy via Render dashboard
3. [ ] Run all smoke tests (Section 10)
4. [ ] Run E2E suite against production
5. [ ] Verify health checks pass
6. [ ] Verify domain and SSL

### Day 9-11 (June 17-19): Monitoring & Hardening
1. [ ] Set up UptimeRobot for `https://rekrutai.co/health` (B10)
2. [ ] Set up Sentry for error tracking (N1)
3. [ ] Monitor first 24-48 hours for errors
4. [ ] Document any issues found
5. [ ] Final sign-off from stakeholders

---

## ✅ 14. Go/No-Go Checklist (Final Decision)

Before deploying to production, ALL of the following must be true:

- [ ] All 🔴 CRITICAL blockers resolved (B1-B3, B5)
- [ ] `staging` branch is stable and passing all CI checks
- [ ] E2E tests pass on staging (allowing for known SIGKILL exception if documented)
- [ ] All production secrets configured in Render dashboard
- [ ] Database migrations applied to prod DB and verified
- [ ] Stripe live keys configured and webhook endpoint created
- [ ] OAuth redirect URIs updated to production domain
- [ ] Smoke tests pass on staging
- [ ] Rollback plan understood and documented
- [ ] Team knows how to trigger manual deploy via Render dashboard
- [ ] Cost expectations communicated to stakeholders
- [ ] Monitoring (at minimum health checks) is operational
- [ ] Team is available for first 24 hours post-deploy for incident response

**Go/No-Go Decision:**
- [ ] **GO** — All criteria met, deploy on schedule
- [ ] **NO-GO** — Blockers remain, postpone deployment until resolved
- [ ] **GO with exceptions** — Minor issues documented, mitigation plan in place

---

## 📎 Appendix A: Environment Variable Quick Reference

### Variables to Set in Render Dashboard (Production)
```
# Security (GENERATE NEW — do not reuse dev values)
JWT_SECRET=<strong_random_256bit_string>
SESSION_SECRET=<strong_random_256bit_string>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong_password>

# Stripe (LIVE KEYS — not test keys)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# AI Providers (verify quotas and billing on each provider)
POLSIA_API_KEY=...
OPENAI_API_KEY=...
NVIDIA_NIM_API_KEY=...
GROQ_API_KEY=...
CEREBRAS_API_KEY=...
DEEPGRAM_API_KEY=...

# R2 Storage
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
R2_ENDPOINT=...
R2_PUBLIC_URL=...

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=noreply@rekrutai.co
SMTP_SECURE=true

# OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://rekrutai.co/api/auth/google/callback
LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...
LINKEDIN_REDIRECT_URI=https://rekrutai.co/api/auth/linkedin/callback

# Monitoring (optional but recommended)
OPENAI_DAILY_TOKEN_BUDGET=100000
```

---

## 📎 Appendix B: Useful Commands

```bash
# Check service health
curl https://rekrutai.co/health
curl https://rekrutai-staging.onrender.com/health
curl https://rekrutai-dev.onrender.com/health

# Run migrations locally (against prod DB — use with caution)
DATABASE_URL="prod_connection_string" node migrate.js

# Run E2E tests against staging
BASE_URL=https://rekrutai-staging.onrender.com npx playwright test --project=chromium

# Run E2E tests against production
BASE_URL=https://rekrutai.co npx playwright test --project=chromium

# Check database tables
psql $DATABASE_URL -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"

# Check migrations applied
psql $DATABASE_URL -c "SELECT * FROM _migrations ORDER BY applied_at DESC;"

# Verify pgvector
psql $DATABASE_URL -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

---

## 📎 Appendix C: Current Branch Status (2026-06-08)

| Branch | Commits | Status | Relative to Main |
|--------|---------|--------|------------------|
| `main` | 777 | Production branch | Baseline |
| `staging` | 780 | 3 commits ahead of main | Contains CI/CD, E2E fixes, docs |
| `dev` | 779 | 2 commits ahead of main | Active development |

**Key difference `main` → `staging`:**
- `.github/workflows/ci.yml` — CI pipeline (new)
- `.github/workflows/deploy.yml` — Deploy pipeline (new)
- `DEPLOYMENT_PROCESS.md` — Deployment documentation (new)
- `STAGING_WORKFLOW.md` — Staging workflow docs (new)
- `e2e/` — E2E test improvements (selectors, fixes)
- `server.js` — Security improvements (helmet, CSP, permissions policy)
- `render.yaml` — `autoDeploy: false` on prod

**Recommendation:** Merge `staging` → `main` to bring CI/CD to production branch before deploying.

---

*Document generated by DevOps Automator subagent. Review with the team and update as blockers are resolved.*
