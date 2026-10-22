# Build Log — #1710: Band-widen before repeat in scoped assessment serving

**Story:** #1710 — adaptive serving repeats a question within one session when the current difficulty pool exhausts
**Branch:** `nova/1710-band-widen` (off dev `0571be00e`)
**Persona:** Nova (Phase 4 Implementation) · STOP 1 investigation by Scout (`scout-1710-stop1.md`, run 1543) · Lead ruling on #1710 (comment 6353236169)
**Status:** Built and verified in worktree — parent verifies first-hand, lands the PR and the issue checkpoint (HL-007).

## Root cause

The server promises a configuration at **band granularity** but serves at
**single-difficulty granularity**. The start gate counts the whole medium
band (L2+L3+L4, `computeTopicAvailability` / `BANDS`), while the bank draw in
`generateQuestion`'s scoped path (`routes/assessments.js`) filtered
`difficulty_level = <current difficulty>` exactly. On the #1695 rig, perfect
answers climbed a medium OOP session to difficulty 4 and exhausted the 8
distinct L4 rows; the scoped fallback chain was then:

1. bank at current difficulty, excluding already-asked — 0 rows left,
2. AI generation — null (no working provider on the rig),
3. **in-scope re-serve**: the same topic/format/approved/difficulty query
   with the exclusion clause removed — an already-asked row, served a
   second time with no marker anywhere (question id 521 on the #1695 rig).

The widen step was missing: the chain never looked sideways at the unserved
L2/L3 rows in the same band the start gate had already counted as available.

## Ruling (STOP 1, Lead — #1710 comment 6353236169)

In `generateQuestion`'s **scoped path only**, insert a WIDEN step between AI
generation and the in-scope re-serve, giving the serving order:
**bank (current difficulty) → AI → widen (unserved in-band) → re-serve
(current difficulty) → null**.

- Widen levels come from the `BANDS`/`BAND_RANGE` constants — never from
  request input.
- The widen query carries the same topic/format/approved predicate **and**
  the `effectiveExcludeIds` exclusion (hard in-session ids folded with the
  §5.3 soft cross-attempt ids) — a no-exclusion widen would violate §5.3.
- Serving wider does **not** move `current_difficulty`; it stays the §5.2
  adaptation value /answer put there.
- Within widen, any unserved in-band row (`ORDER BY RANDOM()`), no
  preference ordering.
- The legacy NULL-config path is **unchanged**.

## Fix

`routes/assessments.js`, scoped branch of `generateQuestion` only: after the
AI leg returns null and before the re-serve query, one additional query —
same `${formatPredicate}` interpolation discipline as the neighbouring
draws:

```sql
SELECT * FROM assessment_questions
WHERE topic_id = $1 AND ${formatPredicate} AND review_status = 'approved'
  AND difficulty_level = ANY($2::int[])
  AND NOT (id = ANY($3::int[]))
ORDER BY RANDOM()
LIMIT 1
```

with params `[session.topic_id, BANDS[session.difficulty_band],
effectiveExcludeIds]`. If the session's band is absent from `BANDS`, the
step is skipped and the chain falls through to the re-serve exactly as
before. The `generateQuestion` header comment's Q2 order line was updated
to include the widen step.

## Tests (red-first)

`server/__tests__/routes/assessments-config-1654.test.js`:

- The fake-pool emulator (`bankServe`) was extended to emulate
  `difficulty_level = ANY($n::int[])` as membership — exactly the real SQL
  semantics, in keeping with the file's "predicates apply only when the
  SQL carries them" rule.
- The Q2 re-serve test was **deliberately amended** and renamed to the new
  order (`bank → AI → band-widen → re-serve`), with a comment citing the
  #1710 Lead ruling (comment 6353236169): the AI-down leg now serves the
  unserved in-band L2 row before any repeat. Its AI-up leg (generation
  before widen/re-serve) is unchanged in expectation.
- New case mirroring the bug: mcq L2 ×2 + L3 ×1 + L4 ×2, perfect answers
  climb 3 → 4 and exhaust L4 with AI down → serves 4–5 widen to the
  unserved L2 rows; all 5 serves distinct; session completes.
- New case pinning the last resort: whole band exhausted (resumable
  insufficient-supply session, L3 ×1 + L2 ×2, AI down) → every band row is
  served exactly once via bank+widen, and only then does the re-serve
  fire, at the current difficulty.
- The `:769` case ("AI generation serves when supply exists at the band
  but not the start level") passes **unchanged** — widen sits after AI,
  so AI still wins when it is up.

Counts (jest, `--forceExit`):

| Suite | Baseline (pristine dev) | This branch |
|---|---|---|
| assessments-config-1654 | 27 passed | 29 passed (1 amended, 2 added) |
| assessments-sets-retake-progress-1656 | 15 passed | 15 passed |
| assessments-question-boilerplate-1573 | 6 passed | 6 passed |

RED evidence: with the test changes applied to pristine code, exactly the
3 #1710 cases failed (26 passed), each on the intended assertion (a
re-served asked id where an unserved in-band row was expected).
Wider sweep: all 15 `assessments*` suites on this branch = 138 passed /
14 failed; the same 14 failures occur on pristine dev with identical test
names (retake-lockout, graded-confidence-1584, short-answer-honesty-1572,
score-roundtrip) — pre-existing, unrelated to this change, not touched.

## Journey evidence (HL-003 — fresh-install rig, real HTTP, real DB)

New leg **JT-1710** in `e2e/journeys/assessment-c2-config.js` (Quinn +
Candidate Experience, Scout §5 design): the #1695 shape reproduced on the
fresh install's own seed bank — OOP topic (approved MCQ L2 ×8, L3 ×9,
L4 ×8; medium servable 25), server run with **no AI provider keys** (AI
forced down), perfect answers read from the DB with `timeTaken: 30`.

- **RED** (pristine `0571be00e` server + new journey): JT-1710 **FAIL** —
  `questions_asked` = 10 entries, **9 distinct**; served levels
  `[3,4,4,4,4,4,4,4,4,4]`, Q10 repeated an already-asked L4 id. The other
  four C2 legs (JT-C1, JT-C4a/b/c) PASS.
- **GREEN** (this branch): all 5 legs **PASS** — JT-1710: 10 entries,
  **10 distinct**; served levels `[3,4,4,4,4,4,4,4,4,2]`; Q10 widened to an
  unserved L2 row; session completed; `current_difficulty` stayed in
  `[2,4]`.

Rig: embedded PostgreSQL 18.4 (rig user's cluster, 127.0.0.1:55473),
DBs `red1710`/`green1710` each built only by `node migrate.js` from the
respective worktree; servers on ports 3212 (RED) / 3213 (GREEN) with a
clean env (`rig-1710/run-server.sh` in the run's hidden_files). Evidence
files: `hidden_files/1543-run/evidence-1710/` (`unit-*.txt`,
`journey-RED.txt`, `journey-GREEN.txt`, `journey-c2-RED.json`,
`journey-c2-GREEN.json`, migrate/server transcripts).

## What was NOT changed

- **Legacy NULL-config path** (`generateQuestion`'s unscoped branch):
  untouched, byte-for-byte — its re-serve order and soft-exclusion
  behaviour are exactly as before.
- **Difficulty bookkeeping**: `/answer`'s §5.2 step + `clampToBand` and
  `serveNextQuestion` are untouched; a widened serve does not move
  `current_difficulty`.
- **`applySoftExclusion`**: untouched — the widen query consumes its
  output (`effectiveExcludeIds`) rather than re-measuring the pool.
- **Full-band-exhaustion disclosure**: when the WHOLE band is exhausted
  and AI is down, the pre-existing last-resort re-serve still serves a
  repeat with no candidate-facing marker. Whether that should become a
  disclosed repeat or an honest stop/partial is a product question for
  Sumanth (flagged in Scout's STOP 1 §3) — **not** decided or changed by
  this build; the re-serve behaviour is pinned as-is by the new
  band-exhaustion test case.
- No schema, no migrations, no other routes or surfaces.

## Review fix (advance run 2026-10-22 15:43 PT)
Independent review of PR #1713 (APPROVE) raised M-1 (Minor): `BANDS['constructor']`/`BANDS['hasOwnProperty']` return inherited functions whose `.length` passes the truthiness guard — unreachable via the API (band writes are `Object.hasOwn`-gated at :897 or the literal 'medium') and fail-closed, but the guard now uses `Array.isArray(bandLevels)` (the codebase's own idiom) in a follow-up commit on this PR.
