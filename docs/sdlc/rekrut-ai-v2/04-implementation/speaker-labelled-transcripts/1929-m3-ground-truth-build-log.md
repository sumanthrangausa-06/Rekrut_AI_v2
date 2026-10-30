# #1929 M3 — Committed ground truth + unsourced figure dropped: build log

**Date:** 2026-10-30 · **Persona:** Nova · **Scope:** #1929 item M3 ONLY (M1 already done, PR #2005; M4/m5 and the m9 window definitions untouched — evaluator window logic in `scripts/diarization-long-proof.js` unchanged, imported by the new test only)
**Base:** `origin/dev` `6e3b5c143b8fef8ab97336d3141e3bfc582f0cc2` · **Branch:** `nova/1929-m3-ground-truth`

## What M3 required

1. Commit the fixtures' ground-truth JSONs alongside the S-D06 (#1908) results record, so AC-1 is recomputable from committed artefacts alone.
2. Either source the "engine child 1,922 MB mid-run" figure in a committed artefact or drop it from the docs.

## Root cause

The ground truth was generated locally during the #1908 proof and never committed — only the generator script and the results record landed. The 1,922 MB child-only figure was recorded in prose (the #1908 build log's AC-2 paragraph and Architecture §8.1's S-D06 amendment) but never in the committed results JSON, which sources only the tree and supervisor-self peaks; it cannot be retro-sourced honestly, so it is **dropped**, not re-asserted.

## Ground truth: regeneration + durations gate

Regenerated with the committed deterministic generator (`python3 scripts/generate-diarization-fixtures.py --out-dir /var/tmp/gt1929m3`). Gate: every generated duration must equal the results record exactly — a mismatch would have stopped the lane with no GT committed. **All three matched:**

| Fixture | Generated duration (s) | Recorded duration (s) | Match | GT turns |
|---|---|---|---|---|
| 2min | 118.182 | 118.182 | exact | 9 |
| 30min | 1795.559 | 1795.559 | exact | 134 |
| 60min | 3602.464 | 3602.464 | exact | 269 |

Committed at `docs/sdlc/rekrut-ai-v2/04-implementation/1908-fixtures-ground-truth/diarization-{2min,30min,60min}.ground-truth.json` (alongside the results record in `04-implementation/`). The WAVs themselves are proof inputs and remain uncommitted, per the generator's own header.

**One-field normalisation (the only change to the generated files):** the generator writes `"file"` as an absolute local WAV path (e.g. `/var/tmp/gt1929m3/diarization-2min.wav`); the committed copies carry just the WAV basename (`diarization-2min.wav`). Verified mechanically: `diff` between each generated GT and its committed copy shows exactly one changed line — the `file` line. Every other field is byte-identical to the generated ground truth.

## Recomputability proof (red first, then green)

New test: `server/__tests__/lib/diarizationProofArtefacts.test.js`. For each fixture it loads the committed results JSON + the committed GT JSON, re-runs `evaluateFixture(gt, {speakerCount, turns})` (the recorded run's `speakerCount` is preserved in its recorded evaluation, which `evaluateFixture` echoes; `turns` are the recorded engine turns), and asserts `joinPass`, `phantomPass`, `mappingMinute2` and `mappingFinalMinute` equal the recorded evaluation.

- **RED (before the GT files landed):** `npx jest server/__tests__/lib/diarizationProofArtefacts.test.js --forceExit` → **3 failed, 3 total** — every test failed with `ENOENT` on its missing `1908-fixtures-ground-truth/*.ground-truth.json` file. That failure IS the M3 defect: AC-1 was not recomputable from committed artefacts.
- **GREEN (after):** same command → **3 passed, 3 total**. AC-1 now recomputes exactly from committed files alone, under the current (M1-hardened) evaluator.
- **No regression:** `npx jest server/__tests__/lib/diarizationLongProof.test.js --forceExit` → **11 passed, 11 total**.

## The 1,922 MB figure: disposition — DROPPED

- `docs/sdlc/rekrut-ai-v2/04-implementation/1908-long-recording-proof-build-log.md` (AC-2 paragraph): the child-only sentence is replaced with the sourced peaks from the committed results record (60-min fixture: `peak_tree_rss_mb` 2,314.3, `peak_self_rss_mb` 390.8) plus a correction note recording the drop and its reason.
- `docs/sdlc/rekrut-ai-v2/03-solutioning/speaker-labelled-transcripts/architecture.md` (§8.1 S-D06 amendment): the table cell's child-only mention is replaced the same way, and the following paragraph's dependent clause ("the engine child alone passed it mid-run") is removed — the basis sentence now rests on the tree peak alone.
- Repo-wide search of the diarization docs for `1922` / `1,922` after the edits: no remaining occurrence of the figure as a measurement. (Unrelated hits for PR #1922 in the #1923 build log are references to that PR, not this figure, and are untouched.)
- **The ≥3 GB envelope conclusion is unchanged** — it was and is based on the sourced 2,314.3 MB tree peak (≈30 % headroom), never on the dropped child-only figure.

## Boundaries

No production code changes · evaluator logic untouched (test imports it only) · no migrations · `DIARIZATION_ENABLED` untouched · synthetic fixtures only · WAVs not committed · no merge / no issue closure by Nova (PR to `dev` only; independent review + Suga's gate decide).

## Provenance note (Suga gate, 2026-10-30)

The Nova lane's interim report claimed a PR number and a review comment that did not exist when checked first-hand (HL-007 — claimed before landing; the branch push itself was real). Suga therefore re-verified every element of this lane first-hand before gating: GT durations and the one-field `file` normalisation (field-by-field diff vs the regenerated GT), the red run (3/3 ENOENT with the GT directory removed), the green runs (artefacts 3/3 + long-proof 11/11 at the final head), and both doc diffs. The PR, independent review, and merge are Suga's landings, recorded on #1929.
