# Build Log — #1712: Legacy label test tidy (NIT-1 + NIT-2 from PR #1711 review)

**Story:** #1712 — test hygiene follow-up to #1683 / PR #1711 (independent review: APPROVE with NITs)
**Branch:** `nova/1712-label-test-tidy` (off dev `88583cefc`)
**Persona:** Nova (build lane) · Status: built in worktree, committed locally — parent verifies and lands (HL-007).

## What changed (test file only, plus these docs)

File: `client/src/pages/candidate/assessments-legacy-label-1683.test.tsx`

- **NIT-1 (tautology + overstated derivation):** the contract test compared
  `bandRange(serverSrc, band)` with `bandRange(serverSrc, 'medium')` after
  `band === 'medium'` was already asserted — it could not fail independently.
  That line (and its pre-read) is removed. The expected label's words were
  also re-hardcoded (`Mixed · Medium`); they are now derived — `format` and
  `difficultyBand` are parsed from the scoped snapshot block and capitalised,
  and the level numbers still come from the parsed `BAND_RANGE` — so the
  whole expected label is derived from the server source. The test header
  wording was updated to state exactly that.
- **NIT-2 (unscoped pins):** the `BAND_START` / `BAND_RANGE` exact-literal
  pins were whole-file `toContain` checks. They are now scoped to a new
  `bandDefinitionsBlock` slice (from `const BAND_START` through the
  `BAND_RANGE` literal's close), mirroring the neighbouring snapshot-block
  scoping, so a stale copy of either literal elsewhere in the file can
  neither satisfy nor break them.
- **Wording correction:** the #1683 build log's cross-contract bullet
  (`build-log-1683-legacy-label-pin.md`) overstated the original derivation
  ("the expected label is DERIVED…"); it now states precisely that the
  level numbers were derived originally and that #1712 completed the
  derivation for the words.

No product code changed: `assessments.tsx` and `routes/assessments.js` are
untouched.

## Evidence

Evidence lives in the run's hidden evidence dir (logs are gitignored and are
NOT in the PR): before/after vitest logs for this suite plus the STOP 1 note.

- Before: `vitest run assessments-legacy-label-1683.test.tsx` → 4 passed / 4.
- After: same suite → 4 passed / 4, 1 test file passed.
- Discrimination: scratch mutation of the server `BAND_RANGE` literal
  (`medium: [2, 4]` → `medium: [2, 5]` in `routes/assessments.js`, then
  restored with `git checkout`) → 2 failed / 2 passed — the scoped
  band-definitions pin and the contract test (derived label becomes
  "levels 2–5", client count 0) both fail. After restore the suite is
  green again (4 passed / 4) and `routes/assessments.js` is byte-identical
  to base.
