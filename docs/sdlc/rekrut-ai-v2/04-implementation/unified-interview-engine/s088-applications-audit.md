# S-088 — Applications Module Audit: Findings Register

> Story: #812 · Sprint 11 main-track opener · Owner: Scout (discovery) · Date: 2026-10-13
> Code state audited: `origin/dev` @ `48454fea` (Sprint 11 plan merge, PR #814)
> Method (per sprint-11-plan.md): three verification legs per finding —
> (1) static trace, (2) schema truth against a locally migrated PostgreSQL DB
> (`information_schema` + `\d job_applications`), (3) live authz matrix +
> erasure dry-run against that DB (real server boot, two companies + two
> candidates; real `erasePersonalData` execution with residual-PII SELECTs).
> Specialist decision (STOP 1, mandatory): **Yes** — privacy-engineer domain
> (C1–C4 erasure/retention) + security-reviewer domain (S2–S6 authz), per the
> plan's specialist table. Findings below are stated in those lenses;
> database-reviewer considered and skipped (no schema change is audited —
> he joins any filed migration story, e.g. S-100/S-110).

## ⚠️ P0 ESCALATION (runtime-proven, not hypothetical)

Three findings were **proven exploitable live** against a local instance
(two-company + two-candidate fixtures), at or above their recorded severity:

1. **S2 — candidate self-advance is shipped UI behaviour, not just an API
   hole.** `PUT /api/candidate/applications/:id/status` (routes/candidate.js:3314)
   accepts any of the 9 statuses. Live proof: candidate set own application
   to `hired` (HTTP 200, DB status=`hired`); recruiter then set `rejected`;
   candidate set it back to `offered` (HTTP 200, DB status=`offered`) —
   **a recruiter's rejection is reversible by the candidate**. The candidate
   Kanban drag-and-drop itself calls this endpoint and its column map sends
   `offered` (client/src/pages/candidate/applications.tsx:109-114, :215).
   Downstream poisoning: `hired`/`offered` feed recruiter analytics,
   OmniScore pipeline counts, and adverse-impact selection rates
   (services/biasDetection.js:82, routes/compliance.js:976).
2. **S5 — screening-send cross-company mutation, severity now PROVEN.**
   `POST /api/interviews/screening/send` (routes/interviews.js:2729) scopes
   only the template to the caller's company; `application_id` is never
   company-checked. Live proof: company-B recruiter sent a screening against
   company-A's application → HTTP 200, an `interview_sessions` row was
   created under company B with an invite token, **and company A's
   application was mutated** (`screening_status='invited'`,
   `status: applied→screening`, routes/interviews.js:2839).
3. **S4 — explain-decision IDOR, enumerable.** `GET
   /api/compliance/explain/decision/:applicationId` (routes/compliance.js:577)
   is auth-only. Live proof: an unrelated company-B recruiter received
   HTTP 200 with candidate name, email, status and `recruiter_notes`
   (services/scoreExplainer.js:300-352) for an arbitrary sequential ID.

## Schema truth (leg 2 — the record every later STOP 1 consumes)

`job_applications` after the full migration stack (local PG 16, migrations
through 257 + p4 applied individually; see note below):

- **Columns (19):** `id, job_id (FK jobs, CASCADE), candidate_id (FK users,
  CASCADE), company_id (FK companies, CASCADE), status, resume_url,
  cover_letter, omniscore_at_apply, recruiter_notes, applied_at, updated_at,
  match_score, screening_answers (JSONB, mig 022), screening_status,
  screening_score (mig 041), is_auto_applied (mig 219), applied_via (mig
  228), assessment_score, assessment_result (mig 233)`.
- **Status CHECK** (`chk_job_applications_status`, mig 047 → p2 → p4):
  9 values — `applied, screening, shortlisted, reviewing, interviewed,
  offered, hired, rejected, withdrawn`. Canonical vocabulary =
  `PIPELINE_STAGES` (routes/recruiter.js:2601) — matches.
- **`applied_via` CHECK** (mig 228): `('manual','auto_apply')` only.
- **Absent columns (DB-proven):** `hired_at`, `user_id`, `deleted_at`,
  any test marker, any IP column (cf. S-095 #815), any threat/fraud column.
- **Application-keyed tables (FK-referenced by):** `screening_responses`
  (CASCADE), `job_application_screenings` (no action), `ai_screenings`
  (SET NULL), `outreach_attempts` (CASCADE), `screening_sessions` (SET
  NULL), `aptitude_test_attempts` (SET NULL), `coding_submissions`
  (SET NULL, via `job_application_id`), `interview_sessions` (SET NULL),
  `interview_events` (CASCADE, via `job_application_id`),
  `ai_decision_explanations` (SET NULL), `human_overrides` (CASCADE),
  `proctoring_sessions` (SET NULL); candidate-keyed sibling:
  `auto_apply_profiles` (via `users`). Children: `screening_question_
  evaluations` (via screening_responses), `ai_screening_audit_logs`
  (via ai_screenings). **Cascades never fire on erasure** — account
  deletion is a soft-delete (`users.deleted_at`), the S-076 precedent.
- ⚠️ **Fresh-DB migration note (adjacent observation, not a module
  finding):** a from-scratch `node migrate.js` halts at migration 238
  (`column cp.bio does not exist` — `candidate_profiles.bio/photo_url`
  are referenced by code and later views but no migration creates them on
  a fresh path). Migrations ≥239 and the p-files therefore never apply on
  a fresh DB. Routed to Lead in the audit report; not filed by this audit
  (outside the Applications module).

## Findings register (one row per #812 checklist ID)

Legend: ✅ verified-good · 🔴 broken-as-coded (live-proven where marked) ·
🟠 confirmed static + DB · ⚪ hypothesis resolved

### Wiring
| ID | State | Evidence |
|----|-------|----------|
| W1 | 🔴 | Three creation paths: funnel `submitApplication` (routes/candidate.js:2702, INSERT :2759 sets company_id/cover_letter/scores/answers); ai-screener `findOrCreateApplication` (routes/ai-screener.js:114-127, INSERT with **no company_id**, status=`reviewing`); referral claim (routes/assessments.js:1476, sets company_id but see D2). Only the funnel honours the invariants. |
| W2 | 🟠 | Duplicate recruiter status endpoints diverge: `PUT /applications/:id/status` (routes/recruiter.js:1296) — notification + recording-retention side-effect + AuditLogger + compliance trail, no events/analytics/email; `PUT /applications/:id` (:1959) — events + hiring_activity + notify + analytics + email, no retention, no AuditLogger/compliance trail. Client uses `/:id` (client/src/pages/recruiter/applications.tsx:138,159; job-applicants.tsx:379). |
| W3 | 🟠 | Vocabulary drift: pipeline-stats counts 6 named stages, `shortlisted`/`reviewing` silently uncounted (routes/recruiter.js:1843-1852); dashboard counts nonexistent `reviewed` (routes/recruiter.js:155, :259); admin stats count nonexistent `pending`/`accepted` (server.js:1586-1591, DB-proven always 0). |
| W4 | 🔴 | Candidate Kanban: `STATUS_TO_COLUMN` has no `rejected`/`withdrawn` entry → fallback renders them as `applied` (client/src/pages/candidate/applications.tsx:118-126, :174). Terminal-state candidates see themselves as merely "applied" and can drag the card (see S2). |
| W5 | 🟠 | Resolved: `KanbanApplication` (client/src/components/candidate/kanban-card.tsx:28-47) does not declare `recruiter_notes`/`screening_score`/`company_id`, but the API sends `ja.*` — the leak is in the payload regardless of typing (see S3). Contract = payload minimisation, not TS. |
| W6 | 🟠 | `job_applications.resume_url` is never written by any INSERT path (all three greps verified); read by services/autofill-service.js:55. Dead column. |
| W7 | 🟠 | #247: endpoint now exists (routes/candidate.js:3796) but performs **no INSERT** — it only AI-generates documents; creation happens via the standard apply in the same modal (client/src/pages/candidate/job-detail.tsx:516-524). #247's core AC ("creates a valid application end-to-end") is NOT met by the endpoint. Verdict posted on #247: keep open / re-scope. |

### Security
| ID | State | Evidence |
|----|-------|----------|
| S1 | ✅ | Main recruiter surface IS company-scoped — list (recruiter.js:1276), per-job reads with job-ownership pre-check (:1925, :2846), status writes (:1327, :1979), batch (:2670), public /v1 candidates with API-key scope + company scope (routes/public-api.js:158-180), screening.js ownership checks (:30, :162), interview-sessions trigger ownership (routes/interview-sessions.js:349). Live control: company-B recruiter's application list = empty. **Recorded as verified-good.** |
| S2 | 🔴 LIVE | See P0 escalation #1. routes/candidate.js:3314-3356; ownership-only check; any→any transitions; no audit write; response `RETURNING *` also leaks `recruiter_notes`. |
| S3 | 🔴 LIVE | `GET /candidate/applications` (routes/candidate.js:3059-3084) `SELECT ja.*` — live proof: candidate payload contained `recruiter_notes:"SECRET-NOTE"` and `screening_score:42`. Cf. S-087 (#790) payload-minimisation precedent. |
| S4 | 🔴 LIVE | See P0 escalation #3. Siblings: `GET /explain/omniscore/:userId` (routes/compliance.js:551) is the same auth-only pattern (any user → any user's score breakdown/history); `GET /explain/job/:jobId/candidate/:candidateId` (:992) checks role but never that the caller's company owns the job. Also `POST /audit/export` (:453) is auth-only and exports ALL audit logs; `GET /audit/logs` (:429) likewise lacks a role gate. Root cause: the compliance router has no object-level authorization layer. Note: `explainDecision` also depends on phantom table `candidate_job_matches` (never created by any migration; services/scoreExplainer.js:327, euComplianceService.js:234) — the endpoint 500s where that table is absent; the IDOR is in the code path regardless (proven live with the table present). |
| S5 | 🔴 LIVE | See P0 escalation #2. routes/interviews.js:2729-2845. |
| S6 | 🟠 | Questionnaire response check (routes/questionnaire.js:~953): `app.user_id !== req.user.id` — `user_id` does not exist on `job_applications` (DB-proven) so the clause is dead (`undefined !== id`); access today reduces to the company check alone, and NULL-company phantom applications (W1) are unreachable by anyone through this path. Fragile, works-by-accident. |
| S7 | ✅/🟠 | Per-job reads consistently use a job-ownership pre-check (S1). Residual defence-in-depth gap: `POST /recruiter/pipeline/auto-check/:jobId` (recruiter.js:4075) loads applications by `job_id` alone — bounded by the caller's own automation rules for that job. Recorded; no story (bounded, own-rules only). |
| S8 | 🔴 | No `deleted_at`/visibility filtering on any application surface: `routes/recruiter.js` contains **zero** `deleted_at` references; the visibility predicate exists only in discovery (`CANDIDATE_VISIBILITY_SQL`, routes/candidateSearch.js:72). Soft-deleted / discovery-opted-out candidates' applications remain fully listed in recruiter applications, pipeline, ja-derived candidate lists, and /v1 API candidates. |
| S9 | 🟠 | Resolved: single-screen screening is ownership-checked (routes/screening.js:30, routes/ai-screener.js:~205 `verifyRecruiterOwnsJob` + role gate); /v1 API-key scope enforced (public-api.js:161-170). Residual: `POST /candidate/jobs/:jobId/apply` and the candidate status endpoint carry **no rate limit** (routes/candidate.js:3038, :3314) — folded into S-096's ACs. |

### Compliance
| ID | State | Evidence |
|----|-------|----------|
| C1 (#780) | 🔴 LIVE | `lib/erasureService.js` has **zero** references to `job_applications`. **Erasure dry-run (live, local PG):** seeded application with `cover_letter`/`recruiter_notes`/`screening_answers`/scores; ran the real `erasePersonalData` to completion; residual SELECT: **the row survives intact, all PII columns populated.** Confirmed #780 scope = the whole candidate-linked row: `cover_letter` + `screening_answers` (candidate-authored), `recruiter_notes` (company-side), `screening_score`/`match_score`/`omniscore_at_apply`/`assessment_score`/`assessment_result` (derived), status/timestamps. The per-column delete-vs-redact call remains the Sumanth/Lex STOP-1 decision on #780, as planned. Name collision resolved: `job_applications.screening_answers` (JSONB col, mig 022) ≠ `screening_answers` table (erasure deletes the table at erasureService.js:241; the column survives). |
| C2 (#813) | 🔴 LIVE | Same dry-run: `screening_responses`, `job_application_screenings`, `ai_screenings`, `outreach_attempts`, `auto_apply_profiles` **all survive** (1/1 seeded rows each). **Extension beyond #813's filed scope — also surviving:** `aptitude_test_attempts`, `coding_submissions`, `ai_decision_explanations`, `human_overrides`, `proctoring_sessions` (1/1 each), plus children `screening_question_evaluations` / `ai_screening_audit_logs` via their parents. Filed as S-105; scope note posted on #813. |
| C3 | 🟠 | DSAR export omits applications: `POST /compliance/gdpr/export` (routes/compliance.js:28-97) gathers users/omniscore/interviews/assessments/profile/consents/audit — no `job_applications`. Evidence posted on #657 (S-016b) per plan (no duplicate story). |
| C4 | 🟠 | No retention path for applications: seeded `data_retention_policies` (mig 013) have no applications data_type, and `EuComplianceService.executePurge` (services/euComplianceService.js:487-595) has no `job_applications` case. Rejected/withdrawn application PII never expires. |
| C5 | 🟠 | Status-change audit is inconsistent by path, audited against #136: `PUT /:id/status` writes AuditLogger + compliance trail (recruiter.js:1408-1425); `PUT /:id` writes neither (only swallowed events/hiring_activity); batch writes both (:2706-2760); **candidate status + withdraw write nothing** (routes/candidate.js contains zero audit calls). Evidence posted on #136. |
| C6 | ✅ | No threat-intel/fraud signal exists in the `job_applications` schema or any application view (DB + grep verified) — the #788 gate holds today. (The `fraud_score` at routes/candidate.js:4681 belongs to candidate *documents*, not applications.) |
| C7 | 🟠 | Manual apply records **no consent artefact** (`submitApplication` writes none); past `cover_letter`/`screening_answers` are reused by auto-fill (routes/candidate.js:3998), AI screening-suggestions (routes/candidate.js:3913) and services/autofill-service.js:50-63 with no notice/opt-out. Contrast: auto-apply *does* gate on `gdpr_consent` (routes/candidate.js:3108, mig 228 profile consent fields). |

### Data integrity
| ID | State | Evidence |
|----|-------|----------|
| D1 | 🔴 LIVE (DB) | Phantom applications: the ai-screener INSERT was replayed verbatim on local PG → row with `company_id=NULL`, status=`reviewing`; company-scoped recruiter count for that company = 0, candidate's own count = 1. A recruiter screening a candidate who never applied *creates* an application — without the candidate applying, and invisible to the recruiter afterwards. |
| D2 | 🔴 LIVE (DB) | **Hypothesis resolved — broken:** referral claim INSERT with `applied_via='referral'` (routes/assessments.js:1476-1478) fails on the migrated schema: `23514 chk_job_applications_applied_via` (proven on local PG). Referral-first candidates (no prior application) get a 500 and the claim transaction rolls back. |
| D3 | 🟠 | Assessment *assign* auto-advances `applied|screening → shortlisted` before the candidate sits it (routes/assessments.js:1374, guarded CASE, intent commented "don't override manual moves"); completion round-trip also advances on pass (:2569-2572). `shortlisted` is a recruiter-decision stage — semantics story, S-103. |
| D4 | 🟠 | `stage_config` in `GET /pipeline-stages` defines 7 of 9 stages — `shortlisted` and `reviewing` missing (routes/recruiter.js:2628-2636) while `PIPELINE_STAGES` (:2601) and the DB CHECK both carry 9. |
| D5 | 🟠 (DB) | `hired_at` phantom column (DB-proven absent): time-to-hire queries at routes/recruiter.js:187, :477, :492, :506 all reference it inside graceful fallbacks → avg time-to-hire is silently always null. |
| D6 | 🟠 | Batch status silently drops foreign/invalid IDs: verification filters to company-owned IDs and updates the subset with HTTP 200 (routes/recruiter.js:2668-2690, response :2816-2820 returns `updated` count but no requested/skipped breakdown); the client marks **all** selected as updated regardless (client/src/pages/recruiter/job-applicants.tsx:398-411) and swallows errors silently. |
| D7 | 🟠 | `events` / `hiring_activity` writes on the `PUT /:id` path are try/catch-swallowed (`catch (_e) { /* non-critical */ }`, routes/recruiter.js:~2007, ~2032) — application history can silently drop with no log above console level. |

### Boundary items
- **#405** (candidate discovery): no re-scope. S8 (S-104) covers only
  `job_applications`-derived lists, per the plan boundary.
- **#529** (Activity Feed): **implemented in code since filing** —
  `lib/activity-feed.js` is wired into `GET /candidate/profile`
  (routes/candidate.js:228, returned :251) and the recruiter dashboard
  (routes/recruiter.js:640). AC-1/2 met in code; AC-3 partially (per-source
  LIMIT 20 vs AC's 50 total — feed-level slice exists); AC-4 (Playwright)
  not run by this audit. Recommendation posted on #529: close or re-scope
  to the verification remainder.
- **#151**: `job_applications` carries **no test marker column**
  (DB-proven) — test applications are indistinguishable in-module;
  inventory belongs to the accounts layer. Nothing deleted (boundary held).
- **#141** bulk import creates no applications — confirmed out of scope.

## Story set filed at audit exit (one per root cause)

| Story | Issue | Root cause (checklist IDs) | Pts | Tranche |
|-------|-------|----------------------------|-----|---------|
| S-096 | (filed with this register) | Candidate application endpoints: self-advance + payload leak (S2, S3, W4, S9-residual) | 5 | **Reserve (tranche-1)** |
| S-097 | | Compliance router object-level authorization (S4 + siblings) | 3 | Reserve-overflow / fast-path per plan |
| S-098 | | Screening-send cross-company mutation (S5) | 2 | Sequenced (audit priority #1) |
| S-099 | | Application creation funnel — phantom applications (W1, D1, W6) | 3 | Sequenced |
| S-100 | | Referral `applied_via` CHECK violation (D2) | 2 | Sequenced |
| S-101 | | Duplicate recruiter status endpoints converge (W2) | 3 | Sequenced |
| S-102 | | Status vocabulary drift in aggregations + stage_config (W3, D4) | 2 | Sequenced |
| S-103 | | Application state machine: transition rules + audit consistency (D3, C5, D7) | 5 | Sprint 12 candidate |
| S-104 | | Visibility filtering on application-derived surfaces (S8) | 3 | Sequenced |
| S-105 | | Erasure C2 extension tables (C2-extension) — **entry: #799 merged + hold verified at every purge site** | 3 | Sequenced after #813 |
| S-106 | | Applications retention policy + purge path (C4) — **entry: #799 merged + verified** | 5 | Sprint 12 candidate |
| S-107 | | Consent/notice for application-data reuse (C7) | 3 | Sprint 12 candidate |
| S-108 | | Batch status shortfall reporting (D6) | 2 | Sequenced |
| S-109 | | Questionnaire response access check — dead clause (S6) | 1 | Sequenced |
| S-110 | | `hired_at` — record time-to-hire truthfully (D5) | 2 | Sequenced (after S-101/S-103) |

Already filed (not re-filed): #780 (C1, 5 pts, entry #799), #813 S-094
(C2 core, 3 pts, entry #799), #657 (C3 evidence added), #136 (C5 evidence
added), #247 (W7 verdict added), #529 (implementation verdict added).

**Exit criterion (Rex's amendment):** every filed story's dependencies
carry a verified state — erasure stories depend on #799 (Verified-Absent
mechanism, stub seam Verified-Exists `lib/observerCapture.js:145-160`);
S-110 depends on the status-path convergence (S-101/S-103, Verified-Exists
as code); no story depends on an unverified table — the schema-truth
record above is the shared dependency.
