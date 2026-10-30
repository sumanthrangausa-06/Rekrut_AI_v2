# S-D13 residuals build log — #1944 diarization erasure residuals

**Persona:** Nova (implementation), under the #1944 STOP 1 panel position
(Lead + Rex + Scout + privacy engineer + Lex; privacy dissent on L-3
recorded on the issue, Lex overruled). Branch:
`nova/1944-erasure-residuals` off dev.

## What was built

1. `lib/erasureService.js`
   - **F-1 (GAP-A(c)):** the keep-redact UPDATE on `interview_recordings`
     now also sets `diarization_status = NULL, diarization_updated_at = NULL`
     in the same statement (same unheld-rows set; held/undecryptable rows
     untouched, as before).
   - **F-2 sweeps**, placed after the S-D13 diarization deletes, in the
     same erasure transaction:
     - `UPDATE recording_speaker_mappings SET participant_user_id = NULL
       WHERE participant_user_id = $userId`
     - `UPDATE recording_speaker_mappings SET updated_by = NULL
       WHERE updated_by = $userId`
     - One `UPDATE transcript_speaker_audit` nulling each of
       `from_user_id` / `to_user_id` / `actor_user_id` where it equals
       `$userId` (CASE WHEN per column, WHERE any column matches).
     Mapping/audit rows survive with `participant_role` / `action` /
     timestamps intact — only the erased subject's ids are nulled.
   - **Result surface:** `crossRecordingMappingsNulled` (participant +
     updated_by field-null operations) and `crossRecordingAuditNulled`
     (audit rows touched) added beside `diarizationJobsDeleted` /
     `diarizationRunsDeleted`, and to the result JSDoc.
   - Out of scope per STOP 1 / Lex L-2: `panel_consent_snapshot` copies
     on other subjects' jobs/runs stay under the S-D19 consent-tombstone
     exception; their retention-clock sweep is follow-up R-1 (#2011).

2. `server/__tests__/lib/erasure-diarization-1915.integration.test.js`
   (JT-D7 suite extended)
   - Fixtures now seed `diarization_updated_at` non-NULL, and the
     event-linked + session-linked cases assert both diarization
     columns are NULL on the keep-redacted tombstone after
     `erasePersonalData()`.
   - New cross-recording fixture: the erased user appears on another
     candidate's recording as mapping `participant_user_id` and
     `updated_by`, and as audit from/to/actor. Post-erasure assertions:
     those id fields are NULL, mapping/audit rows survive with
     role/action/timestamps intact, swept counts are disclosed on the
     result, and the other recording's own artefacts (its candidate's
     mappings, jobs, runs, transcripts) are untouched.

3. `docs/.../03-solutioning/speaker-labelled-transcripts/architecture.md`
   §6.4 amendment recording the tombstone-column clearing and the
   cross-recording id sweep.

## Gate evidence

- **Red (base dev, extended tests only):** fresh DB `sd13_1944_red`
  created only by `node migrate.js` (exit 0) on the PG18 rig at
  127.0.0.1:55441; suite failed at the F-1 assertion —
  `diarization_status` received `"complete"`, expected null
  (jest exit 1, 1 failed / 1 total).
- **Green:** fresh DB `sd13_1944_green` created only by
  `node migrate.js` (exit 0), same rig. Extended JT-D7 suite: 1 passed /
  1 total. Neighbouring erasure suites (gap-a, skeleton-sweep unit,
  medium-tables, gap-c, beginless-client, pool-fallback ×2, csi,
  sanitizer, failed-retry): 10 suites, 143 passed / 143. A second batch
  of 14 further erasure suites passed fully; `embeddings-erasure` and
  `resume-family-erasure` carry 7 failures that are IDENTICAL on base
  dev (verified by stash-comparison — pre-existing, unrelated to this
  change). The resume-family suite's sequential `mockPhase1` helper
  gained the 3 new sweep entries in sequence position so its alignment
  matches base exactly.
