# CI/CD Issue #74 — Root Cause Analysis

> **Issue:** [DEPLOY] Render dev deploy failed — E2E ai-coaching-flow test blocks CI  
> **Status:** ✅ Fixed  
> **Resolution Date:** 2026-08-08  
> **Related PR/Issue:** #74

---

## Summary

All E2E tests were failing in CI because the **client was never built** in the E2E test job. The server started successfully and the health check passed, but all client-side routes served blank pages because `client/dist/index.html` didn't exist.

---

## Timeline of Investigation

### Phase 1: Initial Diagnosis (Wrong Path)
- **Assumption:** The E2E test was checking for content before the page finished loading
- **Fix Attempt 1:** Added `.animate-spin` wait — **FAILED** (spinner class not in built CSS)
- **Fix Attempt 2:** Added 15s timeout on heading — **FAILED** (heading never appears on blank page)

### Phase 2: CI Workflow Audit (Correct Path)
- **Discovery:** The E2E tests job was missing the `Build client` step
- **Root Cause:** The `build` job ran separately and had `needs: build`, but the E2E job re-checked out code fresh and didn't build the client
- **Evidence:**
  - Server health check passed (server.js runs fine without client)
  - All E2E tests failed (client-side routes return 404/blank)
  - Server code shows it looks for `client/dist/index.html`:
    ```javascript
    const possibleBuildPaths = [
      path.join(__dirname, 'client', 'dist'),
      path.join(__dirname, 'client', 'build'),
    ];
    ```

### Phase 3: Fix Applied
- **File:** `.github/workflows/ci.yml`
- **Change:** Added `npm run build --prefix client` step in E2E tests job
- **Result:** Client builds before server starts → all routes serve correctly

---

## The Fix

```yaml
# .github/workflows/ci.yml
# In the e2e-tests job, before "Install Playwright browsers":

- name: Install client dependencies
  run: cd client && npm ci

- name: Build client          # ← ADDED THIS STEP
  run: npm run build --prefix client

- name: Install Playwright browsers
  run: npx playwright install chromium
```

---

## Lessons Learned

| Lesson | Detail |
|--------|--------|
| **Don't trust green health checks** | Server running ≠ Client built |
| **Audit CI workflows carefully** | `needs: build` doesn't mean artifacts are available |
| **Check the basics first** | Is the file we're testing actually there? |
| **E2E tests need built clients** | SPA routes require `index.html` in `dist/` |

---

## Verification

After the fix:
1. CI re-runs with client build step
2. Server starts with `client/dist/index.html` available
3. E2E tests access `/candidate/ai-coaching` and page renders correctly
4. Heading `<h1>AI Interview Coach</h1>` found within timeout

---

## Related Files

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | CI/CD pipeline — where the fix was applied |
| `server.js` | Server logic that serves `client/dist/index.html` |
| `e2e/ai-coaching-flow.spec.ts` | E2E test that was failing |
| `client/src/pages/candidate/ai-coaching.tsx` | Page component |
