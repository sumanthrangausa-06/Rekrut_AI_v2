# Build log — #1280 DROP DEFAULT on fabricated score columns (+ #1270 rider)

- **Issues:** #1280 (DROP DEFAULT approved set), #1270 (peer_percentile rider)
- **Migration:** `migrations/290_drop_fabricated_score_defaults.js` (one new file, up-only)
- **Branch:** `nova/1280-drop-defaults` (off origin/dev 0571be00e)
- **Approval:** Sumanth, 2026-10-22, on #1280 comment 6352894607 — DROP DEFAULT
  approved with #1270's peer_percentile drop riding; existing-row heals NOT included.
- **STOP 1:** #1280 comment 6353005438.
- **Persona:** Nova (Phase 4 Implementation). Specialist decision (STOP 1):
  database-reviewer lens applied for migration safety (metadata-only DDL,
  no data rewrite, idempotent, self-asserting post-state).

## Root cause

The schema itself fabricated scores. The creating migrations gave score
columns numeric DEFAULTs, so any INSERT that omitted a score stored a number
nobody computed, violating the no-fake-numbers standard (no data ⇒
"Insufficient data"/"N/A", never an invented number):

- A new candidate row was born with OmniScore `total_score` 300 and
  `peer_percentile` 50 — the middle of the peer distribution, claimed with
  zero evidence.
- A new company row was born with Trust Score `total_score` 500.
- Every assessment attempt was born with `anti_cheat_score` 100 — a perfect
  integrity score for an attempt nobody had analysed.
- Factor columns defaulted to 0, indistinguishable from a measured zero.

The Oct 21 #1280 audit found 27 such columns; with the #1270 rider the
approved set is 28. The fix is at the schema layer, not in readers/writers:
remove the DEFAULTs so omission stores NULL, the honest no-data state that
readers already render as insufficient data. Writers that compute a real
score and supply it explicitly are unaffected.

## Approved scope — the 28 columns

Each column was verified against its creating migration in this tree before
the migration was written.

| # | Table | Column | Was DEFAULT | Source migration |
|---|-------|--------|-------------|------------------|
| 1 | omni_scores | total_score | 300 | 001 |
| 2 | omni_scores | interview_score | 0 | 001 |
| 3 | omni_scores | technical_score | 0 | 001 |
| 4 | omni_scores | resume_score | 0 | 001 |
| 5 | omni_scores | behavior_score | 0 | 001 |
| 6 | role_scores | score | 300 | 001 |
| 7 | mutual_matches | candidate_score | 300 | 030 |
| 8 | mutual_matches | company_score | 500 | 030 |
| 9 | mutual_matches | mutual_fit_score | 0 | 030 |
| 10 | trust_scores | total_score | 500 | 002 |
| 11 | trust_scores | verification_score | 0 | 002 |
| 12 | trust_scores | job_authenticity_score | 0 | 002 |
| 13 | trust_scores | hiring_ratio_score | 0 | 002 |
| 14 | trust_scores | feedback_score | 0 | 002 |
| 15 | trust_scores | behavior_score | 0 | 002 |
| 16 | trust_scores | employee_satisfaction_score | 0 | 132 |
| 17 | trust_scores | interview_experience_score | 0 | 132 |
| 18 | trust_scores | offer_acceptance_rate_score | 0 | 132 |
| 19 | trust_scores | time_to_hire_score | 0 | 132 |
| 20 | trust_scores | response_rate_score | 0 | 132 |
| 21 | trust_scores | salary_competitiveness_score | 0 | 132 |
| 22 | trust_scores | diversity_metrics_score | 0 | 132 |
| 23 | trust_scores | career_growth_score | 0 | 132 |
| 24 | trust_scores | data_sufficiency_score | 0 | 132 |
| 25 | skill_assessments | anti_cheat_score | 100 | 006 |
| 26 | job_assessment_attempts | anti_cheat_score | 100 | 042 |
| 27 | aptitude_test_attempts | anti_cheat_score | 100 | 074 |
| 28 | omni_scores | peer_percentile (#1270) | 50 | 077 |

Grouping: A = score totals/factors (rows 1–24), B = anti-cheat (rows 25–27),
#1270 rider = row 28.

## What the migration does

`up()` runs `ALTER TABLE <t> ALTER COLUMN <c> DROP DEFAULT;` for each of the
28 columns, then asserts the post-state from `information_schema.columns`:
all 28 columns must exist and every `column_default` must be NULL, otherwise
`up()` throws and the migration is not recorded. There is no `down()` —
restoring a fabricated default would re-fabricate scores. DROP DEFAULT is
idempotent.

## What was NOT done (explicit non-scope)

- **Existing-row heals NOT included.** Rows already carrying fabricated
  values from these defaults are untouched; healing them is a separate data
  gate that Sumanth did not approve in this ruling.
- **No column or table drop, no data rewrite.** DROP DEFAULT is metadata-only:
  columns, types, CHECK constraints (e.g. the `anti_cheat_score` 0–100 range
  check on `aptitude_test_attempts`) and all stored values survive unchanged.
- **Audit groups C/D not touched.** Only the approved A/B set plus the #1270
  rider is in this migration; the #1280 audit's remaining groups are
  follow-ups for their own rulings.
- **Denylist untouched.** Columns whose defaults are legitimate product
  state (statuses, tiers, timestamps, counters with real zero semantics,
  e.g. `score_tier DEFAULT 'new'`, `NOW()` timestamps) keep their defaults —
  they are not scores and were never in scope.
- No reader/writer code changes; no other migrations modified.

## Rig evidence (fresh-install, real database — HL-003 pattern)

Fresh databases on PostgreSQL 18.4, full `migrate.js` from this worktree;
outputs saved under the run's evidence folder
(`hidden_files/1543-run/evidence-1280/`: `red.txt`, `green.txt`,
`green-remigrate.txt`, `green-direct-second-up.txt`).

- **RED (without 290, pristine origin/dev schema):** all 28 columns found,
  **28/28 WITH_DEFAULT, 0 NULL**. An omitting INSERT into `omni_scores`
  materialised `{total_score:300, interview_score:0, technical_score:0,
  resume_score:0, behavior_score:0, peer_percentile:50}`; into
  `trust_scores`, `{total_score:500, …all factors 0}`. 186 migrations applied.
- **GREEN (with 290):** migration 290 ran and recorded (187 migrations
  applied); its own post-state assertion passed during the run.
  **28/28 columns found, 0 WITH_DEFAULT, 28 NULL_DEFAULT.** Omitting INSERTs
  read back NULL for every total, factor and `peer_percentile` on both
  `omni_scores` and `trust_scores`.
- **Idempotency:** (a) re-running `migrate.js` on the GREEN database exits 0
  with the defaults still 28/28 NULL and 290 recorded exactly once;
  (b) calling 290's `up()` directly a second time succeeds (DROP DEFAULT is
  a no-op where no default exists) and the post-state assertion passes again.

Note on rig plumbing: the RED pass ran against the established rig PG 18.4
server (port 55471) before it was torn down by its owning run; the GREEN
passes ran on a fresh cluster from the same embedded-postgres 18.4 binaries
(port 55473) with pgvector 0.8.7 (PGDG .deb) added, which migrations 008/262
require. Both passes are full fresh installs — the only difference between
them is the presence of migration 290.
