# #1966 Build Log — S-D19 review minors: purge transactionality (M-1) + record corrections (M-2…M-4)

**Persona:** Nova (Phase 4 Implementation) · **Parent:** #1956 (S-D19, PR #1963, independent review comment 6494184947, ACCEPT-WITH-MINORS)
**STOP 1:** https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/1966#issuecomment-6495878192 (posted before any build)
**Base:** dev `2678babae` — verified first-hand via `git fetch` at run start.
**Branch:** `nova/1966-purge-transactional` (own worktree; main clone HEAD untouched)

## Specialist decision (STOP 1, mandatory question answered)

- **Privacy engineer — MANDATORY, consulted** (agency-agents privacy-engineer lens): purge completeness is a consent-withdrawal guarantee (design privacy C-1/C-2). Adopted: per-recording all-or-nothing; claim snapshot never purged (C-2); failures machine-visible to the caller; purge stays idempotent/re-runnable (failed recordings keep their runs and stay selectable, so a re-call purges exactly the remainder).
- **Security reviewer — considered, SKIPPED for the fix design:** no new auth/route/input surface; scoping and lock-key pattern were security-reviewed in #1963 (C-5c). The independent review gate on this PR still reads the diff with a security eye.
- **Database reviewer — considered, SKIPPED:** no schema/migration/new query shapes; the transaction pattern copies in-repo precedents (`persistClaimProvenance` in `workers/diarization/index.js`, `lib/observerCapture.js`).
- **Silent-failure-hunter — considered, applied as a lens:** its no-swallowed-errors rule is the "surface beyond the log" half of M-1.

## M-1 — what changed

| Piece | Where |
|---|---|
| Per-recording purge is now transactional: dedicated client per recording (pool `connect()`; a bare client queryable is used as-is and not released), `BEGIN` → `pg_advisory_xact_lock(hashtext('panel-event:<eventId>'))` (the same lock the capture/worker pair uses — the purge no longer runs outside it) → the same five purge statements, unchanged → `COMMIT`. Any failure `ROLLBACK`s that recording whole, is recorded, and the remaining recordings are still attempted (each independently atomic). After the loop, if any recording failed, the function **throws** an `Error` naming the failed recording ids, carrying `failures: [{ recordingId, message }]` and `purged: <committed count>` — the caller can act (retry/alert) instead of reading a log. Success contract unchanged: returns the purged count. | `lib/panelWithdrawalPurge.js` |
| Caller log line now carries the structured failure (message + `failures` JSON). The capture handler's decision-first semantics are unchanged: the decision WAS recorded, so a purge failure is still never reported as a capture failure. | `routes/interview-events.js` |
| Unit suite (red-first, see below) | `server/__tests__/lib/panelWithdrawalPurge-1966.test.js` (new) |

**Boundaries honoured:** no migration/schema, `DIARIZATION_ENABLED` untouched, no staging/main, no emails, no deletion beyond the §7.1 family (job rows + claim snapshots still never deleted).

## Red-first evidence

- New unit suite on unmodified dev code: **3 failed / 3** — the old code never acquires a client, issues no `BEGIN`/`COMMIT`, and a mid-purge failure injected on a client surfaces nothing (the statements silently ran on the pool instead).
- After the fix: **3 passed / 3**.

## E2E gate (HL-003) — fresh-install rig, state read back

**Rig note:** the shared `.pg19rig` server was down in this session and could not be restarted from it (its data dir is owned by a uid this session cannot execute as). An equivalent fresh cluster was stood up from the same extracted PGDG tree — PostgreSQL **18.6** + pgvector, `~/workspace/.pg1966/`, on the same host/port 127.0.0.1:55433 — and a fresh DB was built with the repo's real `migrate.js` (all migrations completed successfully).

- **Dedicated E2E script** (drives the real exported purge function against real Postgres; seeds two recordings of one event, each with runs + mappings + audit + labelled transcript + a snapshot-carrying job):
  - Call 1 with a `BEFORE DELETE` trigger injecting a failure on recording B's mappings delete (the 2nd of the 5 statements): recording A read back **fully purged** (runs 0, mappings 0, audit 0, `speaker_number` NULL, status `unavailable`) and its job's claim snapshot **retained** (C-2); recording B read back **completely untouched** (runs 1, mappings 1, audit 1, `speaker_number` 0, status `complete`) — rollback proven, no partial purge even though B's runs-delete preceded the failing statement. The call **threw**: `failures=[{ recordingId: 2, message: "injected mid-purge failure (e2e-1966)" }]`, `purged=1`.
  - Trigger dropped, call 2 (retry): returned `1`; recording B read back fully purged.
- **Neighbour suite `diarizationPanel-1956.integration.test.js`: 8/8 PASS** on its own fresh migrated DB — including I6, the withdrawal purge exercised through the real capture endpoint (HTTP) with the changed code.
- **Unit suites: 77/77 PASS** — `diarizationGate` + `diarizationWorker` + `panelLabelling` (74 pre-existing) + the new `panelWithdrawalPurge-1966` (3).

## M-2…M-4 — record corrections (same PR)

- **M-2 (P5 transaction scope):** design `br7-panel-notice-design.md` §7 P5 wording corrected in place — the transaction covers the provenance persist + locked panel re-check + snapshot write; the job-claim transition and the first gate evaluation sit outside it; panel-leg atomicity comes from the locked re-check. Correction note also appended to `s-d19-build-log.md`.
- **M-3 (P6 deviation):** design §7 P6 now records the deviation where the P6 codes are documented — write-time `PANEL_AGREEMENT_UNVERIFIABLE` is deliberately not translated to a comparison code (verified in `workers/diarization/index.js`: the translation explicitly excludes it); the job cancels as `consent_blocked_at_write:PANEL_AGREEMENT_UNVERIFIABLE`, fail-closed, output discarded.
- **M-4 (session-path wording):** design §7 intro corrected — session-path logic/codes/consent-table queries are identical, but the shared recording SELECT (`lib/diarizationGate.js`) also fetches `panel_expected_user_ids, panel_expected_hash`. Build-log correction note appended.
- **M-5:** observation only — no action, per the issue.
- Design §7.1 additionally gained an implementation note recording the M-1 change.

## Not in this PR

No merge and no issue closure — Suga gates those after first-hand verification.

## Independent review (pre-PR gate)

Two review passes were run. The first pass's delivered summary raised a "BLOCK" citing a job-PROCESSING/recovery mechanism at `lib/panelWithdrawalPurge.js:128-137`; verified first-hand, that text does not exist — the file is 110 lines and no changed file mentions PROCESSING, and the purge never touches job rows — so that block was discarded as ungrounded (HL-007: verify the reviewer's evidence too) and a second, quote-grounded review was commissioned.

**Second review (ecc/code-reviewer + privacy lens, quote-grounded): ACCEPT-WITH-MINORS, no blockers.** All seven checks verified against quoted diff text: client lifecycle (exactly-once release, ROLLBACK on error, `release()` in `finally`), lock key byte-identical at all three call sites, the five statements sql-identical to the originals, `diarization_jobs` never written (C-2 holds), capture-endpoint response/transaction behaviour unchanged, tests run first-hand (3/3), docs corrections M-2/M-3/M-4 each matched to code. Minors, none requiring a pre-merge change: (M-a) the lock is taken but no live re-check is done under it inside the purge — the purge deletes rather than authorizes, so the exposure the lock closes in `persistClaimProvenance` does not arise; (M-b) the bare-client fallback would throw if a future caller passed a client already inside a transaction — no such caller exists (sole caller passes the pool), follow-up material if one appears; (M-c) the advisory-lock statement sits outside the five statements the unit test counts — cosmetic.
