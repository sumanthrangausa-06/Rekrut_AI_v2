# Rekrut AI E2E Test Suite — QA Report

**Run Date:** 2026-06-10  
**Test Suite:** Playwright E2E (`/e2e/*.spec.ts`)  
**Total Tests:** 120  
**Configuration:** 1 worker, 60s timeout, `maxFailures=5`, Chromium only

---

## 1. Overall Pass Rate

| Metric | Count | Percentage |
|--------|-------|------------|
| **Total tests defined** | 120 | 100% |
| **Tests that actually ran** | 52 | 43.3% |
| **Passed** | 35 | 29.2% of total / 67.3% of executed |
| **Failed** | 17 | 14.2% of total |
| **Skipped** | 3 | 2.5% of total |
| **Did not run (blocked by maxFailures)** | 65 | 54.2% of total |

> **Note:** `maxFailures=5` caused 3 out of 4 test shards to stop early, leaving 65 tests (54%) never executed. The true pass rate is likely **~75–90%** for the non-executed tests (extrapolated from Shard 3, which completed with 93.9% pass rate), but this cannot be confirmed without a full run without the fail-fast limit.

---

## 2. Top 5 Most Critical Failures

| Rank | Failure | Affected Tests | Root Cause | Classification |
|------|---------|----------------|------------|----------------|
| **1** | **CSRF token missing in all frontend API calls** | `candidate-critical-flow`, `recruiter-critical-flow`, `candidate-apply-flow`, `candidate-job-apply-flow`, `candidate-full-journey`, `password-reset-flow` | Server recently added double-submit CSRF protection (`server.js` lines 136–180), but `client/src/lib/api.ts` → `apiCall()` never sends `X-CSRF-Token` header. All POST requests from the React UI return **403 CSRF_INVALID**. | **🔴 Code Bug** |
| **2** | **`/candidate/jobs` page hangs on `networkidle`** | `auth-persistence`, `candidate-job-apply-flow`, `recruiter-candidates-management`, `recruiter-applicant-review-flow`, `dark-mode` | Page has persistent/retrying network requests that never resolve. Server logs show repeated `All llm providers failed after ~1000ms` (anthropic → kimi), suggesting the frontend continuously retries AI provider calls, keeping the browser network busy. | **🔴 Code Bug** (or **Environment** if AI keys are expected) |
| **3** | **AI Coaching Mock Interview tab absent** | `ai-coaching-flow` | LLM provider initialization fails entirely (no `OPENAI_API_KEY`, `anthropic` and `kimi` both fail). The mock-interview tab is never rendered because the AI backend is unavailable. | **🟡 Environment Issue** |
| **4** | **Auth tokens expire mid-suite** | `navigation-flow`, `candidate-apply-flow`, `recruiter-critical-flow` (when using `--no-deps`) | JWT tokens have a **15-minute expiry**. The full suite takes ~15 min, so `storageState` files created at the start are stale by the time later shards or re-runs execute. | **🟡 Test Infrastructure Issue** |
| **5** | **Admin analytics heading mismatch** | `admin-analytics-flow` | Test expects `Analytics Dashboard` text on `/admin/analytics`, but the actual page heading differs. Admin revenue dashboard test passes, so the route works; this is a test assertion mismatch. | **🟢 Test Bug** |

---

## 3. Critical Paths — Blocked Status

| Path | Status | Why |
|------|--------|-----|
| **Candidate Signup** | 🔴 **BLOCKED** | Registration form POSTs via `apiCall` without CSRF token → 403. User stays on `/register`. |
| **Recruiter Job Posting** | 🔴 **BLOCKED** | Same CSRF bug. "Publish Job" button triggers POST that fails silently; page never redirects to `/recruiter/jobs`. |
| **Candidate Job Search / Apply** | 🔴 **BLOCKED** | Job search page (`/candidate/jobs`) hangs on network requests. Even if loaded, no jobs exist because recruiters can't post them. |
| **Password Reset** | 🔴 **BLOCKED** | Password reset API calls return 403 CSRF_INVALID. |
| **AI Coaching / Mock Interview** | 🟡 **BLOCKED** | All AI providers disabled (no API keys). Mock interview feature is unreachable. |
| **Admin Dashboard / Revenue** | 🟢 **WORKING** | Admin login and revenue dashboard pass. Analytics heading assertion is outdated. |
| **Public Pages / Navigation** | 🟢 **WORKING** | Landing page, pricing, about, and general navigation all pass. |
| **Payment Flow** | 🟢 **WORKING** | Payment tests pass (Stripe mock). |
| **Dark Mode / Theme** | 🟡 **DEGRADED** | Dark mode toggle works, but one test times out on `networkidle` at `/candidate/jobs`. |

---

## 4. Failure Inventory (All Observed Failures)

### Shard 1 (partial — stopped after 5 failures)
| Test | Error | Type |
|------|-------|------|
| `admin-analytics-flow` | `Analytics Dashboard` not visible | Test bug |
| `ai-coaching-flow` | `Mock Interview` tab not visible | Environment (no AI keys) |
| `application-submission-flow` | Timeout 60s (networkidle) | Code bug / Environment |
| `auth-persistence` | Timeout at `/candidate/jobs` | Code bug (networkidle hang) |
| `candidate-full-journey` | `403 CSRF token validation failed` | **Code bug** |

### Shard 2 (partial — stopped after 5 failures)
| Test | Error | Type |
|------|-------|------|
| `candidate-apply-flow` | `403 CSRF token validation failed` | **Code bug** |
| `candidate-job-apply-flow` | `403 CSRF token validation failed` | **Code bug** |
| `candidate-job-apply-flow` | Timeout at `/candidate/jobs` | Code bug (networkidle hang) |
| `candidate-profile-flow` | `Profile saved` toast not visible | Possible UI timing / bug |
| `dark-mode` | Timeout at `/candidate/jobs` | Code bug (networkidle hang) |

### Shard 3 (completed — 31 passed, 2 failed)
| Test | Error | Type |
|------|-------|------|
| `password-reset-flow` | `Check your console` not visible | Test bug / UI change |
| `password-reset-flow` | `403 CSRF token validation failed` | **Code bug** |

### Shard 4 (partial — stopped after 5 failures)
| Test | Error | Type |
|------|-------|------|
| `recruiter-applicant-review-flow` | Timeout at `/recruiter/candidates` | Code bug (networkidle hang) |
| `recruiter-candidates-management` (×4) | Timeout at `/recruiter/candidates` | Code bug (networkidle hang) |

### Critical Tests Batch (rerun with fresh auth)
| Test | Error | Type |
|------|-------|------|
| `candidate-critical-flow` (desktop) | Page stays at `/register` after signup | **Code bug** (CSRF) |
| `candidate-critical-flow` (mobile) | Page stays at `/register` after signup | **Code bug** (CSRF) |
| `recruiter-critical-flow` | Timeout waiting for `/recruiter/jobs` after publish | **Code bug** (CSRF) |
| `candidate-apply-flow` | `403 CSRF token validation failed` | **Code bug** (CSRF) |
| `candidate-job-apply-flow` | `403 CSRF token validation failed` + timeout at `/candidate/jobs` | **Code bug** (CSRF + networkidle) |

---

## 5. Environment Issues Summary

| Issue | Impact | Mitigation |
|-------|--------|------------|
| `OPENAI_API_KEY` missing | AI coaching, mock interviews, document verification, auto-screening all fail | Set API key in `.env` or CI secrets |
| `anthropic` / `kimi` providers fail | Fallback to OpenAI fails; all AI features offline | Configure at least one valid LLM provider |
| `SMTP` not configured | Email sending disabled; password reset emails won't send | Configure SMTP credentials |
| `whisper-cli` binary broken | Self-hosted audio transcription unavailable | Fix binary permissions or disable self-hosted audio |
| PostgreSQL SSL warnings | Non-critical; may break in next major `pg` version | Set `sslmode=verify-full` or `uselibpqcompat=true` |

---

## 6. Recommendations (Do Not Fix — Report Only)

1. **P0 — Fix CSRF in frontend**: Update `client/src/lib/api.ts` to fetch `/csrf-token` before state-changing POST/PUT/DELETE requests and include `X-CSRF-Token` header. This is the single biggest blocker.
2. **P0 — Fix `/candidate/jobs` network hangs**: Add request timeout / retry limits to AI provider calls so failed requests don't keep the browser network busy indefinitely.
3. **P1 — Refresh test auth tokens**: Reduce JWT expiry for test builds, or re-run `auth.setup.ts` between shards, or shard the suite so no shard exceeds 10 minutes.
4. **P1 — Update `admin-analytics-flow` test assertion** to match current UI heading.
5. **P2 — Configure LLM provider keys** in CI/test environment to enable AI feature tests.

---

*Report generated by Model QA Specialist sub-agent.*  
*Total runtime: ~48 minutes (slightly over 45-minute deadline due to cascading early terminations requiring targeted reruns).*
