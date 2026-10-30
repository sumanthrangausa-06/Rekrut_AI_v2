# #1988 Build Log — auditLogService hash-chain lock

**Persona:** Nova (Phase 4 Implementation) · **Parent:** #1961 / PR #1987 (S-D18 minor 4 follow-up)
**STOP 1:** https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/1988#issuecomment-6512225819
**Base:** dev `7225540d24d87587f01897127e4583fdce2de176` (verified first-hand via `git fetch` at run start).
**Branch:** `nova/1988-audit-chain-lock` from `origin/dev`.
**Scope:** `services/auditLogService.js` (`logEvent` + `verifyChain` ordering) + tests + this log. No migration, no schema change, `RETENTION_PURGE_LIVE` untouched (stays OFF). PR to dev only; no merge/closure by Nova — Suga verifies first-hand.

## Specialist decision (STOP 1, mandatory question answered)

- **Security reviewer — MANDATORY, consulted before STOP 1** (independent security subagent, ecc/security-reviewer lens). What it changed: (1) `lock_timeout='2s'` kept and **fail-closed** — a timeout throws, never swallowed / retried unlocked / falling back to genesis; (2) the inserted row is returned **only after COMMIT succeeds**, a rollback failure rethrows the original error and **destroys the client** (`release(err)`); no payload/`req` data on new error paths; (3) the tie-breaker plan was changed — a comment-only pin was **rejected as unsound** (see Tie-breaker), the monotonic-bump + linkage-walk combination adopted instead; (4) the erasure exclusion was accepted **only** with a separately filed follow-up and narrowed claims — filed as **#1989** in this run.
- **DB reviewer — considered, SKIPPED:** no schema/migration; the one DB question (a serial tie-breaker column) is answered from migration 129 directly.
- **Privacy — considered, SKIPPED:** no payload, consent, retention, or data-shape change.

## Root cause

`logEvent` appended as three separate pool statements with no transaction and no lock: `getLastHash()` (`ORDER BY created_at DESC LIMIT 1`) → `computeHash` → `INSERT`. Concurrent appends read the **same predecessor** and fork the chain (or collide on the UNIQUE `current_hash`). `writePanelAudit` (#1961) serialises panel appends on `pg_advisory_xact_lock(hashtext('compliance-audit-chain'))`, but `logEvent` (~20 call sites) never took it — panel-vs-logEvent and logEvent-vs-logEvent appends still raced.

## Fix — `services/auditLogService.js`

- **`logEvent`** mirrors `writePanelAudit`'s Pool branch exactly (logEvent has only the global pool; signature and return contract unchanged; type validation still runs before any client is checked out): `pool.connect()` → `BEGIN` → `SET LOCAL lock_timeout = '2s'` → `SELECT pg_advisory_xact_lock(hashtext('compliance-audit-chain'))` → predecessor read on that client → hash → `INSERT … RETURNING *` → `COMMIT` → return the row. On error: `ROLLBACK`, rethrow the original; if rollback fails, `client.release(err)` destroys the client rather than pooling it with an open transaction/lock held. Documented in code as a **leaf lock** (taken last, nothing after it, held only to commit), including the cross-connection self-deadlock warning the security review required and the pre-existing truth that `logEvent` was never inside a caller's transaction and still is not.
- **Predecessor selection** aligned with panel/erasure: `ORDER BY created_at DESC, id DESC LIMIT 1`, now also selecting `created_at` (internal helper `getChainHead(client)`; `getLastHash` was internal-only).
- **Mocked-suite update** (`tests/compliance-audit.test.js`): the hand mock's pool gains a `connect()` whose client reuses the mock query handler (BEGIN/COMMIT/SET LOCAL/lock statements fall through), and the last-hash mock returns `created_at` alongside `current_hash`. No assertion in that suite was weakened.

## Tie-breaker (residual from #1961) — decision and honest residual

**Schema fact:** `compliance_audit_trail.id` is `UUID PRIMARY KEY DEFAULT gen_random_uuid()` (migration 129) — **no serial/sequence column exists**, and adding one is a migration (not authorised here; Sumanth's gate). A pin-with-comment was **unsound**: even a locked serial writer using `ORDER BY created_at DESC LIMIT 1` can pick the wrong predecessor when the previous two rows share a millisecond (tie order unspecified), and a random-UUID `id` tie-break is deterministic-but-arbitrary, not insertion order.

Adopted, with **hash inputs/formula unchanged** (`GENESIS_HASH='0'`, canonicalisation, ISO-ms format all untouched — existing rows keep verifying):

1. **Monotonic guard:** under the lock, `logEvent`'s `createdAt = max(now, predecessor.created_at + 1ms)`, computed (no sleep under lock); that exact string is hashed and stored — this writer never *creates* a same-ms tie with its predecessor.
2. **Unscoped `verifyChain` orders by hash linkage:** rows fetched in deterministic `created_at ASC, id ASC` fallback order are walked from genesis by following `previous_hash → current_hash`; unreached leftovers (orphans / fork branches / cycles) follow in fallback order, where the existing linkage checks flag them.
3. **Scoped `verifyChain(companyId)`** keeps the timestamp fallback and is labelled in code: a non-contiguous subset can recompute hashes but cannot prove global contiguity (pre-existing semantics, unchanged).

**Residual (named):** the guard does not repair pre-existing top-of-chain ties (predecessor choice there remains arbitrary until the next append re-anchors the chain) and panel/erasure writers have no such guard. Without a sequence column the columns give no total order — only linkage does.

## erasureService — OUT of scope, filed as #1989

The #1337 dead-letter drain fold in `lib/erasureService.js` is a third, unlocked writer, but it appends on the erasure transaction's **own client** so replay + deletion stay atomic and fail-closed; it cannot take the lock on a separate pooled client (breaks atomicity; self-deadlock risk). Its correct fix — the same xact lock on its own transaction client before its hash SELECT — is #1989. **Accurate claim for this PR:** *logEvent and panel writers are serialised; the erasure drain writer remains an unserialised third writer, tracked in #1989.*

## Red-first evidence

New real-DB suite `server/__tests__/lib/audit-chain-lock-1988.integration.test.js` (gated behind `AUDIT_CHAIN_LOCK_DB_URL`, 1342 precedent), run against **unmodified base** production code on a fresh DB (PG 18.6, 127.0.0.1:55435):

- ✕ concurrent mixed-writer burst — **expected exactly 1 genesis row, received 4** (fork on base; all 20 appends landed, four of them children of genesis).
- ✕ monotonic guard — a logEvent row written after a future-dated chain head carried a timestamp ~1 hour **before** its predecessor.
- ✓ same-ms linkage pin passed on base too (heap order happened to match insertion order — recorded as a pin, not dressed as red).
- Suite total on base: **2 failed, 1 passed, 3 total**.

## E2E gate (HL-003) — fresh-install rig, state read back

Local PostgreSQL **18.6** on 127.0.0.1:55435; fresh empty database `rekrut_1988_fresh`; the repo's real `node migrate.js` run against it: **exit 0**, "All migrations completed successfully" (incl. migration 300), `_migrations` read-back **197 rows**.

- Mixed-writer burst script against that DB: **15 `logEvent` + 10 `writePanelAudit` appends fired concurrently — 0 rejected.** Read back from the DB: **25 rows total** (15 `candidate` + 10 `interview_event`), **exactly 1 genesis row**, **0 forked predecessors** (no `previous_hash` used twice), **`verifyChain()` = { valid: true, checked: 25, errors: [] }**, script exit 0.
- New integration suite on its own fresh DB: **3 passed, 3 total**.
- Regression suites: mocked compliance suite + panelLabelling + legal-hold + erasure drain (#1337) + migration-300: **104 passed**; audit-chain-verify-1342 (real DB): **3 passed**; retention-audit-integration (real DB): **2 passed**. Biome check on changed files: exit 0.

## Independent review

<!-- REVIEW-SECTION -->
_Pending at first push — the independent reviewer's verdict and comment link are recorded on the PR and the #1988 checkpoint; this section is updated in-PR when the review lands._

## Not in this PR

No merge and no issue closure — Suga verifies first-hand and gates those. No staging/main promotion (dev only).
