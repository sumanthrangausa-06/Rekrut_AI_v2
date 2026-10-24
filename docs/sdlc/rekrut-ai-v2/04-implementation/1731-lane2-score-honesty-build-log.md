# #1731 Lane 2 — Score Honesty S-4/S-5/S-6/S-7 — Build Log

**Lane:** Nova (implementation), Lead coordinating. STOP 1 on #1731; panel
treatments in the #1731 panel DISCUSSION.md §2.4–§2.7. Precedents: #1724
(renormalise over measured, NULL sorts last), #1717 (skip-with-accounting),
Lane 1 / PR #1743 (honest `?? null` + `*_status` pairs).

## Changes

- **S-4 `routes/public-api.js` (GET /api/v1/candidates):**
  `COALESCE(os.total_score, ja.match_score, 0) as omniscore` →
  `os.total_score as omniscore` plus `ja.match_score as match_score`, each
  with a `*_status` (`measured` / `insufficient_data`) CASE pair.
  **Contract change (external API):** `omniscore` is now the measured
  OmniScore or JSON `null` — it is never a substituted 0–100 match score
  and never a fabricated 0. Consumers who want the match score read the
  new `match_score` field, labelled as what it is. New additive fields:
  `omniscore_status`, `match_score`, `match_score_status`. No in-repo
  client consumes this endpoint (verified by grep).
- **S-5 `routes/recruiter.js` (GET /ai/rank-all/:jobId):** composite is a
  SQL CASE renormalised over measured components only — both measured:
  unchanged (`total*0.5 + match*8.5*0.5`); OmniScore only: `total_score`;
  match only: `match_score*8.5`; neither: NULL. `ORDER BY … DESC NULLS
  LAST`. Response map no longer fabricates a number from NULL:
  `composite_score` is `null` with `composite_status: 'insufficient_data'`,
  and the response adds `unranked_insufficient_data` (accounted count,
  mirroring `skipped_insufficient_data`). No in-repo client consumes this
  endpoint's composite (verified by grep).
- **S-6 `routes/recruiter.js` (GET /jobs/:id/ranked-candidates):**
  `COALESCE(ja.match_score, 0) >= $2` →
  `(ja.match_score >= $2 OR ($2 <= 0 AND ja.match_score IS NULL))` — a NULL
  match is included exactly when no minimum was requested and never passes
  a requested minimum. Behaviour-preserving today (panel §2.6); the rule
  is now explicit instead of emergent from a fabricated 0.
- **S-7 `routes/recruiter.js` (POST /pipeline/auto-check/:jobId):** the
  `app.match_score || 0` coercion above the #1717 guard is removed. After
  the existing OmniScore skip, an applicable `auto_advance` rule with a
  NULL/undefined `match_score` cannot judge its advance conjunction, so
  the advance judgement is skipped with accounting — the same
  skipped-action shape with reason `Match score: insufficient data —
  automation not applied`. Auto-reject-only rules are untouched; a measured
  0 is judged exactly as before (explicit null test, never truthiness).
  **Fix round F-1 (independent review BLOCK, adjudication §3):** the
  original build's skip used `continue`, which also suppressed the
  auto-reject leg of a COMBINED advance+reject rule even though reject's
  sole input (OmniScore) was measured. Corrected: the match score feeds
  only the advance conjunction, so the advance skip is deferred until
  after the reject check and is accounted only when no reject fires; when
  the reject leg fires on a measured OmniScore the application is rejected
  with no skipped action and exactly one notification, exactly as
  pristine judged it. Advance/reject keep their pristine independent-if
  order, so on measured scores where both legs could fire, both actions
  are recorded and the final status is `rejected` — precedence unchanged.

## Evidence (real DB, red-first)

Suite: `server/__tests__/routes/recruiter-1731-lane2.test.js` (14 tests),
env-gated behind `RECRUITER1731_LANE2_INTEGRATION_DB_URL`, real HTTP via
supertest against a throwaway Postgres; the public-api route runs its real
api-key middleware against a real `api_keys` row.

- RED on pristine dev (f6aca9ee8): **7 failed / 7 passed** (count
  corrected per the independent review's first-hand re-run, F-2 — the
  original log understated it as 6/8; the seventh failure is the combined
  advance+reject test, which fails on pristine because pristine rejects
  the candidate the panel-letter reading expected to stay `applied`) —
  all S-4 tests (substitution + fabricated 0), both S-5 tests
  (invented-50 ranking order), and the S-7 threshold-0 test (a NULL-match
  candidate was in fact auto-advanced on a fabricated 0 pass). S-6 tests
  pass on pristine, as panel §2.6 predicts — they lock the now-explicit
  rule as regression guards.
- GREEN on this branch: **14 passed / 14**.
- Fix round F-1: suite extended to 15 tests (the combined-rule test
  flipped to the discriminating assertion — rejected, no skipped action,
  one notification, DB read-back `rejected` — plus a companion guard for
  the no-reject-fires → skip-accounted case). RED on the pre-fix commit
  (e3d74e8b0): **1 failed / 14 passed**, the failure being exactly the
  discriminating test (`applied` where `rejected` was required). GREEN
  after the fix on a fresh DB: **15 passed / 15**. Neighbours re-run:
  Lane 1 **9/9**, #1717 auto-check **4/4**, #1725 **6/6**.
- Neighbours: Lane 1 suite + #1717 auto-check suite + #1725
  candidates-full suite + migration 291/292 suites — **35 passed / 35**;
  four further recruiter suites (applicant-screening-link, aptitude-stats
  1732, override-confidence 1613, question-bank 1740) — **26 passed / 26**.
- Fresh-install proof: `node migrate.js` from an empty database —
  "All migrations completed successfully".
