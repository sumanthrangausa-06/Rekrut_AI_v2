# job_applications Erasure Completeness — Build Log (#780)

**Story:** [FOLLOW-UP] Erasure completeness: job_applications (cover_letter + screening_answers JSONB)
**Branch:** `story/780-job-applications-erasure` → PR to `dev` (see issue #780 for the PR link)
**Design source:** Nova's STOP 1 on #780 (2026-10-13), gate-approved by Sumanth the same day (Lead-recorded), including the ruling **`recruiter_notes` = REDACT on erasure**. Points: 5 (committed at STOP 1 §6).

## What was built

One block inside `erasePersonalData()` in `lib/erasureService.js`, placed after the S-078 `recording_consent` redaction and before the S-047 observer tables. No migration, no new endpoint, no caller changes, `lib/legalHold.js` untouched.

- **§3 per-row legal-hold consult FIRST:** `SELECT id, company_id FROM job_applications WHERE candidate_id = $1`, then `findActiveHold({ userId, companyId: row.company_id })` per row. This closes the gap STOP 1 found in the #799 mechanism: the entry gate's company attribution reaches a candidate only via `interview_sessions`, so a candidate who merely *applied* to a held company was not covered by a company-only hold. Held rows are **excluded** from the redaction and counted in `jobApplicationRowsHeld`; a per-row lookup error reads as held (fail-closed skip, logged) — the row is never silently redacted or silently dropped.
- **§2 redaction (one UPDATE, row retained):** over the unheld ids only (`WHERE candidate_id = $1 AND id = ANY($2)`), setting exactly: `cover_letter = NULL`, `screening_answers = '{}'::jsonb`, `resume_url = NULL`, `match_score = NULL`, `omniscore_at_apply = NULL`, `screening_score = NULL`, `assessment_score = NULL`, `assessment_result = NULL`, `recruiter_notes = NULL` (gate ruling), `updated_at = NOW()`. The row itself is **never DELETEd** — `id / job_id / candidate_id / company_id / status / screening_status / applied_at / is_auto_applied / applied_via` remain as the joint candidate/company skeleton (Art. 17(3)(e), conversations precedent). The UPDATE is skipped entirely when no unheld rows exist.
- **§4 audit metadata (S-078 pattern):** the return object gains `jobApplicationsRedacted` (boolean, true only when the UPDATE actually redacted rows — `rowCount > 0`) and `jobApplicationRowsHeld` (count). JSDoc return type updated. Both existing callers already spread the whole result into their audit records, so no caller changes were needed.

## Test evidence

Environment limit, stated plainly: this VM cannot reach Neon and has no local Postgres — **no real-DB run is claimed**. All evidence is from the mocked jest suites. Real-DB verification (the S-088-style dry-run: seed candidate → `erasePersonalData` → residual-PII SELECT on `job_applications` showing content columns nulled, skeleton retained) is a named staging-QA step at promotion.

Red-first: `server/__tests__/lib/job-applications-erasure.test.js` was written and run **before** the implementation:

- **RED:** `npx jest server/__tests__/lib/job-applications-erasure.test.js --forceExit` → **6 failed, 6 total** (no `job_applications` SQL issued, return fields undefined).
- **GREEN (after implementation):** same command → **6 passed, 6 total**. Cases: (a) UPDATE exists, keyed by `candidate_id`, sets exactly the §2 redact set incl. `recruiter_notes`, SELECT precedes UPDATE; (b) row never DELETEd; (c) held row excluded + counted, per-row consults carry each row's explicit company; (d) hold-lookup error → fail-closed skip, erasure does not throw; (e) `jobApplicationsRedacted` true only when rows actually redacted (all-held → no UPDATE; UPDATE reporting 0 rows → false); (f) no applications → no error, flag false, no UPDATE, only the entry-gate hold lookup ran.

Existing suites updated per STOP 1 §5 (the new SELECT/UPDATE steps in sequence order):

- Sequence-chain suites — one `#780 job_applications SELECT (no applications)` step inserted after the `recording_consent` step: `erasure-medium-tables` (1 chain), `resume-family-erasure` (1), `embeddings-erasure` (5), `dsar-dek-destruction` (2). The latter two also assert the whole return object with `toEqual`, so their expectations gained `jobApplicationsRedacted: false` / `jobApplicationRowsHeld: 0` (embeddings ×4, dsar ×2).
- Router/fake suites — `observer-audio-erasure`: added a #780 test asserting the SELECT is issued in sequence with flags false/0 (its fake answers the lookup with no rows). `legal-hold`: the non-blocked-candidate erasure test now asserts the same sequence/flags.
- Route suites — `admin-dsar-fulfillment`: the mocked `erasePersonalData` return fixtures gained the §4 fields (they flow into the audit metadata). `auth-delete-account-legal-hold` and `admin-legal-holds` mock `erasePersonalData` at the module boundary and carry **no query-sequence chain to extend** — a #780 note recording exactly that was added to each file's header; the hold-rejection paths they exercise are unchanged.

Affected family run (`npx jest` over the new suite + the 9 STOP 1 §5 files, `--forceExit`): **108 passed, 2 failed, 110 total; 9/10 suites passed** — the 2 failures are the known pre-existing `observer-audio-erasure` failures below.

Full server suite (`npx jest server/__tests__ --forceExit`): **130 failed, 10 skipped, 1228 passed, 1368 total; 9 suites failed, 107 passed, 2 skipped.** Baseline on pristine `origin/dev` (`e5599900`, same command, #780 diff stashed): **130 failed, 10 skipped, 1221 passed, 1361 total; the same 9 suites failed.** Delta is exactly the 7 new #780 tests, all passing — **zero regressions**.

## Known pre-existing failures (verified on pristine `origin/dev`)

- `server/__tests__/lib/observer-audio-erasure.test.js`: 2/3 tests fail identically **with and without** this change (verified by stashing the #780 diff and re-running on `e5599900`). Its fake router matches SQL shapes `erasureService` no longer emits (registry SELECT / chunk DELETE…RETURNING), as already documented in the #799 build log. **Not** caused by #780 and not fixed here (out of scope) — proposed as a follow-up for Lead to file.
- The other 8 baseline-failing suites are likewise identical before/after: `observerAudioStore`, `observerSpeech`, `migrations/257_observer_capture`, `candidate-autosend`, `company-approval`, `interview-mount-order`, `recordings-session`, `spa-routes`.

## Out of scope (unchanged, per STOP 1)

- Application-keyed tables (`screening_responses`, `job_application_screenings`, `ai_screenings`, `outreach_attempts`, `auto_apply_profiles`) — chain successors #813, then #829.
- DSAR *export* omission of `job_applications` — #657 coordination.
- No retention/TTL path for applications is created here.
