# #1732 — Recruiter aptitude stats route shadowing (build log)

**Defect:** `GET /api/recruiter/aptitude-tests/stats` returned 500
"Failed to fetch test" over real HTTP. In `routes/aptitude.js`,
`GET /recruiter/aptitude-tests/:id` was registered before
`GET /recruiter/aptitude-tests/stats`, so Express matched the literal
segment `stats` as `:id` (`parseInt('stats')` → NaN). The recruiter
aptitude page swallowed the error, so its stats cards never loaded.

**Fix:** pure registration-order move — the `/stats` route block now
sits immediately before the `/:id` block. No handler, query, auth or
payload changed. Class sweep in the same file: `/stats` was the only
single-segment literal shadowed by `/:id`
(`candidates/:candidateId` and `:id/results` are multi-segment and
cannot be captured by `/:id`). The documents-router shadowing noted on
#1624 is a separate issue with its own scope decision.

**User-visible behaviour change:** the recruiter aptitude page's stats
cards (attempts, averages, distribution, category breakdown) load again
instead of silently staying empty.

**Tests:** `server/__tests__/routes/recruiter-aptitude-stats-1732.test.js`
— red-first (stats tests failed on pristine dev: routed to `:id`, 404 in
the fake-DB lane, 500 on real PG), green after the move; `/:id` serving
and its 404 are pinned unchanged. Quinn HL-003 fresh-install evidence is
recorded on the issue.
