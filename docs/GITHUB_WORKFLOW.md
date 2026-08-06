# GitHub Workflow — Suga's CEO Agent Operating System

> **Purpose:** Professional GitHub issue tracking, PR management, and project coordination for Rekrut AI.
> **Updated:** 2026-06-11

---

## 1. GitHub Authentication

### Current Status
- **GitHub CLI (`gh`):** Installed but NOT authenticated (`gh auth status` → not logged in)
- **GitHub API Token:** Not found in `~/.credentials.env` or `.env`
- **Repository:** `https://github.com/sumanthrangausa-06/Rekrut_AI_v2`
- **Primary Branches:** `main` (production), `staging` (integration), `dev` (development)

### Required Setup (Ranga — needs your action)
To enable full GitHub integration, create a Personal Access Token (PAT) with these scopes:
- `repo` — full repository access
- `issues` — create/update/assign issues
- `pull_requests` — manage PRs
- `workflow` — update CI workflows
- `project` — project board access

Store it in `~/.credentials.env` as `GITHUB_API_KEY=[REDACTED]` or use `gh auth login`.

---

## 2. Issue Tracking Workflow

### Sprint Backlog → GitHub Issues
Every task in the sprint board becomes a GitHub issue.

**Issue Template:**
```markdown
Title: [TYPE] Brief description
Labels: `priority-high` | `priority-medium` | `priority-low`, `bug`, `feature`, `security`, `tech-debt`
Assignee: agent who will handle it (e.g., `frontend-developer`, `backend-architect`)
Milestone: Current sprint (e.g., "Sprint June 11, 2026")
Body:
- **Objective:** What needs to be done
- **Acceptance Criteria:** How we know it's done
- **Agent:** Which specialized agent will handle this
- **Dependencies:** Blocked by other issues?
- **Estimated Effort:** Small / Medium / Large
```

### Label System
| Label | Color | Use For |
|-------|-------|---------|
| `priority-critical` | 🔴 | Blocks deployment, security, data loss |
| `priority-high` | 🟠 | Sprint goals, user-facing bugs |
| `priority-medium` | 🟡 | Nice to have, internal improvements |
| `priority-low` | 🟢 | Tech debt, refactoring |
| `agent-frontend` | 🔵 | Frontend developer agent |
| `agent-backend` | 🔵 | Backend architect agent |
| `agent-security` | 🔵 | Security engineer agent |
| `agent-devops` | 🔵 | DevOps automator agent |
| `agent-qa` | 🔵 | QA specialist agent |
| `status-in-progress` | 🟣 | Currently being worked on |
| `status-blocked` | ⚫ | Waiting on dependency |
| `status-done` | ✅ | Completed, verified |

---

## 3. PR Workflow

### Branch Strategy
- `main` → Production only. No direct pushes.
- `staging` → Integration branch. All features merge here first.
- `dev` → Active development. Agents commit here.
- `feature/*` → Feature branches (optional for complex work).

### PR Template
```markdown
## What
Brief description of the change.

## Why
Link to the issue: Fixes #123

## How
Technical approach summary.

## Testing
- [ ] Build passes
- [ ] TypeScript clean
- [ ] E2E tests pass (or list which ones)
- [ ] Manual QA performed (if applicable)

## Agent
Spawned by: @Suga (CEO Agent)
Agent type: `frontend-developer` / `backend-architect` / etc.

## Commits
- `abc1234` — feat: what changed
- `def5678` — fix: what fixed
```

### PR Automation Rules
1. **Every commit must reference an issue** in the commit message: `feat: add email service (#142)`
2. **Auto-link PRs to issues** in the PR body: `Fixes #142`
3. **Require 1 review before merge** to `staging` (can be self-review for urgent fixes with note)
4. **CI must pass** before merge: Build, Lint, Security Audit, E2E Tests

---

## 4. Sprint Board (GitHub Projects)

### Columns
1. **Backlog** — All upcoming tasks
2. **Ready** — Groomed, no blockers, ready to start
3. **In Progress** — Agent actively working
4. **In Review** — PR open, awaiting review/CI
5. **Done** — Merged to staging, verified

### Automation
- When issue created → Backlog
- When agent assigned → In Progress (auto-update via API)
- When PR linked → In Review
- When PR merged → Done (auto-close issue)

---

## 5. Current Sprint: June 11, 2026

### Issues to Create (Once GitHub Auth is Ready)

| # | Title | Agent | Priority | Status |
|---|-------|-------|----------|--------|
| 1 | Fix E2E CI: Add PostgreSQL service to CI workflow | devops-automator | 🔴 Critical | 🔄 In Progress (fix applied) |
| 2 | Mobile responsive: 13% remaining (~13 pages) | frontend-developer | 🟠 High | 🔄 Ready |
| 3 | Biome lint: 30 errors across client | frontend-developer | 🟠 High | 🔄 Ready |
| 4 | E2E pass rate: ~35% → >80% | model-qa-specialist | 🟠 High | 🔄 Ready |
| 5 | EU AI Act dashboard: 50% → 100% | compliance-auditor | 🟡 Medium | 📋 Backlog |
| 6 | Cartesia API key prod setup | devops-automator | 🟡 Medium | 📋 Backlog |
| 7 | Prod deployment validation | devops-automator | 🟡 Medium | 📋 Backlog |

---

## 6. How Agents Use GitHub

### Before Starting Work
1. Read assigned issue from GitHub API
2. Update issue status to `status-in-progress`
3. Check linked PRs for context

### During Work
1. Commit with issue reference: `git commit -m "feat: add email notifications (#142)"`
2. Push to `dev` or `staging` branch
3. Comment on issue with progress updates

### After Work
1. Open PR with proper template
2. Link PR to issue: `Fixes #142`
3. Request review (if required)
4. Update issue status to `status-in-review`

---

## 7. GitHub CLI Commands (Reference)

```bash
# Create issue
gh issue create --title "[FEATURE] Add X" --body "..." --label "priority-high,agent-backend"

# List issues
gh issue list --label "status-in-progress" --assignee "@me"

# Create PR
gh pr create --title "feat: add X" --body "Fixes #142" --base staging

# Merge PR
gh pr merge 123 --squash --delete-branch

# View PR status
gh pr view 123 --json state,checks,mergeStateStatus
```

---

## 8. memU Integration with GitHub

**memU stores cross-agent context:**
- `external-skills/memU/src/memu/app/service.py` — Memory service
- `external-skills/memU/src/memu/app/memorize.py` — Store info
- `external-skills/memU/src/memu/app/retrieve.py` — Retrieve info

### How It Should Work (Current Gap)
| What | Current State | Target State |
|------|-------------|--------------|
| Agent context sharing | ❌ Not used | ✅ Agents store task context in memU before spawning next |
| Issue history | ❌ Only in HEARTBEAT | ✅ memU stores per-issue agent history |
| Sprint state | ❌ Only in HEARTBEAT | ✅ memU stores current sprint snapshot |
| Cross-agent learning | ❌ Not used | ✅ Failed agent runs store lessons in memU |

**Next Steps:**
1. Integrate memU into agent spawn workflow
2. Store agent outputs in memU before next spawn
3. Use memU as "source of truth" between heartbeats

---

## 9. Status: Not Yet Operational

**What's blocking:**
- ❌ No GitHub auth token configured
- ❌ No GitHub CLI authenticated
- ❌ Issues not being created automatically
- ❌ PRs not being tracked in issues
- ❌ memU not integrated into agent workflow

**What needs to happen:**
1. Ranga provides GitHub PAT → I authenticate `gh`
2. I create the 7 issues listed above
3. I set up the sprint board
4. I update agent spawn workflow to reference issues
5. I integrate memU for cross-agent memory

*Documented: 2026-06-11 04:32 SGT*
