# #1927 — Diarization engine hardening: decode timeout, stdout cap, sdkVersion pin-check (build log)

Story: #1927 [FOLLOW-UP] Diarization engine hardening (from the PR #1926
independent code review). Items 1, 2, 4 built; item 3 investigation-only.
STOP 1: issue #1927 comment 6518825428 (posted before any code).
Base: dev `687827804`. Branch: `nova/1927-engine-hardening`.
PR to dev only; no merge/closure by Nova — Suga gates.

## Root cause (per item, lib/diarizationEngine.js @ base)

1. **Decode timeout missing** — `decodeToPcm` settled only on ffmpeg's
   `error`/`close` events and had no timer (both sibling functions,
   `runEngineChild` and `provisionWeights`, have one). A hung ffmpeg
   never emits either event, so the worker's sequential poll loop
   stalls inside `processJob` while its heartbeat keeps the claim
   fresh — stale-claim recovery can never fire.
2. **stdout unbounded** — `runEngineChild` accumulated stdout with no
   cap while stderr was capped at `STDERR_CAP = 4096`. A runaway child
   could grow supervisor memory for up to the 15-min child timeout.
3. **sdkVersion loose** — validation accepted any truthy value and the
   child's own fallback is `'unknown'`, so a wrong-package child's
   output passed validation and its provenance reached the run row.

## Specialist decision (STOP 1)

Yes — ecc **silent-failure-hunter** lens (swallowed errors, dangerous
fallbacks, missing timeout/error propagation around process paths),
read and applied. Considered and skipped: agency-agents SRE (broader
ops lens; these are code-level failure-propagation defects) and
ecc security-reviewer (no consent, audio-content, auth, or persistence
surface changes). What the lens changed: (a) stdout overflow fails
loudly with an explicit message and kills the child immediately —
never silent truncation, which would surface as a misleading
malformed-output error; (b) the decode timeout carries an explicit
timed-out flag mirroring `runEngineChild`'s existing pattern, so a
SIGKILLed ffmpeg cannot fall through to a misleading generic exit
message; (c) the `'unknown'` sdkVersion fallback is treated as a
dangerous fallback at a trust boundary and rejected at validation.
No BLOCK raised.

BR-4/BR-5 preservation: decode stays pipe-to-memory, PCM streams to
the child over stdin, embeddings still exist only inside the child.
The new paths only add kill-and-classify behaviour that already
existed for the engine child; no temp file, no persistence change.

## Changes (lib/diarizationEngine.js only)

- `DEFAULT_DECODE_TIMEOUT_MS = 10 * 60 * 1000`, configurable via
  `opts.decodeTimeoutMs`. Decode is a pure transcode many times
  faster than realtime (60-min recording ≈ 1–3 min on a modest vCPU);
  10 min is generous headroom, but finite. Timeout kills ffmpeg
  (SIGKILL) and rejects `decode_failed` per the issue + file taxonomy.
- `STDOUT_CAP = 1024 * 1024` beside `STDERR_CAP`. Turns JSON is
  ~50–60 bytes/turn; a pathological 60-min recording (turn every 2 s)
  is ~110 KB, so 1 MiB is ~9x headroom. Exceeding it rejects
  `engine_failed` ("engine child stdout exceeded …-byte cap") and
  kills the child.
- `EXPECTED_SDK_VERSION = '4.2.1'` (BR-8 pattern, beside
  `MODEL_VERSION`; the worker package pins exactly 4.2.1, guarded by
  diarizationPinning-1907). `parsed.engine.sdkVersion` must equal it,
  else `engine_failed`. `'unknown'` and any wrong version rejected;
  `'4.2.1'` accepted.

## Red / green evidence (server/__tests__/lib/diarizationEngine.test.js)

Tests extend the existing suite in its style; the new process cases
use the existing `spawnFn` seam (hanging fake ffmpeg EventEmitter
child that emits `close` only when killed) and real fake .mjs
children for stdout/sdk cases — the seam IS this module's unit
boundary (ffmpeg/the engine child are external processes).

RED on base (687827804): **6 failed, 11 passed** — all six #1927 tests
fail (constants undefined; hanging decode never settles, 5 s test
timeout; over-cap stdout surfaces as a parse error, not the cap
error; `'unknown'` and `'9.9.9'` resolve successfully; pin constant
absent), all 11 pre-existing tests pass.

GREEN on branch: **17 passed, 0 failed.**

## Neighbours (baseline vs branch, same 12 suites)

diarizationEngine, diarizationFlag, diarizationJobs, diarizationGate,
diarizationFence-1916, diarizationPinning-1907, diarizationWorker,
diarizationLongProof, transcriptStitch (unit) + migrations
296/297/299 suites:

- Baseline (pristine dev worktree): 12 suites passed — 154 passed,
  3 skipped, 157 total.
- Branch: 12 suites passed — 160 passed, 3 skipped, 163 total.
- Delta is exactly the 6 new tests; zero regressions.

The diarizationEngine.integration AC-2/AC-3 environment failure
(#1941) was not re-run in this lane (known to fail identically on
pristine dev on this VM; not chased, per the lane brief).

## Item 3 investigation (run-row atomicity) — verdict

**Behaviour already mitigated by S-D07; DB-level UNIQUE still absent —
the residual belongs with #1931 item 1. No migration or worker
transaction change made in this lane.**

Evidence:
- The issue's named code no longer exists: `insertRunRow` has zero
  hits in lib/, workers/, server/ (non-test). The worker
  (`workers/diarization/index.js`) no longer inserts a run row itself.
- Real engine output persists only through
  `lib/transcriptStitch.js` `persistStitch`, which is a single
  transaction on one client: `BEGIN` (L157) → job row
  `SELECT … FOR UPDATE` + status/`processing`/newest-job/segment-set
  generation guards (L160+) → explicit existence check
  `SELECT 1 FROM diarization_runs WHERE job_id = $1` →
  guard-fails if a run row already exists (L188–191, commented
  "idempotency backstop") → `INSERT INTO diarization_runs` (L227) →
  segment/mapping writes → guarded job completion
  `UPDATE diarization_jobs SET status='complete' …` (L279) →
  `COMMIT` (L287). Any failure rolls back run row and completion
  together. The job-row lock serializes concurrent attempts, so the
  existence check cannot race.
- The worker's remaining non-transactional
  `diarizationJobs.complete(job.id)` (workers/diarization/index.js
  L426) runs only when the output carries no engine provenance (the
  S-D04 stub seam) — that path inserts no run row, so it cannot
  produce a duplicate.
- Residual: `diarization_runs.job_id` is a plain nullable FK
  (migrations/296_diarization_schema.js L145); the only index is on
  `recording_id` (L157–158), and no later migration (297/298/299)
  adds a UNIQUE on `job_id`. The no-duplicate guarantee today is
  application-level (transaction + lock + guard), not schema-level.
  A future writer bypassing `persistStitch` could still duplicate —
  closing that belongs with #1931 item 1 (UNIQUE migration,
  expand-only, promotion-gated).
