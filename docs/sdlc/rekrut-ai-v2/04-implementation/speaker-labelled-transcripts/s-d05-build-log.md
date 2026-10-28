# S-D05 Build Log — Engine child process (#1907)

**Story:** S-D05 — Engine child process: pinned Who package, memory-only audio path
**Design:** Architecture §3.4/§3.5, ADR-D01 · **Gate:** synthetic audio only

## What was built

- `lib/diarizationEngine.js` (supervisor): ffmpeg decode via stdout
  pipe → Buffer (no temp file); spawns the per-job child, streams PCM
  (s16le, 16 kHz mono) over stdin, enforces the 15-minute hard
  timeout, and classifies failures (§3.5): `decode_failed`,
  `engine_timeout`, `engine_oom` (child terminated by signal),
  `engine_failed`. Also `provisionWeights()` — spawns the child in
  `--provision` mode so `Who.load()` downloads the pinned HF weights
  and SHA-256-verifies them against the SDK's own manifest.
- `workers/diarization/engine-child.mjs` (child): the only place the
  vendor package loads. Reads PCM from stdin, converts to Float32
  samples in memory, diarizes, prints one turns-JSON line, exits.
  Voice-print embeddings exist only inside this process and die at
  its exit in every outcome (BR-4/BR-5). Writes nothing to disk.
- `workers/diarization/package.json`: pins `@desert-ant-labs/who` at
  exactly `4.2.1` in worker scope (BR-8); the root package.json does
  not carry it — the web service never loads the model. Weights cache
  lives outside the repo (`DIARIZATION_WEIGHTS_DIR` or
  `~/.cache/rekrut-diarization/weights`, BR-9).
- `workers/diarization/index.js`: the S-D04 stub seam now runs the
  real engine (fetch via the same `server/services/livekit.js`
  in-memory paths as the transcribe handler). Behind the write-time
  consent gate it inserts the `diarization_runs` row verbatim (turns,
  `engine_package`, `sdk_version`, `model_version`, `speaker_count`,
  `coverage_end_ms`). It does NOT stitch segment labels or flip
  `diarization_status` to `complete` — that is S-D07's atomic step;
  the recording honestly stays `processing` until then. Engine
  failures fail the job with their class (`diarizationJobs.fail`),
  set the recording status `failed`, and persist nothing partial.
  Worker start provisions the weights cache when enabled.
- SDK telemetry is untouched: no source sets or references the
  telemetry endpoint env (guarded by test, BR-9/AC-5).

## Evidence

- **Red (pristine dev):** the three new/extended suites fail — 10
  tests failed, 13 pre-existing S-D04 tests passed.
- **Unit green:** `diarizationEngine` + `diarizationPinning-1907` +
  `diarizationWorker` — 33/33 (fake-child taxonomy: SIGKILL →
  engine_oom + supervisor survives, timeout → engine_timeout,
  non-zero → engine_failed, malformed → engine_failed, garbage audio
  → decode_failed; run-row insert behind the write gate only;
  pin/telemetry/weights static guards).
- **HL-003 gate (fresh-install DB, local PG rig):** fresh
  `migrate.js` exit 0; `diarizationEngine.integration` — the spike's
  synthetic 121 s fixture through the REAL worker path (real consent
  gate, real ffmpeg, real child, real pinned engine): job complete,
  run row read back with sdk 4.2.1 / model v0.3.4 / 2 speakers,
  **attribution 98.61% correct** on the spike scorer's method
  (≥98% AC-2 bar); repo tree unchanged during the run (AC-3 sweep);
  failure leg persists no run row. `diarizationWorker.integration`
  (S-D04 suite, updated for the real engine) 5/5 on its own fresh DB.
  Note: the two integration suites must run against SEPARATE fresh
  DBs — the claim queue is global and oldest-first.

## Deviations / notes

- The vendor JS API exposes no model-version field; `v0.3.4` is the
  Step-0 measured value for the pinned weights and is recorded as a
  pinned constant (BR-8: any package/weights change must update it).
- S-D04's integration AC-2 asserted stub completion; S-D05 supersedes
  it — a recording with no fetchable audio now fails honestly
  (`engine_failed`, no run row, no labels).
