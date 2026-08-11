# OpenClaw × Cursor Collaboration Guide

> **Purpose:** How Suga (OpenClaw CEO Agent) and Cursor Agent work together on Rekrut AI
> **Date:** 2026-08-11
> **Location:** `docs/cursor-collaboration.md` (in repo so both agents can read it)

---

## Philosophy

You (Cursor) and I (Suga/OpenClaw) are both agents working on the same codebase. The key rules:

1. **Git is the source of truth** — we coordinate through commits, branches, and PRs
2. **Never work on the same branch simultaneously** — we branch, work, merge
3. **Communicate through issues and comments** — not DMs or side channels
4. **One agent per task at a time** — no race conditions
5. **Cursor owns QA.** Suga implements, Cursor verifies. Issues don't close until QA passes.

---

## Branch Strategy

```
main     ← production (protected)
  ↑
staging  ← integration testing (Suga promotes here)
  ↑
dev      ← active development (Cursor works here)
```

### Who Works Where

| Branch | Who | When |
|--------|-----|------|
| `dev` | **Cursor** — primary workspace | Always start here |
| `dev` | **Suga** — cron batch work | Every 2 hours |
| `staging` | **Suga** — promotes dev→staging | After dev is green |
| `main` | **Ranga** — production deploys | Manual approval |
| `feature/X` | Either agent — for large features | Branch from dev |

---

## Roles & Responsibilities

### Suga (OpenClaw CEO Agent)
- **Picks up GitHub issues** from cron or manual triggers
- **Implements end-to-end:** frontend + backend + database + testing
- **Does NOT close issues** after implementation
- **Hands off to Cursor for QA review**
- **Promotes dev→staging** after QA passes

### Cursor (VS Code Agent)
- **Does QA & testing:** E2E tests, Playwright, manual verification
- **Reviews Suga's implementations** for edge cases
- **Can also implement features** (especially frontend-heavy ones)
- **Does NOT close issues** — assigns back to Ranga for final review
- **Escalates bugs** found during QA as new issues

### Ranga (Human)
- **Final reviewer** — closes issues after Cursor QA passes
- **Production deploys** — merges staging→main
- **Architecture decisions** — when agents disagree

---

## Workflow: Cursor + Suga

### Scenario 1: Suga implements, Cursor QA's (Default)

```
1. Suga cron picks up issue #N
2. Suga plans end-to-end implementation
3. Suga spawns subagent(s) for implementation
4. Subagent builds: frontend + backend + database
5. Suga reviews: TypeScript check, build verification
6. Suga pushes to dev
7. Suga comments: "Implementation complete. Handing off to @cursor for QA."
8. Suga assigns issue to Cursor
9. Cursor pulls dev, runs E2E tests
10. Cursor verifies: browser testing, edge cases, mobile
11. Cursor comments: "QA passed" or "Found issues: [list]"
12. If passed: Cursor assigns to Ranga
13. Ranga reviews, closes issue
```

### Scenario 2: Cursor implements, Suga reviews

```
1. Cursor picks up issue #N (frontend-heavy)
2. Cursor implements on dev branch
3. Cursor pushes commits
4. Cursor comments: "Implementation done. @suga please review."
5. Suga reviews code, runs build checks
6. Suga comments: "Review passed. Handing to QA."
7. Cursor does QA on own work (or Ranga does QA)
8. Issue closed after QA passes
```

### Scenario 3: Both agents working in parallel (different issues)

```
1. Suga works on issue #N (backend API)
2. Cursor works on issue #M (frontend UI)
3. Both on dev branch — but different files
4. If merge conflict: whoever finishes last resolves
5. Both push, both commit
```

---

## Issue Lifecycle (Updated — No Self-Closing)

Issues MUST NOT be closed by either agent. Here's the flow:

```
OPEN → IN_PROGRESS → IMPLEMENTED → QA_REVIEW → QA_PASSED → CLOSED (by Ranga)
   ↑                    ↑               ↑            ↑
 Suga picks up     Suga builds     Cursor tests   Ranga reviews
```

### State Transitions

| State | Who | Action |
|-------|-----|--------|
| `OPEN` | — | Issue created |
| `IN_PROGRESS` | Suga | Suga starts implementation |
| `IMPLEMENTED` | Suga | Suga pushes code, comments, assigns to Cursor |
| `QA_REVIEW` | Cursor | Cursor runs tests, verifies |
| `QA_PASSED` | Cursor | Cursor comments "QA passed", assigns to Ranga |
| `QA_FAILED` | Cursor | Cursor comments issues found, reassigns to Suga |
| `CLOSED` | Ranga | Human final review and close |

---

## Handoff Protocol

### Suga → Cursor Handoff (Default — QA Needed)

Suga writes in the issue:
```
**Handoff to Cursor — QA Review Needed**

Implementation complete on dev:
- ✅ Frontend: [components built]
- ✅ Backend: [API routes created]  
- ✅ Database: [schema migrated]
- ✅ Build: passes
- ✅ TypeScript: clean

**QA Checklist for Cursor:**
- [ ] E2E test: [specific test scenario]
- [ ] Manual test: [browser verification steps]
- [ ] Edge cases: [error states, empty states]
- [ ] Mobile responsive: [check on small screen]
- [ ] Cross-browser: [if applicable]

Branch: dev (commits pushed)
Latest commit: [hash]
```

### Cursor → Suga Handoff (QA Failed)

Cursor writes in the issue:
```
**QA Failed — Issues Found**

Tested on dev branch, commit [hash].

Issues found:
1. [ ] [Bug description with steps to reproduce]
2. [ ] [Another bug]
3. [ ] [UI issue on mobile]

Please fix and reassign to me for re-QA.
```

### Cursor → Ranga Handoff (QA Passed)

Cursor writes in the issue:
```
**QA Passed ✅**

Verified on dev branch, commit [hash].

Tests run:
- ✅ E2E: [test name] — passed
- ✅ Manual: [scenario] — working
- ✅ Mobile: responsive on iPhone SE
- ✅ Edge cases: [tested scenarios]

Ready for final review.
```

---

## Coordination Rules

### 1. Check Before You Start

Before starting work, check:
```bash
# What's in flight?
gh issue list --state open --assignee @me
gh pr list --state open

# What's the latest on dev?
git log --oneline -5 dev

# Is anyone else working?
git branch -a | grep feature/
```

### 2. Claim Issues

When you pick up an issue, assign it:
```bash
gh issue edit <number> --add-assignee "@me"
gh issue comment <number> --body "Working on this. ETA: 2 hours."
```

### 3. Commit Messages Matter

Use commit messages to signal intent:
```bash
# Cursor working
git commit -m "feat: add bookmark button to job detail (#N)"

# Suga's cron working
git commit -m "feat: implement bookmark API + schema (#N) [cron]"

# Work in progress
git commit -m "wip: bookmark page layout (#N) — needs API hook"

# QA fixes
git commit -m "fix: address QA feedback — mobile responsive (#N) [qa]"
```

### 4. Never Force Push

If you need to rebase:
```bash
git pull --rebase origin dev
git push origin feature/issue-N
```

Never `git push --force` to shared branches (dev, staging).

---

## What Suga Does Best

- **Orchestration:** Planning, issue triage, subagent spawning
- **Backend:** API design, database schema, security
- **DevOps:** Deployments, env vars, CI/CD
- **Long-running tasks:** Cron batches, monitoring
- **Issue Implementation:** Builds features end-to-end (frontend + backend + database)
- **Review:** Code review, TypeScript checks, build verification

## What Cursor Does Best

- **Frontend:** React components, UI/UX, Tailwind
- **Refactoring:** Large-scale code reorganization
- **Debugging:** Interactive debugging, breakpoints
- **Quick iterations:** Rapid prototype → polish
- **QA & Testing:** E2E tests, Playwright, manual verification
- **Code Review:** Reviewing PRs, catching edge cases

---

## Example: Collaborative Issue Resolution

**Issue #200: Add job bookmarking**

### Hour 0: Suga (Cron) — DISCOVER
- Picks issue #200
- Analyzes scope: frontend + backend + database
- Updates state: `phase: "PLAN"`

### Hour 1: Suga (Cron) — PLAN
- Reads autoplan skill
- Plans: bookmarks table, API routes, React components
- Updates state: `phase: "BUILD"`

### Hour 2: Suga (Cron) — BUILD
- Spawns backend-architect subagent
- Subagent creates: bookmarks table, POST/GET/DELETE routes
- Commits: `85e1b0f feat: bookmark backend (#200)`
- Pushes to dev

### Hour 3: Suga (Cron) — BUILD (continued)
- Spawns frontend-developer subagent
- Subagent creates: bookmark button, bookmarks page
- Commits: `a1b2c3d feat: bookmark frontend (#200)`
- Pushes to dev

### Hour 4: Suga (Cron) — REVIEW
- Pulls latest dev
- Reviews both commits
- Runs TypeScript check: passes
- Runs build: passes
- Moves to SHIP

### Hour 5: Suga (Cron) — SHIP (but NOT close)
- Pushes dev
- Comments: "Implementation complete. Handing off to @cursor for QA review."
- Assigns issue to Cursor
- Does NOT close the issue

### Hour 6: Cursor — QA Review
- Pulls latest dev
- Runs E2E tests: `npx playwright test`
- Manual verification via browser
- Checks edge cases, error states, mobile responsive
- Finds 2 small bugs
- Comments: "QA found issues: [list]. Reassigning to @suga."
- Reassigns to Suga

### Hour 7: Suga (Cron) — FIX
- Fixes the 2 bugs
- Commits: `b2c3d4e fix: address QA feedback (#200)`
- Pushes to dev
- Reassigns to Cursor

### Hour 8: Cursor — RE-QA
- Re-runs tests
- All pass
- Comments: "QA passed ✅. Assigning to @ranga for final review."
- Assigns to Ranga

### Hour 9: Ranga — Final Review & Close
- Reviews the work
- Approves
- Closes issue #200

---

## Emergency Protocol

If something goes wrong:

1. **Stop working.** Don't make it worse.
2. **Check git status.** What's the current state?
3. **Comment on the issue.** Explain the problem.
4. **Escalate to Ranga** if needed (tag in issue or Telegram).

---

## Files for Context Sharing

Both agents should read/write these:

| File | Purpose |
|------|---------|
| `AGENTS.md` | Workflow rules, agent mapping |
| `TOOLS.md` | Skill mapping, model routing |
| `HEARTBEAT.md` | Current status, blockers |
| `memory/YYYY-MM-DD.md` | Daily work logs |
| `docs/cron-job-instructions.md` | Cron workflow reference |
| `docs/cursor-collaboration.md` | This file |

---

## Quick Reference

```bash
# Check who's working on what
gh issue list --state open --json number,title,assignees

# Check recent activity
git log --oneline --all --graph -10

# Pull latest before starting
git checkout dev && git pull origin dev

# Create feature branch
git checkout -b feature/issue-N

# Push and create PR
git push origin feature/issue-N
gh pr create --base dev --title "feat: description (#N)"

# Update issue status
gh issue comment N --body "Status update..."

# Run E2E tests (Cursor)
cd client && npx playwright test

# Build check (Suga)
cd client && npm run build
```

---

*Both agents: remember — git is the source of truth. Communicate through commits and issues. Respect the branch strategy. Don't step on each other's work. And NEVER close an issue without QA review.*
