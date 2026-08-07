# QA Browser Test Plan — Rekrut AI
> **Date:** 2026-08-07 | **Environment:** Staging | **URL:** https://rekrutai-staging.onrender.com

## Current Status

### E2E Test Infrastructure
- **Total test files:** 41
- **Total tests:** 172
- **Test framework:** Playwright
- **Browsers:** Chromium (primary), Firefox, WebKit

### Test Categories

| Category | Files | Tests | Status |
|----------|-------|-------|--------|
| Authentication | 1 setup + auth flows | ~15 | ⚠️ Admin auth failing (#66) |
| Candidate Flow | 8 files | ~40 | 🟡 Not fully verified |
| Recruiter Flow | 8 files | ~45 | 🟡 Not fully verified |
| Admin Flow | 4 files | ~20 | 🔴 Blocked by #42/#66 |
| Payment | 3 files | ~15 | 🟡 Not verified |
| Mobile | 2 files | ~20 | 🟡 Not verified |
| Navigation | 3 files | ~17 | 🟡 Not verified |

### Critical Findings

| Issue | Test | Status |
|-------|------|--------|
| **#66** | Admin auth 401 | 🔴 Critical — blocks all admin tests |
| **#42** | Default admin password | 🔴 P0 — security vulnerability |

---

## QA Testing Strategy

### Phase 1: Smoke Tests (Daily via cron)
Run against staging after each deploy:
```bash
BASE_URL=https://rekrutai-staging.onrender.com npx playwright test \
  e2e/public-pages.spec.ts \
  e2e/auth-persistence.spec.ts \
  --project=chromium --reporter=list --workers=1
```

### Phase 2: Critical Flow Tests (Every 2 hours via cron)
```bash
BASE_URL=https://rekrutai-staging.onrender.com npx playwright test \
  e2e/candidate-critical-flow.spec.ts \
  e2e/recruiter-critical-flow.spec.ts \
  e2e/payment-flow.spec.ts \
  --project=chromium --reporter=list --workers=1
```

### Phase 3: Full Regression (Weekly)
Run full suite:
```bash
BASE_URL=https://rekrutai-staging.onrender.com npx playwright test \
  --project=chromium --reporter=html --workers=1
```

---

## Bug Tracking → GitHub Issues

### Process
1. **Discover:** Run E2E tests, note failures
2. **Document:** Create GitHub issue with:
   - Title: `[BUG] <brief description>`
   - Labels: `bug`, `e2e-failure`, priority (P0/P1/P2), category
   - Body: Test file, error message, expected vs actual behavior
   - Screenshot if applicable
3. **Auto-assign:** Cron job picks up unassigned bugs and creates subagents
4. **Fix:** Subagent fixes, commits, runs tests
5. **Verify:** Re-run tests, close issue if passing

### Bug Issue Template
```markdown
## Bug Report
**Test File:** e2e/xxx.spec.ts
**Test Case:** "should do something"
**Severity:** critical/high/medium/low

### Error
```
<error message>
```

### Expected
<what should happen>

### Actual
<what actually happens>

### Repro Steps
1. Go to <URL>
2. Click <element>
3. Observe <result>

### Environment
- Branch: <branch>
- Commit: <commit>
- URL: <staging URL>
```

### Example Issues Created
- **#66** [BUG] E2E Admin auth test fails — 401 Invalid credentials

---

## Cron Integration

### How It Works
1. Cron runs every 2 hours
2. Executes E2E tests against staging
3. Parses failures
4. For each failure:
   - Check if GitHub issue already exists (search by test name)
   - If not: create new issue with bug template
   - If exists: add comment with new failure details
5. Pick oldest unassigned bug
6. Spawn subagent to fix
7. After fix: re-run test, close issue if passing

### Issue Labels for Auto-Processing
| Label | Meaning |
|-------|---------|
| `bug` | Confirmed bug from test failure |
| `e2e-failure` | Found by E2E test suite |
| `auto-assigned` | Picked up by cron for fixing |
| `needs-verification` | Fix deployed, needs test re-run |

### Cron Configuration
```javascript
// .openclaw/cron/qa-e2e-runner.js
{
  "name": "qa-e2e-runner",
  "schedule": "0 */2 * * *", // Every 2 hours
  "command": "npm run test:e2e:staging",
  "onFailure": "create-github-issue",
  "autoFix": true,
  "maxConcurrentFixes": 2
}
```

---

## Next Actions
1. ✅ Fix #42 (admin credentials) to unblock admin tests
2. 🔄 Run full E2E suite to find all failures
3. 🔄 Create GitHub issues for each failure
4. 🔄 Set up cron to auto-process bug issues
