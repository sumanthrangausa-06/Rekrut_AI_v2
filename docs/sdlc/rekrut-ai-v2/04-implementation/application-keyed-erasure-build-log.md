# Application-Keyed Erasure Completeness — Build Log (#813, S-094)

**Story:** [STORY] S-094: Erasure completeness — application-keyed tables sweep (C2 surface)
**Branch:** `story/813-s094-erasure-sweep` → PR to `dev` (see issue #813 for the PR link)
**Design source:** Nova's STOP 1 on #813 (comment 6160091975) + panel rulings (comment 6167202482, 2026-10-14, under Sumanth's expanded-autonomy grant): D-1 and D-3 ruled by the panel (Scout/Rex/Nova/Lex/CEO-review), D-2 ruled by Sumanth (DELETE + consent tombstone), D-4 satisfied (PR #1115 merged, #780 closed). Points: 5.

## What was built

One block inside `erasePersonalData()` in `lib/erasureService.js`, placed immediately after the #780 `job_applications` block (same function scope, reusing its `applicationRows` / unheld-id partition — no duplicate hold consults, `lib/legalHold.js` untouched). No migration, no new endpoint, no caller changes. Commits are table-by-table (preamble+screening_responses → job_application_screenings → ai_screenings+D-1 → outreach_attempts → auto_apply_profiles), each with per-table test evidence in its commit message.

- **Whole-row DELETEs (STOP 1 §2 dispositions):** `screening_responses` (candidate-keyed), `job_application_screenings` (candidate-keyed), `ai_screenings` (candidate-keyed), `outreach_attempts` (user-keyed) — each `DELETE … WHERE <key> = $1 AND id = ANY($2)` over the unheld ids only; `auto_apply_profiles` (user-keyed) `DELETE … WHERE user_id = $1`. `job_applications` itself is never DELETEd. No file columns exist on any of the five — no storage-ledger work.
- **Hold partition:** a row whose `application_id` is in the #780 unheld set is deleted; any other application-keyed row is skipped, counted in `applicationKeyedRowsHeld`, and named in `applicationKeyedHeldDetails` ({table, id, reason}). `auto_apply_profiles` has no company linkage — entry gate only.
- **D-1 (ruled):** `ai_screening_audit_logs` + `ai_screening_human_reviews` are deleted by explicit counted DELETE (`WHERE screening_id = ANY($1)`) **before** the parent `ai_screenings` DELETE and only for unheld parents — never CASCADE (a cascade returns no count; the erasure would be unprovable, Art. 5(2)). Counts returned as `aiScreeningAuditLogsDeleted` / `aiScreeningHumanReviewsDeleted`. No skeleton, no hashes. Defect condition 2 was already filed as **#1145** (parallel trail write best-effort + unanchored entityId) — not duplicated.
- **D-2 (Sumanth):** `auto_apply_profiles` whole-row DELETE; consent tombstone captured pre-delete into the return as `autoApplyConsentTombstone` = {profileExisted, gdprConsent, consentDate} — `profile_data` is never read or returned.
- **D-3 (ruled as tightened):** NULL-`application_id` rows get a per-row job-walk inside the transaction: `jobs` lookup by the row's own `job_id` (or questionnaire → job for `screening_responses`), then an exact-match application lookup (`job_id` + `candidate_id`); no linkage record is created. Resolved NULL-company proceeds under the entry gate (documented residual). Failed resolution or hold-consult error = fail-closed skip of that row only (reason `unresolved_job_walk` / `job_walk_error` / `held_company` / `held_application`), counted and disclosed — never aborts the erasure. A row attached to a held application follows the hold. Idempotent across re-runs (skipped rows are re-walked next run).
- **Cascade children:** `screening_question_evaluations` / `screening_overrides` die via the `screening_responses` DELETE's mig-073 CASCADEs — no explicit DELETEs (asserted by mocked case (g) and proven on real PG in the dry run).
- **Audit metadata (S-078/#780 pattern):** return gains `screeningResponsesDeleted`, `jobApplicationScreeningsDeleted`, `aiScreeningsDeleted`, `outreachAttemptsDeleted`, `autoApplyProfileDeleted` (booleans, true only when rows were actually deleted), `aiScreeningAuditLogsDeleted`, `aiScreeningHumanReviewsDeleted` (counts), `applicationKeyedRowsHeld` + `applicationKeyedHeldDetails`, `autoApplyConsentTombstone`. JSDoc updated. Both callers already spread the whole result into audit, so no caller changes.

## Test evidence

### Mocked jest (red-first)

New suite `server/__tests__/lib/application-keyed-erasure.test.js`, written and run **before** the implementation:

- **RED:** 12 failed, 12 total on unmodified `origin/dev`.
- **GREEN, progressively per table slice:** preamble+screening_responses 3/12 → +job_application_screenings 4/12 → +ai_screenings/D-1 8/12 → +outreach_attempts 9/12 → +auto_apply_profiles **12/12**. Cases (a)–(g) from STOP 1 §6 plus D-3 branches (d1 resolved+unheld ⇒ deleted; d2 resolved-NULL-company ⇒ deleted under entry gate; d3 walk throws ⇒ skipped + counted, erasure proceeds; d4 exact-match held application ⇒ follows hold; d5 questionnaire walk) and the survival proof (h).
- **D-1 Condition 1 — SURVIVAL PROOF: PASSES.** Mocked case (h): a candidate WITH a human review (erased, counted) whose `compliance_audit_trail` entry is untouched — no DELETE/UPDATE/INSERT against the trail is issued and the fixture row stands. Re-proven on real PG below. The D-1 ruling therefore stands (not suspended).

### Mandatory local-PG dry run (panel amendment — REAL DB)

Scratch PG16 cluster (127.0.0.1:55434), fresh DB `erasure813`, migrated to head (`migrate.js` exit 0; numbered migrations through 259 + p-series). Two **pre-existing** fresh-DB migration defects were hit and worked around in the scratch DB only (filed as **#1149**, reproduced on pristine dev): mig 238's view references `candidate_profiles` columns the fresh build never creates (added the five columns in scratch), and `p2_schema_hardening.sql`'s type alters are blocked by three views (dropped `v_candidate_full_profile`, `v_unified_assessments`, `unified_interviews` in scratch — read surfaces unused by erasure).

Seeded: candidate + recruiter, companies A (unheld) / B (legal hold on company only — entry gate correctly does not block: no sessions, no users.company_id), jobs A/B + job C (held company, no application) + job D (unheld company, no application), applications for A/B, and held/unheld variants of every C2 table, including a **NULL-application `ai_screenings` row whose job belongs to the held company** and a NULL-app `screening_responses` row on the held company's questionnaire; cascade children for unheld/held responses; D-1 children for unheld/held/NULL-held screenings; a `compliance_audit_trail` human_override entry for the candidate's review on the unheld screening. Ran `erasePersonalData` in a transaction (caller pattern).

**Result: ALL 29 ASSERTIONS PASSED, zero FK violations, zero orphans.** Erasure return: all five `*Deleted` true; `aiScreeningAuditLogsDeleted: 1`, `aiScreeningHumanReviewsDeleted: 1` (the deleted parents carrying seeded children); `applicationKeyedRowsHeld: 6` with per-row details (held_application ×4, held_company ×1 for the job-C NULL row, held_application via questionnaire-walk exact-match ×1); tombstone `{profileExisted: true, gdprConsent: true, consentDate: 2026-01-02}`. Verified in DB: unheld rows gone in all five tables; held rows intact in all five; NULL-app held-company `ai_screenings` row **survives**; NULL-app unheld-company row deleted; cascade children of deleted responses gone, of held responses intact; D-1 children of deleted screenings gone, of held screenings intact; **`compliance_audit_trail` entry survives**; `job_applications` skeletons retained, unheld redacted, held untouched.

### Existing suites

Updated per STOP 1 §6: sequence chains (`erasure-medium-tables`, `resume-family-erasure`, `embeddings-erasure` ×5 chains, `dsar-dek-destruction` ×2 chains) gained the five C2 SELECT steps after the #780 step; exact-result expectations (embeddings ×4, dsar ×2) gained the C2 fields; router suites (`legal-hold`, `observer-audio-erasure`, `job-applications-erasure`) gained #813 sequence/flag assertions; route suites — `admin-dsar-fulfillment` mocked returns extended, `auth-delete-account-legal-hold` + `admin-legal-holds` carry the #813 module-boundary header note (per the #1115 pattern).

Erasure-family run (13 suites): **143 passed, 2 failed** — both failures are `observer-audio-erasure` T8/no-artefacts, verified **pre-existing on pristine `origin/dev`** in this environment (2/4 fail with dev code + dev suite; the new #813 test in that file passes). Full-suite regression delta: see PR body.

## Specialist reviews (PR gate)

Depth limit: this build ran as a depth-2 subagent that cannot spawn reviewers. Per the brief, the privacy-engineer and security checklists were applied to the diff by the implementer with the method disclosed here and in the PR; Lead runs independent review passes before merge. (Database-reviewer was seated at STOP 1.)

- **Privacy-engineer checklist:** every C2 row disposition matches the panel rulings; held rows never deleted and never silently retained (counted + named); tombstone contains the consent fact only, never `profile_data`; held details carry table/id/reason only (no PII); D-3 walk creates no surviving linkage; fail-closed on every lookup error; entry gate unchanged and first. ✓
- **Security checklist:** all new SQL parameterised (no string interpolation of values); no new endpoint/input/auth surface; no PII in logs (console.error carries table name + error message only); DELETEs scoped by candidate/user key AND id set (no unscoped deletes); transaction semantics inherited from callers unchanged. ✓

## Out of scope (unchanged)

`lib/legalHold.js` untouched; #829's own five tables untouched (its two cascade children via C2 parents are resolved here, per STOP 1 §2 chain note); no migration; the observer-audio baseline failures and the fresh-DB migration defects (#1149) are separate follow-ups, not fixed here.
