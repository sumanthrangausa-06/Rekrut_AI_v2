# OpenClaw × Cursor Collaboration Guide

> **Purpose:** How Suga (OpenClaw CEO Agent) and Cursor Agent work together on Rekrut AI
> **Date:** 2026-08-11
> **Location:** `docs/cursor-collaboration.md` (in repo)

---

## Roles

| Role | Who | Responsibilities |
|------|-----|-----------------|
| **Implementer** | Suga (cron) | Picks issues, implements end-to-end, deploys to staging |
| **QA** | Cursor | Tests on staging, verifies functionality, reports bugs |
| **Final Review** | Ranga | Reviews QA-passed issues, closes them |

---

## Issue Labels

| Label | Meaning | Who Adds |
|-------|---------|----------|
| `in-progress` | Suga is implementing | Suga |
| `ready-for-qa` | Deployed to staging, ready for Cursor testing | Suga |
| `qa-in-progress` | Cursor is testing | Cursor |
| `qa-passed` | Cursor approved, ready for Ranga | Cursor |
| `qa-failed` | Cursor found bugs, needs fix | Cursor |

---

## Workflow

```
GitHub Issue
     │
     ▼
┌─────────────┐
│  in-progress │ ← Suga picks issue, adds label
└─────────────┘
     │
     ▼
┌─────────────┐
│  IMPLEMENT   │ ← Suga builds on dev branch
│  (frontend   │    end-to-end: frontend + backend + db
│   + backend  │
│   + database)│
└─────────────┘
     │
     ▼
┌─────────────┐
│   STAGING    │ ← Suga merges dev→staging
│   DEPLOY     │    verifies deployment
└─────────────┘
     │
     ▼
┌─────────────┐
│ ready-for-qa │ ← Suga adds label, comments checklist
└─────────────┘
     │
     ▼
┌─────────────┐
│ qa-in-progress│ ← Cursor picks up, tests on staging
└─────────────┘
     │
     ▼
┌─────────────┐     ┌─────────────┐
│  qa-passed   │────▶│   CLOSED    │ ← Ranga reviews & closes
│  (Cursor)    │     │  (Ranga)    │
└─────────────┘     └─────────────┘
     │
     ▼
┌─────────────┐
│  qa-failed   │ ← Cursor found bugs, reassigns to Suga
└─────────────┘
     │
     ▼
  (back to IMPLEMENT)
```

---

## How Cursor Finds Work

Cursor should run this command to find issues to QA:
```bash
gh issue list --label ready-for-qa --state open
```

When picking up an issue for QA:
1. Add `qa-in-progress` label
2. Remove `ready-for-qa` label
3. Comment: "Starting QA on staging."

---

## QA Checklist (Cursor)

For every `ready-for-qa` issue, test on **staging** (not dev, not prod):

- [ ] **Staging URL loads** — `https://rekrutai-staging.onrender.com`
- [ ] **Feature works** — main happy path
- [ ] **Edge cases** — empty states, error states, invalid input
- [ ] **Mobile responsive** — test on small screen or resize browser
- [ ] **Auth flows** — login, logout, role-based access
- [ ] **No console errors** — check browser dev tools
- [ ] **API responses** — check network tab for 200s, no 500s

---

## Handoff Comments

### Suga → Cursor (after staging deploy)

```
**Ready for QA ✅**

Deployed to staging: https://rekrutai-staging.onrender.com
Branch: dev → staging (merged)
Commit: [hash]

**What was built:**
- Frontend: [components/pages]
- Backend: [API routes]
- Database: [schema changes]

**QA Focus:**
- [ ] Test [specific scenario]
- [ ] Check [specific edge case]

Staging is ready for testing.
```

### Cursor → Suga (QA failed)

```
**QA Failed ❌**

Found issues on staging:
1. [Bug description + steps to reproduce]
2. [Another bug]

Screenshots: [attach if possible]
```

### Cursor → Ranga (QA passed)

```
**QA Passed ✅**

Tested on staging:
- ✅ Feature works
- ✅ Edge cases handled
- ✅ Mobile responsive
- ✅ No console errors

Ready for final review.
```

---

## Environment Guide

| Environment | URL | Used For |
|------------|-----|----------|
| Dev | `rekrutai-dev.onrender.com` | Development, Suga implements here |
| Staging | `rekrutai-staging.onrender.com` | QA testing, Cursor tests here |
| Production | `rekrutai.co` | Live site, Ranga deploys here |

**Cursor: Always test on staging.** Never test on production.

---

## Communication

- **GitHub Issues** — primary coordination (labels, comments, assignments)
- **Commit messages** — quick status updates
- **Telegram** — only for urgent escalations

---

## Quick Commands

```bash
# Find issues to QA
gh issue list --label ready-for-qa --state open

# Start QA on an issue
gh issue edit <number> --add-label qa-in-progress --remove-label ready-for-qa
gh issue comment <number> --body "Starting QA on staging."

# Mark QA passed
gh issue edit <number> --add-label qa-passed --remove-label qa-in-progress
gh issue comment <number> --body "QA passed ✅. Ready for final review."

# Mark QA failed
gh issue edit <number> --add-label qa-failed --remove-label qa-in-progress
gh issue comment <number> --body "QA failed ❌. Issues found: [list]"
```

---

*Cursor: Read this file at the start of every session. Check for `ready-for-qa` issues. Test on staging. Report clearly.*
