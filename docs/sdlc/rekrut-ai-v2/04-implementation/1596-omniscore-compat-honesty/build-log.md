# #1596 — OmniScore compat columns honest-null build log

## STOP 1 — Root cause (verified first-hand on dev `ed167388d`)

`services/omniscore.js` `calculateScore()` computed the legacy compat
columns unconditionally from factor `raw` values, ignoring each factor's
`hasData` flag:

- `interview_score = Math.round(factors.interview_performance.raw)` (was line 853)
- `technical_score = Math.round(factors.verified_skills.raw)` (was line 854)
- `resume_score = Math.round((experience_quality.raw + education_credentials.raw) / 2)` (was lines 855–857)
- `behavior_score = Math.round((reliability_signals.raw + soft_skills.raw) / 2)` (was lines 858–860)

`total_score`, `score_tier`, `peer_percentile` and the `factor_scores`
JSON (#1538 `persistedFactorScores`, lines 839–845) already honoured
`hasData`; the compat columns were the missed layer of the same class.
`calcReliabilitySignals` builds raw 85 from neutral defaults (50 base +
15 pts for a default 50% attendance rate with zero interviews + 20 pts
follow-through); `calcSoftSkills` raw is 0 with `hasData=false`.

### Mixed-case decision (documented per the issue's STOP 1 requirement)

A compat column is the average of its **measured** source factors only;
it is **null** when no source factor has data. Basis: the #1588 value the
issue files as the defect — `behavior_score` 43 — is itself a mixed case
(reliability_signals had data via 1 application, raw 85; soft_skills had
none, raw 0; (85+0)/2 = 43). "Keep the computed value when at least one
source is measured" would preserve the exact fabricated value, so the
only reading consistent with the issue's own repro is measured-only
averaging. Same shape for resume: a measured experience raw of 10 with
no education data persisted as 5.

### Specialist decision

Yes — score-honesty / data-integrity risk domain. Lens applied: ecc
silent-failure-hunter (a writer silently manufacturing measurements at a
persistence boundary), with a secondary database-reader audit (SQL
`AVG()` ignores NULLs, so aggregate readers stay honest). Considered and
skipped: privacy engineer (no personal-data, consent, or access-control
surface changes), database reviewer (no schema change — the columns are
already nullable and migration 290 already dropped their fabricated
defaults), accessibility/UX (no render-logic change; null renders as an
empty cell exactly as a null `total_score` already does on that page).

### Blast radius (writers / readers of the four compat columns)

- **Writer (in scope):** `calculateScore()` — the `omni_scores` UPDATE
  and the returned object (`interview`/`technical`/`resume`/`behavior`),
  which also feeds `getScoreBreakdown().current` and
  `routes/omniscore.js` GET `/`.
- **Other writer (out of scope, noted):**
  `services/document-verification.js` `applyDocumentScoresToOmniScore`
  writes `resume_score` from a real measured document-verification delta
  (#1715 territory) — not a neutral-default raw.
- **Readers, all null-safe after this change:** `routes/recruiter.js`
  ranked-candidates (pass-through JSON), `routes/memory.js` (`?? null`),
  `services/biasDetection.js` (`AVG()` ignores NULLs),
  `services/euComplianceService.js` (explicit null checks),
  `services/scoreExplainer.js` (`numOrNull`), `lib/career-coach-ai.js`
  (prompt interpolation; `|| 'N/A'` on the technical line — cosmetic
  "null" string possible on the breakdown line, pre-existing pattern,
  not a served score), `client/src/pages/recruiter/omniscore.tsx`
  (renders raw cell values; types widened `number` → `number | null` in
  this change, mirroring #1744).

## Fix

`services/omniscore.js`: a `compatScore(...sources)` helper beside
`persistedFactorScores` — filters to `hasData` sources, returns null
when none are measured, else the rounded average of the measured raws.
All four compat columns use it, so the persisted UPDATE and the returned
object can never drift. Client: the four `CandidateRow` fields in
`client/src/pages/recruiter/omniscore.tsx` widened to `number | null`.

## Evidence (real DB, fresh migrate.js build, system PG16 @ 5432)

Suite: `server/__tests__/omniscore-compat-null-1596.test.js`
(env-gated on `OMNISCORE1596_INTEGRATION_DB_URL`, lane pattern; seeds
four candidates and reads the persisted `omni_scores` rows back).

- **Red on pristine `ed167388d`:** 3 failed / 1 passed — no-data
  candidate `interview` received 0 (expected null); one-application
  candidate `behavior` received **43** (expected 85 — the exact #1588
  fabrication); experience-only candidate `resume` received 5
  (expected 10); the fully-measured control passed (true control).
- **Green on this branch:** 4/4 passed.
- **Neighbours:** 8 suites / 80 tests passed (omniscore-factor-null-1538,
  honest-null-omniscore, omniscore-factors, omniscore-chain, compliance
  score-explainer/eu-explanation/decision-explainer/dsar-export
  repoints); plus honest-null-candidate-routes, matching-engine-1717,
  document-verification-1715, omniscore-explainer-1219,
  omniscore-job-assessments — 4 passed, 1 env-gated suite skipped
  (its integration env var unset; pre-existing behaviour).

User-visible behaviour change: candidates with no measured source for a
compat column now show an empty/insufficient-data state instead of a
fabricated number (recruiter OmniScore table cells render blank, the
same as a null total already does); a partially-measured column shows
the real measured value instead of a default-diluted one.
