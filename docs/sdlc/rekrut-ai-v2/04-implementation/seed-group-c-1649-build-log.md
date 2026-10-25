# #1649 — Group C question-bank seed + legacy-cell completion (build log)

**Gap (parent #1606):** SKILL_CATALOG lists 16 skills. Groups A (migration
281, #1647) and B (migration 283, #1648) seeded their eight skills, but the
four Group C skills — `Data Analysis`, `System Design`,
`Project Management`, `Machine Learning` (spellings verified against
`SKILL_CATALOG` in routes/assessments.js and migration 279's
`legacy_skill_name` list) — had zero bank rows at every difficulty, and the
four legacy skills seeded by migration 006 had only partial cells
(JavaScript MCQ d2/d3 x1 each, Python MCQ d2 x1, React MCQ d2 x1,
Communication short_answer d1 x1, all approved by migration 280's curation
pass). With no bank row in a cell, `generateQuestion()` falls through to
the AI provider; provider-free, the session surfaces
QUESTION_UNAVAILABLE.

**Fix:** `migrations/284_seed_group_c_question_bank.js` — one expand-only
migration following the 281/283 pattern exactly: 75 multiple-choice rows,
each with 4 distinct options, a `correct_answer` character-identical to
one option, an explanation stating why, and difficulty ramping 1→5.

- Group C: 2 per cell x 5 difficulties x 4 skills = **40 rows**.
- Legacy completion, counted exactly from the fresh-install state (no
  over-seeding): JavaScript **+8** (d1 +2, d2 +1, d3 +1, d4 +2, d5 +2),
  Python **+9** (d1 +2, d2 +1, d3 +2, d4 +2, d5 +2), React **+9** (same
  shape as Python), Communication **+9** (below) = **35 rows**.

**Communication judgment:** Communication gains MCQ rows; it does not
stay short_answer-only. MCQ rows are scored deterministically by exact
string equality with no provider involved, while a short_answer-only bank
leaves every cell dependent on evaluated answers. Design §4.6 defines
`mixed` serving as `format IN ('mcq','short_answer')` with
servable(mixed) = servable(mcq) + servable(short_answer), so the new MCQ
rows count toward Communication's supply alongside its legacy
short_answer row (untouched, still serves). Serving consequence stated
explicitly: after this migration Communication d1 holds 2 servable rows
via mixed (1 legacy short_answer + 1 new MCQ) and d2–d5 hold 2 MCQ each;
the rejected alternative would have met the numeric target while keeping
Communication the one legacy skill with no deterministically-scored row.

**Content discipline (#1573 scored truth):** content was authored from
subject knowledge and given a hostile SME self-review pass; anything
version- or context-dependent or with two defensible answers was reworded
or replaced (one fix in review: a spreadsheet-average distractor that
could read as a second valid formula was replaced). Inserts are
duplicate-guarded (`WHERE NOT EXISTS` on skill_category +
difficulty_level + question_text); `up()` first runs the 281/283
invariant check — exactly 4 distinct options and `correct_answer`
identical to one of them — and throws before any insert on violation.
Every row ships explicitly as `source='seed'`, `review_status='approved'`,
`format='mcq'`, with `topic_id` resolved by the legacy-name join (§6).
`down()` deletes exactly the seeded rows. Additive only.

**Evidence (fresh-install rig, embedded Postgres 16.4 on 127.0.0.1:55473,
throwaway DBs built only by `node migrate.js`; logs in `evidence-1649/`
beside the build worktree):**

- RED on pristine origin/dev (040407e31, includes migrations 279–283):
  Group C bank rows = 0 for all four skills; per-cell audit showed 40/40
  target cells below >= 2 servable; coverage audit approved = 0 in every
  band for topics 12–14 and 16.
- GREEN on this branch, fresh DB via the full migrate.js chain: migration
  284 applied cleanly; read-back shows exactly 2 servable rows in every
  Group C and legacy cell (Communication d1 via mixed); 75 new rows, all
  seed/approved/mcq with topic_ids 12/13/14/16 (Group C) and 1/2/3/15
  (legacy); bank-wide MCQ invariant violations = 0. The coverage audit
  shows per-skill approved mcq supply easy = 4, medium = 6, hard = 4
  (Communication mixed the same); its exit-1 flags are the standing §7
  rule-2 floor of 10 per configuration, the same state Groups A and B
  shipped in — 2-per-cell seeding does not claim to meet that floor.
- Duplicate-guard cycle executed on the GREEN DB: 75 -> down() 0 ->
  up() 75 -> up() again 75 (no duplicates).
- Builder-evidence journey (labelled as such — the per-skill API journey
  + guard cycle remain Quinn's gate items): the real server booted
  against the GREEN DB with no AI keys; all 8 skills (Group C + legacy)
  started provider-free, answered 10/10, completed, and their
  skill_assessment results were read back from the DB.
