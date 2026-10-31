# #2028 item 4 — POST /gdpr/export gains a `biometric` section (build log)

**Issue:** #2028 item 4 — the biometric-policy §5 promise ("a complete
copy of your biometric data") was wider than the product: the only
data-subject export, `POST /gdpr/export` in `routes/compliance.js`,
contained none of the speech-measurement, recording, speaker-label or
labelling-consent data.
**STOP 1:** Lead / Suga (CTO office), advance run 2026-10-31 — issue
#2028 comment 6540273741. Panel-discussed (HL-004, not a solo call):
Lex (legal seat — extend is required; jobs/runs/metrics are system
records, excluded; third-party IDs never raw), privacy specialist
(envelope never exported raw; third-party IDs stripped to role/null;
`event_labelling_consent` in scope; runs excluded — `proposed_mapping`
can embed other participants' names), Rex (architecture — one new
top-level `biometric` section in the handler's existing conventions;
recordings via the interview_events bridge; fresh-install journey
required; Rex's proposal to include sanitised jobs/runs was recorded
as dissent and not adopted). Specialist decision: YES — the panel
above; DB specialist skipped (read-only queries on existing indexed
keys, no schema change); security considered — the endpoint's
existing access control (#1548 guard, `canAccessUserRecord`) is
unchanged and the new section only reads the authorised subject's
rows. §5 wording unchanged. No migration.
**Persona:** Nova (implementation). Base: `origin/dev` `3705ff826`.
Branch: `nova/2028-gdpr-export-biometric`.

## Verified recordings bridge (first-hand, at build)

`interview_recordings` has no candidate key. The chain used is:

1. `interview_events.candidate_id = $subject` — migration 126
   (`interview_events.candidate_id INTEGER NOT NULL REFERENCES
   users(id)`).
2. `interview_recordings.interview_event_id = interview_events.id` —
   migrations 128/129.
3. `interview_transcripts.recording_id = interview_recordings.id` —
   migration 128; `recording_speaker_mappings.recording_id` and
   `transcript_speaker_audit.recording_id` — migration 296.

One correction to the STOP 1's shorthand, verified against migration
299: `event_labelling_consent` has **no `candidate_id` column** — it
is keyed by `user_id` (plus `interview_event_id`). The export queries
`WHERE user_id = $subject`.

## What changed

- `routes/compliance.js` — `/gdpr/export` handler only (plus three
  requires: `lib/biometricCrypto`, `unpackEnvelope` from
  `lib/r2FrameStore`, `lib/r2ObserverAudioStore`):
  - `speech_measurements`: non-envelope columns (`id,
    interview_session_id, candidate_id, method_version, state,
    is_test, created_at, updated_at`) selected for the bundle; the
    envelope is fetched in a **separate query** into a variable used
    only for decryption, so envelope bytes never enter the bundle.
    Per row: `unpackEnvelope` → `biometricCrypto.decryptWithDEK(
    ciphertext, iv, tag, candidateId,
    r2ObserverAudioStore.measurementAAD(candidateId, sessionId))` →
    `JSON.parse` → `measurements`. This is the writer's own path
    (`lib/observerCapture.js`). Per-row try/catch: on failure the row
    exports `measurements: null` plus a per-row `note` — one bad row
    never fails the export, and raw ciphertext is never a fallback.
    (Note: `decryptWithDEK` internally calls `getOrCreateDEK`; for a
    shredded DEK it throws, and for an absent DEK the freshly created
    key fails tag verification — both land in the same catch.)
  - `recordings`: metadata only via the bridge above (`id,
    interview_event_id, status, diarization_status,
    diarization_updated_at, started_at, stopped_at,
    duration_seconds, file_format, file_size_bytes,
    retention_expires_at, created_at`) — `storage_path` and
    `encryption_key_id` are never selected.
  - `speaker_labels`: `interview_transcripts` rows for those
    recordings (explicit columns incl. `speaker_number`).
  - `speaker_mappings`: rows for those recordings;
    `participant_user_id` / `updated_by` kept only when equal to the
    subject, else `null`; `participant_role` kept.
  - `speaker_label_audit`: `transcript_speaker_audit` rows for those
    recordings where `from_user_id = $subject OR to_user_id =
    $subject`; `from_user_id` / `to_user_id` / `actor_user_id` kept
    only when equal to the subject, else `null`.
  - `labelling_consents`: `event_labelling_consent WHERE user_id =
    $subject` (see the bridge note above).
  - `diarization_jobs`, `diarization_runs`,
    `diarization_metrics_daily` are not read at all (panel ruling).
  - Bundle: `exportData.biometric = { speech_measurements,
    recordings, speaker_labels, speaker_mappings,
    speaker_label_audit, labelling_consents, note }` — the `note`
    annotation follows the `omniscore.scale_note` pattern and
    explains the decryption, the metadata-only recordings, and the
    third-party-ID treatment. The section is present with all arrays
    empty when the subject has no biometric data (#1540
    explicit-absence pattern).
- Neighbouring-suite pins updated for the new bundle key (direct
  consequence of this lane, no behaviour change):
  `compliance-dsar-export-repoint-1533.test.js` (two exact-key-set
  pins) and `compliance-dsar-export-absent-1548.test.js` (the
  "exact bundle" pin, 8 keys → 9) each grow by exactly `biometric`,
  with a comment citing this lane.

## Tests

1. **Mocked-pool unit suite** (new):
   `server/__tests__/routes/compliance-gdpr-export-biometric-2028.test.js`
   — extends the #1533 pattern (real route, mocked pool boundary;
   `biometricCrypto.decryptWithDEK` stubbed in this suite ONLY, the
   envelope built with the real `packEnvelope`). 8 tests: bundle
   shape + note; decrypted measurements present; envelope bytes
   nowhere in the JSON response; decrypt failure → `measurements:
   null` + per-row note + HTTP 200; other participant's mapping →
   `participant_user_id: null`, role kept; audit third-party IDs
   nulled; empty state; SQL hygiene (no `storage_path` /
   `encryption_key_id` selected, no diarization system tables read,
   metadata query never selects the envelope).
   **Red on base:** 7 failed / 1 passed. **Green:** 8/8.
2. **Fresh-install integration journey** (new, HL-003):
   `server/__tests__/routes/compliance-gdpr-export-biometric-realdb-2028.test.js`
   — real PG, fresh DB built ONLY by `node migrate.js` (exit 0),
   seeded candidate + recruiter + other participant, interview
   session/event/room/recording (with a sentinel `storage_path` and
   `encryption_key_id` that must NOT leak), transcript, mappings for
   subject + other participant, audit rows involving and not
   involving the subject, a labelling consent, and a speech
   measurement whose envelope is created with the REAL
   `encryptWithDEK` + `packEnvelope` + `measurementAAD` helpers.
   The real compliance router is exercised over HTTP (supertest
   against the real router assembly with real auth and real DB —
   the full `server.js` boot is not used because it starts
   workers/listeners unrelated to this route; recorded here per the
   lane brief). Asserts: decrypted measurement values read back
   exactly; other participant's ID absent from the entire response;
   envelope base64 absent; recording metadata without
   `storage_path`/`encryption_key_id`; audit scoping + nulling;
   `data_requests` completed row and `audit_logs` side-effects as
   existing behaviour.
   **Red on base:** 1 failed. **Green:** 1/1.
   Rig: PostgreSQL 18.6 (postgres-linux-x86_64 build in
   `/tmp/pg2028`, run as an unprivileged user) at
   `127.0.0.1:55439`, with pgvector 0.8.7 extension files taken from
   the PGDG .deb in `~/workspace/pgfull/debs/` (the txz build ships
   no pgvector; the pre-existing `~/workspace/pgfull` cluster could
   not be started from this run's user context). DB `gdpr2028`
   created empty, built only by `node migrate.js`.
3. **Neighbouring suites — no regressions:** all
   `server/__tests__/routes/compliance-*` suites: 198 passed, 1
   skipped (the env-gated real-DB suite above, run separately),
   0 failed. Named gates among them: dsar-export 1533, dsar-export
   absent 1548, consent-absent 1550, compliance-authz.

## Out of scope (unchanged)

§5 policy wording, every other endpoint, no migration,
`RETENTION_PURGE_LIVE` and `DIARIZATION_ENABLED` untouched. #2028
stays open for its remaining items; this lane closes item 4 only,
at Suga's gate.
