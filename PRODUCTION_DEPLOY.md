# Rekrut AI — Production Deployment Checklist

> **Version:** 2.0  
> **Prepared by:** DevOps Automator  
> **Date:** 2026-06-09  
> **Target:** Render Cloud (`rekrutai-prod` → `https://rekrutai.co`)  
> **Status:** 🔴 **NO-GO** — Blockers must be resolved before deploy

---

## 1. Executive Summary

| Item | Status |
|------|--------|
| Staging Health | ✅ Healthy (`/health` 200, ~0.45s) |
| Staging Build Freshness | ❌ **18 commits behind** `origin/staging` |
| Production Health Check Config | ❌ `healthCheckPath` may be empty in Render Dashboard |
| Production Build History | ❌ **7+ failed deploys** in 24h (cascade failure) |
| Branch State (`main` vs `dev`) | ❌ Diverged (13 commits each way) |
| Production Secrets | ❌ **Not set** — all `sync: false` env vars are empty |
| Database Migrations | ⚠️ 47+ migration files; must be tested on staging first |

**Verdict:** Do **not** deploy to production until all 🔴 blockers below are resolved.

---

## 2. Pre-Deploy Verification Steps

### 2.1 Branch & Merge Readiness (BLOCKING)

- [ ] **Merge `dev` → `staging`** and ensure `staging` branch is at `origin/staging` HEAD.
- [ ] **Resolve branch divergence** between `main` and `dev` (`main` is 13 commits behind `dev`, 12 ahead). Reconcile via PR or fast-forward.
- [ ] **Commit or discard uncommitted changes** on `dev` (3 files: `sidebar.tsx`, `auth-persistence.spec.ts`, `server.js`).
- [ ] **Require PR review + CI pass** before merging to `main`. Enable branch protection rules on `main`.

### 2.2 Staging Verification (BLOCKING)

- [ ] **Trigger manual deploy** of latest `origin/staging` commit from Render Dashboard.
- [ ] **Verify staging autoDeploy resumes** after manual deploy. Check next push triggers a build.
- [ ] **Confirm build artifact hash** on staging matches expected local dist hash.
- [ ] **Run full E2E suite** against `https://rekrutai-staging.onrender.com` (`npx playwright test --project=staging`).
- [ ] **Verify EU AI Act compliance endpoints** on staging:
  - `/api/admin/compliance/explanations`
  - `/api/admin/compliance/overrides`
  - `/api/admin/compliance/risk-checklist`

### 2.3 Build & Security Checks

- [ ] **Client build passes** locally: `cd client && npm install --include=dev && npm run build`
- [ ] **Server syntax valid**: `node -c server.js && for f in routes/*.js; do node -c "$f"; done`
- [ ] **Dependency audit clean**: `npm audit --audit-level moderate` returns 0 vulnerabilities
- [ ] **No secrets in repo**: confirm `.env` and `debug/` are in `.gitignore`

---

## 3. Environment Variables — Production

All of the following **must be set** in the Render Dashboard for `rekrutai-prod` **before** deploy. Values marked `sync: false` in `render.yaml` are currently empty.

### 3.1 Tier 1 — Security (BLOCKING)

| Variable | Value Type | Notes |
|----------|------------|-------|
| `JWT_SECRET` | Random string ≥ 32 chars | **Never reuse dev/staging value.** Generate new 256-bit secret. |
| `SESSION_SECRET` | Random string ≥ 32 chars | **Never reuse dev/staging value.** Generate new 256-bit secret. |
| `ADMIN_USERNAME` | String | Production admin login username |
| `ADMIN_PASSWORD` | Strong password | Production admin login password |

### 3.2 Tier 2 — Payments (BLOCKING if paid features enabled)

| Variable | Value Type | Notes |
|----------|------------|-------|
| `STRIPE_SECRET_KEY` | `sk_live_*` | **CEO approval required.** Replace `sk_test_*` from dev. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_*` | Create endpoint `https://rekrutai.co/api/billing/webhook` in Stripe dashboard first. |
| `STRIPE_PUBLISHABLE_KEY` (client) | `pk_live_*` | Embedded in client build; must match live secret key. |

### 3.3 Tier 3 — AI Provider Keys (Required for core features)

| Variable | Value Type | Notes |
|----------|------------|-------|
| `POLSIA_API_KEY` | API key | Primary AI proxy |
| `POLSIA_API_URL` | URL | Default: `https://polsia.com/api/proxy/ai` |
| `OPENAI_API_KEY` | API key | Fallback 1 |
| `OPENAI_BASE_URL` | URL | Optional custom base URL |
| `NVIDIA_NIM_API_KEY` | API key | Fallback 2 |
| `NIM_BASE_URL` | URL | Default: `https://integrate.api.nvidia.com/v1` |
| `GROQ_API_KEY` | API key | Fallback 3 (fast inference) |
| `CEREBRAS_API_KEY` | API key | Fallback 4 (enterprise) |
| `DEEPGRAM_API_KEY` | API key | Required for TTS/STT features |

### 3.4 Tier 4 — Model Configuration (Required for AI routing)

| Variable | Notes |
|----------|-------|
| `NIM_LLM_MODEL` | Primary LLM model slug |
| `NIM_LLM_LLAMA_8B` | Lightweight model slug |
| `NIM_LLM_LLAMA_70B` | Heavy model slug |
| `NIM_LLM_GEMMA` | Gemma model slug |
| `NIM_LLM_GPT_OSS` | GPT-OSS model slug |
| `NIM_LLM_NANO_30B` | Nano 30B model slug |
| `NIM_LLM_STEP_FLASH` | Step Flash model slug |
| `NIM_LLM_ULTRA` | Ultra model slug |
| `NIM_REASONING_QWQ` | Reasoning model slug |
| `NIM_SAFETY_MODEL` | Safety model slug |
| `NIM_SAFETY_REASONING` | Safety reasoning model slug |
| `NIM_VISION_GEMMA` | Vision model slug |
| `NIM_VISION_FALLBACK_MODEL` | Vision fallback slug |
| `NIM_EMBED_MODEL` | Embedding model slug |
| `NIM_EMBED_VL` | Vision-language embedding slug |
| `NIM_DOCUMENT_MODEL` | Document processing model slug |
| `NIM_ASR_MODEL` | ASR model slug |
| `NIM_ASR_V3` | ASR v3 model slug |
| `NIM_TTS_BASE_URL` | TTS service base URL |
| `NIM_FASTPITCH_BASE_URL` | FastPitch base URL |
| `NIM_MAGPIE_ZERO_BASE_URL` | Magpie Zero base URL |
| `NIM_MAGPIE_FLOW_BASE_URL` | Magpie Flow base URL |
| `NIM_MAGPIE_MULTI_BASE_URL` | Magpie Multi base URL |

### 3.5 Tier 5 — Storage & Email (Required for file uploads & notifications)

| Variable | Notes |
|----------|-------|
| `R2_ACCESS_KEY_ID` | Cloudflare R2 access key |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 secret key |
| `R2_BUCKET_NAME` | Bucket name |
| `R2_ENDPOINT` | S3-compatible endpoint |
| `R2_PUBLIC_URL` | Public CDN URL for assets |
| `EMAIL_HOST` / `SMTP_HOST` | SMTP server host |
| `EMAIL_PORT` / `SMTP_PORT` | SMTP port (e.g. 587) |
| `EMAIL_USER` / `SMTP_USER` | SMTP username |
| `EMAIL_PASS` / `SMTP_PASS` | SMTP password / app password |
| `EMAIL_FROM_ADDRESS` / `SMTP_FROM` | From address |
| `EMAIL_FROM_NAME` | Display name |
| `EMAIL_RATE_LIMIT` | Per-minute rate limit |
| `EMAIL_RATE_LIMIT_HOUR` | Per-hour rate limit |
| `EMAIL_RETRY_ATTEMPTS` | Retry count |
| `EMAIL_RETRY_DELAY` | Retry delay (ms) |
| `SMTP_SECURE` | `true` for TLS on 465 |

### 3.6 Tier 6 — OAuth (Required for social login)

| Variable | Notes |
|----------|-------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Must be `https://rekrutai.co/api/auth/google/callback` |
| `LINKEDIN_CLIENT_ID` | LinkedIn OAuth client ID |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth client secret |
| `LINKEDIN_REDIRECT_URI` | Must be `https://rekrutai.co/api/auth/linkedin/callback` |

### 3.7 Tier 7 — Render-Managed Variables (Already Set)

| Variable | Status |
|----------|--------|
| `DATABASE_URL` | ✅ Auto-managed from `rekrutai-prod-db` |
| `NODE_ENV` | ✅ Set to `production` |
| `PORT` | ✅ Set to `10000` |
| `REKRUT_AI_URL` | ✅ Set to `https://rekrutai.co` |
| `APP_URL` | ✅ Set to `https://rekrutai.co` |
| `FRONTEND_URL` | ✅ Set to `https://rekrutai.co` |
| `BASE_URL` | ✅ Set to `https://rekrutai.co` |
| `CORS_ORIGINS` | ✅ Set to `https://rekrutai.co,https://www.rekrutai.co` |
| `FORCE_SSL_VERIFY` | ✅ Set to `true` |

---

## 4. Database Migration Steps

### 4.1 Migration Overview

- **Migration runner:** `migrate.js` (executed via `npm run migrate`)
- **Tracking table:** `_migrations` (created automatically if missing)
- **Total files:** 47+ `.js` migrations + 1 `.sql` hardening script
- **Render start command:** `npm run migrate && npm start` (migration runs on every start, idempotent)

### 4.2 Pre-Deploy Migration Checklist

- [ ] **Run migrations on staging first** and verify zero errors.
- [ ] **Backup production database** before deploy. Use Render PostgreSQL snapshot or `pg_dump`.
- [ ] **Verify `_migrations` table exists** on production and list currently applied migrations.
- [ ] **Check for new migration files** since last production deploy (compare `migrations/` against prod `_migrations` entries).
- [ ] **Review destructive migrations** — confirm no accidental `DROP TABLE` / `DROP COLUMN` in new migrations.
- [ ] **Test rollback script** for the latest migration (`down` method if implemented; otherwise restore from backup).

### 4.3 Key Recent Migrations to Verify

| Migration | Description | Risk Level |
|-----------|-------------|------------|
| `003b_add_role_column.js` | Adds `role` column | Low |
| `005b_oauth_refresh_tokens.js` | OAuth refresh token schema | Low |
| `047_p2_schema_hardening.js` | timestamptz conversion, varchar→TEXT, CHECK constraints | **Medium** — large schema rewrite |
| `p2_schema_hardening.sql` | Raw SQL companion to 047 | Medium |
| `p3_schema_optimizations.js` | Additional optimizations | Medium |

---

## 5. Deploy Sequence: Staging → Production

### 5.1 Phase 1 — Staging Update (Do First)

1. **Merge `dev` → `staging`** and push.
2. **Manually trigger deploy** from Render Dashboard if autoDeploy does not fire within 2 minutes.
3. **Wait for build to complete** (~3–5 minutes on standard plan).
4. **Verify `/health`** returns `{"status":"ok"}` with current timestamp.
5. **Run E2E suite** against staging and confirm all tests pass.
6. **Verify database migrations** applied cleanly (check `_migrations` table on staging DB).

### 5.2 Phase 2 — Production Pre-Flight

1. **Log into Render Dashboard** → `rekrutai-prod` service.
2. **Confirm `healthCheckPath` is set to `/health`** in service settings. If empty, update before deploy.
3. **Set all Tier 1–6 environment variables** (see Section 3).
4. **Create production database snapshot** (Render → PostgreSQL → `rekrutai-prod-db` → Snapshots).
5. **Verify `main` branch is stable** and includes all staging-tested commits.

### 5.3 Phase 3 — Production Deploy

1. **Merge `staging` → `main`** via PR with required review.
2. **Push `main`** or trigger manual deploy from Render Dashboard.
3. **Monitor build logs** in real time. Watch for:
   - `npm install` success
   - `cd client && npm run build` success
   - `npm run migrate` success (no migration errors)
   - Server start without crash
4. **Wait for Render "Live" status** (~3–5 minutes).
5. **Do not scale traffic** until post-deploy checks pass.

### 5.4 Phase 4 — Post-Deploy Verification

- [ ] **Health check:** `GET https://rekrutai.co/health` → `200` with current timestamp.
- [ ] **Root page:** `GET https://rekrutai.co/` → `200`, HTML loads, no 500 errors.
- [ ] **API smoke tests:**
  - `GET /api/health` → `200`
  - `POST /api/auth/login` (test account) → `200` or expected 401/403
  - `GET /api/jobs` (public) → `200`
- [ ] **Build hash verification:** `curl -s https://rekrutai.co/ | grep -o 'index-[A-Za-z0-9_-]*\.js'` matches expected hash.
- [ ] **Database migration verification:** Query `_migrations` on prod DB; latest migration should be present.
- [ ] **Stripe webhook test:** Send test event from Stripe dashboard to `https://rekrutai.co/api/billing/webhook` → expect `200`.
- [ ] **OAuth redirect test:** Attempt Google login → redirect to `https://rekrutai.co/api/auth/google/callback` without error.
- [ ] **Email send test:** Trigger a notification (e.g., password reset) and verify delivery.
- [ ] **R2 upload test:** Upload a file via UI and confirm public URL resolves.

---

## 6. Post-Deploy Verification (Smoke Tests)

### 6.1 Automated Health Checks

```bash
# Health
curl -s https://rekrutai.co/health | jq .

# API health
curl -s https://rekrutai.co/api/health | jq .

# Build hash
curl -s https://rekrutai.co/ | grep -o 'index-[A-Za-z0-9_-]*\.js'

# Database migration status (requires psql)
psql $DATABASE_URL -c "SELECT name, applied_at FROM _migrations ORDER BY applied_at DESC LIMIT 5;"
```

### 6.2 Manual UI Smoke Tests

| Flow | Steps | Expected Result |
|------|-------|-----------------|
| Landing page | Visit `https://rekrutai.co/` | Loads without 500, no console errors |
| Candidate login | Login with valid credentials | Redirects to dashboard, JWT cookie set |
| Recruiter login | Login with recruiter account | Redirects to recruiter dashboard |
| Job posting | Create a job as recruiter | Job appears in list, no DB errors |
| Application | Apply to a job as candidate | Application submitted, confirmation email sent |
| Mock interview | Start AI interview | Questions load, audio/video permissions work |
| Compliance dashboard | Visit `/admin/compliance` as admin | EU AI Act dashboard renders |

---

## 7. Rollback Plan

### 7.1 Quick Rollback (Same Build, Previous Commit)

If the deploy succeeds but runtime issues appear:

1. **Render Dashboard** → `rekrutai-prod` → **Manual Deploy** → select previous stable commit.
2. **Monitor health check** for `200` response.
3. **Verify build hash** reverts to previous known-good value.

### 7.2 Database Rollback (Migration Failure)

If a migration fails during `startCommand`:

1. **Render Dashboard** → `rekrutai-prod` → **Cancel deploy** (if still in progress).
2. **Restore database from pre-deploy snapshot** (Render → PostgreSQL → Snapshots → Restore).
3. **Fix migration script** in repo, commit to `main`, and redeploy.
4. **Alternative:** If migration has `down()` method, run it manually via `psql` or a custom rollback script.

### 7.3 Full Service Rollback (Critical Failure)

If production is completely broken and quick rollback fails:

1. **Set `rekrutai-prod` to previous commit** via Render Dashboard manual deploy.
2. **Restore database from pre-deploy snapshot** (point-in-time recovery).
3. **Verify DNS** still points to `https://rekrutai.co` (Render handles this).
4. **Communicate status** to team via status page or Slack.
5. **Post-incident:** Review root cause, fix in `dev`, re-test on staging, and retry deploy.

### 7.4 Rollback Verification

- [ ] `/health` returns `200` with fresh timestamp.
- [ ] Root page loads without 500 errors.
- [ ] Database `_migrations` table shows pre-deploy state (if DB was restored).
- [ ] Stripe webhook endpoint still responds correctly (if using previous stable build).
- [ ] No error spikes in Render service logs.

---

## 8. Monitoring & Alerting Setup (Post-Deploy)

- [ ] **External uptime monitor** (e.g., UptimeRobot, Pingdom) for `https://rekrutai.co/health` — check every 60s.
- [ ] **Render deploy notifications** → Slack/Email for `update_failed` / `build_failed` events.
- [ ] **Commit drift alert** — alert if deployed commit diverges from `main` HEAD by > 5 commits or > 30 minutes.
- [ ] **Build hash tracking** — after each deploy, verify deployed JS hash matches expected artifact.
- [ ] **Log aggregation** — configure Render log streams to external system (Datadog, Papertrail, etc.) if on paid plan.

---

## 9. Go/No-Go Decision Matrix

| Criteria | Required Status | Current Status | Verdict |
|----------|-----------------|---------------|---------|
| Staging == `origin/staging` HEAD | ✅ Yes | ❌ No (18 behind) | **NO-GO** |
| Staging autoDeploy functional | ✅ Yes | ❌ No (stalled) | **NO-GO** |
| All staging health checks green | ✅ Yes | ✅ Yes | GO |
| E2E tests pass on staging | ✅ Yes | ⚠️ Unknown | **NO-GO** |
| Production build failures resolved | ✅ Yes | ❌ No (7 in 24h) | **NO-GO** |
| Production `healthCheckPath` set | ✅ Yes | ❌ No | **NO-GO** |
| Production secrets (Tier 1–6) set | ✅ Yes | ❌ No | **NO-GO** |
| Database migrations tested on staging | ✅ Yes | ⚠️ Unknown | **NO-GO** |
| Rollback plan verified | ✅ Yes | ⚠️ Unknown | **NO-GO** |

**Overall Decision:** 🔴 **NO-GO** — Do not deploy to production.

---

## 10. Immediate Action Items (Priority Order)

1. **Fix staging autoDeploy** — manually deploy `origin/staging` (`95bbfa7`) and verify webhook/GitHub integration.
2. **Set production `healthCheckPath`** to `/health` in Render Dashboard.
3. **Investigate production build failures** — download logs from 7 failed deploys and identify root cause (likely migration or missing env var).
4. **Reconcile `main` and `dev` branches** — merge critical fixes from `dev` into `main` via PR.
5. **Set all production environment variables** (Tier 1–6) before next deploy attempt.
6. **Run E2E tests on freshly updated staging** and confirm all pass.
7. **Test database migrations on staging** — verify `047_p2_schema_hardening.js` and `p3_schema_optimizations.js` run cleanly.
8. **Create pre-deploy database snapshot** before the next production deploy.
9. **Verify rollback procedure** by rolling back staging to a previous commit.
10. **Enable branch protection on `main`** — require PR reviews and CI checks.

---

## Appendix A: Render Dashboard Links

| Service | Dashboard URL |
|---------|----------------|
| Production | `https://dashboard.render.com/web/srv-d69opaer433s73d6p570` |
| Staging | `https://dashboard.render.com/web/srv-d8j6js3bc2fs73bf4rmg` |
| Dev | `https://dashboard.render.com/web/srv-d8h1ipuk1jcs739ck9eg` |
| Prod DB | `https://dashboard.render.com/databases/rekrutai-prod-db` |

## Appendix B: Build Hash Verification Commands

```bash
# Local expected hash
grep -o 'index-[A-Za-z0-9_-]*\.js' client/dist/index.html

# Staging deployed hash
curl -s https://rekrutai-staging.onrender.com/ | grep -o 'index-[A-Za-z0-9_-]*\.js'

# Production deployed hash
curl -s https://rekrutai.co/ | grep -o 'index-[A-Za-z0-9_-]*\.js'
```

## Appendix C: Migration Count & Names

Total `.js` migration files: **47** (numbered 001–047, plus `1739617200000_p1_interview_flow_schema.js` and helper SQL files).

Key migrations to audit before deploy:
- `003b_add_role_column.js`
- `005b_oauth_refresh_tokens.js`
- `047_p2_schema_hardening.js`
- `p2_schema_hardening.sql`
- `p3_schema_optimizations.js`
- `seed_notification_templates.js`

---

*Checklist version 2.0 — Rekrut AI DevOps Automator*  
*Last updated: 2026-06-09*
