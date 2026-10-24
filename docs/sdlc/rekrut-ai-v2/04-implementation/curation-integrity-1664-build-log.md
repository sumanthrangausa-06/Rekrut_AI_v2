# #1664 — Curation content integrity (build log)

**Defect (review H-1 on #1652):** migration 280's curation pass approved
migration 006's seed batch by IDENTITY tuple alone — (skill_category,
difficulty_level, question_type, question_text). Any bank row sharing a
seed row's identity flipped to `source='curated', review_status='approved'`,
including a duplicate carrying a wrong `correct_answer` — i.e. unreviewed,
incorrect content became approved scored truth and counted as servable
supply.

**Fix:**
- `migrations/280_assessment_question_provenance.js` (amended): the curation
  key is now the FULL content tuple — identity PLUS `options`,
  `correct_answer`, `explanation`, compared NULL-safely (`IS NOT DISTINCT
  FROM`) against seed content copied character-for-character from migration
  006 (the two short_answer seeds have NULL options / NULL correct_answer).
  A post-curation assertion verifies the curated+approved set equals exactly
  the full-content seed matches and throws (rolling the migration back)
  otherwise.
- `migrations/282_curation_content_integrity.js` (new): for databases where
  the loose 280 already ran, demotes every curated+approved row whose
  identity matches a seed tuple but whose content diverges from that seed
  back to `source='legacy', review_status='pending'`, then re-asserts the
  same set equality. Idempotent (clean bank: demotes 0). `down()` is a
  documented no-op — reversing it would re-approve poisoned rows.

**Hazard-bank acceptance (fresh-install rig, real Postgres, real migrate.js
chain; script `scripts/test-1664-curation-hazard.js`, logs in
`evidence-1664/`):** the bank is rewound to pre-280, two hazard rows are
inserted (typeof-null duplicate with `correct_answer='null'`; React seed
copy with the answer edited to `'useState'`), then migrations 280+ re-run.
- RED (unpatched dev): curation approved 8 rows; both hazards came out
  `curated/approved`; JavaScript mcq approved supply inflated to 3.
- GREEN (this fix): both hazards stay `legacy/pending`; curated+approved is
  exactly the 6 genuine seed rows; JavaScript mcq approved supply is 2.
  A third poison inserted already `curated/approved` after the chain was
  demoted by 282 to `legacy/pending`, and a 282 re-run demoted 0
  (idempotent). `scripts/audit-assessment-coverage.js` on the GREEN bank
  shows JavaScript mcq approved = 2 (medium band) with both poison rows in
  pending — supply not inflated. (The audit's exit-1 floor flags are the
  pre-existing sparse-bank state, unrelated to this fix.)
