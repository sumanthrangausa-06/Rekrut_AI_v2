# Question-bank coverage — C5 Batch 4 (#1694, parent #1658, EPIC #1603)

Seeded by migration `288_seed_batch4_question_bank.js`. This batch takes
Communication, Machine Learning, Project Management and System Design from
the fresh-install state measured at STOP 1 on #1658 (comment 6349488581)
to the design §7 launch floor.

All new rows are `multiple_choice` with 4 options; each `correct_answer`
is character-identical to one option (scoring is exact string equality)
and was reviewed for factual correctness by the author and by the
Interviewer persona on the batch PR (design §9 C5 specialist). Inserts
are duplicate-guarded on (skill_category, difficulty_level,
question_text).

Phase C provenance (architecture §7 rule 6(d)): every row is inserted
with `source='seed'`, `review_status='approved'`, `format='mcq'`, and
`topic_id` resolved by the §6 join on
`LOWER(skill_category) = LOWER(assessment_topics.legacy_skill_name)`.

## Batch 4 — +19 approved MCQ per topic, +1 easy-band correction (77 rows)

Per topic: difficulty 2 ×6, difficulty 3 ×7, difficulty 4 ×6 — except
Communication, which carries one extra L2 row (+20): its pre-batch MCQ
base at L1 is 1, not 2 (its second d1 row is the legacy short_answer), so
+19 alone left its easy band at 9 on the fresh-install rig. Bands overlap
by design (§5.1): easy = levels {1,2}, medium = {2,3,4}, hard = {4,5}.

| Topic              | Easy before → after | Medium before → after | Hard before → after | Approved MCQ total after |
|--------------------|--------------------|-----------------------|---------------------|--------------------------|
| Communication      | 3 → **10** ✓       | 6 → **26** ✓          | 4 → **10** ✓        | 29                       |
| Machine Learning   | 4 → **10** ✓       | 6 → **25** ✓          | 4 → **10** ✓        | 29                       |
| Project Management | 4 → **10** ✓       | 6 → **25** ✓          | 4 → **10** ✓        | 29                       |
| System Design      | 4 → **10** ✓       | 6 → **25** ✓          | 4 → **10** ✓        | 29                       |

✓ = meets §7 rule-4 launch floor (medium ≥ 25) and clears every rule-2 /
flag-(c) cell (easy ≥ 10, hard ≥ 10). The "before" easy figure for
Communication counts MCQ only; its legacy short_answer row additionally
serves in mixed configurations (§4.6) and is untouched.

Evidence: fresh-install rig (embedded PostgreSQL 18.4 + pgvector 0.8.7,
database built only by `node migrate.js` from empty) — the first GREEN
run measured Communication easy at 9 and totals of 28, which is how the
extra row was caught; the re-run with 77 rows measured the table above,
and a second direct `up()` inserted 0 further rows (313 → 313).
