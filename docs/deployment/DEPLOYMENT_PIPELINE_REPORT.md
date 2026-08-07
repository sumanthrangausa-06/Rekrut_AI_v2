# Rekrut AI — Deployment Pipeline & Environment Audit Report

**Generated:** 2026-06-08 by Infrastructure Maintainer Agent
**Repo:** `/root/.openclaw/workspace/Rekrut_AI_v2`
**Prod:** `https://rekrutai.co`
**Dev:** `https://rekrutai-dev.onrender.com`
**Staging:** `https://rekrutai-staging.onrender.com`

---

## 1. Environment Architecture Overview

### 1.1 Render Services (from `render.yaml`)

| Service | Type | Branch | URL | Plan | Auto-Deploy | DB |
|---|---|---|---|---|---|---|
| `rekrutai-prod` | Web | `main` | `https://rekrutai.co` | `standard` | ✅ Yes | `rekrutai-prod-db` (PostgreSQL) |
| `rekrutai-staging` | Web | `staging` | `https://rekrutai-staging.onrender.com` | *unspecified* (default/free) | ✅ Yes | `rekrutai-staging-db` (PostgreSQL) |
| `rekrutai-dev` | Web | `dev` | `https://rekrutai-dev.onrender.com` | *unspecified* (default/free) | ✅ Yes | `rekrutai-dev-db` (PostgreSQL) |

All three environments run **Node.js** with the same build/start commands:
```bash
buildCommand: cd client && npm install --include=dev && npm run build && cd .. && npm install
startCommand: npm start   # node server.js
```

### 1.2 Database Architecture

- **Each environment has its own isolated Render PostgreSQL database.** No database sharing between environments.
- **Prod DB:** `rekrutai-prod-db` (plan: `standard`)
- **Staging DB:** `rekrutai-staging-db` (plan: `starter`)
- **Dev DB:** `rekrutai-dev-db` (plan: `starter`)
- **Local dev** uses a **Neon** PostgreSQL instance (`DATABASE_URL` in `.env` points to Neon).
- SSL is enforced in production (`rejectUnauthorized: true` in `lib/db.js`).

### 1.3 Environment Variable Strategy

| File | Exists | Notes |
|---|---|---|
| `.env` | ✅ Yes | Local development (Neon DB, test Stripe keys, dev secrets) |
| `.env.example` | ✅ Yes | Template for developers |
| `.env.development` | ❌ No | Missing |
| `.env.staging` | ❌ No | Missing |
| `.env.production` | ❌ No | Missing |

**All production/staging secrets are managed via the Render Dashboard** (not committed to git). `render.yaml` uses `sync: false` for sensitive keys and `generateValue: true` for JWT/SESSION secrets on staging/dev.

**Risk:** `JWT_SECRET` and `SESSION_SECRET` are auto-generated on staging/dev but manually synced on prod. If these ever get out of sync during rotation, sessions will break across deploys.

### 1.4 `server.js` Environment-Specific Behavior

| Config | Dev | Staging | Prod |
|---|---|---|---|
| `PORT` | 10000 (Render) / 3000 (local) | 10000 | 10000 |
| `NODE_ENV` | `development` | `staging` | `production` |
| CORS Origins | `localhost:*`, `rekrutai-dev.onrender.com` | `rekrutai-staging.onrender.com` | `rekrutai.co`, `www.rekrutai.co` |
| Session `secure` cookie | `false` | `false` | `true` |
| `FORCE_SSL_VERIFY` | `false` | `true` | `true` |
| Helmet CSP | Same config | Same config | Same config |

**Note:** Staging cookies are **not** marked `secure` (same as dev). This is correct for `.onrender.com` HTTP testing, but means staging does not fully mirror prod's security posture.

---

## 2. Branch → Environment Mapping

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  dev        │────▶│  staging    │────▶│  main       │
│  branch     │     │  branch     │     │  (prod)     │
└─────────────┘     └─────────────┘     └─────────────┘
       │                    │                    │
       ▼                    ▼                    ▼
rekrutai-dev          rekrutai-staging       rekrutai.co
.onrender.com         .onrender.com          (custom domain)
```

| Branch | Environment | Deploy URL | Auto-Deploy |
|---|---|---|---|
| `dev` | Development | `https://rekrutai-dev.onrender.com` | ✅ On every push |
| `staging` | Staging | `https://rekrutai-staging.onrender.com` | ✅ On every push |
| `main` | Production | `https://rekrutai.co` | ✅ On every push |

**Git Remotes:** `origin` → `https://github.com/sumanthrangausa-06/Rekrut_AI_v2.git`

---

## 3. Deployment Process

### 3.1 Current Flow (No CI/CD Automation)

1. **Developer pushes** to `dev` → Render auto-deploys to `rekrutai-dev.onrender.com`
2. **Developer merges** `dev` → `staging` (via PR or direct push) → Render auto-deploys to staging
3. **CTO (Suga) manually creates** a PR `staging` → `main` → Merge → Render auto-deploys to production

**There is zero GitHub Actions / CI/CD pipeline.** No `.github/workflows/` directory exists.

### 3.2 Manual Deployment Runbook

A `docs/deployment-runbook.md` exists with a formal RACI matrix:
- **Pre-deploy checks:** Staging validation, smoke tests, migration idempotency review
- **Staging validation:** Manual smoke tests (login, dashboard, AI health check)
- **PR creation:** `staging` → `main` with checklist
- **Merge & deploy:** Manual merge → Render auto-deploy
- **Post-deploy verification:** 15-20 min manual verification window
- **Rollback:** `git revert` or `git reset --hard` + force push

### 3.3 Migration Process

- **Migrations are NOT automatic on deploy.**
- `package.json` defines `"migrate": "node migrate.js"` but this is **not** part of `start` or `build`.
- `migrate.js` runs idempotent migrations using a `_migrations` tracking table.
- **Production deployments require a manual `npm run migrate` step after deploy** (or it must be run via Render shell/console).
- **Risk:** If a developer forgets to run migrations after a prod deploy, the app will fail with "relation does not exist" errors.

---

## 4. Testing & Quality Gates

### 4.1 E2E Tests (Playwright)

- **Framework:** Playwright with 13 spec files in `e2e/`
- **Config:** `playwright.config.ts` — targets `http://localhost:3000`, runs server automatically
- **Current Status:**
  - `dark-mode.spec.ts` fails intermittently due to **SIGKILL / browser resource exhaustion**
  - Overall pass rate: **85.7%** (6/7 spec files pass)
  - **Verdict:** 🔴 **NO-GO for production** per `verification-summary.md` (blocker B4)

### 4.2 Unit / Integration Tests

- **No unit test framework** is configured (no Jest, Vitest, Mocha).
- `npm test` runs `npx playwright test` — only E2E.

### 4.3 CI/CD Test Execution

- **Tests are NOT run in CI.** No GitHub Actions, no pre-deploy hooks.
- A broken E2E test will **not** block a deployment.
- A failing migration will **not** be caught before production deploy.

---

## 5. Gaps & Risks Assessment

### 🔴 Critical Risks

| # | Risk | Impact | Likelihood |
|---|---|---|---|
| 1 | **No CI/CD pipeline** — pushes to `main` auto-deploy immediately with zero automated gates | Broken code can reach production | **High** |
| 2 | **Migrations are manual** — `migrate.js` is not invoked during deploy | Production app crashes after schema-changing deploys | **High** |
| 3 | **E2E tests fail intermittently** (`dark-mode.spec.ts` SIGKILL) — and are not run automatically | Quality signal is noisy; untrustworthy gate even if added | **Medium** |
| 4 | **Staging auto-deploys on every push** — any push to `staging` triggers deploy | Unstable staging environment, unreliable pre-prod validation | **Medium** |
| 5 | **No branch protection** — Cannot verify from repo, but with no CI there is likely no enforced PR requirement for `main` | Direct pushes to production branch possible | **Medium** |
| 6 | **Single instance per environment** (`numInstances: 1`) — zero redundancy | Production downtime during deploys or crashes | **Medium** |
| 7 | **Secrets in `.env` committed?** — `.env` is in `.gitignore`, but `.env` file exists in repo working tree. Need to verify it was never committed historically. | Stripe test keys, Neon credentials could be in git history | **Medium** |

### 🟡 Moderate Risks

| # | Risk | Impact |
|---|---|---|
| 8 | **No `health` check integration in CI** — `/health` and `/api/health` exist but are not validated pre-deploy | Silent deploy failures possible |
| 9 | **Staging DB is `starter` plan** — may not handle migration load testing well | False confidence in staging validation |
| 10 | **No `NODE_ENV=production` in `render.yaml` for prod?** — Actually it IS set, but `staging` uses `NODE_ENV=staging` which may cause unexpected behavior in third-party libs that only check `production` | Potential security/performance misconfiguration |
| 11 | **No linting or type-checking in build** — TypeScript (`client/`) builds but no `tsc --noEmit` check | Type errors can slip into production builds |
| 12 | **No dependency audit** (`npm audit`) in pipeline | Vulnerable packages can deploy unnoticed |
| 13 | **FORCE_SSL_VERIFY=false on dev** — correct for local, but Render dev also gets `false` | Dev environment does not catch SSL-related issues |
| 14 | **No rollback automation** — Rollback requires manual `git revert` and force push | Extended downtime during incidents |
| 15 | **No database backup step before migration** — Runbook mentions it, but no automation | Data loss risk if migration fails mid-way |

---

## 6. Recommended Pipeline: Dev → Test → Staging → Prod

### 6.1 Target Architecture

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  Feature    │──▶│  PR Open    │──▶│  Merge to   │──▶│  Merge to   │──▶│  Merge to   │
│  Branch     │   │  (CI runs)  │   │  dev        │   │  staging    │   │  main       │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
                                           │                    │                    │
                                           ▼                    ▼                    ▼
                                    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
                                    │   Dev Env   │     │  Staging    │     │ Production  │
                                    │  (Render)   │     │  (Render)   │     │  (Render)   │
                                    └─────────────┘     └─────────────┘     └─────────────┘
```

### 6.2 Recommended GitHub Actions CI/CD Pipeline

#### Stage 1: Pull Request CI (on every PR to `dev`, `staging`, `main`)

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
    branches: [dev, staging, main]
jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: cd client && npm ci && npm run build
      - run: npm audit --audit-level=moderate
      # - run: npx tsc --noEmit  # if you add tsconfig to root
  
  test-e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run migrate
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/test
      - run: npx playwright install --with-deps
      - run: npx playwright test
```

#### Stage 2: Auto-Deploy with Migration (on merge to each branch)

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [dev, staging, main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Render
        uses: render-deploy-action  # or use Render Deploy Hook
      - name: Run Database Migrations
        run: npm run migrate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
      - name: Health Check
        run: curl -f https://${{ env.URL }}/health
```

### 6.3 Recommended Environment Changes

| Change | Priority | Rationale |
|---|---|---|
| **Disable auto-deploy on `main`** | 🔴 Critical | Require manual approval or CI gate before production deploy |
| **Add `npm run migrate` to build/start** or Render **Deploy Hook** | 🔴 Critical | Eliminate manual migration step |
| **Enable branch protection on `main`** | 🔴 Critical | Require PR + passing CI + 1 review before merge |
| **Add `npm run migrate` as a Render pre-deploy or post-deploy command** | 🔴 Critical | See Render "Deploy Hooks" or add a startup script that runs migrations idempotently |
| **Set `numInstances: 2` for prod** | 🟡 High | Rolling deploys for zero downtime |
| **Add `migrate` to `start` script safely** | 🟡 High | `npm run migrate && node server.js` — but only if idempotent and fast |
| **Standardize staging plan** | 🟡 Medium | Use `standard` for staging to mirror prod performance |
| **Separate `staging` NODE_ENV secrets** | 🟡 Medium | Use `staging`-specific API keys (Stripe test, separate AI quotas) |
| **Add `npm audit` to CI** | 🟡 Medium | Catch vulnerable dependencies |
| **Fix `dark-mode.spec.ts` SIGKILL** | 🟡 Medium | Resource leak in `auth.setup.ts` — add `page.close()` or split setup |
| **Add Sentry/Error tracking integration** | 🟡 Medium | Catch production errors in real-time |
| **Add automated DB backup before migration** | 🟡 Medium | Neon has branching; use `pg_dump` or Neon branch for safety |
| **Document `.env` rotation process** | 🟢 Low | Quarterly secret rotation calendar |

### 6.4 Migration Automation Options

**Option A: Startup Migration (Recommended for Render)**
```json
{
  "scripts": {
    "start": "node migrate.js && node server.js"
  }
}
```
- **Pros:** Simple, always runs on boot
- **Cons:** Adds ~2-5s to startup time; if migration fails, container crashes

**Option B: Render Deploy Hook (Post-Deploy)**
- Use Render's "Deploy Hook" to trigger a shell command `npm run migrate` after successful deploy.
- **Pros:** Doesn't block startup
- **Cons:** Requires Render API integration; migration runs after app is live (risk of brief inconsistency)

**Option C: GitHub Actions Post-Deploy Migration**
- After Render deploy succeeds, run `npm run migrate` from the CI runner against the prod DB.
- **Pros:** CI-controlled, logs visible in GitHub
- **Cons:** Requires `DATABASE_URL` secret in GitHub

---

## 7. Immediate Action Items

| # | Action | Owner | Priority | Effort |
|---|---|---|---|---|
| 1 | Create `.github/workflows/ci.yml` with lint, build, and E2E test steps | Suga/CTO | 🔴 Critical | 2-4 hrs |
| 2 | Add `npm run migrate` to production startup or deploy hook | Suga/CTO | 🔴 Critical | 1 hr |
| 3 | Enable GitHub branch protection rules for `main` (require PR, require CI pass) | Suga/CTO | 🔴 Critical | 30 min |
| 4 | Fix `e2e/dark-mode.spec.ts` SIGKILL — add `page.close()` in `auth.setup.ts` | QA/Sunny | 🔴 Critical | 2-4 hrs |
| 5 | Disable auto-deploy on `main` — switch to manual approval or deploy hook | Suga/CTO | 🟡 High | 30 min |
| 6 | Audit git history for `.env` secrets (use `git log --all --full-history -- .env`) | Suga/CTO | 🟡 High | 1 hr |
| 7 | Set `numInstances: 2` for `rekrutai-prod` in `render.yaml` | Suga/CTO | 🟡 High | 5 min |
| 8 | Create staging-specific secrets (Stripe test keys, AI quotas) in Render | Suga/CTO | 🟡 Medium | 1 hr |
| 9 | Add `npm audit` step to CI pipeline | Suga/CTO | 🟡 Medium | 15 min |
| 10 | Document `.env` file strategy (consider `dotenv-flow` for multi-env) | Suga/CTO | 🟢 Low | 1 hr |

---

## 8. Summary

**Current State:** The Rekrut AI project has a **3-environment Render setup** (dev, staging, prod) with **isolated databases** and a **documented manual deployment runbook**. This is a solid foundation.

**However, the pipeline lacks critical automation:**
- ❌ **No CI/CD** (GitHub Actions missing)
- ❌ **No automated test gates** (E2E tests exist but run locally only)
- ❌ **No automated migrations** (manual step, high risk of human error)
- ❌ **No branch protection** (direct push to main possible)
- ❌ **Single-instance production** (no redundancy)

**The highest-risk gap is the combination of auto-deploy to production + manual migrations + no automated tests.** A developer can push a schema-changing migration to `main`, Render deploys it automatically, but the database is never updated, causing immediate production downtime.

**Recommended Priority:** Implement CI/CD + migration automation + branch protection **this week** before the next production deploy.

---

*Report generated by Infrastructure Maintainer Agent*
*Repository: `Rekrut_AI_v2` | Commit: `cfbf5d9` (as of 2026-06-08)*
