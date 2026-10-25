# Build Log — #1716: Default-topic retake gate counts topic-less completions

**Story:** #1716 — catalogue `canRetake:false` on a default topic (topic-less
legacy history) while `POST /start` allows the start (the corner #1686's
per-topic gate left open)
**Branch:** `nova/1716-default-topic-gate` (off dev `59d568553`)
**Persona:** Nova (build lane) · Lead ruling on #1716 (2026-10-22):
Option (b) — gate-side only; the catalogue read model is NOT touched.
**Status:** Built in worktree, committed locally — parent verifies and
lands (HL-007). User-visible behaviour change: a default-topic start the
catalogue already showed as locked now actually 403s inside the 30-day
window; every other start is unchanged.

## Root cause

Pointer to Scout's investigation (full evidence, pinned-test inventory):
`~/workspace/goals/launch-rekrut-ai-v2-by-january/hidden_files/1943-run-2026-10-22/scout-1716/INVESTIGATION.md`
(§1 verdict, §2 option analysis, §3 reachability).

In one paragraph: the #1686 gate (`routes/assessments.js`, `POST /start`)
reads the latest completion FOR THE STARTED TOPIC ONLY via an INNER JOIN
`skill_assessments.session_id → assessment_sessions.topic_id = $3`. A
topic-less legacy completion can never match — in either physical form:
(i) `skill_assessments.session_id IS NULL` (the row is dropped by the
INNER JOIN outright; e.g. the live `routes/candidate.js` verification
writer), or (ii) a session whose `topic_id IS NULL` (pre-migration-280
sessions were never backfilled). The catalogue's C3 R4 fallback, however,
surfaces that same topic-less history on the subject's DEFAULT topic
(the topic carrying `legacy_skill_name`) and computes `canRetake` from
it — so the UI stated "Retake available 30 days after your last
completed attempt" while the gate allowed an immediate retake.

## Ruling applied

Option (b): when the started topic is the subject's default topic, the
gate's latest-completion read ALSO counts completions with no topic
attribution (both forms above), alongside that topic's own completions,
and takes the latest. Non-default topics keep #1686 exactly; a start
with no topic (NULL snapshot topic) keeps the skill-wide gate exactly;
the catalogue read model is untouched.

Defaultness is determined the way the catalogue determines it: a topic
is its subject's default iff it carries `legacy_skill_name` (migration
279: set ONLY on the default topic, partial unique index; catalogue
fallback branch keyed on `topic.legacy_skill_name`). At the gate the
configured branch's `topic` local is out of scope, so defaultness is
re-derived from the started topic's own row (`findTopicById`).

## The query change

`routes/assessments.js`, `POST /start` retake gate only. The single
ternary read becomes a three-way branch on `(hasTopic, isDefaultTopic)`:

- `!hasTopic` → the original skill-wide query, byte-for-byte.
- `hasTopic && !isDefaultTopic` → the #1686 per-topic query, byte-for-byte.
- `hasTopic && isDefaultTopic` → the widened read:

```sql
SELECT skill_assessments.completed_at FROM skill_assessments
LEFT JOIN assessment_sessions ON assessment_sessions.id = skill_assessments.session_id
LEFT JOIN assessment_topics ON assessment_topics.id = $3
WHERE skill_assessments.user_id = $1 AND skill_assessments.skill_id = $2
  AND skill_assessments.completed_at IS NOT NULL
  AND (assessment_sessions.topic_id = $3
       OR (assessment_topics.legacy_skill_name IS NOT NULL
           AND (assessment_sessions.topic_id IS NULL OR skill_assessments.session_id IS NULL)))
ORDER BY skill_assessments.completed_at DESC LIMIT 1
```

Care points, per the dispatch and the #1686 fix-round lesson
(`d7f6cb086`):

- LEFT JOIN, not INNER: the INNER JOIN structurally excludes
  `session_id IS NULL` rows no matter what the predicate says. Under
  the LEFT JOIN both topic-less forms surface as `topic_id IS NULL`;
  the predicate names BOTH forms explicitly regardless.
- Every column reference is qualified (`skill_assessments.completed_at`
  etc.) — the unqualified `completed_at` was ambiguous against
  `assessment_sessions.completed_at` once before. Column audit against
  the live schema definitions: `skill_assessments.session_id`
  (migration 006), `assessment_sessions.topic_id` (migration 280),
  `assessment_topics.legacy_skill_name` (migration 279) — all exist as
  referenced.
- The joined topics row re-checks `legacy_skill_name IS NOT NULL`
  inside the predicate, so the widening cannot leak onto a non-default
  topic even if the branch selection above it ever changed.
- A completion keyed to a DIFFERENT topic still never counts: its
  session's `topic_id` is neither `$3` nor NULL.

The 30-day constant, `canRetakeSkill`, the 403 body (`RETAKE_LOCKOUT`,
`lockoutDays`, `lastCompletedAt` — now possibly the topic-less row's own
date, which is exactly what the catalogue surfaces), and the gate's
position (before abandon) are unchanged. No schema change, no migration,
no new dependencies, no catalogue change.

## Tests — red first

Harness note (same as #1686): the C2/C3 suites run the real route
handler against a stateful mocked pool that applies a filter ONLY when
the route's SQL actually carries the predicate — regression pins, NOT
the HL-003 E2E-on-dev gate (the fresh-install journey proof remains for
the parent's landing pass, as with prior C-series lanes).

Added `describe('POST /start — default-topic retake lockout counts
topic-less completions (#1716)')` to
`server/__tests__/routes/assessments-config-1654.test.js` (the #1686
gate suite's home). Topics: 20 = Python Core (default,
`legacy_skill_name 'Python'`), 21 = Python Advanced (non-default):

- **(1)** Default topic + topic-less completion, `session_id IS NULL`
  form, 2 days old → **403 RETAKE_LOCKOUT**, `lockoutDays 30`,
  `lastCompletedAt` = the topic-less row's own date (same response
  shape as a topic-keyed lockout); no session created.
- **(2)** Default topic + topic-less completion via a session with
  `topic_id IS NULL`, 2 days old → **403**, same shape.
- **(3)** NON-default topic + the same topic-less history (both forms,
  2 days old) → **200**, session created on topic 21 (#1686 behaviour
  pinned — this is #1686 case (c)'s shape, now also discriminating the
  #1716 widening).
- **(4)** Default topic + topic-less completions (both forms) 31 days
  old → **200** (outside the 30-day window).

The gate branches of both suite dispatchers (C2
`assessments-config-1654.test.js` + C3
`assessments-sets-retake-progress-1656.test.js`, mirroring the #1686
lane's practice) now emulate the widening under the suites' standing
rule: topic-less rows count ONLY when the route's SQL carries the LEFT
JOIN, the `legacy_skill_name IS NOT NULL` guard and both explicit
`IS NULL` predicates, AND the started topic actually carries a
`legacy_skill_name` in the fixture. The #1686 block header in the C2
suite records that its STOP 1 edge decision is superseded for the
default topic only; every #1686 assertion stands unmodified.

**RED** (tests + dispatchers only, pristine route; saved at
`evidence-1716/red.txt`): C2 suite **2 failed / 34 passed / 36 total** —
cases (1) and (2) failed with `Expected: 403, Received: 200` (the exact
corner: the gate allowed what the catalogue showed as locked); cases
(3), (4) and all 32 pre-existing tests passed.

**GREEN** (post-fix; saved at `evidence-1716/green.txt`):

- C2 (1654) + catalogue C1 (1653) + C3 (1656) together: **69 passed /
  69 total** — the catalogue suites pass unmodified against untouched
  catalogue code (no regression), and the #1686 gate suite is green
  including its original (a)/(b)/(c) pins.
- Full `assessments-*` neighbour run: **14 failed / 149 passed /
  163 total**, where all 14 failures sit in the same 4 suites
  (`assessments-score-roundtrip`, `assessments-short-answer-honesty-1572`,
  `assessments-retake-lockout`, `assessments-graded-confidence-1584`)
  that fail **identically on pristine dev** — verified by running those
  4 suites in the pristine main checkout at `59d568553` and diffing the
  failing test names: identical, zero regressions. (Pristine full-run
  baseline: 14 failed / 145 passed / 159 total; the delta is exactly
  the 4 new #1716 tests, all passing.)

## Deviations / notes

- None from the ruling. The widened branch adds one PK lookup
  (`findTopicById`) per topic start to re-derive defaultness; the
  non-default and topic-less query texts are byte-for-byte what #1686
  left.
- No GitHub writes, no pushes (HL-007): local branch + commit only;
  the parent verifies first-hand and lands.
- No E2E-on-dev run in this lane (worktree-only, per dispatch); the
  fresh-install journey proof remains for the parent's landing pass.
  Local Postgres was not running in this worktree session, so the
  widened SQL's real-PG proof also rides that pass; in-lane assurance
  is the column audit above plus the predicate-faithful suite
  emulation.
