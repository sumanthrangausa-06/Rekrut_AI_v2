# Repository Schema - Single Source of Truth

> **For All Agents**: This document defines the canonical structure of the Rekrut AI repository.
> Read this before creating or organizing any files.

**Last Updated:** 2026-08-06

---

## Repository Root Structure

```
Rekrut_AI_v2/
├── SCHEMA.md              # THIS FILE - Single source of truth for structure
├── README.md              # Project overview
├── AGENTS.md              # Agent utilization status (brief)
├── HEARTBEAT.md           # System status tracking
│
├── agents/                # Agent workspace (see Agent Schema below)
├── docs/                  # All documentation (see Docs Schema below)
├── client/                # React frontend application
├── server/                # Backend server code
├── routes/                # API route handlers
├── services/              # Business logic services
├── lib/                   # Shared libraries
├── migrations/            # Database migrations
├── scripts/               # Utility scripts
├── e2e/                   # E2E tests and results
├── issues/                # Issue tracking
├── public/                # Static assets (legacy)
└── .github/               # GitHub workflows
```

---

## Documentation Schema (`docs/`)

All documentation lives in `docs/` with these subfolders:

```
docs/
├── README.md              # Documentation index with quick links
│
├── architecture/          # System design documents
│   ├── ARCHITECTURE_CURRENT.md
│   ├── ARCHITECTURE_TARGET.md
│   └── ARCHITECTURE_MERGE_GUIDE.md
│
├── deployment/            # Deployment documentation
│   ├── logs/              # Historical deployment logs (YYYY-MM-DD-*.md)
│   ├── deployment-checklist.md    # Main checklist
│   ├── prod-deploy-runbook.md     # Production runbook
│   └── render-env-vars.md         # Environment variables
│
├── security/              # Security documentation
│   ├── SECURITY_AUDIT_REPORT.md   # Latest comprehensive audit
│   ├── prod-security-checklist.md # Production checklist
│   └── SECURITY_AUDIT_YYYY-MM-DD.md  # Dated audits
│
├── qa/                    # QA and testing
│   ├── QA_TEST_PLAN.md    # Test planning
│   ├── QA_CHECKLIST.md    # QA checklist
│   ├── TESTING.md         # Testing guide
│   └── E2E_*.md           # E2E test reports
│
├── analysis/              # Technical analysis
│   ├── COMPETITIVE_ANALYSIS_YYYY.md
│   ├── *-analysis.md      # Technical analyses
│   └── *_AUDIT.md         # Audit reports
│
├── reports/               # Business reports
│   ├── CEO_STRATEGIC_REPORT.md
│   ├── BUSINESS_ROADMAP_*.md
│   └── *_REPORT.md        # Various reports
│
└── guides/                # Workflows and guides
    ├── WORKFLOW.md        # Development workflow
    ├── FRONTEND_MIGRATION.md
    ├── FEATURE_MAP.md
    ├── TASKS.md           # Task tracking
    ├── COORDINATION.md    # Agent coordination
    └── GET_API_KEYS.md    # Setup guides
```

### Documentation Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Primary docs | `SCREAMING_CASE.md` | `ARCHITECTURE_CURRENT.md` |
| Dated reports | `TITLE_YYYY-MM-DD.md` | `SECURITY_AUDIT_2026-06-09.md` |
| Technical docs | `kebab-case.md` | `prod-deploy-runbook.md` |
| Deployment logs | `YYYY-MM-DD-hash-env.md` | `2026-07-05-d5719b1-staging.md` |

---

## Agent Schema (`agents/`)

All agent-related files live in `agents/`:

```
agents/
├── README.md              # Agent workspace overview
├── AGENT_BRIEFING.md      # Onboarding briefing for new agents
├── AGENT_COMPANY.md       # Company context and culture
├── AGENT_PROTOCOL.md      # Mandatory rules for all agents
│
├── shared/                # Shared across all agents
│   ├── AGENTS.md          # Shared agent guidelines
│   ├── HEARTBEAT.md       # Shared heartbeat state
│   ├── IDENTITY.md        # Shared identity patterns
│   ├── SOUL.md            # Agent soul/personality
│   ├── TOOLS.md           # Available tools
│   ├── USER.md            # User context
│   ├── CEO_OS.md          # CEO operating system
│   ├── tasks/             # Shared task tracking
│   │   ├── TEMPLATE.md    # Task template
│   │   └── TASK-###-*.md  # Individual tasks
│   └── progress/          # Progress reports
│       └── YYYY-MM-DD-agent.md
│
└── <agent-name>/          # Individual agent folders
    ├── IDENTITY.md        # Agent-specific identity
    ├── SOUL.md            # Agent-specific personality
    ├── MEMORY.md          # Long-term memory (private)
    ├── HEARTBEAT.md       # Agent heartbeat state
    ├── TOOLS.md           # Agent-specific tools
    └── USER.md            # Agent-specific user context
```

### Agent File Templates

#### Task File (`agents/shared/tasks/TASK-###-*.md`)
```markdown
# Task ID: TASK-###
## Title: [Short description]
## Created: [YYYY-MM-DD]
## Created By: [Agent name]

### Status
- [ ] Open
- [ ] In Progress
- [ ] Blocked
- [ ] Done

### Assigned To
- Primary: [Agent name]
- Support: [Agent name, if any]

### Description
[What needs to be done]

### Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

### Dependencies
- None / TASK-XXX

### Notes
[Any context, links, references]

### Progress Log
- [YYYY-MM-DD HH:MM] [Agent] — [What was done]
```

#### Progress Report (`agents/shared/progress/YYYY-MM-DD-agent.md`)
```markdown
# Progress Report: [Agent Name]
**Date:** YYYY-MM-DD

## Completed Today
- [ ] Task 1
- [ ] Task 2

## In Progress
- Task being worked on

## Blockers
- Any blockers

## Next Steps
- Planned work

## Notes
- Additional context
```

---

## Issue Schema (`issues/`)

```
issues/
└── ISSUE-###-description.md
```

### Issue File Template
```markdown
# ISSUE-###: [Title]

**Created:** YYYY-MM-DD
**Status:** Open | In Progress | Resolved | Closed
**Priority:** Critical | High | Medium | Low
**Assignee:** [Agent/Person]

## Description
[What's the issue]

## Steps to Reproduce
1. Step 1
2. Step 2

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Resolution
[How it was fixed - fill in when resolved]
```

---

## E2E Test Schema (`e2e/`)

```
e2e/
├── README.md              # E2E test documentation
├── *.spec.ts              # Test files
├── BUG_REPORT.md          # Bug tracking
├── E2E_TEST_RESULTS.md    # Latest results
├── results.md             # Quick results
├── test-results-summary.md
└── screenshots/           # Test screenshots
```

---

## Git Workflow

### Branch Strategy
```
main        # Production-ready code (protected)
└── dev     # Development branch (default work branch)
    └── feature/*  # Feature branches
```

### Commit Message Format
```
type: brief description

Types:
- feat:     New feature
- fix:      Bug fix
- docs:     Documentation changes
- test:     Test changes
- refactor: Code refactoring
- chore:    Maintenance tasks
- ops:      Operations/deployment
```

---

## File Location Decision Tree

```
Is it documentation?
├── Yes → docs/
│   ├── Architecture design? → docs/architecture/
│   ├── Deployment/ops? → docs/deployment/
│   ├── Security? → docs/security/
│   ├── QA/testing docs? → docs/qa/
│   ├── Analysis/audit? → docs/analysis/
│   ├── Business report? → docs/reports/
│   └── Guide/workflow? → docs/guides/
└── No
    ├── Agent-related? → agents/
    │   ├── Shared across agents? → agents/shared/
    │   └── Specific agent? → agents/<agent-name>/
    ├── Issue tracking? → issues/
    ├── E2E test related? → e2e/
    └── Code? → Appropriate source folder
```

---

## Cross-References

When referencing files in documentation, use relative paths from repo root:

```markdown
See [Architecture](docs/architecture/ARCHITECTURE_CURRENT.md)
See [Agent Protocol](agents/AGENT_PROTOCOL.md)
See [Task Template](agents/shared/tasks/TEMPLATE.md)
```

---

## Maintenance

### When Adding New Files
1. Check this schema for the correct location
2. Follow naming conventions for the category
3. Update relevant README.md if adding a new category

### When Reorganizing
1. Update this SCHEMA.md first
2. Move files to new locations
3. Update cross-references in affected files
4. Update docs/README.md quick links

---

## Version History

| Date | Change | Author |
|------|--------|--------|
| 2026-08-06 | Initial schema creation | Agent |
