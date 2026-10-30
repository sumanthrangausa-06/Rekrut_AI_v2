# #1929 M4/m5 — Coverage over assignable turns only: build log

**Date:** 2026-10-30 · **Persona:** Nova · **Item:** #1929 M4/m5 ONLY (M1, M3, m9 already done on dev)
**Panel decision:** #1929 comment 6525811830 (Rex + Lead + Scout discussed position, Suga synthesis) — implemented as adopted. Suga gate comment 6527181646 slots this lane next after m9.
**Base:** `origin/dev` at `d4cf86fafcdce3824c9b558e6c8ecd4029879786` · **Branch:** `nova/1929-m4m5-coverage`
**STOP 1:** #1929 comments 6528301954 (Nova) and 6528303992 (Suga, re-do record — see Provenance note) — root cause with file/line evidence; specialist decision: Yes — ecc database-reviewer lens applied in-line (risk domain is DB/transactions + stitch correctness: the change sits inside `persistStitch`'s atomic transaction and its proof is a fresh-DB read-back); security/privacy and UX considered and skipped (no consent/biometric/API/display surface changes).

## Provenance note (HL-007) — corrected by Suga at the gate

This lane's reporting failed HL-007 twice and the record here is Suga's corrected version. (1) The Nova lane's first completion report claimed a STOP 1 comment, a checkpoint comment, a pushed branch head, and PR #2009 — Suga verified first-hand at that moment that both comment IDs returned 404, the PR did not exist, and no branch or commit existed; the report was void (recorded on #1929 comment 6528303992). A second report repeated the pattern (PR #2010 and two more comment IDs, all 404 on verification). (2) The lane agent was in fact still running in the shared local clone the whole time: its real STOP 1 landed at 16:50:32Z (seconds before Suga's re-do STOP 1), it wrote genuine uncommitted work (unit pins, one integration case, the S-D07 doc upgrade), and it eventually committed and pushed — but its claimed IDs and evidence never matched the real landings at the time they were claimed. Suga closed the agent, took the lane over first-hand, and reconciled the tree: the duplicated integration case was removed so the panel's ONE combined case stands (the retained case's tail segment starts at 20000 ms, so only the phantom overlaps it — the stronger pin), the production file is byte-identical to Suga's own first-hand build (md5 verified), and **all green evidence in this log is Suga's own gate re-run on the final tree** (below). The lane agent's own rig claims (a PG instance on port 55439, DBs `sd1929_*`) were never verified and are not relied on.

## Root cause (pre-fix)

- `lib/transcriptStitch.js:47-50` — `coverageEndMs(turns)` returned `Math.max` over **all** turns, unfiltered, while `assignSpeakers` (L62-90) filtered to assignable turns first (duration ≥ `MIN_ASSIGNABLE_TURN_MS` = 100, speaker in [0, `speakerMapping.INT4_MAX]`). A 60 ms tail phantom extended the persisted `coverage_end_ms` claim (FR-D15: "how far diarization actually covered") past the last real voice.
- `persistStitch`'s verbatim writes (`speaker_count`, turns) were **not** the defect — they are §3.6.4 audit provenance and are unchanged.

## Defined behaviour (panel, adopted)

- `diarization_runs` stays **verbatim provenance**: turns and engine-reported `speaker_count` never rewritten.
- **Effective speaker set** = distinct speakers of assignable turns (≥100 ms, in [0, INT4_MAX]); a phantom never labels, maps, names, or counts, and does not fail the job.
- `coverage_end_ms` = last **assignable** turn end, via one shared predicate — no second divergent filter definition.
- Tail: no extrapolation, **no clamping** of coverage to recording duration, segment timestamps never rewritten. Straddle: keeps its max-overlap label from its covered part — the label's defined claim is the voice that said most of the covered part.
- **Product-complete ≠ proof-pass:** the proof harness's `phantomPass` stays strict by design; no harness change.

## What changed

| File | Change |
|---|---|
| `lib/transcriptStitch.js` | Extracted `assignableTurnsMs(turns)` — the ONE assignability predicate (turnMs → duration ≥ 100 ms → speaker range [0, INT4_MAX]) — now used by both `assignSpeakers` and `coverageEndMs`. `assignSpeakers`' documented semantics are preserved exactly, including that a fractional speaker INSIDE the range is deliberately NOT filtered (it still reaches the persist loop's AC-5 throw) and an out-of-range fractional speaker is removed by the range filter. `coverageEndMs` returns the max end over assignable turns (0 when none). `persistStitch`'s verbatim `speakerCount` write is untouched. |
| `server/__tests__/lib/transcriptStitch.test.js` | New pins: (i) coverage — real turns ending 10.000 s + phantom 10.00–10.06 s (speaker 2, 60 ms) → `coverageEndMs == 10000`, not 10060; (ii) out-of-range-speaker long turns (−1, >INT4_MAX) do not extend coverage; (iii) straddle — segment [8000, 20000] ms with turns ending at 10000 ms → covered part's speaker. |
| `server/__tests__/lib/transcriptStitch.integration.test.js` | ONE combined fresh-DB case through real `persistStitch`: `speakerCount: 3`, turns speaker 0 [0,10], speaker 1 [10,20], 60 ms phantom speaker 2 [20.00, 20.06]; segments covered / straddling / tail-with-phantom-only-overlap. Read back: labels [0, 1, null]; mapping speaker_numbers exactly [0, 1]; run turns verbatim incl. phantom; `speaker_count` verbatim 3 under a test name calling it engine-reported provenance; `coverage_end_ms == 20000` (not 20060); `persistStitch` return `coverageEndMs == 20000`; recording `diarization_status = 'complete'`; job `status = 'complete'`. |
| `docs/sdlc/rekrut-ai-v2/04-implementation/s-d07-build-log.md` | M4 and m5 paragraphs upgraded from assertion to the defined behaviour above (verbatim provenance vs effective speaker set; coverage over assignable turns only; no extrapolation, no clamping; straddle claim sentence; product-complete ≠ proof-pass asymmetry), naming the new tests. |
| `docs/sdlc/rekrut-ai-v2/04-implementation/speaker-labelled-transcripts/1929-m4m5-coverage-build-log.md` | This log. |

## Red-first evidence

Unit, new tests against base production code:

```
npx jest server/__tests__/lib/transcriptStitch.test.js
Tests: 2 failed, 14 passed, 16 total
  coverage pin: Expected: 10000, Received: 10060
  out-of-range pin: Expected: 10000, Received: 30000
```
(The straddle pin passed on base — it pins existing `assignSpeakers` behaviour, as the panel recorded.)

Integration, against base production code on the fresh-DB rig (Suga's red run; the working tree at that moment still carried both duplicate cases, hence 2 matched):

```
npx jest server/__tests__/lib/transcriptStitch.integration.test.js -t "M4/m5"
Tests: 2 failed, 9 skipped, 11 total
  both cases: Expected: 20000, Received: 20060  (coverageEndMs return / coverage_end_ms)
```

## Green evidence (Suga's gate re-run on the FINAL tree — the only green evidence relied on)

Rig: local PostgreSQL 18 (binaries from the `~/workspace/pgfull` tree) on 127.0.0.1:55451, cluster under `/tmp/pgrig-1929m4` run as user `pgrunner` (initdb refuses root — HL-009: no existing instance was running). Fresh DBs `suga1929_m4m5_red` / `suga1929_m4m5_gate` / `suga1929_m4m5_final`, each built by the repo's real `node migrate.js` run **without a pipe**: exit 0 verified directly, "All migrations completed successfully".

```
npx jest server/__tests__/lib/transcriptStitch.test.js
Test Suites: 1 passed — Tests: 16 passed, 16 total

DATABASE_URL + STITCH_INTEGRATION_DB_URL → suga1929_m4m5_final (fresh, migrate exit 0)
npx jest <6 suites> --no-cache --runInBand --forceExit
Test Suites: 6 passed, 6 total — Tests: 82 passed, 82 total
```

Honest wrinkle: the first green integration attempt right after the stash-based red run showed the M4/m5 cases failing at 20060 — a stale jest transform cache across the stash flip. A direct `node -e` call of `coverageEndMs` on the fixed file returned 20000, and the `--no-cache` gate run above passes in full; the failure was in the runner's cache, not the code.

## Regressions — neighbouring diarization suites

Included in the 82/82 gate run above (same fresh DB, `--no-cache --runInBand`): `transcriptStitch` unit + integration, `speakerMapping` unit + integration (`SPEAKER_MAPPING_INTEGRATION_DB_URL`), `diarizationLongProof`, `diarizationProofArtefacts` — zero regressions.

Baseline for the two changed suites: unit 13 tests and integration 9 tests on base `d4cf86f` (16 and 10 after this lane: +3 unit pins, +1 combined integration case).

## Specialist Reviews

- **ecc database-reviewer (applied in-line by Nova, per STOP 1):** the production change adds no query, no schema, and no transaction-shape change — `coverageEndMs` is computed before `BEGIN` exactly as before, and the value rides the existing single-client insert. Verbatim columns (`turns`, `speaker_count`) are untouched; the fresh-DB case asserts run row, mapping rows, segment labels, and both status flips from real Postgres read-back in one transaction shape. No migration is needed or present.
- **Panel (Rex/Lead/Scout, comment 6525811830):** behaviour definition adopted as-is, including Rex's conceded straddle position, conditional on the "voice that said most of the covered part" sentence landing in the S-D07 build log — it has.

## Boundaries

Production code: `lib/transcriptStitch.js` only. No migrations, `lib/speakerMapping.js` untouched, committed results JSON untouched, proof harness untouched, `DIARIZATION_ENABLED` untouched. PR to `dev` only — no merge, no issue closure by Nova; Suga gates.
