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

## Current Status
- **Dev branch:** Clean (build passes, TypeScript 0 errors, Biome ~500 errors being cleaned)
- **Staging branch:** Synced with dev at e5be6f6
- **Main branch:** Production deploy pending
- **Next promotion target:** After E2E auth fix + Biome cleanup
