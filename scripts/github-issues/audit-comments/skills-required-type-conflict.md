## Summary

`jobs.skills_required` is read two incompatible ways in the same codebase. Whichever type the column actually has, one of the two read paths is broken.

## The conflict

Candidate job search treats it as JSON:

```js
// routes/candidate.js — GET /api/candidate/jobs
.map((_, i) => `j.skills_required ::jsonb ? $${paramIndex + i}`)
```

Recruiter analytics treats it as a Postgres array:

```sql
-- routes/recruiter.js
SELECT UNNEST(skills_required) as skill, COUNT(*) as count
FROM jobs
WHERE company_id = $1 AND skills_required IS NOT NULL
```

`text[]` cannot be cast to `jsonb`, and `UNNEST` cannot be applied to `jsonb`. These cannot both succeed against one column.

## Current state

The deployed databases have a jsonb-compatible column, so candidate search works and the recruiter `UNNEST` relies on its surrounding fallback. This was only noticed because migration `068` originally declared the column as `TEXT[]`, which would have made migration-built databases (CI) behave differently from staging and production — candidate skills filtering would have returned 500 there while passing everywhere else.

Migration `068` now declares `JSONB` so migration-built databases match the deployed ones. That removes the environment split but does not resolve the underlying disagreement between the two read paths.

## Why this matters

This is the same class of problem as the original `068` bug: schema that exists only because it was applied out of band, with no migration as the source of truth. Environments drift, and the drift only surfaces on a freshly built database.

## Required actions

1. Decide the canonical type for `skills_required` (`jsonb` is the pragmatic choice — it matches deployed data and the primary read path).
2. Rewrite the recruiter analytics query to work against that type, for example `jsonb_array_elements_text(skills_required)` instead of `UNNEST`.
3. Remove the silent fallback around the recruiter query so a type mismatch fails loudly instead of returning empty analytics.
4. Add a test that exercises the recruiter skills analytics against a migration-built database.

## Acceptance criteria

- [ ] One canonical type for `jobs.skills_required`, created by a migration
- [ ] Both the candidate filter and recruiter analytics read paths work against it
- [ ] Recruiter skills analytics covered by a test on a migration-built database
- [ ] No silent fallback masking a type error
