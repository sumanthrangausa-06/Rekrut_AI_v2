# #1999 — Pin C test-robustness: request-throw capture + full-row artefact pin (build log)

Story: #1999 [FOLLOW-UP] #1997 review minors — pin C test-robustness
nits (PR #1998 review, APPROVE-WITH-MINORS, comment 6516950814).
STOP 1: issue #1999 comment 6517646368 (posted before any code).
Base: dev `1f6d9102e`. Branch: `nova/1999-pin-c-robustness`.
PR to dev only; no merge/closure by Nova — Suga gates.
**Production code is not implicated and was not touched** — the only
code change is the pin C test in
`server/__tests__/routes/recordings-segments-realdb-1904.test.js`.

## Root cause

1. **MINOR-1:** pin C held the transcribe response in `let res`, with
   teardown in `finally` and `expect(res.status).toBe(500)` after the
   block. A request that throws leaves no clean assertion tied to the
   pin's expectation: reproduced first-hand (below), the thrown error
   propagates bare out of the try/finally and **none of pin C's
   assertions ever run** — no status assertion, no intactness checks —
   so the failure carries no pin-level diagnosis (the reviewer's
   TypeError phrasing covers the same undefined-`res` hazard if the
   throw is ever swallowed upstream of the assertion).
2. **MINOR-2:** pin C asserted the 4 diarization artefact tables by
   `COUNT(*) = 1` only. A count-preserving in-place mutation of an
   artefact row (rollback defect that rewrites content) passed the
   pin — reproduced first-hand below.

## Specialist decision (STOP 1)

No dedicated specialist spawn. ecc/database-reviewer (DB/transactions)
was considered and its lens applied in-line: the change touches no
schema, migration, production SQL, or transaction code — it widens a
test read-back and captures a thrown error, following the exact
byte-identical `toEqual` pattern the DB/transactions specialist set
on #1997 pins A/C. Security/e2e/frontend specialists skipped (no such
surface). The independent post-build review (reviewer re-runs the
suite) is the specialist-grade check for this lane. Lead/Rex
positions from the #1997/#1998 record are recorded in STOP 1
(HL-004 — no solo call).

## What changed (test file only)

- **MINOR-1:** pin C's request is now `try { … } catch (err) {
  reqErr = err } finally { DROP TRIGGER / DROP FUNCTION }`; after
  teardown, a captured error fails the test with
  `pin C transcribe request threw instead of returning HTTP 500:
  <underlying stack>` — a clean, diagnosable failure naming the
  expectation and the cause. Teardown remains in `finally`.
- **MINOR-2:** before the re-run, pin C snapshots the full rows of
  all 4 artefact tables (`SELECT * … WHERE recording_id=$1 ORDER BY
  id`; all four carry `id SERIAL PRIMARY KEY`, migration 296). After
  the forced rollback it asserts `expect(after).toEqual(snapshot)`
  per table — strictly stronger than the count it replaces. Segment
  byte-equality and both recording status assertions are unchanged.

## Evidence (HL-003 / HL-007)

Rig: local PostgreSQL 18.6 on 127.0.0.1:55439 (fresh cluster built
this run from the `~/workspace/pgfull` PG 18.6 tree under
`/var/tmp/pg1999-root`, data `/var/tmp/pg1999-data` — no existing rig
was running). Every DB below is fresh, built by the repo's real
`node migrate.js`, exit 0 ("All migrations completed successfully").

- **Baseline (base dev test file, DB `sd02_1999_base`): 15 passed,
  15 total.**
- **RED — MINOR-1 (scratch copies, `-t "pin C"`, DBs
  `sd02_1999_reda`/`sd02_1999_redb`, migrate exit 0 each):** a throw
  injected inside pin C's try (simulating a throwing request):
  - OLD test: **1 failed** — the raw `Error: simulated request
    failure: read ECONNRESET` propagates out of the try/finally; no
    pin assertion executes.
  - NEW test: **1 failed** — with the clean message
    `pin C transcribe request threw instead of returning HTTP 500:
    Error: simulated request failure: read ECONNRESET` (+ stack).
  - Teardown verified in BOTH DBs after the runs:
    `SELECT count(*) FROM pg_trigger WHERE tgname='test1997_fail_trigger'`
    = 0.
- **RED — MINOR-2 (scratch copies, `-t "pin C"`, DBs
  `sd02_1999_redc`/`sd02_1999_redd`, migrate exit 0 each):** a
  count-preserving content mutation injected after the forced
  rollback (`UPDATE diarization_jobs SET status='failed'`):
  - OLD test: **1 passed** — the count-only pin misses the mutation.
  - NEW test: **1 failed** — `toEqual` diff shows exactly
    `"status": "complete"` (expected) vs `"failed"` (received).
  Scratch copies were deleted before commit (never committed).
- **GREEN (final head, fresh DB `sd02_1999_green`, migrate exit 0):
  15 passed, 15 total** — the full
  `recordings-segments-realdb-1904` suite.
- **Regressions (same green DB, each suite under its own
  `*_INTEGRATION_DB_URL`): 99 passed, 0 failed, 10 suites** —
  transcript-composition-1911, candidate-parity-1913,
  speaker-mapping-1912, journey-1918, session-detail-1938,
  fence-shape-1916, transcriptStitch (unit + integration),
  diarizationWorker (unit + integration).

## Boundaries held

Test file + this log only; no production code, no migration; no
staging/main contact; `RETENTION_PURGE_LIVE` untouched;
`DIARIZATION_ENABLED` untouched; no email/outreach.
