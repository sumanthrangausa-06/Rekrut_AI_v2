# Deployment Process

> **Last updated:** 2026-06-08
> **Status:** CI/CD gates implemented — production auto-deploy is **disabled**

---

## Overview

This document describes the CI/CD pipeline and deployment process for the Rekrut AI platform. The goal is to ensure **no broken code reaches production** by enforcing automated checks at every stage of the delivery pipeline.

### Current Pipeline State

| Environment | Branch | autoDeploy | Deploy Method |
|-------------|--------|------------|---------------|
| Development | `dev` | ✅ `true` | Automatic on push |
| Staging | `staging` | ✅ `true` | Automatic on push |
| Production | `main` | ❌ `false` | **Manual only** |

---

## CI/CD Pipeline Architecture

### 1. Continuous Integration (`ci.yml`)

Triggered on every **Pull Request** to `dev`, `staging`, or `main`, and on every **push** to `dev` or `staging`.

#### Jobs

| Job | Purpose | Failure Behavior |
|-----|---------|------------------|
| **Build Check** | Runs `npm run build --prefix client` to verify the frontend compiles | Blocks merge |
| **Security Audit** | Runs `npm audit --audit-level high` | Blocks merge if critical/high vulnerabilities found |
| **E2E Tests** | Runs `npx playwright test --project=chromium` | Blocks merge if tests fail |
| **Health Check** | CURLs `https://rekrutai-dev.onrender.com/health` | Warns if dev is unhealthy |

#### Key Design Decisions

- **Chromium only** for E2E tests to avoid memory exhaustion in GitHub Actions runners
- **Workers capped at 1** in CI (`workers: 1`) per `playwright.config.ts` memory constraints
- **Build must pass before E2E tests run** to fail fast on compilation errors

### 2. Production Deployment (`deploy.yml`)

Triggered **only** via `workflow_dispatch` (manual button in GitHub Actions) from the `main` branch.

#### Deployment Gates

1. **Confirmation gate**: Must type `deploy-to-prod` to proceed
2. **Branch gate**: Must be on `main` branch
3. **CI re-run gate**: All CI checks (build, audit, E2E, health) must pass again
4. **Environment protection**: Uses GitHub `environment: production` for optional approval rules

#### Post-Deploy Verification

After deployment, the workflow waits 60 seconds then polls `https://rekrutai.co/health` for up to 10 attempts (2.5 min total). If the health check fails, the workflow reports failure.

---

## Deployment Flow: Dev → Staging → Production

### Step 1: Develop on `dev`

```
feature/my-change → dev
```

- Open a PR to `dev`
- CI runs automatically (build, audit, E2E, health check)
- Once checks pass, merge to `dev`
- Render **auto-deploys** the `dev` branch to `https://rekrutai-dev.onrender.com`

### Step 2: Promote to `staging`

```
dev → staging
```

- Open a PR from `dev` to `staging`
- CI runs again on the PR
- Once checks pass, merge to `staging`
- Render **auto-deploys** the `staging` branch to `https://rekrutai-staging.onrender.com`
- **Perform manual QA on staging** before promoting to production

### Step 3: Promote to `main` (Production)

```
staging → main
```

- Open a PR from `staging` to `main`
- CI runs on the PR
- **Require at least 1 PR review approval** before merging
- Once merged, **production does NOT auto-deploy** (autoDeploy: false)

### Step 4: Manual Production Deploy

1. Go to **GitHub Actions** → **Deploy to Production** workflow
2. Click **Run workflow**
3. Select the `main` branch
4. Type `deploy-to-prod` in the confirmation field
5. Click **Run workflow**
6. The workflow will:
   - Re-run all CI checks
   - Build the application
   - Show instructions for triggering the Render deploy
7. Go to [Render Dashboard](https://dashboard.render.com/) and click **Manual Deploy** for `rekrutai-prod`
8. The workflow will poll production health and confirm the deploy

---

## Manual Deploy Steps for Production (autoDeploy Disabled)

Since `autoDeploy: false` on the production service (`rekrutai-prod`), deployments must be triggered manually.

### Option A: Render Dashboard (Recommended)

1. Navigate to [Render Dashboard](https://dashboard.render.com/)
2. Select the service: **rekrutai-prod**
3. Click **Manual Deploy** → **Deploy latest commit**
4. Monitor the deploy logs for errors
5. Verify the deployment by visiting `https://rekrutai.co/health`

### Option B: Render CLI

```bash
render deploy --service rekrutai-prod
```

### Option C: Render Deploy Hook (if configured)

If a deploy hook URL is configured as a GitHub secret (`RENDER_DEPLOY_HOOK_URL`), the GitHub Actions workflow can trigger it automatically. Currently, this requires manual dashboard action.

---

## Branch Protection Recommendations

The following branch protection rules **should be enabled** on GitHub to enforce the CI/CD gates:

### `main` Branch (Production)

| Setting | Value | Rationale |
|---------|-------|-----------|
| **Require a pull request before merging** | ✅ Enabled | No direct pushes to production |
| **Require approvals** | 1 minimum | Peer review for all production changes |
| **Dismiss stale PR approvals** | ✅ Enabled | Re-review if new commits are pushed |
| **Require status checks to pass** | ✅ Enabled | CI must pass before merge |
| **Required checks** | `Build Check`, `Security Audit`, `E2E Tests` | All critical gates must pass |
| **Require branches to be up to date** | ✅ Enabled | Prevents merge of outdated code |
| **Require conversation resolution** | ✅ Enabled | All review threads resolved |
| **Restrict pushes that create files** | Consider enabling | Prevents accidental file creation |
| **Allow force pushes** | ❌ Disabled | Prevent history rewriting on production |
| **Allow deletions** | ❌ Disabled | Prevent accidental branch deletion |

### `staging` Branch

| Setting | Value | Rationale |
|---------|-------|-----------|
| **Require a pull request before merging** | ✅ Enabled | Promote from `dev` via PR only |
| **Require approvals** | 1 minimum | Optional but recommended |
| **Require status checks to pass** | ✅ Enabled | CI must pass before merge |
| **Required checks** | `Build Check`, `Security Audit`, `E2E Tests` | All gates must pass |
| **Allow force pushes** | ❌ Disabled | Prevent history rewriting |

### `dev` Branch

| Setting | Value | Rationale |
|---------|-------|-----------|
| **Require a pull request before merging** | ✅ Enabled | Feature branches via PR only |
| **Require status checks to pass** | ✅ Enabled | CI must pass before merge |
| **Required checks** | `Build Check`, `Security Audit` | At minimum build and audit |
| **Allow force pushes** | ❌ Disabled | Prevent history rewriting |

---

## Rollback Procedure

If a production deployment causes issues:

1. **Immediate**: Go to Render Dashboard → `rekrutai-prod` → **Manual Deploy** → **Deploy previous commit**
2. **Short-term**: Revert the problematic PR on `main` and redeploy
3. **Long-term**: Investigate root cause in staging before re-attempting

---

## Security Considerations

- `npm audit --audit-level high` blocks CI on critical/high vulnerabilities
- Production secrets are marked `sync: false` in `render.yaml` — never committed to git
- `FORCE_SSL_VERIFY: true` on production ensures strict SSL verification
- Manual deploy confirmation prevents accidental production deployments

---

## Files Changed

| File | Change | Branch |
|------|--------|--------|
| `render.yaml` | `autoDeploy: false` on `rekrutai-prod` | `dev` |
| `.github/workflows/ci.yml` | New CI pipeline | `dev` |
| `.github/workflows/deploy.yml` | New gated deploy pipeline | `dev` |
| `DEPLOYMENT_PROCESS.md` | This documentation | `dev` |

> ⚠️ **Note:** `render.yaml` changes on `dev` will not affect production until merged to `main`. The production `autoDeploy` setting is currently `true` on `main` and will become `false` only after this `dev` branch is merged to `main`.

---

## Quick Reference

| Action | How |
|--------|-----|
| View CI status | GitHub → Actions → `CI` workflow |
| Deploy to production | GitHub → Actions → `Deploy to Production` → Run workflow |
| Check dev health | `curl https://rekrutai-dev.onrender.com/health` |
| Check staging health | `curl https://rekrutai-staging.onrender.com/health` |
| Check production health | `curl https://rekrutai.co/health` |
| Run E2E tests locally | `npx playwright test --project=chromium` |
| Run security audit locally | `npm audit --audit-level high` |
