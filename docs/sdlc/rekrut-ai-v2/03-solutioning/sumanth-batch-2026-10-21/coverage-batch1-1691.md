# Question-bank coverage — C5 Batch 1 (#1691, parent #1658, EPIC #1603)

Seeded by migration `285_seed_batch1_question_bank.js`. This batch takes the
four highest-traffic topics — JavaScript, Python, React, Node.js — from the
fresh-install state measured at STOP 1 on #1658 (comment 6349488581: every
topic at exactly 10 approved MCQ, 2 per difficulty level) to the design §7
launch floor.

All new rows are `multiple_choice` with 4 options; each `correct_answer` is
character-identical to one option (scoring is exact string equality) and was
reviewed for factual correctness by the author and by the Interviewer
persona on the batch PR (design §9 C5 specialist). Inserts are
duplicate-guarded on (skill_category, difficulty_level, question_text).

Phase C provenance (architecture §7 rule 6(d)): every row is inserted with
`source='seed'`, `review_status='approved'`, `format='mcq'` (§3.4
derivation), and `topic_id` resolved by the §6 join on
`LOWER(skill_category) = LOWER(assessment_topics.legacy_skill_name)`.

## Batch 1 — +19 approved MCQ per topic (76 rows)

Per topic: difficulty 2 ×6, difficulty 3 ×7, difficulty 4 ×6. Bands overlap
by design (§5.1): easy = levels {1,2}, medium = {2,3,4}, hard = {4,5}.

| Topic      | Easy before → after | Medium before → after | Hard before → after | Approved MCQ total after |
|------------|--------------------|-----------------------|---------------------|--------------------------|
| JavaScript | 4 → **10** ✓       | 6 → **25** ✓          | 4 → **10** ✓        | 29                       |
| Python     | 4 → **10** ✓       | 6 → **25** ✓          | 4 → **10** ✓        | 29                       |
| React      | 4 → **10** ✓       | 6 → **25** ✓          | 4 → **10** ✓        | 29                       |
| Node.js    | 4 → **10** ✓       | 6 → **25** ✓          | 4 → **10** ✓        | 29                       |

✓ = meets §7 rule-4 launch floor (medium ≥ 25) and clears every rule-2 /
flag-(c) cell (easy ≥ 10, hard ≥ 10).

Evidence: fresh-install rig (embedded PostgreSQL 18.4 + pgvector 0.8.7,
database built only by `node migrate.js` from empty) — RED run without
migration 285 reproduced 4/6/4 per topic; GREEN run with 285 measured the
table above; a second direct `up()` inserted 0 further rows (237 → 237,
duplicate guard); 0 rows in the whole seeded bank violate the
correct_answer ∈ options invariant. Full outputs in the goal workspace
hidden files (`c5-batch1-rig/`).
