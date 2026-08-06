# Security Code Review — Staging Branch Commits

**Date:** 2026-07-15
**Reviewer:** Code Reviewer Agent
**Commits Reviewed:** 3
**Priority:** P1 — Production deployment blocker

---

## Commit 1: `83987c1` — Rate Limiting Gaps, File Size Limits, and Account Enumeration

**Files Changed:** `routes/admin.js`, `routes/company.js`

### What Changed

| File | Before | After |
|------|--------|-------|
| `routes/admin.js:357` | `router.post('/bridge', rateLimits.admin, ...)` | `router.post('/bridge', rateLimits.strict, ...)` |
| `routes/company.js:43` | `router.post('/register', rateLimits.strict, ...)` | `router.post('/register', rateLimits.medium, ...)` |

### Review

#### Admin Bridge — `rateLimits.admin` → `rateLimits.strict` ✅

The admin bridge endpoint (`POST /api/admin/bridge`) auto-elevates JWT users to admin privileges without a separate login. Changing from `rateLimits.admin` (30 requests/min, 1-minute window) to `rateLimits.strict` (5 requests/15min window) is **correct and necessary**.

- **Why:** A privilege-escalation endpoint should be among the most rate-limited on the site. 30 req/min is far too permissive for brute-force protection.
- **Risk mitigated:** Credential stuffing / token guessing against admin elevation.
- **Verdict:** Good fix. No issues.

#### Company Register — `rateLimits.strict` → `rateLimits.medium` 🔴 **BLOCKER**

**This change introduces a runtime crash.** The `rateLimits` object in `lib/distributed-rate-limiter.js` does **not** define a `medium` preset:

```javascript
const rateLimits = {
  strict: createRateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'strict' }),
  standard: createRateLimit({ windowMs: 60 * 1000, max: 60, keyPrefix: 'standard' }),
  ai: createRateLimit({ windowMs: 60 * 1000, max: 10, keyPrefix: 'ai' }),
  admin: createRateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'admin' }),
  public: createRateLimit({ windowMs: 60 * 1000, max: 120, keyPrefix: 'public' }),
};
```

When any request hits `POST /api/company/register`, Express will call `rateLimits.medium(req, res, next)`, which will throw `TypeError: Cannot read properties of undefined (reading 'windowMs')` (or similar depending on `createRateLimit`'s internals). This will crash the request handling and potentially leak a 500 error stack trace.

**Fix:** Either add a `medium` preset to `lib/distributed-rate-limiter.js` or revert to `rateLimits.strict` (or `rateLimits.standard` if a higher limit is intended).

#### Account Enumeration — **NOT FIXED**

The commit message claims this commit fixes "account enumeration," but the code does not change the error responses in `routes/company.js`. The endpoint still returns:

- `"Email already registered"` (existing user check)
- `"A company with this email domain already exists. Please contact your administrator."` with `existing_company: true` (existing company check)

These differential error messages allow an unauthenticated attacker to determine whether a given email or domain is already registered — classic user enumeration. The commit makes **zero** changes to address this.

**Fix:** Return a single, uniform message for both cases (e.g., `"If this email is not registered, an account has been created."`) and use a 200 OK response, or at minimum use the same 400 error message with no distinguishing fields.

#### File Size Limits — **NOT ADDRESSED**

The commit message mentions "file size limits," but no file-size-related changes appear in the diff.

**Verdict:** `routes/admin.js` change is correct. `routes/company.js` change is a breaking bug and must be fixed before deploy. Account enumeration and file size claims in the commit message are not reflected in the code.

---

## Commit 2: `3bad4d7` — Sanitize Offer Letter HTML; Fix Mobile Responsive Issues

**Files Changed:** `client/package.json`, `client/package-lock.json`, `client/src/pages/candidate/dashboard.tsx`, `client/src/pages/candidate/offers.tsx`, `client/src/pages/recruiter/candidates.tsx`, `client/src/pages/recruiter/offers.tsx`, `client/src/pages/recruiter/onboarding-docs.tsx`

### What Changed

- Added `dompurify@^3.4.12` to client dependencies.
- Wrapped three `dangerouslySetInnerHTML` usages with `DOMPurify.sanitize()`:
  - `candidate/offers.tsx` — offer letter preview
  - `recruiter/offers.tsx` — offer letter preview
  - `recruiter/onboarding-docs.tsx` — document body preview
- Added `min-h-[44px]` and `min-w-[44px]` Tailwind classes to buttons and interactive elements across multiple pages for mobile accessibility (WCAG 2.5.5 target size).
- Changed some grid layouts from `grid-cols-2` to `grid-cols-1 sm:grid-cols-2` for better mobile responsiveness.

### Review

#### DOMPurify XSS Sanitization — Mostly Correct 🟡

Adding `DOMPurify.sanitize()` before rendering HTML in `dangerouslySetInnerHTML` is the correct defense against stored XSS. DOMPurify 3.4.12 is a recent, well-maintained version.

**However:**

1. **Missing sanitization on `blog.tsx`** — `client/src/pages/blog.tsx:353` still uses `<div dangerouslySetInnerHTML={{ __html: post.content }} />` without DOMPurify. If blog content is authored through any interface that accepts user input (or if there's a CMS that can be compromised), this is a stored XSS vector. **Recommendation:** Apply `DOMPurify.sanitize()` there too.

2. **DOMPurify runs client-side** — This is fine for React SPAs, but if the same HTML is ever rendered server-side (e.g., in email templates or SSR), server-side sanitization must also be applied. Not a blocker for this commit, but worth documenting.

3. **Config defaults** — DOMPurify's default config is generally safe. If the application ever needs to allow specific tags/attributes (e.g., `iframe`, `style`), a centralized config should be used rather than ad-hoc `sanitize()` calls. Not an issue today.

#### Mobile Responsive / Accessibility Fixes ✅

The `min-h-[44px]` additions are good — they meet WCAG 2.5.5 target size guidelines. The grid layout changes (`grid-cols-1 sm:grid-cols-2`) improve mobile UX. These are purely presentational and carry no security risk.

**Verdict:** DOMPurify integration is correct. The remaining unsanitized `dangerouslySetInnerHTML` in `blog.tsx` should be addressed before declaring XSS sanitization complete.

---

## Commit 3: `b384641` — DB SSL Validation, Document IDOR, and Verbose Error Leaks

**Files Changed:** `client/src/pages/candidate/applications.tsx`, `client/src/pages/candidate/interview-analysis.tsx`, `client/src/pages/candidate/interview-practice.tsx`, `client/src/pages/candidate/jobs.tsx`, `client/src/pages/candidate/offer-management.tsx`, `lib/db-health.js`, `lib/db.js`, `lib/recruiter-screener.js`, `routes/documents.js`, `routes/jobs.js`

### What Changed

#### Database SSL Configuration (`lib/db.js`) ✅

**Before:**
```javascript
process.env.NODE_ENV === 'production' ||
  process.env.DATABASE_URL?.includes('sslmode=require') ||
  process.env.FORCE_SSL_VERIFY === 'true'
    ? { rejectUnauthorized: true }
    : { rejectUnauthorized: false };
```

**After:**
```javascript
{ rejectUnauthorized: true }
```

**Review:** This is a **security hardening**. Previously, if `NODE_ENV` was set to anything other than `'production'`, and `DATABASE_URL` did not contain `sslmode=require`, and `FORCE_SSL_VERIFY` was not `'true'`, the database connection would accept invalid SSL certificates (`rejectUnauthorized: false`). This opens the door to MITM attacks against the database connection.

The new logic:
- `development` → `false` (no SSL)
- `FORCE_SSL_VERIFY === 'false'` → `{ rejectUnauthorized: false }` (explicit override)
- **Everything else** → `{ rejectUnauthorized: true }` (strict verification)

This is correct. The only way to get unverified SSL now is an explicit `FORCE_SSL_VERIFY=false` opt-out.

#### Document IDOR Fix (`routes/documents.js`) ✅

**Before:** The `GET /api/documents/:id/verification` endpoint ran:
```javascript
WHERE dv.document_id = $1 AND vd.user_id = $2
```
This required the authenticated user's ID to match the document owner. However, if the document verification existed for a different user, the query simply returned zero rows, and the endpoint returned 404 — **but the user_id check was embedded in the query, not an explicit auth check.** This meant that if the query was ever refactored or if there were other code paths, the authorization could be bypassed.

**After:** The endpoint now:
1. Explicitly queries `verification_documents` for the document ID.
2. Checks if the requesting user is the document owner (`docOwnerId === userId`).
3. If not the owner but is a recruiter/hiring_manager/admin, checks whether the candidate has applied to a job at the recruiter's company via `job_applications` → `jobs` join.
4. Returns 403 if access is denied.
5. Only then queries the verification details, without the `user_id` filter in the main query.

**Review:** This is a **correct and complete IDOR fix**. The authorization logic is now explicit, readable, and auditable. The pattern matches the existing access control in `GET /api/documents/:id` and `GET /api/documents/:id/download`, which is good for consistency.

One minor observation: The 404 returned when `docResult.rows.length === 0` is correct — we don't want to leak whether a document exists to an unauthorized user. The 403 only happens after we've confirmed the document exists.

#### Verbose Error Leaks — `routes/jobs.js` ✅

**Before:** Multiple endpoints in `routes/jobs.js` returned detailed error objects to the client in non-production environments, including:
- `err.message`
- `err.code`
- `err.detail`
- `err.table`
- `err.constraint`
- `err.stack`

**After:** All replaced with generic `console.error('...', err)` on the server and `res.status(500).json({ error: 'Failed to ...' })` to the client. The debug-mode branch (`process.env.NODE_ENV !== 'production'`) that returned internal error details has been removed entirely.

**Review:** This is **correct**. Exposing `err.stack`, `err.table`, `err.constraint`, and Postgres error codes to the client aids attackers in mapping the database schema and understanding internal logic. Removing the debug-mode branch ensures consistent, safe behavior across all environments.

**However:** Other route files (`routes/auth.js`, `routes/company.js`, `routes/candidate.js`, `routes/interviews.js`, etc.) may still have similar verbose error patterns. This commit only cleans up `routes/jobs.js`. A follow-up sweep is recommended.

#### Verbose Error Leaks — `lib/db-health.js`, `lib/db.js`, `lib/recruiter-screener.js` ✅

Error messages in these library files were also replaced with generic strings. The `code: err.code` field is still returned in some places (e.g., `lib/db-health.js`'s `checkConnectionFast`), but `err.code` is a Postgres error code string (e.g., `'42P01'`, `'ECONNREFUSED'`) which is low-risk and sometimes useful for client-side retry logic. The high-risk fields (`message`, `detail`, `table`, `constraint`, `stack`) are removed.

**Mobile Responsive Changes** — The `min-h-[44px]` and grid layout changes in the candidate pages are presentational only, no security impact.

**Verdict:** All three security fixes in this commit are correct and should be deployed. The error cleanup in `routes/jobs.js` is good but should be extended to other route files in a follow-up.

---

## Summary Table

| Commit | File | Finding | Severity | Status |
|--------|------|---------|----------|--------|
| `83987c1` | `routes/company.js` | `rateLimits.medium` does not exist — runtime crash | 🔴 Blocker | Must fix before deploy |
| `83987c1` | `routes/company.js` | Account enumeration not fixed (commit claims it is) | 🟡 Suggestion | Follow-up needed |
| `83987c1` | `routes/company.js` | File size limits not addressed (commit claims they are) | 🟡 Suggestion | Follow-up needed |
| `83987c1` | `routes/admin.js` | Admin bridge tightened to `strict` rate limit | ✅ Good | No action |
| `3bad4d7` | `client/src/pages/blog.tsx` | Unsanitized `dangerouslySetInnerHTML` remains | 🔴 Blocker | Must fix before deploy |
| `3bad4d7` | `client/src/pages/candidate/offers.tsx` | DOMPurify correctly applied | ✅ Good | No action |
| `3bad4d7` | `client/src/pages/recruiter/offers.tsx` | DOMPurify correctly applied | ✅ Good | No action |
| `3bad4d7` | `client/src/pages/recruiter/onboarding-docs.tsx` | DOMPurify correctly applied | ✅ Good | No action |
| `b384641` | `lib/db.js` | SSL now defaults to `rejectUnauthorized: true` | ✅ Good | No action |
| `b384641` | `routes/documents.js` | IDOR properly fixed with explicit auth checks | ✅ Good | No action |
| `b384641` | `routes/jobs.js` | Verbose error leaks removed | ✅ Good | No action |
| `b384641` | `lib/db-health.js`, `lib/db.js`, `lib/recruiter-screener.js` | Internal error messages replaced | ✅ Good | No action |
| `b384641` | `routes/auth.js`, `routes/company.js`, etc. | Other routes may still leak verbose errors | 🟡 Suggestion | Follow-up sweep recommended |

---

## Blockers (Must Fix Before Production)

1. **`routes/company.js:43`** — `rateLimits.medium` is undefined. Add a `medium` preset to `lib/distributed-rate-limiter.js` or change back to `rateLimits.standard` (60/min).
2. **`client/src/pages/blog.tsx:353`** — `dangerouslySetInnerHTML` is still unsanitized. Wrap with `DOMPurify.sanitize(post.content)`.

## Follow-ups (Recommended Before or After Deploy)

1. **Account enumeration** — Unify error messages in `routes/company.js` company registration so that "email exists" and "company exists" return the same generic response.
2. **File size limits** — If the intent was to change upload limits, the commit is empty. Review `routes/documents.js` multer config (currently 50MB) and consider whether stricter limits are needed.
3. **Error leak sweep** — Check `routes/auth.js`, `routes/company.js`, `routes/candidate.js`, `routes/interviews.js`, `routes/assessments.js`, and `routes/voice.js` for the same verbose-error-in-debug-mode pattern that was cleaned up in `routes/jobs.js`.
4. **DOMPurify config centralization** — Consider creating a reusable `sanitizeHtml()` utility so all future `dangerouslySetInnerHTML` uses are consistent.

---

*Review completed by Code Reviewer Agent on 2026-07-15.*
