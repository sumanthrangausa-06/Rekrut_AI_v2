# Merge Strategy: Reconcile `dev` and `main` branches

## Branch Analysis

### Current State

```
main  ───●───●───●───●───●───●───●───●───●───●───●───●───●─── c3d46f0 (HEAD)
                                                          
dev   ───●───●───●───●───●───●───●───●───●───●───●───●───●───●───●───●───●───●───●───●───●─── bbd24e2 (HEAD)
```

| Metric | Value |
|--------|-------|
| **Merge Base** | `f27d4af` |
| **Commits in `dev` not in `main`** | 22 commits |
| **Commits in `main` not in `dev`** | 15 commits |
| **Total divergence** | 37 commits |
| **Staging branch** | `971e388` (merged with dev at `95bbfa7`) |

### Key commits in `dev` (not in `main`)

| Commit | Description | Impact |
|--------|-------------|--------|
| `bbd24e2` | Prod deploy checklist, admin login cleanup, E2E shard runner, build artifacts clean | **Critical** - Production readiness |
| `18af88f` | WIP: Admin login fix, E2E test updates, build artifacts | High |
| `a297a46` | E2E shadcn tab selectors and stability | Medium |
| `e342002` | Mark 3 security items complete (CSP, admin rate limit, upload validation) | **Critical** - Security |
| `b723adc` | E2E shadcn selectors + auth validation + infrastructure fixes | High |
| `e20ca5f` | Mobile responsive job detail panel + new E2E tests + prod deployment reports | **Critical** - UX |
| `7063403` | Fix 3 critical QA bugs before production deploy | **Critical** - Stability |
| `1701099` | EU AI Act compliance dashboard (risk checklist, human overrides, explainability, audit trail) | **Critical** - Compliance |
| `19f7a60` | Update PROD_DEPLOY_CHECKLIST + add PROD_DEPLOYMENT_RUNBOOK | High |
| `989600a` | Fix render.yaml (healthCheckPath, envVars, NODE_ENV) | **Critical** - Deployment |
| `d1673c8` | Mobile fixes, e2e tests, compliance updates, build artifacts | High |
| `f969f0e` | Merge conflict analysis doc (predicted 0 conflicts - **incorrect**) | Docs |
| `e15e2c9` | Commit mobile fix, landing updates, and e2e tests | Medium |
| `949e606` | E2E QA bug report, auth setup fixes, debug utilities | Medium |

### Key commits in `main` (not in `dev`)

| Commit | Description | Impact |
|--------|-------------|--------|
| `c3d46f0` | EU AI Act audit logging, E2E auth cleanup, pre-deploy readiness | **Critical** - Compliance + readiness |
| `d85c43a` | EU AI Act compliance dashboard, audit logging, tooling | **Critical** - Compliance |
| `c42fcc8` | Recruiter applicant review flow E2E test + asset | Medium |
| `cdb778c` | Merge branch `staging` | Integration |
| `88e53f6` | Mobile job detail panel Sheet structure + e2e auth always regenerate | High |
| `21c4f8f` | Commit dist artifacts from clean build | Build |
| `901f8c8` | EU AI Act dashboard (explainability logs, human overrides, risk checklist) | **Critical** - Compliance |
| `7f56e99` | Remove .admin-credentials plaintext file, enforce env-only admin auth | **Critical** - Security |
| `4037eac` | Merge dev into main: activate production CI/CD pipeline with autoDeploy: false | **Critical** - CI/CD |
| `13812c5` | Merge branch `dev` | Integration |
| `414f5de` | E2E robust selectors + results (recruiter/candidate critical flows) | Medium |
| `d4e9cb0` | E2E robust selectors for candidate/recruiter critical flows | Medium |

## Merge Conflicts Identified

A test merge (`git merge --no-commit --no-ff dev` from `main`) revealed **13 conflicted files**:

### 🔴 Content Conflicts (manual resolution required)

| File | Conflict Type | Resolution Strategy |
|------|---------------|-------------------|
| `client/src/pages/admin/compliance.tsx` | Content conflict | Both branches modified EU AI Act compliance UI. **Take `dev` version** as it has latest UI enhancements, but verify `main`'s audit logging integration is preserved. |
| `client/src/pages/recruiter/jobs.tsx` | Content conflict | Mobile job detail panel changes vs. recruiter flow changes. **Review both versions** and merge functional changes. |
| `e2e/auth.setup.ts` | Content conflict | Auth setup evolved differently. `dev` has unconditional token regeneration fix; `main` has E2E auth cleanup. **Merge both improvements** - unconditional regeneration + cleanup. |
| `package.json` | Content conflict | Dependencies/scripts likely diverged. **Take union of both** — ensure E2E shard runner scripts from `dev` are preserved, and any new `main` dependencies are kept. |
| `docs/prod-deployment-checklist.md` | Add/Add conflict | Both branches added this file independently. **Merge both checklists** into one comprehensive document. |

### 🟡 Rename/Delete Conflicts (build artifacts & migrations)

| File | Conflict Type | Resolution Strategy |
|------|---------------|-------------------|
| `client/dist/assets/ui-*.js` | Rename/Rename + Delete/Delete | **Delete all** — `dist/` should be rebuilt from source after merge. These are generated build artifacts. |
| `client/dist/index.html` | Content conflict | **Delete** — regenerate via `npm run build` after merge. |
| `migrations/003_add_role_column.js` | Renamed to `003b` in both branches | **Check if `003b_add_role_column.js` already exists** (it does on dev). Ensure only one `003b` file exists. |
| `migrations/005_oauth_refresh_tokens.js` | Renamed to `005b` in both branches | **Check if `005b_oauth_refresh_tokens.js` already exists** (it does on dev). Ensure only one `005b` file exists. |
| `migrations/045_p2_schema_hardening.js` | Renamed to `047` in dev | **Keep `047_p2_schema_hardening.js`** from dev (already in dev). Verify `main` doesn't have a duplicate. |
| `client/dist/assets/vendor-*.js` | Rename | Regenerate from build. |

### ⚠️ Important Note on `client/dist/`

The `client/dist/` directory contains **generated build artifacts**. The conflicts here are because both branches built and committed `dist/` at different times. The cleanest approach is:
1. Delete the entire `client/dist/` directory before resolving the merge
2. Resolve source file conflicts
3. After merge, rebuild with `npm run build` (or `cd client && npm run build`)
4. Commit the freshly generated `dist/`

## Recommended Merge Strategy

### Option A: Merge `dev` → `main` with conflict resolution (RECOMMENDED)

This is the standard Rekrut AI workflow: `dev` is the integration branch, `main` is production.

```bash
# 1. Ensure both branches are up-to-date
git fetch origin

# 2. Create a merge resolution branch from main (safety net)
git checkout main
git pull origin main
git checkout -b merge/dev-into-main-$(date +%Y%m%d)

# 3. Start the merge from dev
git merge --no-commit --no-ff dev

# 4. Delete build artifacts (they will be regenerated)
rm -rf client/dist/

# 5. Resolve source file conflicts one by one
#    - compliance.tsx: review diff, merge features
#    - jobs.tsx: review diff, merge features
#    - e2e/auth.setup.ts: merge auth improvements
#    - package.json: combine scripts and dependencies
#    - docs/prod-deployment-checklist.md: merge both versions into one doc

# 6. After resolving all conflicts, rebuild
cd client && npm run build && cd ..

# 7. Stage the resolved files and the new dist/
git add .

# 8. Commit the merge
git commit -m "merge: integrate dev into main for production deploy

- Merge 22 commits from dev branch
- Resolve conflicts in compliance UI, recruiter jobs, auth setup, package.json
- Regenerate build artifacts from clean build
- Include EU AI Act compliance dashboard, mobile fixes, E2E improvements,
  security hardening (CSP, admin rate limit, upload validation), and
  production deployment readiness checklist"

# 9. Push and create PR
git push origin merge/dev-into-main-$(date +%Y%m%d)
# Then create PR via GitHub: gh pr create --title "merge: dev → main" --body-file MERGE_STRATEGY.md
```

### Option B: Merge `main` → `dev` first, then fast-forward `main`

Use this if the team prefers to resolve conflicts in `dev` before touching `main`.

```bash
# 1. From dev, merge main
git checkout dev
git merge --no-commit --no-ff main

# 2. Resolve conflicts (same files as above)
# 3. Test, build, commit
# 4. Then fast-forward main to the merge commit
git checkout main
git merge --ff-only dev
```

**Not recommended** because `main` has divergent commits that `dev` doesn't have, and a fast-forward may not be possible after the merge commit.

### Option C: Rebase `dev` onto `main` (NOT RECOMMENDED)

```bash
# DO NOT DO THIS — 22 commits would need rebasing, high risk of introducing bugs
# and it would rewrite history that may already be shared with other developers
```

## Step-by-Step Conflict Resolution Guide

### 1. `client/src/pages/admin/compliance.tsx`

```bash
git checkout --ours client/src/pages/admin/compliance.tsx   # keep main's version first
git diff main dev -- client/src/pages/admin/compliance.tsx   # see what dev added
git checkout --theirs client/src/pages/admin/compliance.tsx  # take dev's version
# OR manually merge with:
git checkout -m client/src/pages/admin/compliance.tsx
# Then edit to resolve <<<<<<< ======= >>>>>>> markers
```

**Recommendation**: `dev` has `f5579ad` "uncompliance.tsx UI enhancements" which suggests it's the more complete version. Start with `dev`'s version and manually add any `main`-unique audit logging features.

### 2. `client/src/pages/recruiter/jobs.tsx`

Both branches modified this file. `dev` has mobile responsive job detail panel fixes (`e20ca5f`). `main` has recruiter applicant review flow test integration (`c42fcc8`).

**Recommendation**: Use `git checkout -m` and manually merge — both changes are likely in different parts of the file.

### 3. `e2e/auth.setup.ts`

`dev` (`b723adc`, `e20ca5f`) fixed unconditional auth token regeneration. `main` (`c3d46f0`) has E2E auth cleanup.

**Recommendation**: Both improvements should be kept. The unconditional regeneration is critical for CI reliability. Start with `dev`'s version and verify `main`'s cleanup is included.

### 4. `package.json`

`dev` likely added E2E shard runner scripts (`bbd24e2`). `main` may have added audit logging dependencies (`d85c43a`).

**Recommendation**: Use `git checkout -m` and manually merge. Ensure both scripts and dependencies are preserved.

### 5. `docs/prod-deployment-checklist.md`

Both branches independently created this file. It now exists as an add/add conflict.

**Recommendation**: `main` has `c3d46f0` "pre-deploy readiness" and `dev` has `19f7a60` "update PROD_DEPLOY_CHECKLIST". The `dev` version is likely more complete. Compare:
```bash
git show main:docs/prod-deployment-checklist.md > /tmp/checklist-main.md
git show dev:docs/prod-deployment-checklist.md > /tmp/checklist-dev.md
diff -u /tmp/checklist-main.md /tmp/checklist-dev.md
```
Then create a merged version that includes all items from both.

## Post-Merge Checklist

After merging and resolving:

- [ ] `git status` shows no unmerged files
- [ ] `node -c server.js` — no syntax errors
- [ ] `cd client && npx tsc --noEmit` — no TypeScript errors
- [ ] `npm run build` (or `cd client && npm run build`) — builds successfully
- [ ] E2E tests pass: `npm run test:e2e` or `npx playwright test`
- [ ] Migrations run cleanly: `npm run migrate` (or check migration order is valid)
- [ ] Verify `client/dist/` was regenerated and committed
- [ ] Push branch, create PR, get code review
- [ ] Deploy to staging first: verify on `https://staging.rekrutai.co`
- [ ] Then merge to `main` and deploy to production

## Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| Unresolved conflicts breaking build | Medium | Follow step-by-step guide above, test build before pushing |
| EU AI Act compliance features lost | High | Carefully merge `compliance.tsx`, test dashboard manually |
| Auth/E2E tests broken | Medium | Run full E2E suite after merge, use unconditional auth setup |
| Migration numbering conflicts | Low | Verify only `003b`, `005b`, `047` exist (no duplicates) |
| Dist artifacts stale | Low | Always delete and rebuild `client/dist/` |
| Production deployment failure | Medium | Deploy to staging first, follow PROD_DEPLOY_CHECKLIST |

## Decision

**RECOMMENDATION: Option A — Merge `dev` into `main` with manual conflict resolution.**

`dev` contains production-critical fixes (mobile responsiveness, EU AI Act compliance, security hardening, E2E stability, deployment readiness) that must reach `main` for the upcoming production deploy. The conflicts are manageable (~5 source files need manual resolution) and well-understood. The build artifacts (`dist/`) should be deleted and regenerated rather than merged.

---

*Generated: 2026-06-09*
*Analyst: Git Workflow Master*
