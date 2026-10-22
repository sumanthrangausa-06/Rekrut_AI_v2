# #1693 — C5 Batch 3 question-bank coverage floor (build log)

**Gap (parent #1658, EPIC #1603):** AWS, Docker, Git and CSS & HTML sat
at the fresh-install base of 10 approved MCQ per topic — bands easy 4 /
medium 6 / hard 4 — meeting neither the §7 rule-4 launch floor
(servable ≥ 25 MCQ/Medium) nor any rule-2 activation configuration
(STOP 1 evidence #1658 comment 6349488581).

**Fix:** `migrations/287_seed_batch3_question_bank.js` — one expand-only
seed migration following the 281/283/284/285 pattern: 76
multiple-choice rows (+19 per topic: L2 ×6, L3 ×7, L4 ×6), each with 4
distinct options, a `correct_answer` character-identical to one option,
and an explanation. Rows ship `source='seed'`,
`review_status='approved'`, `format='mcq'` with `topic_id` resolved by
the §6 legacy-name join ('CSS & HTML' — the display name 'HTML/CSS' is
the §3.1 rename of the same single subject, not a second subject);
inserts are duplicate-guarded on (skill_category, difficulty_level,
question_text); `down()` deletes exactly the seeded rows. No code paths
change.

**Specialist decision (STOP 1, #1658):** YES — Interviewer persona
reviews every question in the batch PR (question quality at scale is
the risk domain, design §9 C5). Engineering specialists: no.

**Review history:** first Interviewer review **BLOCKED** on one defect,
verified first-hand by Lead: the Git L4 merge-vs-rebase key claimed
merging joins histories "with a merge commit" — false for fast-forward
merges. The keyed option (options entry and `correct` field, kept
character-identical) now reads "…(creating a merge commit when the
branches have diverged)…". Re-review by a fresh Interviewer lane
**APPROVED**: the fixed row confirmed sound, full 76-row pass clean,
key/option identity verified programmatically, duplication sweep under
the corrected both-quote-styles method clean (the one conceptual
adjacency — 283's AWS CloudFront/CDN row — is a different skill and no
Batch 3 row asks it).

**Rig evidence (fresh-install, HL-003):** embedded PostgreSQL 18.4 +
pgvector 0.8.7, empty database built only by `node migrate.js` (exit
0), migration 287 isolated for attribution: AWS, Docker, Git and
CSS & HTML each at easy 10 / medium 25 / hard 10, 29 approved MCQ per
topic; topic_id resolved for 231/231 seed rows with subject 'HTML/CSS'
at topic-medium 25; duplicate-guard cycle: second direct `up()`
237 → 237.
