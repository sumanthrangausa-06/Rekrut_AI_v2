# GAP-C Panel-Consent Partition Build Log — #1972 (#1964 fix)

**Persona:** Nova (Phase 4 Implementation) · **Story:** #1972, 3 pts · **Parent:** #1964 (Lex panel decision, 2026-10-29) · **Epic:** #1900
**STOP 1:** https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/1972#issuecomment-6498674191 (posted before any build)
**Base:** dev `1325d711275fcfe43682ce3debf7a1dcfedaf9fa` (PR #1974) — verified first-hand via `git fetch` at run start.
**Branch:** `nova/1972-gapc-panel-partition`

## The defect

In `erasePersonalData()`'s GAP-C interview-events cluster (`lib/erasureService.js`), an event carrying `event_labelling_consent` rows but no surviving recording was whole-DELETEd. Migration 299's `ON DELETE RESTRICT` on `event_labelling_consent.interview_event_id` aborted the DELETE (SQLSTATE 23001) and rolled back the candidate's **entire** erasure — the account could not be deleted at all. This blocked the `DIARIZATION_ENABLED` switch-on: once panel capture is live, this posture is a broken legal right on a live surface.

## Specialist decision (STOP 1, mandatory question answered: YES)

- **Privacy engineer — MANDATORY, consulted at STOP 1: APPROVE-WITH-CONDITIONS.** Conditions (all in the build): a candidate's erasure never touches another user's panel rows; the retained event is stripped to exactly the K-12 five assignments; the panel-kept count is disclosed separately in the erasure result (never "everything deleted" while a panel-kept skeleton stands); repeat erasure is idempotent.
- **Database reviewer — MANDATORY, consulted at STOP 1: APPROVE-WITH-CONDITIONS.** Confirmed RESTRICT unreachable under the partition in every posture, the EXISTS rides `idx_event_labelling_consent_event`, and slot/room handling is unaffected. Conditions adopted: (1) the panel-only set is the **disjoint** set `!has_recording && has_panel_consent`; (2) reconciliation is the five-term identity (deleted + redacted + kept-for-panel + held + lookup-failed = seeded) and the new counter is initialised to 0. Also recorded: the one residual race (a panel INSERT committing between SELECT and DELETE under READ COMMITTED) fails closed — RESTRICT aborts, retry succeeds — and must NOT be "fixed" with a DELETE-time `NOT EXISTS` guard, which would silently keep an unredacted event.
- **Rex — consulted via the issue/design record** (design §10 consistency: panel rows are never deleted on a candidate erasure).
- **Considered and skipped:** crypto (no identity/hash mechanism changes), UX/a11y (no user surface beyond erasure-result counts), performance (erasure is low-frequency).

## What was built (behaviour change)

| Piece | Where |
|---|---|
| Third EXISTS in the ONE existing event SELECT, same snapshot as `has_recording`: `EXISTS (SELECT 1 FROM event_labelling_consent elc WHERE elc.interview_event_id = ie.id) AS has_panel_consent` | `lib/erasureService.js` (GAP-C events cluster) |
| Disjoint partition over unheld events: `has_recording` → recording redact; `!has_recording && has_panel_consent` → panel redact via a **separate UPDATE** (identical five K-12 assignments); neither → whole-DELETE. RESTRICT is never reachable. Held / lookup-failed events still survive whole first — precedence unchanged | `lib/erasureService.js` |
| New disclosed count `gapC.interviewEventsKeptForPanelConsent` (initialised 0; assigned the panel UPDATE's own rowCount — measured, never inferred from the combined redacted rowCount). Carried in the erasure result and therefore in the sanitised `account_deleted` audit metadata | `lib/erasureService.js` |
| Mocked-suite cases for the partition + the new field in the exact-shape result fixtures of the sibling erasure suites | `server/__tests__/lib/gap-c-erasure.test.js`, `dsar-dek-destruction.test.js`, `embeddings-erasure.test.js` |
| Quinn E2E integration suite (7 postures, real DB) | `server/__tests__/lib/gap-c-1972-panel-erasure.integration.test.js` |

**Boundaries honoured:** NO migration, no FK/index/column change (migration 299's asserted post-state untouched); slot/room handling unchanged; `DIARIZATION_ENABLED` untouched (stays off); PR to dev only.

## Keep/erase status wording (this PR)

- **E-13** (`00-relearn/data/erasure-keep-erase-table.md`): the #1964 amendment's status changes from "Build = follow-up story filed from #1964 (not yet built)" to **BUILT — #1972**: the no-recording whole-DELETE branch is partitioned by panel consent exactly as ruled; panel-kept skeletons are counted in `gapC.interviewEventsKeptForPanelConsent` and disclosed in the erasure result.
- **K-12 panel-consent clause**: implemented as ruled — identical field set, no additions; the skeleton's later death remains the separate cleanup-sweep story's scope (not built here).

## Evidence

- **Red (mocked):** pristine dev gap-c suite 12/12 PASS; with the new tests on unmodified code, 4 failures (2 new panel-partition cases + the 2 count assertions) — the partition and the count did not exist.
- **Red (real DB):** fresh DB via real `migrate.js` (exit 0), integration suite on unmodified code: HTTP door answered **500** — `update or delete on table "interview_events" violates RESTRICT setting of foreign key constraint "event_labelling_consent_interview_event_id_fkey"` (23001); both integration tests failed.
- **Green:** mocked gap-c suite **14/14 PASS**; integration suite **2/2 PASS** on a fresh-migrated DB — all 7 Quinn postures: (1) recording+panel unchanged K-12; (2) panel-only event redacted to the skeleton, panel rows byte-identical, counted kept-for-panel; (3) neither-flag event whole-DELETEd; (4) recording-only baseline unchanged; (5) every `interview_events` column enumerated against K-12 kept/stripped (plus mig-129 `interview_session_id`, structural linkage, unchanged); (6) repeat erasure idempotent (state byte-identical, kept count 1 per run, deleted 0); (7) counts reconcile (1 deleted + 2 redacted + 1 kept-for-panel + 0 held + 0 lookup-failed = 4 seeded). Disclosure verified in the `account_deleted` audit metadata (`gapC.interviewEventsKeptForPanelConsent: 1`).
- **Regression sweep:** all GAP-B/D/E/F/G/H/I + GAP-A + sanitizer suites PASS (204 tests). Two suites carry **pre-existing** failures on pristine dev `1325d711` (verified first-hand on the untouched main clone): `dsar-dek-destruction` 2 and `embeddings-erasure` 5, both crashing in their mocks at the `observer_jobs` destructure (lib line ~1701), identically before and after this change — not introduced by #1972; their exact-shape fixtures were still updated with the new field at 0.
- **Rig note (HL-009 trace):** the documented PG rig was down; an equivalent fresh cluster was stood up from the embedded PG 18.4 tree (binaries copied to `/home/pgrig1972`, cluster run as the `postgres` user on 127.0.0.1:55433, trust auth, pgvector present in-tree) and proven by a fresh `migrate.js` run (exit 0, migration 299 applied) before any gate used it.

**Not claimed:** staging/rehearsal re-proof — per the issue, that is a diarization switch-on entry item (migrations 296–299 execute post-Nov 1).
