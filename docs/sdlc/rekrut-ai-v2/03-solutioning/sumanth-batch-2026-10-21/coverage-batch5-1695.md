# Question-bank coverage — C5 Batch 5 (#1695, parent #1658, EPIC #1603)

Seeded by migration `289_seed_batch5_question_bank.js`. This batch is
unlike Batches 1–4: OOP had **no bank at all** to top up. Migration 279
seeded the OOP *subject* (`assessment_subjects` slug `oop`) but its
default-topic list covered only 16 skills and OOP was not among them, so
no `assessment_topics` row carries `legacy_skill_name = 'OOP'`, and no
migration seeds any `'OOP'` question rows (verified by grep across
`migrations/`: the only `'OOP'` hit is the 279 subject row). Migration
289 therefore creates the topic itself — cloning 279's topic insert
exactly (subject slug lookup, slug `general`, name = subject name ||
' — General', `legacy_skill_name = 'OOP'`, `ON CONFLICT (subject_id,
slug) DO NOTHING`) — and then seeds the entire bank.

All new rows are `multiple_choice` with 4 options; each `correct_answer`
is character-identical to one option (scoring is exact string equality)
and was reviewed for factual correctness by the author with an
Interviewer-persona self-review (design §9 C5 specialist). Content is
language-neutral OOP concepts only — no language-specific syntax claims;
L4/L5 rows are applied design scenarios, not definition recall. Inserts
are duplicate-guarded on (skill_category, difficulty_level,
question_text), and `up()` ends with a post-state assertion that throws
unless the topic holds exactly L1=2, L2=8, L3=9, L4=8, L5=2 approved
MCQ.

Phase C provenance (architecture §7 rule 6(d)): every row is inserted
with `source='seed'`, `review_status='approved'`, `format='mcq'`, and
`topic_id` resolved by the §6 join on
`LOWER(skill_category) = LOWER(assessment_topics.legacy_skill_name)`.

## Batch 5 — OOP created from empty (29 rows)

Per topic: difficulty 1 ×2, difficulty 2 ×8, difficulty 3 ×9,
difficulty 4 ×8, difficulty 5 ×2. Bands overlap by design (§5.1):
easy = levels {1,2}, medium = {2,3,4}, hard = {4,5}. Because the base
is zero, the seeded rows alone must satisfy every floor — and do:
easy 10, medium 25, hard 10.

| Topic | Easy before → after | Medium before → after | Hard before → after | Approved MCQ total after |
|-------|--------------------|-----------------------|---------------------|--------------------------|
| OOP   | 0 → **10** ✓       | 0 → **25** ✓          | 0 → **10** ✓        | 29                       |

✓ = meets §7 rule-4 launch floor (medium ≥ 25) and clears every rule-2 /
flag-(c) cell (easy ≥ 10, hard ≥ 10). The "before" figures are zero in
every band: before this migration the topic did not exist and held no
questions.

Content map (concepts covered, by level): L1 — class vs object,
encapsulation. L2 — inheritance reuse, polymorphism, constructor
validation, access control/invariants, overriding vs overloading,
static vs instance members, composition (has-a), interfaces as
contracts. L3 — abstraction, Liskov Substitution, cohesion,
coupling/dependency injection, abstract class vs interface, dynamic
dispatch, immutability, aggregation vs composition, protected access.
L4 (applied scenarios) — composition over inheritance, Open/Closed,
Dependency Inversion, a Liskov violation (Square/Rectangle), Interface
Segregation, Factory, Observer, Tell-Don't-Ask / Law of Demeter.
L5 (applied scenarios) — Adapter for an unmodifiable third-party
component, Strategy for run-time algorithm selection.

Evidence: **PENDING parent rig.** Fresh-install verification (embedded
PostgreSQL, database built only by `node migrate.js` from empty;
per-level counts read back from the database; second direct `up()`
inserting 0 further rows) is run by the parent (Lead/Suga) when this
migration is landed — per HL-007 the author does not claim rig results
that were not produced in this environment. The author's own file-level
self-check (29 rows, per-level counts 2/8/9/8/2, 4 distinct options per
row, correct ∈ options, no duplicate texts, time limits 60/90/90/120/120)
passed; its verbatim output travels with the build log for this batch.
