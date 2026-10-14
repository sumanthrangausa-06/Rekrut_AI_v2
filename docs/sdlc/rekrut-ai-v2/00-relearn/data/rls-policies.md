# Rekrut AI — Access Control As It Actually Is ("RLS Policies")

*As-is, verified against `origin/dev` @ `e5599900` (2026-10-13). Companion docs:
[./data-model.md](./data-model.md) (entities & ownership), [./schema.md](./schema.md),
[./migrations.md](./migrations.md), [./seed-data.md](./seed-data.md). The filename is
kept for the doc set's shape; the content is the honest answer to "where are the RLS
policies?" — there aren't any. Anything not citable in code is marked **NOT VERIFIED**
or **NOT enforced**.*

---

## 0. Headline truth

> **This system has NO Postgres Row-Level Security.**
> No RLS policies. No `ENABLE ROW LEVEL SECURITY` on any table. No per-tenant
> database roles. **All access control is application-layer** — Express middleware,
> route-handler checks, and hand-written `WHERE company_id = …` clauses.

Scout's hunt over `origin/dev` (`migrations/`, `migrate.js`, `lib/`, `routes/`,
`server/`, `services/`, `workers/`), re-checked for this doc:

- **RLS:** zero hits for `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`,
  `CREATE POLICY`. No table has RLS; no policy exists.
- **DB roles:** no `CREATE ROLE` / `CREATE USER` anywhere. The single role reference
  in the repo is `rekrut_app`, assumed to exist out-of-band. **NOT VERIFIED:** what
  roles the live DB has, or which role the app connects as (that is the
  `DATABASE_URL` secret).
- **GRANT/REVOKE:** exactly **one** statement in the entire migration set —
  `migrations/243_biometric_audit_log.js:87`: `REVOKE TRUNCATE ON
  biometric_audit_log FROM rekrut_app;`, inside a DO block (:83-91) guarded by a
  `pg_roles` existence check, so it silently does nothing where the role doesn't
  exist. No `GRANT` anywhere.
- **Views are not access control:** the three views (`unified_interviews` 236/237,
  `v_candidate_full_profile` 238/240, `v_unified_assessments` 240) are plain joins
  with no caller filtering, no `security_barrier`, no `security_invoker`. Whoever
  can query them (in practice: the single app connection) sees full joined rows.
- **The one DB-level control that exists is integrity, not confidentiality:** the
  append-only trigger on `biometric_audit_log` (`trg_biometric_audit_log_no_update`
  + `prevent_audit_mutation()`, 243:65-76) blocks UPDATE/DELETE. It stops tampering;
  it does not stop reading.

At the DB layer, the single app connection can read and write every table.

> ⚠️ **If you are building on this: do not assume DB-level isolation exists. Any
> new query path must enforce tenancy in code, or it is a cross-company leak by
> default.** There is no safety net underneath you. Migration 251 exists for
> exactly this reason: it had to *add* `company_id` to `biometric_audit_log`
> because isolation could only be enforced in the query.

Everything below is the application layer, in the order a request meets it.

---

## 1. Layer 1 — Authentication (`lib/auth.js`)

- **Where it lives:** `authMiddleware` in `lib/auth.js:129-163`. It is **not**
  global: `server.js` mounts routers without a global auth gate (mounts at
  `server.js:657-816`), and each router applies `authMiddleware` **per route**.
  A new route that forgets it is unauthenticated by default — check every route
  you add.
- **What it does:** takes the bearer token from `Authorization` (falling back to
  `req.session.token`, :130), verifies the JWT (`verifyToken`, :27-33; 15-minute
  access tokens, :9). Failure → **401** (`Authentication required` / `Invalid or
  expired token`, code `TOKEN_EXPIRED`).
- **What it attaches:** on success it loads the user **fresh from the DB**
  (`SELECT * FROM users WHERE id = $1`, :142) and sets **`req.user` to the entire
  row** (:146) — including `company_id`, `role`, `suspended_at`, `deleted_at`
  (and, note, `password_hash`; handlers must never serialise `req.user` raw).
  Unknown user → 401.
- **Account-state enforcement happens here, not at login:** suspended →
  **403** `ACCOUNT_SUSPENDED` (:149-151); soft-deleted → **401** `ACCOUNT_DELETED`
  (:154-156); DB error → 500.
- **Sibling helpers in the same file:** `optionalAuth` (:165-182 — attaches
  `req.user` if a valid token is present, never rejects), `requireApprovedRecruiter`
  (:186-214 — recruiter-side role + `company_id IS NULL` → **403 "Account pending
  approval"**, platform-admin bypass via legacy `admin` role or an RBAC
  `admin`/`owner` row), `requireNotSuspended` (:217-227), and a legacy
  `requireRole(...roles)` (:229-239) that checks **`users.role` only**.
- **Machine auth is separate:** `middleware/api-auth.js:9-50` (`X-API-Key`,
  SHA-256 hash lookup in `api_keys`, attaches `req.apiKey` with scopes; missing →
  401 `API_KEY_MISSING`, unknown → 401, revoked → 401). It does **not** set
  `req.user`; do not mix the two principals.

## 2. Layer 2 — RBAC (`middleware/rbac.js`, migration 128)

- **Vocabulary (migration 128):** 6 roles — `owner`, `admin`, `recruiter`,
  `hiring_manager`, `interviewer`, `viewer`; 21 permissions (`billing:*`,
  `company:*`, `members:*`, `jobs:*`, `candidates:*`, `interviews:*`,
  `analytics:read`, `settings:*`, `compliance:*`); mappings in `role_permissions`,
  assignments in `user_roles` (company-scoped: PK `(user_id, role_id, company_id)`).
- **Enforcement helpers:** `requirePermission(name, opts)` (`middleware/rbac.js:
  234-260`) and `requireRole(...)` (:268-295), both factories returning middleware:
  no `req.user` → 401 `AUTH_REQUIRED`; lacking the permission/role → **403**
  (`PERMISSION_DENIED` / `ROLE_DENIED`) and the denial is audit-logged (:202-224).
  Permissions are resolved through `user_roles → role_permissions → permissions`
  (:56-63), cached in-memory per `(userId, companyId)` for 5 minutes (:39-40).
- **Precedence — read carefully, it is not one rule:**
  - `checkPermission` (:151-166): RBAC wins **by construction** — the legacy
    `users.role` fallback fires **only when the user has zero RBAC rows at all**
    (`legacyFallback = permResult.rows.length === 0 && roleResult.rows.length
    === 0`, :77; applied at :101-126). One stray RBAC row silently disables the
    legacy grant.
  - `checkRole` (:177-189) **does not apply the legacy fallback at all** — it
    re-fetches without `_applyLegacyFallback`. A legacy-only user can pass a
    `requirePermission` check and fail the sibling `requireRole` check. Known
    asymmetry; do not "fix" it casually — routes depend on both shapes.
  - `lib/auth.js` `requireRole` (§1) ignores RBAC entirely (`users.role` only).
    Three helpers, three sources of truth. When you add a gate, state which one
    you used and why.
  - Ownership transfer relies on RBAC precedence explicitly: its comment notes the
    legacy column "is only a fallback — RBAC takes precedence, so without this
    [deleting the old owner's `user_roles` row] the demotion is a no-op"
    (`routes/company.js:1313-1315`).
- **The `employer` drift (#766), verified in 128:** the RBAC seed has **no
  `employer` role**. `employer` exists only as a `users.role` CHECK value
  (`047_p2_schema_hardening.js:292-294`) and as a key in the legacy fallback map
  (`middleware/rbac.js:94` — `employer`, `recruiter`, and `hiring_manager` all map
  to the *same* `LEGACY_RECRUITER_PERMISSIONS` list, :86-99; legacy `admin` maps
  to wildcard `'*'`, :97; legacy `candidate` maps to **no** permissions, :98).
  Related: the RBAC `recruiter` role itself holds 15 of the owner's 21 permissions
  (128 §8) — near-owner breadth. The `role_permissions` join is read at runtime by
  exactly one app path — `middleware/rbac.js:56-63` (Scout's wider sweep found no
  other runtime reference outside `scripts/seed-rbac-e2e.js`, extraction-notes
  §5.10) — and nothing in the app *writes* the mapping outside migrations/role
  assignment; treat mapping changes as migration work, not admin-UI work. Whether
  an admin UI for RBAC exists: **NOT VERIFIED**.
- **Coverage is partial, not universal:** `requirePermission` (from
  `middleware/rbac.js`) is used in `routes/company.js`, `routes/departments.js`,
  `routes/jobs.js`, `routes/recruiter.js`, `routes/recruiter-import.js` (grep,
  `origin/dev`). Most other routers gate with `authMiddleware` + inline
  `req.user.role` checks (§4-§5). **Do not assume a route is RBAC-gated because
  it exists** — read it.

## 3. Layer 3 — Company scoping (the dominant convention)

- **The convention:** hiring-side queries filter by the caller's company —
  `WHERE … company_id = $n` with `req.user.company_id`. It is everywhere
  (276 `req.user.company_id` references across `routes/` on `origin/dev`; e.g.
  recruiter dashboards scope jobs and applications by company,
  `routes/recruiter.js:143,160`).
- **Where applied:** predominantly **in route handlers**, inline in the SQL of the
  handler itself — not in a shared data layer. Some services take a `companyId`
  parameter and filter internally (e.g. the audit-trail service under #920, §4).
  There is no repository/ORM layer to enforce it for you.
- **Failure shape when forgotten (the cross-company IDOR class):** an unscoped
  `SELECT … WHERE id = $1` returns any company's row to any authenticated
  hiring-side user, and an unscoped write mutates it. Every exemplar in §4 is a
  merged fix for exactly this shape. The review question for any new query is
  literal: *"where is the `company_id` (or `candidate_id = req.user.id`) in this
  WHERE clause — and if it's not there, why is that safe?"*
- **Null `company_id`:** for hiring-side access, null means **deny** (fail-closed;
  §4, §6). A pending-approval recruiter (§1, Layer 1) has `company_id = null`
  by design and must get nothing company-shaped.

## 4. Layer 4 — Object-level linkage guards (THE pattern to copy)

Four merged fixes define the house pattern. Copy these shapes; do not invent new
ones. Common skeleton: **authenticate → load/check the object scoped by the
caller's anchor (`candidate_id = req.user.id` or `company_id = req.user.company_id`)
→ deny *before* any service call or mutation → deny in the endpoint's existing
status shape so foreign and non-existent objects are indistinguishable.**

### #820 — Candidate application status guard + candidate-safe payload (`routes/candidate.js`)

*Guards:* a candidate advancing their own application through the recruiter's
pipeline, and recruiter-internal fields leaking into candidate responses.
*How:* `PUT /applications/:id/status` (:3400-3456) first loads the application
scoped to the caller (`WHERE id = $1 AND candidate_id = $2`, :3422-3425; no row
→ 404), then enforces the transition rule in code — candidates own exactly **one**
transition, `withdrawn`; any other target status → **403**, row unchanged
(:3431-3436), and terminal states can't be withdrawn (:3440-3444). Responses
never serialise the raw row: an explicit allowlist projection
(`CANDIDATE_APPLICATION_FIELDS`, :2719-2735) excludes `recruiter_notes`,
`screening_score`, `omniscore_at_apply`, `resume_url` at both SQL and
response-shaping layers.

### #821 — Compliance router object-level authorisation (`routes/compliance.js`)

*Guards:* score-explanation and audit endpoints that previously served any
authenticated caller any candidate's/company's data.
*How:* three shapes, by resource type — (a) **user-record** endpoints
(`/explain/omniscore/:userId`, :565-592) use the file's self-or-admin guard, plus
one extension: a hiring role with `company_id != null` may read a candidate who
is **linked** to their company by a `job_applications` row
(`SELECT 1 … WHERE candidate_id = $1 AND company_id = $2 LIMIT 1`, :583-587) —
guard runs before the service call; (b) **application-resource** endpoints
(`/explain/decision/:applicationId`, :616-647) load the application's own
`candidate_id`/`company_id` anchors and allow only admin, the candidate themself,
or an owning hiring role (fail-closed on null `company_id`); **everything else,
including a non-existent ID, is the same 404** — no existence oracle; candidate
audiences additionally never receive `recruiter_notes` (shaping keyed on the
authorisation identity, :651-660); (c) **unscopable** legacy audit endpoints
(`/audit/logs`, `/audit/export`, :429-467) are **admin-only (403)** precisely
because `audit_logs` has no `company_id` to scope by — when you cannot scope it,
you restrict it. The job-explain endpoint (:1113-1145) composes both: job-company
ownership (foreign/missing job → same 404) **and** a candidate×company linkage
row (missing → 403), both before the service call.

### #822 — Screening-send company-scopes the application (`routes/interviews.js`)

*Guards:* a recruiter creating a screening session against another company's
application/job (cross-company send), and dangling sessions from unchecked IDs.
*How:* `POST /screening/send` (:2729, behind `authMiddleware` +
`requireRole('admin','employer','recruiter','hiring_manager')`) resolves every
referenced object through a company-scoped query **before anything is created**:
template `WHERE id = $1 AND company_id = $2` (:2738-2741 → 404), application
`WHERE id = $1 AND company_id = $2` (:2757-2760 → **404**; foreign and
non-existent are indistinguishable, and a mismatched `candidate_id` on a
*found* application → 400, :2764-2768), resolved job likewise scoped
(:2777-2785 → 404). Previously the application check was unscoped and a missing
application silently passed.

### #920 — Audit-trail candidate↔company linkage + payload scoping (`routes/compliance.js`)

*Guards:* any company user reading any candidate's full decision audit trail —
and, subtler, a *linked* company's caller receiving events belonging to **other**
companies about the same candidate.
*How:* `GET /audit-trail/candidate/:candidateId` (:764-812). Self (candidate,
own ID) and admin pass unchanged. Everyone else must be a hiring role with
`company_id != null` **and** pass the linkage probe — `SELECT 1 FROM
job_applications WHERE candidate_id = $1 AND company_id = $2 LIMIT 1`
(:788-791) — before the service is called; failure → **403**, identical for
foreign and non-existent candidates (no existence oracle, :776-782). Passing the
gate is not the end: the service call is then **payload-scoped** with
`{ companyId: req.user.company_id }` (:799-805) so the company user receives
only their own company's events; self/admin stay unscoped.

## 5. Fail-closed conventions (as actually used)

- **Observer biometric consent gate — the strictest gate in the system:**
  `lib/observerConsentGate.js:44-68`. The AI Observer may join **only** when
  `interview_sessions.config.biometric_collection === true` (strict equality).
  `=== false` → blocked (`BIOMETRIC_CONSENT_DECLINED`); unset / null /
  non-boolean / missing session → blocked (`BIOMETRIC_CONSENT_UNKNOWN`).
  "Not declined" is explicitly **not** consent (:8-13, BIPA/GDPR Art. 9
  rationale). Pure function, called at every observer dispatch entry point
  (:26-28). This `=== true`-or-deny shape is the model for any new
  consent-adjacent check.
- **Legal hold checks fail closed:** `lib/legalHold.js` `isHeld` converts any
  lookup error to `true` (held) (:238-248); an unresolvable session throws
  rather than reading as not-held (:186-191); the erasure gate aborts on lookup
  failure (`lib/erasureService.js:86-101`). Doubt = retain + block.
- **Null `company_id` → deny** on hiring-side object access (#821 :582, :643;
  #920 :785). Never let a null scope degrade into an unscoped query.
- **403 vs 404 — the convention as found, endpoint-dependent:**
  - **Linkage/relationship failures on record endpoints → 403, no existence
    oracle:** the *response* is identical whether the candidate exists or not
    (#920, :781-786,793), but the status is the endpoint's pre-existing 403.
  - **Scoped object loads → 404:** when the guard *is* the scoped query
    (`WHERE id AND company_id/candidate_id`), foreign and missing collapse into
    "not found" (#822; #820 :3427-3429; #821 decision/job explains :646, :1127).
  - **Role/permission failures → 403** with a machine-readable code (§1-§2);
    **unscopable sensitive collections → 403 admin-only** (#821 audit logs).
  There is no global rule — **match the endpoint you are extending**, and state
  in the PR which shape you chose and why. Do not introduce a new endpoint where
  foreign-vs-missing is distinguishable.
- **Auth-state failures:** suspended → 403, deleted → 401 (§1). Missing/invalid
  token → 401 everywhere; never fall through to a handler on an auth error
  (the one deliberate exception is `optionalAuth`, which attaches nothing on
  failure rather than a partial identity).

## 6. Per-sensitive-table access rules (as enforced in code)

Only rules citable in code. "—" means no specific guard was found beyond the
layers above; PRD/aspirational rules are labelled, never presented as real.

| Family (tables) | Read | Write | Enforcing guard (citation) |
|---|---|---|---|
| Candidate PII / profile (`candidate_profiles`, `candidate_skills`, `work_experience`, `education`, `parsed_resumes`, `cv_*`) | Self (`candidate_id/user_id = req.user.id`); hiring side only via application/search linkage — search-index visibility rules: **NOT VERIFIED** per-endpoint in this pass | Self; scoring/verification writers internal | `authMiddleware` + per-route `candidate_id` scoping (house pattern, §3-§4). No single profile guard file exists — verify per route before relying on it |
| Applications incl. `recruiter_notes` (`job_applications`) | Candidate: own rows, **allowlist projection only** (never `recruiter_notes`/`screening_score`); Recruiter: own-company rows | Candidate: `withdrawn` transition only; Recruiter: pipeline statuses on own-company rows | #820 `routes/candidate.js:2719-2735, 3400-3456`; #821 audience shaping `routes/compliance.js:651-660` |
| Recordings / frames + storage objects (`interview_recordings`, `recording_objects`, R2/B2 files) | Candidate of the session, or recruiter-side user of the session's company; playback goes through guarded routes, never raw storage URLs | Recording start/stop: recruiter-side of the owning company only | `server/routes/recordings.js:72-98` (session check: candidate match **or** recruiter role + `session.company_id` match), :217-219, :411-413 (403 on company mismatch; missing event → 404) |
| Biometric / observer data (`biometric_templates`, `ai_observer_reports`, `observer_audio_chunks`, `observer_speech_measurements`) | **NOT VERIFIED** as a complete read matrix in this pass; reports surface through session-scoped routes | Observer may be enabled **only** under `biometric_collection === true`; templates are DEK-encrypted and keyed by opaque `subject_ref` (246), joinable only via `biometric_session_map` — which Scout found referenced only by its migration test, **not** by runtime code (extraction-notes §5.10) | `lib/observerConsentGate.js:44-68` (enable gate). Do not build a new biometric read path on the assumption the segregation join is exercised — it is **NOT enforced** in running code today |
| Audit trails (`compliance_audit_trail`, `audit_logs`, `biometric_audit_log`) | Candidate: own trail. Company user: linked candidates only, **payload scoped to own company**. Legacy `audit_logs`: **admin only** | Append-only (system writers); biometric log UPDATE/DELETE blocked by trigger | #920 `routes/compliance.js:764-812`; #821 `routes/compliance.js:429-467`; trigger `243_biometric_audit_log.js:65-76` |
| DSAR / erasure (`data_requests`, erasure endpoints) | Self-service: own requests (`POST /gdpr/export`, `/gdpr/delete` behind `authMiddleware`, `routes/compliance.js:28,99`); fulfilment: admin path (`routes/admin.js:2039+`) | Erasure executes only via `erasePersonalData()`; legal hold → **409**, nothing deleted | `lib/erasureService.js:84-101`; `routes/auth.js:1818-1827` (self-serve delete-account, same 409 + durable conflict record) |
| Consent (`consent_texts`, `consent_receipts`) | Candidate: own receipts; hiring-side read views company-scoped (S-065 C1 pattern in `lib/biometricAudit.js` header) | Candidate action only, via `lib/consentService.js` (declared sole owner, :4-5); grant/decline/withdraw propagates to `interview_sessions.config.biometric_collection` (:124-135, :214-220) | `lib/consentService.js`; downstream gate §5 |
| Billing (`users.stripe_*` / subscription fields, billing routes) | Authenticated user: own tier/usage (`routes/billing.js:406,508`, `authMiddleware` only) | `billing:manage` exists **only** in the RBAC `owner` role (128 §8) — but whether every billing mutation route actually mounts `requirePermission('billing:manage')`: **NOT VERIFIED**. Webhook route is mounted raw-body and unauthenticated by design (`server.js:472`) — its signature verification: **NOT VERIFIED** in this pass | Migration 128 (vocabulary); `routes/billing.js` (partial) — audit before touching |

## 7. What is NOT here (do not invent it)

- No RLS, no DB policies, no per-tenant roles, no security-definer views — §0.
- No global auth middleware — per-route only (§1). Route coverage was **not**
  exhaustively audited for this doc; an unauthenticated route would not be
  visible from the layers above. **NOT VERIFIED:** complete route-by-route auth
  coverage.
- No uniform 403/404 rule — §5 documents the conventions *as found*.
- RBAC is real but partial (§2): most routers use inline `users.role` checks,
  and the three role helpers disagree on precedence/fallback. Any statement of
  the form "role X can do Y" is only true **per endpoint** until that endpoint
  is read.
- Live-DB roles/grants beyond the single `REVOKE` — **NOT VERIFIED** (no live-DB
  access from the build VM).

---

**Data documentation pack:** [index](./README.md) · [data model](./data-model.md) · [schema](./schema.md) · [migrations](./migrations.md) · [access control / RLS](./rls-policies.md) · [seed data](./seed-data.md)
