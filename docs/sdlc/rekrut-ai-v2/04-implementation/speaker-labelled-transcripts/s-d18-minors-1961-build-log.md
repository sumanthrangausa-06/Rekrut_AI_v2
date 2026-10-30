# #1961 Build Log — S-D18 review minors (capture test gaps + audit hardening)

**Persona:** Nova (Phase 4 Implementation) · **Parent:** #1955 (S-D18, PR #1960, independent review ACCEPT-WITH-MINORS, minors 1–5)
**STOP 1:** https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/1961#issuecomment-6511335627 · **Security findings + deviations:** https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/1961#issuecomment-6511757580
**Base:** dev `296734753` (verified first-hand via `git fetch` at run start).
**Branch:** `nova/1961-sd18-minors` from `origin/dev`.
**Scope:** items 1–5 of #1961 exactly. No behaviour change to the capture contract beyond items 3–5. `RETENTION_PURGE_LIVE` / `DIARIZATION_ENABLED` untouched. **One flagged deviation:** item 5 requires migration 300 (see "Deviation" below) — the issue's "no schema" premise was contradicted by a DB CHECK found at build.

## Specialist decision (STOP 1, mandatory question answered)

- **Security reviewer — MANDATORY, consulted** (independent security-reviewer subagent, ecc/security-reviewer lens; full findings on the STOP 1 follow-up comment above). Verdicts: item 3 APPROVE WITH AMENDMENTS (per-user+outcome cap key; cap trip response-silent but logged via `console.warn`; `rate_limited` outcome rides the same cap) — all adopted. Item 4 APPROVE the pool-wrapping shape, naive forms BLOCK (no xact lock on a bare pool, no session lock via `pool.query`); leaf-lock ordering documented; `SET LOCAL lock_timeout='2s'` in the pool branch — adopted. Item 5 BLOCK AS WRITTEN without a migration (see Deviation) — adopted. Items 1–2 sound with two traps (bucket cleanup per run — in `seed()`; post-rollback success assertion — added to T-C9). One refinement vs the reviewer's sketch, recorded: pool/client discrimination uses `totalCount` (Pools expose it, Clients do not) rather than `panelWithdrawalPurge`'s `connect()`-presence check — purge has no in-transaction caller, `writePanelAudit` does, and a pg Client also exposes `connect()`.
- **Privacy — considered, SKIPPED** (per issue): no consent-shape, payload, or retention change; the denied cap only drops excess denial *audit rows* for a flooding user, never a consent record.
- **DB reviewer — considered, initially SKIPPED per issue, REVISED at build:** item 5's label is forbidden by a DB CHECK (below); migration 300 follows migration 254's precedent verbatim, which is the DB-reviewed pattern for exactly this operation.

## Item 1 — tests: uniform 429 + lawful granted→withdrawn (T-C7, T-C8)

**Root cause of the original gap (found at build):** the global jest setup (`server/test/setup.js`) stubs `lib/distributed-rate-limiter` with a `checkLimit` that always returns `{allowed:true}`, and the 1955 suite unmocked only `lib/db` — the capture handler's 429 path could never fire in this suite (HL-003 mocked-layer class). The suite now also unmocks `lib/distributed-rate-limiter`.

- T-C7: recruiter `granted → withdrawn` appends a NEW row (prior rows byte-identical), token reads `own_decision='withdrawn'`.
- T-C8: 16 captures for one (user,event) — all pre-cap responses 200, then uniform 429 `{error:'Too many requests', code:'RATE_LIMITED'}` with no 200 after the first 429; per-user isolation (recruiter on the same event still 200) and per-event isolation (the rate-limited panel user on a different event still 200) both asserted.

## Item 2 — test: mid-transaction failure rolls back (T-C9)

A fresh event/room is seeded; a BEFORE INSERT trigger on `user_notifications` raises for `labelling_decision` rows, forcing the capture transaction to fail at its last step. Asserted: HTTP 500, **zero** `event_labelling_consent` rows for the event, **zero** `recorded` audit rows for the event. Trigger dropped in `finally`; a subsequent capture for the same event then succeeds (200, 1 row) — proving both advisory locks (`panel-event:` + the new audit-chain lock) released on rollback and the pooled client was not poisoned (security-review condition).

## Item 3 — denied-path audit cap

`auditDenied` (`routes/interview-events.js`) runs before the capture rate-limit check, so every 404/403 wrote a hash-chained audit row with no bound. It now first calls the existing `distributedRateLimiter.checkLimit('panel-labelling-denied-audit:<user>:<outcome>', 60s, 20)` and skips the audit write when capped (denial response unchanged; a `console.warn` records the skip). Per-outcome keying (security amendment) bounds growth at ≤140 rows/min/user across the 7 fixed outcomes and keeps a `not_found` flood from masking `foreign_user_id_rejected`. `checkLimit`'s fail-open-on-DB-error behaviour is inherited deliberately (audit preservation beats the cap). T-C10: 30 stranger 404s → audit delta ≥1 and ≤20 (was 30 on base).

## Item 4 — hash-chain serialisation

`writePanelAudit` (`lib/panelLabelling.js`) read the last `current_hash` then INSERTed with no lock: concurrent appends read the same predecessor and fork the chain (on base, T-C11's concurrent burst actually died on the UNIQUE `current_hash` constraint — identical payload+ms timestamps hashing identically). Now every append takes `pg_advisory_xact_lock(hashtext('compliance-audit-chain'))` before the read. Two caller shapes, both grep-verified as the only call sites: a transaction **Client** (capture path — audit stays inside the caller's transaction, lock taken on it directly) and the bare **Pool** (denied path — the function checks out a client and wraps read+insert in BEGIN/COMMIT with `SET LOCAL lock_timeout='2s'`, so the xact lock spans both statements). The chain lock is documented in code as a **leaf lock**: capture order is `panel-event:<id>` → chain lock; no path takes the chain lock then a panel-event lock (worker/purge hold `panel-event:` and write no compliance audit inside it), so no cycle is introduced.

**Inheritance (noted, not fixed — issue scope):** `services/auditLogService.logEvent`/`getLastHash` keeps the identical unlocked read-then-insert from ~20 call sites; a follow-up should take the same `'compliance-audit-chain'` lock key there so the two writers serialise against each other. Until then this fix serialises panel-vs-panel only — the chain is NOT claimed fully fixed. **Residual:** predecessor selection is timestamp-defined (UUID ids, JS-ms `created_at`) in both the writer and `verifyChain`; a same-millisecond tie is a theoretical mis-order, recorded as follow-up material per the security review.

## Item 5 — entity label + DEVIATION (migration 300)

`writePanelAudit` inserted `entity_type='user'` with `entity_id = eventId`. It now inserts `entity_type='interview_event'`, and the value is registered in `auditLogService.ENTITY_TYPES`. Hash safety: `computeHash` does not take `entity_type` as an input and `verifyChain` recomputes from `event_type`/`entity_id` only, so existing rows still verify; historical panel rows are NOT backfilled (append-only trail; they remain `'user'` with `payload.kind='panel_labelling_capture'`).

**Deviation:** the label is rejected by the DB CHECK on `entity_type` (migration 129; extended once by 254) — without a schema change every panel audit write throws `check_violation` (proven on the rig: captures 500, denied audits silently swallowed). **Migration 300** widens the CHECK to add `'interview_event'`, following 254's exact precedent (genuine-CHECK lookup via `pg_constraint contype='c'` — the #1329 PG18 pseudo-CHECK pitfall — named re-add, no-op `down()`). Additive only; no data touched. It is a separate commit so Suga's gate can drop it if ruled against; item 5 cannot ship without it. Migration 300 is NOT promoted by this PR (dev only; migrations 296–300 stay held from staging/production until the Nov 1 unfreeze, as for 299).

## Red-first evidence

On unmodified base code (only test changes applied), fresh DB, real rig:

- T-C7 ✓ (withdrawn transition already lawful — documented as such, not dressed as red), T-C9 ✓ (rollback already held — the claim is now *proven*, which was the item).
- T-C8 ✕ — all 16 captures returned 200: the limiter stub in the global jest setup made 429 unreachable (Discovery 2 on the issue).
- T-C10 ✕ — denied-audit delta 30 > 20 (no cap).
- T-C11 ✕ — concurrent appends died on `compliance_audit_trail_current_hash_key` unique violation (fork symptom) and rows were labelled `'user'`.
- Suite total on base: **3 failed, 10 passed, 13 total**.
- **Precision note (HL-007, added after independent review):** that red run used the test file as first written, *before* the limiter unmock was added — T-C8's red there is the stub's fingerprint, not a production defect. The independent reviewer reproduced the **final** test file against base production code on its own fresh DB: **2 failed, 11 passed** (T-C10, T-C11 fail; T-C8 passes — once the limiter is unmocked, the production limiter behaves correctly and always did; the item-1 gap was testability, exactly as Discovery 2 states).

## E2E gate (HL-003) — fresh-install rig, state read back

Local PostgreSQL **18.6** (extracted PGDG tree) on 127.0.0.1:55435; for each integration suite a **fresh empty database** was created and the repo's real `node migrate.js` run against it: **exit 0** every time, ending "All migrations completed successfully" (incl. "Migration 300_audit_entity_interview_event completed"). Read-back on the main gate DB: the widened CHECK definition includes `'interview_event'`; 197 `_migrations` rows.

- panel-labelling-1955 integration (13 tests incl. new T-C7–T-C11): **13 passed, 13 total**.
- diarizationPanel-1956 integration (fresh DB): **8 passed, 8 total**.
- panel-journeys-1959 integration (fresh DB): **3 passed, 3 total**.
- Unit/migration neighbours (panelLabelling, migrations 254/296/297/298/299/300, audit-chain-verify-1342, diarizationGate): **84 passed, 6 skipped, 90 total** (skips are the suites' own DB-conditional skips, as on base).
- Retention/audit consumers (retention-audit-integration, legal-hold, retention-lifecycle): **85 passed, 2 skipped, 87 total**.
- State read back from the main gate DB after the run: `compliance_audit_trail` = 58 rows, **all 58** `entity_type='interview_event'`, exactly **1** genesis row (`previous_hash='0'`), **0** orphans (every `previous_hash` resolves), no forked `previous_hash`; the stranger's denied-audit bucket recorded 31 attempts while T-C10's audit delta stayed ≤20 (cap working); consent rows for the T-C9 event = exactly the 1 post-rollback success row.

## Independent review

**Verdict: APPROVE-WITH-MINORS, no BLOCKs** (independent reviewer, ecc/code-reviewer + security lens; did not write this code; reviewed head `284174688`). The reviewer verified first-hand: all 7 denied outcomes route through `auditDenied` (which auth guarantees runs with `req.user` — it sits behind `authMiddleware`); hash inputs unchanged (`entity_type`/`previous_hash` are not hash inputs, so old and new rows verify identically); lock ordering (sole `panel-event:` → chain order; chain lock is a leaf); migration 300 is byte-equivalent in pattern to 254, `_migrations`-gated on re-run and CHECK-idempotent on direct double-`up()` (both reproduced); scope clean (7 files, flags untouched). **Independent re-runs (reviewer's own fresh DB, not the builder's):** unit suites 8/8, the 1955 suite **13 passed / 13**, migrate re-run exit 0 with 197 migrations, and a state read-back matching the builder's exactly (58 audit rows, all `interview_event`, 1 genesis, 0 forks, stranger denied-audit bucket 31 attempts against capped writes).

Minors raised and their disposition:

- **[minor — FIXED] T-C8 asserted the 429 shape but not the exact cap.** A fresh-event leg was added: on a clean (user,event) bucket exactly 10 captures succeed, the 11th and 12th are the uniform 429, and exactly 10 consent rows exist.
- **[minor — FIXED] T-C9 was not re-runnable on the same DB** (its absolute zero-audit assertion counted a prior run's rows). `seed()` now cleans the T-C9/T-C8 auxiliary events, and T-C9 asserts the recorded-audit count as a delta (literal zero on a fresh DB, where the baseline is 0). Proven: the suite now passes **13/13 twice in a row on the same database** (gate5 run, this log's evidence updated accordingly).
- **[minor — NOTED, no change] Migration 300's direct double-`up()` drops/re-adds the CHECK** — it converges to the identical single constraint (the reviewer reproduced this); via `migrate.js` it is `_migrations`-gated. Same behaviour as precedent 254.
- **[cosmetic — NOTED] `console.warn` on cap-skip fires once per skipped write** — bounded by the request rate itself and only past the cap; accepted as the observability the security review required.

## Not in this PR

No merge and no issue closure — Suga verifies first-hand and gates those.
