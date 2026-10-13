# PRD — M6: Applications & Pipeline

**State (verified, Scout §2 + S-088 runtime audit): WORKS WITH 3 RUNTIME-PROVEN P0 AUTHORISATION HOLES.** **Surfaces:** no dedicated router — logic spread across `routes/candidate.js`, `recruiter.js`, `ai-screener.js`, `assessments.js` · client: candidate/applications, recruiter/applications, job-applicants.
**Sprint 11 overlap: THIS IS THE SPRINT 11 MAIN TRACK.** The audit (S-088) and its filed stories are the committed layer; this PRD states the module's requirements around them and adds nothing to the sprint's scope.

## 1. Purpose & users
The hiring pipeline itself: applications, statuses, screening sends, recruiter notes — the data every other module orbits. Users: candidates (own applications), recruiters/hiring managers (their company's applications only).

## 2. End-to-end journey
Candidate applies (M4) → application appears in the recruiter's job pipeline → recruiter reviews, adds notes, sends screening (M9) → status advances through stages → interview booked (M8) → outcome. Candidate tracks status on their side and may withdraw.

## 3. Current state (verified — S-088, proven with live fixtures, not static reads)
- **P0 #820 (S-096):** a candidate can set their own application's status — including to `hired`, and including **reversing a recruiter's rejection** — via the candidate Kanban path.
- **P0 #821 (S-097):** the explain-decision endpoint is an enumerable IDOR — sequential IDs return candidate name/email/status and **`recruiter_notes`** to unrelated recruiters. Siblings: `/explain/omniscore/:userId`, and an auth-only `/audit/export` that exports **all** audit logs.
- **P0 #822 (S-098):** a Company-B recruiter can POST a screening send with Company-A's `application_id` → session created under B **and Company-A's application mutated** to `screening`.
- **Erasure:** `job_applications` is absent from `erasureService.js` — cover_letter + screening_answers survive a full erasure (#780, dry-run confirmed; extensions #813, #829 — five more application-keyed tables).
- **Creation integrity:** three separate INSERT paths into `job_applications`, including the ai-screener phantom-creation funnel (#823) and the referral path that 500s (M22, #824).

## 4. Gap to launch-ready
The Sprint 11 spine: P0 trio fixes, legal hold (#799) merged and verified at every purge site **before** deletion-widening, #780-family erasure completeness, creation-funnel consolidation. After the spine: adopt the platform object-authorisation convention (overview §5.1) for every application-scoped read/write — the trio fixes the proven holes; the convention stops the class.

## 5. Functional requirements
- FR-M06-1: Application status transitions are server-authoritative: candidates may perform only candidate-legal transitions (withdraw); any status write validates the caller's role AND company scope against the application's owning company. (Closes #820's class.)
- FR-M06-2: Every application-scoped endpoint (read, explain, screening-send, notes, audit export) performs an object-level authorisation check — authentication alone is never sufficient. Sequential-ID enumeration must return 404/403 without data. (Closes #821/#822's class.)
- FR-M06-3: `recruiter_notes` and equivalent internal fields are never serialised to candidates or to out-of-company recruiters (extends the S-087 payload-minimisation pattern to application payloads).
- FR-M06-4: Erasure covers the full application family (job_applications + the #813/#829 tables) inside the transaction, with storage objects queued via the migration-252 ledger — gated on #799's hold check at every purge site.
- FR-M06-5: One creation path for applications (funnel consolidation per #823), with `applied_via` values validated against the CHECK constraint before insert (with M22, #824).

## 6. Non-functional
- Security: this module is the authorisation convention's reference implementation (API-design lens); new endpoints must name their object check in review.
- Privacy: application data is the DSAR core; screening_answers/cover_letter are candidate PII — their erasure is GDPR/DPDP Art. 17 scope, counsel-tracked under M19.
- Database lens: the erasure DELETE set and the pipeline list queries are the module's hot paths; list endpoints follow S-087's explicit-projection rule (no `SELECT *` serialisation).

## 7. Dependencies (verified states)
M19 erasure service (exists; this module is its known gap) · #799 legal hold (**building, Sprint 11**) · M2 scoping middleware (exists) · M9 screening send (exists; is the #822 vector).

## 8. Sprint 11 overlap
Direct and total for the spine (S-088 audit, P0 trio, #799, #780 family) — filed stories are the committed layer. FR-M06-2/5's convention-and-funnel remainder is **post-spine** scope for Lead's sequencing.

## 9. ⚠ Unverified
Whether sibling routers repeat the auth-only pattern beyond the three proven + two named siblings (S-088 audited applications scope; a platform-wide sweep was not done); pipeline list payload contents post-S-087 (the pattern was fixed for interview sessions, not re-audited here).

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M06-1:** None new — the Sprint 11 spine decisions are already made (approved 2026-10-13, P0 trio admitted to the committed set on your call at sprint review). Post-spine convention adoption (FR-M06-2 remainder) is Lead's sequencing, not a new ruling.
