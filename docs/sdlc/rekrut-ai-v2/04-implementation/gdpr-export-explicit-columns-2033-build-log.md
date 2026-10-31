# GDPR export explicit column lists — #2033 (build log)

Follow-up from Quinn's independent review of PR #2032 (minor 1), plus
the observer_capture_outcomes table added by the PR #2038 review.
STOP 1, the specialist decision, and the recorded privacy-seat
disposition are on issue #2033.

## What changed

In `routes/compliance.js` (POST `/gdpr/export`, biometric section),
four queries read with `SELECT *`. Each now names its columns
explicitly — the fail-closed pattern #2035 applied to the users table
in the same handler:

1. `recording_speaker_mappings` — id, recording_id, speaker_number,
   participant_user_id, participant_role, state, updated_by,
   created_at, updated_at (migration 296).
2. `transcript_speaker_audit` — id, recording_id, speaker_number,
   from_user_id, to_user_id, actor_user_id, action, created_at
   (migration 296).
3. `event_labelling_consent` — id, interview_event_id, user_id,
   decision, notice_version, decided_at, ip_address, user_agent_hash,
   created_at (migration 299). The subject's own ip_address /
   user_agent_hash stay in the list: they are the subject's own data
   and DSAR substance (privacy-seat exclusion recommendation
   considered and not adopted at STOP 1, reasons recorded there).
4. `observer_capture_outcomes` — interview_session_id, candidate_id,
   scope, is_test, cohort_allowlist_version, chunks_persisted,
   chunks_dropped, audio_seconds_captured, capture_gap_ratio,
   stop_reason, started_at, stopped_at (migration 257). Note: the
   #2038-review addendum on #2033 described this table with a
   different column set; the shipped migration 257 schema, the
   lib/observerCapture.js INSERT, and the #2034 fixtures all agree on
   the set above, and that is what this lane uses.

No exported field changes: the bundle shape is identical to before.
The change is purely that a future column added to any of these four
tables will NOT reach a subject's export until someone deliberately
adds it to the list.

## Evidence

- New pin suite `compliance-gdpr-export-explicit-columns-2033.test.js`:
  red 4/4 on the unmodified base (every query was `SELECT *`), green
  4/4 with the fix; dropping one named column (user_agent_hash) from
  a list turns the pin red again, restored green.
- Neighbour suites unchanged and green: 2034 unit, 2028 unit, 2035
  unit + the DSAR absent/repoint suites.
- Real-DB journey: the #2034 journey suite passes on a fresh migrated
  database against the explicit lists (the journey asserts the full
  bundle, including labelling consents and observer outcomes).
