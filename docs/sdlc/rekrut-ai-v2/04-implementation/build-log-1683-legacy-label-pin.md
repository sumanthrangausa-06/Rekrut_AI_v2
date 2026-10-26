# Build Log — #1683: Legacy label contract pin (option b)

**Story:** #1683 — legacy "Mixed · Medium (levels 2–4)" label vs server defaults drift risk
**Branch:** `nova/1683-legacy-label-pin` (off dev `0571be00e`)
**Persona:** Nova (build lane) · STOP 1 ruling on #1683 (comment 6353032006): option (b) — contract pin, no behaviour change
**Status:** Built in worktree, committed locally — parent verifies and lands (HL-007).

## Root cause

The candidate legacy skill card states the real default a new
legacy-body start snapshots — "Mixed · Medium (levels 2–4)"
(`client/src/pages/candidate/assessments.tsx`, #1679 item 7) — but
nothing pinned that sentence to the server truth it describes. The
defaults are literals inside the POST /start handler and the band
definitions are module-private consts in `routes/assessments.js`, so
either side could drift (a default change, a band change, a label
edit) with every existing test still green: the render pin (#1679
item 7, in the configure suite) checks the words on the card, not
their agreement with the server.

## Ruling (STOP 1, #1683 comment 6353032006)

Option (b): pin the contract with a test that asserts BOTH sides and
fails if either drifts. No change to `assessments.tsx` or
`routes/assessments.js` behaviour.

## Changes

1. **New contract test** —
   `client/src/pages/candidate/assessments-legacy-label-1683.test.tsx`
   (vitest, same layout/runner as the neighbouring 1654 suites;
   source-pin style mirroring the #1699/#1707 take-page pins, since
   neither side is exported):
   - server snapshot pin, scoped to the legacy snapshot block (from
     the `// §4.2/§8 recorded defaults` marker through the snapshot
     literal): `format: 'mixed'`, `difficultyBand: 'medium'`,
     `totalQuestions: 10`;
   - server band pins: `BAND_START = { easy: 1, medium: 3, hard: 4 }`
     and `BAND_RANGE = { easy: [1, 2], medium: [2, 4], hard: [4, 5] }`
     exact literals, medium parsed out as [2, 4];
   - client pin: the exact string `Mixed · Medium (levels 2–4)`
     occurs exactly once in `assessments.tsx`;
   - cross-contract: the expected label's level numbers are DERIVED
     from the band the snapshot literal names (parsed from the server
     source), so a band change server-side breaks the agreement even
     if both hard-coded literals were left untouched. The label's
     words (`Mixed · Medium`) were originally re-hardcoded in that
     leg; #1712 completed the derivation — the format and band words
     are now also parsed from the snapshot literal and capitalised,
     so the whole expected label is derived.
2. **N2 (title only)** — `assessment-take-1654.test.tsx`: the
   `GAP-4 — completion labels from response fields` describe now also
   names the #1679 item 9 server-field discriminators its tests
   include: `GAP-4 — completion labels from response fields
   (+ #1679 item 9 server-field discriminators)`. No test body changed.
3. **N1 — NOT FOUND, no change made.** The dispatch described a
   build-log consolidation note citing the deleted C2 build log
   under a `03-solutioning` path. Exhaustive grep over `docs/sdlc`
   (and the whole tree) finds NO such citation: both consolidation
   notes already cite the correct `04-implementation` path —
   `c2-client-1654-build-log.md:10` cites
   `docs/sdlc/rekrut-ai-v2/04-implementation/assessments-c2-client-1654-build-log.md`
   and `1679-items-3-9-build-log.md:41` cites
   `04-implementation/assessments-c2-client-1654-build-log.md`, which
   matches the deleted file's real path in git (deleted in 7262e0bd7,
   PR #1682). Flagged to the parent for the exact file/line if the
   citation lives outside this tree (e.g. in the STOP 1 comment text).

## Evidence (evidence-1683/, parent run dir 1543-run)

- **GREEN, new test:** `vitest run assessments-legacy-label-1683.test.tsx`
  → 4 passed / 4 (`green-new-test.txt`).
- **Mutation discrimination — server:** snapshot
  `difficultyBand: 'medium'` → `'hard'` (line 1014, scratch edit,
  restored) → **2 failed / 2 passed** (`mutation-server-default.txt`).
- **Mutation discrimination — client:** label `levels 2–4` →
  `levels 2–5` in `assessments.tsx` (scratch edit, restored) →
  **2 failed / 2 passed** (`mutation-client-label.txt`).
- **Neighbours unchanged:** client configure+take suites 44/44 before
  (`baseline-client-neighbours.txt`) and 48/48 after including the
  new suite (`green-client-neighbours.txt`); server assessments
  route suites **14 failed / 136 passed / 150 total** before AND
  after, with the identical 4 failing suites
  (`baseline-server-neighbours.txt` vs `green-server-neighbours.txt`)
  — pre-existing failures, zero regressions.
- Product diff after restores: `assessments.tsx` and
  `routes/assessments.js` are byte-identical to dev (pin only).

## Deviations

- N1 not actioned (see above) — no wrong-path string exists in the
  tree to fix; inventing an edit would falsify the record.
- No E2E-on-dev run in this lane (worktree-only, per dispatch); this
  is a regression pin, not the HL-003 gate — no behaviour changed.
