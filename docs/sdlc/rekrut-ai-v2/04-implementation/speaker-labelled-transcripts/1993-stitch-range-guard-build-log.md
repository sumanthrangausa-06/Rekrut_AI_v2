# #1993 — transcriptStitch int4 range guard (build log)

Story: #1993 (follow-up flagged by the independent reviewer on
PR #1992 / #1934, concurred by Nova + Suga; deliberately not
scope-grown into the #1934 lane). STOP 1: issue #1993 comment
6514530604, **corrected by comment 6514650973** (see "Correction"
below — the correction is part of this lane's record, not an
embarrassment to bury). Base: dev `4325e4ad0`.

## Correction (read this first)

The STOP 1 as first posted misattributed Rex's verdict: Nova relied
on a report presented as Rex → Option A (throw); Rex's actual
recorded verdict, verified first-hand after the first head was
built, was **Option B**, and Lead's was also B. The first head of
PR #1994 (`1ab8277e2`) implemented A and was APPROVED by an
independent reviewer against the STOP 1 as posted. On discovery,
Nova posted the correction on #1993 (6514650973), reworked the PR
to the actually-discussed Option B, re-captured red-first evidence
for B, and obtained a fresh independent review of the new head.
The A-head evidence is preserved in the history section below; it
is not the shipped behaviour.

## The discussed decision (as actually held)

Failure mode for an out-of-range speaker at the per-segment
`speaker_number` write:

- **Option B (settled, unanimous among voting personas) —
  not-assignable.** A turn whose speaker is outside
  `[0, INT4_MAX]` joins the existing not-assignable class (sub-floor
  turns, ties, no-overlap): retained verbatim in
  `diarization_runs.turns`, never wins a segment, segment stays
  NULL, stitch completes. Implemented as a turn-level filter in
  `assignSpeakers` (Rex's shape), not a per-segment check.
- **Option A — throw** (extend the AC-5 non-integer throw to the
  range class). Not settled. Its strongest argument (AC-5 was
  authored on this write) was answered by Rex: AC-5's throw is
  narrower — a fractional speaker has no honest integer rendering,
  while an out-of-range integer needs no invention, NULL is the
  rendering — and the non-integer throw **stays untouched** under B
  (still reachable: `assignSpeakers` passes fractional speakers
  through, the persist loop throws, AC-5 test unmodified).

Rex's further reasons for B: consistency inside one transaction
(`computeProposal` already skips out-of-range; today a negative
speaker gets no mapping row yet persists on segments — an orphan
"Speaker -1" with no FR-D10 correction row; B eliminates the
orphan); verbatim retention (§3.6.4) survives under B, while a
throw rolls the run row back too; a throw is a poison pill for
deterministic engine output. Lead's reasons: the issue's "same
contract" is `computeProposal`'s skip, and the #1934 probe's
accepted end-state was outcome `complete`. Recorded caveat
(Rex): all-turns-out-of-range completes with zero labels —
observability note only, no new threshold without a PRD call.

`INT4_MAX` is **reused from `lib/speakerMapping.js`**:
`transcriptStitch.js` already requires that module (L27) and
`speakerMapping` does not require it back — no cycle, one contract
definition for both int4 writes.

## What changed (shipped, Option B)

- `lib/transcriptStitch.js` — `assignSpeakers` gains one filter in
  the existing usable-turns pipeline, alongside the sub-floor
  filter: turns with `speaker < 0 || speaker > speakerMapping.INT4_MAX`
  are not assignable. The persist loop (including the AC-5
  non-integer throw) is **unchanged**. No migration
  (`speaker_number` is already int4, migration 296), no
  scoring/matching/screening imports (BR-12).
- `server/__tests__/lib/transcriptStitch.test.js` — 4 new pure
  cases: negative cannot label, >INT4_MAX cannot label, an
  out-of-range turn never steals a segment from a valid overlapping
  turn, INT4_MAX boundary labels exactly.
- `server/__tests__/lib/transcriptStitch.integration.test.js` —
  3 new cases: negative winner (segment NULL, stitch completes,
  run retained verbatim, mappings exactly `[0]`, recording + job
  `complete`), >INT4_MAX winner (same shape, no raw PG failure),
  INT4_MAX boundary (completes, persists `2147483647` exactly).

## Evidence (HL-003 / HL-007) — shipped behaviour

- **Red first for B (base lib `4325e4ad0`):** 5 failed / 17 passed
  across `transcriptStitch.test.js` + `transcriptStitch.integration.test.js`
  — exactly the 3 new unit cases (negative, >INT4_MAX, steal) and
  both new integration cases (on base, the negative segment
  persists `-1`; the >INT4_MAX stitch rejects with the raw PG
  error). Boundary pins passed on base as designed.
- **Green (fresh DB `nova1993_final`, PG 18.6 @127.0.0.1:55436,
  `node migrate.js` exit 0):** 4 suites, **76/76 PASS** —
  `transcriptStitch.integration.test.js` (9, incl. the normal 0/1
  AC-1/AC-5 case persisting exactly and the unmodified fractional
  AC-5 rollback case), `transcriptStitch.test.js`,
  `speakerMapping.test.js`, `diarizationWorker.test.js`. All
  integration assertions read back from the DB.
- **BR-12 fence:** `diarizationFence-1916.test.js` — both direction
  tests PASS; the suite's other 2 failures are identical on
  untouched base (pre-existing allowlist drift, as in the #1934
  build log).
- Rig note: the shared `/home/pguser` PG is absent on this VM;
  this lane rebuilt a fresh PG 18.6 cluster from
  `~/workspace/pgfull` under `/var/tmp/pg1993` on port 55436 and
  verified it with a `migrate.js` run (exit 0) before trusting it.

## History — the Option A head (superseded, not shipped)

First head `1ab8277e2` added a range throw in the persist loop.
Its evidence was real for that behaviour: red on base (negative
resolved `{outcome:'complete'}`; >INT4_MAX rejected with the raw
PG message), green 9/9 integration + 63/63 unit on fresh DB
`nova1993_green` (migrate exit 0), independent review APPROVE
(PR #1994 comment 6514606642). It was superseded solely because
the STOP 1 settlement it implemented rested on the misattributed
Rex verdict described above.

## Documentation

One-point defect fix: the STOP 1 + correction + this build log
satisfies the documentation rule (no user-visible behaviour change
beyond corrupt-output handling — a segment that would have carried
a meaningless `-1` label, or killed the whole stitch, now renders
unlabelled). This log is included because the #1934 lane
(PR #1992) included one.
