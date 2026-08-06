# Rekrut AI — Staging Workflow

> **Owner:** Suga (CTO) | **Last Updated:** 2026-06-08 | **Review Cadence:** Per sprint

## What Is the `staging` Branch?

The `staging` branch is the **integration and pre-production validation** environment. It is the ONLY place where code is reviewed, QA-tested, and approved before promotion to production (`main`).

- **Purpose:** Integration testing, pre-prod validation, QA sign-off
- **Environment:** `https://rekrutai-staging.onrender.com`
- **Auto-deploy:** ✅ Yes — every push to `staging` triggers a Render deploy
- **Database:** Isolated staging database (`rekrutai-staging-db` on Neon)
- **Rule:** NEVER commit directly to `staging`. Only promote from `dev`.

---

## Branch Purposes (Single Source of Truth)

| Branch | Purpose | Environment URL | Auto-Deploy | Rules |
|--------|---------|-------------------|-------------|-------|
| `dev` | Active development — all feature work, subagent builds, experiments | `https://rekrutai-dev.onrender.com` | ✅ Yes | **Only branch for active work.** Never push to staging/main directly. |
| `staging` | Integration testing — QA review, pre-prod validation, stakeholder demos | `https://rekrutai-staging.onrender.com` | ✅ Yes | **Promote from `dev` only.** No direct commits. Must pass QA before prod. |
| `main` | Production — live user-facing site | `https://rekrutai.co` | ❌ No (manual deploy) | **NEVER direct commits.** Only promote from `staging` after QA approval. |

> ⚠️ **CRITICAL:** QA must test `https://rekrutai-staging.onrender.com`, NOT `https://rekrutai-dev.onrender.com`. Dev is for development; staging is for validation.

---

## How to Promote `dev` → `staging`

### Option A: Fast-Forward (Recommended — when staging is behind dev)

```bash
# 1. Ensure you're on a clean working tree
git status

# 2. Checkout staging and fast-forward to dev
git checkout staging
git merge --ff-only dev

# 3. Push to origin (triggers Render auto-deploy)
git push origin staging

# 4. Verify staging is at the same commit as dev
git log --oneline --decorate -1
# Expected: HEAD -> staging, origin/staging, origin/dev, dev
```

### Option B: Merge Commit (when staging has diverged)

```bash
git checkout staging
git merge dev --no-ff -m "promote: dev → staging [$(date +%Y-%m-%d)]"
git push origin staging
```

> Use `--no-ff` only if staging has commits not in dev (rare — should not happen).

### After Push — Verify Deployment

```bash
# Wait 2-3 minutes for Render build, then:
curl https://rekrutai-staging.onrender.com/health
# Expected: {"status":"ok","timestamp":"..."}
```

---

## Tests That Run on Staging Before Production

### Automated Checks (CI/CD)

When a PR is opened from `dev` → `staging`, the following CI gates run:

| Check | Command | Blocks Promotion? |
|-------|---------|-------------------|
| Build Check | `npm run build --prefix client` | ✅ Yes |
| Security Audit | `npm audit --audit-level high` | ✅ Yes (critical/high) |
| E2E Tests (Chromium) | `npx playwright test --project=chromium` | ✅ Yes |
| Health Check | `curl https://rekrutai-staging.onrender.com/health` | ⚠️ Warns |

### Manual QA Checklist (Must Complete Before Prod)

| Test | How | Owner |
|------|-----|-------|
| Smoke test — login → dashboard → core pages | Click through on staging URL | Sunny (QA) |
| Mobile responsive (375px, 768px, 1024px) | Browser DevTools + real devices | Sunny (QA) |
| Critical user journeys — sign up → profile → apply | End-to-end walkthrough | Sunny (QA) |
| API health | `GET /api/health` → 200 | Suga (CTO) |
| Stripe test payment (if checkout changed) | Test card: `4242 4242 4242 4242` | Suga (CTO) |
| AI provider health (if AI features changed) | `GET /api/ai/health` | Suga (CTO) |
| Database connectivity | No connection pool errors in logs | Suga (CTO) |
| Error log review | Sentry / Render logs — zero new exceptions | Suga (CTO) |

> **QA Sign-off Format:** Sunny posts "✅ Staging validated — ready for prod" in group chat with the staging commit SHA.

---

## When to Promote `staging` → `main` (Production)

Promotion is allowed ONLY when all of the following are true:

1. ✅ **All CI checks pass** on the `staging` → `main` PR
2. ✅ **QA manual checklist complete** (Sunny sign-off)
3. ✅ **No P0 or P1 bugs** in staging (tracked in Sentry or issue tracker)
4. ✅ **Staging health check** returns `200 OK` for 10+ minutes post-deploy
5. ✅ **Ranga (CEO) approves** the release (business/launch-critical features)

### Promotion Process (staging → main)

```bash
# 1. Open a PR: staging → main on GitHub
# 2. CI re-runs automatically
# 3. Require at least 1 PR review approval
# 4. Merge the PR (use merge commit, not squash — preserves history)
# 5. Trigger manual production deploy:
#    a) GitHub Actions → "Deploy to Production" → Run workflow → type `deploy-to-prod`
#    b) OR Render Dashboard → rekrutai-prod → Manual Deploy → Deploy latest commit
# 6. Post-deploy verification (see below)
```

---

## Who Approves Staging → Main Promotion?

| Role | Person | Responsibility |
|------|--------|----------------|
| **Technical Approval** | Suga (CTO) | Confirms CI passes, staging is healthy, no critical bugs |
| **QA Sign-off** | Sunny (QA) | Confirms manual QA checklist is complete |
| **Business Approval** | Ranga (CEO) | Approves release of business-critical features, marketing timing |
| **Deploy Execution** | Suga (CTO) | Triggers the production deploy via GitHub Actions or Render dashboard |

> **Rule:** Production deploy is blocked until BOTH technical and QA approvals are obtained. Business approval is required for launch/marketing features.

---

## Post-Deploy Verification (Production)

Within 30 minutes of production deploy:

```bash
# 1. Health check
curl https://rekrutai.co/health
# Expected: {"status":"ok"}

# 2. Smoke test — login → dashboard → core pages
# 3. Verify error logs — zero new exceptions
# 4. Verify critical integrations (Stripe, AI providers, email)
# 5. Monitor for 10 minutes — no 500 errors in traffic
```

---

## Rollback (If Production Deploy Fails)

1. **Immediate:** Render Dashboard → `rekrutai-prod` → **Manual Deploy** → **Deploy previous commit**
2. **Short-term:** Revert the `staging` → `main` PR on GitHub and redeploy
3. **Long-term:** Investigate root cause in staging, fix on `dev`, re-promote through the pipeline

> **Golden Rule:** Roll back first, investigate second. User trust is harder to rebuild than code.

---

## Staging Environment Status (2026-06-08)

| Field | Value |
|-------|-------|
| **Service Name** | `rekrutai-staging` (Render) |
| **Branch** | `staging` |
| **Auto-Deploy** | ✅ `true` (configured in `render.yaml`) |
| **URL** | `https://rekrutai-staging.onrender.com` |
| **Health Check** | `GET /health` or `GET /api/health` |
| **Current Commit** | `0232902` (synced with `dev` 2026-06-08) |
| **Health Status** | ⚠️ **404 Not Found** — Service may need re-creation on Render or first deploy after sync |
| **Database** | `rekrutai-staging-db` (Neon) |

> **Action Required:** Verify `rekrutai-staging` service exists in Render dashboard. If missing, create from `render.yaml` blueprint or manually deploy. The `autoDeploy: true` setting will handle future deploys automatically.

---

## Quick Reference Commands

```bash
# Check branch status
git log --oneline --graph --decorate --all -10

# Sync staging with dev (fast-forward)
git checkout staging && git merge --ff-only dev && git push origin staging

# Verify staging health
curl https://rekrutai-staging.onrender.com/health

# Verify dev health
curl https://rekrutai-dev.onrender.com/health

# Verify production health
curl https://rekrutai.co/health

# Check what's in staging but not in main
git log main..staging --oneline

# Check what's in dev but not in staging
git log staging..dev --oneline
```

---

## Related Documents

- **Production Deploy Runbook:** `docs/deployment-runbook.md`
- **CI/CD Pipeline:** `DEPLOYMENT_PROCESS.md`
- **Render Blueprint:** `render.yaml`
- **Prod Deploy Checklist:** `docs/PROD_DEPLOY_CHECKLIST.md`
- **Dev Workflow:** `WORKFLOW.md`
