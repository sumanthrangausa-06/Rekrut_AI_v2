## Summary

`rekrutai-staging` and `rekrutai-prod` are connected to **the same Neon database**. Staging is not an isolated environment — every write made against staging lands in production data, and production's public job board is currently serving E2E and QA test records.

## Evidence

Both services report the same host, database and user at boot.

Production (`srv-d69opaer433s73d6p570`):

```
"host": "ep-calm-field-aipg6g97-pooler.c-4.us-east-1.aws.neon.tech",
"database": "neondb",
```

Staging (`srv-d8j6js3bc2fs73bf4rmg`):

```
"host": "ep-calm-field-aipg6g97-pooler.c-4.us-east-1.aws.neon.tech",
"database": "neondb",
"user": "neondb_owner",
```

Neon assigns a distinct `ep-*` endpoint per branch, so an identical endpoint means the same branch and the same data — not merely the same project.

The data confirms it. `/api/jobs?limit=5` returns byte-identical rows, including primary keys, from both hosts:

| id | title | company |
|---|---|---|
| 174 | QA Loop Engineer 1786179662 | QA Staging Co 1786175490 |
| 173 | E2E Test Engineer 1780943007852 Updated | E2E Test Co |
| 172 | E2E Pipeline Job 1780942973616 | E2E Test Co |
| 171 | E2E Critical Flow Job 1780942925457 | E2E Test Co |
| 170 | E2E Integration Job | E2E Integration Co |

These are automated-test artifacts, and they are live on the public production job board.

## Impact

1. **Production data is publicly polluted with test records.** Real visitors to the production job board see "E2E Test Engineer" and "QA Staging Co" listings.
2. **Staging QA mutates production.** Any QA performed against staging writes production rows. During this investigation a candidate account `qa.staging.223747@example.com` (user id 119) was created against staging and therefore exists in the production database. **It should be deleted.**
3. **E2E test runs are a production write path.** The test suite creates jobs, applications and users. If it ever pointed at this database it would be writing directly to production.
4. **Compounds the live Stripe key issue (#149).** Staging was configured with live Stripe credentials *and* connected to the production database, so a staging checkout could have created a real charge attached to a real production user.
5. **No safe rollback rehearsal.** A destructive migration tested on staging would destroy production data, because it is the same data.

## Required actions

1. Provision a separate database for staging — a Neon branch off production is the fastest route and gives realistic data.
2. Point `DATABASE_URL` on `rekrutai-staging` at the new database.
3. Confirm which database `rekrutai-dev` uses and separate it too if it shares the endpoint.
4. Delete the test user `qa.staging.223747@example.com` (id 119) from production.
5. Purge the E2E and QA job records from production, at minimum ids 170-174, and audit for other test artifacts (`E2E Test Co`, `E2E Integration Co`, `QA Staging Co`).
6. Confirm the E2E suite never points at a shared database, and fail the run loudly if `DATABASE_URL` resolves to the production endpoint.

## Acceptance criteria

- [ ] Staging and production report different database endpoints at boot
- [ ] Production job board contains no E2E or QA test records
- [ ] Test user id 119 removed from production
- [ ] Dev environment confirmed separate
- [ ] A guard prevents non-production services from pointing at the production endpoint
