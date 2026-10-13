# Legal-Hold Mechanism — Build Log (#799, G-1)

**Story:** [DISCOVERED] G-1: No legal-hold mechanism exists — retention purges have no hold check (platform-wide)
**Branch:** `story/799-legal-hold` → PR to `dev` (see issue #799 for the PR link)
**Design source:** Rex's verified design comment on #799 (2026-10-13T17:07Z), superseding both earlier planning sketches. STOP 1 comprehension: Nova's comment on #799 (2026-10-13T17:21Z). Points: 5 (filed).

## What was built

- **Migration 258** (`migrations/258_legal_holds.js`): `legal_holds` table — subject user and/or company, `reason`, `set_by`/`set_at`, `released_by`/`released_at`. Active while `released_at IS NULL`. No FKs by design (a hold is legal evidence; it must not cascade away). Partial indexes on active user/company holds. Idempotent.
- **`lib/legalHold.js`** (new): the one canonical hold service behind the existing seam.
  - `isHeld({userId, candidateId, companyId, sessionId}, queryable)` — direct user hold, explicit company hold, company hold via the subject's `users.company_id`, session resolution via `interview_sessions`. **Fail-closed: any error → true.**
  - `anyHoldActive()` — for structurally unattributable purge branches. Fail-closed.
  - `heldPredicate` / `notHeldPredicate` — SQL fragments for bulk branches.
  - `placeHold` / `releaseHold` / `listHolds` — placement/release audited to `compliance_audit_trail` via `auditLogService.logEvent` (best-effort-but-loud: the hold stands even if the audit write fails; the row itself carries actor/timestamps).
  - `LegalHoldError` (typed, `code: 'LEGAL_HOLD'`, status 409).
- **Seam** (`lib/observerCapture.js`): `isLegalHoldActive({candidateId, sessionId})` stub body replaced with delegation to `legalHold.isHeld` — signature unchanged, every existing caller lit up. The intent reconciler (#9 in STOP 1's inventory — found in code, not in Rex's list) now also consults per intent, inside the candidate lock, and reports `heldSkips`.

## Wiring by STOP 1 inventory site

| # | Site | Wiring |
|---|------|--------|
| 1 | `EuComplianceService.purgeRecordingObjects` | Hold check widened from observer_audio-only to ALL registry rows (query already selected `candidate_id`); unattributable rows → any-hold skip. `heldSkips` in result + purge audit payload. |
| 2 | `EuComplianceService.purgeExpiredSpeechMeasurements` | Already consulted the seam — lit up by the real body; fail-closed now guaranteed by `isHeld` (a check error skips + counts instead of aborting the run). |
| 3 | `observerCapture.purgeTestObserverAudio` | Already consulted — lit up. |
| 4 | `observerCapture.sweepWithdrawnCaptureArtefacts` | Already consulted — lit up. |
| 5 | `EuComplianceService.executePurge` | Per-branch SQL predicate (`NOT EXISTS` vs active holds) on attributable branches: `audit_logs.user_id`, `assessment_results.user_id` (attribution verified at `routes/compliance.js:47` — no CREATE TABLE exists in migrations), `candidate_profiles.user_id`, `ai_decision_explanations.user_id`; recordings branch inherits #6's per-row wiring. Each summary entry now carries `held_skips`. |
| 6 | `EuComplianceService.purgeExpiredRecordings` | SELECT now LEFT JOINs `interview_events` for `candidate_id`; per-row consult BEFORE storage delete and BEFORE transcript anonymisation; `heldSkips` in result + audit. Unattributable rows → any-hold skip. |
| 7 | `EuComplianceService.purgeExpiredTemplates` | Per-candidate consultation is impossible by schema design (migration 246, opaque `subject_ref`). STOP 1 fallback applied: while ANY hold is active the run skips, counts the would-be-purged rows as `heldSkips`, and reports `skippedDueToHold: true`. |
| 8 | `EuComplianceService.purgeExpiredObserverReports` | Converted from bulk DELETE to per-row loop; candidate via `interview_sessions.candidate_id` join; `heldSkips` in result + audit. |
| 9 | `observerCapture.reconcileObserverAudioIntents` | Per-intent consult inside the candidate lock, before any delete; `heldSkips` in result + reconcile log counts. |
| 10 | `erasureService.erasePersonalData` | Hold gate as the FIRST statement, before `destroyDEK` (DEK destruction is deletion). Throws typed `LegalHoldError`. DSAR route (`routes/admin.js` fulfil) maps it to **409**, rolls back, and records the Art. 17(3)(e) conflict in the request notes. Self-serve `DELETE /delete-account` (`routes/auth.js`) also maps it to 409 (nothing deleted). |
| 11 | `erasureService.deleteErasedStorageFiles` (ledger Phase 2) | Per-entry consult on the ledger row's `user_id`; held entries stay `pending`, counted as `heldSkips`, object NOT deleted. |
| 12 | `erasureService.sweepPendingStorageDeletions` | Delegates to #11 per user; totals now include `heldSkips`. |

- **Set/release API** (`routes/admin.js`, `requireAdmin`): `POST /api/admin/legal-holds`, `POST /api/admin/legal-holds/:id/release`, `GET /api/admin/legal-holds` (`?active=true` filter). Admin UI explicitly OUT (per Rex's pinned scope).
- **Cron run report** (`server.js` retention cron): log line now includes total `held_skips` across all purge paths.

## Test evidence

Red-first: the three new suites were written and run before the implementation (failed on missing `lib/legalHold` / migration 258, as expected).

- `server/__tests__/lib/legal-hold.test.js` — 27 tests: isHeld semantics (user/company/company-via-user/released/session), fail-closed on check error, place/release + audit, seam delegation, erasure block (typed error, DEK untouched, zero deletes), released-hold unblocks, ledger drain skip + release-resume, sweep totals, and per-site purge tests for #1/#2/#5/#6/#7/#8 + observerCapture #3/#4/#9.
- `server/__tests__/routes/admin-legal-holds.test.js` — 8 tests: admin gate (401 non-admin, repo convention), place validation (400s), release (200/404), list, DSAR 409 mapping + rollback + conflict recorded.
- `server/__tests__/lib/legal-hold-db.test.js` — real-DB integration (Rex's pinned scope): migration 258 applied twice (idempotent) against a throwaway Postgres 16; place → isHeld → bulk predicate DELETE spares the held row → release → unblocked; company hold by company_id. Gated behind `LEGAL_HOLD_INTEGRATION_DB_URL` (retention-audit precedent). **Ran green (2/2)** against a local PG 16 cluster created for this build.
- Regression (all cold-cache `--no-cache` unless noted): dsar-dek-destruction, resume-family-erasure, erasure-medium-tables, embeddings-erasure, retention-lifecycle, admin-dsar-fulfillment, compliance-audit, observerCapture (17/17), observerDormancy (9/9) — green.

### Harness repairs made along the way (documented, behaviour-preserving)

The repo's jest suites were "verified-never-executed" in this environment (STOP 1); several only ever passed via a warm transform cache. Cold runs exposed pre-existing harness defects, repaired minimally:

1. Once-chain mocks in the four erasure suites: prepended the new entry hold-check response; three chains were additionally one response short from the Gate A DEK-tombstone INSERT (pre-existing gap, now filled + labelled). One dsar expectation updated: a DB error now surfaces as the fail-closed `LegalHoldError` instead of the raw error (the new, intended semantics).
2. `observerCapture.test.js` / `observerDormancy.test.js`: `jest.mock` factories referencing out-of-scope variables (`Readable`, `FakeRoom`, `FakeAudioStream`) — cold transforms reject these. Fixed via in-factory `require` and `mock`-prefixed renames. Dormancy's fake also lacked a `legal_holds` route and one `recording_objects` UPDATE branch; observerCapture's fake lacked the same UPDATE branch — added.
3. `observerDormancy.test.js` B-1: `waitFor` called without its timeout argument (could never pass as written) and with a window shorter than the worker's 5s poll — fixed to 20s.
4. `observer-audio-erasure.test.js`: `jest.mock` of non-existent `lib/notificationScheduler` needed `{ virtual: true }` to run at all.

### Known pre-existing failures (verified identical on pristine `origin/dev`)

- `observer-audio-erasure.test.js`: 2/3 fail — its fake router matches SQL shapes `erasureService` no longer emits (registry SELECT without the `registration_state` predicate; chunk `DELETE … RETURNING object_key`). Unrelated to #799 (the legal-hold query routes to the fake's generic SELECT branch). Left as-is; flagged here for Lead to file.
- `recordings-session.test.js` retention test, `company-approval`, `candidate-autosend`, `observerSpeech` (AF-5/COPY-1): identical failures on baseline and on this branch (same suites, same tests, same counts).

## Deviations from Rex's design

- None in shape. Two build-gate defaults from STOP 1 were applied as proposed there: (1) unattributable bulk branches use the any-active-hold skip (templates #7); attributable branches got the precise predicate (assessment_results attribution was verified in code, resolving STOP 1's open question). (2) The DSAR-conflict signal is the typed `LegalHoldError` → 409 mapping specified in the task brief, recorded in the data-request notes (admin) and surfaced to the self-serve caller.
- Sequencing note (Rex's hard rule): this story must merge and verify BEFORE any deletion-widening build starts (#780, S-094, #802, #803).

## Specialist reviews

Per STOP 1 (on #799): privacy engineer (`gensecai/privacy-engineer`) seated as primary + Lex review seat + `ecc/security-reviewer` scoped to the set/release API — all seated at STOP 1. PR-gate specialist reviews are dispatched by Lead when this PR lands.

## Known residual limitation — F-7 check-then-act TOCTOU window (privacy review, PR #915)

**Named residual limitation (accepted risk, documented per the privacy review's recommendation; no code change in this story):** outside the intent reconciler (site #9, which consults inside the candidate lock), the hold checks are **check-then-act and not atomic**. The per-row purges and the erasure gate consult `legal_holds` and then delete in separate statements, without locking `legal_holds` or taking a shared advisory lock with `placeHold`. A hold placed in the narrow window between a row's check and its delete will miss that row in that run. Mitigations that already exist: the window is per-row and milliseconds wide; anything not yet deleted is protected from the next run onward; the erasure gate is a single statement at the head of its transaction. Closing the window properly (subject-level locking shared between `placeHold` and every purge) is a follow-up design decision for Lead/Rex, not an in-story fix.

## PR-gate fix round (#915 — privacy BLOCK + Lex APPROVE WITH CHANGES, consolidated by Lead)

Red-first: the new tests below were written and run against the un-fixed branch first — **13 failed for the intended reasons** (F-1 seam/erasure/purge regressions, F-6, predicate, conflict-record unit + both routes), negative cases passed. After the fix, all are green (evidence at the end of this section).

| Item | What changed |
|------|--------------|
| **Privacy F-1 (BLOCKER)** — company-only hold failed to protect that company's candidates | `lib/legalHold.js`: new internal `findActiveHold` is now the single resolution path (`isHeld` wraps it). When a `sessionId` is present the session is **always** resolved and its company merged into the check, regardless of a simultaneously passed userId (previously resolution ran only when no userId was given — and every seam call site passes both). The hold query additionally matches a company hold against **any company on the subject's own `interview_sessions`** (`candidate_id = subject`) — candidates carry no `users.company_id`, so this session attribution is the only path by which a company hold reaches a candidate at the session-less sites. Site #6 recordings (`services/euComplianceService.js`): SELECT now carries `ir.interview_session_id` and passes it with the candidate. Site #8 observer reports: SELECT now carries `r.interview_session_id` and passes it with the candidate. Bulk predicate (`heldPredicate`): gained the equivalent `interview_sessions` EXISTS branch. Candidate erasure (`lib/erasureService.js`): gate now calls `findActiveHold`, so the same attribution blocks erasure. The unit fake in `legal-hold.test.js` was repaired to model reality — candidates default to `users.company_id = NULL` (the old fake modelled candidate 7 as a company member, which masked the blocker); employer-member behaviour is now set up explicitly in the two tests that exercise it, plus a `candidateSessionCompanies` map simulating session attribution. |
| **Privacy F-6** — session-resolution miss read as not-held | `findActiveHold` **throws** when a supplied `sessionId` has no row; `isHeld` converts that to `true` (fail-closed, consistent with the module's error posture), and the erasure gate converts it to a `LegalHoldError` with `holdId: null`. Unit + real-DB tests. |
| **Lex F-1 (HIGH)** — DSAR-conflict record was notes-only free text; the 409 claimed recording unconditionally; self-serve 409 left no record | New `legalHold.recordLegalHoldConflict()` writes the conflict to `compliance_audit_trail` (payload: `action: 'legal_hold_conflict'`, hold id, actor, request id, subject user id, source) and **throws on write failure** (unlike the best-effort place/release audit — a conflict has no other durable record). The erasure error now carries `details.holdId` (from `findActiveHold`) so both routes can record it. DSAR route (`routes/admin.js`): audit write first; on failure → **500** ("could not be recorded", `conflictRecorded: false`, erasure still not performed); on success → notes copy + 409 claiming recording. Self-serve delete-account (`routes/auth.js`): same write (actor = the requesting user, source `self_serve_delete_account`); on failure → 500 surfacing the failure, nothing deleted. |
| **Lex F-10** — overbroad wording | `lib/legalHold.js` header and the `routes/admin.js` legal-holds section comment now read "the automated retention purges and erasure paths wired in #799" instead of "every purge/deletion path". |
| **Privacy F-8** — coverage restoration | New test in `dsar-dek-destruction.test.js`: hold check passes, then the destroyDEK-stage UPDATE fails → the raw error propagates (`dek db down`, not `LEGAL_HOLD`). (The pre-existing "rethrows" test keeps asserting the hold-check stage's fail-closed `LEGAL_HOLD` semantics.) |
| **Privacy F-7** | Documented above as a named residual limitation. Documentation only, per Lead's disposition. |
| **Privacy F-4** | **No change** — Lead's disposition: counts-only skip audit / reason-in-payloads stands as-is (minimisation defensible; flagged for Lex's call and Lex did not require it). |

**Harness repairs in this round (behaviour-preserving):** (1) `observerCapture.test.js` fake gained a branch for the legalHold session-resolution query (sessions there carry no candidate/company, so resolution yields NULLs and behaviour is unchanged). (2) `observer-audio-erasure.test.js` fake gained a `FROM legal_holds` branch ahead of its generic `FROM interview_sessions` branch (the F-1 holds query contains an `interview_sessions` subquery, which the generic branch would otherwise intercept and misread as a hold). That suite is back to its **documented baseline of 2 failed / 1 passed** (same two tests, same fake SQL-shape reasons as recorded above — verified identical failure reasons, and `recordings-session.test.js` likewise verified identical 1 failed / 13 passed before and after this round via a stash comparison against the PR head).

**Test evidence (all cold-cache `--no-cache`):**

- Legal-hold family: `./node_modules/.bin/jest server/__tests__/lib/legal-hold.test.js server/__tests__/lib/legal-hold-db.test.js server/__tests__/routes/admin-legal-holds.test.js server/__tests__/routes/auth-delete-account-legal-hold.test.js --no-cache --forceExit` — **56/56** (legal-hold 39, legal-hold-db 5, admin-legal-holds 10, new auth-delete-account-legal-hold 2). The db suite ran with `LEGAL_HOLD_INTEGRATION_DB_URL` pointing at a throwaway local Postgres 16 cluster created for this round; its setup now also applies the real migration 129 so `compliance_audit_trail` exists — the F-1 real-SQL test proves company-hold protection for a candidate (users.company_id NULL) in seam shape, erasure shape, and via the bulk predicate DELETE; the Lex F-1 test proves the conflict record (and the place audit, privacy F-3's gap) actually land in `compliance_audit_trail`.
- Full regression set (same command family + dsar-dek-destruction, admin-dsar-fulfillment, resume-family-erasure, erasure-medium-tables, embeddings-erasure, tests/compliance-audit, observerCapture, observerDormancy, retention-lifecycle, legal-hold-db with the integration URL): **13 suites, 148/148 passed**.
- Also run: `routes/auth.test.js` 17/17 (auth.js touched), `observerCaptureGate` + `consent-withdraw-observer` green.
