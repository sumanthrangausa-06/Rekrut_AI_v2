# Rekrut AI — Deployment Workflow (READ ONLY)

**Rule:** Every code change goes through this pipeline. No exceptions.

```
dev → staging → main (production)
     ↑         ↑
   QA pass   QA pass
```

## 1. Dev Branch (Development)
- All agent work happens here
- Multiple commits allowed
- Build must pass
- TypeScript must pass (`tsc --noEmit`)
- Biome lint should be clean (< 50 errors)
- **Do not merge to staging if build or lint fails**

## 2. Staging Branch (QA Testing)
- Merge from dev ONLY when dev is clean
- Auto-deploy to staging: rekrutai-staging.onrender.com
- Run E2E tests against staging
- Run manual QA checks
- **Do not merge to main if E2E tests fail**
- If tests fail, fix in dev and re-promote

## 3. Main Branch (Production)
- Merge from staging ONLY when staging QA passes
- Auto-deploy to production: rekrutai.co
- Production health checks run automatically
- If production fails, ROLLBACK immediately to last known good

## Checklist Before Each Promotion

### Dev → Staging
- [ ] Build passes (`npm run build`)
- [ ] TypeScript clean (`tsc --noEmit`)
- [ ] Biome lint < 50 errors
- [ ] E2E auth setup works (at least login test passes)
- [ ] No new security vulnerabilities (`npm audit`)
- [ ] Dead code removed (no orphaned pages, no unused deps)
- [ ] Commit message is clear

### Staging → Main
- [ ] All E2E tests pass (or at least 80% pass with 0 critical failures)
- [ ] Staging deployment successful (health check 200)
- [ ] No console errors in staging
- [ ] No breaking API changes (backward compatible)
- [ ] Ranga approves (or Suga approves if Ranga is unavailable)

## Emergency Procedures

### Production Hotfix
- Create branch `hotfix/{issue}` from main
- Fix, test locally
- PR directly to main (fast-track, skip staging for critical fixes)
- Deploy immediately after merge
- Back-port fix to dev and staging

### Rollback
- Revert last commit on main: `git revert HEAD`
- Force redeploy on Render dashboard
- Notify team in group chat

## Dev → Staging → Production Promotion Path

### Overview
The promotion path ensures code moves through validated environments before reaching production. Each promotion requires verification and sign-off.

```
origin/dev ──merge──> origin/staging ──merge──> origin/main (production)
     │                      │                      │
  dev tests              QA retest            prod health check
  build + lint           E2E suite            monitoring alerts
```

### Step-by-Step Promotion (Dev → Staging)

1. **Fetch all branches**
   ```bash
   git fetch --all
   ```

2. **Verify commit delta**
   ```bash
   git rev-list --count origin/staging..origin/dev
   # Expected: >0 (dev is ahead of staging)
   ```

3. **Checkout and update staging**
   ```bash
   git checkout staging
   git pull origin staging
   ```

4. **Merge dev into staging**
   ```bash
   git merge origin/dev --no-edit
   ```
   If merge conflicts occur, resolve them locally or create a PR via `gh pr create`.

5. **Push staging**
   ```bash
   git push origin staging
   ```

6. **Trigger staging deploy**
   - Render auto-deploy is enabled for staging
   - Verify at: https://rekrutai-staging.onrender.com

7. **Health check**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" https://rekrutai-staging.onrender.com
   # Expected: 200
   ```

8. **Confirm delta is zero**
   ```bash
   git rev-list --count origin/staging..origin/dev
   # Expected: 0
   ```

### Step-by-Step Promotion (Staging → Main/Production)

1. **Ensure staging QA has passed**
   - All E2E tests green (or ≥80% with 0 critical failures)
   - Manual QA sign-off
   - No console errors in staging

2. **Checkout and update main**
   ```bash
   git checkout main
   git pull origin main
   ```

3. **Merge staging into main**
   ```bash
   git merge origin/staging --no-edit
   ```

4. **Push main**
   ```bash
   git push origin main
   ```

5. **Verify production health**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" https://rekrutai.co
   # Expected: 200
   ```

### Promotion History

| Date | Promotion | Merge Commit | Health Status |
|------|-----------|--------------|---------------|
| 2026-08-10 | dev → staging | c67fdecda98e03684dc6bdbc068b9f5ef2dce8c1 | ✅ 200 OK |

---

## Current Status
- **Dev branch:** Clean (build passes, TypeScript 0 errors, Biome ~500 errors being cleaned)
- **Staging branch:** Synced with dev at e5be6f6
- **Main branch:** Production deploy pending
- **Next promotion target:** After E2E auth fix + Biome cleanup
