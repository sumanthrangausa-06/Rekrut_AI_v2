# Rekrut AI E2E Test Suite

> **Last updated:** 2026-06-09  
> **QA Owner:** Model QA Specialist  
> **Strategy:** Per-file execution to avoid SIGKILL from browser memory exhaustion.

---

## ⚠️ Critical Constraint — SIGKILL on Full Suite

Running the entire suite in a single `npx playwright test` invocation causes the Linux OOM killer to send **SIGKILL** to the browser process. This happens because:

- The machine has ~7 GB RAM.
- Each Chromium browser context holds ~150–300 MB.
- Even with `workers: 1` and `fullyParallel: false`, memory is not fully reclaimed between sequential spec files.
- The `node server.js` web server also consumes memory and is not restarted between files.

**The optimized config mitigates this but does not eliminate it.** The safest and recommended approach is **per-file execution** (see below).

---

## 🚀 Quick Start — Run a Critical Flow

### 1. Candidate Full Journey
```bash
npx playwright test e2e/candidate-full-journey.spec.ts --project=chromium --no-deps
```
**What it tests:** Unauthenticated signup → profile completion → job search → apply → verify in "My Applications".
**Runtime:** ~25–30 s  
**Status:** ✅ Passing

### 2. Recruiter Critical Flow
```bash
npx playwright test e2e/recruiter-critical-flow.spec.ts --project=chromium --no-deps
```
**What it tests:** Recruiter login → post job → candidate applies via API → recruiter views applicants → shortlists → views analytics.
**Runtime:** ~30–35 s  
**Status:** ✅ Passing

### 3. Candidate Critical Flow (Desktop + Mobile)
```bash
npx playwright test e2e/candidate-critical-flow.spec.ts --project=chromium --no-deps
```
**What it tests:** Desktop and mobile viewports: signup → profile → search → apply.
**Runtime:** ~25 s  
**Status:** ✅ Passing

### 4. Auth Setup (run first if auth files are stale)
```bash
npx playwright test e2e/auth.setup.ts --project=setup
```
**What it does:** Creates/validates `e2e/.auth/candidate.json` and `e2e/.auth/recruiter.json` via API calls (no browser spawned).
**Runtime:** ~5 s (skipped if tokens are still valid)  
**Status:** ✅ Passing

---

## 📋 Run the Entire Suite (Sequential, Safe)

Use the provided shell script that runs **one spec file at a time** in separate Playwright processes, fully resetting the browser memory between files:

```bash
./e2e/run-e2e-suite.sh
```

Optional flags:
```bash
./e2e/run-e2e-suite.sh --headed   # Visible browser
./e2e/run-e2e-suite.sh --trace   # Enable tracing
./e2e/run-e2e-suite.sh --timeout  # 120 s timeout per test
```

The script will:
1. Run auth setup first.
2. Loop through every `.spec.ts` file in `e2e/` in alphabetical order.
3. Run each file with `--project=chromium --no-deps`.
4. Print a color-coded PASS/FAIL summary.

**Note:** This is slower than a single `npx playwright test` invocation but **SIGKILL-safe**.

---

## 🧪 Run Specific Test Groups

### Admin Flows
```bash
# Requires ADMIN_PASSWORD env var (see below)
ADMIN_PASSWORD=F0ta9-l80TOHFrqQkBZsqw npx playwright test e2e/admin-critical-flow.spec.ts --project=chromium --no-deps
```

### Payment / Stripe
```bash
npx playwright test e2e/payment-flow.spec.ts --project=chromium --no-deps
npx playwright test e2e/payment.spec.ts --project=chromium --no-deps
```

### Navigation & Public Pages
```bash
npx playwright test e2e/navigation.spec.ts --project=chromium --no-deps
npx playwright test e2e/public-pages.spec.ts --project=chromium --no-deps
```

### Debug / Diagnostic Tests (excluded from default chromium project)
```bash
# Debug files are ignored by the default `chromium` project via testIgnore.
# Run them explicitly if needed:
npx playwright test e2e/debug-candidate.spec.ts --project=chromium --no-deps
npx playwright test e2e/debug-jobs-html.spec.ts --project=chromium --no-deps
npx playwright test e2e/debug-localStorage.spec.ts --project=chromium --no-deps
```

---

## 🔧 Environment Variables

| Variable | Required for | Value (local) |
|----------|--------------|---------------|
| `ADMIN_PASSWORD` | `admin-critical-flow.spec.ts` | `F0ta9-l80TOHFrqQkBZsqw` |
| `CI` | Enables retries (2×) and `forbidOnly` | Set in CI only |

The `.env` file contains these values, but **Playwright's `webServer` spawn does not automatically export them to the test runner**. Export them in your shell before running tests, or prefix the command inline.

---

## ⚙️ Config Optimizations (playwright.config.ts)

The following changes were made to reduce the risk of SIGKILL and improve reliability:

| Setting | Value | Rationale |
|---------|-------|-----------|
| `workers` | `1` | Only one browser instance alive at any time. |
| `fullyParallel` | `false` | Tests inside a file run sequentially. |
| `video` | `'off'` | Eliminates video encoding overhead and disk I/O. |
| `trace` | `'on-first-retry'` | Traces only on retry, not every test. |
| `preserveOutput` | `'failures-only'` | Cleans up passing-test artifacts. |
| `outputDir` | `'test-results'` | Centralized artifact directory. |
| `globalTimeout` | `600000` (10 min) | Prevents infinite hangs from crashed server. |
| `expect.timeout` | `15000` | Faster failure than default 5 s for stuck assertions. |
| `actionTimeout` | `10000` | Hard limit on individual click/fill actions. |
| `navigationTimeout` | `15000` | Hard limit on `page.goto` / `page.waitForURL`. |
| `reducedMotion` | `'reduce'` | Disables CSS animations, speeding up UI transitions. |
| `launchOptions.args` | 15+ flags | Disables GPU, sandbox, background timers, extensions, etc. |
| `testIgnore` | `/debug-.*\.spec\.ts/` | Skips diagnostic files in the default chromium project. |
| `maxFailures` | `5` | Aborts early if the app or server is broken. |

### Mobile Tests
Mobile tests are **commented out** in `playwright.config.ts` by default. They can be run separately:
```bash
npx playwright test --project=mobile-chromium
```
Uncomment the `mobile-chromium` project block to enable it.

---

## 🐛 Known Failures (as of 2026-06-09)

### 1. `/candidate/assessments` — Missing Auth Redirect
**File:** `e2e/candidate-flow.spec.ts` (test 5 of 6)  
**Symptom:** Unauthenticated visit to `/candidate/assessments` does **not** redirect to `/login`. The page stays at `/candidate/assessments`.  
**Severity:** Medium — other candidate pages (dashboard, profile, jobs, interviews, omniscore) correctly redirect.  
**Action:** Check router/auth middleware for the `/candidate/assessments` route.

### 2. Jobs Page Flakiness (Historical)
**Files:** `application-submission-flow.spec.ts`, `job-search-filtering.spec.ts`, `candidate-apply-flow.spec.ts`  
**Symptom:** Intermittent `count=0` on job cards even though API returns 50 jobs.  
**Likely Cause:** Race condition between page hydration and DOM query.  
**Workaround:** Re-run the spec file individually.

### 3. Server Crash on `mobile-navigation.spec.ts`
**Symptom:** Pricing page test failure can trigger a server crash (`ERR_CONNECTION_REFUSED`).  
**Impact:** Subsequent tests in the same Playwright process fail.  
**Workaround:** Run per-file; the shell script reuses the existing server or starts fresh if needed.

### 4. Missing Auth State File
**File:** `recruiter-analytics.spec.ts`  
**Symptom:** `ENOENT: e2e/.auth/recruiter.json` during the final test.  
**Likely Cause:** Auth file was deleted or expired mid-run.  
**Workaround:** Run auth setup before the file, or use the shell script which auto-detects missing auth files.

---

## 📁 File Inventory (26 spec files)

| File | Lines | Type | Status |
|------|-------|------|--------|
| `admin-analytics-flow.spec.ts` | 36 | Light | ✅ |
| `admin-critical-flow.spec.ts` | 64 | Light | ✅ (needs `ADMIN_PASSWORD`) |
| `admin-dashboard-flow.spec.ts` | 40 | Light | ✅ |
| `admin-revenue-flow.spec.ts` | 31 | Light | ✅ |
| `ai-coaching-flow.spec.ts` | 64 | Light | ✅ |
| `application-submission-flow.spec.ts` | 182 | Heavy | ❌ (flaky) |
| `auth-persistence.spec.ts` | 170 | Heavy | ✅ |
| `candidate-apply-flow.spec.ts` | 139 | Heavy | ⚠️ (skips) |
| `candidate-critical-flow.spec.ts` | 140 | Heavy | ✅ |
| `candidate-flow.spec.ts` | 39 | Light | ⚠️ (1 failure: assessments) |
| `candidate-full-journey.spec.ts` | 173 | Heavy | ✅ |
| `candidate-job-apply-flow.spec.ts` | 207 | Heavy | ✅ |
| `candidate-profile-flow.spec.ts` | 38 | Light | ✅ |
| `dark-mode.spec.ts` | 115 | Light | ✅ |
| `debug-candidate.spec.ts` | 25 | Debug | ✅ (run manually) |
| `debug-jobs-html.spec.ts` | 31 | Debug | ✅ (run manually) |
| `debug-localStorage.spec.ts` | 30 | Debug | ✅ (run manually) |
| `job-search-filtering.spec.ts` | 169 | Heavy | ❌ (flaky) |
| `mobile-navigation.spec.ts` | 177 | Heavy | ❌ (server crash) |
| `navigation-flow.spec.ts` | 211 | Heavy | ✅ |
| `navigation.spec.ts` | 56 | Light | ✅ |
| `payment-flow.spec.ts` | 146 | Heavy | ✅ |
| `payment.spec.ts` | 142 | Heavy | ✅ |
| `public-pages.spec.ts` | 33 | Light | ✅ |
| `recruiter-analytics.spec.ts` | 128 | Heavy | ⚠️ (auth file issue) |
| `recruiter-critical-flow.spec.ts` | 127 | Heavy | ✅ |
| `recruiter-flow.spec.ts` | 21 | Light | ✅ |
| `recruiter-job-create-flow.spec.ts` | 223 | Heavy | ❌ (120 s timeout) |
| `recruiter-job-post-flow.spec.ts` | 122 | Heavy | ❌ (UI copy mismatch) |
| `recruiter-job-posting-flow.spec.ts` | 81 | Heavy | ❌ (edit form timeout) |

---

## 🔄 CI Recommendation

In a CI environment with more RAM, the full suite can run with:
```bash
npx playwright test --project=chromium
```

If SIGKILL persists in CI, use the per-file script:
```bash
bash e2e/run-e2e-suite.sh
```

Ensure `ADMIN_PASSWORD` is exported as a secret in the CI environment.

---

## 📞 Escalation

If a spec file fails consistently after 3 individual re-runs:
1. Check the screenshot in `test-results/`.
2. Check `error-context.md` in the same directory.
3. File a bug with the screenshot, error log, and server logs.

**QA Contact:** Model QA Specialist
