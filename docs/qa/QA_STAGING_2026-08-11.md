# Staging QA Report — 2026-08-11

**Environment:** https://rekrutai-staging.onrender.com  
**Commit:** `8748bc7` (deploy: OAuth callback redirect fix for React SPA)  
**Date:** 2026-08-11  
**Method:** Live API testing via authenticated requests + static code analysis + database inspection  
**Tester:** Automated QA via Cursor agent

---

## Executive Summary

| Area | Result | Notes |
|---|---|---|
| Infrastructure & health | PASS | Health, metrics, security headers all good |
| Auth flows | PASS* | Register, login, rate-limiting work; CSRF on forgot-password is browser-only |
| Public job board | PASS | Returns jobs, no test data in staging |
| Candidate flows | PASS | Profile, applications list, candidate routes accessible |
| Pending-recruiter workflow | PARTIAL | Detection + hold screen work; owner queue broken (route shadow) |
| Recruiter write operations | UNTESTED | Rate-limited during session; code review confirms CSRF bypass for Bearer tokens |
| Company / team management | FAIL | team/members 500s due to missing `suspended_at` column |
| Email notifications | FAIL | SMTP times out; interview reminder cron errors every 5 min |
| Admin dashboard | FAIL | `/admin/analytics` missing; `/admin/ai-health` wrong path |
| Database isolation | PASS | Dev, staging, production on separate Neon branches |
| Security headers | PASS | All 7 headers present |
| Migration runner | FAIL | `.sql` files silently skipped (#162); 069/070 .js migrations also not applied |

**Overall verdict: NOT ready to promote to production.** See blockers below.

---

## 1. Infrastructure

### 1.1 Health
```
GET /api/health → 200
{
  "status":"ok",
  "db":{"connected":true,"latencyMs":56},
  "tables":[users,jobs,events,companies,refresh_tokens,user_sessions,oauth_connections]
}
```
**PASS**

### 1.2 Prometheus Metrics
```
GET /metrics → 200  (227 lines of Prometheus exposition)
```
**PASS**

### 1.3 Security Headers
All seven required headers present on every response:

| Header | Value |
|---|---|
| `Content-Security-Policy` | Present (strict policy with `'self'` defaults) |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Content-Type-Options` | `nosniff` |
| `Permissions-Policy` | `camera=(self), microphone=(self), geolocation=(), payment=(), usb=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

**PASS**

### 1.4 Database Isolation
Three separate Neon branches confirmed active:
- `production` → `ep-calm-field-aipg6g97-pooler`
- `staging` → `ep-snowy-surf-ai5064zl-pooler`
- `dev` → `ep-delicate-bonus-aixk9pfz-pooler`

**PASS**

---

## 2. Auth Flows

### 2.1 Candidate registration
```
POST /api/auth/register  { role: "candidate" }  →  201
{ "success": true, "user": { "id": 123, ... }, "token": "..." }
```
**PASS**

### 2.2 Login — correct credentials
```
POST /api/auth/login  →  200  { "token": "..." }
```
**PASS**

### 2.3 Login — wrong credentials
```
POST /api/auth/login (wrong pw)  →  401  { "error": "Invalid credentials" }
```
**PASS**

### 2.4 Auth rate limiting
```
Rapid repeated registrations/logins  →  429 Too Many Requests
```
Rate limiter fires correctly. **PASS**

### 2.5 Password reset (forgot-password)
```
POST /api/auth/forgot-password (no cookie)  →  403 CSRF_INVALID
```
This is **expected** from a bare API call. In a browser:
1. Page load (GET `/forgot-password`) triggers `generateCsrfToken` middleware which sets `_csrf` cookie
2. `apiCall` in `client/src/lib/api.ts` reads that cookie and adds `X-CSRF-Token` header on the POST
3. The double-submit pattern validates correctly

From the browser, this should work. From a headless API test without cookies, it correctly rejects. **PASS (browser-only, by design)**

> ⚠️ If users arrive via a deep link directly to `/forgot-password` in a clean browser session (no prior visit), the cookie would be set on that GET, so the flow still works.

### 2.6 Employer registration + pending-recruiter detection
```
POST /api/auth/register  { role: "employer", company_name: "..." }  →  201  company_id: 31
POST /api/auth/register  { role: "recruiter", company_name: "..." (same domain) }  →  202
  { "pending_approval": true, "user": { "company_id": null } }
```
Domain detection works. **PASS** (confirmed in previous session; rate-limited in this session)

---

## 3. Candidate Flows

### 3.1 Public job board
```
GET /api/jobs?limit=3  →  200  { "jobs": [...] }
```
Returns jobs. No test data visible (staging has its own isolated data). **PASS**

### 3.2 Candidate profile
```
GET /api/candidate/profile  (with Bearer token)  →  200
```
**PASS**

### 3.3 My applications list
```
GET /api/candidate/applications  →  200  { "success": true, "applications": [] }
```
**PASS**

### 3.4 Apply to job
Not fully tested this session (job creation was blocked due to rate-limiting on employer login). Route confirmed to exist at `POST /api/jobs/:id/apply`. **UNTESTED**

### 3.5 Countries
```
GET /api/countries  →  200
```
**PASS**

---

## 4. Recruiter / Employer Flows

### 4.1 Pending holding screen (recruiter side)
```
GET /api/company/join-requests/me  →  200
{ "hasPendingRequest": true, "request": { "id": 1, "status": "pending" } }
```
The recruiter's holding screen works. **PASS**

### 4.2 Block pending recruiters from write operations
```
POST /api/recruiter/jobs  (pending token)  →  403  { "error": "Account pending approval" }
GET  /api/recruiter/dashboard  (pending token)  →  403
```
Access control works correctly. **PASS**

### 4.3 Owner join-requests queue
```
GET /api/company/join-requests  (owner token)  →  404  { "error": "Company not found" }
```
**FAIL** — `GET /:slug` at line 586 of `routes/company.js` shadow `GET /join-requests` at line 787. Express matches in order. See **#154**.

### 4.4 Team members list
```
GET /api/company/team/members  (owner token)  →  500  { "error": "Failed to fetch team members" }
```
Log: `column "suspended_at" does not exist`

**FAIL** — `users.suspended_at` column was never created because the migration is a `.sql` file that `migrate.js` silently skips. See **#157** and root cause **#162**.

### 4.5 Suspend / reinstate
Not testable (team/members endpoint 500s). Additionally, `requireNotSuspended` reads `req.user.suspended_at` which is always `undefined` with the column absent — suspension enforcement silently passes through. **FAIL** — see **#157**.

### 4.6 Job CRUD (POST, PUT, DELETE)
Could not test with a valid employer token in this session (rate-limited). CSRF bypass confirmed in code: Bearer token requests skip CSRF check (line 394–398 of `server.js`). When an employer has a valid token, these should work. **UNTESTED**

### 4.7 Recruiter dashboard + candidate pipeline
Endpoints exist (`/api/recruiter/dashboard`, `/api/recruiter/jobs`, `/api/recruiter/applications`, etc.). Could not reach with valid token this session. **UNTESTED**

---

## 5. Notifications & Email

### 5.1 In-app notifications table
```sql
-- staging Neon query:
SELECT ... FROM information_schema.tables WHERE table_name = 'user_notifications'
→ 0 rows  (table MISSING)
```
`migrations/069_in_app_notifications.js` exists but is not recorded in `_migrations`. **FAIL** — see **#155**.

### 5.2 Owner email on join request
```
Registration of recruiter on same domain  →  SMTP send attempted  →  Connection timeout after 10s
```
`smtp-relay.brevo.com` resolves to `1.179.119.1` from Render — DNS or egress issue. **FAIL** — see **#153**.

### 5.3 Interview reminder cron
Staging logs (every 5 minutes, continuous):
```
[email-service] Interview reminder processing error: column i.scheduled_at does not exist
```
`email-service.js` queries `interviews.scheduled_at` but that column lives on `scheduled_interviews`. See **#163**.

---

## 6. Admin

### 6.1 Admin dashboard stats
```
GET /api/admin/analytics  →  404
GET /api/admin/ai-health  →  404 (correct path is /api/ai-health)
```
Dashboard falls back to zeros. No user counts, no revenue, no conversion stats visible. **FAIL** — see **#164**.

### 6.2 Admin agents page
```
GET /api/admin/agents         →  403 (need admin role — route EXISTS, protected correctly)
GET /api/admin/agents/runs    →  404 (missing)
GET /api/admin/agents/stats   →  404 (missing)
```
**FAIL** — see **#164**.

### 6.3 Admin compliance routes
All `/api/admin/compliance/*` endpoints exist and return 403 for non-admin correctly. **PASS (auth protection working)**

---

## 7. Audit Log Schema
```sql
-- staging:
audit_logs columns: id, action_type, user_id, target_type, target_id, metadata, ip_address, user_agent, created_at
-- missing: company_id, actor_id, action, reason
```
`migration/070_audit_logs.js` uses `CREATE TABLE IF NOT EXISTS` — no-ops against the existing table. **FAIL** — see **#156**.

---

## 8. Migration State

| Migration | Type | Applied on staging | Tables created |
|---|---|---|---|
| 069_in_app_notifications.js | .js | No | user_notifications: MISSING |
| 070_audit_logs.js | .js | No (IF NOT EXISTS no-op) | audit_logs: exists but wrong schema |
| 2026-08-11-add-user-suspended-at.sql | .sql | No (silently skipped) | users.suspended_at: MISSING |
| 045_fix_company_id_fk_constraints.sql | .sql | No (silently skipped) | unknown |
| p2_schema_hardening.sql | .sql | No (silently skipped) | unknown |

Root cause: `migrate.js` line 136 only runs `.js` files. See **#162**.

---

## 9. Open Issues Referenced

| Issue | Status | Blocking promotion? |
|---|---|---|
| [#162](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/162) — migrate.js skips .sql | OPEN | YES — root cause of schema drift |
| [#157](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/157) — suspended_at missing | OPEN | YES — team page 500, enforcement no-op |
| [#154](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/154) — join-requests shadowed | OPEN | YES — owner queue unreachable |
| [#155](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/155) — user_notifications missing | OPEN | YES — in-app notifications dead |
| [#156](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/156) — audit_logs bad schema | OPEN | YES — approval audit trail broken |
| [#153](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/153) — SMTP timeout | OPEN | YES — no emails delivered |
| [#163](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/163) — reminder cron wrong table | OPEN | NO — background error |
| [#164](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/164) — admin dashboard zeros | OPEN | NO — admin-only |
| [#104](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/104) — approval workflow epic | OPEN | YES — epic not working end-to-end |

---

## 10. Test Data Cleanup

All QA test accounts created during this session have been deleted from the staging Neon branch:

| ID | Email | Deleted |
|---|---|---|
| 123 | candidate.qa1786407353@mailtest.dev | Yes |
| 124 | owner.qa1786407353@mailtest.dev | Yes |
| 125 | recruiter.qa1786407353@mailtest.dev | Yes |
| 126 | cand2.1786407756@mailtest.dev | Yes |
| 127 | owner2.1786407756@mailtest.dev | Yes |

---

## 11. Promotion Recommendation

**Do not promote staging → production.**

Staging is 17 commits ahead of `main`. Six of those commits implement the recruiter-approval workflow which is end-to-end broken. Promoting as-is would:
1. Carry the `suspended_at` 500 to production (production database also missing the column)
2. Leave the owner queue 404 in production
3. Deliver no emails (SMTP timeout)
4. Show zeros on the admin dashboard

**Promotion is safe after:**
1. #162 (migration runner) — fix and re-run all pending migrations
2. #157 (suspended_at) — apply migration, verify enforcement
3. #154 (route shadow) — reorder routes in company.js
4. #153 (SMTP) — diagnose egress from Render and fix delivery
5. Re-run this QA checklist end-to-end in one sitting per the #104 epic's definition of done

---

*QA analyst: Cursor agent (Sonnet 4.6) — 2026-08-11*
