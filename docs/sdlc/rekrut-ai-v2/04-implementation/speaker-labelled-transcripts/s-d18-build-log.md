# S-D18 Build Log — BR-7 capture (#1955)

Persona: Nova (Phase 4). STOP 1: #1955 comment 6492139471. Design:
`03-solutioning/speaker-labelled-transcripts/br7-panel-notice-design.md`
§§4.2, 5, 6, 13 items 3+6, 14 T-C1..T-C6. Branch:
`nova/1955-sd18-br7-capture` from dev 4946aeafe.

## Specialist BLOCKs/conditions — disposition

- Privacy B-1: event FK `ON DELETE RESTRICT` — migration 299 +
  post-state assertion by column + confdeltype ('r'). B-2: NO
  UNIQUE(event,user) — absence asserted via pg_constraint scan.
  M-conditions: allowlist-serialized responses (explicit field list,
  no IP/UA/hash), plain INSERT only, foreign user_id reject+audit,
  device flag audit-only (payload `device_flag`, never a block),
  first-ever withdrawn rejected, real registry `effective_from`
  timestamp + `versionInForce`, own_decision event-scoped only,
  roster_version never described as anonymisation (helper header).
- DB reviewer B-1: absence-of-UNIQUE asserted; named indexes
  `idx_event_labelling_consent_event`/`_user`; named CHECK
  `chk_event_labelling_consent_decision`; both FKs by column +
  confdeltype; `panel_expected_hash` VARCHAR(64) raw hex;
  `panel_expected_user_ids` ARRAY (`_int4`); (table,column)-keyed
  type assertions in migration 299.
- Security BLOCK-1: `roster_version` = keyed HMAC-SHA256 (JWT_SECRET,
  domain-separated `panel-labelling-roster-v1:`), returned as
  `hmac-sha256:<hex>`; DB-only `panel_expected_hash` stays plain
  SHA-256, never API-returned (asserted in T-C1/T-C4 responses).
  BLOCK-2: foreign user_id → 400 + audit entry, no row.
  Conditions: freeze in the same INSERT only for event-linked
  recordings (session rows NULL, never UPDATE, never `'{}'`), ONE
  canonical helper `lib/panelLabelling.js`, 404 ordering before all
  validation detail, active room required, no admin bypass,
  attestation name from the server `users` record, INSERT omits
  decided_at/created_at (DB defaults), IP from `req.ip` only,
  insert+audit+notification in ONE transaction, per-(user,event)
  rate limit via existing `checkLimit` with uniform 429.
- STOP 1 supersedes design T-C1 wording: a body carrying a foreign
  `user_id` is REJECTED (not ignored); forged `notice_version` /
  timestamps remain ignored in full.

## Roster-writer grep audit (§6 standing invariant) — re-run at build

Scope routes/, services/, server/, lib/ for `panel_member_ids` and
`UPDATE interview_events` / `INSERT INTO interview_events`:
roster written ONLY at event creation (`routes/interview-events.js`
INSERT, `services/interview-service.js` INSERT, `routes/interviews-unified.js`
passes body through to creation); the sole later `panel_member_ids`
write is the erasure redaction (`lib/erasureService.js` sets `'{}'`).
Other UPDATEs touch only calendar_event_ids / livekit_room_url /
status / interview_session_id — never roster fields. **No NEW roster
writer found** — matches the design §6 verified set; no escalation.

## Red-first evidence

On unmodified dev (4946aeafe), before any implementation:
- `npx jest server/__tests__/migrations/299_panel_labelling_consent.test.js`
  → 5 failed, 5 total (migration file absent).
- `SD18_INTEGRATION_DB_URL=…/sd18_fresh npx jest server/__tests__/routes/panel-labelling-1955.integration.test.js`
  → 8 failed, 8 total (T-C1..T-C6, first-withdrawn, freeze).

## Green + E2E evidence (HL-003)

Fresh local Postgres 18.6 rig (127.0.0.1:55433, DB `sd18_fresh` created
empty for this gate):

- `DATABASE_URL=postgresql://postgres@127.0.0.1:55433/sd18_fresh node migrate.js`
  → **exit 0**, incl. "Migration 299 … completed" and "All migrations
  completed successfully".
- Migration suite: **5 passed, 5 total**.
- Integration suite (T-C1..T-C6 + first-withdrawn + freeze):
  **8 passed, 8 total**.
- Neighbour suites: 296/297/298 migrations + diarizationGate +
  livekit-session → 94 passed, 3 skipped; recordings-session /
  purged-sentinel / whisper-confidence / transcribe-claim → 28 passed;
  recordings-encryption / interview-audit / interview-session-auth →
  24 passed.
- State read back from the DB after the run:
  - `event_labelling_consent`: rows id 1+2 are the SAME
    (event 19551, user 195503) pair — `granted` then `declined`
    (append-only, two rows, no unique); row id 3 = recruiter grant;
    all `notice_version='br7-1'`, IP set server-side.
  - Frozen recording: `panel_expected_user_ids = [195501, 195503]`,
    `length(panel_expected_hash) = 64`.
  - FK read-back: `interview_event_id confdeltype='r'` (RESTRICT),
    `user_id confdeltype='c'` (CASCADE); UNIQUE constraint count on
    the table = **0**; `panel_consent_snapshot` is `jsonb` on both
    `diarization_jobs` and `diarization_runs`.

Migration 299 is NOT promoted: PR to dev only; 296–299 stay held from
staging/production until the Nov 1 unfreeze.
