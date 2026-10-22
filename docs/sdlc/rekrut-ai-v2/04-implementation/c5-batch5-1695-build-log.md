# #1695 — C5 Batch 5 question-bank coverage floor (build log)

**Gap (parent #1658, EPIC #1603):** OOP is the only launch topic with no
question bank at all — a different gap shape from Batches 1–4, which
topped up a uniform 10-row base. Migration 279 seeded the OOP *subject*
but its default-topic list seeded topics for only 16 skills, omitting
OOP; consequently no `assessment_topics` row has
`legacy_skill_name = 'OOP'` and no migration seeds any `'OOP'` question
rows (grep across `migrations/` returns only the 279 subject row). The
topic could not be served: no topic to attach a session to, no questions
to draw.

**Fix:** `migrations/289_seed_batch5_question_bank.js` — one expand-only
seed migration following the 281/283/284/285/288 pattern, extended with
the two steps this gap shape requires: (1) an idempotent topic insert
cloning migration 279's own topic insert verbatim in shape (subject slug
lookup on `'oop'`, slug `'general'`, name = subject name ||
' — General', `legacy_skill_name 'OOP'`, `ON CONFLICT (subject_id,
slug) DO NOTHING`), run before the question inserts so their `topic_id`
join resolves; (2) a post-state assertion inside `up()` (279 precedent)
that reads back the OOP topic's approved-MCQ per-level counts and throws
unless they are exactly L1=2, L2=8, L3=9, L4=8, L5=2 — it holds on a
re-run because inserts are duplicate-guarded. The bank itself: 29
multiple-choice rows (L1 ×2 / L2 ×8 / L3 ×9 / L4 ×8 / L5 ×2; time limits
60/90/90/120/120 following the 281/283/284 pattern), each with 4
distinct options, a `correct_answer` character-identical to one option,
and an explanation. Rows ship `source='seed'`,
`review_status='approved'`, `format='mcq'` with `topic_id` resolved by
the §6 legacy-name join; inserts are duplicate-guarded on
(skill_category, difficulty_level, question_text). `down()` deletes
exactly the seeded rows, then deletes the created topic ONLY if no
`assessment_questions`, `assessment_sessions` (topic_id column added by
migration 280) or `assessment_sets` row references it — otherwise it
leaves the topic in place and logs why; it never cascade-deletes user
data. No code paths change.

**Specialist decision (STOP 1, #1695):** YES — Interviewer persona
reviews every question in the batch PR (question quality at scale is the
risk domain, design §9 C5). The author additionally self-reviewed each
row as the Interviewer persona before delivery; rows where a distractor
was defensible were rewritten (see Content hygiene).

**Content rules applied:** language-neutral OOP concepts only — no
syntax claims and no claim true in one mainstream language and false in
another; stems describe behaviour and design situations. No bare
definition recall at L4/L5: all ten L4/L5 rows are applied scenarios
(deep-inheritance redesign, Open/Closed and Dependency Inversion in
failing codebases, a Square/Rectangle Liskov violation, a fat-interface
remedy, Factory/Observer recognition in context, Tell-Don't-Ask
refactor, Adapter under a no-modification constraint, Strategy for
run-time algorithm selection). L1 rows are basic concepts; L2/L3 rows
are applied understanding.

**Content hygiene:** no prior `'OOP'` rows exist to duplicate (grep
evidence above), and the 29 texts are newly written and concept-keyed —
distinct from the syntax- or language-keyed OOP-adjacent rows carried
under the Java/JavaScript skills in batches 1–4. Within-file checks
(the author's node self-check): 29 rows; per-level counts 2/8/9/8/2;
every row exactly 4 distinct options with `correct` among them; no
duplicate question texts; time limits per pattern. Self-review catches
during authoring: the L3 abstraction row's distractors were rewritten
so none restates encapsulation's data-hiding definition (the classic
abstraction/encapsulation ambiguity); the L3 abstract-class row keys on
shared *stored state plus implemented helper* — the one capability an
interface alone does not provide — rather than on default methods,
which some languages do allow on interfaces; the L5 Strategy row states
the per-order run-time selection explicitly so a singleton reading is
not defensible.

**Rig evidence (fresh-install, HL-003):** PENDING — parent-run. This
deliverable was authored as files only (HL-007 landing rule: the author
makes no GitHub or rig claims). The parent (Lead/Suga) runs the
fresh-install rig on landing: empty database built only by
`node migrate.js`, OOP per-level counts read back from the database
(expected exactly 2/8/9/8/2; bands easy 10 / medium 25 / hard 10), and a
second direct `up()` expected to insert 0 further rows. The parent
fills this section with the measured result before the issue is closed.

**Review history:** pending — the batch PR records the Interviewer
review outcome when it runs.
