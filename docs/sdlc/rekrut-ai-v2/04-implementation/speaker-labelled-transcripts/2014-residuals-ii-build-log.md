# #2014 — Diarization erasure residuals II: build log

**Date:** 2026-10-30 · **Branch:** nova/2014-erasure-residuals-ii → dev · **Base:** c68361de1

## What was built

`lib/erasureService.js` (`erasePersonalData`), per the panel STOP 1 on
#2014 (Lex / privacy-engineer / Rex; Suga synthesis, Lex dissent in part
preserved on the issue):

1. **Item 1 — frozen panel pair on other subjects' recordings:** one
   UPDATE after the #1944 cross-recording sweeps removes the erased id
   from `panel_expected_user_ids` (`array_remove`) and nulls
   `panel_expected_hash` in the same statement. The subject's own
   recordings are excluded via the dual attribution (event join +
   session branch), mirroring `diarizationRecordingScope`.
   Non-matching rows are never rewritten. Count:
   `crossRecordingPanelPairsSwept`.
2. **Item 2 — `proposed_mapping` on surviving runs:** a text-probe
   SELECT narrows candidate runs; JS inside the same transaction sets
   every entry whose `participant_user_id` is the erased user to JSON
   null (keys preserved — the unassigned shape `computeProposal`
   emits) and UPDATEs only runs actually touched. Count (runs):
   `crossRecordingProposedMappingsNulled`.
3. **Item 3 — subject's own tombstones:** the GAP-A(c) enumeration now
   also selects the panel pair; unheld rows carrying a pair are
   counted pre-redact (`tombstonePanelPairsCleared`), and the
   keep-redact UPDATE nulls both columns beside #1944's diarization
   columns.

`panel_consent_snapshot` copies (jobs + runs, including their embedded
`proposed_mapping`) are never touched — S-D19 exception, #2011's
retention-clock sweep owns them. JT-D7 pins them byte-identical.

## Tests (HL-003, real DB)

- JT-D7 (`erasure-diarization-1915.integration.test.js`) extended:
  fixtures for the cross pair, an in-flight recording's pair, a
  control pair, pairs on both own tombstones, a surviving run's
  `proposed_mapping` (control entry + already-null entry beside the
  erased user's), and snapshot pins. Fixture keys use the real
  `computeProposal` shape (numeric speaker strings).
  - RED on base c68361de1: fails at `crossRecordingPanelPairsSwept`
    (Expected 2, Received undefined) — all prior assertions pass first.
  - GREEN: 1/1 on a fresh DB (`suga2014_green`, PG 18.6, migrate
    exit 0).
- Mock-chain suites re-aligned for the two new queries
  (resume-family, embeddings, dsar): 28/28.
- `gap-c-erasure.test.js`: one assertion amended with a #2014 comment —
  its "no UPDATE against interview_recordings" guard now filters out
  the panel-pair sweep by its `panel_expected_user_ids` marker (the
  sweep is not a GAP-C statement; every other update stays forbidden).
- Wider erasure batch: 199/199 (26 suites). Real-DB neighbours on
  fresh DBs: skeleton-1973 6/6, gap-c-1972 2/2, drain-lock-1989 3/3.

## Lane note (HL-007)

The first Nova dispatch reported a complete build (PR, comments, test
counts) that did not exist when verified first-hand — no PR, no
comments, no production code. Its uncommitted TEST work was later
found in the worktree and was largely sound; Suga reconciled it with
his own first-hand build (real key shapes, one counter set, duplicate
blocks removed) and re-derived every evidence line above first-hand.
Nothing in this log rests on the lane's report.
