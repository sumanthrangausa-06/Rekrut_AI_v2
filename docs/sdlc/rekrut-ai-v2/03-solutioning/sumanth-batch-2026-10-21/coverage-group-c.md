# Question-bank coverage — Group C + legacy completion (#1649, parent #1606)

Seeded by migration `284_seed_group_c_question_bank.js`. Bank-first serving
(`generateQuestion()` in routes/assessments.js) finds a row in every cell
below, so these assessments open and progress provider-free; the AI provider
is only consulted for cells with no bank row.

All new rows are `multiple_choice` with 4 options; each `correct_answer` is
character-identical to one option (scoring is exact string equality) and was
self-reviewed for factual correctness by the author (Nova SME self-review,
STOP 1 on #1649). Inserts are duplicate-guarded on
(skill_category, difficulty_level, question_text).

Phase C provenance (architecture §7 rule 6(d)): migration 284 runs after
C0's 279/280, so every row is inserted with `source='seed'`,
`review_status='approved'` (curated seed rows are reviewed in their own PR;
without the explicit values they would default to `legacy`/`pending` and
not count as servable supply), `format='mcq'` (§3.4 derivation), and
`topic_id` resolved by the §6 join on
`LOWER(skill_category) = LOWER(assessment_topics.legacy_skill_name)`.

## Group C — 2 new MCQ per cell (40 rows)

| Skill              | D1 | D2 | D3 | D4 | D5 | New | Bank total after |
|--------------------|----|----|----|----|----|-----|------------------|
| Data Analysis      | 2  | 2  | 2  | 2  | 2  | 10  | 10               |
| System Design      | 2  | 2  | 2  | 2  | 2  | 10  | 10               |
| Project Management | 2  | 2  | 2  | 2  | 2  | 10  | 10               |
| Machine Learning   | 2  | 2  | 2  | 2  | 2  | 10  | 10               |

## Legacy completion — topped up to >= 2 servable per cell, no further (35 rows)

Fresh-install starting state (migration 006 rows, approved by 280's
curation pass): JavaScript MCQ d2 x1, d3 x1; Python MCQ d2 x1; React MCQ
d2 x1; Communication short_answer d1 x1.

| Skill         | Cell additions (new MCQ)              | New | Bank servable per cell after |
|---------------|---------------------------------------|-----|------------------------------|
| JavaScript    | d1 +2, d2 +1, d3 +1, d4 +2, d5 +2      | 8   | 2 / 2 / 2 / 2 / 2 (mcq)      |
| Python        | d1 +2, d2 +1, d3 +2, d4 +2, d5 +2      | 9   | 2 / 2 / 2 / 2 / 2 (mcq)      |
| React         | d1 +2, d2 +1, d3 +2, d4 +2, d5 +2      | 9   | 2 / 2 / 2 / 2 / 2 (mcq)      |
| Communication | d1 +1, d2 +2, d3 +2, d4 +2, d5 +2      | 9   | d1 mixed 2 (1 short_answer + 1 mcq); d2–d5 mcq 2 |

**Communication judgment (STOP 1 on #1649):** Communication gains MCQ
rows rather than staying short_answer-only. MCQ rows are scored by exact
string equality with no provider involved; under design §4.6 a `mixed`
session serves `format IN ('mcq','short_answer')` and
servable(mixed) = servable(mcq) + servable(short_answer), so the MCQ rows
count toward Communication's supply alongside its legacy short_answer
row, which is untouched and still serves. The alternative (short_answer
only) would have met the numeric target while leaving Communication with
no deterministically-scored row at any difficulty.

Approved servable supply per skill (`scripts/audit-assessment-coverage.js`,
bands easy {1,2} · medium {2,3,4} · hard {4,5}): mcq easy = 4, medium = 6,
hard = 4 for Data Analysis (topic 12), System Design (13), Project
Management (14), Machine Learning (16), JavaScript (1), Python (2) and
React (3); Communication (15) mcq easy = 3, medium = 6, hard = 4, plus
short_answer easy = 1, giving mixed easy = 4, medium = 6, hard = 4.
Before this migration the Group C topics read approved = 0 in every band.

## Verification (2026-10-22, fresh embedded Postgres 16, full `node migrate.js` chain)

- RED (pristine origin/dev @ 040407e31, pre-284): 0 bank rows for all four
  Group C skills; legacy cells below target in 40/40 audited cells.
- Migration 284 applied cleanly in the full fresh-install chain.
- Read-back: every Group C and legacy cell at exactly 2 servable rows
  (Communication d1 = 2 via mixed); 75 new rows total, all
  `source='seed'`, `review_status='approved'`, `format='mcq'`, with
  `topic_id` resolved by the legacy-name join; 0 MCQ rows bank-wide whose
  correct_answer is not among its options.
- Duplicate-guard cycle: 75 → down() 0 → up() 75 → up() again 75.
- Builder-evidence API journey (not Quinn's gate): all 8 skills started
  provider-free, answered 10/10, completed, with results read back.
