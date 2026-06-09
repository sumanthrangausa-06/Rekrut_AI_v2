# TOOLS.md - Local Notes + Skill Mapping for Rekrut AI

## Skills Catalog — Where They Live

### Core Skills (System-wide)
| Skill | Path | When to Use | Agent Types |
|---|---|---|---|
| **healthcheck** | `/usr/lib/node_modules/openclaw/skills/healthcheck/SKILL.md` | Host security audit, service monitoring, deployment health checks | devops-automator, infrastructure-maintainer |
| **github** | `/usr/lib/node_modules/openclaw/skills/github/SKILL.md` | PRs, issues, CI checks, releases, repo management | git-workflow-master, all engineering |
| **taskflow** | `/usr/lib/node_modules/openclaw/skills/taskflow/SKILL.md` | Multi-step background jobs, orchestration, waiting on external tasks | CEO (me), orchestrator agents |
| **browser-automation** | `/usr/lib/node_modules/openclaw/skills/browser-automation/SKILL.md` | Browser control, E2E testing, Playwright, UI automation | model-qa-specialist, frontend-developer |

### Plugin Skills (User-installed)
| Skill | Path | When to Use | Agent Types |
|---|---|---|---|
| **wecom-preflight** | `~/.openclaw/plugin-skills/wecom-preflight/SKILL.md` | Validate before WeCom API calls | any WeCom integration |
| **wecom-msg** | `~/.openclaw/plugin-skills/wecom-msg/SKILL.md` | Send WeCom messages | marketing, growth agents |

### Workspace Skills (Custom)
| Skill | Path | When to Use | Agent Types |
|---|---|---|---|
| **seo-audit** | `~/.openclaw/skills/seo-audit/SKILL.md` | Site-wide SEO analysis | marketing, content agents |
| **md-to-pdf** | `~/.openclaw/skills/md-to-pdf/SKILL.md` | Generate PDFs from markdown | documentation, reporting |
| **process-doc** | `~/.openclaw/skills/process-doc/SKILL.md` | Document processes | documentation agents |
| **content-research-writer** | `~/.openclaw/skills/content-research-writer/SKILL.md` | Research + write content | content creator, marketing |
| **copywriting** | `~/.openclaw/skills/copywriting/SKILL.md` | Ad copy, marketing text | content creator, growth hacker |
| **campaign-plan** | `~/.openclaw/skills/campaign-plan/SKILL.md` | Marketing campaign planning | growth hacker, marketing |
| **pricing-strategy** | `~/.openclaw/skills/pricing-strategy/SKILL.md` | Pricing analysis | financial analyst, product |
| **saas-metrics-coach** | `~/.openclaw/skills/saas-metrics-coach/SKILL.md` | SaaS metrics tracking | analytics, product |
| **churn-prevention** | `~/.openclaw/skills/churn-prevention/SKILL.md` | Churn analysis | product, growth |
| **legal-risk-assessment** | `~/.openclaw/skills/legal-risk-assessment/SKILL.md` | Legal compliance | compliance auditor, legal |
| **theme-factory** | `~/.openclaw/skills/theme-factory/SKILL.md` | UI theme generation | frontend developer, design |
| **daily-report** | `~/.openclaw/skills/daily-report/SKILL.md` | Daily reports | CEO (me), reporting |

## Agent → Skill Mapping (Mandatory)

Every agent spawn MUST reference the relevant skill. No exceptions.

| Agent | Primary Skill | Secondary Skill | Task Examples |
|---|---|---|---|
| **devops-automator** | `healthcheck` | `github` | Deploy, monitor, health checks |
| **git-workflow-master** | `github` | — | Branch merge, PRs, commits |
| **frontend-developer** | `browser-automation` | `theme-factory` | React fixes, UI, responsive |
| **backend-architect** | `healthcheck` | `github` | API, database, auth |
| **model-qa-specialist** | `browser-automation` | — | E2E tests, Playwright |
| **application-security-engineer** | `healthcheck` | `legal-risk-assessment` | Security audit, compliance |
| **code-reviewer** | `github` | — | Code review, PR checks |
| **database-optimizer** | `healthcheck` | — | Schema, queries, performance |
| **ai-engineer** | `content-research-writer` | — | AI features, prompts |
| **content-creator** | `content-research-writer` | `copywriting` | Blogs, docs, copy |
| **growth-hacker** | `campaign-plan` | `copywriting` | Marketing, ads, growth |
| **compliance-auditor** | `legal-risk-assessment` | `healthcheck` | Compliance, legal |
| **analytics-reporter** | `saas-metrics-coach` | `daily-report` | Metrics, dashboards |
| **financial-analyst** | `pricing-strategy` | `saas-metrics-coach` | Pricing, MRR, revenue |
| **mobile-app-builder** | `browser-automation` | `theme-factory` | Mobile UX, responsive |
| **inclusive-visuals-specialist** | `theme-factory` | — | Accessibility, design |
| **incident-responder** | `healthcheck` | `taskflow` | Incident management |

## Spawn Template (Always Include Skill Reference)

```
sessions_spawn({
  agentId: "<agent-id>",
  task: "You are a <role> for Rekrut AI.

  **BEFORE STARTING:** Read the skill file at <skill-path> for guidance on how to approach this work.
  
  **WORK TO DO:** <specific task>
  
  **Location:** /root/.openclaw/workspace/Rekrut_AI_v2/",
  taskName: "<descriptive-name>"
})
```

## Example Spawns with Skills

### DevOps Task
```javascript
sessions_spawn({
  agentId: "devops-automator",
  task: "You are a DevOps engineer for Rekrut AI.\n\n**BEFORE STARTING:** Read the skill file at /usr/lib/node_modules/openclaw/skills/healthcheck/SKILL.md for guidance on deployment health checks and monitoring.\n\n**WORK TO DO:** Fix staging auto-deploy. Check Render status, investigate why staging is 18 commits behind.\n\n**Location:** /root/.openclaw/workspace/Rekrut_AI_v2/",
  taskName: "staging-deploy-fix"
})
```

### Frontend Task
```javascript
sessions_spawn({
  agentId: "frontend-developer",
  task: "You are a frontend developer for Rekrut AI.\n\n**BEFORE STARTING:** Read the skill file at /usr/lib/node_modules/openclaw/skills/browser-automation/SKILL.md for guidance on testing and browser automation.\n\n**WORK TO DO:** Fix TypeScript errors in recruiter/candidates.tsx and register.tsx.\n\n**Location:** /root/.openclaw/workspace/Rekrut_AI_v2/",
  taskName: "typescript-fix"
})
```

### Git Task
```javascript
sessions_spawn({
  agentId: "git-workflow-master",
  task: "You are a Git workflow engineer for Rekrut AI.\n\n**BEFORE STARTING:** Read the skill file at /usr/lib/node_modules/openclaw/skills/github/SKILL.md for guidance on PRs, branches, and merges.\n\n**WORK TO DO:** Reconcile main and dev branches. 13 commits diverged each way.\n\n**Location:** /root/.openclaw/workspace/Rekrut_AI_v2/",
  taskName: "branch-merge"
})
```

## Hard Rule (Updated 2026-06-09)

1. **I (Suga) MUST read the relevant SKILL.md before delegating** — so I know what guidance the agent will receive
2. **Every agent spawn MUST include a skill reference** in the task briefing — agent must read it first
3. **If a task doesn't match a skill, I should still find the closest one** — never spawn without skill reference
4. **Skills are not optional** — they are the standard operating procedure
5. **Document new skills here** as they are discovered or installed

---

## Credentials & API Access (Rekrut AI)

### Database
- **Neon PostgreSQL**: `DATABASE_URL` in `Rekrut_AI_v2/.env`
- **Usage**: Health checks, schema queries, performance monitoring
- **Agent**: DB-001, DB-002, DO-002

### GitHub
- **API Key**: `~/.credentials.env` (GITHUB_API_KEY)
- **Repo**: `sumanthrangausa-06/Rekrut_AI_v2`
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

## Quick Commands

```bash
# Check dev deployment status
render-status() { curl -s -H "Authorization: Bearer $RENDER_API_KEY" https://api.render.com/v1/services | grep -A5 rekrutai-dev; }

# Check latest commits
gh-commits() { git log --oneline -5; }

# Quick db health check
db-health() { psql "$DATABASE_URL" -c "SELECT NOW(), count(*) FROM users;" }
```
