# Rekrut AI - Agent Protocol

> **Required Reading:** Before any work, also read [SCHEMA.md](../SCHEMA.md) for repository structure.

## 🚨 MANDATORY RULES FOR ALL AGENTS

### 0. STARTUP - CHECK FOR NEW COMMITS
```
⚠️ BEFORE doing ANY work, always sync with remote:

1. git fetch origin
2. git status (check if behind remote)
3. git pull origin <current-branch>

This ensures you have the latest changes from other agents.
If there are merge conflicts, resolve them before proceeding.
```

### 1. BRANCH RULES
```
✅ ALWAYS work on 'dev' branch
❌ NEVER push directly to 'main'

Workflow:
1. git fetch origin && git pull origin dev
2. git checkout dev
3. Make changes
4. git add . && git commit -m "type: description"
5. git push origin dev
6. Create Pull Request to main
```

### 2. COORDINATION RULES
```
BEFORE starting work:
1. Read COORDINATION.md - see what others are doing
2. Read TASKS.md - pick up available tasks
3. Write your plan to COORDINATION.md under "Active Work"

AFTER finishing work:
1. Update TASKS.md - mark task complete
2. Update COORDINATION.md - move from "Active" to "Completed"
3. Create PR with description of changes
```

### 3. FILE PATHS
```
Shared Files (ALL agents read/write):
- docs/guides/TASKS.md
- docs/guides/COORDINATION.md

Reference Files (READ ONLY):
- docs/analysis/GAP_ANALYSIS.md
- docs/guides/FEATURE_MAP.md
- docs/architecture/ARCHITECTURE_CURRENT.md

Documentation Structure:
- docs/README.md              - Documentation index
- docs/architecture/          - System architecture
- docs/deployment/            - Deployment docs
- docs/security/              - Security audits
- docs/qa/                    - QA and testing
- docs/analysis/              - Technical analysis
- docs/reports/               - Business reports
- docs/guides/                - Workflows and guides
```

### 4. COMMIT MESSAGE FORMAT
```
type: brief description

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation
- test: Tests
- refactor: Code refactoring
- chore: Maintenance

Examples:
- feat: Add email notifications
- fix: Correct SQL migration syntax
- docs: Update API documentation
```

### 5. PULL REQUEST FORMAT
```
## What Changed
- Bullet list of changes

## Why
- Business reason

## Testing
- How tested

## Screenshots (if UI)
- Before/After

## Checklist
- [ ] Tests pass
- [ ] No breaking changes
- [ ] Updated documentation
```

### 6. NEVER DO
```
❌ Push to main directly
❌ Delete files without asking
❌ Change database schema without migration
❌ Modify another agent's code without coordination
❌ Skip writing to COORDINATION.md
```
