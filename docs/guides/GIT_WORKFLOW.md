# Rekrut AI — Git Workflow

> **Policy: No direct commits to `main`. Ever.**  
> `main` is production. `dev` is the integration branch. All work flows through `dev`.

---

## Branch Overview

| Branch | Purpose | Commit Rule |
|--------|---------|-------------|
| `dev` | All development, feature work, hotfix prep, docs | ✅ Direct commits and PRs allowed |
| `staging` | Optional pre-prod smoke testing | ✅ Only receives merges from `dev` |
| `main` | Production only | ❌ **No direct commits. Only merges from `dev`**. |

---

## The Correct Workflow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Feature │ ──► │    dev   │ ──► │  staging │ ──► │   main   │
│  Branch  │     │ (integrate)│    │  (smoke) │     │ (deploy) │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
```

### 1. Start Work

```bash
# Always start from latest dev
git checkout dev
git pull origin dev

# Create a feature branch (optional but recommended for large changes)
git checkout -b feat/my-feature

# ... edit, test, commit ...
git add .
git commit -m "feat(scope): concise description"
```

### 2. Merge to dev

```bash
git checkout dev
git merge feat/my-feature --no-ff -m "Merge feat/my-feature"
git push origin dev
```

Or use a **Pull Request** with review + CI pass.

### 3. Promote to main (Production)

```bash
git checkout main
git pull origin main

# Only merge from dev
git merge dev --no-ff -m "Merge dev into main — prod deploy vX.Y.Z"
git push origin main
```

> **Never** cherry-pick, rebase, or directly commit to `main`.  
> If a production fix is urgently needed, commit it to `dev` first, then merge `dev` → `main`.

---

## What Went Wrong (June 2026 Incident)

### Problem
- `main` received **5 direct commits** (prod fixes, npm audit, e2e fixes, rebuild).
- `dev` was left behind and stale.
- Risk: next merge from `dev` to `main` would have conflicts or miss critical fixes.

### The 5 commits that bypassed `dev`

1. `5ebe6b6` fix(mobile): job detail panel responsive + vite chunking + e2e selector improvements
2. `e87fd5d` e2e: use pre-authenticated storageState + resource-safe config
3. `cfbf5d9` e2e: playwright config updates + global teardown + prod readiness checklist
4. `76dd306` fix(deploy): render.yaml buildCommand --include=dev + package.json test script + uncommitted mobile/e2e changes
5. `e67505b` fix(deps): npm audit fix client (vite/rollup path traversal) + rebuild dist + e2e text-match fixes

### Fix Applied

**Strategy:** Merge `main` → `dev` (fast-forward) to replay all commits into `dev`.

```bash
git checkout dev
git merge main          # Fast-forwarded dev to main
git fetch origin dev    # Remote had new docs commits
git merge origin/dev    # Merge remote docs into local dev
git push origin dev
```

**Result:** `dev` is now ahead of `main` and contains all production fixes plus ongoing development.

---

## Emergency Hotfix (When You Must Fix Prod NOW)

If you truly cannot wait for the full dev cycle:

```bash
# 1. Create hotfix branch from main
git checkout -b hotfix/critical-fix main

# 2. Fix and commit
git add .
git commit -m "hotfix(scope): critical production fix"

# 3. Merge hotfix to BOTH main AND dev
git checkout main
git merge hotfix/critical-fix --no-ff

git checkout dev
git merge hotfix/critical-fix --no-ff

git push origin main dev
```

> Even in emergencies, the fix must land in `dev` so it survives the next release cycle.

---

## Commit Message Format

```
<type>(<scope>): <short description>

<body — optional but encouraged>
```

| Type | Use for |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `test` | Tests, E2E, coverage |
| `build` | Build system, deps, dist |
| `chore` | Maintenance, config, CI |
| `refactor` | Code change without feature change |
| `hotfix` | Production emergency fix |

---

## Branch Protection (Recommended)

Enable in GitHub:

1. **Require pull request reviews** before merging to `main`
2. **Require status checks to pass** (CI / tests)
3. **Require linear history** (optional — prevents merge commits)
4. **Do not allow bypassing** the above settings

For `dev`:
- Allow direct pushes for speed, but require PRs for non-trivial changes.

---

## Summary Checklist

- [ ] All work starts on `dev` or a feature branch from `dev`
- [ ] `main` only receives merges from `dev` (or hotfix branches)
- [ ] Never commit directly to `main`
- [ ] If prod needs a fix, commit to `dev` first, then merge `dev` → `main`
- [ ] Use `--no-ff` for merge commits so history is readable
- [ ] Tag releases on `main`: `git tag -a v1.2.3 -m "Release v1.2.3"`
