# Design — Issue #1624: Documents module, company-scoped verification & review

- **Persona:** Rex (Phase 3 — Solutioning / architecture)
- **Type:** Design only. No code changes, no GitHub writes (HL-007: the parent lands everything and verifies first-hand).
- **Gate this satisfies:** Founder ruling 2026-10-23 on #1624 (comment `6360977656`): the documents module **stays in launch scope**; (1) company-scoping is designed first, in writing, before any build; (2) build follows this design; (3) the unsafe current review endpoints are **not** mounted as-is.
- **Skills consulted:** startup-cto (first), smart-sdlc `create-architecture` method, ecc/architect lens; ponytail for scope minimalism (reuse the existing relationship pattern, no new auth framework, no new tables unless forced).
- **Harness lessons applied:** HL-001 (every load-bearing claim re-verified on the live source), HL-003 (all proof is assembled-app E2E; hand-mounted-router tests are disqualified as evidence), HL-004 (this design executes the panel's discussed position and Sumanth's ruling — no solo rulings; open questions in §9 are labelled, not decided), HL-006 (this document IS the deliverable; the build PRs must also carry the docs/sdlc note per §8).
- **Evidence base:** the reconciled panel record (`hidden_files/0043-run-2026-10-23/panel-1624/DISCUSSION.md`, findings verified), Scout's investigation (`hidden_files/2243-run-2026-10-22/scout-1624/INVESTIGATION.md`, 13-route inventory), and first-hand re-verification by Rex at **`origin/dev` tip `f6aca9ee85a8d97d569ad9e397d69311c0e7ca17`** (the panel verified at `a5326150d`, its parent commit — all line numbers below are the `f6aca9ee8` numbers; no documents-module code changed between the two tips).

---

## 1. Current state, verified (the problem in one page)

Three routers and two tables claim the candidate-documents surface, and the seams between them are where the module is broken:

| Router | Mount (verified) | Table | State in the assembled app |
|---|---|---|---|
| `routes/candidate.js` — internal `GET /documents` (L5018), `POST /documents/upload` (L5104), `DELETE /documents/:id` (L5216) | `server.js:738`, `app.use('/api/candidate', candidateRoutes)` | `documents` (Issue #109 shape: `user_id, name, type, url, size, status, fraud_score, ocr_text, document_score, …`, created inline `CREATE TABLE IF NOT EXISTS`) | **Wins** the three paths the React page actually calls, by Express first-match |
| `routes/candidate-documents.js` — 7 routes (L62, 116, 229, 265, 322, 379, 407) | `server.js:786`, `app.use('/api/candidate/documents', candidateDocumentRoutes)` | `verification_documents` (migration 009 + encryption columns in migration 010) | Its `GET /`, `POST /upload`, `DELETE /:id` are **shadowed** by candidate.js; `GET /stats`, `GET /:id`, `GET /:id/download`, `GET /:id/verification` fall through and are live. This is the only router that calls `verifyDocument` (L189) — on a route no real upload reaches |
| `routes/documents.js` — 13 routes, 805 lines | `server.js:138` requires it as `_documentRoutes`; **never mounted** (the name occurs exactly once) | `verification_documents` + `document_review_queue` + `verified_credentials` | All 13 routes 404 in the assembled app (unmatched `/api/*` → `server.js` fallback `404 { error: 'API endpoint not found' }`) |
| `routes/recruiter-documents.js` | `server.js:787`, `/api/recruiter/candidates` (mergeParams) | `verification_documents`, writes `document_access_logs` live | Mounted and working; the reference implementation for company-relationship scoping (`verifyCompanyAccess`, L24–56) |

Consequences, all verified first-hand:

1. **`verifyDocument` never runs in the assembled app.** Its only route callers repo-wide are `routes/documents.js:148`-area (unmounted router) and `routes/candidate-documents.js:189` (shadowed route). `routes/candidate.js` never imports `document-verification`. The upload door users actually use writes to the `documents` table with **no virus scan, no encryption step in the handler, and no verification call at all**.
2. **No new `document_review_queue` rows can be produced.** The only producer is `verifyDocument` (`services/document-verification.js:941–960`: on `fraudRisk` medium/high, `INSERT … ON CONFLICT (document_id) DO UPDATE … review_status='pending'` reset). Mounting `documents.js` alone would expose a queue with no live producer — an honestly-empty-forever queue is theatre, not a workflow.
3. **The two review endpoints are unsafe as written** (panel §0.2, re-verified): `GET /review-queue` (`routes/documents.js:459`) is gated only by `requireRole('admin','recruiter','hiring_manager')` and filters only on `review_status`; `POST /review/:documentId` (L519) has the same role-only gate and delegates to `resolveDocumentReview`, which on `approved` calls `applyDocumentScoresToOmniScore(review.user_id)` (service L1186). Any recruiter could list every tenant's flagged documents and move a foreign candidate's OmniScore.
4. **Within-router shadowing in `documents.js`:** `GET /:id` (L273) is registered before `GET /consistency-check` (L435) and `GET /review-queue` (L459); both single-segment GETs are unreachable even once mounted. `GET /credentials/list` (L582) and `GET /stats/summary` (L692) survive only by segment-count luck.
5. **The legacy download would serve ciphertext:** `GET /:id/download` in `documents.js` (L733) streams `file_url` as-is and never decrypts (no `decrypt` anywhere in the file), while canonical rows are AES-256 ciphertext with `encryption_iv`/`encryption_tag` on the row (migration 010). The candidate router's download (L322) decrypts correctly.
6. **Two contract mismatches hide under the shadowing** (Rex finding, verified — Nova must not discover these mid-build):
   - **Multipart field/type mismatch.** The React page (`client/src/pages/candidate/documents.tsx:140–142`) sends form field **`file`** and body field **`type='other'`**. `candidate-documents.js` upload expects field **`document`** (`upload.single('document')`, L116) and body **`document_type`** validated against `VALID_DOCUMENT_TYPES = [resume, education_certificate, employment_letter, id_document, certification, reference_letter]` (L50–57) — `'other'` is rejected. Unshadowing alone therefore turns the live upload from "works, unverified" into "400".
   - **Response-shape mismatch.** The page's `Document` type expects `{ id: string, name, type, url, size, uploadedAt, status, documentScore?, fraudScore? }` (page L31+, populated from candidate.js's adapter). `candidate-documents.js GET /` returns `{ success, documents: [{ id: <int>, document_type, name, size, status, uploaded_at, authenticity_score, fraud_risk, … }] }` with no `type`/`uploadedAt`/`url` fields. Unshadowing alone breaks list rendering.
7. **Identity facts the design relies on** (verified): `authMiddleware` (`lib/auth.js:166`ff) loads `req.user` fresh from `SELECT * FROM users WHERE id = $1`, so `req.user.role` and `req.user.company_id` are DB-current, not stale JWT claims. `job_applications` carries `candidate_id` and `job_id`; `jobs` carries `company_id`. The sibling scoping pattern already in production code is:
   `SELECT 1 FROM job_applications a JOIN jobs j ON a.job_id = j.id WHERE a.candidate_id = $1 AND j.company_id = $2 LIMIT 1` — used identically in `documents.js:323–331`, `documents.js` `/:id/verification`, `documents.js` `/:id/download`, and `recruiter-documents.js:42–48`.

---

## 2. Decisions at a glance

| # | Decision |
|---|---|
| D1 | **`verification_documents` is the canonical document store** for everything verification-related. The `documents` table stops receiving writes; it is neither dropped nor migrated away in this programme (see §7). |
| D2 | **Canonical upload door = `POST /api/candidate/documents/upload` served by `candidate-documents.js`** (scan → encrypt → store → `verifyDocument`). candidate.js's three document handlers are removed so the door is reachable. A compatibility adapter (§4.2) absorbs the page's current field names and response expectations — the page changes minimally, in the same lane. |
| D3 | **Company scope is derived at access time from the live application relationship** (`job_applications ⋈ jobs`), never snapshotted onto the queue row. No `company_id` column is added to `document_review_queue` (§3.1 gives the reason: one document, potentially many legitimate reviewing companies). The only schema addition is an audit column for *who acted for which company* (§7). |
| D4 | **Review roles:** `admin` (platform-wide override, no relationship required), `recruiter` and `hiring_manager` (company-scoped only). `employer` is **not** added to the review gates — the existing gates omit it and widening a role set is a product ruling, not a design detail (§9, Q2). A non-admin reviewer with `company_id IS NULL` gets 403. |
| D5 | **Foreign-company access is 403 with zero side effects** — the scope check runs before `resolveDocumentReview` is called, so a foreign resolve attempt cannot touch the queue row, the document status, or OmniScore (§3.3). |
| D6 | **`documents.js` mounts at `/api/documents` with exactly 11 routes** (§5.1): the 6 unique routes, the scoped read routes, and a decrypt-fixed download. Legacy `POST /upload` and `DELETE /:id` handlers are **deleted, not mounted** (panel sub-decision (b), settled), with their orphaned imports removed in the same edit. |
| D7 | **Resolve becomes an atomic claim:** the service updates the queue row only `WHERE review_status = 'pending'`, inside its existing transaction. Already-resolved → 409, not-in-queue → 404 (§5.3). Appeal already re-pends a row (service L1218ff), so an appealed document becomes resolvable again through the same claim — no new state machine. |
| D8 | All build lanes are **strictly sequential** — every lane touches the same file cluster (`server.js`, `routes/candidate.js`, `routes/candidate-documents.js`, `routes/documents.js`, `services/document-verification.js`). No parallel lanes for #1624 (programme pace rule yields to the shared-files rule). |

---

## 3. Company-scoping model

### 3.1 Who owns a document, who may review it

- A document in `verification_documents` is owned by exactly one candidate: `verification_documents.user_id` → `users.id`. The queue row mirrors that owner: `document_review_queue.user_id` is the candidate (set by `verifyDocument` at insert).
- A reviewer is mapped to a company by **`users.company_id` on the reviewer's own row**, read fresh by `authMiddleware` on every request. There is no other company source in the design (no header, no query param, no body field may assert a company — anything the client sends claiming a company is ignored).
- The candidate↔company relationship is: *the candidate has at least one `job_applications` row whose `jobs.company_id` equals the reviewer's `company_id`.* This is the exact pattern the sibling handlers already enforce (§1.7), so review scoping is consistent with document-detail scoping — a recruiter who can open the document can review it, and vice versa.
- **Why scope is not stored on the queue row:** `document_review_queue.document_id` is `UNIQUE` (migration 134) — one queue row per document, for the candidate's lifetime of that document. A candidate may have applied to several companies; each of those companies' recruiters has a legitimate, independent interest in the same flagged document. A single `company_id` column would have to pick one company arbitrarily at verification time (before anyone knows who will review) and would wrongly exclude the others. Derived-at-read scope handles the multi-company case correctly with zero schema change and can never go stale when a new application is filed after the document was flagged.
- **Admin override:** `users.role = 'admin'` bypasses the relationship check everywhere in this module (list, detail, resolve, download). Note this is a *correction* to the current `documents.js` read handlers, which apply the relationship query to admins too (an admin with `company_id NULL` would fail their own check); the mounted handlers implement admin-bypass explicitly (§3.4).

### 3.2 Visibility matrix

| Caller | `GET /api/documents/review-queue` | `POST /api/documents/review/:documentId` | `GET /api/documents/:id`, `/:id/verification`, `/:id/download` | Own-document routes (`GET /`, `/consistency-check`, `/credentials/list`, `/stats/summary`, `/:id/access-log`, `POST /appeal/:documentId`) |
|---|---|---|---|---|
| `candidate` | 403 (role gate) | 403 (role gate) | Own documents only; another candidate's → 403 | Own only (owner check in handler/SQL, as today) |
| `recruiter` / `hiring_manager` with `company_id` | Only queue rows whose candidate has an application to **their** company | Only documents whose candidate has an application to their company; else 403, no side effects | Same relationship rule (existing pattern) | Their own uploaded documents: none in practice (candidates own documents); handlers remain owner-scoped, unchanged |
| `recruiter` / `hiring_manager` without `company_id` | 403 (`No company associated with account`, mirroring `recruiter-documents.js:38`) | 403, no side effects | 403 for non-owned documents | — |
| `admin` | All rows, all companies | Any document; no relationship required | Any document | — |
| Unauthenticated | 401 | 401 | 401 | 401 |
| Any other role (incl. `employer`) | 403 (role gate, unchanged) | 403 (role gate, unchanged) | Falls to owner/relationship logic as today (effectively 403 unless owner) | — |

### 3.3 The exact authorization checks (build contract)

**Shared helper.** Nova extracts one helper used by the queue list, resolve, and the three scoped read handlers in `documents.js` (the read handlers today each inline the same query — the helper replaces the inline copies in this router only; `recruiter-documents.js` keeps its own `verifyCompanyAccess`, untouched):

```
// returns true iff caller may act on documents owned by candidateId
async function canAccessCandidateDocuments(req, candidateId) {
  if (req.user.role === 'admin') return true;
  if (!req.user.company_id) return false;
  const r = await pool.query(
    `SELECT 1 FROM job_applications a JOIN jobs j ON a.job_id = j.id
     WHERE a.candidate_id = $1 AND j.company_id = $2 LIMIT 1`,
    [candidateId, req.user.company_id]);
  return r.rows.length > 0;
}
```

**Queue list (`GET /review-queue`)** — role gate unchanged (`authMiddleware` + `requireRole('admin','recruiter','hiring_manager')`), then:

- `admin`: current query unchanged (filter `review_status` only).
- Non-admin, `company_id` null → `403 { error: 'No company associated with account' }` before any query.
- Non-admin with company: both the page query **and the count query** gain the scope predicate — as an `EXISTS`, not a join, so a candidate with three applications to the same company still yields one queue row:

```sql
AND EXISTS (
  SELECT 1 FROM job_applications a JOIN jobs j ON a.job_id = j.id
  WHERE a.candidate_id = drq.user_id AND j.company_id = $2
)
```

(parameter order adjusts accordingly; `total` in the response is the **scoped** count — an unscoped total would leak the size of other tenants' queues).

- `status` query param is validated against `pending | approved | rejected` (the only values `resolveDocumentReview` and the appeal path write); any other value → `400`. `limit` is clamped to 1–100, `offset` to ≥ 0 (today both are `parseInt`ed unbounded).

**Resolve (`POST /review/:documentId`)** — role gate unchanged; `decision` validation unchanged (`approved` | `rejected`, else 400). Then, **in this order**:

1. Load the queue row's owner: `SELECT user_id, review_status FROM document_review_queue WHERE document_id = $1`. No row → `404 { error: 'Document not found in review queue' }`.
2. Scope: `canAccessCandidateDocuments(req, row.user_id)` false → `403 { error: 'Access denied' }`. **`resolveDocumentReview` is not called.** No queue write, no status write, no OmniScore call, no access-log write that could be mistaken for a review action. This ordering is the whole point of the founder's "not mounted as-is" instruction and is journey-tested as such (§8, J2).
3. Already-resolved: `row.review_status !== 'pending'` → `409 { error: 'Review already resolved', review_status: <current> }` (defence-in-depth; the service's atomic claim in D7 is the authoritative guard under concurrency).
4. Delegate to `resolveDocumentReview(documentId, reviewerId, decision, notes)`.
5. On success, write the audit entries (§5.3): `logDocumentAccess(documentId, reviewerId, 'review_approved' | 'review_rejected', req.user.company_id ?? null, req.ip)` and stamp `document_review_queue.reviewer_company_id` (§7).

**Scoped reads (`GET /:id`, `/:id/verification`, `/:id/download`)** — keep today's owner-or-relationship logic with two changes: (a) route the relationship test through the shared helper so `admin` bypasses it; (b) `employer` remains outside the privileged set, exactly as today. Non-owner access continues to be logged via `logDocumentAccess` (existing behaviour, `document_access_logs` is live-written today — panel §0.1).

### 3.4 What scoping deliberately does not do

- It does not hide document *existence* from a foreign recruiter who guesses an ID on the resolve path beyond the specified responses: resolve answers 404 only when no queue row exists at all and 403 when one exists but is foreign — that split is the contract Sumanth's ruling names ("foreign-company access → 403"). The queue *list* never leaks foreign rows or counts.
- It does not introduce per-application document ownership. A document is the candidate's, uploaded once, visible to every company the candidate has applied to. That is the pre-existing sibling model (recruiter-documents behaves the same way); changing it is a product decision (§9, Q3), not part of this design.

---

## 4. Verification execution — one canonical door

### 4.1 The reconciliation: 3 routers, 2 tables

- `verification_documents` (migration 009) is canonical. Everything in the verification chain already keys off it: `document_verifications`, `document_review_queue`, `verified_credentials`, `document_score_impacts`, `document_access_logs` all reference it.
- `documents` (candidate.js's inline table, Issue #109) is the legacy store the live page writes today. Under this design it receives **no new writes** once Lane 1 lands, and no route reads it. It is **not dropped** and its rows are **not deleted** (§7).
- The routers reconcile to one owner per prefix:
  - `/api/candidate/documents*` → `candidate-documents.js` owns **all** of it (list, upload, stats, detail, download, delete, verification).
  - `/api/documents*` → `documents.js` owns the review/appeal/credentials/consistency/access-log surface plus its scoped reads (§5.1).
  - `/api/recruiter/candidates/:candidateId/documents*` → `recruiter-documents.js`, unchanged.
  - `candidate.js` keeps everything else it serves under `/api/candidate` — only its three document handlers (`GET /documents` L5018, `POST /documents/upload` L5104 incl. the `parseDocumentFile` helper if it serves nothing else, `DELETE /documents/:id` L5216) are removed. Nova must grep-confirm `parseDocumentFile` has no other caller in the file before removing it; if it does, only the three handlers go.

### 4.2 The compatibility adapter (why Lane 1 is not just a deletion)

Removing candidate.js's handlers exposes candidate-documents.js to the real page — and the real page speaks a slightly different contract (§1.6). Lane 1 therefore includes, in `candidate-documents.js` and the page, the smallest adapter that makes the assembled journey work end-to-end:

1. **Upload field names:** the upload middleware accepts **either** multipart field name: try `upload.single('document')`, and on the page's current field name also accept `file` (implement as two chained multer single-field middlewares or `upload.fields([{name:'document',maxCount:1},{name:'file',maxCount:1}])` with `req.file = req.files?.document?.[0] ?? req.files?.file?.[0]`). Ponytail: one `fields()` call, no new dependency.
2. **Document type:** accept `document_type` **or** the page's legacy `type` field. Map legacy page types onto the verification whitelist explicitly: `resume→resume`, `certificate→certification`, `id→id_document`, `transcript→education_certificate`, `portfolio→other-unmapped`, `other→other-unmapped`. Unmapped values (`other`, `portfolio`) must not be silently forced into a verification category: for those, Lane 1 stores the document with `document_type` set to the closest honest value — Nova implements this as: if the mapped type is unmapped, default to `resume` **only** when the page flow is the CV/resume flow; otherwise reject with `400 { error: 'Document type required' }` rather than inventing a category. *(Design note: today's page hard-codes `type: 'other'` for every upload — `documents.tsx:140`. The page change in this lane replaces that hard-code with the type the user is actually uploading: the Documents page upload control gains the existing six-type select already implied by its tab set, defaulting to `resume`. This is a page-contract fix, not a redesign; anything larger goes through the Job Board + Profile PRD process, not this issue.)*
3. **List response:** `candidate-documents.js GET /` adds the page's expected aliases alongside the canonical fields — `type: document_type`, `uploadedAt: uploaded_at`, `id` stays numeric in the payload but the page's `Document` type widens to `string | number` **or** the server stringifies; Nova picks server-side `String(id)` to match candidate.js's current adapter behaviour (page L: candidate.js returns `id: String(d.id)` today — preserving that is the least-surprise choice). `url` is **never** synthesised: the canonical list strips `file_url` by design, so the field is omitted and the page must not depend on it (today it renders `url: d.url || ''` — empty is already tolerated).
4. **Upload response:** keep candidate-documents' current shape (`{ success, document: { id, document_type, name, status, size, uploadedAt }, message }`) and add the same `type` alias; the page's upload handler consumes `data.document` and prepends it — Nova verifies the page renders status from this shape (it does: it stores the returned document object directly).

No other page changes. The JSON `{name, url}` non-multipart branch of candidate.js's upload (L5156ff — accepts a URL with no file at all) is **not** carried over: an upload door that stores an unverified remote URL as a document contradicts the verification purpose of the module, and no live client uses it (the page always sends FormData).

### 4.3 How `verifyDocument` runs, end to end (the assembled flow)

1. Candidate uploads on the Documents page → `POST /api/candidate/documents/upload` (FormData) → now reaches `candidate-documents.js:116` (first match after Lane 1).
2. Handler order is unchanged and already correct: virus scan (`scanFile`, L129; failure → `400 VIRUS_SCAN_FAILED`, nothing stored) → AES-256 `encryptBuffer(buffer, userId)` (L147) → store ciphertext to B2 (`application/octet-stream`) → `INSERT INTO verification_documents (…, status 'pending', encryption_iv/tag/algorithm)` (L163ff).
3. Fire-and-forget verification: `verifyDocument(document.id, userId)` (L189), `.then` applies OmniScore impact **only** when `fraud_risk !== 'high' && !analysis_unavailable` (L194–195 — the #1569 honesty guard, preserved verbatim); `.catch` logs and leaves the document at `status 'pending'` — an honest in-progress/failed state, never a fabricated verdict.
4. Inside `verifyDocument` (service L771ff, transaction): OCR + authenticity + consistency + duplicate checks → writes `document_verifications` → sets `verification_documents.status` to `verified` (low risk) or `pending_review` (otherwise) → **queue production:** if risk is medium/high, upserts the `document_review_queue` row (see §4.4) → writes `document_score_impacts` → on low risk with score ≥ 70, upserts `verified_credentials`.
5. A company-scoped recruiter (or admin) now sees the flagged document via `GET /api/documents/review-queue` and drains it via `POST /api/documents/review/:documentId` (§5). The candidate can appeal a rejection via `POST /api/documents/appeal/:documentId`, which re-pends the queue row (service L1218ff).

### 4.4 Idempotency and repeat-execution safety

- **Queue production is idempotent per document:** `document_review_queue.document_id` is `UNIQUE` and the insert is `ON CONFLICT (document_id) DO UPDATE` (service L944–960). Re-running `verifyDocument` for the same document can never create a second queue row. One honest caveat Nova must preserve visibility of, not silently "fix": the conflict update **resets** the row to `pending` and clears reviewer fields — correct for a fresh verification of a never-reviewed document, and reachable for an already-reviewed document only if `verifyDocument` is re-invoked on it, which no route in this design does (upload always creates a new `verification_documents` row, hence a new `document_id`). No service change is made for this in #1624; the behaviour is recorded here so a future re-verification feature inherits the warning.
- **Upload is intentionally not deduplicated:** each upload creates a new document row (duplicate *content* is a verification signal — `checkDuplicateDocument` — not an upload error). Double-click/double-submit produces two documents, two verifications, at most two queue rows for two distinct documents. Acceptable and honest.
- **Score application is idempotent:** `applyDocumentScoresToOmniScore` only selects impacts `WHERE applied_to_omniscore = false AND verification_status = 'verified' AND authenticity_score IS NOT NULL` and marks them applied in the same transaction (service L1052ff). A resolve replay cannot double-apply (and §5.3's 409 + atomic claim stop the replay earlier anyway).
- **Appeal is naturally idempotent-ish:** re-appealing a `rejected` document rewrites `appeal_reason/appealed_at` and re-pends; appealing a non-rejected document errors honestly (service throws `Only rejected documents can be appealed` → route returns 400).

---

## 5. Review workflow contract

### 5.1 Endpoints to mount — `documents.js` at `/api/documents`

Mount line (Lane 2): rename `server.js:138` `_documentRoutes` → `documentRoutes` and add `app.use('/api/documents', documentRoutes);` immediately after `server.js:787` (the recruiter-documents mount), inside the document-mount block the L785 comment describes. Inventory at `server.js:2113`: `endpoints: 8` → **`11`**.

**Route-order fix (same edit):** in `routes/documents.js`, register all specific GET paths **before** `GET /:id` — `/consistency-check`, `/review-queue`, `/credentials/list`, `/stats/summary` move above it, so "specific before parameterised" holds by construction (the #1732/#1254 defect class), not by segment-count luck.

| # | Route (absolute) | Roles | Scoping | Disposition |
|---|---|---|---|---|
| 1 | `GET /api/documents/review-queue` | admin, recruiter, hiring_manager | §3.3 (admin all; recruiter company `EXISTS`; no-company 403) | **Mount, scoped (new behaviour)** |
| 2 | `POST /api/documents/review/:documentId` | admin, recruiter, hiring_manager | §3.3 pre-check before service call | **Mount, scoped (new behaviour)** |
| 3 | `POST /api/documents/appeal/:documentId` | candidate | Owner + `rejected`-only, enforced in service (`WHERE id=$1 AND user_id=$2`) | Mount as-is |
| 4 | `GET /api/documents/consistency-check` | any authenticated (own documents) | Caller's own `user_id` only (service signature) | Mount as-is, unshadowed |
| 5 | `GET /api/documents/credentials/list` | any authenticated | Caller's own credentials only | Mount as-is |
| 6 | `GET /api/documents/:id/access-log` | owner only | 403 if `vd.user_id !== caller` (existing check) | Mount as-is |
| 7 | `GET /api/documents/` | any authenticated | Own documents only; `file_url` stripped | Mount as-is |
| 8 | `GET /api/documents/:id` | owner, or recruiter/hiring_manager/admin per §3.3 helper (admin bypass added) | Relationship check; non-owner access logged | Mount with helper |
| 9 | `GET /api/documents/:id/verification` | same as #8 | Same | Mount with helper |
| 10 | `GET /api/documents/:id/download` | same as #8 | Same; access logged | **Mount with decrypt fix (§5.2)** |
| 11 | `GET /api/documents/stats/summary` | any authenticated | Caller's own aggregates only | Mount as-is |
| — | `POST /api/documents/upload` | — | — | **Handler deleted** (panel (b)); path falls through to the standard assembled-app 404 |
| — | `DELETE /api/documents/:id` | — | — | **Handler deleted** (panel (b)); canonical delete is `DELETE /api/candidate/documents/:id` |

Deletion takes its orphaned code with it (panel §2.4, re-verified): the `multer` require + `upload` config (L3, L17–40), `emailService` (L6), `uploadToB2` (L7), and `verifyDocument` + `applyDocumentScoresToOmniScore` from the service import (L8–15) — **keeping** `logDocumentAccess`, `checkCrossDocumentConsistency`, `resolveDocumentReview`, `appealDocument`. `public/js/documents.js` is not deleted (dead static asset, separate cleanup).

### 5.2 Download decrypt fix (route 10)

`documents.js GET /:id/download` is rebuilt on the candidate router's proven pattern: select `encryption_iv, encryption_tag, encryption_algorithm` with the document row; fetch the stored object; **if `encryption_iv` is present**, return `decryptBuffer(fetched, iv, tag, document.user_id)` — note the key material derives from the **owner's** user id (that is how `encryptBuffer(buffer, userId)` sealed it at upload), never the requester's; set `Content-Type` to the document's real `mime_type`. **If `encryption_iv` is NULL** (a row that predates encryption — the only such rows possible are historic, since the canonical door always encrypts), stream the stored bytes as-is. That branch exists for historic-row honesty and must be commented as such (`ponytail:` note: remove when a data audit shows no NULL-IV rows remain). Response headers mirror the current handler (attachment filename, encoded).

### 5.3 Request/response shapes and resolve semantics

**`GET /api/documents/review-queue?status=pending&limit=50&offset=0`**

```jsonc
// 200 — pending work exists
{ "success": true,
  "reviews": [ { "id": 12, "document_id": 34, "user_id": 56,
                 "candidate_name": "…", "candidate_email": "…",
                 "fraud_risk": "high", "fraud_flags": [ … ],
                 "review_status": "pending", "reviewer_id": null,
                 "reviewed_at": null, "review_notes": null,
                 "appeal_reason": null, "appealed_at": null,
                 "created_at": "…", "document_type": "id_document",
                 "original_filename": "…" } ],
  "total": 1, "limit": 50, "offset": 0 }        // total is scope-filtered (§3.3)

// 200 — honest empty state (the expected state until a flagged upload exists)
{ "success": true, "reviews": [], "total": 0, "limit": 50, "offset": 0 }

// 400 — status not in pending|approved|rejected
{ "error": "Invalid status filter" }
// 401 unauthenticated · 403 candidate role (role gate) · 403 recruiter without company_id
```

**`POST /api/documents/review/:documentId`** — body `{ "decision": "approved" | "rejected", "notes": "…" }` (`notes` optional, stored as `review_notes`).

```jsonc
// 200
{ "success": true, "message": "Document approved", "review": { /* updated queue row */ } }
// 400 decision missing/invalid (existing) · 401 · 403 role gate ·
// 403 foreign company (no side effects, §3.3) ·
// 404 no queue row for this document · 409 already resolved (carries current review_status)
```

**What resolve does (service `resolveDocumentReview`, one transaction — existing behaviour, restated as contract):**

- `approved`: queue row → `review_status='approved'`, `reviewer_id`, `reviewed_at`, `review_notes` set; `verification_documents.status → 'verified'`; `document_verifications.false_positive → true` (the flag was a false alarm — this is the audit semantics of approval); `document_score_impacts.verification_status → 'verified'` for impacts with a real score; then `applyDocumentScoresToOmniScore(candidate_id)` — which moves OmniScore **only** by the sum of that candidate's verified, not-yet-applied, non-NULL-score impacts and writes the `score_history` row (`change_reason 'Document verification completed'`, `component_type 'document'`). If no such impact exists, OmniScore is unchanged and the resolve still succeeds — approving a document with no measured score impact must not invent one (no-fake-numbers rule).
- `rejected`: queue row → `review_status='rejected'` (+ reviewer fields); `verification_documents.status → 'rejected'`; `document_score_impacts.verification_status → 'rejected'`; **no OmniScore call**.
- **Audit trail after this design** (three records, all queryable): the queue row itself (`reviewer_id`, `reviewed_at`, `review_notes`, plus new `reviewer_company_id`, §7), the `document_access_logs` row written by the route (`access_type 'review_approved'/'review_rejected'`, `company_id` = reviewer's company, `NULL` for admin), and — on approval with impact — the `score_history` row. Candidate-visible consequence: document status flips to `verified`/`rejected` in their list; a rejection makes the document appealable.

**Service change (the only one): atomic claim.** In `resolveDocumentReview`, the queue update gains `AND review_status = 'pending'`; if it returns 0 rows the service distinguishes: no row at all → throw `Document not found in review queue` (route maps to 404); row exists but not pending → throw a distinct `Review already resolved` error (route maps to 409). The rest of the function is untouched. (The route-level pre-checks in §3.3 produce the friendly 403/404/409 in the common path; the service guard is what makes concurrent double-resolve safe.)

**`POST /api/documents/appeal/:documentId`** — contract unchanged: candidate role, owner enforced in service, body `{ reason }` 1–2000 chars (route validates), success → `{ success: true, message: 'Appeal submitted successfully', document_id, appealed_at }`, queue row returns to `pending` and re-enters every authorised company's queue view (scope is derived, §3.1 — an appeal needs no company routing).

### 5.4 Honest states (contract, not afterthoughts)

| State | Behaviour |
|---|---|
| Queue empty (incl. "module just launched, nothing flagged yet") | `200` with `reviews: [], total: 0`. Never an error, never seeded/sample rows |
| Document uploaded, verification still running or failed | Document stays `status 'pending'`; no queue row; no score impact. The candidate's list shows pending — that is the truth of the system at that moment |
| Verification analysis unavailable | The #1569 guard stands: no OmniScore application from the upload path; whatever `verifyDocument` measured (incl. a queue row if risk was assessed medium/high) is real, and nothing unmeasured is scored |
| Already-resolved document re-submitted for review | `409` with the current status (§5.3); OmniScore provably unchanged |
| Foreign-company document | Absent from list + scoped `total`; resolve → `403`; detail/verification/download → `403`; zero writes of any kind |
| Legacy `documents`-table rows (pre-cutover uploads) | See §7 — they stop appearing in the candidate list at Lane 1 cutover unless the §9 Q4 backfill is ruled in. This is named here so it is a decision, not a surprise |

---

## 6. What is explicitly NOT done

- **No legacy upload/DELETE resurrection** — `documents.js POST /upload` and `DELETE /:id` are deleted, never mounted, no 410 stubs (panel §2.4 reasoning stands: no live caller exists to inform).
- **No table drops, no data deletion.** `documents`, `verification_documents`, and all verification-chain tables survive untouched in shape except §7's additive column.
- **No new auth framework, no new middleware chain** — the design reuses `authMiddleware`, `requireRole`, and the sibling relationship query.
- **No recruiter UI for the review queue in this design.** No React surface calls `/api/documents/*` today (verified); §9 Q1 puts the UI question to Sumanth. The API contract in §5 is complete and testable without it.
- **No change to `recruiter-documents.js`, the OmniScore engine, or `verifyDocument`'s internals** beyond §5.3's claim guard.
- **No resubmit-in-place parity** on the canonical door (the legacy upload's one unique behaviour). Per panel condition §4.2, a follow-up issue for resubmit on `POST /api/candidate/documents/upload` must be filed and linked from #1624 before #1624 closes — post-launch unless Sumanth rules otherwise. Until then the candidate recovery path is delete + fresh upload, which re-enters verification.

---

## 7. Migration / data impact

**Schema — one expand-only step, in Lane 2's migration (next free migration number at build time; `ADD COLUMN IF NOT EXISTS`, nullable, no backfill, no constraint tightening):**

```sql
ALTER TABLE document_review_queue
  ADD COLUMN IF NOT EXISTS reviewer_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
```

Purpose: audit only — records the company on whose behalf a resolve was performed (NULL for admin resolves). It is **never** used as an authorization input (authorization is derived per §3.1, so historic rows can never become wrongly scoped by a stale stamp). No index is added for it in this programme; queue volume is human-scale. All other scope queries run on existing indexes (`idx_job_applications_candidate_id`, `idx_jobs_company_id`, the migration-134 queue indexes).

**Explicitly no `company_id` on `document_review_queue`** — see §3.1: a single stamp cannot represent a multi-company relationship and would fossilise scope at flag time.

**Data impact of the Lane 1 cutover (must be stated in Lane 1's PR and issue evidence):**

- New uploads land in `verification_documents`; the candidate list reads only that table. Rows previously uploaded through the live page sit in `documents` and **will no longer appear** in the list. Nothing is deleted; the rows and their B2 objects remain. Whether they are backfilled is Sumanth's call (§9 Q4) — this design does not silently absorb a data copy.
- Historic `verification_documents` rows with NULL encryption metadata (if any exist) remain downloadable via §5.2's branch.
- Historic `document_review_queue` rows (if any exist from any earlier era) become visible to correctly-scoped reviewers for the first time when Lane 2 mounts. That is intended — they are real flagged documents — and Lane 2's evidence should record the pre-mount row count read from the dev DB so the launch state is known, not assumed.

**Rollback:** forward-fix only (shared staging/production DB; migrations never un-apply). `reviewer_company_id` is additive and inert if the code rolls back. Lane 1's cutover is code-only and reversible by restoring the candidate.js handlers — no data written under this design needs unwriting, because canonical-door writes are the same tables the (shadowed) code was already written for.

---

## 8. Build decomposition — ordered lanes with Quinn journey tests

Strictly sequential (D8). Each lane: STOP 1 with named specialist decision on the issue (Lane 1 & 2 must name the **security specialist** — auth/tenant surface; Lane 2 also the **privacy lens** — cross-tenant candidate PII in queue payloads), red-first build, independent review, own PR to `dev`, merge-as-you-go (HL-005), assembled-app E2E evidence on the issue before closure (HL-003). Each lane's PR carries its docs/sdlc entry (HL-006): Lane 1 — candidate documents behaviour note (canonical door, verification now runs); Lane 2 — `/api/documents` surface + scoping note; Lane 3 — evidence/baseline note. Suite rule: any lane that changes a journey step re-runs the affected suite (§8.5).

### Lane 1 — Canonical upload door (unshadow + adapter)

**Scope:** delete candidate.js's 3 document handlers (§4.1); compatibility adapter in `candidate-documents.js` + the page type fix (§4.2). No `documents.js` mount yet.
**Done means:** the real page's upload provably runs scan → encrypt → `verifyDocument`, and the page's list/delete work against `verification_documents`.

Quinn journeys (Candidate Experience persona; fresh-install dev rig, real HTTP through assembled `server.js`, DB read back):

- **J1 — Candidate upload triggers verification.** Candidate signs up → uploads a document on the Documents page (the page's own FormData, field names as shipped) → `201/200` → read back: one `verification_documents` row, `encryption_iv` non-NULL, stored object is ciphertext; a `document_verifications` row exists; document status is `verified` or `pending_review` per measured risk — never stuck unexplained. With a medium/high-risk fixture: exactly one `document_review_queue` row for that document. **Red today** (upload lands in `documents`, no verification rows at all).
- **J1b — Page regression.** List shows the uploaded document with correct name/type/status; delete removes it (`DELETE` reaches candidate-documents, row gone on read-back); a virus-fixture upload → `400 VIRUS_SCAN_FAILED` and no row.

### Lane 2 — Scoped review mount (`documents.js`)

**Scope:** §3.3 helper + scoped list/resolve; §5.1 mount + route-order fix + legacy handler deletion + orphan imports; §5.2 download decrypt; §5.3 service atomic claim; §7 migration; `server.js:2113` inventory 8→11.
**Done means:** the review workflow drains a real queue with tenant isolation proven negatively, not just positively.

Quinn journeys (Recruiter + Candidate Experience personas):

- **J2 — Recruiter reviews own company's flagged document.** Seed via J1's flagged fixture for a candidate who has applied to Company A's job → Recruiter A: `GET /review-queue` contains the document → `POST /review/:documentId {approved}` → 200 → read back: queue row `approved` with reviewer + `reviewer_company_id` = A; document `verified`; `document_access_logs` has the `review_approved` row; candidate's OmniScore/`score_history` reflects **only** a real measured impact (or is unchanged if none existed — asserted explicitly).
- **J3 — Foreign recruiter gets 403, nothing moves.** Recruiter B (Company B, no application from this candidate): the document is **absent** from B's queue list and B's `total` excludes it → B's direct `POST /review/:documentId` → **403** → read back: queue row still `pending`, document status unchanged, `document_score_impacts`/`omni_scores`/`score_history` byte-identical. B's `GET /:id`, `/:id/verification`, `/:id/download` → 403. **This journey is the founder's gate; it must be red against the unscoped code and green only after scoping.**
- **J4 — Admin override + honest queue states.** Admin lists all companies' pending rows → resolves one → 200 with `reviewer_company_id NULL`. Empty-queue company recruiter → `200 {reviews: [], total: 0}`. Re-resolving J2's document → `409`, OmniScore unchanged. Resolving a non-queued document id → `404`. Candidate role on either review endpoint → 403; unauthenticated → 401; recruiter with no `company_id` → 403.
- **J5 — Appeal round-trip.** Candidate's document is rejected by Recruiter A → candidate `POST /appeal/:documentId` with reason → queue row back to `pending` with appeal fields → Recruiter A sees it again and approves → document `verified`. Non-owner candidate appealing → error, no state change; appealing a non-rejected document → 400.

### Lane 3 — Remaining unique surface + assembled-app regression

**Scope:** verify the as-is mounts behave assembled (consistency-check unshadowed, credentials/list, stats/summary, access-log); correct the hand-mounted test's status (the #1611 test stays a unit test and is labelled as such; it is not gate evidence); baseline the two programme journey suites against the new door; file + link the resubmit follow-up (§6) — #1624 does not close without it (panel §4.2 condition).
Quinn journeys:

- **J6 — Consistency + credentials + access log.** Candidate with ≥2 canonical documents: `GET /consistency-check` → 200 real result (red after a naive mount — shadowed); `GET /credentials/list` → only own credentials; after J2's recruiter views, candidate `GET /:id/access-log` shows the recruiter's view/download entries with company name.
- **J7 — Download integrity.** Owner downloads a canonical document via `/api/documents/:id/download` → bytes equal the original plaintext (decrypt round-trip, not ciphertext); company-linked recruiter downloads the same bytes; foreign recruiter → 403 (J3 covers) and no access-log pollution beyond the denied attempt policy already in code.
- **J8 — Full regression pass.** Programme candidate chain and recruiter chain suites re-run on the fresh-install rig; the documents steps now assert verification outcomes from J1/J2 instead of the old unverified states.

### 8.5 Sequencing note

Lane 1 must land before Lane 2's journeys can seed a queue honestly (J2 seeds via J1). Lane 2's code could technically be written first, but its gate evidence cannot — do not merge Lane 2 as "complete" on seeded-by-hand queue rows; a hand-inserted row proves the drain, not the workflow. (A hand-seeded row is acceptable as Lane 2's *red* fixture for J3's scoping assertions during development; closure evidence uses the J1-produced row.)

---

## 9. Risks and open questions for Sumanth (labelled — not decided here)

**Open questions (need Sumanth's ruling; none blocks Lane 1 except Q4's cutover note, which must be answered or explicitly accepted before Lane 1 merges):**

- **Q1 — Review-queue UI.** This design delivers the scoped API; no recruiter/admin screen exists for it. Is an API-only review capability acceptable for Nov 30 launch, or does launch need a minimal recruiter review screen (a new Aria PRD + build, outside #1624's lanes as drawn)?
- **Q2 — `employer` role.** Review gates today are `admin/recruiter/hiring_manager`. `recruiter-documents.js` treats `employer` as a recruiter-class role. This design keeps `employer` **out** of review (D4). Confirm, or rule `employer` in (a one-word change to the gates + matrix).
- **Q3 — Multi-company visibility.** Under derived scoping, every company a candidate applied to can see and review the same flagged document, including its fraud flags, and Company A's approval changes the document (and OmniScore) for Company B's view too. This matches the sibling document-access model, but review is stronger than view. Accept for launch, or should resolve be first-come-exclusive per company (a materially bigger design)?
- **Q4 — Legacy `documents`-table rows.** At Lane 1 cutover, documents users uploaded through the live page stop appearing in their list (data untouched, §7). Options: (a) accept — pre-launch data, list starts fresh on the canonical store; (b) a one-time backfill lane copying `documents` rows into `verification_documents` as `pending`/unverified (they were never scanned/verified — they must not arrive as verified). Rex's lean is (a) for launch if the row count is small; the count is a fact Scout/the parent can read from the DB before Lane 1 merges.

**Risks (team-owned, recorded):**

- **R1 — Async verification has no retry.** If `verifyDocument` throws after upload, the document sits at `pending` with no queue row and no scheduled re-run. Honest but silent. Mitigation in-scope: the `.catch` log line already exists; a stuck-`pending` sweep is a post-launch follow-up, noted here so it is not rediscovered as a surprise.
- **R2 — Queue payload carries candidate name/email + fraud flags** to every authorised company's recruiters. That is the workflow's purpose, but it is PII with fraud allegations attached; the privacy specialist reviews Lane 2's payload before merge, and the list returns no `file_url` and no document content (verified: the queue query selects neither).
- **R3 — `documents.js GET /` selects `vd.*`** (includes `extracted_text` and metadata) for the owner's own list. Owner-only, so not a tenant leak; left as-is under ponytail, flagged for the post-launch consolidation.

---

## 10. Claims in this design that rest on code Rex could not verify

Per HL-001/HL-007, stated plainly:

1. **No live-database facts were verified.** Row counts and contents of `documents`, `verification_documents`, and `document_review_queue` (historic rows, NULL-encryption rows, §7/Q4) come from migration files and code, not from a DB read — this design task ran code-only against `origin/dev`, and Neon is unreachable from this VM per standing context. Lane evidence must supply the real counts.
2. **Schema was read from migrations, not the live schema.** The completion gate's schema-drift check (touched tables vs live definitions) remains a Lane 1/2 build-time obligation; if the live `document_review_queue` lacks the migration-134 `UNIQUE(document_id)`, §4.4's idempotency argument must be re-proven before Lane 2 merges.
3. **`decryptBuffer`'s key derivation** is inferred from its call sites (`encryptBuffer(buffer, userId)` at upload; `decryptBuffer(buf, iv, tag, userId)` at candidate download) rather than from reading `lib/document-crypto.js` line-by-line in this pass. §5.2's "owner's id, not requester's" follows from those call sites; Nova confirms against the lib source at STOP 1.
4. **The page's tolerance for a missing `url` field** is inferred from its rendering code (`url: d.url || ''` in the current adapter; the page stores list items as returned). J1b is the journey that proves it; if the page dereferences `url` anywhere unguarded, that fix belongs in Lane 1's adapter scope.

*Design ends. Parent (Suga) verifies and lands; Rex claims no GitHub writes.*
