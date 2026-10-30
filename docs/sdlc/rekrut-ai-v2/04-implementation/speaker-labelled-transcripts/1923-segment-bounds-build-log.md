# #1923 — Segment bounds/order hardening + rollback regression pin (build log)

Story: #1923 [FOLLOW-UP] from the independent review of PR #1922
(S-D02, #1904) — PASS with 3 minors; this lane closes all three.
STOP 1: issue #1923 comment 6516053016 (posted before any code).
Base: dev `b2a9368f5`. Branch: `nova/1923-segment-bounds`. PR to dev
only; no merge/closure by Nova — Suga gates.

## Root cause

The S-D02 transcribe handler (`server/routes/recordings.js`,
`POST /:id/transcribe`) inserted `whisperResult.segments` verbatim —
`Math.round(seg.start_s*1000)` / `Math.round(seg.end_s*1000)`, in
array order — with no reference to `recording.duration_seconds`,
which the handler already loads. The S-D01 normalizer
(`lib/ai-provider.js`, design §3.2) guarantees only finite / ≥0 /
`end ≥ start` and deliberately trusts provider order at its layer;
nothing downstream bounded or ordered. The shipped real-DB suite
also had no forced mid-transaction failure case, so the AC-2/AC-4
atomicity the #1922 reviewer proved by hand had no permanent pin.

## Discussed decision (STOP 1, HL-004 — not a solo call)

Consulted before STOP 1: a database/transactions specialist (ecc
database-reviewer lens), Rex (architecture), Lead (planning fit).

- **Bounds — clamp straddlers, drop fully-outside, never reject
  whole (settled).** Rex: a straddling segment's end clamps to the
  duration (the words happened; only the endpoint claim is
  impossible — the `recordedConfidence` sanitising class); a segment
  starting at/after the duration would clamp to a zero-span row and
  read paths assume `end > start`, so it is dropped. DB specialist:
  clamp, never drop a segment whose start is in-bounds (silent word
  loss + breaks the normalizer's stored-join invariant); honest-fail
  only if nothing survives. Recorded dissent (DB specialist,
  "never drop") is answered by the zero-span point: a fully-outside
  segment's words have no honest timestamp, and the drop is logged
  (`console.warn` with count), never silent.
- **No duration → no bound (DB specialist).** `duration_seconds`
  NULL/0/non-positive: no honest bound exists; bounding is skipped,
  sorting still applies.
- **Order — stable sort at store time (Rex).** Sort by
  `(startMs, endMs, providerIndex)` in the handler: a handler-layer
  complement to §3.2, not a reopening (the normalizer's join
  invariant is layer-local; storage's contract is chronological).
  Rex's caveat recorded: for an unsorted payload the stored join is
  chronological and can differ from the provider-ordered one-time
  response text — stored/GET coherence is the durable contract.
- **Lead conditions adopted:** the drop divergence (stored join vs
  the one-time response text, when a text-bearing fully-outside
  segment is dropped) is named in STOP 1, logged at runtime, and
  pinned by the bounds test's stored-state assertions; the response
  shape/text contract (AC-3) is unchanged and re-asserted in every
  new test.

## What changed

- `server/routes/recordings.js` — transcribe handler only. After the
  existing segment-less check and **before** `pool.connect()`/`BEGIN`
  (pure in-memory transform; the swap transaction, its delete order
  and its rollback are byte-unchanged): compute `durationMs` from
  `recording.duration_seconds` (positive finite only, else null);
  drop segments with `startMs >= durationMs` (counted, warned);
  clamp `endMs = min(endMs, durationMs)`; stable-sort by
  `(startMs, endMs, providerIndex)`. If a non-empty payload becomes
  empty, fail honestly exactly like an ASR failure (status reset to
  `completed`, HTTP 500) — before anything is deleted, so the old
  generation is untouched. The insert loop consumes the transformed
  `{seg, startMs, endMs}` entries; nothing else in the handler moves.
  A provider-native zero-span segment *inside* the duration is the
  normalizer's existing contract and is unchanged (scope note from
  STOP 1). No migration; `lib/ai-provider.js` untouched (§3.2
  stands); GET handler untouched; `DIARIZATION_ENABLED` untouched.
- `server/__tests__/routes/recordings-segments-realdb-1904.test.js`
  — 4 new cases in the shipped suite (fixtures + modes `bounds`,
  `unsorted`, `overflow`; `seedRecording` gains a duration argument,
  default 12, NULL allowed):
  1. **bounds** — 12s recording, segments `0→2s`, `2→9999s`,
     `100→101s`: stored read-back is exactly `[0,2000] [2000,12000]`,
     no end > 12000, GET join is the in-bounds text.
  2. **order** — GEN1's segments delivered unsorted: stored read-back
     `ORDER BY id` (insertion order; `interview_transcripts.id` is a
     serial) is `[0, 2000, 6500]`, GET text chronological.
  3. **pin A (rollback)** — gen-1 + planted diarization artefacts on
     a `duration_seconds = NULL` recording, re-run with a segment
     whose `end_s = 1e16` (`end_time_ms = 1e19` overflows int8 inside
     the transaction, after the deletes and the first insert):
     HTTP 500, gen-1 segments byte-identical, all 4 artefact tables
     intact, `diarization_status='complete'`, recording `completed`.
     The NULL duration is load-bearing and commented in the test:
     with a known duration the new bound clamps that segment to
     12000ms before insert and the overflow can never reach Postgres
     — the fix working as designed; the reviewer's original probe
     ran on the pre-fix handler.
  4. **pin B (re-run failure preservation)** — re-run with all ASR
     legs failing: HTTP 500, existing generation byte-identical.
  - Suite harness note: a `beforeEach` resets the ASR provider's
    circuit breakers via the provider's own testing hook
    (`resetCircuitBreakers()`, same exported singleton
    `lib/polsia-ai` delegates to). A leg failure opens a 5-minute
    circuit (#1430), which poisoned every later journey step once
    the new cases followed the shipped AC-4 failure case (first
    red run: all 4 new cases failed 500 at their *first* transcribe
    for this reason alone). The provider is a stubbed external
    boundary in this suite; its breaker is boundary health state,
    reset between steps like `asrMode` itself.

## Evidence (HL-003 / HL-007)

Rig: local PostgreSQL **18.6** on 127.0.0.1:55437 (tree copied from
`~/workspace/pgfull` to `/var/tmp/pg1923-root`, data
`/var/tmp/pg1923-data`, server run as uid 65534 via setpriv — the
nobody uid cannot traverse `~/workspace` on this VM). Fresh
databases per phase; the repo's real `node migrate.js`: **exit 0**,
"All migrations completed successfully" (both runs).

- **Red first (base handler `b2a9368f5`, fresh DB
  `sd02_1923_base`): 2 failed / 7 passed of 9.** Bounds: stored
  `[2000, 9999000]` plus the ghost `[100000, 101000]` instead of
  `[2000, 12000]` alone. Order: stored id-order starts
  `[6500, 0, 2000]`. Pins A and B **passed on base** — they pin
  existing atomicity and are reported as pins, not fixes. The 5
  shipped cases passed.
- **Green (fresh DB `sd02_1923_gate`, migrate exit 0): 9 passed,
  9 total** — all assertions read back from the DB / GET.
- **Regressions (gate DB + mocked batch): 172 passed, 0 failed** —
  mocked/unit: recordings-transcribe-claim,
  recordings-whisper-confidence-1619, recordings-encryption,
  recordings-purged-sentinel, recordings-session,
  ai-provider-segment-contract-1903 (S-D01), diarizationJobs
  (7 suites, 70 tests); real-DB neighbours:
  recordings-transcript-composition-1911 (SD09, 14),
  recordings-candidate-parity-1913 (SD11, 5),
  recordings-speaker-mapping-1912 (SD10, 12),
  recordings-journey-1918 (SD16, 4),
  recordings-session-detail-1938 (5), transcriptStitch unit +
  integration (22), diarizationWorker unit + integration (33),
  diarizationFence-1916 (7).

## Boundaries held

No migration; no staging/main contact; `RETENTION_PURGE_LIVE`
untouched; `DIARIZATION_ENABLED` stays OFF; no email/outreach.
