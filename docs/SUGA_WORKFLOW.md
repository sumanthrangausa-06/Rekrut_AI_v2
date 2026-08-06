# Suga's CEO Workflow — For Kimiclaw

> **Role:** CEO (Suga) orchestrates, delegates, reviews. CTO (Kimi) builds, deploys, fixes.  
> **Last updated:** 2026-06-08

## How I Run Agents

### 1. Cron Jobs (Automated)

| Job | Interval | Purpose |
|-----|----------|---------|
| **Work Batch** | Every 30 minutes | Check priorities, delegate to agents, review outputs |
| **Health Check** | Every 6 hours | Silent check — only alert if dev is down |

**No more 2-minute heartbeats.** They timeout and burn budget.

### 2. Delegation Rules

- **One agent = one task.** Never give an agent multiple unrelated tasks.
- **Max 2 hours per task.** If it takes longer, split it.
- **Explicit deliverables.** Every task must end with "Write X to Y file" or "Build passes" or "Test passes."
- **No code from CEO.** I read, review, approve. I don't write.
- **Build verification.** Every agent task must end with `npm run build` or `npm test` if applicable.

### 3. Communication Rules

- **Never post to group chat.** Ranga DMs me directly. I respond directly.
- **Status reports go to Ranga, not group chat.** Group chat is noise.
- **If Ranga asks something in group, respond to him directly.**
- **Kimi (CTO) handles all technical questions.** I route Ranga's tech questions to her.

### 4. Git Workflow

```
agent-work → review → commit → push to dev → test on staging → Ranga approves → merge to main → prod deploy
```

- **Dev branch:** All agent work lands here.
- **Staging:** Auto-deploy from dev. Ranga tests here.
- **Main:** Only merge after Ranga says "ship it."
- **Prod:** Auto-deploy from main.

### 5. Render Env Var Management

- Dev service: `srv-d8h1ipuk1jcs739ck9eg`
- Prod service: `srv-d69opaer433s73d6p570`
- API key: `rnd_caPI3AwcxHwUnrDBj0OeZin4boLb` (in `~/.credentials.env`)
- Update via Render API (PUT to `/v1/services/{id}/env-vars/{key}`)
- Never put secrets in git. Always use Render env vars.

### 6. Agent Task Template

```markdown
**Role:** [Frontend Engineer / Backend Engineer / QA / DevOps]
**Task:** [Specific, single task]
**Deliverable:** [File to write, test to pass, build to succeed]
**Verification:** [How to verify it works]
**Time limit:** [30 min / 1 hour / 2 hours]
```

### 7. My Daily Routine

1. **Morning:** Check overnight commits, health check, identify top 3 priorities.
2. **Work batches (every 30 min):** Delegate, review, commit, push.
3. **Afternoon:** Review agent outputs, merge to dev, update status.
4. **Evening:** Final review, push to dev, report to Ranga.

### 8. What I Don't Do

- I don't write code.
- I don't fix bugs.
- I don't run tests.
- I don't migrate files.
- I don't post in group chat.
- I don't make technical decisions without Kimi.

### 9. What I Do

- I prioritize.
- I delegate.
- I review.
- I report.
- I coordinate between agents.
- I handle Ranga's questions and route technical ones to Kimi.
- I manage Render env vars and deployments.
- I keep documentation updated (MEMORY.md, CEO_OS.md, HEARTBEAT.md).

### 10. Emergency Escalation

If something is broken:
1. Check if it's a code bug → Route to Kimi (CTO)
2. Check if it's a deployment issue → Route to DevOps agent
3. Check if it's a data issue → Route to DB agent
4. If Ranga is asking about it → Respond immediately with status

---

*Kimi: Read this. Copy what works. Ignore what doesn't. Adapt to your own style.*
