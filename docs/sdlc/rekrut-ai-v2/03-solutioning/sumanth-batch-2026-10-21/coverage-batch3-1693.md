# Question-bank coverage — C5 Batch 3 (#1693, parent #1658, EPIC #1603)

Seeded by migration `287_seed_batch3_question_bank.js`. This batch takes
AWS, Docker, Git and CSS & HTML from the fresh-install state measured at
STOP 1 on #1658 (comment 6349488581: every topic at exactly 10 approved
MCQ, 2 per difficulty level) to the design §7 launch floor.

All new rows are `multiple_choice` with 4 options; each `correct_answer`
is character-identical to one option (scoring is exact string equality)
and was reviewed for factual correctness by the author and by the
Interviewer persona on the batch PR (design §9 C5 specialist) — including
a BLOCK round that fixed the Git merge-vs-rebase key (the original
wording implied merging always creates a merge commit, which is false
for fast-forward merges; the key now qualifies "when the branches have
diverged"). Inserts are duplicate-guarded on (skill_category,
difficulty_level, question_text).

Naming note: the subject's display name is 'HTML/CSS' (migration 279
§3.1 rename); the bank's `skill_category` and the topic's
`legacy_skill_name` remain 'CSS & HTML', which is what this migration
targets and joins on.

Phase C provenance (architecture §7 rule 6(d)): every row is inserted
with `source='seed'`, `review_status='approved'`, `format='mcq'`, and
`topic_id` resolved by the §6 join on
`LOWER(skill_category) = LOWER(assessment_topics.legacy_skill_name)`.

## Batch 3 — +19 approved MCQ per topic (76 rows)

Per topic: difficulty 2 ×6, difficulty 3 ×7, difficulty 4 ×6. Bands
overlap by design (§5.1): easy = levels {1,2}, medium = {2,3,4},
hard = {4,5}.

| Topic      | Easy before → after | Medium before → after | Hard before → after | Approved MCQ total after |
|------------|--------------------|-----------------------|---------------------|--------------------------|
| AWS        | 4 → **10** ✓       | 6 → **25** ✓          | 4 → **10** ✓        | 29                       |
| Docker     | 4 → **10** ✓       | 6 → **25** ✓          | 4 → **10** ✓        | 29                       |
| Git        | 4 → **10** ✓       | 6 → **25** ✓          | 4 → **10** ✓        | 29                       |
| CSS & HTML | 4 → **10** ✓       | 6 → **25** ✓          | 4 → **10** ✓        | 29                       |

✓ = meets §7 rule-4 launch floor (medium ≥ 25) and clears every rule-2 /
flag-(c) cell (easy ≥ 10, hard ≥ 10).

Evidence: fresh-install rig (embedded PostgreSQL 18.4 + pgvector 0.8.7,
database built only by `node migrate.js` from empty) — GREEN run
measured the table above; topic-join check: 231/231 seed rows carry
topic_id and the topic-level medium count for subject 'HTML/CSS' is 25;
a second direct `up()` inserted 0 further rows (237 → 237 in the
batch-isolated rig database).
