# Build log — #1929 M1: long-proof evaluator hardening (distinctness + both-voices-present)

- **Issue:** #1929, item **M1 only**. M3, M4/m5 and m9 are untouched and remain open; #1929 stays open after this lane.
- **Persona:** Nova (implementation), reporting to Suga.
- **Branch:** `nova/1929-evaluator-distinctness`, from `origin/dev` at `7469b6f37` (verified live at dispatch; dev had not moved).
- **Files changed:** `scripts/diarization-long-proof.js`, `server/__tests__/lib/diarizationLongProof.test.js`, this build log. No production-code changes, no migrations, no window-definition changes (m9 out of scope), no `MIN_OVERLAP_S` change.

## STOP 1 summary (posted on #1929 before coding)

Comment: https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/1929#issuecomment-6523229603

**Root cause.** (1) Distinctness: `evaluateWindow` never checked that two different ground-truth voices map to *different* engine speakers, and `evaluateFixture`'s cross-window consistency check only compares each voice's number across windows — so a fully merged join (`{interviewer: 0, candidate: 0}` in both windows) is self-consistent and returned `joinPass: true`. (2) Both-voices-present: `evaluateWindow` derived its voice set only from GT turns intersecting the window, so a voice absent from the window was never noticed; a window/fixture observing only one expected voice could pass.

**Specialist decision: No specialist beyond the standard independent PR review.** This is pure evaluator logic in a test harness — no production request path, auth, crypto, DB schema, consent logic, or user-visible surface. Coverage is red-first unit tests for both demonstrated holes plus the separate reviewer gate.

## Fix shape (ponytail: smallest change)

- `evaluateWindow(gtTurns, engineTurns, startS, endS, expectedVoices = null)`: the expected voice set is the explicit parameter when given, else the distinct speakers across the full `gtTurns` already handed in (existing call sites unchanged). `pass` now also requires every expected voice present in the mapping, and the mapping to be injective (distinct voices → distinct engine speakers).
- `evaluateFixture`: passes `gt.speakers` as the expected voice set to both window evaluations, and `joinPass` additionally requires both windows' mappings to be injective.

## Red evidence (before the fix)

Command: `npx jest server/__tests__/lib/diarizationLongProof.test.js --forceExit` — **exit 1**, `Tests: 4 failed, 6 passed, 10 total`. The 4 failures are exactly the new M1 tests (the 6 pre-existing tests all passed):

- ✕ `(M1a) fails the window when both voices merge into one engine speaker`
- ✕ `(M1a) fails the join when both voices merge into one engine speaker in both windows`
- ✕ `(M1b) fails a window containing ground-truth speech from only one expected voice`
- ✕ `(M1b) fails the join when a voice speaks only outside both evaluated windows`

(Failures were `Expected: false, Received: true` on `pass`/`joinPass` — the holes, reproduced.)

## Green evidence (after the fix)

A fifth test, `(M1b) honours an explicit expected-voice set narrower than the full ground truth`, was added with the fix to pin the new parameter's contract.

Combined regression command (harness suite + the neighbouring pure suite that references this harness, `diarizationFence-1916`):

```
npx jest server/__tests__/lib/diarizationLongProof.test.js server/__tests__/lib/diarizationFence-1916.test.js --forceExit
→ EXIT=0 — Test Suites: 2 passed, 2 total; Tests: 18 passed, 18 total
```

`diarizationLongProof` alone: **11 passed, 11 total** (6 pre-existing, unchanged and green, + 5 new M1 tests).

**Gate note (HL-003):** these are pure functions — no DB, no engine, no user flow. No E2E is claimed for this lane; the unit suite above is the applicable gate, as stated at STOP 1.

## Scope note

M1 only. M3 (committed ground-truth JSONs / RSS figure sourcing), M4/m5 (abrupt-end + uncovered-tail behaviour for S-D07) and m9 (minute-2 window unification) remain open on #1929, and #1929 is **not** closed by this work. Status: PR open to `dev`, awaiting Suga gate + independent review; not merged by Nova.
