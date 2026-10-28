# #1938 — Session-linked recording detail access — build log (Nova)

## Claim under test

Filed from S-D11 (#1913) STOP 1: `GET /api/interviews/recordings/:id`
(detail) 403s the owning candidate on session-linked recordings
(`interview_session_id` set, no interview event), although
`GET /:id/transcript` and `GET /:id/playback` grant that candidate
access. Suggested fix in the filing: the detail handler should use the
same `canAccessRecording` result as its sibling handlers, with
regression tests covering candidate / recruiter / non-owner on
session-linked recordings.

## Investigation (systematic debugging, first-hand)

- On origin/dev `0bc5f8832`, the detail handler in
  `server/routes/recordings.js` already calls
  `canAccessRecording(recordingId, user)` and 403s only on
  `!canAccess` — identical to the transcript and playback handlers.
  It does not re-derive access on an event branch.
- `canAccessRecording`'s session branch (#322) grants the owning
  candidate (`Number(session.candidate_id) === Number(user.id)`) and
  company-scoped recruiters/admin when `interview_session_id` is set.
- At the filing base (`14d076f08`, S-D11) the handler already read
  identically; the only later change to the file is S-D12
  (`21c541b71`, `diarization_status` audience folding). No handler in
  either version returns `403 Recording not found` for detail —
  detail's 403 body is `Not authorized`; `Recording not found` is
  playback's 404 decrypt-branch string. The filing's description
  appears to conflate the playback-branch strings with the detail
  handler, from a code read rather than a run.

## Reproduction / E2E gate (HL-003) — GREEN on current dev

Fresh DB `sd1938_fresh` on the local rig (PG 16.15, 127.0.0.1:55433),
`node migrate.js` exit 0. Seeded session-linked recording in the
access-relevant shape `createRecordingRecord({ interviewSessionId })`
writes (`interview_event_id` and `room_id` NULL,
`interview_session_id` set; the seed additionally sets
`storage_path`/`duration_seconds`, which the detail handler never
reads for access), one transcript segment, one consent row. Suite:
`server/__tests__/routes/recordings-session-detail-1938.integration.test.js`
(real recordings router, real `lib/db`, real auth, supertest):

- Owning candidate → detail **200** (segment_count 1 read back, no
  `recruiter_notes`); transcript control **200**.
- Non-owning candidate → detail **403**.
- Owning-company recruiter → detail **200** with `recruiter_notes`.
- Other-company recruiter → detail **403**.

5/5 pass. The same journey was also run through the full `server.js`
app (all mounted routers): candidate detail 200, recruiter 200,
non-owner 403 on detail/transcript/playback — access behaviour is
identical; the candidate reaches the detail leg today.

## Decision

**No production-code change.** The grant the filing asks for already
exists inside the shared `canAccessRecording`; adding a second grant
path in the detail handler would duplicate the access authority and
create the exact widening risk the security specialist flagged at
STOP 1 (recordings opening to non-owners). The genuinely missing
deliverable — the one the filing itself requests — is regression
coverage: until this suite, no test exercised `GET /:id` on a
session-linked recording against a real DB (the session suite is
mocked-DB and never calls the detail route; the #1913 parity suite is
event-linked only).

## Specialist reviews

- Security reviewer (ecc) — STOP 1 decision recorded on #1938:
  YES, required; position adopted (no new grant path; lock the scoped
  behaviour with non-owner/other-company 403 tests). Independent
  review of this PR's diff is recorded on the PR.
- Privacy engineer — consulted at STOP 1: detail payload stays
  dual-audience-safe; suite asserts no `recruiter_notes` reaches the
  candidate on session-linked recordings; no new disclosure.
- Independent security/code review of the PR diff — **APPROVE**
  (reviewer re-ran the suite first-hand, 5/5; verified the central
  claim at current dev and filing base; mutation reasoning: removing
  the session-branch candidate grant turns the suite red). Minors
  (non-blocking): M-1 seed-fidelity wording (fixed above); M-2 the
  suite skips silently without `SD1938_INTEGRATION_DB_URL`, the same
  pattern as sibling integration suites — coverage exists where the
  var is wired; M-3 no playback control leg (a `'stub'` storage path
  404s on decrypt, so playback parity rests on the identical
  `canAccessRecording` call, verified by code identity) and no admin
  case (pre-existing shared behaviour).

## Files

- `server/__tests__/routes/recordings-session-detail-1938.integration.test.js` (new)
- This build log.
