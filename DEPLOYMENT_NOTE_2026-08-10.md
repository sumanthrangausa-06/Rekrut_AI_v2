# Deployment Promotion: dev → staging

**Date:** 2026-08-10 08:15 CST  
**Issue:** #148  
**Action:** Promoted dev branch fixes to staging environment

## Commit Count
- **Before:** 7 commits ahead of staging on dev
- **After:** 0 commits (fully synchronized)

## Fixes Deployed (7 commits)
1. `27de6dc` — fix(recruiter): use jsonb_array_elements_text for skills_required analytics (#150)
2. `7cabbcd` — security: fatal guard against production DB in non-prod environments (#151)
3. `01ea79f` — fix(ui): restore mouse wheel and touchpad scrolling
4. `35663bd` — fix(ui): stop overlays from corrupting body scroll state
5. `0c8ed17` — fix(cors): allow production's own Render URL to load its assets
6. `f82b846` — docs(issues): record shared prod/staging database finding (#151)
7. `a02f08e` — fix: exempt analytics events from CSRF + send token from client (#100)

## Deploy Status
- **Platform:** Render (rekrutai-staging)
- **Auto-deploy:** Enabled — triggered by push to staging branch
- **Health Check:** ✅ HTTP 200 on /health
- **Staging URL:** https://rekrutai-staging.onrender.com

## Verification
```
$ git rev-list --count origin/staging..origin/dev
0
```
✅ Staging is fully synchronized with dev.

## Files Changed (12 files)
- `.env.example`
- `client/src/components/ui/dialog.tsx`
- `client/src/components/ui/sheet.tsx`
- `client/src/hooks/use-scroll-lock.ts` (new)
- `client/src/index.css`
- `client/src/lib/analytics.ts`
- `migrations/068_job_search_filter_columns.js`
- `routes/candidate.js`
- `routes/recruiter.js`
- `scripts/github-issues/audit-comments/shared-prod-staging-database.md` (new)
- `scripts/github-issues/audit-comments/skills-required-type-conflict.md` (new)
- `server.js`
