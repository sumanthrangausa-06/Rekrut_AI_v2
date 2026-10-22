# #1694 — C5 Batch 4 question-bank coverage floor (build log)

**Gap (parent #1658, EPIC #1603):** same measured gap as Batches 1–3 —
Communication, Machine Learning, Project Management and System Design sat
at the fresh-install base (§7 floors unmet; STOP 1 evidence #1658 comment
6349488581), with one wrinkle the STOP 1 table did not surface:
Communication's base is 10 approved rows but only 9 are MCQ — its d1 cell
holds 1 MCQ plus the legacy short_answer row — so its MCQ easy band
started at 3, not 4.

**Fix:** `migrations/288_seed_batch4_question_bank.js` — one expand-only
seed migration following the 281/283/284/285 pattern: 77 multiple-choice
rows (+19 per topic at L2 ×6 / L3 ×7 / L4 ×6, plus ONE extra Communication
L2 row), each with 4 distinct options, a `correct_answer`
character-identical to one option, and an explanation. Rows ship
`source='seed'`, `review_status='approved'`, `format='mcq'` with
`topic_id` resolved by the §6 legacy-name join; inserts are
duplicate-guarded; `down()` deletes exactly the seeded rows. No code
paths change.

**Specialist decision (STOP 1, #1658):** YES — Interviewer persona
reviews every question in the batch PR (question quality at scale is the
risk domain, design §9 C5). Communication scenario keys follow the
professionally standard answer with clearly inferior distractors.

**Rig evidence (fresh-install, HL-003):** embedded PostgreSQL 18.4 +
pgvector 0.8.7, empty database built only by `node migrate.js` (exit 0).
First GREEN run (76 rows): ML/PM/System Design at easy 10 / medium 25 /
hard 10, but Communication at **easy 9** / medium 25 / hard 10 (28 MCQ
total) — the rig caught the shortfall the per-topic +19 formula missed
for Communication's asymmetric base. After the +1 L2 correction (77
rows): all four topics at easy 10 / medium ≥ 25 / hard 10, 29 approved
MCQ each; duplicate-guard cycle: second direct `up()` 313 → 313.

**Content hygiene:** every existing question text for the four skills was
extracted from all migrations matching BOTH single-quoted and
double-quoted `text:` fields (the Batch 1 lesson — single-quote-only
extraction shipped near-duplicates there); 0 exact-text collisions for
the 77 new rows, checked before the Interviewer review.
