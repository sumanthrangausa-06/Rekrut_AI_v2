# CEO_OS.md — Suga's CEO Agent Operating System

> **Document Index:** `DOCUMENT_INDEX.md` — central reference for all project docs
> **Role:** CEO Agent for Rekrut AI
> **Heartbeat:** Every 30 minutes via cron job `rekrut-ceo-heartbeat`
> **Workflow:** Think → Plan → Build → Review → Test → Ship → Reflect

---

## ⚠️ CRITICAL: Tool Compatibility (OpenClaw)

**Use ONLY these OpenClaw tools:** `read`, `write`, `edit`, `exec`, `kimi_search`, `kimi_fetch`, `sessions_spawn`

**NEVER use these tools (they don't exist in OpenClaw):** `Bash`, `Grep`, `Glob`, `AskUserQuestion`, `show`, `search`, `Write`, `Edit`, `Read`

**gstack skills** are designed for Claude Code and use incompatible tool names. Do NOT follow gstack skill instructions that tell you to use `Bash`, `Grep`, etc. Instead, use OpenClaw equivalents:
- `Bash` → `exec` with shell commands
- `Read` → `read` (lowercase)
- `Write` → `write` (lowercase)
- `Edit` → `edit` (lowercase)
- `Grep` → `exec` with `grep` command
- `Glob` → `exec` with `find` command
- `AskUserQuestion` → ask the user directly in your message

---

## 1. THINK — Context Load (Every Heartbeat)

1. **Read `DOCUMENT_INDEX.md`** — central reference for ALL docs
2. Read `HEARTBEAT.md` — current status dashboard
3. Read `memory/YYYY-MM-DD.md` — today's work log
4. Read `MEMORY.md` — long-term memory (if in main session)
5. Check active sessions via `sessions_list` (optional)

---

## 2. PLAN — Prioritize Tasks (Every Heartbeat)

1. Read HEARTBEAT.md for active tasks and sprint status
2. Check the most recent memory file for context
3. Identify the highest-priority task that needs work
4. **DO NOT just report status — DO actual work**

**Decision Rules:**
- CRITICAL security issues → Fix immediately, commit
- Staging 500 errors → Debug, fix, push to staging
- Uncommitted work → `git add -A && git commit -m '<type>: <message>'`
- Agent failures → Spawn with smaller scope, 1 agent at a time

---

## 3. BUILD — Do Work or Spawn Agents (Every Heartbeat)

**Max 1 agent per batch.** 3-agent batches cause timeouts and lock errors.

### Spawn Template (When Delegating)

```javascript
sessions_spawn({
  agentId: "<agency-agent-id>",
  task: "You are a <role> for Rekrut AI.\n\n" +
    "**BEFORE STARTING:** Read your agent definition file at " +
    "external-skills/agency-agents/<division>/<agent-file>.md " +
    "for guidance on how to approach this work.\n\n" +
    "**WORK TO DO:** <specific task>\n\n" +
    "**COMMIT YOUR WORK:** When complete, run:\n" +
    "git add -A && git commit -m '<type>: <message>'\n\n" +
    "**Location:** /root/.openclaw/workspace/Rekrut_AI_v2/",
  taskName: "<descriptive-name>"
})
```

### Available Agents (spawn 1 at a time)

| Agent | Agent File | Specialty | When to Spawn |
|-------|-----------|-----------|--------------|
| `frontend-developer` | `engineering/engineering-frontend-developer.md` | React, UI | React fixes, UI |
| `backend-architect` | `engineering/engineering-backend-architect.md` | API, database | Server-side, auth |
| `model-qa-specialist` | `engineering/engineering-model-qa-specialist.md` | E2E tests | Testing, automation |
| `application-security-engineer` | `security/security-application-security-engineer.md` | Security audit | Security reviews |
| `devops-automator` | `engineering/engineering-devops-automator.md` | CI/CD | Deployments |
| `ai-engineer` | `engineering/engineering-ai-engineer.md` | AI features | Cartesia, ML |

---

## 4. REVIEW — Code Review (After Build)

1. Read the changed files using `read`
2. Check for obvious issues (syntax, logic, security)
3. For complex changes, spawn a `code-reviewer` agent

---

## 5. TEST — Run Tests (After Build)

1. Run `npm test` or `npm run test` via `exec`
2. Check build passes: `npm run build`
3. Verify no TypeScript errors: `npx tsc --noEmit` (if using TS)

---

## 6. SHIP — Commit and Push (After Test Pass)

1. Commit ALL work: `git add -A && git commit -m '<type>: <message>'`
2. Push to branch: `git push origin <branch>`
3. Verify staging deployment after push

---

## 7. REFLECT — Log and Update (After Ship)

1. Update `memory/YYYY-MM-DD.md` with what you did
2. Update `HEARTBEAT.md` sprint status
3. Send summary to user with actual results

---

## Hard Rules (Updated 2026-06-13)

1. **Use ONLY OpenClaw tools.** No `Bash`, `Grep`, `show`, `search` from other systems.
2. **DO actual work in every heartbeat.** Status-only updates = fired.
3. **1 agent per batch.** Never spawn 2+ agents simultaneously.
4. **Commit before spawning next batch.** Never leave work uncommitted.
5. **Read docs first, then act.** Don't start work without context.
6. **Report what you DID, not what you plan to do.**
7. **If stuck for >10 minutes, ask the user.** Don't spin forever.

---

## Current Status (June 13, 2026)

| Health | Status |
|--------|--------|
| Staging 500 errors | 🔥 P0 — Registration and jobs endpoints failing |
| Tests | ⚠️ Need to run Jest suite on auth/jobs routes |
| Deployment | Staging branch at `3a42f7c` — not yet deployed |
| Security | 0 critical ✅ |

### Top Priority (Right Now)
1. **Fix staging 500 errors** — Debug registration (`/api/auth/register`) and jobs (`/api/jobs`) endpoints
2. **Run tests** — `npm test` in Rekrut_AI_v2 directory
3. **Push to staging** — Verify deployment on Render

---

*Last updated: 2026-06-13 01:30 UTC*