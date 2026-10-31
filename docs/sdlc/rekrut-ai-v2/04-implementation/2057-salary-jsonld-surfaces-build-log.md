# #2057 — JSON-LD baseSalary gating + verbatim-only salary surfaces: build log

**Story:** #2057 [FOLLOW-UP #1019 review] JSON-LD baseSalary gating + verbatim-only salary surfaces (ai-search, omniscore). Items 1+2 only; item 3 (Intl pseudo-currency ¤ symbol) is recorded-no-action and untouched.
**Branch:** `fix/2057-salary-jsonld-surfaces` from `origin/dev` @ `129e3da37` (Merge PR #2056).
**STOP 1:** posted on #2057 before build (root-cause census incl. per-endpoint payload census + specialist decision: frontend/UX lens = Yes; privacy/security considered and skipped with reasons — salary is the job's own public posting data, no PII, no new endpoint, no auth change).

## User-visible behaviour change

- A job posted with only a salary minimum/maximum (no free-text salary range) now shows its salary on **AI Search** results and on **OmniScore → Mutual Matches**, formatted by the shared salary formatter in the currency the recruiter entered (e.g. `$80,000 - $120,000`, `₹8,00,000 - ₹12,00,000`). Before this fix both surfaces showed no salary at all for those jobs.
- The job-detail page's search-engine structured data (JSON-LD `baseSalary`) now appears for min/max-only jobs with the correct bounds and entered currency. A job whose salary exists only as free text (e.g. "₹8–12 LPA") no longer emits a `baseSalary` block: the previous code emitted one with empty values, and converting free text into numbers would invent figures.
- Jobs with no salary still show no salary on every surface — no placeholder, no invented figure.

## Root cause (from the STOP 1 census)

Two gates tested the salary *text* field while the values live in the *numeric* fields:

1. `client/src/pages/candidate/job-detail.tsx` built JSON-LD `baseSalary` only when `job.salary_range` was truthy, yet read `salary_min`/`salary_max` for the values — so min/max-only jobs emitted nothing, and text-only jobs emitted a QuantitativeValue with both bounds `undefined` (dropped by `JSON.stringify` in `SEO.tsx`).
2. `ai-search.tsx` and `omniscore.tsx` rendered `salary_range` verbatim only. Payload census: ai-search's search leg (`GET /api/jobs`) already carried `salary_min`/`salary_max`/`currency_code`, but its recommendations leg (`findMatchingJobs`, `services/matching-engine.js`) and omniscore's `GET /api/omniscore/mutual-matches` (`routes/omniscore.js`) selected only `salary_range` — the fields never reached the client on those legs.

## Fix (ponytail — reuse the #1019 formatter, fewest files, no new deps)

- `client/src/pages/candidate/job-detail.tsx` — JSON-LD gate changed from `job.salary_range` (text) to the normalised numeric bounds: each bound is passed through `salary.ts`'s `toAmount` coercion (`Number(value) > 0`, so `"0.00"`/absent = no salary — PG `NUMERIC` columns arrive as strings), `baseSalary` is emitted when either normalised bound exists, and each emitted bound is a real number. (The first commit gated on raw truthiness of the raw fields; the independent review BLOCKed that — string-typed bounds on every real job and a $0 `baseSalary` on the `"0.00"` shape. See "Review fold" below.)
- `client/src/pages/candidate/ai-search.tsx` — card renders `hasJobSalary(job)` + `formatJobSalary(job)`; `JobResult` gains `currency_code`.
- `client/src/pages/candidate/omniscore.tsx` — mutual-match row renders `hasJobSalary(match)` + `formatJobSalary(match)`; `MutualMatch` gains `salary_min`/`salary_max`/`currency_code`.
- `services/matching-engine.js` — `findMatchingJobs` SELECT + result mapping widened with `j.salary_min, j.salary_max, j.currency_code`.
- `routes/omniscore.js` — mutual-matches SELECT + GROUP BY widened with the same three columns.
- Out of scope, noted in STOP 1: the SEO meta `description` on job-detail also interpolates `salary_range` only; not part of items 1+2 as filed.

## Tests

- **Red-first:** new sibling suite `client/src/__tests__/pages/SalarySurfaces2057.test.tsx` (15 tests after the review fold: JSON-LD parsed from the rendered job-detail page ×9, ai-search ×3, omniscore mutual matches ×3). On base: **7 failed / 5 passed** — the 7 failures are exactly the defect shapes; the 5 passes are honest-state regression guards. After the first fix: **12/12 pass**. After the review fold (fixtures corrected to the real PG string shape `"80000.00"` + zero/mixed-zero/text+numbers cases): **7 failed / 8 passed against the first-fix code**, then **15/15 green** after the fold fix; the #1019 contract suite still passes (**30/30 combined**).
- **Server suites (review MINOR 4 fold):** new jest suites `server/__tests__/routes/omniscore-mutual-matches-salary-2057.test.js` (2 tests: SQL asks for the three columns; fields pass through; honest nulls) and `server/__tests__/services/matching-engine-salary-fields-2057.test.js` (1 test: SELECT + mapping carry the fields) — both PASS.
- **tsc parity:** `npx tsc --noEmit` reports 83 errors on base and 83 on this branch; the single error in a touched file (`job-detail.tsx` `standaloneMetrics` possibly null) exists identically on base (line shifted by the added comment). No new type errors.
- **Full client suite:** 95 files / 622 tests — 584 passed, 29 skipped, 9 failed. All 9 failures are in `CandidateInterviewsScreening.test.tsx` (2) and `SettingsLinkedInUrl.test.tsx` (7), unrelated to this lane, and **fail identically on unmodified base** (verified by running both files at `129e3da37`: 9 failed / 9). Zero regressions.
- **Server neighbour suites** (`omniscore-mutual-matches-1271`, `admin-modules-mutual-matches-1152`, `matching-engine-omniscore-null-1717`, `matching-engine-trustscore-null-1724`): 2 passed, 2 DB-gated skipped, 5 tests passed, 0 failed. `node --check` passes on both widened server files.

## HL-003 completion gate (fresh-install journey, local PG rig)

Rig: PG 18.6 cluster `~/workspace/pg-gate-2034` at `127.0.0.1:55442` (role `gatepg` created on the rig; the listening instance's superuser is `postgres`). Throwaway DB **`gate2057`**: `node migrate.js` exit **0**. Seeded: recruiter + candidate users, one company, four jobs (USD min/max-only, INR min/max-only, no-salary, text-only salary), candidate applications on three, identical 1536-dim embeddings for the recommendations leg. Server run from this branch against the fresh DB; per-step results:

1. PASS — `GET /api/jobs/1` (USD min/max-only) payload carries min 80000.00 / max 120000.00 / USD, `salary_range` null → JSON-LD baseSalary emitted with entered currency + bounds.
2. PASS — `GET /api/jobs/2` (INR min/max-only) same shape in INR.
3. PASS — `GET /api/jobs/4` (text-only) → no numeric fields → no baseSalary (honest drop).
4. PASS — `GET /api/jobs/3` (no salary) → no baseSalary; `hasJobSalary` false.
5. PASS — `GET /api/jobs` list (ai-search search leg) carries min/max/currency for both min/max jobs.
6. PASS — Real `formatJobSalary` (imported from `client/src/lib/salary.ts`) on the live list payloads: `₹8,00,000 - ₹12,00,000`, `$80,000 - $120,000`, no-salary honestly empty.
7. PASS — `GET /api/matching/recommendations` (candidate JWT) returns both min/max jobs with `salary_min`/`salary_max`/`currency_code` (widened SELECT + mapping).
8. PASS — Formatter on the live recommendation payload renders `$80,000 - $120,000`.
9. PASS — `GET /api/omniscore/mutual-matches` (candidate JWT) returns 3 matches carrying min/max/currency (widened SELECT).
10. PASS — Formatter on the live mutual-match payloads: `$80,000 - $120,000`, `₹8,00,000 - ₹12,00,000`, no-salary honestly empty.

**Journey result: 10/10 PASS** on the first run; after the review fold the journey was re-run with the gate rebuilt exactly as the fixed page builds it (normalised via the real `toAmount` imported from `salary.ts`) plus a zero-shape step: **11/11 PASS**, with the emitted `baseSalary` for the live USD job reading `{"currency":"USD","value":{"minValue":80000,"maxValue":120000,"unitText":"YEAR"}}` — numbers, from string payloads. Client-side rendering of all three surfaces is additionally proven by the vitest suite above (JSON-LD parsed out of the real rendered page; cards/matches rendered from payload-shaped fixtures).

## Review fold (independent frontend/UX-lens review of PR #2058)

Verdict: **BLOCK** (posted as a PR comment). One blocker + five minors/nits; all folded except where noted:

- **BLOCKER — JSON-LD raw truthiness on PG numeric strings:** string-typed bounds on every real job; `"0.00"` truthy → $0 `baseSalary`; mixed-zero emitted `maxValue: "0.00"`. **Fix:** bounds normalised through the now-exported `toAmount` from `salary.ts`; gate on normalised presence; only present bounds emitted, as numbers. The journey's own step-1 read-back (`salary_min=80000.00`) confirmed the reviewer's premise first-hand before folding.
- **MINOR 2 — fixtures masked the blocker:** JSON-LD/ai-search/omniscore fixtures now use the real string shape; zero, mixed-zero, and text+numbers cases added (red against the first-fix code: 7 failures, then green).
- **MINOR 3 — interface honesty:** `salary_min`/`salary_max` widened to `number | string | null` in `job-detail.tsx` and `ai-search.tsx`, matching `omniscore.tsx` and `JobSalaryFields`.
- **MINOR 4 — no automated server-SQL test:** two jest suites added (see Tests).
- **MINOR 5 — this log's gate rationale was wrong for strings:** corrected above.
- **NIT 6 — SEO meta description:** reviewer agrees out of scope (omission, not a false value); left for a follow-up issue, not filed by this lane.
- **NIT 7 — weak omniscore no-salary assertion:** strengthened to absence of any currency symbol.
- **NIT 8 — `DollarSign` icon beside ₹ strings:** pre-existing pattern, reviewer marks it optional polish, not a defect; untouched.
- Reviewer confirmed clean: both client surfaces' rendering, the privacy/security STOP 1 skip rationale, and ponytail/scope.
