# Train 10 patch manifest — migration fresh-chain fix (#1155) → staging

Date: 2026-10-25 · Owner: Relay · Authorization: standing promotion authorization (Sumanth, 2026-10-22)

## Why
Train 9's checkpoint (PR #1847) found a pre-existing promotion debt: a
fresh-DB migrate on the staging tree fails at migrations/257_observer_capture.js —
staging still carried the old information_schema constraint lookup that
misidentifies PG18 NOT NULL constraints as CHECKs (#1155). Dev carries the
pg_constraint fix for both 257 (PR #1331) and its sibling 254 (#1329).
The shared staging/prod DB already applied both migrations, so deploys were
unaffected; only the staging tree's fresh-install chain was broken.

## Contents (cherry-picks from dev, patch-identical)
- f8fb3396e — migration 254: entity_type CHECK lookup → pg_constraint contype='c' (#1329)
- 52fcbd51f — migration 257: dropCheckByName → pg_constraint contype='c' (#1155), incl. its PG18 regression tests

Both migration files are byte-identical to dev after the picks (diff = 0).
No schema change on the shared DB: these migrations already applied there;
this train only repairs the staging tree's copy of the migration files.

## Evidence
- Baseline: fresh migrate on pre-train staging tree halted at 257 (Train 9 checkpoint, PR #1847).
- Train tree: fresh DB (local PG 18, mig1155_train) `node migrate.js` →
  "All migrations completed successfully" (2026-10-25, this run).

## After merge
- Registry note on cv-review is unaffected (no module version change — infra patch).
- Same patch rides to main with the next main train so prod tree fresh-migrates too.
