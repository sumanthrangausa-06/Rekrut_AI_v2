# Rekrut AI — Cron Job Instructions Reference

> **Job ID:** `056d6b3f-357e-435c-a835-cf5f4e973798`
> **Name:** `rekrut-ai-issue-lifecycle`
> **Schedule:** Every 1 hour
> **Status:** ✅ Enabled
> **Updated:** 2026-08-11

---

## Overview

This cron job implements the full Product Management Lifecycle for GitHub issues:
- **Discovers** open issues by priority
- **Plans** end-to-end implementation
- **Builds** across frontend + backend + database
- **Deploys** to staging
- **Hands off** to Cursor for QA

---

## New Workflow: Staging → QA

```
DISCOVER → PLAN → BUILD → REVIEW → TEST → SHIP → QA_REVIEW → REFLECT
                                              │
                                              ▼
                                    Merge dev→staging
                                    Verify deployment
                                    Add "ready-for-qa" label
                                    Hand off to Cursor
```

### SHIP Phase (Updated)

1. Push to dev: `git push origin dev`
2. Merge dev→staging:
   ```bash
   git checkout staging
   git merge dev -m "deploy: [issue description]"
   git push origin staging
   ```
3. Verify staging deployment:
   ```bash
   curl -s https://rekrutai-staging.onrender.com/health
   ```
   Must return 200.
4. Add label: `gh issue edit <number> --add-label ready-for-qa`
5. Comment on issue with QA checklist
6. Update state: `phase="QA_REVIEW"`

### QA_REVIEW Phase (New)

1. Check if Cursor responded (labels/comments)
2. If `qa-passed` label added → move to REFLECT
3. If `qa-failed` label added → return to BUILD
4. If no response → wait for next run

---

## Issue Labels

| Label | Added By | Meaning |
|-------|----------|---------|
| `in-progress` | Suga | Being implemented |
| `ready-for-qa` | Suga | On staging, ready for Cursor |
| `qa-in-progress` | Cursor | Cursor is testing |
| `qa-passed` | Cursor | Approved |
| `qa-failed` | Cursor | Bugs found |

---

## Full Agent Mapping

| Task Type | Agent | Agent Definition | Skill |
|-----------|-------|-----------------|-------|
| UI/Frontend | frontend-developer | engineering-frontend-developer.md | autoplan |
| API/Backend | backend-architect | engineering-backend-architect.md | autoplan |
| Security | application-security-engineer | security-application-security-engineer.md | cso |
| QA/Testing | model-qa-specialist | engineering-model-qa-specialist.md | qa |
| Deploy/Infra | devops-automator | engineering-devops-automator.md | ship |

---

## End-to-End Implementation

Every issue needs ALL relevant layers:

### Frontend
- React components (pages, modals, forms, tables, cards)
- Tailwind CSS + shadcn/ui
- Responsive: mobile-first, grid-cols-1
- Loading/error/empty states
- Toast notifications
- Lucide icons, Indigo 500

### Backend
- Express routes, validation
- authMiddleware, role checks
- Rate limiting
- Error handling

### Database
- PostgreSQL migrations
- Tables, columns, indexes
- Backwards-compatible

### Testing
- TypeScript: `npx tsc --noEmit`
- Build: `npm run build`
- Manual browser check

---

## Management Commands

```bash
# Pause
openclaw cron update 056d6b3f-357e-435c-a835-cf5f4e973798 patch '{"enabled": false}'

# Resume
openclaw cron update 056d6b3f-357e-435c-a835-cf5f4e973798 patch '{"enabled": true}'

# Run now
openclaw cron run 056d6b3f-357e-435c-a835-cf5f4e973798

# View history
openclaw cron runs 056d6b3f-357e-435c-a835-cf5f4e973798
```

---

## Files

- `docs/cursor-collaboration.md` — Cursor collaboration guide
- `docs/cron-job-instructions.md` — This file
- `.gstack/rekrut-ai-cron-state.json` — Cron state
