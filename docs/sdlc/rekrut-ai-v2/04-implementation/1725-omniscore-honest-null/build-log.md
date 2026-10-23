# #1725 — `/candidates/full` OmniScore honesty (`COALESCE` fabrication) — Build Log

**Branch:** `nova/1725-omniscore-honest-null` (base: dev tip `a004071d2`)
**STOP 1 / evidence trace:** Scout trace `scout-1725/PANEL.md` (§1 route/SQL,
§2 writer semantics) — verified at `origin/dev` `a004071d2`. The shipped
#1717 pattern (PR #1729) is mirrored: explicit null, never `||`, payload
carries `omniscore_status`.

## Root cause

`GET /api/recruiter/candidates/full` (`routes/recruiter.js`) manufactured an
OmniScore on every row, in two layers:

- **SQL (:1753):** `COALESCE(os.total_score, latest_ja.match_score, 0) as
  omniscore` — a no-data candidate was presented with their job-fit *match
  score* (0–100 scale) under the OmniScore name (300–850 scale), or a
  literal `0` when no match score existed either. A genuine measured
  OmniScore can never be 0 (writer clamps 300–850), so every `omniscore: 0`
  this payload ever sent was fabricated.
- **JS map (:1794):** `omniscore: row.omniscore || 0` — a second fabrication
  layer that would have masked a SQL-only fix.
- **Filters (:1710/:1716):** `minScore`/`maxScore` reused the same COALESCE,
  so no-data candidates were filtered as if they held their match score / 0.

## Fix (exactly the STOP 1 scope)

- **SELECT:** `os.total_score as omniscore` — NULL (no `omni_scores` row, or
  a row with `total_score IS NULL` per the #1192 writer contract) now reaches
  the payload as NULL.
- **JS map:** `omniscore: row.omniscore ?? null`, plus
  `omniscore_status: row.omniscore == null ? 'insufficient_data' : 'measured'`
  (the #1717 payload pattern).
- **Filters, ruled semantics:** `minScore` set → `os.total_score >= $min`
  (NULL fails naturally — no-data candidates are excluded; a minimum cannot
  be satisfied by no score). `maxScore`-only → `(os.total_score IS NULL OR
  os.total_score <= $max)` (no-data candidates are included; no measured
  score exists that could exceed the maximum). When both are set, the min
  condition already excludes NULL and max is a plain `<=`.
- **Client:** `client/src/pages/recruiter/candidates.tsx` — the `Candidate`
  type's `omniscore` field widened to `number | null`. Nothing else
  client-side: the normalizer already yields `null` via `?? null`, and the
  card/sorts/filters were verified null-safe in the Scout trace.

**Out of scope (untouched, filed as #1731):** `isTopCandidate` threshold at
:1798 (NULL >= 85 is false naturally), `matchScore: row.match_score || 0` at
:1793, `routes/public-api.js:196`, `routes/recruiter.js:1881` and `:3858`.

## Tests — red-first, real DB

New suite `server/__tests__/routes/recruiter-candidates-full-1725.test.js`
(real-DB integration, #1717 precedent — gated behind
`RECRUITER1725_INTEGRATION_DB_URL`; local Postgres 16, throwaway DB
`rekrut_1725_test`):

- **RED** (pristine `a004071d2`): 6 failed / 6 — no-row candidate got
  `omniscore: 0`, match-only candidate got `omniscore: 72` (leaked match
  score), `minScore=50` kept the match-only candidate, `maxScore=50`
  dropped it.
- **GREEN** (with fix): 6 passed / 6 — no-row → `null` +
  `insufficient_data`; row-with-NULL → `null` + `insufficient_data`;
  measured 600 → `600` + `measured`; match-only (72) → `omniscore: null`
  while `matchScore` still carries 72; `minScore=50` excludes both no-data
  shapes and keeps measured 600 (pagination total 1); `maxScore=50` only
  includes all three no-data/match-only shapes and excludes measured 600
  (pagination total 3).

Regression pass (same run): #1717 suites
(`recruiter-pipeline-auto-check-1717`, `matching-engine-omniscore-null-1717`),
neighbouring recruiter-route suites (`recruiter-applicant-screening-link`,
`recruiter-override-confidence-1613`) and the new suite together —
**5 suites, 30/30 passed**. Honesty neighbours
(`honest-null-candidate-routes`, `honest-null-omniscore`,
`candidate-score-fallbacks-1377`) — **3 suites, 25/25 passed**.

Lint note: `biome check routes/recruiter.js` reports 1 pre-existing format
error, identical on pristine HEAD (hunks at :986/:1185, unrelated); the new
test file is biome-clean.
