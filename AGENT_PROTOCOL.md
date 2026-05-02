# Rekrut AI - Agent Protocol

## 🚨 MANDATORY RULES FOR ALL AGENTS

### 1. BRANCH RULES
```
✅ ALWAYS work on 'dev' branch
❌ NEVER push directly to 'main'

Workflow:
1. git checkout dev
2. git pull origin dev
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
- /home/workspace/Rekrut_AI_v2/TASKS.md
- /home/workspace/Rekrut_AI_v2/COORDINATION.md
- /home/workspace/Rekrut_AI_v2/KNOWLEDGE.md

Reference Files (READ ONLY):
- /home/workspace/Rekrut_AI_v2/GAP_ANALYSIS.md
- /home/workspace/Rekrut_AI_v2/FEATURE_MAP.md
- /home/workspace/Rekrut_AI_v2/ARCHITECTURE_CURRENT.md
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
