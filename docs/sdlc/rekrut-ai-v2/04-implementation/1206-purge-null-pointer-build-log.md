# #1206 — Retention purge NULLs the storage pointer on verified delete (build log)

**Lane:** advance run 2026-10-27 00:43 PT. STOP 1 on issue #1206 (comment 6436573218).

## Defect
`EuComplianceService.purgeExpiredRecordings` marked an `interview_recordings`
row `status='deleted'` after its storage object was deleted, but left the
encrypted `storage_path` pointer on the row forever. Erasure's keep-redacted
transition for the same table already NULLs the pointer
(`lib/erasureService.js:1785-1786`). The purge UPDATE was the sole production
writer marking a recording deleted without NULLing (grep of all 13
`UPDATE interview_recordings` sites, Scout-verified).

## Fix (one line)
The purge's mark-deleted UPDATE is now
`SET status = 'deleted', storage_path = NULL, updated_at = NOW()`, inside the
existing `!dryRun && storageOk` gate — so the pointer is cleared only when the
storage delete succeeded (or no pointer existed). Undecryptable and
soft-failed rows keep their pointer and stay retryable (pre-existing
fail-closed behaviour, unchanged). No schema change (BYTEA is nullable).

## Evidence
- **Jest (mocked-db state machine, resulting-row assertions):**
  `server/__tests__/lib/retention-purge-null-pointer-1206.test.js` — RED on
  pristine dev: 2 failed (both verified-delete cases retained the pointer),
  4 passed. GREEN after fix: 6/6. Regressions: retention-lifecycle,
  retention-s3-recording-purge, legal-hold suites — 105 passed.
- **Real-DB gate (HL-003):** fresh DB built only by `migrate.js` (exit 0,
  PG16 rig), real service code, real encryption; a fake S3 HTTP endpoint
  stood in only at the network edge for the verified-delete leg
  (DELETE + HEAD-verify observed). RED on pristine dev: the two verified-s3
  rows ended `deleted` with the pointer RETAINED (2 checks failed).
  GREEN after fix: 12/12 — verified s3 ⇒ deleted + `storage_path IS NULL`;
  no-pointer ⇒ deleted + NULL; undecryptable ⇒ row unchanged, error class
  `storage_path_undecryptable`; soft-failed provider delete ⇒ unchanged;
  dry-run ⇒ all rows unchanged.

## Out of scope (issue stays OPEN)
The pre-existing population of already-`deleted` rows still holding pointers
(the `deleted_pointer_retained` class) needs a per-row verified-deletion
reconciliation against the live DB — blocked with the Train 14C Lex-C1 census
class (Neon access; founder ride-out to Nov 1). Never a blanket NULL: an
undecryptable pointer is the only inventory of a possibly-surviving object.

## Wording note (privacy reviewer nit)
The r2/b2 leg's stamp evidence is the provider DeleteObject/alreadyGone
result — the same evidence `status='deleted'` already relied on; this change
does not claim independent verification for that leg.
