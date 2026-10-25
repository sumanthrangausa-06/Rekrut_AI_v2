# Build Log — #1688: Results view groups attempts by topic (design §4.5 remainder)

**Story:** #1688 — [FOLLOW-UP #1656 G7] Results view does not group
attempts by topic (design §4.5 remainder)
**Branch:** `nova/1688-results-by-topic` (off dev `4d1f650ce`, which
includes the #1686 merge — sequenced after it per STOP 1 §8)
**Persona:** Nova (build lane) · Design authority: Scout's STOP 1 on
#1688 (comment 6356181525), architecture
`03-solutioning/sumanth-batch-2026-10-21/architecture-assessments-phase-c.md`
§4.5 / SF-10 (`:172`, `:213`). Specialist: Candidate Experience
(grouping/wording lens, STOP 1 §5) — its review is a landing gate run
by the parent after this lane.
**Status:** Built in worktree, committed locally — parent verifies and
lands (HL-007). User-visible behaviour change: the candidate My
Results tab now groups completed attempts by topic.

## What changed

Exactly two source files, as ruled in STOP 1 §7:

### Server — `routes/assessments.js`, `GET /results` ONLY

The route already LEFT JOINed the producing `assessment_sessions`
row; it selected none of its snapshot columns and never joined
`assessment_topics`, so no topic could reach the client. The query now
additionally selects, snake_case per this payload's raw-passthrough
convention (STOP 1 §2.3(3)):

```sql
ass.topic_id AS topic_id, ass.format AS format,
ass.difficulty_band AS difficulty_band, t.name AS topic_name
```

plus `LEFT JOIN assessment_topics t ON t.id = ass.topic_id`.
Ordering (`ORDER BY sa.completed_at DESC`), the user filter, and
every existing field are untouched. No schema change, no other
handler (`GET /session/:sessionId` has the same gap and is
explicitly out of scope — a follow-up for Lead, per STOP 1 §1).

### Client — `client/src/pages/candidate/assessments.tsx`, My Results tab ONLY

- `AssessmentResult` gains the four nullable fields (`topic_id`,
  `topic_name`, `format`, `difficulty_band`).
- The already-DESC-ordered results are grouped by `topic_id` before
  rendering. Group order is first appearance in the payload
  (most-recently-attempted topic first — no new sort). Cards within a
  group keep server order and their markup is unchanged, except each
  card's meta row gains the recorded configuration label
  `{formatLabel} · {bandLabel}` when the snapshot carries it.
- Group heading: `{skill_name} · {topic_name}` (design SF-10 form,
  e.g. "Python · Comprehensions").
- Format/band labels reuse the shipped configure/take vocabulary
  verbatim (UX spec §0.2): `mcq → Multiple choice`,
  `short_answer → Written answers`,
  `mixed → Mixed — multiple choice and written answers`,
  `coding → Coding`; bands `Easy / Medium / Hard`. No third
  vocabulary was coined.

## The grouping rule + the legacy bucket (and why)

Attempts whose `topic_id` is NULL — pre-snapshot attempts, attempts
with no session row, skills with no catalogue topic, and topics
deleted after the attempt (FK `ON DELETE SET NULL`) — collect into
ONE trailing group, rendered after every topic group regardless of
recency, headed exactly:

> **Earlier assessments — topic not recorded**

Why this wording and placement (STOP 1 §4): the no-fake-data rule. A
topic-less attempt has no recorded topic, so the heading states
exactly that fact instead of inventing a category ("General", "Mixed
topics") or deriving a topic from the skill name (a skill is not its
default topic once topics multiply — SF-10). The bucket must not
interleave with real topic groups and masquerade as one, so it is
always last. The skill name stays on the legacy cards (it is real
recorded data), and a recorded format/band label may still render on
a topic-less card when those snapshot fields themselves are present
(case (b) in STOP 1 §4) — the label keys off its own fields, never
off an inferred topic. When format/band are NULL, no label renders.

## Tests — red first

Two new suites, per STOP 1 §6 (no suite covered `GET /results`
before this story):

- `server/__tests__/routes/assessments-results-topic-1688.test.js`
  (T1–T4) — stateful SQL-dispatcher in the neighbouring suites'
  style; the dispatcher materialises the snapshot fields ONLY when
  the route's SQL actually selects them and `topic_name` only when
  it actually LEFT JOINs `assessment_topics` (an INNER join drops
  legacy rows in the emulation, as in Postgres). T1 per-session
  snapshot values; T2 legacy keys present with null values; T3
  cross-user isolation + DESC order + existing fields unchanged;
  T4 denylist (no question-content keys).
- `client/src/pages/candidate/assessments-results-grouping-1688.test.tsx`
  (C1–C4) — the user journey: two topics interleaved by date render
  grouped (most-recent topic first), a newest-of-all topic-less
  attempt renders LAST under the exact legacy heading, the
  format/band label uses the shipped vocabulary and renders nothing
  when null, the empty state is unchanged, and the Partial badge
  behaviour is unchanged inside groups.

**RED** (pristine base): server 2 failed / 2 passed (T1, T2 fail —
fields `undefined` / keys absent; T3, T4 are regression guards and
pass on base); client 5 failed / 1 passed (C4a empty-state guard
passes on base).

**GREEN** (post-fix): new server suite 4/4; new client suite 6/6;
client assessments set (configure-1654 + take-1654 + legacy-label-1683
+ new grouping suite) 54/54 across 4 files; full server
`assessments-*` run 145 passed / 14 failed / 159 total, where all 14
failures sit in the same 4 suites (`assessments-score-roundtrip`,
`assessments-short-answer-honesty-1572`, `assessments-retake-lockout`,
`assessments-graded-confidence-1584`) that fail **identically on
pristine dev** — verified by stashing this lane's tracked changes and
re-running those 4 suites unmodified, then with the changes applied:
same 14 failed / 8 passed / 22 total and identical failing test
names both ways (the same pre-existing set the #1686 build log
recorded). Pre-existing failures, zero regressions. `tsc --noEmit`
shows no errors in the touched client files (77 pre-existing errors
elsewhere in the project, unchanged by this lane).

Evidence logs live in the run's hidden_files evidence directory
(they are gitignored working evidence, not PR artefacts).

## Deviations

- None from the ruled STOP 1 shape. No STOP 1 fact proved wrong in
  the worktree: the route, query, interface, tab location, and label
  strings all matched §§1–3 at the new base (which adds only the
  #1686 merge in a different region of the same file).
- Harness note: Radix `TabsTrigger` renders a plain `<button>` with
  no `tab` role in this jsdom environment, so the client suite clicks
  the My Results trigger by its visible label (noted in the suite).
- No E2E-on-dev run in this lane (worktree-only, per dispatch); the
  HL-003 fresh-install journey proof, the Candidate Experience label
  review, and independent code review remain landing gates for the
  parent.
