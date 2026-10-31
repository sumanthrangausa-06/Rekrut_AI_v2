# #2011 Part A — `panelConsentSnapshotsRetained`: retained panel_consent_snapshot copies counted on the erasure result (build log)

Story: #2011 [FOLLOW-UP] panel_consent_snapshot retention-clock sweep — Part A ONLY
(Lex's disclosure condition from the full #1944 position, recorded on #2011
2026-10-30). Part B (the retention-clock sweep) is NOT in this lane; #2011
stays OPEN.
STOP 1: issue #2011 comment 6536037873 (posted before any code).
Base: dev `668e6de96`. Branch: `nova/2011-snapshot-retained-count`.
PR to dev only; no merge/closure by Nova — Suga gates.

## Root cause

`erasePersonalData` (lib/erasureService.js) deletes the subject's own
`event_labelling_consent` rows and reports `panelLabellingConsentDeleted`,
but the S-D19 retention exception means `panel_consent_snapshot` copies on
`diarization_jobs` / `diarization_runs` (migration 299, JSONB) are never
touched by erasure. A copy naming the erased user could survive on another
subject's recording with zero disclosure on the result surface — the
skeleton-sweep honesty note already said such copies "are reported
separately", except nothing reported them.

## What changed

- `lib/erasureService.js`: one read-only COUNT inside the erasure
  transaction, immediately after the S-D19 `event_labelling_consent`
  DELETE — i.e. after the S-D13 deletes of the subject's OWN
  diarization jobs/runs (the only diarization-row DELETEs in the
  routine), so the count can only see surviving rows. The result gains
  `panelConsentSnapshotsRetained` beside `panelLabellingConsentDeleted`
  (+ JSDoc result-type line). Snapshots themselves are never read into
  the result, never modified — count only (#1128 counts-only discipline;
  the sanitizer passes plain numbers through unchanged).
- Counting semantics (STOP 1, decided there): one retained entry = one
  surviving jobs/runs ROW whose non-NULL snapshot references the erased
  user via `expected_user_ids` OR any `decisions[].user_id` (both are
  written by lib/diarizationGate.js; a row matching both counts once).
  One combined jobs+runs field. Jobs merely CANCELLED by the #2019
  sweep still carry their snapshot and count as retained.
- `server/__tests__/lib/erasure-diarization-1915.integration.test.js`:
  the JT-D7 journey extended — cross job+run copies (decisions leg,
  pre-existing fixtures), a control-job copy (expected leg only), one
  in-flight job copy (cancelled, counted), and the subject's OWN job
  copy (row deleted, NOT counted). Asserts
  `panelConsentSnapshotsRetained === 4` and byte-identical survival of
  the retained copies.
- `server/__tests__/lib/erasure-medium-tables.test.js`: one added entry
  in the sequential mock queue (the suite's documented overflow
  arithmetic) for the new COUNT query — same fix pattern as #2019.

## Specialist decision (STOP 1)

Specialist YES — privacy-engineer lens applied (rows-as-unit; count-only,
no content/hashes; after-deletion placement) and Lex lens applied (the
condition is Lex's; field name and named-residual framing follow it;
Part B remains Lex-gated). Skipped: database (no schema change),
security (no new input surface; parameterised query), UX (no surface
change). Full reasoning on the STOP 1 comment.

## Evidence (HL-003, real DB)

Rig: PG 18.6 (extracted pgfull tree binaries) fresh cluster at
/opt/pg2011, 127.0.0.1:55439; fresh DBs created per suite and migrated
with `node migrate.js` from the worktree (exit 0 for both DBs below).

- RED (base lib, extended test): `panelConsentSnapshotsRetained`
  received `undefined`, expected 4 — every earlier journey assertion
  passed, so the fixtures seed as designed.
- GREEN: `erasure-diarization-1915.integration.test.js` — 1 passed.
- `gap-c-1972-panel-erasure.integration.test.js` on a second fresh DB —
  2 passed (incl. the real HTTP DELETE /api/auth/delete-account door).
- Neighbouring batch (erasure*, gap-*, application-*, threat-intel,
  observer-audio, job-applications, admin-dsar routes): 382 passed,
  3 failed — the 3 failures are `erasure-gap-a.test.js` tests that fail
  IDENTICALLY on unmodified base (verified by stash comparison);
  pre-existing, not this lane.
- Diarization + sanitizer unit suites: 140 passed, 19 skipped
  (env-gated integration suites).
