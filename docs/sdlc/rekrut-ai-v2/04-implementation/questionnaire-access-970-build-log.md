# Build log — #970 / FS-038: questionnaire access-check dead clause

Persona: Lead (coordination) · Nova (build) · Suga (verification + landing)
STOP 1: issue #970, comment 6434016755.

## Defect

`GET /response-by-application/:application_id` in `routes/questionnaire.js`
guarded access with:

```js
if (app.company_id !== userCompanyId && app.user_id !== req.user.id)
```

`app` is a `job_applications` row (`SELECT ja.*, j.company_id`).
`job_applications` has no `user_id` column — migration 002 creates it with
`candidate_id`, and no later migration adds `user_id`. Verified first-hand
twice: the migration grep, and the live fresh-install schema
(`information_schema.columns` for `job_applications` lists `candidate_id`,
no `user_id`). So `app.user_id` was always `undefined`,
`undefined !== req.user.id` was always true, and the clause could never
grant access — dead by construction. The live predicate was always the
company match alone, the same predicate every sibling recruiter check in
the file uses via `verifyJobAccess`.

Discussed position (STOP 1): REMOVE the clause. Making it live as
`candidate_id` would hand the candidate a path into a route role-gated to
recruiter / hiring_manager / admin / employer — the wrong surface.

## Fix

One line: the condition is now `if (app.company_id !== userCompanyId)`.
Nothing else in the handler changes. Behaviour for every real row is
unchanged, because the removed clause never fired.

## Evidence (all re-verified first-hand by Suga before merge)

- RED: with the fix stashed (pristine dev source), the suite's two static
  contract tests FAIL (2 failed, 3 skipped without the DB env var) —
  the clause is present and the standalone-predicate assertion fails.
- GREEN: `QUESTIONNAIRE970_INTEGRATION_DB_URL` pointed at a fresh-install
  database built ONLY by `node migrate.js` (exit 0; PG16 rig at
  /tmp/pgbin16 + pgvector 0.8.7 from the PGDG .deb, database `q970` on
  127.0.0.1:55433): **5 passed / 5 total** — 2 static + 3 real-HTTP
  journey tests (same-company recruiter 200 with the response body;
  other-company recruiter 403 "Access denied"; application with no
  screening response 404). Only auth is mocked (req.user injection,
  #1787 pattern); the router and `lib/db` are real.
- Regression: neighbouring `questionnaire-evaluate-parse-failure-1571`
  suite — 3 passed / 3 total.
- Suite: `server/__tests__/routes/questionnaire-access-check-970.test.js`.

## Landing note (HL-007)

The builder's initial report claimed commits and a PR that did not exist
on GitHub or in the local clone when checked first-hand; only the working
tree (fix + test file) had actually landed, in `~/wt-970`. Suga re-ran
every gate first-hand (red, green, regression, schema check), wrote this
log, and performed the commit / push / PR / merge personally. The claimed
artefacts were not relied on.
