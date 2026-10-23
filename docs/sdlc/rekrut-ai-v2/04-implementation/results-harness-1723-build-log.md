# Build log — #1723 results-grouping test tightening (test hygiene, no production change)

**Lane:** Nova (Phase 4), advance run 2026-10-23. STOP 1 on issue #1723
(comment 6368827980). Base: dev `00948ffeccc447485be6b901e62853c78e3757a5`.
**Scope rule honoured:** only test files changed; both production files
touched for mutation proof were restored byte-identical (`git status`
shows no production diff).

## What changed

### Client — `client/src/pages/candidate/assessments-results-grouping-1688.test.tsx`
- **F4:** C3c pins ALL 7 shipped config labels verbatim
  (`mixed`/`mcq`/`short_answer`/`coding` + `easy`/`medium`/`hard`) as the
  exact joined span text, plus format-only and band-only single-part pins.
- **C2b:** a topic-less attempt that is NOT the oldest (middle by date)
  still renders in the trailing legacy group, after both topic groups.
- **C5:** topic_id set / topic_name NULL → heading falls back to the bare
  skill name, then to the bare title when skill_name is also NULL; no
  fabricated topic, no `null`/`undefined` text.
- **F2 (documented in-suite, C6 pin):** grouping keys on topic_id alone.
  Evidence: `assessment_topics.subject_id` is `INT NOT NULL REFERENCES
  assessment_subjects(id)` with `UNIQUE(subject_id, slug)` (migration
  279) — one subject per topic; configured starts resolve the candidate
  skill by the subject's default topic's `legacy_skill_name`
  (routes/assessments.js §3.6), so every topic of a subject shares one
  skill_name; legacy starts snapshot only the skill's own default topic
  (unique partial index `uq_assessment_topics_legacy_skill_name`).
  topic_id therefore determines skill_name; re-keying on
  (topic_id, skill_name) would change production code to defend against
  a state the write paths cannot produce — not done, per lane scope.

### Server — `server/__tests__/routes/assessments-results-topic-1688.test.js`
- **M1:** the /results mock dispatcher now applies the user filter ONLY
  when the SQL text carries `sa.user_id = $1`, and the completed_at DESC
  sort ONLY when the SQL text carries `order by sa.completed_at desc` —
  mirroring the stricter neighbouring suites
  (assessments-retake-lockout.test.js gates on
  'order by completed_at desc'; assessments-deadlines.test.js /
  assessments-start-enforce.test.js gate on 'order by created_at').

## Evidence

| Run | Server suite | Client suite |
|---|---|---|
| Before (pristine origin/dev) | 4 passed / 4 | 6 passed / 6 |
| After (this branch) | 4 passed / 4 | 15 passed / 15 |

Mutation discrimination (mutations applied to the route/production file
locally, suite run, file restored byte-identical and verified by
`git diff`/`cmp`):
- Drop `WHERE sa.user_id = $1` from GET /results → T3 RED
  (`Expected length: 2, Received length: 3` — user 9's row leaked in).
- Drop `ORDER BY sa.completed_at DESC` → T3 RED
  (scores returned `[70, 90]` seed order instead of `[90, 70]`).
- Drift production label `Multiple choice` → `Multiple Choice` → C3 and
  C3c(mcq) RED, 13 passed — the F4 pin catches vocabulary drift.

Full mutation outputs are in the run's evidence bundle (goal hidden
files, lane-1723/evidence/).
