# Documentation Structure

> **Canonical Structure:** See [SCHEMA.md](../SCHEMA.md) for the complete repository schema.
> **Code Overview:** See [CODE_REVIEW_GRAPH.md](CODE_REVIEW_GRAPH.md) for visual codebase navigation.
> **Task Skills:** See [GSTACK_SKILLS.md](GSTACK_SKILLS.md) for gstack skill-to-task mapping.

This folder contains all project documentation organized by category.

---

## Project Status & Plan (as of 2026-08-06)

**Product:** HireLoop (Rekrut AI) — AI-native recruitment platform
**Founder:** Ranga Sumanth, solo founder + distributed AI agent team ("Suga" CEO agent, "Kimiclaw" CTO agent)
**Target:** Launch August 15, 2026 · $5,000 MRR / 25 paying customers in 90 days

### Where we are
- Core platform (candidate/recruiter/admin dashboards, OmniScore, TrustScore, AI matching, interviews, payroll, onboarding, compliance) is feature-complete on `dev`/`staging`.
- Production is live at **rekrutai.co** (Render). Multiple prod-deploy and staging-500 incidents have been diagnosed and fixed — see `deployment/` for the incident history.
- E2E test suite (Playwright) covers auth, payment, navigation, recruiter, candidate, and mobile-responsive flows (`10bea4a`), but full-suite runs are still constrained by browser resource limits (SIGKILL) — CI runs per-file/matrix as a workaround.
- Security: npm audit vulnerabilities patched (body-parser, brace-expansion, js-yaml); admin default credentials hardening is tracked as a launch blocker (GitHub issue [#42](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/42)).
- Recent work: free-vs-pro tier feature gating, mobile responsive passes, Biome lint cleanup, missing React import fixes across 20 components.
- **Known open issue:** E2E admin auth test failing with 401 on staging (GitHub issue [#66](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/66)) — admin password likely changed from default.

### The plan (see full docs)
1. **Ship launch-blockers** — see GitHub issues labeled `P0`/`launch-blocker` (admin credentials, UI polish passes, Stripe live-mode validation, candidate search).
2. **Finish QA phases** — [`qa/QA_MASTER_TRACKER.md`](qa/QA_MASTER_TRACKER.md) defines an 8-phase QA plan (Auth → Candidate → Recruiter → Payments → Extended Features → Admin → Mobile → Security/Perf). Phase 1 was in progress as of 2026-07-08; this session extends it with live browser QA (see `qa/` for new phase reports).
3. **Performance & polish** — bundle optimization (1.55MB main chunk), image assets strategy, mobile responsive completion. See [`reports/TECH_ROADMAP_30D.md`](reports/TECH_ROADMAP_30D.md).
4. **Compliance & monitoring** — EU AI Act dashboard, uptime monitoring, backup/DR verification. See GitHub issues [#50](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/50), [#51](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/51), [#46](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/46).
5. **Go-to-market** — see [`reports/BUSINESS_ROADMAP_30D.md`](reports/BUSINESS_ROADMAP_30D.md) for positioning, pricing, and GTM plan.

### Key planning docs
| Doc | What it covers |
|-----|-----------------|
| [`reports/BUSINESS_ROADMAP_30D.md`](reports/BUSINESS_ROADMAP_30D.md) | Business strategy, positioning, pricing, GTM |
| [`reports/TECH_ROADMAP_30D.md`](reports/TECH_ROADMAP_30D.md) | 30-day engineering roadmap, day-by-day tasks |
| [`reports/CEO_LAUNCH_PLAN.md`](reports/CEO_LAUNCH_PLAN.md) | Launch plan and milestones |
| [`reports/SPRINT_0_TASKS.md`](reports/SPRINT_0_TASKS.md) | Sprint 0 task breakdown |
| [`qa/QA_MASTER_TRACKER.md`](qa/QA_MASTER_TRACKER.md) | 8-phase QA plan and findings log |
| [`analysis/REKRUT_AI_CODEBASE.md`](analysis/REKRUT_AI_CODEBASE.md) | Codebase deep-dive |
| GitHub Issues | Live backlog — 40+ open issues labeled by priority (P0/P1/P2) and area |

## Folder Structure

```
docs/
├── README.md                    # This file
├── architecture/                # System architecture documentation
│   ├── ARCHITECTURE_CURRENT.md  # Current system architecture
│   ├── ARCHITECTURE_TARGET.md   # Target/planned architecture
│   └── ARCHITECTURE_MERGE_GUIDE.md
│
├── deployment/                  # Deployment documentation
│   ├── logs/                    # Deployment history logs
│   ├── deployment-checklist.md  # Main deployment checklist
│   ├── prod-deploy-runbook.md   # Production deployment runbook
│   ├── render-env-vars.md       # Render environment variables
│   └── ...                      # Other deployment docs
│
├── security/                    # Security documentation
│   ├── SECURITY_AUDIT_REPORT.md # Latest security audit
│   ├── prod-security-checklist.md
│   └── ...                      # Security audits by date
│
├── qa/                          # QA and testing documentation
│   ├── QA_TEST_PLAN.md          # Test planning
│   ├── QA_CHECKLIST.md          # QA checklist
│   ├── TESTING.md               # Testing guide
│   └── ...                      # E2E test reports
│
├── analysis/                    # Analysis and audit reports
│   ├── COMPETITIVE_ANALYSIS_2026.md
│   ├── database-analysis.md
│   ├── frontend-analysis.md
│   ├── ai-services-analysis.md
│   └── ...                      # Other analysis docs
│
├── reports/                     # Business and status reports
│   ├── CEO_STRATEGIC_REPORT.md
│   ├── BUSINESS_ROADMAP_30D.md
│   ├── PRODUCTION_READINESS_ASSESSMENT_2026-06-09.md
│   └── ...                      # Other reports
│
└── guides/                      # Guides and workflows
    ├── FRONTEND_MIGRATION.md    # Frontend migration guide
    ├── WORKFLOW.md              # Development workflow
    ├── FEATURE_MAP.md           # Feature mapping
    ├── GET_API_KEYS.md          # API key setup guide
    └── ...                      # Other guides
```

## Quick Links

### Getting Started
- [Project README](../README.md) - Project overview
- [Workflow Guide](guides/WORKFLOW.md) - Development workflow
- [API Keys Setup](guides/GET_API_KEYS.md) - Setting up API keys

### Architecture
- [Current Architecture](architecture/ARCHITECTURE_CURRENT.md)
- [Target Architecture](architecture/ARCHITECTURE_TARGET.md)

### Deployment
- [Deployment Checklist](deployment/deployment-checklist.md)
- [Production Runbook](deployment/prod-deploy-runbook.md)
- [Render Environment Variables](deployment/render-env-vars.md)

### Development
- [Frontend Migration](guides/FRONTEND_MIGRATION.md) - React migration status
- [Feature Map](guides/FEATURE_MAP.md) - Feature overview
- [UI Version Control](guides/UI_VERSION_CONTROL.md)

### Testing & QA
- [QA Test Plan](qa/QA_TEST_PLAN.md)
- [QA Checklist](qa/QA_CHECKLIST.md)
- [Testing Guide](qa/TESTING.md)

### Security
- [Security Audit Report](security/SECURITY_AUDIT_REPORT.md)
- [Production Security Checklist](security/prod-security-checklist.md)

### Analysis & Reports
- [Competitive Analysis 2026](analysis/COMPETITIVE_ANALYSIS_2026.md)
- [CEO Strategic Report](reports/CEO_STRATEGIC_REPORT.md)
- [Business Roadmap](reports/BUSINESS_ROADMAP_30D.md)

## Other Documentation Locations

- `/agents/` - AI agent documentation and protocols
  - `/agents/shared/agent-artifacts/` - Automated agent test/queue artifacts (not project docs; kept for audit trail)
  - `/agents/workspace-archive/` - Historical agent identity/memory files synced from an agent's home workspace (SOUL.md, IDENTITY.md, USER.md, TOOLS.md, HEARTBEAT.md, MEMORY.md, CEO_OS.md) — superseded by canonical files in `/agents/shared/`
- `/e2e/` - E2E test results and bug reports
- `/.claude/skills/` - Claude skill definitions

> **Note (2026-08-06):** A bulk workspace sync (commit `1c1dfab`) dumped 90+ files flat into `docs/`. They have since been re-sorted into the folders above per [SCHEMA.md](../SCHEMA.md). If you're an agent syncing workspace files in the future, place them directly into the correct subfolder instead of `docs/` root.

## Naming Conventions

- Use `SCREAMING_CASE.md` for primary documentation
- Use `kebab-case.md` for dated reports and secondary docs
- Prefix dated docs with `YYYY-MM-DD-` for chronological sorting
