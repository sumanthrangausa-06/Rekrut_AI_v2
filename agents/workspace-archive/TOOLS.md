# TOOLS.md — Local Notes + Skill Mapping for Rekrut AI

> **Document Index:** `DOCUMENT_INDEX.md` — central reference for all project docs

> **Primary Skills: external-skills/ (gstack, agency-agents, defending-code-reference-harness)**
> **Secondary: Built-in system skills (fallback only)**
> **Updated: 2026-06-11**

---

## External Skills Catalog — PRIMARY

### 1. gstack (CEO / Planning / Review / Deploy)

| Skill | Command | File Path | When to Use | Agent Types |
|-------|---------|-----------|-------------|-------------|
| **AutoPlan** | `/autoplan` | `external-skills/gstack/autoplan/SKILL.md` | Full review pipeline (CEO → Design → Eng → DX) | CEO (me) |
| **Health** | `/health` | `external-skills/gstack/health/SKILL.md` | Code quality dashboard (types, linter, tests) | CEO (me), all engineering |
| **Ship** | `/ship` | `external-skills/gstack/ship/SKILL.md` | Run tests, review, push, open PR | CEO (me), devops |
| **Land & Deploy** | `/land-and-deploy` | `external-skills/gstack/land-and-deploy/SKILL.md` | Merge PR, wait for CI, verify production | CEO (me), devops |
| **Security Audit** | `/cso` | `external-skills/gstack/cso/SKILL.md` | OWASP Top 10 + STRIDE audit | CEO (me), security |
| **Browser QA** | `/qa` | `external-skills/gstack/qa/SKILL.md` | Open browser, find bugs, fix, re-verify | CEO (me), QA |
| **Spec** | `/spec` | `external-skills/gstack/spec/SKILL.md` | Turn vague intent into precise executable spec | CEO (me), product |
| **Retro** | `/retro` | `external-skills/gstack/retro/SKILL.md` | Weekly retro with shipping streaks | CEO (me) |
| **Context Save** | `/context-save` | `external-skills/gstack/context-save/SKILL.md` | Save working context for resumption | CEO (me), all agents |
| **Context Restore** | `/context-restore` | `external-skills/gstack/context-restore/SKILL.md` | Resume from saved context | CEO (me), all agents |

### 2. agency-agents (Specialized Subagents — MANDATORY)

**ALWAYS use these. NEVER spawn generic subagents.**

| Agent | File Path | Specialty | When to Spawn |
|-------|-----------|-----------|--------------|
| **frontend-developer** | `external-skills/agency-agents/engineering/engineering-frontend-developer.md` | React, UI, performance | React fixes, UI, responsive |
| **backend-architect** | `external-skills/agency-agents/engineering/engineering-backend-architect.md` | API, database, scalability | Server-side, microservices |
| **mobile-app-builder** | `external-skills/agency-agents/engineering/engineering-mobile-app-builder.md` | iOS, Android, React Native | Mobile UX, responsive |
| **ai-engineer** | `external-skills/agency-agents/engineering/engineering-ai-engineer.md` | ML models, AI integration | AI features, prompts |
| **devops-automator** | `external-skills/agency-agents/engineering/engineering-devops-automator.md` | CI/CD, infrastructure | Pipeline, monitoring, deploy |
| **application-security-engineer** | `external-skills/agency-agents/security/security-application-security-engineer.md` | Security audit, hardening | Security audits, compliance |
| **database-optimizer** | `external-skills/agency-agents/engineering/engineering-database-optimizer.md` | Schema, queries, performance | DB performance |
| **code-reviewer** | `external-skills/agency-agents/engineering/engineering-code-reviewer.md` | Code review, PR checks | Reviewing code changes |
| **model-qa-specialist** | `external-skills/agency-agents/engineering/engineering-model-qa-specialist.md` | E2E tests, Playwright | Testing, automation |
| **incident-responder** | `external-skills/agency-agents/security/security-incident-responder.md` | Incident management | Security incidents, outages |

### 3. defending-code-reference-harness (Security)

| Skill | File Path | When to Use |
|-------|-----------|-------------|
| **Vulnerability Scan** | `external-skills/defending-code-reference-harness/.claude/skills/vuln-scan.md` | Find security vulnerabilities |
| **Threat Model** | `external-skills/defending-code-reference-harness/.claude/skills/threat-model.md` | Analyze threat landscape |
| **Triage** | `external-skills/defending-code-reference-harness/.claude/skills/triage.md` | Triage security findings |
| **Patch** | `external-skills/defending-code-reference-harness/.claude/skills/patch.md` | Fix vulnerabilities |

### 4. memU (Cross-Agent Memory)

| Component | File Path | When to Use |
|-----------|-----------|-------------|
| Memory Service | `external-skills/memU/src/memu/app/service.py` | Building memory features |
| Memorize Flow | `external-skills/memU/src/memu/app/memorize.py` | Store information |
| Retrieve Flow | `external-skills/memU/src/memu/app/retrieve.py` | Retrieve information |
| Workflow Engine | `external-skills/memU/src/memu/workflow/` | Workflow-based features |

### 5. code-review-graph (Complex Reviews)

| Tool | Path | When to Use |
|------|------|-------------|
| Code Review Graph | `external-skills/code-review-graph/` | Complex, multi-file reviews |
| Beads Issue Tracking | `external-skills/code-review-graph/` | Issue tracking during review |

### 6. open-code-review (Automated PR Review)

| Tool | Path | When to Use |
|------|------|-------------|
| Open Code Review | `external-skills/open-code-review/skills/open-code-review/SKILL.md` | CI/CD automated PR review |

### 7. godmode (Single-File Review)

| Tool | Path | When to Use |
|------|------|-------------|
| Godmode Code Reviewer | `external-skills/godmode/agents/code-reviewer.md` | Single-file quick review |

---

## Built-in System Skills — FALLBACK ONLY

Use these ONLY when external skills are unavailable or fail.

| Skill | Path | When to Use | Agent Types |
|-------|------|-------------|-------------|
| browser-automation | `/usr/lib/node_modules/openclaw/skills/browser-automation/SKILL.md` | Browser control, E2E testing | model-qa-specialist, frontend-developer |
| taskflow | `/usr/lib/node_modules/openclaw/skills/taskflow/SKILL.md` | Multi-step background jobs | CEO (me) |
| github | `/usr/lib/node_modules/openclaw/skills/github/SKILL.md` | PRs, issues, CI checks | git-workflow-master, all engineering |
| healthcheck | `/usr/lib/node_modules/openclaw/skills/healthcheck/SKILL.md` | Host security audit | devops-automator, infrastructure |

---

## Agent → Skill Mapping (Updated 2026-06-11)

**Every agent spawn MUST reference BOTH external skills.**

| Agent | Primary External Skill | Secondary External Skill | Task Examples |
|-------|----------------------|------------------------|---------------|
| **devops-automator** | `gstack/health` | `gstack/ship` | Deploy, monitor, health checks |
| **git-workflow-master** | `gstack/ship` | — | Branch merge, PRs, commits |
| **frontend-developer** | `gstack/qa` | `agency-agents/engineering-frontend-developer.md` | React fixes, UI, responsive |
| **backend-architect** | `gstack/health` | `gstack/ship` | API, database, auth |
| **model-qa-specialist** | `gstack/qa` | `agency-agents/engineering-model-qa-specialist.md` | E2E tests, Playwright |
| **application-security-engineer** | `defending-code-reference-harness/vuln-scan.md` | `gstack/cso` | Security audit, compliance |
| **code-reviewer** | `code-review-graph/` | `godmode/code-reviewer.md` | Code review, PR checks |
| **database-optimizer** | `gstack/health` | `agency-agents/engineering-database-optimizer.md` | Schema, queries, performance |
| **ai-engineer** | `agency-agents/engineering-ai-engineer.md` | — | AI features, prompts |
| **content-creator** | `agency-agents/marketing/marketing-content-creator.md` | — | Blogs, docs, copy |
| **growth-hacker** | `agency-agents/marketing/marketing-growth-hacker.md` | — | Marketing, ads, growth |
| **compliance-auditor** | `defending-code-reference-harness/vuln-scan.md` | `gstack/cso` | Compliance, legal |
| **analytics-reporter** | `agency-agents/product/product-analytics-reporter.md` | — | Metrics, dashboards |
| **financial-analyst** | `agency-agents/finance/finance-financial-analyst.md` | — | Pricing, MRR, revenue |
| **mobile-app-builder** | `gstack/qa` | `agency-agents/engineering-mobile-app-builder.md` | Mobile UX, responsive |
| **incident-responder** | `defending-code-reference-harness/vuln-scan.md` | `gstack/cso` | Incident management |

---

## Spawn Template (External Skills — MANDATORY)

**Model Routing:** Pass `model` based on task complexity (see Model Routing section below).

```javascript
sessions_spawn({
  agentId: "<agency-agent-id>",
  model: "<kimi-coding/kimi-for-coding OR kimi-coding/kimi-k3>",  // ← ADD THIS
  task: "You are a <role> for Rekrut AI.\n\n" +
    "**BEFORE STARTING:** Read your agent definition file at " +
    "external-skills/agency-agents/<division>/<agent-file>.md " +
    "AND the relevant skill file at external-skills/gstack/<skill>/SKILL.md " +
    "for guidance on how to approach this work.\n\n" +
    "**WORK TO DO:** <specific task>\n\n" +
    "**COMMIT YOUR WORK:** When complete, run:\n" +
    "git add -A && git commit -m '<type>: <message>'\n\n" +
    "**Location:** /root/.openclaw/workspace/Rekrut_AI_v2/",
  taskName: "<descriptive-name>"
})
```

---

## Model Routing — Complexity-Based (Updated 2026-07-19)

**Rule:** Match the model to the task. Don't burn K3 tokens on trivial work.

| Complexity | Model | Cost | When to Use |
|------------|-------|------|-------------|
| **Easy** | `kimi-coding/kimi-for-coding` (k2.6) | $0.60/M in, $3/M out | Status checks, file reads, simple edits, cron mgmt, basic searches, simple queries, single-file lint fixes |
| **Hard** | `kimi-coding/kimi-k3` | $3/M in, $15/M out | Multi-file refactoring, architecture decisions, security audits, complex debugging, E2E testing, performance analysis, code review, AI feature design |

**Self-Assessment (before spawning or starting work):**
- Does this touch >3 files? → **Hard (K3)**
- Does this require reasoning about trade-offs? → **Hard (K3)**
- Is this a security or production issue? → **Hard (K3)**
- Is this a single command, file read, or simple edit? → **Easy (k2.6)**
- Is this a status check or cron management? → **Easy (k2.6)**

**My direct work (Suga/CEO):**
- Orchestration, planning, spawning agents → **Easy (k2.6)** — I can use the default k2.6 session for this
- Complex architecture review, security analysis → **Hard (K3)** — spawn a subagent or start a new K3 session

**Subagent defaults by type:**
| Agent | Default Model | Reason |
|-------|--------------|--------|
| devops-automator | k2.6 | Deploys, health checks are procedural |
| frontend-developer | K3 | UI/UX requires reasoning |
| backend-architect | K3 | API design is complex |
| code-reviewer | K3 | Code review needs deep reasoning |
| model-qa-specialist | K3 | E2E testing is complex |
| application-security-engineer | K3 | Security is always hard |
| ai-engineer | K3 | AI feature design is hard |
| content-creator | k2.6 | Writing is straightforward |
| business-strategist | K3 | Strategy requires reasoning |

---

## CEO Workflow (Every Heartbeat)

```
1. THINK   → Read context files (CEO_OS, HEARTBEAT, memory, active agents)
2. PLAN    → Read gstack/autoplan, run CEO → Design → Eng → DX review
3. BUILD   → Spawn 2-3 agency-agents with external skill references
4. REVIEW  → Use code-review-graph / open-code-review / godmode
5. TEST    → Read gstack/qa, run browser-based QA + E2E
6. SHIP    → Read gstack/ship, run tests → review → push → PR
7. REFLECT → Read gstack/retro, log what shipped, update memory
```

---

## Credentials & API Access (Rekrut AI)

### Database
- **Neon PostgreSQL**: `DATABASE_URL` in `Rekrut_AI_v2/.env`
- **Usage**: Health checks, schema queries, performance monitoring
- **Agent**: DB-001, DB-002, DO-002

### GitHub
- **API Key**: `~/.credentials.env` (GITHUB_API_KEY)
- **Repo**: `https://github.com/sumanthrangausa-06/Rekrut_AI_v2`
- **Usage**: PR reviews, branch management, issue tracking, commits
- **Agent**: All engineering agents, DO-001

### Render (Deployment)
- **API Key**: `~/.credentials.env` (RENDER_API_KEY)
- **Service**: `rekrutai-dev` (dev environment)
- **Usage**: Deployment status, logs, triggering redeploys
- **Agent**: DO-001, DO-005

### Stripe
- **Status**: ❌ Not available — only test keys in `.env`
- **Needed for**: Live payment testing, webhook validation
- **Agent**: FIN-001, BE-004 (blocked until provided)

---

## Telegram Group Chat Setup

**Group:** `rekrutaicompany` (ID: `-1003797113253`)
**Status:** Both Suga and KimiClaw configured
**Policy:** `requireMention: false`, `groupPolicy: allowlist`

### Suga's Config (server)
- Runtime-managed Telegram config (not in `openclaw.json`)
- `groupAllowFrom: ["6652708323"]` ✅
- `groupPolicy: "allowlist"` ✅
- `requireMention: false` for group `-1003797113253` ✅

### KimiClaw's Config (local)
- Config file: `C:\Users\ranga\.kimi_openclaw\openclaw.json`
- `groupAllowFrom: ["6652708323"]` ✅
- `groupPolicy: "allowlist"` ✅
- `requireMention: false` for both groups ✅

**Note:** Remove old group `-5124699988` from Kimi's config when confirmed no longer needed.

---

## Hard Rules (Updated 2026-07-19)

1. **External skills are PRIMARY.** Built-in skills are fallback only.
2. **I (Suga) MUST read gstack/autoplan before EVERY batch planning.**
3. **I MUST read gstack/health before status checks.**
4. **I MUST read gstack/ship before EVERY deployment.**
5. **Every agent spawn MUST include external skill reference.** Agent must read it first.
6. **Use agency-agents ONLY.** Never spawn generic subagents.
7. **Use memU for cross-agent memory.** Share context between agents.
8. **Use code-review-graph for complex reviews.** Use open-code-review for automated PR review.
9. **Use defending-code-reference-harness for security.** Never skip security skills.
10. **Commit work before spawning next batch.** Never leave work uncommitted.
11. **Max 2-3 agents per batch.** One task each. Avoid timeouts.
12. **If external skill fails, fallback to built-in.** But always try external first.
13. **Model routing by complexity.** Easy tasks → k2.6. Hard tasks → K3. See TOOLS.md Model Routing section.

---

*Last updated: 2026-06-11 02:24 SGT*

## Reference Documents (Check Before Work)

**All docs indexed in `DOCUMENT_INDEX.md`:**

| Category | Files | When to Read |
|----------|-------|-------------|
| **Planning** | `docs/LAUNCH_PLAN.md`, `docs/TECH_ROADMAP_30D.md`, `docs/SPRINT_0_TASKS.md` | Before planning |
| **Security** | `security-audit-report.md`, `security-fix-report.md`, `security-review-staging.md` | Before security work |
| **Deployment** | `DEPLOYMENT_WORKFLOW.md`, `STAGING_WORKFLOW.md`, `prod-deployment-checklist.md` | Before deploy |
| **QA** | `QA-001-e2e-report.md`, `QA_INFRASTRUCTURE_REPORT.md`, `e2e-smoke-test-results.md` | When QA issues |
| **Progress** | `mobile-responsive-progress.md`, `recruiter-analytics-progress.md`, `candidate-search-progress.md` | During feature work |
| **Codebase** | `REKRUT_AI_CODEBASE.md`, `EXTERNAL_SKILLS.md` | When architecture changes |

**Rule: When starting a task, check the relevant doc first.**