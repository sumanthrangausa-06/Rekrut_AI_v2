# #2039 — GDPR export minors: build log

Follow-ups from the #2038 review, built per STOP 1 on #2039 (Lead,
advance run 2026-10-31). Three items; no schema change, no new feature.

## Item 1 — pre-296 note wording: premise already satisfied (no production change)

STOP 1 verified first-hand on dev `b9c68d04e` that the shipped guard
note at `routes/compliance.js` already opens with the required phrase —
*"Speaker labelling records are not available on this database yet (the
speaker-labelling schema has not been applied), so the speaker label,
speaker mapping, label-correction, diarization and labelling-consent
sections are empty."* — and that no "may not exist yet on this database"
wording exists anywhere in shipped code. Disposition per STOP 1: no
production wording change; the lane pins the exact suffix phrase
`Speaker labelling records are not available on this database yet`
with an exact-phrase assertion alongside the existing
`/speaker labelling/i` assertion in both suites:

- unit suite `compliance-gdpr-export-biometric-2034.test.js`, item-10 cell;
- real-DB suite `compliance-gdpr-export-biometric-realdb-2034.test.js`,
  pre-296 cell.

## Item 2 — 2034 real-DB journey suite re-runnability (test-only)

Root cause: `cleanAndSeed` used fixed fixture user IDs (203401–203404)
and DELETE'd the subject's `biometric_audit_log` rows; that log is
append-only (DELETE trigger), so a second run against the same database
failed in setup once a prior run's export had written an 'export' row.

Fix (test file only, journey assertions unchanged apart from item 1):

- The four fixture user IDs derive from a per-run base
  (`RUN_BASE = 1000000 + Math.floor(Math.random() * 900000) * 10`,
  int4-safe, +0…+3 for subject/recruiter/admin/other), and the fixture
  emails — including the pre-296 cell's email — derive from the same
  base; the seed INSERT and both token-generation call sites use the
  derived values.
- The `DELETE FROM biometric_audit_log` teardown line is removed, with
  a comment recording why (append-only; a fresh subject has nothing to
  clean). Remaining teardown DELETEs key off the fresh IDs and are
  no-ops on a re-run.
- Uniqueness check before deciding on further suffixing:
  `interview_rooms.room_name` / `livekit_room_id` carry NO global
  uniqueness (migration 127: the only unique index is the partial
  per-event `idx_interview_rooms_active_event`, and each run creates a
  fresh event), and `consent_receipts` uniqueness is per fresh session
  (migration 244) — so no other seed values needed the run base.

Acceptance proof: the real-DB suite ran TWICE consecutively against the
SAME fresh databases (`n2039_journey` / `n2039_pre296`, built only by
`node migrate.js`, exit 0) — green both times (2/2 tests each run).

## Item 3 — non-object `proposed_mapping` fails closed (production)

In `routes/compliance.js`, the diarization_runs projection previously
fell through raw for any non-object `proposed_mapping`
(`row.proposed_mapping ?? null`), so a malformed value (e.g. a raw
string) would be exported verbatim. The projection now exports `null`
for anything that is not a plain non-array object; the object branch
(entry-by-entry pseudonymisation) is byte-for-byte unchanged.

Pinned by a new unit cell (item 4b) in the 2034 unit suite, using a
per-test mutable mocked run row (the existing `guardFamily` pattern): a
run whose `proposed_mapping` is the raw string
`RAW-MAPPING-SENTINEL-2039` must export `proposed_mapping: null` and
the sentinel must appear nowhere in the response body.

Red-first evidence: on base code the cell failed with
`Received: "RAW-MAPPING-SENTINEL-2039"` (the sentinel leaked); after
the fix the full unit suite is green.

## Evidence summary (this lane)

- Unit 2034 suite: RED 10/11 (item 4b failing on base) → GREEN 11/11.
- Neighbour unit suites (2033 pin, 2035, 2037, 2028 mocked):
  4 suites, 25/25 pass.
- Neighbour real-DB suites (2028, 2035, 2037): 3 suites, 8/8 pass.
- Real-DB 2034 suite: run 1 green 2/2, run 2 (same DBs) green 2/2.
- Rig: PostgreSQL 18.6 at 127.0.0.1:55442; fresh DBs built only by
  `node migrate.js` (exit 0 both).
- RETENTION_PURGE_LIVE and DIARIZATION_ENABLED untouched; no migration.
