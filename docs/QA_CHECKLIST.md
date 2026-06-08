# QA Agent - Pre-Test Checklist

## BEFORE YOU START TESTING

### Step 1: Read Deployment Status

Check the `DEPLOYMENTS.md` file to know:
- ✅ What version is deployed
- ✅ What commit was deployed
- ✅ Which features are live
- ✅ Test credentials to use

### Step 2: Check for Recent Changes

Before testing, verify what changed:
```bash
cd /home/workspace/Rekrut_AI_v2
git log --oneline -5  # Check recent commits
git diff origin/main..HEAD  # See what changed
```

### Step 3: Check Database Schema

If testing new features, verify the schema:
```bash
# Check if new tables/columns exist
# Run via Neon MCP (ask the coordinator)
```

### Step 4: Run Tests in Order

```
1. HEALTH CHECK
   curl https://rekrutai.co/health
   Expected: {"status":"ok"}

2. LOGIN (Recruiter)
   curl -X POST https://rekrutai.co/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test_recruiter@rekrutai.co","password":"Test123!"}'
   Expected: {"success":true,"token":"..."}

3. LOGIN (Candidate)
   curl -X POST https://rekrutai.co/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test_candidate@rekrutai.co","password":"Test123!"}'
   Expected: {"success":true,"token":"..."}

4. API ENDPOINTS
   Test these endpoints with the token:
   - GET /api/jobs
   - GET /api/candidates
   - POST /api/screening/screen
   - GET /api/analytics/dashboard

5. BROWSER TESTING
   Use Playwright to test UI flows:
   - Login flow
   - Job creation
   - Candidate search
   - Assessment taking
```

### Step 5: Report Results

After testing, update the TASKS.md file:
```markdown
## QA Results - [DATE]
- [ ] All health checks passed
- [ ] Login works for recruiter
- [ ] Login works for candidate
- [ ] API endpoints return 200
- [ ] UI flows work in browser
- [ ] Bugs found: [list them]
```

## IF YOU FIND BUGS

1. Create an issue in the repo:
   ```bash
   gh issue create --title "Bug: [description]" --body "[steps to reproduce]"
   ```

2. Add to TASKS.md under "Bug Fixes" section

3. Tag the appropriate agent:
   - Frontend bug → Frontend Developer agent
   - Backend bug → Backend Developer agent
   - Database bug → DevOps agent

## COORDINATION

If you need help:
1. Check TASKS.md for context
2. Check DEPLOYMENTS.md for what's deployed
3. Ask the Coordinator agent for clarification

## METRICS

Track your testing:
- Tests run: X
- Tests passed: Y
- Tests failed: Z
- Bugs found: N
- Bugs fixed: M