# Documentation Structure

This folder contains all project documentation organized by category.

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
- `/e2e/` - E2E test results and bug reports
- `/.claude/skills/` - Claude skill definitions

## Naming Conventions

- Use `SCREAMING_CASE.md` for primary documentation
- Use `kebab-case.md` for dated reports and secondary docs
- Prefix dated docs with `YYYY-MM-DD-` for chronological sorting
