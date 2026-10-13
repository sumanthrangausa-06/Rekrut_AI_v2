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
