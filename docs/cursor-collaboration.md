# OpenClaw × Cursor Collaboration Guide

> **Purpose:** How Suga (OpenClaw CEO Agent) and Cursor Agent work together on Rekrut AI
> **Date:** 2026-08-11
> **Location:** `docs/cursor-collaboration.md` (in repo)

---

## Roles

| Role | Who | Responsibilities |
|------|-----|-----------------|
| **Implementer** | Suga (cron) | Picks issues, implements end-to-end, deploys to staging, moves to next issue |
| **QA** | Cursor | Tests `ready-for-qa` issues on staging asynchronously, reports bugs |
| **Final Review** | Ranga | Reviews QA-passed issues, closes them |

---

## How It Works (Async)

Suga and Cursor work **independently** — no blocking, no waiting.

```
Suga (every hour)          Cursor (when you work)
        │                            │
        ▼                            ▼
   Pick issue #N              Find ready-for-qa issues
   Implement                  Test on staging
   Deploy to staging          │
   Add ready-for-qa label     ├─ Pass → add qa-passed
   Move to next issue         └─ Fail → add qa-failed, reopen
        │                            │
        ▼                            ▼
   Pick issue #N+1            Suga will pick up qa-failed
   (keeps working)            issues in future runs
```

---

## Issue Labels

| Label | Meaning | Who Adds |
|-------|---------|----------|
| `in-progress` | Suga is implementing | Suga |
| `ready-for-qa` | On staging, ready for Cursor | Suga |
| `qa-in-progress` | Cursor is testing | Cursor |
| `qa-passed` | Cursor approved | Cursor |
| `qa-failed` | Cursor found bugs, needs fix | Cursor |

---

## For Cursor: How to QA

### 1. Find Issues to Test

```bash
gh issue list --label ready-for-qa --state open
```

### 2. Pick One and Mark as In Progress

```bash
gh issue edit <number> --add-label qa-in-progress --remove-label ready-for-qa
gh issue comment <number> --body "Starting QA on staging."
```

### 3. Test on Staging (Not Dev, Not Prod)

**URL:** `https://rekrutai-staging.onrender.com`

**Checklist for every issue:**
- [ ] Feature works (happy path)
- [ ] Edge cases (empty states, errors, invalid input)
- [ ] Mobile responsive (resize browser or use dev tools)
- [ ] No console errors (check browser dev tools)
- [ ] API returns 200s (check network tab)

### 4. Report Results

**If QA Passes:**
```bash
gh issue edit <number> --add-label qa-passed --remove-label qa-in-progress
gh issue comment <number> --body "QA passed ✅. Tested on staging. Ready for final review."
```

**If QA Fails:**
```bash
gh issue edit <number> --add-label qa-failed --remove-label qa-in-progress
gh issue comment <number> --body "QA failed ❌. Issues found:
1. [Bug description + steps to reproduce]
2. [Another bug]
Reopening for fix."
```

**If you reopen:**
```bash
gh issue reopen <number>
```

Suga will automatically pick up `qa-failed` issues in future runs and fix them.

---

## Environment Guide

| Environment | URL | Used For |
|------------|-----|----------|
| Dev | `rekrutai-dev.onrender.com` | Development only |
| **Staging** | **`rekrutai-staging.onrender.com`** | **Cursor tests here** |
| Production | `rekrutai.co` | Live site, never test here |

**Cursor: Always test on staging.**

---

## Quick Commands

```bash
# Find issues to QA
gh issue list --label ready-for-qa --state open

# Start QA
gh issue edit <number> --add-label qa-in-progress --remove-label ready-for-qa

# QA passed
gh issue edit <number> --add-label qa-passed --remove-label qa-in-progress
gh issue comment <number> --body "QA passed ✅"

# QA failed
gh issue edit <number> --add-label qa-failed --remove-label qa-in-progress
gh issue reopen <number>
gh issue comment <number> --body "QA failed ❌: [bug description]"
```

---

*Cursor: Read this file at the start of every session. Check for `ready-for-qa` issues. Test on staging. Report clearly. No need to coordinate with Suga — work asynchronously.*
