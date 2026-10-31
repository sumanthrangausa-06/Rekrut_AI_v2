# #2061 — Whitespace-only salary_range renders an empty salary fragment

Build log (advance run 2026-11-01 03:13 IST; STOP 1 on #2061).

## Root cause
`client/src/lib/salary.ts`: `formatJobSalary` returned `job.salary_range`
verbatim whenever truthy, and `hasJobSalary` used `Boolean(job.salary_range)`.
A whitespace-only range (`"   "`) is truthy, so it counted as present and
rendered as an empty-looking fragment — the job-detail meta description read
`Salary:  .` and page surfaces showed a blank salary. Pre-existing shared-
formatter semantics (flagged as a non-blocking note in the #2059 review).

## Fix (one shared fix — every surface inherits it)
- `formatJobSalary`: `const range = job.salary_range?.trim(); if (range) return range;`
  — whitespace-only falls through to the numeric bounds or the honest
  "Salary not specified"; a padded real range renders trimmed-verbatim.
- `hasJobSalary`: same trim rule (`Boolean(job.salary_range?.trim())`).
- Header contract comment updated. No server or schema change.

## Evidence
- Pin suite `client/src/__tests__/lib/salaryWhitespace2061.test.ts`:
  RED 5F/3P on base (3 passes = guard cells) → GREEN 8/8 after the fix.
- Neighbours: SalaryDisplayContract1019 15/15, SalarySurfaces2057 15/15,
  SalaryMetaIcon2059 6/6 — combined client run 44/44.
- Server salary suites (jest): omniscore-mutual-matches-salary-2057 +
  matching-engine-salary-fields-2057 — 3/3.
- `tsc --noEmit` parity: 83 errors on base = 83 on the branch (no new).

## User-journey framing
A candidate opening a job whose recruiter typed only spaces in the salary
field now sees the job's real min/max salary, or an honest "Salary not
specified" — never a blank `Salary: .` fragment. The page-level neighbour
suites (1019/2057/2059) render the real pages through this formatter.
