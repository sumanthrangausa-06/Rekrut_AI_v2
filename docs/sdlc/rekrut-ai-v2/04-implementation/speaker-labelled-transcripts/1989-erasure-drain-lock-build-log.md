# #1989 Build Log — erasureService compliance-audit drain fold chain lock

**Persona:** Nova (Phase 4 Implementation) · **Parent:** #1988 / PR #1990 (security-review follow-up)
**STOP 1:** https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/1989#issuecomment-6512940136
**Base:** dev `de98e5a160377ba060926dd16204e2c1116cd00d` (verified first-hand via `git fetch` at run start; #1988 merged).
**Branch:** `nova/1989-erasure-drain-lock` from `origin/dev`.
**Scope:** `lib/erasureService.js` (drain lock only, +16 lines) + new real-DB integration suite + this log. No migration, no schema change, `RETENTION_PURGE_LIVE` untouched (stays OFF). PR to dev only; no merge/closure by Nova — Lead/Suga gate.

## Specialist decision (STOP 1, mandatory — legal-erasure path)

- **Security (ecc security-reviewer lens) — consulted BEFORE STOP 1: CLEAR, no BLOCK.** Verified same lock name/key as `services/auditLogService.js:212` and `lib/panelLabelling.js:167`; constant SQL (no injection); no auth surface. Conditions adopted: acquire the lock **once**, not per marker (xact advisory locks stack per acquisition — a per-marker call would re-acquire N times for zero benefit); placement on `c2Query` only, never a separate pooled client (atomicity + cross-connection self-deadlock). Its wider sweep for other append sites ran on a stale local checkout and reported extra sites at shifted line numbers; re-verified first-hand on the exact base `de98e5a16`: the drain's hash SELECT (:1541) + INSERT (:1554) are the **only** `compliance_audit_trail` append in `lib/erasureService.js`.
- **Privacy (GDPR/CCPA lens, Lex caveats) — consulted BEFORE STOP 1: CLEAR, no BLOCK.** No personal-data, retention, consent, hold, or routing change; the change strengthens the Art. 5(2)/Art. 30 accountability record. Caveats adopted: (a) the lock statement sits **inside** the per-marker `try`, so a lock failure surfaces as the existing typed `ComplianceAuditDrainError` (`COMPLIANCE_AUDIT_DRAIN_BLOCKED`) and the caller's BEGIN…COMMIT rolls the whole erasure back; (b) the lock failure is never swallowed — no empty catch, no fallback to the unlocked append; (c) honest residual wording until this lands: logEvent + panel writers serialised, erasure drain writer the unserialised third writer.

## Root cause

The #1337 dead-letter drain fold inside `erasePersonalData` appends to `compliance_audit_trail` on the erasure transaction's own client (`c2Query`, `lib/erasureService.js:1253`): tip SELECT (:1541, `ORDER BY created_at DESC, id DESC LIMIT 1`) → `computeTrailHash` → INSERT (:1554) — with **no advisory lock**. The other two writers take `pg_advisory_xact_lock(hashtext('compliance-audit-chain'))`; the long, unlocked erasure transaction could interleave with a `logEvent`/panel append and fork the chain (two rows sharing one `previous_hash`).

## Fix — `lib/erasureService.js` (+16 lines, one hunk)

Inside the drain's per-marker `try`, immediately before the tip SELECT: a once-guarded (`drainChainLockHeld` flag declared before the marker loop) `SELECT pg_advisory_xact_lock(hashtext('compliance-audit-chain'))` executed on `c2Query`. Same key as #1961/#1988, xact-scoped (released at the erasure COMMIT/ROLLBACK — replay + deletion stay atomic), leaf in this leg (after it, the leg only computes the hash and INSERTs). Multi-marker drains execute exactly one lock statement.

**Placement note (recorded on STOP 1, not silently chosen):** security's once-only condition + privacy's typed-fail-closed condition together place the single acquisition inside the loop's first appending iteration rather than before the loop — before-the-loop sits outside the `try` and would lose the typed `ComplianceAuditDrainError` on a lock failure (the caller would still roll back, but the #1337 named error contract would weaken).

**Out of scope, not fixed here (privacy-review note):** the drain orders the tip `created_at DESC, id DESC` while `logEvent` orders `created_at DESC, id ASC` — a pre-existing inconsistency, a separate follow-up candidate; this lane changes locking only.

## Red-first evidence

New real-DB suite `server/__tests__/lib/erasure-drain-lock-1989.integration.test.js` (gated behind `ERASURE_DRAIN_LOCK_DB_URL`; requires a fully migrated disposable DB because the erasure sweeps touch the whole schema). The race is made deterministic with a TEST-ONLY trigger that sleeps inside drain-row INSERTs (`payload->>'replayed_from_dead_letter'='true'`), widening the tip-SELECT → INSERT window; dropped in `afterAll`, never present outside the suite. (First poll implementation self-matched its own `pg_stat_activity` query and fired the burst early — a false green on base; fixed by anchoring the poll to real client INSERT statements, after which the red below reproduced.)

Against **unmodified base** (fix stashed), PG 18.6 rig:

- ✕ burst serialisation — **expected exactly 1 genesis row, received 2** (the burst's first append and the drain append both built on genesis: a fork).
- ✓ drain-failure fail-closed — passed on base too (pre-existing behaviour the fix must preserve, and does).

## E2E gate (HL-003) — fresh-install rig, state read back

Local PostgreSQL **18.6** on 127.0.0.1:55435 (rig at `/var/tmp/pg1961`, same rig as #1961/#1988). Brand-new database `rekrut_1989_gate`; the repo's real `node migrate.js` against it: **exit 0**, "All migrations completed successfully".

- New integration suite on the fresh gate DB: **2 passed, 2 total** — (a) drain append serialises against a concurrent burst of 4 `logEvent` + 3 `writePanelAudit` appends fired while the drain INSERT was in flight: 0 burst rejections, **8 trail rows total, exactly 1 genesis, no `previous_hash` used twice, `verifyChain()` = valid with 8 checked**, the drain row present (`dead_letter_marker_id` read back), and the seed screening row deleted (drain + deletion committed atomically); (b) a drain failure (unknown dead-letter `event_type`) rejects with `COMPLIANCE_AUDIT_DRAIN_BLOCKED` and, after rollback, the screening row + marker still exist and the trail is empty — fail-closed atomicity preserved.
- Burst-writer `lock_timeout` note: `logEvent`/`writePanelAudit` carry `SET LOCAL lock_timeout = '2s'` (#1988/#1961 design — bounded wait, fail rather than block). The suite's sleep window (1s) keeps the fixed path's commit inside that bound; an early 3s-window run showed the burst failing with `canceling statement due to lock timeout`, which is that designed bound operating, recorded here rather than hidden.

## Regressions

- #1988 integration suite (`AUDIT_CHAIN_LOCK_DB_URL` rig): **4 passed**.
- Mocked/unit batch — `tests/compliance-audit.test.js`, `threat-intel-erasure`, `storage-sweep-wiring`, `admin-dsar-fulfillment`, `auth-delete-account-legal-hold`: all passed. `resume-family-erasure`: **2 failed / 10 passed — identical result on unmodified base** (pre-existing mock drift: the suite's mock returns `undefined` for the `ai_observer_reports` DELETE at `lib/erasureService.js:1717`); not caused by this change and not fixed in this lane.

## Independent review

_To be completed by a separate reviewer subagent on the final diff; verdict + comment link recorded here and on the PR before the checkpoint._
