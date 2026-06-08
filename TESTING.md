# CEO Testing Workflow — Rekrut AI v2

## Mission
Act as CEO, prioritize testing over building, track everything on GitHub and Mission Control.

## Branches
- `dev` → Test here first (https://rekrutai-dev.onrender.com)
- `staging` → Pre-production testing
- `main` → Production (https://rekrut-ai.onrender.com)

## Current Status (June 7, 2026)

### Deployment Status
| Environment | URL | Status |
|-------------|-----|--------|
| Dev | https://rekrutai-dev.onrender.com | Health OK, but blank page |
| Prod | https://rekrut-ai.onrender.com | Unknown |

### Issue Found: Blank Page on Dev
- **Severity:** P0 — App not usable
- **Root Cause:** `dist` folder had stale JS asset references
- **Fix:** Rebuilt and committed `client/dist/` to `dev` branch (commit 4824ef6)
- **Status:** Pushed to dev, Render should auto-deploy

## Testing Flows to Execute

### Candidate Flow
1. Visit homepage → Take screenshot
2. Click "Sign Up" → Test candidate registration
3. Click "Sign In" → Test candidate login
4. Dashboard → Check all sections load
5. OmniScore → Verify score displays
6. Documents → Test upload
7. Job Search → Test listing and filtering
8. Apply → Test application flow

### Recruiter Flow
1. Visit homepage → Take screenshot
2. Click "Sign Up" → Test recruiter registration
3. Click "Sign In" → Test recruiter login
4. Dashboard → Check analytics
5. Candidates → Test candidate listing
6. Jobs → Test job posting
7. Screening → Test AI screening
8. Interviews → Test scheduling

### GitHub Issue Tracking
Every bug found → Create GitHub issue with:
- Title: [FLOW] Brief description
- Labels: `bug`, `priority`, `flow:candidate` or `flow:recruiter`
- Screenshot attached
- Steps to reproduce
- Expected vs actual behavior

## Agent Hierarchy (Mission Control)

| Role | Agent | Status |
|------|-------|--------|
| CEO | main (you) | Active |
| QA Lead | TBD | Need to spawn |
| Frontend Lead | TBD | Need to spawn |
| Backend Lead | TBD | Need to spawn |

## Next Actions
1. ✅ Fix blank page on dev
2. ⏳ Test candidate flow end-to-end
3. ⏳ Test recruiter flow end-to-end
4. ⏳ Create GitHub issues for all bugs
5. ⏳ Set up Mission Control Kanban

---
*Updated: June 7, 2026 by CEO*
