# #1890 — Screening-answer enrichment never lands the candidate's answers: build log

**Persona:** Nova (implementation), under Lead's STOP 1 on #1890 (comment 6430903114, 2026-10-26) + evidence amendment (comment 6430971102).
**Skills:** startup-cto → systematic-debugging → test-driven-development → database-reviewer (specialist review) → verification-before-completion; ponytail (one block, no schema change).
**Lessons:** HL-003 (E2E gate), HL-005 (merge-as-you-go), HL-007 (first-hand landings only).

## Root cause (verified first-hand at dev tip `61e1dd4cc`)

The manual-apply enrichment block in `routes/candidate.js` (`submitApplication`,
~L3186–3228) built its UPDATE clauses as:

```js
setClauses.push(`${key} = COALESCE(${idx}, ${key})`);
```

`${idx}` interpolates the bare clause number, so the parsed screening values
were pushed into the values array and never bound (only `$1` = user_id is
used). Verified live on a fresh-install DB during the red run — the server's
own error log, by answer mix:

- availability present → `COALESCE types integer and text cannot be matched`
  (the `COALESCE(<int>, availability)` shape), and
- salary/experience only → `bind message supplies 2 parameters, but prepared
  statement requires 1` (values supplied, no `$n` placeholder exists).

Either way the best-effort try/catch swallowed the error and the enrichment
landed **nothing** — the candidate's stated availability, salary and
experience were all silently lost. (At raw SQL level the clause would write
the literal index as the value — psql-verified — but through the pg driver
the bind failure fires first, so no production profile received a literal
via this route.)

Second defect in the same branch (as filed): availability copied the
free-text answer verbatim into a CHECK-constrained column. The storable set
is the intersection of `chk_candidate_profiles_availability` (migration 047)
and `chk_profiles_availability` (p2_schema_hardening) — exactly
`immediately`, `2 weeks`, `1 month` (pg_constraint-verified on the fresh
DB; reconciliation of the duplicate CHECKs is #1891, not this lane).

## Fix (smallest correct diff, this block only)

1. Clause builder emits real placeholders: `` `${key} = COALESCE($${idx}, ${key})` ``.
2. New `mapScreeningAvailability()` helper: normalises the free-text answer
   and maps it onto the storable set — exact storable strings pass through;
   `immediate*/now/asap/right away` → `immediately`; `2 week*/two week*` →
   `2 weeks`; `1 month/one month/30 day*` → `1 month`; anything else →
   `null`, and the caller skips the availability write with a one-line
   logged reason while the sibling fields still land.
3. No schema, constraint, or client change; salary extraction and
   experience brackets untouched.

## Red / green evidence (real DB, HL-003)

Rig: PGDG PostgreSQL 16.15 + pgvector tree (`~/pg16`) on `127.0.0.1:55471`,
user `nobody`. Both gate databases built fresh ONLY by `node migrate.js`
(exit 0). Suite:
`server/__tests__/routes/candidate-screening-enrichment-1890.test.js`
(1 static contract + 4 real-DB legs over real HTTP via supertest against
the real candidate router and real `lib/db`; only auth mocked, #1787
pattern). Journey: candidate applies manually to a job with screening
questions → profile read back from the DB.

**RED** — DB `nova1890_red`, code BEFORE the fix: **5 failed / 5 total.**
Availability legs: profile availability stayed NULL (enrichment errored,
see server log above). Salary-only leg: salary_min stayed NULL (bind
error). Experience in the unmappable leg: stayed NULL (whole UPDATE lost).

**GREEN** — DB `nova1890_green`, after the fix: **5 passed / 5 total.**
(a) `Immediately` + `80000 - 100000` + `3-5` → availability `immediately`,
salary_min 80000, salary_max 100000, years_experience 4. (b) salary-only
`60000` → salary_min 60000, salary_max NULL. (c) `After my notice period
ends` + `5-10` → availability NULL, years_experience 7, and the server log
carries `[enrichment] availability answer not mappable to canonical
vocabulary — skipped for candidate …`. (d) `In 2 weeks` → `2 weeks`;
`One month` → `1 month`.

**Regressions (same green DB):** #1893 suite 4/4, #1889 suite 7/7,
#1631 suite 8/8 — all PASS.
