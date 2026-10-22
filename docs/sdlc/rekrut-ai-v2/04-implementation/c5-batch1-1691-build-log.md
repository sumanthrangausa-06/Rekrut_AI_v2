# #1691 — C5 Batch 1 question-bank coverage floor (build log)

**Gap (parent #1658, EPIC #1603):** STOP 1 fresh-install evidence (#1658
comment 6349488581) showed every one of the 16 catalogue topics holding
exactly 10 approved MCQ — bands easy 4 / medium 6 / hard 4 — so 0 of 16
topics met the design §7 rule-4 launch floor (servable ≥ 25 MCQ/Medium)
and none met the rule-2 activation floor (a configuration with servable
≥ 10). Assessments still opened via labelled partial serving (#1606), but
25-count configurations could not be offered for any topic.

**Fix:** `migrations/285_seed_batch1_question_bank.js` — one expand-only
seed migration following the 281/283/284 pattern exactly: 76
multiple-choice rows for JavaScript, Python, React and Node.js (+19 per
topic: L2 ×6, L3 ×7, L4 ×6), each with 4 distinct options, a
`correct_answer` character-identical to one option, and an explanation.
Rows ship `source='seed'`, `review_status='approved'`, `format='mcq'` with
`topic_id` resolved by the §6 legacy-name join; inserts are
duplicate-guarded on (skill_category, difficulty_level, question_text);
`down()` deletes exactly the seeded rows. No code paths change.

**Specialist decision (STOP 1, #1658):** YES — Interviewer persona reviews
every question in the batch PR (question quality at scale is the risk
domain, design §9 C5). Engineering specialists: no (seed migration only,
established pattern).

**Red-first evidence (fresh-install rig, HL-003):** embedded PostgreSQL
18.4 + pgvector 0.8.7, empty database built only by `node migrate.js`
(exit 0). RED (285 absent): JavaScript/Python/React/Node.js each at
easy 4 / medium 6 / hard 4 — below floor, matching STOP 1. GREEN (285
applied by the same migrate run): each topic at easy 10 / medium 25 /
hard 10, 29 approved MCQ per topic. Duplicate-guard cycle: a second
direct `up()` left the bank at 237 rows (unchanged). Invariant probe:
0 seeded rows whose correct_answer is not one of their options.

**Content hygiene:** before authoring, every existing question text for
the four skills was extracted from migrations 006/280/281/282/284; none of
the 76 new texts duplicates or near-duplicates an existing row (verified
by an exact-text cross-check across all migrations: 0 collisions).
Questions whose correctness would depend on a tool version or an
unsettled convention were reworded until they did not.
