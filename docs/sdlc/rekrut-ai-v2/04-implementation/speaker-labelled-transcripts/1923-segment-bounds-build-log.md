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
  shape contract (AC-3) is unchanged — the bounds/order cases assert
  the exact response keys, and the response text value is
  intentionally not asserted: by design it remains the provider's
  text (see the divergence note above).

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

- **Red first (base handler `b2a9368f5` in a scratch worktree with
  only the final test file added, fresh DB `sd02_1923_red3`,
  migrate exit 0): 4 failed / 7 passed of 11.** Bounds: stored
  `[2000, 9999000]` plus the ghost `[100000, 101000]` instead of
  `[2000, 12000]` alone. Order: stored id-order starts
  `[6500, 0, 2000]`. All-outside: stored with HTTP 200 instead of
  the honest 500. Tie-break: stored in provider order
  `[2000,6500] [2000,3000]`. Pins A and B **passed on base** — they
  pin existing atomicity and are reported as pins, not fixes. The
  5 shipped cases passed.
- **Green (fresh DB `sd02_1923_final`, migrate exit 0): 11 passed,
  11 total** — all assertions read back from the DB / GET. (An
  earlier 9-case cycle on `sd02_1923_gate` also passed 9/9 before
  the two review-disposition cases below were added.)
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

## Independent review (of head `3a9c8efd1`) — PASS, no BLOCKs

Reviewer: separate subagent (ecc code-reviewer + database-reviewer
lenses), did not write the code. (Correction, 2026-10-30: this
section originally summarised the review from an interim preview
and misstated its findings as five minors M1–M5 with two wrong
evidence details. It is rewritten here from the reviewer's final
report verbatim in substance; the addendum checkpoint comment on
issue #1923 carries the same correction.)

What the reviewer verified first-hand: the transform sits purely
in-memory before `pool.connect()`/`BEGIN`; the diff is exactly
three hunks inside the transcribe handler (the swap transaction,
the second `pool.connect()` speaker-mapping handler, and the GET
handler untouched; exactly 3 files, no migration/flag/§3.2
change); `duration_seconds` is INTEGER (migration 128), so the
`Number.isFinite` guard is sound; pin A genuinely fails
mid-transaction (`end_time_ms = 1e19 > int8 max`, after the four
artefact deletes, the segment delete, and the first insert) and
asserts gen-1 rows byte-identical including ids; the NULL-duration
rationale is sound (with a known duration the clamp makes the
probe untestable); the `beforeEach` circuit-breaker reset is the
provider's own testing hook on the same singleton and masks no
asserted behaviour. Its own re-runs on fresh DBs it created
(migrate exit 0 both): head on `rev1923_gate` — **9 passed / 9**;
base handler + head test file on `rev1923_base` — **2 failed /
7 passed**, with the exact defect values from the red claim. It
explicitly did **not** re-run the 172 neighbouring-suite claim and
flagged it as the one unverified claim in the evidence set.

The reviewer's findings were exactly THREE minors, none blocking:

- **MINOR-1 — two settled-design branches had no test:** the
  empty-after-transform 500 branch and a segment starting exactly
  at the duration. Reviewer's disposition: accept as-is; add the
  two cases as a follow-up test-only patch; not a merge blocker.
  Post-review status: the all-outside-payload case WAS added
  (honest 500, nothing stored, recording `completed` — on a fresh
  recording; the branch's old-generation safety is structural,
  pre-`BEGIN`, and was verified by the reviewer's inspection) and
  an equal-start tie-break case was added alongside it; the
  start-exactly-at-duration case and a re-run variant of the
  all-outside case were NOT added and remain follow-up material
  under the reviewer's own non-blocking disposition. Handler code
  is unchanged after the review; only tests were added (commit
  `7f87149c8`).
- **MINOR-2 — this log overstated the response-contract
  assertions** (only the response shape keys are asserted, in the
  bounds/order cases; the text value is never asserted, correctly
  by design). Disposition: the sentence is corrected in this log
  (see "Lead conditions adopted" above).
- **MINOR-3 — the handler comment overclaims GET tie-order
  coherence** (GET orders by `start_time_ms` alone; equal-start
  tie order vs insertion order is not guaranteed). The comment is
  left as-is in this PR; the substance is the same point as Rex's
  unimplemented `ORDER BY start_time_ms, id` complement, which is
  flagged for Suga's ruling in the run report (it crosses Lead's
  GET scope line for this lane). Comment-precision only; no
  behaviour impact.

One further post-review test change, NOT a reviewer finding: pin
A now reads the recording row back and asserts `duration_seconds`
IS NULL (the configuration the pin depends on), added from the
STOP 1 design discussion.

Also flagged for Suga from the STOP 1 specialists' full texts
(post-dating this PR's STOP 1, recorded in the run report): the
database/transactions specialist's full position prescribes
reject-whole (not drop) for fully-outside segments, a rebuild of
the response text from the sorted join (which it labels BLOCK;
Rex and Lead both hold the opposite — no `whisperResult.text`
change), an unknown-duration BIGINT range guard, and a
trigger-based forced-failure pin as a more future-proof
alternative to the overflow pin. The shipped design follows Rex +
Lead on each; Suga is the tie-breaker at the gate.
