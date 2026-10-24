# #1625 — Admin agents stats fabricated avg_duration 0 (build log)

**Defect:** `GET /api/admin/agents/stats` reported `avgDuration: 0`
when no agent run had completed in the window. Three layers fabricated
it in `routes/admin.js`: `COALESCE(AVG(...), 0)` in the SQL, the
safeQuery fallback row `{avg_duration: 0}`, and
`parseInt(...) || 0` flattening even a NULL result to 0.

**Fix (pattern from #1611):** plain `AVG(...)` (NULL when unmeasured),
fallback row `{avg_duration: null}`, and a parse that preserves null
(a measured average — including a genuine 0 — passes through
unchanged).

**Consumer check:** `stats.avgDuration` is fetched into the client's
`AgentStats` type but is not rendered anywhere on the admin agents page
(the rendered "Avg Duration" labels show the per-agent value from a
different payload). The client change is therefore the type widening
`avgDuration: number | null`, so no future consumer can assume a
measured number; there is no visual change today.

**User-visible behaviour change:** the admin stats API now honestly
reports `avgDuration: null` ("not measured") instead of a
measured-looking 0 when no runs have completed.

**Tests:** `server/__tests__/routes/admin-agents-stats-avg-duration-1625.test.js`
— red-first (unmeasured case failed on pristine dev), green after
(3/3, including measured-average and genuine-0 guards); neighbouring
admin suites 10/10; client agents page suite 2/2. Quinn HL-003
fresh-install evidence is recorded on the issue.
