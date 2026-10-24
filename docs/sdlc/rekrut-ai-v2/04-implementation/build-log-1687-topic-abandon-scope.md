# Build Log — #1687: Topic-scoped abandon on POST /assessments/start

**Story:** #1687 — starting Topic B silently abandons an in-progress Topic A attempt
**Branch:** `nova/1687-topic-abandon-scope` (off dev `3e8cc8f4a`)
**Persona:** Nova (build lane) · STOP 1 + Lead ruling on #1687 (comment 6349169445)
**Status:** Built in worktree, uncommitted — parent verifies, commits and lands (HL-007).

## Root cause

In `routes/assessments.js`, POST `/start` (the active-session block, formerly
~:1042-1051), the in-progress lookup was:

```sql
SELECT id FROM assessment_sessions
WHERE user_id = $1 AND skill_id = $2 AND status = 'in_progress'
```

with **no topic filter**, and only `rows[0]` was abandoned. Topics on the same
skill share one `skill_id` (the §3.6 snapshot resolves history/Verified/
OmniScore at skill level), so starting Topic B found the candidate's
in-progress Topic A session and abandoned it — silently discarding that
attempt. Symmetrically, if several stale sessions of the *same* topic existed,
only the first was abandoned and the rest leaked as still-`in_progress`.

## Ruling (STOP 1, Lead — #1687 comment 6349169445)

- When the new session has a topic (the snapshot's `topicId` resolved for the
  start), scope the abandon to in-progress sessions with the **same
  `topic_id`** and abandon **all** matching rows, not just the first.
- Legacy starts (no topic / NULL topic) keep today's skill-wide behaviour
  **exactly**.
- The retake-lockout gate above this block in `/start` is **not** touched —
  that is #1686, a separate MAJOR.

## Fix

`routes/assessments.js`, POST `/start` active-session block only:

- `snapshot.topicId != null` → the SELECT gains `AND topic_id = $3`
  (params `[userId, skill.id, snapshot.topicId]`), and every returned row is
  abandoned via the existing `UPDATE … SET status = 'abandoned' WHERE id = $1`.
- `snapshot.topicId == null` → the original SELECT and the original
  first-match-only abandon, byte-for-byte as before.

Note on scope: the key is the **resolved snapshot topic**, not the request
shape — a legacy-body start whose skill maps to a catalogue default topic
snapshots that topic (§8/SF-9) and is therefore topic-scoped; a legacy-body
start for a skill with no catalogue topic snapshots NULL and keeps the legacy
skill-wide path. This follows the ruling's wording ("snapshot/topic_id
resolved for the start"; "Legacy starts (no topic / NULL topic)").

No new dependencies, no schema change, no other handler touched.

## Tests — red first

Harness note: the C2/C3 suites run the real route handler against a
**stateful mocked pool** (`server/test/setup.js` mocks `lib/db`; each suite's
dispatcher emulates SQL semantics, applying a predicate only when the route's
SQL actually carries it). That is the existing suites' pattern and this lane
follows it; it is a regression pin, **not** the HL-003 E2E-on-dev gate.

Added to `server/__tests__/routes/assessments-config-1654.test.js`
(describe `POST /start — topic-scoped abandon (#1687)`):

- **(a)** Start Topic B (topic 21) while Topic A (topic 20, same skill) is
  in progress → A stays `in_progress`, B starts.
- **(b)** Start Topic A again with two stale Topic A sessions plus one
  Topic B session seeded → both Topic A sessions `abandoned`, Topic B
  untouched.
- **(c)** Legacy-body start for a skill with no catalogue topic (NULL
  snapshot topic) → skill-wide abandon preserved exactly (first match
  abandoned, second session untouched). This is a regression pin: it passed
  before and after the fix.

The suite's SELECT emulator (and the identical branch in the C3 suite,
`assessments-sets-retake-progress-1656.test.js`) now applies the `topic_id`
filter only when the SQL carries the predicate — the suites' standing
emulation rule, so an unscoped route query cannot fake-pass.

**RED** (`evidence-1687/red.log`, pre-fix): 2 failed / 25 passed / 27 total —
(a) failed with Topic A `abandoned`; (b) failed with the second Topic A
session still `in_progress`; (c) passed; all 24 pre-existing C2 tests passed.

**GREEN** (`evidence-1687/green.log`, full assessments server run):
the C2 suite passes 27/27; C3 (1656), catalog (1653) and every other
assessments suite pass. Totals for the full run: 168 passed / 14 failed /
182 total, where all 14 failures sit in 4 suites
(`assessments-score-roundtrip`, `assessments-short-answer-honesty-1572`,
`assessments-retake-lockout`, `assessments-graded-confidence-1584`) that fail
**identically on pristine dev** — verified by stashing this lane's changes
and re-running those 4 suites on the unmodified tree: same 14 failed /
8 passed (`evidence-1687/baseline-failing-suites.log`). Pre-existing
failures, zero regressions from this change.

## Second change — #1685 item 2 (separate, same worktree)

In `loadCatalogTables` (the per-topic progress read added by C3), the
LATERAL latest-completion query ordered by `sa2.completed_at DESC` only —
two completions in the same timestamp tick made "latest" nondeterministic.
Added the deterministic tie-breaker on the ordered table's PK:

```sql
ORDER BY sa2.completed_at DESC, sa2.id DESC
```

(`sa2` is the `skill_assessments` alias in that LATERAL.) No other ORDER BY
in the file was touched; the skill-keyed DISTINCT ON read is out of scope
for #1685 item 2. The catalog suite (1653), which exercises this read,
passes in the green run above.

## Deviations

- None from the ruling. The retake-lockout gate (#1686) was not touched.
- No E2E-on-dev run in this lane (worktree-only, per dispatch); the journey
  / fresh-install gate remains for the parent's landing pass, as with prior
  C-series lanes.
