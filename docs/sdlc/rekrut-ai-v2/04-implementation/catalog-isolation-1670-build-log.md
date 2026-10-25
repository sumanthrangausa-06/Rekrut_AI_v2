# Build Log — #1670: assessments-catalog isolation test + fallback predicate

**Story:** #1670 — [FOLLOW-UP #1653 review] assessments-catalog isolation
test is mock-baked + 2 NITs (items 1 and 2 only; see scope note)
**Branch:** `nova/1670-catalog-isolation-test` (off dev
`9ae990faa44c62d6ad648376744c9b9eb510c9dc`)
**Persona:** Nova (Phase 4 Implementation), under Lead's STOP 1
(issue comment 6373363559, 2026-10-23)
**Skills:** startup-cto → superpowers/test-driven-development +
systematic-debugging → ponytail (minimum diff) →
verification-before-completion. **Lessons:** HL-003, HL-006, HL-007
(parent verifies and performs all GitHub landings first-hand).
**Status:** Built in worktree, branch pushed — parent verifies via
`git ls-remote` and lands. No GitHub comment/PR/merge claimed here.

## Root cause

1. **Regression-net defect (SHOULD-FIX, item 1).**
   `server/__tests__/routes/assessments-catalog-1653.test.js`: the mock
   dispatcher returns `FX.progressByUser[userId]` keyed by the bound
   parameter regardless of the SQL text, and the progress-isolation
   test's only SQL assertion was
   `expect(progressSql).toContain('user_id')` on the first
   `distinct on` query found. Deleting a `user_id = $1` predicate from
   any one CTE of the `/catalog` progress query in
   `loadCatalogTables` (`routes/assessments.js`) would still pass.
   This was a test-net defect, not a live data leak — the shipped
   query was verified correct at the #1653 review and Quinn's E2E
   proved real-DB isolation there.
2. **Transitive-only scoping (NIT, item 2).**
   `buildAvailableFromConstant` joined assessments with
   `LEFT JOIN skill_assessments sa ON cs.id = sa.skill_id AND sa.completed_at IS NOT NULL`
   — no explicit `sa.user_id = $1`. Scoping held only transitively via
   `WHERE cs.user_id = $1` plus the caller-owned `candidate_skills`
   primary key.

## Fix

- **Test (`assessments-catalog-1653.test.js`, progress-isolation test
  only):** assert all three predicates in the captured (lowercased,
  whitespace-collapsed) progress SQL:
  `sa.user_id = $1` occurs exactly twice (latest CTE and agg CTE),
  `cs.user_id = $1` is present (outer `candidate_skills` read), and
  `user_id = $1` occurs exactly three times in total. Deleting any
  single predicate now turns the test red.
- **Code (`routes/assessments.js`, `buildAvailableFromConstant` only):**
  the join is now
  `LEFT JOIN skill_assessments sa ON cs.id = sa.skill_id AND sa.user_id = $1 AND sa.completed_at IS NOT NULL`
  — explicit defence-in-depth parity with the progress query. The
  `$1` parameter is the same already-bound `userId`.
  Schema check before the fix: `skill_assessments.user_id` exists —
  `migrations/004_candidate_profiles.js` creates the table with
  `user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`, and
  `migrations/p3_schema_optimizations.js` adds
  `idx_skill_assessments_user_id ON skill_assessments(user_id)`.
- No other query, handler, or file changed. No schema change, no new
  dependencies.

## Scope note

Item 3 of #1670 (the unused counts query loaded by the `/available`
table path via `loadCatalogTables`) is **out of scope for this lane**
per STOP 1: the issue files it as "split the loader if touched
again", and this lane does not touch that loader. The deferral is
explicit, not silent.

## Tests — red first

Harness note: this suite runs the real route handler against a mocked
pool that captures SQL strings; the strengthened assertions pin the
query shapes themselves. These are regression pins, **not** the
HL-003 E2E-on-dev gate — the fresh-install real-DB isolation
re-check remains for the parent's Quinn gate before merge.

- **Baseline (pristine dev `9ae990faa`):** catalog suite 18/18 passed.
- **Strengthened test on pristine query:** progress-isolation test
  passed (the shipped query does carry all three predicates).
- **RED proof:** with the strengthened test in place, the agg CTE
  predicate was temporarily removed from the progress query
  (`WHERE sa.user_id = $1 AND sa.completed_at IS NOT NULL` →
  `WHERE sa.completed_at IS NOT NULL`, agg CTE only). Result:

  ```
  ✕ progress isolation: user B never sees user A data and vice versa
    expect(received).toHaveLength(expected)
    Expected length: 2
    Received length: 1
    Received array: ["sa.user_id = $1"]
      at ...assessments-catalog-1653.test.js:569 (sa.user_id = $1 count)
  Test Suites: 1 failed, 1 total
  Tests:       1 failed, 17 skipped, 18 total
  ```

  The mutation was then restored; `git diff routes/assessments.js`
  was empty before the item-2 fix was applied, confirming a clean
  restore.
- **GREEN (final branch):**
  - `assessments-catalog-1653.test.js`: **18 passed / 18 total**.
  - Neighbouring suites touching `/catalog` or `/available`
    (found by grepping the route test files for
    `/catalog|/available|loadCatalogTables|buildAvailable`):
    `assessments-catalog-1653`, `assessments-config-1654`,
    `assessments-sets-retake-progress-1656` together:
    **69 passed / 69 total, 3 suites passed**. No failures, so no
    pristine-dev comparison run was needed (the one console.error in
    the output is the suite's own simulated-database-failure test,
    which passes).

## Deviations

- None from STOP 1. Item 3 deferred explicitly (see scope note).
- No E2E-on-dev run in this lane (worktree-only, per dispatch); the
  Quinn HL-003 fresh-install gate remains for the parent's landing
  pass.
