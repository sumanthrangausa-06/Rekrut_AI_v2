# Rekrut AI — Staging → Production Deployment Runbook & Readiness Report

> **Prepared by:** DevOps Automator (Subagent)  
> **Date:** 2026-06-08 20:55 GMT+8  
> **Task:** Prepare deployment checklist, verify readiness, identify blockers. **DO NOT DEPLOY.**  
> **Scope:** Render services (`rekrutai-dev`, `rekrutai-staging`, `rekrutai-prod`), Git repo `main` branch, production database  

---

## 🚨 Executive Summary

| Item | Status | Detail |
|------|--------|--------|
| **Production Service** | `rekrutai-prod` | **Running outdated code** — 143 commits behind `main` |
| **Production Security** | ⚠️ **VULNERABLE** | Missing helmet, `x-powered-by: Express` leaked, old CSP |
| **Staging Service** | ✅ **Healthy** | `rekrutai-staging` is UP (was down earlier today, now fixed) |
| **Dev Service** | ✅ **Healthy** | `rekrutai-dev` running latest code, `/api/health` works |
| **Build** | ✅ **Passes** | Client build 16.65s, 0 vulnerabilities |
| **Migrations** | 🟡 **Ready** | 54 JS + 2 SQL + 1 seed file; need to verify prod DB state |
| **CI/CD** | ✅ **Configured** | `.github/workflows/ci.yml` + `deploy.yml` present on `main` |
| **Ready to Deploy?** | 🔴 **NO-GO** | Multiple critical blockers remain (see §7) |

---

## 1. Live Service Health Checks (Verified at 20:55 GMT+8)

### 1.1 Endpoint Verification

| Service | URL | `/health` | `/api/health` | Homepage | Status |
|---------|-----|-----------|---------------|----------|--------|
| `rekrutai-dev` | `https://rekrutai-dev.onrender.com` | ✅ 200 | ✅ 200 | ✅ 200 | **Healthy** |
| `rekrutai-staging` | `https://rekrutai-staging.onrender.com` | ✅ 200 | ✅ 200 | ✅ 200 | **Healthy (fixed)** |
| `rekrutai-prod` | `https://rekrutai.co` | ✅ 200 | ❌ 404 `{"error":"API endpoint not found"}` | ✅ 200 | **OUTDATED** |

### 1.2 Security Header Comparison

| Header | Dev (Expected) | Staging | Production (Actual) | Status |
|--------|----------------|---------|---------------------|--------|
| `x-powered-by` | **ABSENT** | ABSENT | `Express` | 🔴 **OLD CODE** |
| `permissions-policy` | `camera=(self), microphone=(self)` | `camera=(self), microphone=(self)` | `camera=*, microphone=*` | 🔴 **OLD CODE** |
| `content-security-policy` | Present (helmet) | Present | MISSING | 🔴 **OLD CODE** |
| `strict-transport-security` | Present | Present | MISSING | 🔴 **OLD CODE** |
| `x-frame-options` | `SAMEORIGIN` | `SAMEORIGIN` | MISSING | 🔴 **OLD CODE** |
| `x-content-type-options` | `nosniff` | `nosniff` | MISSING | 🔴 **OLD CODE** |

**Conclusion:** Production is running code from **May 16** (`fb1fdb3`), missing 143 commits of security fixes, mobile responsive improvements, Stripe integration, E2E tests, and the production CI/CD pipeline.

---

## 2. Git Repository Status

### 2.1 Branch Commit Status

| Branch | Latest Commit | Relative to `main` | Notes |
|--------|---------------|--------------------|-------|
| `main` (local) | `7f56e99` | Baseline | **1 commit ahead of `origin/main`** — not yet pushed |
| `origin/main` | `4037eac` | 1 commit behind local | Missing `7f56e99` (security fix) |
| `staging` (local) | `69b75ef` | 1 commit **behind** origin/staging | Has 23 uncommitted files — **dirty working tree** |
| `dev` (local) | `949e606` | 1 commit ahead of `dev`/`staging` | Ahead of staging, uncommitted changes likely |

### 2.2 Critical Commits in `main` NOT Deployed to Production

| Commit | Date | Description | Risk if Not Deployed |
|--------|------|-------------|---------------------|
| `7f56e99` | 2026-06-08 | Remove `.admin-credentials` plaintext file, enforce env-only admin auth | **CRITICAL** — plaintext password on disk |
| `4037eac` | 2026-06-08 | Merge dev into main: activate production CI/CD pipeline with `autoDeploy: false` | **HIGH** — no automated deployment gates |
| `0c4adc7` | 2026-06-08 | E2E test suite, AI coaching flow, pre-deploy status doc | **MEDIUM** — no automated regression testing |
| `b4ce01f` | 2026-06-07 | Remove dev URL from production CSP `connectSrc` | **HIGH** — CSP allows dev domain connections |
| `9fc103a` | 2026-06-07 | Mobile responsive fixes, E2E expansion, deployment docs | **MEDIUM** — mobile UX broken on prod |
| `ffd5869` | 2026-06-06 | CI/CD pipeline gates, disable prod `autoDeploy` | **HIGH** — no build/security gates on deploy |
| earlier... | 2026-05-16 to 06-06 | Helmet middleware, disable `x-powered-by`, security audit fixes | **CRITICAL** — exposed framework, missing security headers |

### 2.3 Uncommitted Changes on `staging` (23 files)

**Key files modified:**
- `client/dist/assets/index-*.js` — rebuild artifacts (expected after build)
- `client/dist/index.html` — rebuild artifact
- `client/src/components/ui/sheet.tsx` — mobile UI fix
- `client/src/pages/recruiter/jobs.tsx` — recruiter UI fix
- `e2e/*.spec.ts` — multiple E2E test files (debug/test improvements)
- `playwright.config.ts` — CI `--no-sandbox` flag (critical for CI stability)
- `routes/candidate.js` — candidate route modifications
- Untracked: `e2e/BUG_REPORT.md`, `e2e/E2E_TEST_RESULTS.md`, debug specs, `run-e2e-perfile.sh`

**Impact:** These uncommitted changes on `staging` mean the staging environment may not match the committed `staging` branch exactly. The `playwright.config.ts` CI fix is particularly important and should be committed to `main` before deploying.

---

## 3. Build & CI/CD Verification

### 3.1 Local Build Test

| Check | Result |
|-------|--------|
| Client `npm install` | ✅ 143 packages, 0 vulnerabilities |
| Client `npm run build` | ✅ 16.65s, dist generated |
| Server `node -c server.js` | ✅ Syntax valid |
| All 23 route files | ✅ Syntax valid |
| `render.yaml` buildCommand | ✅ `cd client && npm install --include=dev && npm run build && cd .. && npm install` |

### 3.2 CI/CD Pipeline Status

| Workflow | File | Status | Notes |
|----------|------|--------|-------|
| CI | `.github/workflows/ci.yml` | ✅ Present | Build, audit, E2E tests, health check |
| Deploy | `.github/workflows/deploy.yml` | ✅ Present | Manual dispatch with `deploy-to-prod` confirmation, health check polling |

**CI Pipeline stages:**
1. `build` — `npm ci` + client build
2. `audit` — `npm audit --audit-level high`
3. `e2e-tests` — Playwright sequential per-file runner (avoids SIGKILL)
4. `health-check` — Verifies `rekrutai-dev.onrender.com/health`

**Deploy Pipeline stages:**
1. `verify` — Confirms `deploy-to-prod` input + `main` branch
2. `ci-gate` — Re-runs CI workflow
3. `deploy` — Manual Render dashboard trigger instructions + post-deploy health check

---

## 4. Database Migration Readiness

### 4.1 Migration Inventory

| Type | Count | Status |
|------|-------|--------|
| JavaScript migrations | 54 | ✅ Present |
| SQL migrations | 2 | ✅ Present (`045_fix_company_id_fk_constraints.sql`, `p2_schema_hardening.sql`) |
| Seed scripts | 1 | ✅ Present (`seed_notification_templates.js`) |
| **Total** | **57** | |

### 4.2 Migration Runner Analysis

- Custom `migrate.js` runner tracks applied migrations in `_migrations` table
- Only `.js` files are tracked by the runner
- SQL files are **NOT automatically applied** by `migrate.js`
- `p2_schema_hardening.js` wrapper exists to apply `p2_schema_hardening.sql`
- `045_fix_company_id_fk_constraints.sql` — verify if applied manually on prod

### 4.3 Production Database Unknowns

| Check | Status | Evidence / Action Needed |
|-------|--------|--------------------------|
| Migration table exists | 🟡 Unknown | Cannot verify without DB access |
| All 54 JS migrations applied | 🟡 Unknown | Run `node migrate.js` on prod to verify |
| `pgvector` extension installed | 🟡 Unknown | `CREATE EXTENSION IF NOT EXISTS vector;` |
| Seed notification templates run | 🟡 Unknown | Run `node migrations/seed_notification_templates.js` |
| `045_fix_company_id_fk_constraints.sql` applied | 🟡 Unknown | May need manual execution |
| Pre-deploy snapshot taken | 🔴 **NO** | **BLOCKER** — must snapshot before any deploy |

---

## 5. Environment Variables — Production Readiness

### 5.1 `render.yaml` Configuration for Production

| Variable | Source | Status | Notes |
|----------|--------|--------|-------|
| `NODE_ENV` | `value: production` | ✅ Auto-set | |
| `PORT` | `value: 10000` | ✅ Auto-set | |
| `DATABASE_URL` | `fromDatabase: rekrutai-prod-db` | ✅ Auto-set | |
| `REKRUT_AI_URL` | `value: https://rekrutai.co` | ✅ Auto-set | |
| `APP_URL` | `value: https://rekrutai.co` | ✅ Auto-set | |
| `FRONTEND_URL` | `value: https://rekrutai.co` | ✅ Auto-set | |
| `BASE_URL` | `value: https://rekrutai.co` | ✅ Auto-set | |
| `CORS_ORIGINS` | `value: https://rekrutai.co,https://www.rekrutai.co` | ✅ Auto-set | |
| `FORCE_SSL_VERIFY` | `value: true` | ✅ Auto-set | |

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
| **T6** | `R2_*` (4 vars) | Optional | Document storage fails | Ranga |
| **T6** | ~20 NIM model-specific vars | Optional | Fine-grained AI model routing | Ranga |

**Total `sync: false` variables:** **50+**

### 5.3 External Configuration Needed (Outside Render)

| Service | Action | Owner | Why |
|---------|--------|-------|-----|
| Stripe Dashboard | Create live webhook endpoint → `https://rekrutai.co/api/billing/webhook` | Ranga | Webhook validation requires live secret |
| Google Cloud Console | Add `https://rekrutai.co` to OAuth redirect URIs | Ranga | OAuth login will fail with redirect mismatch |
| LinkedIn Developer Portal | Add `https://rekrutai.co` to OAuth redirect URIs | Ranga | OAuth login will fail with redirect mismatch |
| Cloudflare DNS | Verify `rekrutai.co` and `www.rekrutai.co` point to Render | Ranga | DNS misconfiguration = downtime |

---

## 6. Deployment Execution Plan (Runbook)

### 6.1 Phase 0: Pre-Deploy (Complete ALL before proceeding)

| # | Step | Owner | Details | Status |
|---|------|-------|---------|--------|
| P0.1 | Push local `main` to `origin` | DevOps | `git push origin main` to include `7f56e99` | 🔴 **TODO** |
| P0.2 | Clean up `staging` uncommitted changes | DevOps | Commit or stash 23 modified files; commit `playwright.config.ts` CI fix to `main` | 🔴 **TODO** |
| P0.3 | Run full E2E suite on latest `main` | QA | `npx playwright test` on `7f56e99` | 🔴 **TODO** |
| P0.4 | Take production DB snapshot | DevOps | Render Dashboard → `rekrutai-prod-db` → Snapshots → Manual Snapshot | 🔴 **TODO** |
| P0.5 | Set all T1/T2 `sync: false` secrets in Render Dashboard | Ranga + DevOps | `JWT_SECRET`, `SESSION_SECRET`, `ADMIN_*`, `STRIPE_*` | 🔴 **TODO** |
| P0.6 | Configure Stripe live webhook | Ranga | Stripe Dashboard → Webhooks → `https://rekrutai.co/api/billing/webhook` | 🔴 **TODO** |
| P0.7 | Update OAuth redirect URIs | Ranga | Google Cloud + LinkedIn Developer portals | 🔴 **TODO** |
| P0.8 | Ranga Go/No-Go approval | Ranga | CEO sign-off required before any deploy | 🔴 **TODO** |

### 6.2 Phase 1: Deploy Day

| # | Step | Command / Action | ETA | Owner |
|---|------|------------------|-----|-------|
| 1.1 | Verify `main` is clean | `git status` on `main` should show no uncommitted changes | 1 min | DevOps |
| 1.2 | Trigger manual deploy via Render Dashboard | `rekrutai-prod` → "Manual Deploy" → "Deploy latest commit" | 1 min | DevOps |
| 1.3 | Monitor build logs | Render Dashboard → `rekrutai-prod` → Logs | 3–5 min | DevOps |
| 1.4 | Wait for `/health` | `curl -s https://rekrutai.co/health` | 1–2 min | DevOps |
| 1.5 | Verify `/api/health` | `curl -s https://rekrutai.co/api/health` should return 200 | 1 min | DevOps |
| 1.6 | Verify security headers | `curl -I https://rekrutai.co/` — `x-powered-by` must be ABSENT | 1 min | DevOps |
| 1.7 | Run post-deploy smoke tests | See §8 | 15 min | QA + DevOps |
| 1.8 | Run production DB migrations | Render Shell → `node migrate.js` | 2 min | DevOps |
| 1.9 | Seed notification templates | Render Shell → `node migrations/seed_notification_templates.js` | 1 min | DevOps |
| 1.10 | Verify `pgvector` extension | `CREATE EXTENSION IF NOT EXISTS vector;` | 1 min | DevOps |

### 6.3 Build Timeline Estimate

| Phase | Duration | Notes |
|-------|----------|-------|
| Git push (if needed) | 30s | |
| Render trigger → build start | 30s | Manual trigger required (`autoDeploy: false`) |
| Build phase | 3–5 min | Client build + server install |
| Deploy + health check | 1–2 min | `/health` must return 200 |
| **Total deploy time** | **~5–8 min** | |
| Post-deploy smoke tests | 15 min | Critical path verification |
| DB migrations + seed | 3–5 min | If needed |
| **Total Phase 1 time** | **~25–30 min** | |

---

## 7. Critical Blockers (Path to GO)

| # | Blocker | Severity | Owner | Impact | Resolution |
|---|---------|----------|-------|--------|------------|
| **B1** | **Production running 143 commits behind** | 🔴 **CRITICAL** | DevOps | Security vulnerabilities exposed, missing features | Push `main` + trigger manual deploy |
| **B2** | **Production DB snapshot not taken** | 🔴 **CRITICAL** | DevOps | No safe rollback if data corruption | Take snapshot in Render Dashboard before deploy |
| **B3** | **Stripe live keys not configured** | 🔴 **CRITICAL** | Ranga | **Zero revenue capability** — no real payments | Ranga to set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` in Render Dashboard + create live webhook endpoint |
| **B4** | **Production secrets (50+ `sync: false`) not verified** | 🔴 **CRITICAL** | Ranga + DevOps | Auth, AI, OAuth, email, storage may all fail | Systematically verify and set each secret in Render Dashboard for `rekrutai-prod` |
| **B5** | **E2E tests not confirmed on latest `main`** | 🟡 **HIGH** | QA | Risk of broken critical flows in production | Run `npx playwright test` on `7f56e99` before deploy |
| **B6** | **Uncommitted changes on `staging` branch** | 🟡 **HIGH** | DevOps | Staging environment may not match committed code | Commit or stash all changes; merge `playwright.config.ts` CI fix to `main` |
| **B7** | **OAuth redirect URIs not updated** | 🟡 **HIGH** | Ranga | Google/LinkedIn login will fail with redirect mismatch | Update Google Cloud Console and LinkedIn Developer Portal |
| **B8** | **Database migration status unknown on prod** | 🟡 **HIGH** | DevOps | Schema may be out of date | Run `node migrate.js` after deploy; verify with SQL queries |
| **B9** | **Local `main` commit `7f56e99` not pushed to `origin`** | 🟡 **HIGH** | DevOps | `.admin-credentials` security fix not in remote | `git push origin main` |

### 7.1 Blocker Resolution Path

```
┌─────────────────────────────────────────────────────────────────────┐
│  PATH TO GO                                                         │
├─────────────────────────────────────────────────────────────────────┤
│  Step 1: Push local main (7f56e99) to origin          [5 min]      │
│  Step 2: Commit staging clean-up (playwright.config.ts) [15 min]   │
│  Step 3: Run E2E tests on latest main                   [2–4 hrs]    │
│  Step 4: Ranga sets all T1/T2 secrets in Render        [1–2 hrs]  │
│  Step 5: Ranga configures Stripe live webhook          [30 min]   │
│  Step 6: Ranga updates OAuth redirect URIs               [30 min]   │
│  Step 7: Take production DB snapshot                     [15 min]  │
│  Step 8: Ranga Go/No-Go approval                         [15 min]  │
│  Step 9: Execute manual deploy to production             [5–8 min]  │
│  Step 10: Run post-deploy smoke tests + DB migrations   [20 min] │
├─────────────────────────────────────────────────────────────────────┤
│  TOTAL TIME TO GO: ~1–2 days (mostly dependent on Ranga secrets)   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8. Post-Deploy Smoke Tests (Execute in Order)

### 8.1 Health & Availability (First 5 Minutes)

| # | Test | Expected Result | Command |
|---|------|-----------------|---------|
| 8.1.1 | Root health | `{"status":"ok"}` | `curl -s https://rekrutai.co/health` |
| 8.1.2 | API health | `{"status":"ok"}` | `curl -s https://rekrutai.co/api/health` |
| 8.1.3 | Homepage | 200 OK, hero visible | `curl -s https://rekrutai.co/` |
| 8.1.4 | Login page | 200 OK, form visible | `curl -s https://rekrutai.co/login` |
| 8.1.5 | Jobs API | Returns job data | `curl -s https://rekrutai.co/api/jobs?limit=1` |

### 8.2 Security Headers (Critical — Must Pass)

| # | Test | Expected | Command |
|---|------|----------|---------|
| 8.2.1 | `x-powered-by` | **ABSENT** | `curl -I https://rekrutai.co/health \| grep -i x-powered-by` (should be empty) |
| 8.2.2 | `permissions-policy` | `camera=(self), microphone=(self)` | `curl -I https://rekrutai.co/health \| grep -i permissions-policy` |
| 8.2.3 | `content-security-policy` | Present | `curl -I https://rekrutai.co/ \| grep -i content-security-policy` |
| 8.2.4 | `strict-transport-security` | Present, max-age=31536000 | `curl -I https://rekrutai.co/ \| grep -i strict-transport-security` |
| 8.2.5 | `x-frame-options` | `SAMEORIGIN` | `curl -I https://rekrutai.co/ \| grep -i x-frame-options` |
| 8.2.6 | `x-content-type-options` | `nosniff` | `curl -I https://rekrutai.co/ \| grep -i x-content-type-options` |

### 8.3 Functional Smoke Tests (Within 15 Minutes)

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 8.3.1 | Homepage | Load `/`, check hero, features, pricing | All sections visible, no console errors |
| 8.3.2 | Login flow | Test credentials → login → dashboard | Login succeeds, redirects correctly |
| 8.3.3 | Candidate jobs | Navigate to `/candidate/jobs` | Job listings load, search/filter work |
| 8.3.4 | Recruiter dashboard | `/recruiter/dashboard` | Dashboard loads, analytics visible |
| 8.3.5 | Dark mode toggle | Click toggle on any page | Theme switches, persists on reload |
| 8.3.6 | Mobile responsive | Emulate iPhone 14 in DevTools | Layout adapts, no horizontal scroll |
| 8.3.7 | Stripe pricing | Load `/pricing` | Free / Pro / Enterprise tiers visible |
| 8.3.8 | Admin panel | Login with admin credentials | Admin dashboard accessible |
| 8.3.9 | AI coaching (if Polsia key set) | Start mock interview | AI response generated |

---

## 9. Rollback Plan

### 9.1 Fast Rollback: Render Dashboard (1–2 minutes)

1. Go to Render Dashboard → `rekrutai-prod` → "Manual Deploy" → "Deploy a specific commit"
2. Select commit `fb1fdb3` (last known good production commit from May 16)
3. Wait for health check to pass
4. Verify `curl -s https://rekrutai.co/health` returns `{"status":"ok"}`

### 9.2 Database Rollback (if data corruption)

1. Render Dashboard → `rekrutai-prod-db` → Snapshots
2. Select pre-deploy snapshot (taken in Phase 0)
3. Click Restore
4. Wait for restore (5–10 minutes)
5. Restart `rekrutai-prod` service

### 9.3 Rollback Triggers

| Condition | Action | ETA |
|-----------|--------|-----|
| `/health` returns non-200 for > 2 minutes | Immediate Render dashboard rollback | 1–2 min |
| 50%+ of smoke tests fail | Git revert + investigate | 2–5 min |
| Database errors in logs | DB snapshot restore + code revert | 10–15 min |
| Stripe payment failures | Disable Stripe webhooks + investigate | 5–10 min |

---

## 10. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Production running outdated, vulnerable code | **Confirmed** | **Critical** | Deploy latest `main` immediately after blockers resolved |
| 143-commit deploy introduces regression | Possible | High | Full E2E suite on `main` before deploy; DB snapshot for rollback |
| Production secrets incomplete | Unknown | **Critical** | Systematic verification checklist with Ranga |
| Stripe revenue not functional | **Confirmed** (keys missing) | **Critical** | Ranga to set live keys + webhook before go-live |
| Database migration failure on prod | Unknown | High | Snapshot before deploy; test migrations on staging first |
| Staging dirty working tree causes confusion | Confirmed | Medium | Clean up staging before next release cycle |
| OAuth login failures after deploy | Unknown | Medium | Update redirect URIs before deploy; test login flows |

---

## 11. Go / No-Go Verdict

### 🔴 VERDICT: NO-GO

**The following must be resolved before any production deployment:**

1. **Push `7f56e99` to `origin/main`** — Security fix for plaintext `.admin-credentials` must be in remote before deploy.
2. **Clean up `staging` branch** — 23 uncommitted files need resolution; `playwright.config.ts` CI fix must be committed to `main`.
3. **Run E2E tests on latest `main`** — Confirm no critical flow regressions before deploy.
4. **Ranga sets all production secrets** — 50+ `sync: false` variables, especially `JWT_SECRET`, `SESSION_SECRET`, `ADMIN_*`, `STRIPE_*`.
5. **Stripe live configuration** — Live keys + webhook endpoint `https://rekrutai.co/api/billing/webhook`.
6. **Take production DB snapshot** — Non-negotiable safety net.
7. **Update OAuth redirect URIs** — Google Cloud Console + LinkedIn Developer Portal.
8. **Ranga Go/No-Go approval** — CEO sign-off.

### Estimated Time to GO: **1–2 days** (primarily dependent on Ranga completing secret configuration and Stripe setup)

---

## 12. Appendix: Useful Commands

```bash
# Check production health and security headers
curl -s https://rekrutai.co/health | jq .
curl -I https://rekrutai.co/health

# Check staging and dev
curl -s https://rekrutai-staging.onrender.com/health | jq .
curl -s https://rekrutai-dev.onrender.com/health | jq .

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
```

---

## 13. Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-06-08 14:46 | v0.9 | DevOps Automator | Initial readiness assessment |
| 2026-06-08 20:55 | v1.0 | DevOps Automator | **Fresh audit:** staging now healthy, 143 commits behind confirmed, security header verification, build test passed, uncommitted staging files identified, local main commit `7f56e99` not yet pushed, runbook created |

---

*This runbook is a living document. Update it as blockers are resolved and new issues are discovered.*
