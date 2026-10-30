# #1929 m9 — Canonical "minute 2" window definition: build log

**Date:** 2026-10-30 · **Persona:** Nova · **Item:** #1929 m9 ONLY (M4/m5 untouched, separate lane)
**Panel decision:** #1929 comment 6525811830 (Rex + Lead + Scout discussed position, Suga synthesis) — implemented as adopted.
**Base:** `origin/dev` at `1e09354e02f341693b3fb0cc632920f4eea35425` · **Branch:** `nova/1929-m9-minute2`
**STOP 1:** #1929 comment 6526976347 (root cause with file/line evidence, specialist decision: No beyond standard review — test-harness/docs only, no production/schema/auth/consent surface; security/database/privacy/UX specialists considered and skipped with reasons).

## Canonical definition

"Minute N" = the 60-second window starting at timestamp N:00 — **[N×60, (N+1)×60) seconds**. Minute 2 = [120,180], minute 28 = [1680,1740], minute 40 = [2400,2460]. Both scripts now cite this definition where the windows are defined.

**Short-fixture rule:** for duration < 180 s, minute 2 does not exist and must not be silently substituted. `evaluateFixture` instead evaluates a distinctly named **early window [60,120]**, recorded under its own key (`earlyWindow` / `mappingEarlyWindow`) — never as unqualified `minute2`. In that case `minute2` / `mappingMinute2` are `null` (not applicable). The join check for a short fixture is computed against the early window under its own name, so the FR-D05 single-piece evidence is kept, honestly labelled (the panel outvoted dropping the short-fixture check entirely).

## Root cause (pre-fix)

- `scripts/diarization-long-proof.js` `evaluateFixture`: `duration >= 180 ? 120 : 60` / `? 180 : 120` — the [60,120] substitution was returned as `mappingMinute2` / `minute2` regardless of which window ran.
- `scripts/generate-diarization-fixtures.py` `check_windows`: same ternary, labelled `"minute 2"` either way.
- The committed results record shows the substitution: the 118.182 s fixture's `evaluation.minute2.window_s` is [60, 120]; the long fixtures' is [120, 180]. That JSON is a dated measurement record and is **not rewritten** by this lane — its `window_s` already states the truth; the defect was the shared name.

## What changed

| File | Change |
|---|---|
| `scripts/diarization-long-proof.js` | Named `minute2Window(duration)` helper ([120,180] at ≥180 s, `null` below), exported (plus `EARLY_WINDOW_S`); `evaluateFixture` uses it, evaluates the early window distinctly keyed for <180 s, and computes join consistency against the primary window (minute 2, or the early window under its own name). Canonical definition cited in a comment. |
| `scripts/generate-diarization-fixtures.py` | `minute2_window(duration_s)` mirror helper; `check_windows` checks "minute 2" only when it exists and labels the <180 s check "early window" [60,120]; header wording aligned ("minute 2 ([120,180] s …; on the short fixture, the early window [60,120] s)"); canonical definition cited. |
| `server/__tests__/lib/diarizationLongProof.test.js` | New `#1929 m9` pins: `minute2Window` at/above/below 180 s; long fixture minute 2 = [120,180] with no early window; 118.182 s fixture: `minute2`/`mappingMinute2` null, `earlyWindow.window_s` = [60,120], `mappingEarlyWindow` carries the mapping, join/phantom pass. |
| `server/__tests__/lib/diarizationProofArtefacts.test.js` | M3 pin reconciled (Suga coupling note): the pin is **window-scoped by design** — it branches on the recorded evaluation's `window_s`. Long fixtures: canonical `mappingMinute2` asserted as before. 2-min fixture: the recorded evaluation stays history; the recomputed early-window mapping is asserted against the recorded `mappingMinute2` explicitly, and recomputed `minute2`/`mappingMinute2` are asserted null. |
| `server/__tests__/routes/recordings-journey-1918.integration.test.js` | JT-D2: comment-only clarification (canonical definition added at the seed block). Seed times (120000 ms / 2400000 ms bases) were already canonical and were **not moved**. |
| `docs/sdlc/rekrut-ai-v2/02-planning/speaker-labelled-transcripts/prd.md` | FR-D05 row: minute 2 ([120,180] s), minute 28 ([1680,1740] s), definition stated. JT-D2 row: minute 2 ([120,180] s), minute 40 ([2400,2460] s). |
| `docs/sdlc/rekrut-ai-v2/04-implementation/1908-long-recording-proof-build-log.md` | Annotation paragraph (see below). |

## 1908 annotation (also in that build log)

The 118.182 s fixture's early window [60,120] overlaps its final-minute window [58.182,118.182] by ~58 s, so its consistency evidence is weaker by construction — the two windows are largely the same speech, unlike the long fixtures where minute 2 and the final minute are fully disjoint. Stated, not hidden.

## Red-first evidence

Tests were written before the fix and run:

```
npx jest server/__tests__/lib/diarizationLongProof.test.js server/__tests__/lib/diarizationProofArtefacts.test.js
Test Suites: 2 failed, 2 total
Tests:       4 failed, 13 passed, 17 total
```

Failures were the defect itself: `minute2Window is not a function`; the long-fixture result had no `earlyWindow` key; the 118 s fixture returned a `minute2` object with `window_s: [60, 120]` instead of null (in both the unit suite and the artefact recomputation).

## Green evidence

Same command after the fix:

```
npx jest server/__tests__/lib/diarizationLongProof.test.js server/__tests__/lib/diarizationProofArtefacts.test.js
Test Suites: 2 passed, 2 total
Tests:       17 passed, 17 total
```

Python mirror checked directly (no pytest suite exists for the generator): `minute2_window(3600) == (120, 180)`, `minute2_window(118.182) is None`, and `check_windows` passes for a synthetic short fixture (early-window label) and a synthetic 1800 s fixture (minute 2 [120,180]).

## Boundaries

No production code, no migrations, `DIARIZATION_ENABLED` untouched (absent from both scripts, as before), committed results JSON untouched, M4/m5 untouched. JT-D2 integration suite itself was not re-run (comment-only change; it needs the fresh-DB rig) — no seed or assertion changed.
