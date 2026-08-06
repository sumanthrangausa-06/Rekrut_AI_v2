# Deployment Checklist — When Render Comes Back

> Created: 2026-07-13
> Status: 🔴 BLOCKED — Render suspension

## Fixes Ready to Deploy (5 commits on `staging`)

| Commit | Fix | Verification Steps |
|--------|-----|-------------------|
| `695655f` | Recruiter interviews blank page | Navigate to `/recruiter/interviews`, verify calendar and table load |
| `a363fb2` | Admin-login 404 + jobs binary string | Visit `/admin-login` → should redirect; check `/recruiter/jobs` Total Applications |
| `f093a15` | Contact + register form validation | Submit empty forms, verify red error messages appear |
| `dc8a50d` | Blog branding HireLoop → Rekrut AI | Visit `/blog`, verify heading says "Rekrut AI Blog" |
| `635f5d1` | Recruiter-register URL params | Visit `/register?role=recruiter`, verify employer pre-selected |

## Deployment Order

```bash
# 1. Push staging branch
git push origin staging

# 2. Verify staging deploys successfully
curl https://rekrutai-staging.onrender.com/health

# 3. Test all 6 fixes in staging
# 4. Merge staging → main
git checkout main && git merge staging

# 5. Push main (triggers production deploy)
git push origin main

# 6. Verify production
curl https://rekrutai.co/health
```

## Render Actions Needed

1. Log in to dashboard.render.com
2. Check billing/account status
3. Resume suspended services (production, staging, dev)
4. Verify Neon PostgreSQL database is accessible

## Post-Deploy

- [ ] Run E2E smoke tests
- [ ] Verify all 3 environments return 200
- [ ] Update QA tracker with deployment status
- [ ] Close remaining open issues if verified fixed
