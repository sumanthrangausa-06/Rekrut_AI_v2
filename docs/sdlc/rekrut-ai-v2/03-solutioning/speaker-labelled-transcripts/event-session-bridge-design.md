---
project: Speaker-Labelled Interview Transcripts (Diarization) — Event→Session Bridge
version: 1
status: design — Rex, Phase 3 Solutioning (design only; no code, no PR in this step)
created: 2026-10-28
owner: Sumanth
architect: Rex
issue: "#1925 — [FOLLOW-UP] Event→session bridge for diarization gate (hard blocker for S-D17 #1919)"
parent_design: architecture.md (same folder) — this document adds ADR-D06 and amends §3.4 step 1 by reference; the architecture text itself is reconciled in Nova's build PR (§7 of this document)
specialist_reviews:
  - "agency-agents/engineering-privacy-engineer — CONSULTED, verdict BLOCK on gate-time consent borrowing (the risk domain of this change); its minimum-change conditions are the basis of the adopted design (§2, §8)"
  - "ecc/security-reviewer — CONSULTED, verdict ACCEPT-WITH-CONDITIONS on the borrowing design, with cross-session consent laundering named as its biggest risk and a consent-promise ruling required; its binding/conjunction/temporal/audit conditions are adopted into the governing-session design (§4, §5, §8)"
  - "ecc/database-reviewer — CONSIDERED AND SKIPPED for the borrowing option (it needed no schema); RE-ENGAGED by this design because the adopted option carries a migration — Nova's build PR must carry a database-reviewer pass on migration 298 before merge (§3)"
hard_constraints_honoured:
  - "No migration is executed by this document. Migration 298 is designed here and executes only after the Nov 1 Neon unfreeze, in dev → staging → main promotion order (Sumanth's free-plan ride-out ruling)."
  - "DIARIZATION_ENABLED is never proposed ON anywhere in this design. Enablement remains S-D17 (#1919), gated on G1 + G2 + D2 + this bridge."
  - "Consent remains fail-closed in every blocked posture, at claim and at write, exactly as S-D04 built it."
---

# Event→Session Bridge for the Diarization Consent Gate — Design (#1925)

> **Companion to:** `architecture.md` (§3.1, §3.4, §4.4, §6.1, §9) · **Surfaced by:** S-D04 (#1906, PR #1924) independent review · **Blocks:** S-D17 (#1919) enablement

> **Correction (Nova build, #1925 — Suga checkpoint 2026-10-28):** this
> design originally named its migration "297", but 297 was taken the
> same day by S-D15 (migration 297 = biometric consent v1.2, PR #1948).
> The bridge migration is **298** (`migrations/298_event_session_bridge.js`).
> Every migration-number reference in this document has been renumbered
> to 298; nothing else in the design changed.

## 1. The problem, in plain words first

Diarization may only label a recording when the candidate gave current
biometric consent. Consent in Rekrut is recorded **against an interview
session** — there is nowhere else a consent receipt can live. But the
human-interview recordings diarization exists for are attached to a
calendar **event**, not a session, and the database forbids a recording
from having both. So the consent gate looks for a session, finds none,
and cancels every one of those jobs. That cancellation is safe — nothing
is processed without consent — but it means the feature can never work
on its main target until each event has a session of its own for the
gate to check.

The tempting shortcut — "find any session this candidate has for the
same job application and use its consent" — was examined and
**rejected** (§2). The adopted design gives each human-interview event
its **own governing session**, created for that event, against which
the candidate's consent for *that interview* is captured and checked.
No consent is ever borrowed from a different encounter.

## 2. Decision (ADR-D06) — and what was rejected, on the record

**Adopted: the governing-session bridge (schema-level link, expand-only).**
Each `interview_events` row gains one deterministic link to the
`interview_sessions` row created for that human interview. The gate
resolves recording → event → governing session, then runs the two
checks S-D04 already runs, unmodified, against that session.

**Rejected: gate-time resolution via the event's application chain**
(the first option named on #1925). The chain exists —
`interview_events.job_application_id` → `interview_sessions.application_id`
— but it is 1:N (screening, AI-interview and human sessions share one
application) and, decisively, it would apply a consent granted in one
encounter to a recording of a different encounter:

- **Privacy engineer (risk-domain specialist): BLOCK.** A biometric
  written release is specific to a collection — this candidate, this
  encounter, this recording, under the text shown in that context.
  "At least one sibling session granted" is consent shopping; a grant
  in one session would outvote a decline in another; the sibling
  session's `config.biometric_collection` records a recruiter's intent
  for *that* session, not for this interview. No veto rule or audit
  trail cures an unlawful basis, and a borrowed receipt breaks
  revocation lineage (when the candidate withdraws, there is no
  governing receipt to withdraw against the diarized recording).
- **Security reviewer: ACCEPT-WITH-CONDITIONS, dissent preserved.**
  With tripartite candidate/application binding, same-session
  conjunction of both gate legs, non-retroactivity, full re-resolution
  at write, and persisted provenance, the S-011 planted-receipt class
  does not reopen — but the reviewer's own biggest-risk finding is
  *cross-session consent laundering*, and it states the scope change
  (session-scoped → application-scoped consent) needs a Lex/product
  consent-promise ruling, not an engineering bridge. That ruling would
  contradict Lex BR-2's per-session design; Rex does not recommend
  asking for it when a deterministic 1:1 design exists at comparable
  build cost.
- **HL-004 note:** this is a discussed team position (Rex + privacy +
  security), not a solo recommendation. The security reviewer's
  conditions are not discarded — §4/§5 adopt every one that applies to
  a 1:1 link, where they are cheap because the resolved set has
  exactly one member.

**Also rejected:** extending `consent_receipts` with an event link
(privacy's noted alternative). It forks the consent machinery
(`checkConsentState`, `assertSessionOwnership`, DSAR history, the
S-011 binding fix) into a second keying scheme forever, to save one
nullable column. The governing-session route reuses every existing
control unmodified.

## 3. Schema change — migration 298 (designed, NOT executed here)

One expand-only migration, next number after 296 at design time
(**Lead confirms the number at build**). Nothing renamed, dropped,
narrowed, or backfilled. Executes only after the Nov 1 Neon unfreeze,
in the normal dev → staging → main promotion order (§4.4 discipline).

| Change | Detail |
|---|---|
| `interview_events.interview_session_id INTEGER NULL REFERENCES interview_sessions(id) ON DELETE SET NULL` + index on the column | The bridge link. NULL = no governing session (all pre-bridge events) → gate blocks (§5). `SET NULL`, not CASCADE: deleting a session must never delete an event; a dangling link degrades to the blocked posture, not to data loss. |
| `diarization_jobs.governing_session_id INTEGER NULL`, `diarization_jobs.consent_receipt_id INTEGER NULL` | Gate provenance, written whenever a governing session was resolved (allow **and** block decisions). Plain integers, deliberately no FK: they are a historical snapshot of what authorized (or failed to authorize) a decision; FKs would let later deletes rewrite that record. |
| `diarization_runs.governing_session_id INTEGER NULL`, `diarization_runs.consent_receipt_id INTEGER NULL` | The durable authorization record stored **alongside the produced labels** (security condition: an investigator must be able to prove, after consent state has since changed, exactly which session and receipt authorized processing of that recording). |

No change to `interview_recordings` (the migration-130 XOR stands),
no change to `consent_receipts`, no backfill of any kind.

**Build gate:** Nova's PR carries an `ecc/database-reviewer` pass on
this migration before merge (expand-only shape, `SET NULL` semantics,
index necessity) — the specialist skipped for the no-migration option
is mandatory for this one.

## 4. Creating the governing session (write side of the bridge)

1. **At event creation** (`routes/interview-events.js` POST — the one
   place events are born, verified): in the same transaction as the
   `interview_events` insert, create the governing session via the
   existing `SessionService.create` with
   `type: 'human'`, `triggeredBy: recruiterId`,
   `companyId: jobApp.job_company_id`, `jobId: jobApp.job_id`,
   `applicationId: job_application_id`, `candidateId: candidate_id`,
   `config: { biometric_collection: false }` — consent starts
   **refused-by-default**; nothing about creation grants anything.
   Write the new session's id into `interview_events.interview_session_id`.
   (`SessionService.create` already enforces hiring-team-only creation
   for human sessions; the route already verifies the application,
   the candidate, and the recruiter's company.)
2. **Legacy events (link NULL):** the governing session is created and
   linked lazily at room creation / join time for that event
   (`POST /api/livekit/rooms` event flow), i.e. deterministically
   *for this event and before any recording of it starts*. This is
   creation, not inference — no existing session is ever adopted.
3. **Non-retroactivity (hard rule):** a recording whose `started_at`
   predates its governing session's consent can never be bridged
   after the fact; the gate enforces this in §5 step 5. Interviews
   already recorded with no governing session stay unlabelled.
4. **Consent capture in the event's own flow:** before the human
   interview starts, the candidate is shown the current biometric
   consent text (the S-D15 v1.2+ diarization-disclosing text) **for
   this interview**, and their decision is recorded with
   `consentService.recordConsent` against the governing session. A
   grant additionally sets the governing session's
   `config.biometric_collection = true` through the existing S-070
   propagation pattern (the same write the session flow uses — Nova
   reuses it, does not invent a second one). A decline leaves the
   config `false` and records the never-granted receipt, exactly as
   the session flow does. The exact join-screen surface is the build
   story's STOP 1 + Quinn journey detail; this design fixes the
   contract: capture is per-event, pre-recording, and keyed to the
   governing session only.

## 5. Gate resolution chain (the exact algorithm Nova builds)

`lib/diarizationGate.js` `evaluateDiarizationGate(recordingId)` gains a
second resolution path. **The session-linked path is byte-for-byte
unchanged** — every existing S-D04 test must pass untouched. The gate
still runs identically at claim and at write (`workers/diarization/index.js`
calls it twice today; neither call caches anything from the other).

For an **event-linked** recording (`interview_session_id IS NULL`,
`interview_event_id IS NOT NULL`), in order, all before any audio:

1. Load the event row via `interview_recordings.interview_event_id`.
   No event row → block `NO_SESSION` (today's code; nothing changed).
2. `event.interview_session_id IS NULL` → block
   **`NO_GOVERNING_SESSION`** (new code: operators can distinguish
   "event never bridged" from "no link at all"; the job cancels as
   `consent_blocked_at_claim:NO_GOVERNING_SESSION` and the recording's
   user-visible state is the same folded `unavailable` as every block —
   §6.3's no-consent-posture-leak rule is preserved).
3. Load the governing session. Row gone → block `NO_GOVERNING_SESSION`.
4. **Binding checks** (security conditions 1/3/5 — server-derived ids
   only; nothing from a request, payload, or metadata is consulted):
   `governing.candidate_id = event.candidate_id` **and**
   `governing.application_id = event.job_application_id` **and**
   `job_applications(event.job_application_id).candidate_id = event.candidate_id`.
   `event.job_application_id IS NULL`, or any mismatch → block
   **`SESSION_BINDING_MISMATCH`**. `checkConsentState` is not called.
5. **Consent state** — `consentService.checkConsentState(governingSessionId, 'biometric', event.candidate_id)`
   (candidate-bound, live, uncached — the S-011 fix applies as-is):
   `missing` → `CONSENT_MISSING` (a decline lands here by
   consentService semantics: never-granted), `withdrawn` →
   `CONSENT_WITHDRAWN`, `stale` → `CONSENT_VERSION_STALE`, a throwing
   check → `CONSENT_UNVERIFIABLE`. Anything but `valid` blocks.
   **Temporal precedence** (privacy condition, security condition 6):
   the gate reads the governing receipt row (latest for
   session+candidate+type — the same row `checkConsentState` judged)
   and requires `granted_at <= interview_recordings.started_at`;
   a later grant, or a recording with `started_at IS NULL` (precedence
   unprovable), blocks — `CONSENT_AFTER_RECORDING` for the late grant,
   `CONSENT_UNVERIFIABLE` for the missing start time. The state
   decision itself still comes from `checkConsentState`; the gate
   never re-implements state logic, it only reads `id`/`granted_at`
   from the row for provenance and precedence.
6. **Second check, same session** — `canEnableObserver(governingSession)`:
   config `false` → `BIOMETRIC_CONSENT_DECLINED`; unset/non-boolean →
   `BIOMETRIC_CONSENT_UNKNOWN`. (Same-session conjunction is automatic
   here: both legs judge the one governing session. There is no set,
   so there is nothing to compose across.)
7. **Allow** returns `{ allowed: true, sessionId: governingSessionId, candidateId: event.candidate_id, via: 'event_bridge', eventId, consentReceiptId }`.
   The worker persists `governing_session_id` + `consent_receipt_id`
   on the job row at claim; the write-time evaluation re-resolves
   from scratch and the worker compares its governing session against
   the claim-time one — a change blocks at write with the write-phase
   code. `persistStitch` writes both ids onto the `diarization_runs`
   row with the output.

**Panel / other speakers:** `interview_events` carries exactly one
candidate by schema (`candidate_id NOT NULL`, migration 126);
`panel_member_ids` are interviewers, not candidates, so the
multi-candidate case security raised does not exist in this schema.
Interviewer/panel voices are labelled under the BR-7 all-speaker
joining notice (S-D15 AC-3, landed) with presentation-only labels and
no stored embeddings (BR-4/BR-5). **Flagged, not settled by Rex:**
Lex must confirm that notice basis for non-candidate speakers before
S-D17 switch-on — added to S-D17's gate list in §9.

## 6. Consent postures — complete table (event-linked path)

| Posture | Gate outcome |
|---|---|
| Granted + current on the governing session, config `true`, grant predates recording start | **Proceeds** (claim and write) |
| Granted on a *sibling* session (same application/candidate), governing session has none | Blocks `CONSENT_MISSING` — the rejected design's hole, pinned shut by test T10 (§7) |
| Declined on the governing session (never-granted receipt / config `false`) | Blocks `CONSENT_MISSING` at step 5 (or `BIOMETRIC_CONSENT_DECLINED` at step 6 if a receipt somehow reads valid — defence in depth, as today) |
| Withdrawn on the governing session (incl. withdrawn between claim and write) | Blocks `CONSENT_WITHDRAWN` (at claim, or `consent_blocked_at_write:CONSENT_WITHDRAWN` — output discarded, as today) |
| Stale (receipt under an older consent-text version) | Blocks `CONSENT_VERSION_STALE` — S-D15's version bump forces re-consent in the event's own flow |
| Consent granted after the recording started | Blocks `CONSENT_AFTER_RECORDING` |
| Event has no governing session (legacy, creation failed, session deleted → link `SET NULL`) | Blocks `NO_GOVERNING_SESSION` |
| Governing session belongs to another candidate / another application | Blocks `SESSION_BINDING_MISMATCH` |
| Event row missing / recording missing | Blocks `NO_SESSION` (unchanged) |
| Consent check throws / recording has no `started_at` | Blocks `CONSENT_UNVERIFIABLE` (unchanged fail-closed principle) |
| Session-linked recording (any posture) | Exactly today's behaviour — this design does not touch that path |

Every block cancels the job with `consent_blocked_at_claim:<CODE>` or
`consent_blocked_at_write:<CODE>` and sets the recording's
diarization state to the folded `unavailable` — no posture is ever
distinguishable to a recruiter or candidate from the transcript state.

## 7. Gate tests Nova must write (acceptance for the build story)

Unit suite (extends `server/__tests__/lib/diarizationGate.test.js`;
mocked DB + consentService, the **real** observer gate, as today):

- **T1 (the pass path):** event-linked recording + governing session +
  `valid` consent + config `true` + receipt `granted_at` before
  `started_at` → allowed, `via: 'event_bridge'`, and
  `checkConsentState` asserted called with
  `(governingSessionId, 'biometric', event.candidate_id)`.
- **T2:** event with `interview_session_id NULL` → `NO_GOVERNING_SESSION`,
  consent never called.
- **T3:** event row missing → `NO_SESSION`. **T4:** governing session
  row missing → `NO_GOVERNING_SESSION`.
- **T5/T6:** binding mismatches (candidate; application incl.
  `job_application_id NULL`) → `SESSION_BINDING_MISMATCH`, consent
  never called.
- **T7:** each consent state on the governing session maps to its
  existing code (`missing`/`withdrawn`/`stale`/throw).
- **T8:** config `false` → `BIOMETRIC_CONSENT_DECLINED`; config unset
  → `BIOMETRIC_CONSENT_UNKNOWN` (valid receipt present in both).
- **T9:** receipt granted after `started_at` → `CONSENT_AFTER_RECORDING`
  even with valid state + config `true`.
- **T10 (regression guard for the rejected design):** a sibling session
  on the same application+candidate holds valid consent + config
  `true` while the governing session has none → still blocks
  `CONSENT_MISSING`; and the mirror (governing declined, sibling
  granted) → still blocks.
- **T11:** all pre-existing session-linked gate tests pass unchanged.

Real-DB integration (extends `diarizationWorker.integration.test.js`,
HL-003 standard — fresh-migrated local Postgres incl. migration 298,
resulting state read back; mocks do not satisfy this):

- **I1:** event + governing session + real `recordConsent` grant at
  the current text version + config `true` → the worker passes the
  claim gate, proceeds, passes the write gate, and the
  `diarization_runs` row reads back with the governing
  `governing_session_id` + `consent_receipt_id`.
- **I2:** withdrawal on the governing session between claim and write
  → `consent_blocked_at_write:CONSENT_WITHDRAWN`, no run row, segments
  stay unlabelled.
- **I3:** event with no governing session → `consent_blocked_at_claim:NO_GOVERNING_SESSION`,
  recording state `unavailable`.
- **I4:** decline recorded on the governing session →
  `consent_blocked_at_claim:CONSENT_MISSING`.

Quinn user-journey (per the user-perspective testing mandate, with the
Candidate Experience persona): candidate is scheduled a human
interview by calendar → joins → is shown the diarization-disclosing
biometric consent **for this interview** → grants → interview is
recorded and transcribed → speaker labels appear. Decline twin:
declines → the interview proceeds, the transcript stays unlabelled,
and the recruiter sees the same honest "unavailable" as any failure.

## 8. Architecture reconciliation (lands in Nova's build PR — #1925 requires it)

Documentation-first: the build PR that implements this design must, in
the same PR —

1. Rewrite `architecture.md` §3.4 step 1 to the two-path resolution
   (direct session link → event governing-session bridge → block),
   with the new codes (`NO_GOVERNING_SESSION`,
   `SESSION_BINDING_MISMATCH`, `CONSENT_AFTER_RECORDING`) added to
   §3.3's cancel-reason list.
2. Amend §3.1 step 3 with the forward reference: enqueue stays
   event-linked-only; the gate resolves consent via the event's
   governing session (ADR-D06).
3. Add migration 298 to §4.4's sequencing (expand-only, post-Nov-1,
   promotion order) and the bridge columns to §4.1/§4.2's tables.
4. Append **ADR-D06** to §9 recording this decision, the rejected
   chain option, and both specialist verdicts (privacy BLOCK;
   security accept-with-conditions + laundering risk).
5. Update the `lib/diarizationGate.js` header's "SCHEMA NOTE
   (deviation flagged on #1906)" paragraph to point at this design —
   the deviation is then closed by the build, not carried as a caveat.
6. Link this document from `architecture.md`'s header companion list.

## 9. Sequencing, interim state, and what still blocks S-D17

- **Interim (today, safe):** event-linked recordings keep cancelling
  `NO_SESSION`; `DIARIZATION_ENABLED` stays OFF; the worker's engine
  posture is unchanged. Nothing in this design weakens any current
  posture at any point in the sequence.
- **Build order for Lead to sequence:** migration 298 (executes
  post-Nov-1, promotion order) → governing-session creation (event
  create + lazy join-time creation) → consent capture in the event
  flow → gate bridge path + provenance writes → tests §7 → doc
  reconciliation §8. #1925 closes only when that PR lands with the
  tests green on the real-DB rig; this design document alone does
  not close it.
- **S-D17 (#1919) gains one gate item from this design:** Lex
  confirmation of the BR-7 notice basis for non-candidate speakers
  (§5), alongside G1 (vendor written confirmation), G2 (Lex consent
  conditions incl. S-D15 review), and D2 (worker capacity). The flag
  does not flip on this bridge alone.

## Appendix — Evidence index (all verified first-hand, 2026-10-28)

- XOR constraint: `migrations/130_recordings_session_nullable.js` —
  `chk_interview_recordings_source`: `(interview_event_id IS NOT NULL) <> (interview_session_id IS NOT NULL)`.
- Gate as built: `lib/diarizationGate.js` (S-D04, #1906/PR #1924) —
  step 1 returns `NO_SESSION` when `interview_session_id` is null,
  before any consent lookup; its header records this deviation.
- Enqueue is event-linked-only: `server/routes/recordings.js`
  transcribe handler (`isDiarizationEnabled() && recording.interview_event_id`).
- Consent keying: `migrations/244_consent_tables.js` —
  `consent_receipts.interview_session_id NOT NULL REFERENCES interview_sessions(id)`,
  `UNIQUE(interview_session_id, consent_type, consent_text_version)`;
  `lib/consentService.js` `checkConsentState(sessionId, type, candidateId)`
  (live, candidate-bound, states valid/missing/withdrawn/stale).
- Second check: `lib/observerConsentGate.js` `canEnableObserver(session)` —
  pure function of `session.config.biometric_collection`, default-deny.
- Events: `migrations/126_interview_events_proposed_slots.js` —
  `job_application_id` (nullable), `candidate_id NOT NULL`,
  `recruiter_id`, `panel_member_ids INTEGER[]`; created standalone in
  `routes/interview-events.js` with no session created.
- Sessions: `migrations/129_interview_sessions_unified.js` —
  `interview_sessions(application_id, candidate_id, job_id, company_id, type, config)`;
  created via `lib/sessionService.js` (`SessionService.create`,
  human type is hiring-team-only); human sessions also created by
  `lib/humanInterviewService.js` (decline path, `biometric_collection: false`).
- No event→session link exists anywhere in schema or code (rooms are
  XOR too — `server/services/livekit.js` session-rooms comment;
  migration 139). Candidate resolution precedent:
  `livekitService.resolveRecordingCandidateId` (session first, event fallback).
- Worker: `workers/diarization/index.js` evaluates the gate at claim
  and again at write; cancels carry `consent_blocked_at_claim:<CODE>` /
  `consent_blocked_at_write:<CODE>`; `lib/diarizationJobs.js` is the queue.
- Specialist verdicts (§2): privacy engineer — BLOCK on borrowing,
  conditions adopted; security reviewer — accept-with-conditions,
  conditions adopted where applicable, dissent preserved.
