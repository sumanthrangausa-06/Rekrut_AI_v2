# FS-013 (#1019) REMAINDER — salary entry→display contract: build log

**Story:** #1019 [STORY] FS-013: Salary entered = salary displayed — REMAINDER only.
**Branch:** `fix/1019-salary-contract-remainder` from `origin/dev` @ `08c87549d`.
**STOP 1:** posted on #1019 (surface census + specialist decision + fix/test plan) before build.

## What was already proven (not redone)
The min/max USD shape was proven end-to-end on fresh-install dev by the
#315 closure (Quinn AFTER capture, 2026-10-21, 18/18 PASS). This lane
covers the remainder from #1019's cross-link comment: the other salary
shapes (salary_range text / fixed single value / max-only / no salary)
× both launch-market currencies (USD, INR). The USD min/max path has
regression coverage only.

## Root cause (from the STOP 1 census)
No shared salary formatter existed. Each display surface hand-rolled
its own formatting: candidate list card and detail drawer/page
hard-coded USD/`$`, none read the `currency_code` the API already
returns on every job payload, a max-only salary rendered as a bare
figure (reads as a fixed salary), the domain card fell back to an
ungrounded `Competitive` label, and `GET /api/company/:slug/jobs`
synthesized a `$…` string server-side while discarding the stored
range text, fixed values, and currency entirely.

## Fix (ponytail — one shared formatter, fewest files)
- **New `client/src/lib/salary.ts`** — `formatJobSalary(fields)` +
  `hasJobSalary(fields)`: range text verbatim → min+max in the entered
  currency (`Intl.NumberFormat`; INR uses `en-IN` grouping) → min-only
  `X+` → max-only `Up to X` → none `Salary not specified`. Numeric
  strings from the API coerced; invalid currency falls back to USD.
- Surfaces rewired to it: candidate `JobCard`, `job-detail-drawer`,
  candidate `job-detail` page (incl. JSON-LD `baseSalary.currency`,
  previously hard-coded `USD`), domain `job-card` (gains range-text
  support; keeps its period suffix), `top-matches` (now passes the
  API's `currency_code` + `salary_range`), `saved-jobs`, candidate
  `applications` dialog, recruiter `public-company` page.
  `currency_code` added to the client job types that lacked it.
- **Server:** `routes/company.js` `/:slug/jobs` returns the real
  `salary_range`, `salary_min`, `salary_max`, `currency_code` and stops
  `$`-synthesizing; `routes/candidate.js` applications SELECT adds
  `j.salary_min, j.salary_max, j.currency_code` (the payload previously
  carried range text only). No schema changes.

## Specialist decision
UX/frontend lens (agency-agents `design-ux-architect`) — Yes, per
STOP 1: the risk domain is presentation consistency and honest
empty/ambiguous states. Its two calls are in the contract: max-only
never renders bare; "no salary" is one honest rendering, never an
invented figure or ungrounded label.

## Evidence
- **Contract test (red-first):** `client/src/__tests__/pages/SalaryDisplayContract1019.test.tsx`
  — 15 tests (list card, detail drawer, domain card × shapes × USD/INR).
  On base: **7 failed / 8 passed** (failures = INR on list + drawer,
  drawer max-only, domain range-text, domain none). After fix: **15/15 PASS**.
- **Neighbours:** job-board/detail/applications suites — 7 files,
  **51 passed / 5 skipped** (pre-existing skips); null-salary offer
  suites **11/11 PASS**. Client `tsc --noEmit`: 83 errors = base parity,
  zero in touched files.
- **Fresh-DB journey (HL-003):** DB `rekrut_1019_journey` built only by
  `node migrate.js` (exit 0) on a fresh PG 18.6 rig at 127.0.0.1:55442;
  server from this branch on :31019 (health: db connected, branch
  read-back correct). Recruiter posted 8 jobs (INR/USD × range,
  range-text, fixed, max-only, none) through the real `POST /api/jobs`;
  candidate detail, candidate list, public v1 detail, and the public
  company-jobs surface read back the entered amount + currency for
  every shape — **62/62 PASS, 0 FAIL**. Evidence:
  `goals/launch-rekrut-ai-v2-by-january/hidden_files/nova-1019-2026-10-31/`
  (journey.py, journey.log, health.json, per-surface JSON read-backs).
  Note: the documented pg-gate-2034 cluster was down and its data dir
  is not traversable by the rig user in this session, so an equivalent
  fresh cluster was built from the same PG 18.6 binaries in /tmp —
  the gate ran against a genuinely fresh `migrate.js` DB either way.

## Gates state
PR to `dev` only. **Not merged, issue not closed** — Suga gates after
independent review, per lane instructions.
