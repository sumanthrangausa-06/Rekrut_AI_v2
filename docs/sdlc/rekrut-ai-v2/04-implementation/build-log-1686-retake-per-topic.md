# Build Log — #1686: Per-topic retake lockout on POST /assessments/start

**Story:** #1686 — catalogue `canRetake` is per-topic but the `/start`
retake lockout is skill-wide
**Branch:** `nova/1686-retake-per-topic` (off dev `14c55ab79`)
**Persona:** Nova (build lane) · Founder ruling on #1686 (2026-10-22):
Option (a) — lockout is PER-TOPIC; 30-day period unchanged.
**Status:** Built in worktree, committed locally — parent verifies and
lands (HL-007). User-visible behaviour change: a start the catalogue
already promised as retakable now succeeds instead of 403ing.

## Root cause

In `routes/assessments.js`, `POST /start`, the retake gate read the
latest completion for the whole SKILL:

```sql
SELECT completed_at FROM skill_assessments
WHERE user_id = $1 AND skill_id = $2 AND completed_at IS NOT NULL
ORDER BY completed_at DESC LIMIT 1
```

Topics on one subject share one `skill_id`, while the catalogue
(`GET /catalog`, C3 read model in `loadCatalogTables`) computes
`canRetake` per (user, topic) — via `sa.session_id →
assessment_sessions.topic_id`, the only topic linkage that exists
(`skill_assessments` has no `topic_id` column). So a candidate whose
Topic B completion was 35 days old (catalogue: retakable) was blocked
with `403 RETAKE_LOCKOUT` because Topic A on the same skill was
completed 10 days ago. The surface promised what the server refused.

## Fix

`routes/assessments.js`, `POST /start` retake gate only, mirroring the
#1687 pattern in the same handler (`hasTopic` keyed on the resolved
snapshot, which is computed before the gate):

- `const hasTopic = snapshot.topicId != null;` is declared at the gate
  and reused by the #1687 abandon block below (its duplicate
  declaration is removed).
- `hasTopic` → the gate query joins `assessment_sessions` and adds
  `AND assessment_sessions.topic_id = $3`
  (params `[userId, skill.id, snapshot.topicId]`), reading the latest
  completion for that topic only. The
  `SELECT completed_at FROM skill_assessments` prefix is kept so the
  existing suites' SQL dispatchers keep matching this read.
- `!hasTopic` → the original skill-wide query, byte-for-byte.

The 30-day constant, `canRetakeSkill`, the 403 body (`RETAKE_LOCKOUT`,
`lockoutDays`, `lastCompletedAt` — now the topic's own latest), the
gate's position (before abandon), and every other handler are
unchanged. No schema change, no new dependencies.

Scope note (mirrors #1687's): the key is the resolved snapshot topic,
not the request shape — a legacy-body start whose skill maps to a
catalogue default topic snapshots that topic and is topic-scoped; a
legacy-body start for a skill with no catalogue topic snapshots NULL
and keeps the legacy skill-wide gate exactly.

## Edge decision — topic-less legacy completions (STOP 1)

A topic-based start whose only completions are topic-less legacy rows
(session `topic_id` NULL) is NOT blocked by them: the ruling reads
"the latest completion **for that topic only**", a NULL-topic row
carries no topic attribution in the data, and the ruling's skill-wide
carve-out is for topic-less STARTS. Same shape as the #1656 R3
soft-exclusion read (topic-keyed when the session has a topic;
skill-wide only when the requesting session itself is topic-less).

Conscious difference from the catalogue read model: `GET /catalog`'s
fallback surfaces topic-less legacy history on the DEFAULT topic
(skill-keyed aggregate incl. `canRetake`, pinned by C3 R4). For a
default topic whose only history is a topic-less completion < 30 days
old, the catalogue display will still say `canRetake: false` (an
advisory note — Start is not disabled) while `/start` now allows the
start. The fallback is a history-surfacing aggregate, not a claim the
attempt was of that topic; it is NOT mirrored into the gate, and
aligning it is a separate read-model follow-up for Lead — outside
#1686's gate scope.

## Tests — red first

Harness note: the C2/C3 suites run the real route handler against a
stateful mocked pool (predicates applied only when the route's SQL
actually carries them). Regression pins, **not** the HL-003
E2E-on-dev gate — the fresh-install journey proof remains for the
parent's landing pass, as with prior C-series lanes.

Added `describe('POST /start — per-topic retake lockout (#1686)')` to
`server/__tests__/routes/assessments-config-1654.test.js`:

- **(a)** Topic A (20) completed 10d ago + Topic B (21) completed 35d
  ago, same skill → start Topic B is **200** (the bug case).
- **(b)** Same seed → start Topic A is **403 RETAKE_LOCKOUT** with
  `lastCompletedAt` = Topic A's own 10-day-old completion.
- **(c)** Only topic-less legacy completions (10d ago) → topic start
  is **200** (edge decision); a topic-less start ('Rust', no
  catalogue topic) with a 10-day-old completion stays **403**
  (skill-wide gate preserved).

The gate branches of both suite dispatchers (C2 + C3,
`assessments-sets-retake-progress-1656.test.js`) now apply the topic
filter only when the route's SQL carries the join/topic predicate —
the suites' standing emulation rule. The pre-existing C2 pin "retake
gate still applies to configured starts" had its seeded completion
linked to a completed Topic-20 session, so it remains a genuine
same-topic pin under the joined gate.

**RED** (pre-fix, tests + dispatchers only): 2 failed / 30 passed /
32 total in the C2 suite — (a) failed with `403` where `200` was
expected; (c) failed the same way on its topic-start leg; (b) and all
pre-existing tests passed.

**GREEN** (post-fix): C2 suite 32/32; C2 + C3 + catalog-1653 together
65/65; full `assessments-*` route run: 141 passed / 14 failed / 155
total, where all 14 failures sit in the same 4 suites
(`assessments-score-roundtrip`, `assessments-short-answer-honesty-1572`,
`assessments-retake-lockout`, `assessments-graded-confidence-1584`)
that fail **identically on pristine dev** — verified by stashing this
lane's changes and re-running those 4 suites unmodified (same 14
failed / 8 passed, and the failing test names are identical with and
without this change). Pre-existing failures, zero regressions.

## Deviations

- None from the ruling. The catalogue read model was not touched
  (see the edge decision for the flagged follow-up).
- No E2E-on-dev run in this lane (worktree-only, per dispatch); the
  journey / fresh-install gate remains for the parent's landing pass.
- Fix round (Lead catch, HL-003): the topic-gate SELECT's unqualified completed_at was ambiguous against assessment_sessions.completed_at (006) and would 500 on real Postgres — qualified it to skill_assessments.completed_at (all other columns in the query were already qualified / verified against both schemas incl. 280 topic_id); C2/C3 dispatchers now also match the qualified prefix.
