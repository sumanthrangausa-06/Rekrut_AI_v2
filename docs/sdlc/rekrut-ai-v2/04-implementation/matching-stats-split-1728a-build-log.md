# #1728a-R — /matching/stats recruiter branch blended renormalised scores into the headline average (build log)

**Defect:** In `routes/matching.js`, `GET /api/matching/stats`' recruiter
branch averaged `match_results.weighted_score` over ALL rows per job.
That blends renormalised scores — rows where either
`omniscore_at_match` or `trustscore_at_match` is NULL, i.e. the score
was renormalised over measured components only (per #1717/#1724
semantics) — with fully-measured ones, so a job's headline average
could rest on partial evidence without saying so.

**Fix (panel-ruled split, STOP 1 on issue #1728; `routes/matching.js`
only):** per job row —

- `avg_match_score` is the fully-measured average ONLY:
  `AVG(mr.weighted_score) FILTER (WHERE mr.omniscore_at_match IS NOT NULL AND mr.trustscore_at_match IS NOT NULL)`.
- New `fully_measured_matches`: count of fully-measured rows.
- New `insufficient_data_matches`: count of rows where either at-match
  column IS NULL.
- New `avg_insufficient_data_score`: AVG over the renormalised bucket.
- Empty bucket → NULL average, never 0 (counts are honest 0; the
  no-match LEFT JOIN row counts nothing because the counts are over
  `mr.id`).
- `excellent_matches` and everything else unchanged. The candidate
  branch of /stats is untouched (separate gate item). No schema change.
- Count-vs-average denominators (#1768): bucket counts classify rows by the at-match column pair alone (a NULL `weighted_score` row still counts in its bucket), while each bucket's AVG ignores NULL `weighted_score` — a bucket whose only row has NULL `weighted_score` reports count > 0 with a NULL average.

**Legacy caveat:** rows calculated before the #1717/#1724 honesty
fixes can carry at-match values from the fabricated-score era and are
indistinguishable; the split is truthful for rows calculated at/after
those fixes.

**User-visible behaviour change:** a recruiter's per-job average match
score now reflects fully-measured matches only; renormalised matches
are counted and averaged separately as insufficient-data, and a job
with only renormalised matches shows `avg_match_score: null` instead
of a blended number.

**Tests:** `server/__tests__/routes/matching-stats-split-1728a.test.js`
— real-DB integration suite (1728b harness pattern) seeding mixed,
renormalised-only, fully-measured-only, and no-match jobs. Red-first
on pristine `origin/dev` (3d3d69ec2): 4/4 failed — the new fields were
absent and the mixed job's average was the blended 76.67 instead of
85. Green after the fix: 4/4. Neighbour regression:
`recruiter-intros-fallback-gate-1728b.test.js` 6/6 and
`matching-explain-authz-1479.test.js` 11/11.
