# #2059 — Job-detail meta-description salary text + ai-search DollarSign icon — build log

Follow-up filed from the independent (frontend/UX) review of PR #2058 / #2057.
STOP 1 on issue #2059 (comment 6548913600): premises verified first-hand at
dev `aeab48488`; specialist YES frontend/UX; privacy/security + DB considered
and skipped with reasons (no data/auth/schema surface).

## Changes (2 production files, smallest diff, shared formatter reused)

1. `client/src/pages/candidate/job-detail.tsx`
   - SEO meta `description` salary fragment now built via
     `hasJobSalary(job) ? `Salary: ${formatJobSalary(job)}. ` : ''` instead of
     interpolating `job.salary_range` only. `hasJobSalary` added to the
     existing `@/lib/salary` import.
   - Behaviour: text-only jobs render verbatim (identical to before);
     min/max-only jobs now carry their entered-currency figure in the
     description (matching the page body and the #2057 JSON-LD treatment);
     no-salary jobs keep no salary fragment — never "Salary not specified"
     in a meta description.
2. `client/src/pages/candidate/ai-search.tsx`
   - `SearchResultCard`: `DollarSign` icon dropped beside the salary string
     (the string from `formatJobSalary` carries its own currency symbol; a $
     icon beside a ₹ figure was a wrong-currency claim). Unused import removed.
   - Scope is this card only, per the issue; other DollarSign surfaces
     (JobCard, job-detail-drawer, filter inputs) were not swept.

## Evidence

- New pin suite `client/src/__tests__/pages/SalaryMetaIcon2059.test.tsx`:
  red on base 4F/2P (the 2 passes are the guard cells — text verbatim and
  no-salary honesty), green 6/6 after the fix.
- Neighbours green: SalarySurfaces2057 15/15, SalaryDisplayContract1019 15/15
  (combined run 36/36).
- No server, schema, or data change — no fresh-DB journey applies; the user
  journey asserted is the candidate-visible one: the share/search description
  of a job now shows the same salary the job page itself shows, and AI-search
  results never pair a $ icon with a non-$ figure.
