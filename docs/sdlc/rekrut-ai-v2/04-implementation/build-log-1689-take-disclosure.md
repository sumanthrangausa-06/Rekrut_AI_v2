# Build Log — #1689 Take-page AI-scoring disclosure gate + format labels

**Issue:** #1689 · **STOP 1:** #1689 comment 6349162520 · **Persona:** Nova (Implementation), Lead coordinating · **Branch:** `nova/1689-take-disclosure` (off dev `3e8cc8f4a`) · **Base pattern:** #1679 item 3, fixed on the configure page only.

## Root cause

Two residuals of the #1679 item-3 fix, which corrected the configure page
(`assessment-configure.tsx`) but not the take page
(`client/src/pages/candidate/assessment-take.tsx`):

1. The configuration-snapshot instructions block ("Before you start", the
   `sessionConfig` branch) rendered
   `<li>Short answers are scored by AI and reviewed by a human.</li>`
   **unconditionally**. For an MCQ-only session that claim is false — no
   written answers exist to be AI-scored.
2. `FORMAT_LABELS` on the take page used bare labels (`mixed: 'Mixed'`,
   `short_answer: 'Short answer'`) while configure's `FORMATS` carries the
   UX spec §0.2 wording (`'Mixed — multiple choice and written answers'`,
   `'Written answers'`). The same configuration was described in two
   different wordings on consecutive screens of one journey.

## Fix (minimum diff, no new deps, no shared-constant refactor)

- `assessment-take.tsx` — snapshot block only: the disclosure `<li>` now
  renders only when
  `sessionConfig.format === 'mixed' || sessionConfig.format === 'short_answer'`
  — the exact gate configure uses (#1679 item 3). The legacy no-snapshot
  Phase B gate block and the in-test AI banner are **unchanged** (out of
  this issue's scope; they are not keyed to a configuration snapshot).
- `assessment-take.tsx` — `FORMAT_LABELS` aligned verbatim with configure:
  `short_answer: 'Written answers'`,
  `mixed: 'Mixed — multiple choice and written answers'`
  (`mcq: 'Multiple choice'` and `coding: 'Coding'` already matched).
  Identical strings were used rather than a shared constant: the two maps
  have different shapes (configure's is an ordered option list for buttons,
  take's is a lookup record), so sharing would not be a trivially clean
  change.

## Tests — red first, then green

New `#1689` describe block in
`client/src/pages/candidate/assessment-take-1654.test.tsx` (7 tests):
MCQ-only snapshot → no disclosure; mixed snapshot → disclosure;
short_answer snapshot → disclosure; format label matches configure wording
for each of mcq / mixed / short_answer / coding.

- **RED** (tests added, product code untouched) —
  `evidence-1689/red.log`: take suite 16 tests, **3 failed / 13 passed**.
  The failures are exactly the defects: MCQ-only disclosure present,
  mixed label rendered as "Mixed", short_answer label rendered as
  "Short answer". The mixed/short_answer disclosure guards and the
  mcq/coding label cases passed on the old code, as expected.
- **GREEN** (after the fix) — `evidence-1689/green.log`:
  `vitest run assessment-take-1654.test.tsx assessment-configure-1654.test.tsx AssessmentAiDisclosure.test.tsx`
  → **39 passed / 0 failed** across 3 files (take 16, configure 20,
  AssessmentAiDisclosure 3), exit 0.

These are component tests with `apiCall` mocked at the network boundary —
regression pins, **not** the HL-003 E2E-on-dev gate; journey proof on dev
remains the parent's landing step.

## Lint note

`biome check` on the two touched files reports pre-existing findings only
(import organisation at `assessment-take.tsx:4`, exhaustive-deps at
`:476`/`:483`) — none in the changed lines; no new lint issues introduced.

## Deviations

None. Scope was held to the snapshot instructions block named in STOP 1;
the legacy gate's disclosure line and the in-test banner were deliberately
not gated, as they carry no session configuration to gate on.
