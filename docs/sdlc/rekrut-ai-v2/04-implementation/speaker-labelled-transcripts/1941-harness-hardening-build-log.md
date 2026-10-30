# Build Log — #1941 diarization integration harness hardening (test-only)

**Lane:** Nova (Phase 4 Implementation) · **Base:** `origin/dev` at `e16208e6f` (verified live at dispatch)
**Branch:** `nova/1941-harness-hardening` · **Scope:** ONE test file —
`server/__tests__/lib/diarizationEngine.integration.test.js` — plus this log.
No production code, no schema, no migrations, no new deps.

## STOP 1 summary

Posted on #1941 (comment 6520850921). Root cause is the already-accepted
diagnosis (Suga acceptance 6488210750, resting on diagnosis 6488185901;
Scout re-verification 6520379047): engine/weights/code healthy; historical
AC-2 failures are VM OOM windows (child peaks ~850 MB, kernel signal-kill →
`engine_oom`) landing on a bare outcome assertion with no job-row evidence,
plus AC-3 whole-clone git-status fragility. Scout's precision drives item 1:
job/run rows are cascade-deleted when `afterAll` deletes the recording, so
the failed job's row can only be captured **inside** the test.

**Specialist decision (mandatory):** No separate specialist spawn — the ecc
**silent-failure-hunter** lens (opaque-failure domain: a bare assertion that
swallows the job row) and the ecc **e2e-runner** lens (this suite is the
HL-003 real-path gate; harness changes preserve its realness) were applied
in-line by Nova. Considered and skipped: database specialist (no schema/query
change beyond reading a row the suite owns), security/privacy (no consent or
data surface touched), engine/runtime debugging specialist (that lens owned
the accepted diagnosis lane; this lane implements its recorded follow-ups).

## What was built

1. **Job-row on failure + named failure.** On a non-`complete` AC-2 result the
   test reads the `diarization_jobs` row (id, status, error_class,
   error_message) inside the test, `console.error`s it, and — if the outcome
   is still not `complete` after any retry — throws a named error containing
   the full row and the result, instead of `expect(result.outcome).toBe('complete')`.
2. **Single retry on `engine_oom` only.** Attempt 1 returning
   `{outcome:'failed', errorClass:'engine_oom'}` logs its job row, enqueues a
   FRESH job, claims and processes it exactly once more. Any other errorClass,
   or a second failure, does not retry. AC-4 semantics unchanged.
3. **AC-3 scoped to `workers/`.** The git-status before/after comparison is
   filtered to entries under `workers/` (the tree the engine child can dirty);
   on a scoped mismatch the full unfiltered before/after is logged. The stray-
   artefact `find workers …` sweep is unchanged.
4. **Serialized invocation documented** in the file header: run alone,
   `--runInBand --forceExit`, ops rule ≥2 GB available RAM + /tmp headroom,
   never concurrent with other suites (#1918/#1941).

### Discovered queue interaction (probe-proven, no production change needed)

The naive retry (enqueue fresh → single `claim()`) **does not work** against
the real queue semantics, and probe (b) run 1 proved it (see below):
`claim()` returns retryable `failed` rows oldest-first, so it re-claims
attempt 1; processing that row after a fresh enqueue returns
`{outcome:'superseded'}` — the fresh row made attempt 1's generation stale —
and attempt 1's row ends `cancelled`. The shipped harness therefore claims
in a loop until the **fresh** row itself is returned and processes only it
(the re-claimed attempt-1 row stays `claimed` and is cascade-deleted with
the recording at teardown; test DB only). This is documented in a code
comment at the retry site.

## Red-first probes (probe copies discarded, never shipped)

Probe harness: concurrent writes were triggered deterministically by a
poller that waits until a `diarization_jobs` row exists (engine window open),
then writes the file. All probe DBs were fresh-migrated on the PG 18.6 rig at
127.0.0.1:55439 (`node migrate.js` exit 0 verified directly, no pipe masking).

### (a) AC-3 fragility

**BASE file + concurrent unrelated write (`probe1941-unrelated.txt`, repo root): RED.**
Engine healthy — `[diarization] job 1 … complete (stitched)`,
`attribution correct share = 98.61%` — then AC-3 failed on the whole-clone
comparison, verbatim from the jest diff:

```
    - Expected  - 0
    + Received  + 1
      M server/__tests__/lib/diarizationEngine.integration.test.js
    + ?? probe1941-unrelated.txt
    > 181 | 		expect(repoStatusAfter).toBe(repoStatusBefore);
Tests:       1 failed, 1 passed, 2 total
```

**FIXED file + same unrelated write: PASS** — `Tests: 2 passed, 2 total`,
attribution 98.61%, jest exit 0.

**FIXED file + concurrent write under `workers/` (`workers/probe1941-stray.txt`): RED (as required).**

```
    [sd05-gate] AC-3 workers/ mismatch — full unfiltered diff (before vs after):
    ?? workers/probe1941-stray.txt
    Received: "?? workers/probe1941-stray.txt"
Tests:       1 failed, 1 passed, 2 total
```

### (b) OOM path (worker's existing `runEngine` seam, as AC-4 uses)

Probe copies forced attempt 1 to throw `engine_oom`; the fixed probe's retry
delegated to the REAL engine (`lib/diarizationEngine.diarizeAudio`).

**BASE-shaped logic (no retry, bare expect): RED, bare, no job row.**

```
    Expected: "complete"
    Received: "failed"
Tests:       1 failed, 1 passed, 2 total
```

(`grep -c 'job row'` on the whole base probe log: **0**.)

**FIXED logic, probe run 1 (naive single-claim retry): RED — the queue
interaction above.** Attempt-1 row was logged, the retry processed the
re-claimed attempt-1 job, and the named failure fired:

```
[diarization] job 1 recording 1 failed (engine_oom): probe forced engine_oom (child died)
[diarization] job 1 recording 1 superseded — stale output discarded
AC-2 diarization job did not complete: result={"outcome":"superseded","output":{…real engine output…}} job row={"id":1,"status":"cancelled","error_class":null,"error_message":null}
Tests:       1 failed, 1 passed, 2 total
```

**FIXED logic, probe run 2 (shipped claim-loop form): GREEN.**

```
[sd05-gate] AC-2 attempt 1 job row: {
  id: 1,
  status: 'failed',
  error_class: 'engine_oom',
  error_message: 'probe forced engine_oom (child died)'
}
[diarization] job 2 recording 1 complete (stitched)
[sd05-gate] attribution correct share = 98.61%
Tests:       2 passed, 2 total   (jest exit 0; AC-4 passed unchanged)
```

Job 2 is the fresh job; it completed and persisted the run row AC-2 reads back.

## Green — shipped suite, fresh-migrated DB, run alone

```
DATABASE_URL + DIARIZATION_INTEGRATION_DB_URL → nova1941_green (fresh, migrate exit 0)
DIARIZATION_WEIGHTS_DIR=$HOME/.cache/rekrut-diarization/weights
npx jest server/__tests__/lib/diarizationEngine.integration.test.js --runInBand --forceExit

[diarization] job 1 recording 1 complete (stitched)
[sd05-gate] attribution correct share = 98.61%
✓ AC-2/AC-3 (3890 ms)   ✓ AC-4 (15 ms)
Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total   (jest exit 0)
```

No retry was needed on the green run (attempt 1 completed). Available RAM at
green-run time was ~2.7 GB (above the 2 GB ops rule). Honest caveat: at
dispatch the VM sat at ~0.5–0.7 GB available; the first probe-(a) base run's
hosting shell died under memory pressure after jest had written its complete
log to disk (the log, including the jest summary, is intact and quoted above).
Later runs executed in a freed window (~2.7–4.5 GB available).

## Regressions — neighbouring lib diarization suites

Same 7 suites run on pristine `origin/dev` (disposable worktree) and on this
branch, `--runInBand`:

| | Before (dev e16208e6f) | After (this branch) |
|---|---|---|
| Suites | 7 passed, 7 total | 7 passed, 7 total |
| Tests | 120 passed, 120 total | 120 passed, 120 total |

Suites: `diarizationEngine.test.js`, `diarizationFence-1916.test.js`,
`diarizationFlag.test.js`, `diarizationGate.test.js`, `diarizationJobs.test.js`,
`diarizationPinning-1907.test.js`, `diarizationWorker.test.js`.

## Specialist Reviews

- **ecc silent-failure-hunter (applied in-line by Nova, per STOP 1):** the
  bare outcome assertion was the silent-failure pattern — it destroyed the
  only evidence (the job row) by letting teardown cascade-delete it. Fix
  captures and logs the row in-test and fails with a named, row-carrying
  error; the retry is non-silent (attempt 1's row is always logged first).
  No other silent-failure surface exists in this file: AC-4 already asserts
  the persisted row directly.
- **ecc e2e-runner (applied in-line by Nova, per STOP 1):** the suite remains
  a real-path gate — retry re-runs the real engine through the real worker on
  a fresh job (probe (b) run 2: job 2 `complete (stitched)`, 98.61%); the
  AC-3 scoping narrows only the git comparison, and probe (a) proves a
  `workers/` artefact still fails it. No mocks were added anywhere.

— Nova
