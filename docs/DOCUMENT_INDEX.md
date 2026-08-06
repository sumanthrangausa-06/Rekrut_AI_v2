# Rekrut AI — Document Index (Master Reference)

> **Purpose:** Central index of ALL documents created for Rekrut AI.  
> **Rule:** When creating new docs, add them here. When referencing work, check this index first.  
> **Updated:** 2026-06-11

---

## Core Operating Files (Read Every Heartbeat)

| File | Purpose | When to Read |
|------|---------|-------------|
| `AGENTS.md` | Skill references, agent rules, hard rules | Every heartbeat |
| `CEO_OS.md` | CEO workflow, spawn templates, current status | Every heartbeat |
| `TOOLS.md` | External skills catalog, agent mappings | When spawning agents |
| `HEARTBEAT.md` | Status dashboard, sprint progress | Every heartbeat |
| `MEMORY.md` | Long-term memory, curated knowledge | When context needed |
| `USER.md` | User preferences, work method | When in doubt |
| `SOUL.md` | Identity, personality | When needed |

---

## Codebase & Architecture

| File | Purpose | Size |
|------|---------|------|
| `REKRUT_AI_CODEBASE.md` | Full architecture map, repo structure, API docs | 24 KB |
| `EXTERNAL_SKILLS.md` | External skills catalog (8 repos, 438+ files) | 45 KB |

---

## Planning & Strategy (docs/)

| File | Purpose | When to Read |
|------|---------|-------------|
| `docs/LAUNCH_PLAN.md` | Launch strategy, milestones, go-to-market | Before planning |
| `docs/TECH_ROADMAP_30D.md` | 30-day technical roadmap | Before technical decisions |
| `docs/SPRINT_0_TASKS.md` | Sprint 0 task breakdown | Before sprint planning |
| `docs/ORG_STRUCTURE.md` | Agent company org chart | When spawning agents |
| `docs/SUGA_WORKFLOW.md` | CEO agent workflow specifics | When orchestrating |
| `docs/DAILY_OPS.md` | Daily operations checklist | Morning checks |
| `docs/TESTING_PLAN.md` | Production testing plan (15 categories) | Before testing |
| `docs/CARTESIA_INTEGRATION_ANALYSIS.md` | Cartesia AI voice integration | When working on AI features |
| `docs/CARTESIA_VISILY_ANALYSIS.md` | Visily design tool analysis | When working on UI/UX |
| `docs/IMAGE_AUDIT.md` | Image/asset audit | When reviewing assets |

---

## Security & Compliance

| File | Purpose | When to Read |
|------|---------|-------------|
| `security-audit-report.md` | Full security audit findings | Before security work |
| `security-fix-report.md` | Security fix status tracking | After security fixes |
| `security-incident-report-github-pat.md` | GitHub PAT security incident | When setting up GitHub |
| `security-review-staging.md` | Staging security review | Before staging deploy |
| `SECURITY_PAT_FIX_REPORT.md` | PAT fix procedures | When fixing PAT issues |
| `eu-ai-act-completion.md` | EU AI Act compliance status | When working on compliance |

---

## Deployment & Operations

| File | Purpose | When to Read |
|------|---------|-------------|
| `DEPLOYMENT_WORKFLOW.md` | Deployment process | Before every deploy |
| `DEPLOYMENT_PIPELINE_REPORT.md` | CI/CD pipeline status | When pipeline issues |
| `STAGING_WORKFLOW.md` | Staging environment workflow | Before staging work |
| `staging-to-prod-deployment-runbook.md` | Production deployment runbook | Before prod deploy |
| `prod-deployment-checklist.md` | Pre-deploy checklist | Before any deploy |
| `PROD_DEPLOYMENT_CHECKLIST_JUNE19.md` | June 19 specific checklist | When planning June 19 deploy |
| `prod-deployment-readiness.md` | Deployment readiness status | Before deploy decision |
| `prod-readiness-check.md` | Production readiness criteria | When evaluating readiness |
| `prod-service-config-fix.md` | Production service config | When fixing prod config |
| `prod-status-report.md` | Current production status | When checking prod health |
| `PRODUCTION_READINESS.md` | Overall production readiness | Before launch decision |
| `prod-debug-report.md` | Production debugging log | When prod issues occur |
| `GIT_WORKFLOW.md` | Git branching strategy | When managing branches |
| `GITHUB_WORKFLOW.md` | GitHub issues/PRs workflow | When using GitHub |

---

## QA & Testing

| File | Purpose | When to Read |
|------|---------|-------------|
| `QA-001-e2e-report.md` | E2E test report (QA-001 agent) | When E2E issues |
| `QA-002-sigkill-fix-report.md` | SIGKILL fix report | When memory issues |
| `QA_INFRASTRUCTURE_REPORT.md` | QA infrastructure setup | When setting up QA |
| `e2e-smoke-test-results.md` | E2E smoke test results | After E2E runs |
| `staging-qa-report.md` | Staging QA results | After staging QA |

---

## Progress Tracking

| File | Purpose | When to Read |
|------|---------|-------------|
| `mobile-responsive-audit-report.md` | Mobile responsive audit findings | Before mobile work |
| `mobile-responsive-progress.md` | Mobile responsive progress | During mobile work |
| `recruiter-analytics-progress.md` | Recruiter analytics progress | During analytics work |
| `candidate-search-progress.md` | Candidate search progress | During search work |
| `ui-audit-roadmap.md` | UI audit and roadmap | When planning UI work |
| `VISILY_GAP_ANALYSIS.md` | Visily gap analysis | When working on UI gaps |
| `build-verification-report.md` | Build verification status | After builds |
| `autonomous-work-log.md` | Autonomous work history | When checking past work |
| `ceo-decision-brief.md` | CEO decisions log | When reviewing decisions |
| `bulk-status-api-report.md` | Bulk status API report | When working on APIs |

---

## Reports & Analysis

| File | Purpose | When to Read |
|------|---------|-------------|
| `CEO_LAUNCH_PLAN.md` | CEO launch plan specifics | Before launch planning |
| `CMO_TASK_STRUCTURE.md` | CMO agent task structure | When marketing work |

---

## How to Use This Index

1. **Before starting work:** Check this index to see if a relevant doc exists
2. **After creating a doc:** Add it to this index immediately
3. **During heartbeat:** Reference relevant docs from the index
4. **Never delete:** These docs are the project memory

## Key Rule

**When code changes, update these docs:**
- `REKRUT_AI_CODEBASE.md` — Architecture changes
- Relevant progress docs — Feature progress
- `HEARTBEAT.md` — Sprint status
- `CEO_OS.md` — Current status

**Use code-review-graph skills to detect changes and update docs automatically.**
