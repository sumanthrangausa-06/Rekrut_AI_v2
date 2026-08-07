# Rekrut AI - Pre-Deploy Checklist

## 🚨 MUST PASS BEFORE MERGE TO MAIN

### 1. Code Quality Checks
```bash
# Run these in repository root
npm run lint           # Check code style
npm run test            # Run unit tests
node -c server.js       # Syntax check
node -c routes/*.js     # All routes valid
```

### 2. Database Migration Checks
```bash
# Verify migration syntax
node migrations/XXX_migration.js --dry-run

# Check for:
- Valid SQL syntax
- No duplicate migration numbers
- Foreign keys reference existing tables
```

### 3. API Health Checks (After Dev Deploy)
```bash
# Test critical endpoints
curl https://rekrut-ai.onrender.com/health
curl https://rekrut-ai.onrender.com/api/auth/me
curl https://rekrut-ai.onrender.com/api/jobs
```

### 4. Security Checks
- [ ] No secrets in code
- [ ] No hardcoded passwords
- [ ] Input validation on all endpoints
- [ ] Auth middleware on protected routes

### 5. Performance Checks
- [ ] No N+1 queries
- [ ] Database indexes on foreign keys
- [ ] API response time < 500ms

---

## 📋 QA Agent Pre-Merge Protocol

### Step 1: Code Review
```bash
cd /home/workspace/Rekrut_AI_v2
git checkout dev
git pull origin dev
git diff main...dev --stat
```

### Step 2: Run Tests
```bash
npm test
npm run lint
```

### Step 3: Manual Testing
- Create test user
- Test login/register
- Test main user flows
- Check for console errors

### Step 4: Report Results
Write to COORDINATION.md:
```markdown
## QA Report - [Date]

### Changes Tested
- List of PRs/commits

### Results
- ✅ PASS: What works
- ❌ FAIL: What doesn't work

### Recommendation
- MERGE / DO NOT MERGE
```

### Step 5: Approve or Reject PR
- If PASS: Comment "✅ QA PASSED - Ready to merge"
- If FAIL: Comment with issues, request changes
```
