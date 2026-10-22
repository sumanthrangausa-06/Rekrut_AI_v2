# #1692 — C5 Batch 2 question-bank coverage floor (build log)

**Gap (parent #1658, EPIC #1603):** SQL, TypeScript, Java and Data
Analysis sat at the fresh-install base of 10 approved MCQ per topic —
bands easy 4 / medium 6 / hard 4 — meeting neither the §7 rule-4 launch
floor (servable ≥ 25 MCQ/Medium) nor any rule-2 activation configuration
(STOP 1 evidence #1658 comment 6349488581).

**Fix:** `migrations/286_seed_batch2_question_bank.js` — one expand-only
seed migration following the 281/283/284/285 pattern: 76
multiple-choice rows (+19 per topic: L2 ×6, L3 ×7, L4 ×6), each with 4
distinct options, a `correct_answer` character-identical to one option,
and an explanation. Rows ship `source='seed'`,
`review_status='approved'`, `format='mcq'` with `topic_id` resolved by
the §6 legacy-name join; inserts are duplicate-guarded on
(skill_category, difficulty_level, question_text); `down()` deletes
exactly the seeded rows. No code paths change.

**Specialist decision (STOP 1, #1658):** YES — Interviewer persona
reviews every question in the batch PR (question quality at scale is
the risk domain, design §9 C5). Engineering specialists: no.

**Review history:** first Interviewer review **BLOCKED** with 2 blocking
+ 3 minor wording defects, all verified first-hand by Lead and fixed in
the draft before any merge: (1) Data Analysis d4 multiple-comparisons
stem said the hypotheses were "actually false" while its key assumed
true nulls — stem rewritten; (2) SQL d2 LIMIT question named no engine —
stem now names PostgreSQL (the app's engine, the bank's convention);
(3) SQL d4 running-total key ignored the default RANGE peer-group
frame — the stem's query now specifies an explicit ROWS frame; (4) Java
d4 heap/stack key stated the conceptual model as a guarantee — stem now
qualifies "in the standard JVM execution model"; (5) Data Analysis d4
variance key unqualified — now "Population variance". Re-review
**APPROVED** (all five fixes verified landed and sufficient; duplication
sweep under the corrected both-quote-styles method clean; invariant
checked programmatically; spot calculations re-verified).

**Rig evidence (fresh-install, HL-003):** embedded PostgreSQL 18.4 +
pgvector 0.8.7, empty database built only by `node migrate.js` (exit
0), migration 286 isolated for attribution: SQL, TypeScript, Java and
Data Analysis each at easy 10 / medium 25 / hard 10, 29 approved MCQ per
topic; duplicate-guard cycle: second direct `up()` 237 → 237.
