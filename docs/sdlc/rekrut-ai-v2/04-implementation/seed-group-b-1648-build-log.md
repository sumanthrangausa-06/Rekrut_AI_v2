# #1648 — Group B question-bank seed (build log)

**Gap (parent #1606):** SKILL_CATALOG lists 16 skills, but the four Group B
skills — `CSS & HTML`, `AWS`, `Docker`, `Git` (spellings verified against
`SKILL_CATALOG` in routes/assessments.js) — had zero question-bank rows at
every difficulty. With no bank row, `generateQuestion()` falls through to
the AI provider; provider-free, `/start` surfaces QUESTION_UNAVAILABLE and
the assessment cannot open. Group A was closed the same way by migration
281 (#1647); this story is the Group B mirror.

**Fix:** `migrations/283_seed_group_b_question_bank.js` — one expand-only
migration following 281's proven pattern exactly: 40 multiple-choice rows
(4 skills × difficulties 1–5 × 2 per cell), each with 4 options, an
explanation stating why the correct answer is right, and difficulty that
ramps from basic recall (1) to nuanced/expert (5). Content was authored
and SME self-reviewed by Nova; any question whose correctness depended on
a tool version or an unsettled context was reworded until it did not.
Inserts are duplicate-guarded (`WHERE NOT EXISTS` on skill_category +
difficulty_level + question_text); `up()` first runs 281's invariant
check — exactly 4 distinct options and `correct_answer` character-identical
to one of them (POST /answer scores by exact string equality) — and throws
before any insert on violation. Every row ships explicitly as
`source='seed'`, `review_status='approved'`, `format='mcq'`, with
`topic_id` resolved by the legacy-name join (§6). `down()` deletes exactly
the seeded rows. Additive only: no schema change, no existing row touched.

**Evidence (fresh-install rig, real Postgres at 127.0.0.1:55433, throwaway
DBs built only by `node migrate.js`; logs in `evidence-1648/` beside the
build worktree):**
- RED on pristine origin/dev (afff5bf28, includes #1663/#1665): Group B
  bank rows = 0 for all four skills; `scripts/audit-assessment-coverage.js`
  showed approved = 0 in every band for topics 8–11.
- GREEN on this branch, fresh DB via the full migrate.js chain: migration
  283 applied cleanly; read-back shows exactly 2 rows per skill ×
  difficulty cell (40 total), all seed/approved/mcq with topic_ids
  8 (CSS & HTML), 9 (AWS), 10 (Docker), 11 (Git); bank-wide MCQ invariant
  violations = 0. The coverage audit shows per-skill approved supply
  easy = 4, medium = 6, hard = 4 (its exit-1 floor flags are the standing
  §7 rule-2 floor of 10 per configuration, the same state Group A shipped
  in — 2-per-cell seeding does not claim to meet that floor).
- A stub-client run of `up()` independently captured all 40 inserts:
  2 per cell, 40 distinct question texts, 0 invariant violations.

**Pending re-run before merge (honest status):** the duplicate-guard /
`down()` / `up()` cycle and the per-skill provider-free API journey
(start → answer all 10 → finish → results read back; script
`evidence-1648/journey-1648.js`) were scripted but could not be executed
to completion in the build environment — the local Postgres rig became
unreachable mid-run (port 55433 closed) after the GREEN bank proof above
had completed. Both must be re-run on the rig and their logs attached to
#1648 before this change is reported done; the bank read-back + coverage
audit above is the minimum proof, not the full gate.
