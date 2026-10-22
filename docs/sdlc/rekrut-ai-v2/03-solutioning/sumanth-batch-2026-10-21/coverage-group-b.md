# Question-bank coverage — Group B (#1648, parent #1606)

Seeded by migration `283_seed_group_b_question_bank.js`. Bank-first serving
(`generateQuestion()` in routes/assessments.js) finds a row in every cell
below, so these assessments open and progress provider-free; the AI provider
is only consulted for cells with no bank row.

All rows are `multiple_choice` with 4 options; each `correct_answer` is
character-identical to one option (scoring is exact string equality) and was
self-reviewed for factual correctness by the author (Nova SME self-review,
STOP 1 on #1648). Inserts are duplicate-guarded on
(skill_category, difficulty_level, question_text).

Phase C provenance (architecture §7 rule 6(d)): migration 283 runs after
C0's 279/280, so every row is inserted with `source='seed'`,
`review_status='approved'` (curated seed rows are reviewed in their own PR;
without the explicit values they would default to `legacy`/`pending` and
not count as servable supply), `format='mcq'` (§3.4 derivation), and
`topic_id` resolved by the §6 join on
`LOWER(skill_category) = LOWER(assessment_topics.legacy_skill_name)`.

## Coverage (rows per skill × difficulty, read back from a fresh-install DB)

| Skill       | D1 | D2 | D3 | D4 | D5 | Total |
|-------------|----|----|----|----|----|-------|
| CSS & HTML  | 2  | 2  | 2  | 2  | 2  | 10    |
| AWS         | 2  | 2  | 2  | 2  | 2  | 10    |
| Docker      | 2  | 2  | 2  | 2  | 2  | 10    |
| Git         | 2  | 2  | 2  | 2  | 2  | 10    |
| **Group B** | 8  | 8  | 8  | 8  | 8  | **40** |

Approved servable supply per skill (`scripts/audit-assessment-coverage.js`,
bands easy {1,2} · medium {2,3,4} · hard {4,5}): mcq easy = 4, medium = 6,
hard = 4 for each of the four topics (HTML/CSS id 8, AWS id 9, Docker
id 10, Git id 11). Before this migration every band read approved = 0.

## Verification (2026-10-22, fresh local Postgres, full `node migrate.js` chain)

- RED (pristine origin/dev, pre-283): 0 bank rows for all four skills;
  coverage audit showed approved = 0 in every band for all four topics.
- Migration 283 applied cleanly in the full fresh-install chain.
- Read-back: 2 rows in every Group B skill × difficulty cell; 40 Group B
  rows total; every row `source='seed'`, `review_status='approved'`,
  `format='mcq'`, with `topic_id` resolved by the legacy-name join;
  0 MCQ rows in the bank whose correct_answer is not among its options.
- Still to re-run on the rig before merge (scripted, in the build log):
  the duplicate-guard / `down()` / `up()` cycle and the per-skill
  provider-free API journey (start → answer all → finish → results
  read back).
