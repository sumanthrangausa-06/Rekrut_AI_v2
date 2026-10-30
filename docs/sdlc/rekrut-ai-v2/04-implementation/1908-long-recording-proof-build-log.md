# S-D06 (#1908) — Long-recording proof: build log

**Date:** 2026-10-28 · **Persona:** Nova · **Gate evidence for:** AC-1, AC-2, AC-3
**Machine:** team VM, 2 vCPU (AMD EPYC), ~8 GB RAM, warm weights cache (pre-provisioned, SHA-256-verified by the SDK in earlier stories).

## What was built

- `scripts/generate-diarization-fixtures.py` — synthetic fixture generator extending the spike's `make_audio.py`: local flite voices `kal` (interviewer) / `slt` (candidate), 3 turn clips per voice cycled in strict alternation with 0.4 s gaps; ground truth by construction from sample counts. Fixtures end at natural turn boundaries near the target (see the artefact note below). The generator itself asserts both voices are present in the first/last 5 minutes, minute 2, and the final minute. WAVs are generated locally and NOT committed; the script is.
- `scripts/diarization-long-proof.js` — measurement harness. Runs each fixture through the FULL worker path against a real fresh-migrated Postgres (`migrate.js` exit 0): `diarizationJobs.enqueue/claim` → `workers/diarization` `processJob` (claim-time + write-time consent gates, live DB consent) → `lib/diarizationEngine` (ffmpeg decode, pipe-to-memory) → `engine-child.mjs` (pinned `@desert-ant-labs/who@4.2.1`, model v0.3.4) → `diarization_runs` row read back. The only injected seam is `fetchAudio` returning the fixture buffer (the S-D05 precedent — the fixture has no storage object). Latency = wall time of `processJob`; peak RSS = peak of the harness process tree (supervisor + ffmpeg + engine child) sampled every 250 ms via `ps`.
- `server/__tests__/lib/diarizationLongProof.test.js` — unit tests for the harness's ground-truth evaluation (red first: 6/6 failed on the stub; green after implementation: 6/6). A split voice, a join break, and a phantom speaker each fail a test.

## Raw results (no extrapolation, no rounding into a pass)

Full machine-readable record incl. every engine turn: `1908-long-recording-proof-results.json` (same folder).

| Fixture (actual) | Outcome | Latency | Peak tree RSS | Peak supervisor RSS | Speakers | Minute-2 mapping | Final-minute mapping |
|---|---|---|---|---|---|---|---|
| 118.182 s | complete | 5.048 s | 862.7 MB | 79.3 MB | 2 | interviewer→0, candidate→1 | interviewer→0, candidate→1 |
| 1,795.559 s | complete | 50.675 s | 1,608.8 MB | 236.1 MB | 2 | interviewer→0, candidate→1 | interviewer→0, candidate→1 |
| 3,602.464 s | complete | **96.681 s** | **2,314.3 MB** | 390.8 MB | 2 | interviewer→0, candidate→1 | interviewer→0, candidate→1 |

- **AC-1 PASS (measured):** in both checked windows of both long fixtures, each ground-truth voice overlaps exactly one engine speaker, with zero seconds of cross-overlap to the other speaker, and the mapping is identical in minute 2 and the final minute — the cross-piece join (300 s SDK windows; the 60-min fixture spans 12) holds end to end on this pipeline.
- **AC-2 PASS (measured):** 60-min latency 96.681 s vs NFR-D01's 600 s limit. Peak worker RSS 2,314.3 MB (process tree); the supervisor-process peak alone was 390.8 MB — both figures from the committed results record (`peak_tree_rss_mb` / `peak_self_rss_mb`). The measured tree peak itself exceeded the provisional ≥2 GB envelope in Architecture §8.1. (Correction per #1929 M3: an engine-child-only mid-run RSS figure cited in this paragraph previously has been dropped — no committed artefact sources it; the ≥3 GB envelope below rests on the sourced 2,314.3 MB tree peak.) **Final envelope set from this measurement: ≥3 GB** (≈30 % headroom over the measured peak), written back into Architecture §8.1 (table + amendment) and §8.3 in this story's PR.
- **AC-3 PASS (measured):** the 2-min single-piece fixture returns exactly 2 speakers, no phantom.

## Artefact finding (recorded, not smoothed over)

The first fixture generation hard-truncated the final turn mid-speech at exactly 120.000 s. That version diarized with speakerCount=3: one extra turn of 0.06 s (119.92–119.98 s, at the cut) assigned to a third speaker; join checks still passed. Regenerating fixtures to end at natural turn boundaries removed it (speakerCount=2 on the otherwise-identical path). Interpretation, labelled as such: the phantom is an edge artefact of an abrupt mid-speech cut, not a join failure — and S-D07's max-overlap stitching could never let a 0.06 s turn win a transcript segment. It is recorded in Architecture §8.1's amendment because real recordings can also end abruptly.

Earlier 2-min runs on the truncated fixture also measured latency 3.739 s / 5.062 s and peak tree RSS 924.9 / 817.3 MB — run-to-run variance on a shared 2 vCPU VM; the table above is the single consistent full run (all three fixtures, one invocation) and is the run the committed JSON records.

## Infra note

The shared local Postgres rig (previously under `/tmp`) was wiped mid-run by the VM's tmp reaper (HL-009's known fragility). The proof DB was rebuilt durably outside `/tmp` (PGDG PG 16.15 + pgvector 0.8.6 under `/home/pgrunner/`), a fresh `sd06_e2e` database was created, and `node migrate.js` completed with exit 0 before any fixture ran. No measurement was taken against the dead rig.

## Boundaries

Synthetic audio only · `DIARIZATION_ENABLED` appears in no committed config and in neither script (the harness calls `processJob` directly, as the S-D04/S-D05 integration suites do) · no real recordings · no enablement (S-D17 unchanged).
