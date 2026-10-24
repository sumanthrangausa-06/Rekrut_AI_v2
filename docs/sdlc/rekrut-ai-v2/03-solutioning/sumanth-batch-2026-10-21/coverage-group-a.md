# Question-bank coverage — Group A (#1647, parent #1606)

Seeded by migration `281_seed_group_a_question_bank.js`. Bank-first serving
(`generateQuestion()` in routes/assessments.js) finds a row in every cell
below, so these assessments open and progress provider-free; the AI provider
is only consulted for cells with no bank row.

All rows are `multiple_choice` with 4 options; each `correct_answer` is
character-identical to one option (scoring is exact string equality) and was
self-reviewed for factual correctness by the author (Nova SME self-review,
STOP 1 on #1647). Inserts are duplicate-guarded on
(skill_category, difficulty_level, question_text).

Phase C provenance (architecture §7 rule 6(d)): migration 281 runs after
C0's 279/280, so every row is inserted with `source='seed'`,
`review_status='approved'` (curated seed rows are reviewed in their own PR;
without the explicit values they would default to `legacy`/`pending` and
not count as servable supply), `format='mcq'` (§3.4 derivation), and
`topic_id` resolved by the §6 join on
`LOWER(skill_category) = LOWER(assessment_topics.legacy_skill_name)`.

## Coverage (rows per skill × difficulty, read back from a fresh-install DB)

| Skill       | D1 | D2 | D3 | D4 | D5 | Total |
|-------------|----|----|----|----|----|-------|
| Node.js     | 2  | 2  | 2  | 2  | 2  | 10    |
| SQL         | 2  | 2  | 2  | 2  | 2  | 10    |
| TypeScript  | 2  | 2  | 2  | 2  | 2  | 10    |
| Java        | 2  | 2  | 2  | 2  | 2  | 10    |
| **Group A** | 8  | 8  | 8  | 8  | 8  | **40** |

## Verification (2026-10-22, fresh local Postgres, full `node migrate.js` chain)

- Migration 281 applied cleanly in the full fresh-install chain.
- Read-back: 2 rows in every Group A skill × difficulty cell; 40 Group A rows
  total; 0 MCQ rows in the bank whose correct_answer is not among its options.
- Duplicate guard proven: a second direct `up()` left the count at 40;
  `down()` removed exactly the 40 seeded rows; a further `up()` restored 40.
