# #1950 — Diarization bridge hardening (M2–M5) — Build Log

**Persona:** Nova (Implementation) · **Issue:** #1950 (follow-up from PR #1949 full review, minors 2–5)
**STOP 1:** comment 6529743183 on #1950 (root cause per item, specialist decision, plan — posted before coding)
**Specialist decision:** Yes — `ecc/silent-failure-hunter` lens applied at STOP 1 (consent/bridge code: swallowed errors, bad fallbacks, missing propagation). Considered/skipped recorded on STOP 1 (security-reviewer: no new auth surface; database-reviewer: no migration/schema change).
**Scope:** M2–M5 only. **M6 is deferred to S-D17 proof time and is NOT built here.** No migrations, no new dependencies.

## Changes

### M2 — claim-path provenance UPDATE unguarded (`workers/diarization/index.js`)
`persistClaimProvenance`'s transactional path already caught a DB throw and returned `{blocked:'PANEL_AGREEMENT_UNVERIFIABLE'}`, but the fallback path (`typeof db.connect !== 'function' || !snapshot`) called `guardedWrite(db)` unguarded: a transient throw propagated out of `processJob`, was logged by `poll().catch`, and the job stayed `claimed` until the stale-claim sweeper (5 min). Fix, two parts:
- the `|| !snapshot` shortcut is removed — whenever a real transaction client exists, claim provenance (governing-only or with panel snapshot) takes the guarded transactional path;
- the no-client fallback is wrapped in the same try/catch → log + `{blocked:'PANEL_AGREEMENT_UNVERIFIABLE'}`, so `processJob`'s existing blocked handling cancels the job at claim (`consent_blocked_at_claim:PANEL_AGREEMENT_UNVERIFIABLE`, recording `unavailable`) instead of stranding it. This mirrors the stitch path's guarded handling (fail the claim closed, never half-persist, never strand).

### M3 — LiveKit lazy-path race orphan (`lib/governingSession.js`)
Two concurrent lazy creations for one legacy event both created a session; the guarded link UPDATE picked a winner and the loser returned it, but the loser's own session stayed `invited`, `biometric_collection:false`, unlinked — able to authorize nothing, forever. Fix: when the re-read winner differs from the session just created, the loser deletes its own orphan (`DELETE FROM interview_sessions WHERE id = $1 AND status = 'invited'`). The orphan was never linked or returned to anyone, so no consent can target it; the `invited` guard means a session that somehow progressed is never removed. Cleanup is best-effort: a failure is `console.error`-logged (never silent, never `.catch(() => {})`) and the winner is still returned. Inside a caller's transaction (event creation) the branch is unreachable in practice — an uncommitted event cannot be raced.

### M4 — governing sessions for NULL-application events (`lib/governingSession.js`)
`ensureGoverningSession` created + linked a session even when `job_application_id IS NULL`; the gate's step 4 blocks a NULL application id as `SESSION_BINDING_MISMATCH` forever — a wasted consent capture. Fix: with no existing link and a null/absent application id, return `null` without creating or querying. The event stays unbridged; the gate and the consent endpoint keep their existing fail-closed `NO_GOVERNING_SESSION` posture. The transactional event-creation path always carries a validated application id and is unaffected; the LiveKit lazy path already treats a governing-session failure as non-blocking.

### M5 — consent-capture endpoint rate limit (`routes/interview-events.js`)
`POST /api/interviews/:id/biometric-consent` had no rate limit — the event's own candidate could grow the consent/audit tables unboundedly. Fix: after the candidate-ownership check, `distributedRateLimiter.checkLimit('biometric-consent:<userId>:<eventId>', 60_000, 10)` — the same limiter, window, cap and uniform `429 {error:'Too many requests', code:'RATE_LIMITED'}` shape as the BR-7 labelling-consent capture in the same file. On block, nothing is recorded. `checkLimit`'s fail-open-on-limiter-store-error behaviour is inherited deliberately (documented in code, as with the panel capture): the limiter is anti-abuse, the consent checks themselves stay fail-closed.

## Tests — red first, then green

New tests (6) written before the implementation, run against the unmodified base (2 further pins added at the independent-review step, below):

- **RED on base:** `Test Suites: 3 failed, 3 total; Tests: 6 failed, 31 passed, 37 total` — exactly the 6 new tests failed (M2 worker ×2, M3 governing ×2, M4 governing ×1, M5 route ×1); all 31 pre-existing tests passed.
- **GREEN at head (unit):** the same 3 suites — `39 passed, 39 total` (the 6 STOP-1 tests + 2 review-minor pins + 1 added assertion; see Independent review below).
  - `governingSession.test.js`: race loser issues the guarded DELETE for its own id only (never the winner); cleanup failure logged + winner still returned; NULL application → `null`, `SessionService.create` never called, no queries.
  - `diarizationWorker.test.js`: provenance UPDATE throws on the claim path → `cancelled_at_claim:PANEL_AGREEMENT_UNVERIFIABLE`, engine never runs, job never marked processing; `persistClaimProvenance` itself never throws (blocked shape returned).
  - `interview-events-bridge-1925.test.js`: limiter blocks → uniform 429 `RATE_LIMITED`, `recordConsent` not called, limiter keyed `biometric-consent:1001:55` at 10/60 s; limiter allows → pre-existing 201/403/409 behaviour unchanged (the suite's limiter mock gained the `distributedRateLimiter` shape the route file already imports).

## Fresh-install E2E gate (HL-003)

Rig: PostgreSQL 18.6 rebuilt from `~/workspace/pgfull` under `/var/tmp/pg1950` @ 127.0.0.1:55441 (HL-009 pattern).

- Fresh DB `nova1950_fresh`: `DATABASE_URL=… node migrate.js` → **exit 0** ("All migrations completed successfully").
- Real-DB integration, each suite on its **own** fresh migrated DB (the suites' documented isolation — `nova1950_w`, `nova1950_p`, both migrate exit 0):
  - `diarizationWorker.integration.test.js` — **9 passed, 9 total** (incl. bridge I1–I4).
  - `diarizationPanel-1956.integration.test.js` — **8 passed, 8 total** (incl. the real-DB `persistClaimProvenance` T13 write-once tests on the transactional path).
  - Note: running both integration suites against one shared DB in a single jest invocation produced 2 cross-suite fixture failures; each suite passes cleanly on its own fresh DB, which is the isolation their headers prescribe.
- Real-DB race/null proof (script against `nova1950_w`, real `ensureGoverningSession` + real `SessionService.create`):
  - **M3:** two concurrent calls for one event → both returned session **9**; exactly **1** session row remains for the application (id 9, the linked winner) — the loser's orphan was deleted.
  - **M4:** legacy event with `job_application_id` NULL → returned **null**, event's `interview_session_id` stayed **null**, no session created.
- Neighbour regression (unit): `diarizationGate`, `transcriptStitch`, `sessionService`, `panelLabelling`, `consentService`, `livekit-session`, `interview-mount-order` — **160 passed, 160 total, 7 suites**.

## Files changed

- `lib/governingSession.js` — M4 null-application skip; M3 race-loser orphan cleanup.
- `workers/diarization/index.js` — M2 guarded claim-provenance persist (fallback wrap + transactional path always taken when a client exists).
- `routes/interview-events.js` — M5 rate limit on the biometric-consent capture.
- `server/__tests__/lib/governingSession.test.js`, `server/__tests__/lib/diarizationWorker.test.js`, `server/__tests__/routes/interview-events-bridge-1925.test.js` — the 8 new tests + 1 added assertion.
- This build log.

## Independent review

Separate reviewer subagent (ecc/code-reviewer + silent-failure-hunter lens, not self-review), on the full diff: **APPROVE-WITH-MINORS, no BLOCK.** The reviewer independently re-ran the 3 unit suites (37/37 at the reviewed head) and verified each item against the shipped call flow, incl.: M3's DELETE can only target this call's own created session; M4's null breaks no caller (event creation validates the application id; the LiveKit caller discards the return); M5's 429 body is byte-identical to the panel capture's; no new swallowed errors.

Minor dispositions:
1. **M3 cleanup "never fatal" vs a transaction-client executor (latent, unreachable today)** — a failed DELETE inside a caller's PG transaction would leave it aborted; the only executor caller passes a freshly inserted event whose link cannot lose a race. **Disposition:** comment in `lib/governingSession.js` now scopes the never-fatal property to the pool/lazy path and records the latent case; no code change (a SAVEPOINT wrap for an unreachable branch is not ponytail).
2. **M2 `db.connect()` sat outside the guard** — a pool-acquire failure would still throw and strand the job. **Fixed:** connect moved inside the try (release/rollback null-guarded); new red-first pin (connect throws → blocked shape; red 1 failed / 38 passed before the fix, green after).
3. **M3 cleanup result uninspected** — **fixed:** a guard-blocked delete (`rowCount === 0`, orphan had progressed past `invited`) now logs, so deliberate retention is observable.
4. **Test gaps** — (b) **fixed:** the 403 route test now also asserts the limiter was not called (pins M5's after-ownership placement); (c) **fixed:** new governing test pins that no DELETE is issued when the re-read winner is the caller's own session; (a) **accepted residual:** no unit test exercises the null-snapshot + real-client transactional path in `persistClaimProvenance` (the worker test double has no `connect`) — that caller shape is hypothetical today (a bridge-allowed gate always carries a snapshot, and the transactional path itself is exercised on a real DB by the panel integration T13 tests).

Post-review re-verification at the final head: unit 3 suites **39/39**; real-DB integration re-run — worker **9/9**, panel **8/8**; the M3/M4 real-DB race/null script re-run green (race → both callers return the winner, exactly 1 session remains; NULL application → `null`, nothing created).

## Residual / notes

- M2's blocked code reuses `PANEL_AGREEMENT_UNVERIFIABLE`, the transactional path's existing fail-closed code for "provenance could not be persisted atomically" — accurate for the governing-only case too in substance (the claim's authorization provenance is unverifiable because it could not be written), and it keeps one code for one failure class rather than inventing a new gate code.
- M3 cleanup is a DELETE of a row the same call created seconds earlier and never exposed — the exact-scope orphan this issue item names. It is guarded to `status='invited'` and logged on failure; if a future FK ever blocks it, the failure surfaces in logs and the winner path is unaffected.
- M6 (DB-layer sibling fixture) untouched, per deferral.
- No promotion implication changes: the #1949 promotion hold (post–Nov 1 unfreeze, Relay order) is unaffected by this follow-up.
