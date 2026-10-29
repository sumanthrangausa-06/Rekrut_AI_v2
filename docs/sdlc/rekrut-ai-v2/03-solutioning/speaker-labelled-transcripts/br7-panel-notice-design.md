---
project: Speaker-Labelled Interview Transcripts (Diarization) — BR-7 Panel Notice & Own-Agreement Capture
version: 1
status: design — Rex, Phase 3 Solutioning (design only; no code in this step)
created: 2026-10-28
owner: Sumanth
architect: Rex
issue: "#1952 — [FOLLOW-UP] BR-7 panel-speaker notice delivery + own-agreement capture (Lex conditions N-1…N-4)"
parent_design: architecture.md (same folder) — this document adds ADR-D07 and a panel leg to §3.4's gate; the architecture text itself is reconciled in Nova's build PRs (§13 of this document)
companion_design: event-session-bridge-design.md (#1925, ADR-D06 governing-session model — this design extends it, never replaces it)
lex_basis: "#1919 comment 6486823870 (Lex BR-7 position, CONSISTENT-WITH-CONDITIONS) + LEX-POSITION.md BR-7 addendum; counsel flag CF-6 is Lex's, this design flags it and does not answer it"
specialist_reviews:
  - "agency-agents/engineering-privacy-engineer — CONSULTED (mandatory: the risk domain is third-party biometric consent). Verdict ACCEPT-WITH-CONDITIONS (explicitly not a block on ADR-D07); conditions P-1…P-6 adopted (§2.1, §5.3, §7, §8, §10)."
  - "ecc/security-reviewer — CONSULTED. Verdict ACCEPT-WITH-CONDITIONS: its expected-set-laundering finding is adopted as the recording-time expected-set snapshot (§5, §6 P1); its own-state-only token condition is adopted in §4.2; snapshot-comparison and server-derived version/time conditions adopted in §7."
  - "ecc/database-reviewer — MANDATORY on Nova's build PR for migration 299 (expand-only shape, snapshot semantics), as with migration 298 in #1925; not consulted at design time because the migration's shape follows the 296/298 precedents this document pins."
hard_constraints_honoured:
  - "No migration is executed by this document. Migration 299 is designed here and executes only after the Nov 1 Neon unfreeze, in dev → staging → main promotion order."
  - "DIARIZATION_ENABLED is never proposed ON anywhere in this design. S-D17 (#1919) enablement still waits for N-1, N-2, N-4 (this design's builds) + CF-6 lodged with counsel (+ N-3 before external-customer enablement)."
  - "Consent remains fail-closed in every blocked posture, at claim and at write, exactly as S-D04/#1925 built it. This design only ADDS a leg to the gate; no existing code, code path, or cancel code changes meaning."
---

# BR-7 Panel-Speaker Notice Delivery + Own-Agreement Capture — Design (#1952)

> **Companion to:** `architecture.md` (§3.4, §4, §6.1) · `event-session-bridge-design.md` (ADR-D06) · **Surfaced by:** Lex's BR-7 confirmation on #1919 (comment 6486823870) · **Blocks:** S-D17 (#1919) switch-on

## 1. The problem, in plain words first

Speaker labelling makes a temporary voice template of **everyone** in the
call — candidate, recruiter, and panel members. The candidate's agreement
is handled: they give (or refuse) biometric consent for *that interview*,
checked again at the moment labelling would run. Everyone else's is not
handled at all. The BR-7 disclosure text exists, but today it renders
only inside a pop-up on the screen of the one person whose
Start-Recording click was blocked for missing recording consent. A panel
member on their own screen may never see it — and seeing it would not be
agreeing to it anyway. Nobody, anywhere in the product, ever asks a
panel speaker "do you agree to speaker labelling of your voice?", and
nothing records an answer. Lex's ruling (advisory; counsel flag CF-6):
the words are right, the delivery and the basis are not — N-1 (show it
to each participant, on their own screen, pre-recording, every session),
N-2 (capture each panel speaker's own agreement, on their own
device/account), N-4 (a decline must have a defined consequence — Rex
decides which) all block switch-on; N-3 (employer-side duty) blocks
external-customer enablement.

## 2. Decisions — N-4 first, then N-1…N-3

### ADR-D07 — N-4: a panel decline means NO DIARIZATION on that recording

**Adopted: the decliner still joins and is recorded (if they gave
recording consent); the interview proceeds exactly as today; the
transcript ships unlabelled.** The alternative Lex offered — the
decliner does not join the recorded session — is **rejected**.

Why, against the existing consent architecture:

1. **It is the architecture's own answer, applied symmetrically.** A
   candidate who declines biometric consent gets exactly this outcome
   today (BR-3): no diarization run, interview proceeds, transcript
   unlabelled, no penalty (privacy policy §13 says so in public). The
   panel leg is the same processing of the same class; a different,
   harsher consequence for a colleague's identical decline would be an
   inconsistency a reviewer — or a court — would ask us to explain.
2. **Diarization is all-or-nothing per recording; there is no
   per-speaker version to fall back to.** The worker templates every
   voice on the recording jointly to attribute turns (architecture
   §3.4–§3.6). "Label everyone except the decliner" is not a mode the
   engine has: the decliner's turns still have to be separated from
   everyone else's to be excluded, which is the same templating. The
   honest choices are the two Lex named; partial labelling is not one.
3. **Exclusion would coerce the agreement N-2 exists to make real.**
   Labelling is an optional post-processing layer on top of a recording
   the panel member may already have consented to. Telling an employee
   "agree to voice templating or leave your employer's interview"
   makes the click a condition of doing their job — the employment
   power-imbalance problem Lex flagged for GDPR/CF-6, manufactured by
   us. A decline that costs nothing but the labels is a decline that
   can be freely given, which is what makes a *grant* worth anything.
4. **It keeps the two consents separable, as they must be.** Recording
   consent (existing, all-participant, blocks *recording*) and
   labelling agreement (new, blocks only *labelling*) answer different
   questions. Exclusion would fuse them back into one take-it-or-leave
   bundle. Under the adopted design a panel member can say yes to
   being recorded and no to being templated, and both answers are
   honoured exactly.

**How the worker gate learns of a panel decline** (the mechanism, in
one paragraph — detail in §6–§7): agreements are captured per-encounter
into a new table keyed to the **interview event** (§5), because the
recording the existing action keys to does not exist before recording
starts. When a recording is created, the server freezes the event's
expected non-candidate speaker set onto the recording row itself. The
diarization gate — which already resolves recording → event and already
re-checks live at claim and at write — gains one more leg: every user
in that frozen set must hold a current `granted` decision for that
event, timestamped no later than the recording's start. A decline, a
withdrawal, a missing decision, or a stale notice version blocks with a
`PANEL_AGREEMENT_*` code, the job cancels
`consent_blocked_at_claim:<CODE>` / `consent_blocked_at_write:<CODE>`,
and the recording's diarization state folds to `unavailable` — the same
honest surface as every other block, indistinguishable to viewers.

### 2.1 Specialist positions on ADR-D07

**Privacy engineer (risk-domain specialist): ACCEPT-WITH-CONDITIONS —
explicitly not a block on ADR-D07.** From its verdict: letting the
decliner join unlabelled does not make consent "illusory" — exclusion
would be the coercive option, because a panel member cannot freely
leave an employer's interview, so exclusion would manufacture
agreement regardless of interface copy; symmetry with the candidate's
BR-3 consequence is the honest reading of "no penalty for declining."
Its conditions, all adopted: **P-1** speaking presence is never a gate
input (§7 P4, test T11); **P-2** notice versions are monotonic — a
version is never reused or rolled back to resurrect old-text grants
(a reverted text ships as a *new* version) (§5.3: the gate's check is
strict equality with the current constant, and this monotonicity rule
is what the equality means); **P-3** a clear pre-recording re-decision
path (§10); **P-4** panel/candidate leg independence (§7) and the
§4.3 copy's honesty that a panel grant never presents labelling as
assured while the candidate's consent is absent, declined, or stale;
**P-5** panel state labelled necessary-not-sufficient in
machine-readable form (§8, `decision_scope`); **P-6** the two-direction
erasure treatment (§10). Its one out-of-scope note is preserved, not
adopted into this design: whether an available-but-unused labelling
capability itself needs candidate notice even when the diarization
flag is off — that question belongs to the candidate-consent surface
(S-D15 lineage), not to #1952, and is flagged for Lead/Lex.

**Security reviewer: ACCEPT-WITH-CONDITIONS.** Conditions adopted:
the claim-time expected set is a persisted snapshot and the gate never
re-derives it from the mutable event row (§6 — its *expected-set
laundering* finding: a decliner removed from `panel_member_ids` after
recording would otherwise silently shrink the set); the write-time
comparison covers the **whole snapshot** — set equality plus per-user
record state — not merely "a decision still exists" (§7 P6); token
and capture responses carry the caller's own state and **no one
else's** (§4.2, test T-C4); user identity, notice version, and
`decided_at` are all server-derived at capture (§5.2, test T-C1).
No BLOCK from either specialist; no dissent against ADR-D07 itself
from either — the privacy verdict affirmatively endorses the choice,
the security verdict is neutral on it (outside its domain) and
conditions the mechanism, which is adopted as written above.

**HL-004 note:** the N-4 decision is a discussed team position
(Rex + privacy + security, Lex's conditions as the frame), not a solo
recommendation.

### N-1 — Delivery: the room token is the delivery vehicle

Every participant in an event-linked interview — candidate, recruiter,
panel — joins through the same room page (`LiveKitRoomPage`) on their
own device, under their own account, and every join calls
`POST /api/livekit/rooms/:id/token`, which **already resolves the
caller's own role** (`validateRoomAccess` → `recruiter` / `candidate` /
`panel`). The token response gains the caller's **own** labelling-notice
state (§4.2), and the room page renders the BR-7 notice + own-decision
controls for every non-candidate participant on every join, before
recording starts (§4.3). No broadcast, no starter's-screen proxy, no
dependency on a 403 ever happening. The ConsentDialog's BR-7 block
stays as a second, standing disclosure (§4.4) but is never the capture
surface.

### N-2 — Capture: extend the per-participant consent *action pattern*, not its table

Lex's shape was "extend the existing per-participant consent action +
`recording_consent` record." The action's *pattern* is adopted exactly —
authenticated POST, server keys the record to `req.user.id` and ignores
any user identity in the body, IP + user-agent captured, withdrawal
supported. Its *table* cannot be, for two code facts (§3):

- `recording_consent` is keyed `(recording_id, user_id)`, and a
  recording row is only created **after** recording starts — a
  pre-recording capture has nothing to key to. (The dialog's own
  disabled-button note concedes this today.)
- `recording_consent.consent_type` is `('explicit','implicit','withdrawn')`,
  and `withdrawn` on that endpoint has a side effect — it stops session
  egress. A labelling decline written there would be indistinguishable
  from a recording-consent withdrawal and could stop a recording the
  person consented to. The two consents must never share a value space.

So capture lands in a sibling record keyed to the **event** (the
encounter — the same unit the governing session keys candidate consent
to, ADR-D06), via a new endpoint in the same family (§5.2). This is a
deviation from Lex's named mechanism, taken on code evidence, and it is
recorded here for Lex's review at the design gate — the *condition*
(own device, own account, own click, recorded per user) is met in
full; only the storage key differs.

### N-3 — Employer-side duty: artefacts, sequenced before external enablement

Not a code gate (§9): (a) a customer-terms clause putting the employer
under a duty to inform its interviewers/panellists, using the canonical
BR-6/BR-7 sentence as the supplied text — drafted by Lex as a companion
artefact in the build story, filed in `docs/sdlc`, integrated into
customer terms before any external customer is enabled; (b) the same
canonical sentence in recruiter onboarding/setup copy; (c) Lex's minor
rider: `privacy.tsx` §13's gate sentence gains the panel leg ("…and
only where every other participant has agreed to speaker labelling on
their own screen") in the same build. N-3 supplements N-1/N-2, never
replaces them.

## 3. Verified current state (evidence, dev @ 223f15c6f)

- **BR-7 block:** `client/src/pages/candidate/livekit-room.tsx`
  `ConsentDialog` — canonical sentence + "applies to everyone in the
  call", rendered in the dialog description. `showConsentDialog` is set
  only in `handleStartRecording`'s 403 `CONSENT_REQUIRED` branch: one
  browser, only when recording consents were missing.
- **The dialog's buttons do not do what they appear to do:**
  `handleConsentGiven(userId)` POSTs to the consent endpoint, which
  keys the row to `req.user.id` — every button in the starter's browser
  records the *starter's* consent. And the buttons are disabled while
  `recordingId` is null, which it is on the first 403 (the recording is
  created only by a successful `/start`). Pre-existing defect in the
  *recording*-consent surface; recorded here as an observation for Lead
  to file separately — #1952 does not silently absorb it (§12), and
  the new capture must not inherit it: N-2 capture renders **only the
  caller's own** control, in the caller's own browser.
- **Per-participant consent action:** `POST /api/interviews/recordings/:id/consent`
  (`server/routes/recordings.js`) — auth, `canAccessRecording` check,
  upsert into `recording_consent` keyed to `req.user.id`,
  `consent_type ∈ (explicit, implicit, withdrawn)`; `withdrawn` also
  stops session egress (Task 6, #323). Start gate:
  `POST /recordings/start` 403s `CONSENT_REQUIRED` with
  `missingConsentFrom` until every participant (candidate + recruiter +
  `panel_member_ids`, via the previous-recording-by-room lookup) has a
  non-withdrawn row.
- **`recording_consent` schema:** migrations 128/129 —
  `(id, recording_id FK CASCADE, user_id FK CASCADE, consented_at,
  consent_type CHECK, ip_address, user_agent, UNIQUE(recording_id, user_id))`.
  Erasure precedent (`lib/erasureService.js`): on a user's erasure the
  consent *fact* is retained and `ip_address`/`user_agent` are nulled.
- **Session-room surface:** `client/src/pages/recruiter/session-room.tsx`
  serves *session*-linked rooms (#323) and contains no consent,
  recording, or diarization text. Diarization never runs there: the
  enqueue in the transcribe handler requires
  `isDiarizationEnabled() && recording.interview_event_id`. **Scope of
  this design is therefore event-linked human interviews** — the only
  diarization target. If diarization is ever proposed for
  session-linked recordings, that is a new design, not an extension of
  this one.
- **Gate as built:** `lib/diarizationGate.js` (S-D04 + #1925) —
  session path and event-bridge path, live DB at claim and write via
  `workers/diarization/index.js`; allow on the bridge path returns
  governing-session + receipt provenance, persisted on
  `diarization_jobs` at claim and `diarization_runs` at `persistStitch`,
  with a governing-session comparison at write. **The gate never reads
  `recording_consent` today** — no panel leg exists in any form.
- **Participant set:** `interview_events` (migration 126) —
  `candidate_id NOT NULL`, `recruiter_id NOT NULL`,
  `panel_member_ids INTEGER[] DEFAULT '{}'` — all `users` ids; room
  access already derives role from exactly these fields
  (`livekitService.validateRoomAccess`).
- **Consent receipts are candidate-only machinery:**
  `consent_receipts` (migration 244) keys `(interview_session_id,
  candidate_id, consent_type, version)` and `consent_texts`' type CHECK
  admits only `recording`/`biometric`/`id_verification` — panel
  agreements do not belong in either table (the #1925 rejected-option
  lesson: do not fork or overload the candidate consent machinery).
- **Public text:** `privacy.tsx` §13 covers "each speaker" in content
  but its gate sentence names only the candidate's biometric consent —
  the N-3 rider (§2) fixes that sentence in the N-2 build.
- **Migration head:** 298 (`298_event_session_bridge.js`) is the last
  numbered migration on dev. **Next number is 299.**

## 4. N-1 — Delivery design (own screen, pre-recording, every session)

### 4.1 Who sees what, where

| Participant | Surface | What renders |
|---|---|---|
| Candidate | Room page + biometric consent flow (existing, S-D15 v1.2 text) | Unchanged. The candidate's disclosure and decision are the biometric consent for this interview (governing session, ADR-D06). The candidate does **not** get a panel capture control — one person, one consent, no double capture. |
| Recruiter (lead interviewer) | Room page, own browser | `PanelLabellingNotice` (§4.3) with own decision control. The recruiter is a speaker and is in the expected set for their own voice. |
| Panel member | Room page, own browser | Same `PanelLabellingNotice`, own control only. Never another participant's state, never a button that acts for anyone else. |
| Admin (not on the event's participant list) | — | Cannot join the room today (`validateRoomAccess` 403) and gets nothing. An admin who *is* the event's recruiter or a panel member is treated as that role. |

### 4.2 Token response extension (`POST /api/livekit/rooms/:id/token`)

The handler already resolves the caller's role from the event row. For
roles `recruiter` and `panel` it adds one field, computed **for
`req.user.id` only** (security condition: no other participant's
decision, name, or posture is ever included — the token is not a
consent dashboard):

```jsonc
"labelling_notice": {
  "event_id": 123,
  "notice_version": "br7-1",          // server constant, §5.3
  "own_decision": null                // "granted" | "declined" | "withdrawn" | null
}
```

For role `candidate` the field is absent. A lookup failure returns the
field with `own_decision: null` and the notice still renders (§8 —
delivery fails *visible* on the client; the actual enforcement is the
server-side gate, never the client's memory of having shown something).

### 4.3 The notice component (`PanelLabellingNotice`, in `livekit-room.tsx`'s room UI)

- Renders on **every join** for non-candidate participants, above the
  room controls, before recording can start in the normal flow — this
  is the "every session" leg: the token is issued per join, so a
  rejoin re-renders it; a decision already recorded for *this event*
  renders collapsed to a one-line status ("You agreed to speaker
  labelling for this interview — Change") instead of disappearing.
- Copy: the canonical BR-7 sentence verbatim (the same string the
  ConsentDialog and `privacy.tsx` §13 carry), plus the decision line:
  - **Agree:** "I agree to speaker labelling of my voice as described above"
  - **Decline:** "I decline speaker labelling"
  - Decline consequence, stated *before* the click (a decline must be
    informed to be real): "The interview and the recording can still go
    ahead. No speaker labels will be created for this recording, and
    the transcript will not show who said what."
  - Grant consequence: "Speaker labels will be created for this
    recording only if every participant agrees and the candidate has
    given biometric consent."
- Clicking either button POSTs the capture (§5.2) as the caller, then
  re-renders from the server's response — never from optimistic local
  state. A failed POST leaves the notice open with an honest error; no
  success is shown for a decision that was not recorded.
- Changing a decision is allowed at any time from the status line
  (grant → decline/withdraw, decline → grant). The gate's claim/write
  re-checks (§7) are what give a change its effect; the design does
  not pretend a mid-recording click rewrites a recording already made
  (§7, temporal precedence).

### 4.4 ConsentDialog (unchanged role, one clarification)

The BR-7 block stays in the dialog as a standing disclosure to whoever
opens it. One copy clarification rides the N-2 build: the dialog's
participant list is labelled recording consent only, and a line states
that speaker labelling is decided by each participant on their own
screen. The dialog gains **no** labelling buttons — a control there
would re-create the proxy-capture defect §3 records.

### 4.5 Advance notice (supplementary, never a substitute)

Invite/join emails and the recruiter's interview-detail page may carry
the canonical sentence as advance notice (rides S-D21, §11). Delivery
credit for N-1 comes only from §4.2–§4.3; email is a courtesy layer,
exactly as Lex framed N-3.

## 5. N-2 — Capture design

### 5.1 Data model — migration 299 (designed, NOT executed here)

One expand-only migration, next number after 298. Nothing renamed,
dropped, narrowed, or backfilled. Executes only after the Nov 1 Neon
unfreeze, in dev → staging → main promotion order. `down()` is a no-op
(shared-DB rule, as 296/298).

| Change | Detail |
|---|---|
| **New table `event_labelling_consent`** | `id SERIAL PK`; `interview_event_id INTEGER NOT NULL REFERENCES interview_events(id) ON DELETE CASCADE`; `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`; `decision VARCHAR(10) NOT NULL CHECK (decision IN ('granted','declined','withdrawn'))`; `notice_version VARCHAR(20) NOT NULL`; `decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`; `ip_address INET NULL`; `user_agent TEXT NULL`; `created_at` / `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`; `UNIQUE(interview_event_id, user_id)`. Indexes on `interview_event_id` and on `user_id` (the `recording_consent` index pattern). One row per (event, user) = that speaker's current decision **for that encounter**; a decision for one event says nothing about any other event — no cross-encounter borrowing, mirroring ADR-D06. |
| `interview_recordings.panel_expected_user_ids INTEGER[] NULL` | The frozen expected set (§6), written by the server at recording creation from the event row (`recruiter_id ∪ panel_member_ids`, candidate excluded, deduplicated, sorted). NULL = pre-299 recording or creation path did not freeze → gate blocks (§7 P1). Deliberately a snapshot *on the recording*, not a live read of the mutable event row. |
| `diarization_jobs.panel_consent_snapshot JSONB NULL`, `diarization_runs.panel_consent_snapshot JSONB NULL` | Gate provenance for the panel leg, written exactly where the governing-session provenance is written (claim on the job, `persistStitch` on the run): the frozen expected set + per-user `{user_id, record_id, decision, notice_version, decided_at}` the claim decision rested on. Plain snapshot, no FK — the 298 provenance reasoning applies verbatim (an FK would let later deletes rewrite the authorization record). |

Post-state assertions in the 296/298 pattern (table/columns/types/
nullability + the UNIQUE + both indexes present) fail the migration
loudly rather than recording success over a wrong schema. **Build
gate:** Nova's migration PR carries an `ecc/database-reviewer` pass on
299 before merge (mandatory — this design carries a migration).

**Why not `consent_receipts` / a new `consent_texts` type:** §3 —
candidate-bound session machinery; overloading it was the rejected
option in #1925 and the reasoning has not changed. **Why not
`recording_consent` with a labelling column:** §2 N-2 — no recording
exists at capture time, and its `withdrawn` value is wired to egress
stop. The sibling table keeps both value spaces clean.

### 5.2 Capture endpoint — `POST /api/interviews/events/:eventId/labelling-consent`

Same family and discipline as `POST /recordings/:id/consent`:

- `authMiddleware`; body is exactly `{ decision: 'granted' | 'declined' | 'withdrawn' }` (validated, closed set). **Any `user_id`, `notice_version`, or timestamp in the body is ignored** — user from `req.user.id`, version from the server constant, `decided_at` from `NOW()` (security conditions).
- Authorization is server-derived from the event row: caller must be
  the event's `recruiter_id` or in `panel_member_ids`; anyone else
  (including the candidate — their flow is elsewhere, and a candidate
  POST here must not create a second, conflicting consent record) gets
  403. Nonexistent event → 404.
- Upsert on `(interview_event_id, user_id)`: sets `decision`,
  `notice_version` = current server version, `decided_at = NOW()`,
  `ip_address` / `user_agent` from the request (the `recording_consent`
  capture pattern). Response returns the caller's own recorded state
  only.
- Strict rate limiting, as on the token endpoints.
- A `withdrawn` here has **no** side effects outside this table — in
  particular it never touches recording egress or `recording_consent`.

### 5.3 Notice version

`PANEL_LABELLING_NOTICE_VERSION = 'br7-1'` — a server-side constant
naming the canonical BR-7 text + the §4.3 decision copy as one versioned
unit. Any future change to that text bumps the constant; rows recorded
under an older version read as stale at the gate (§7) and the notice
re-renders for a fresh decision at the next join. (This is deliberately
*not* the `consent_texts` machinery — §5.1 — but it borrows its one
essential property: the decision pins the exact text version it was
made under. **Versions are monotonic (privacy condition P-2):** a
version string is issued once, never reused, and never rolled back —
the gate's check is strict equality with the current constant, and if
the text is ever reverted, the reverted text ships under a *new*
version string, so an old grant can never be resurrected as current
by a code rollback. CF-6 may require a fuller written release for IL/TX/WA
panellists; if counsel so rules, the release replaces the click for
those users behind this same version constant — the gate does not
change shape, only what `granted` requires. That is a counsel outcome,
not designed here.)

## 6. The frozen expected set (security condition, adopted)

`panel_member_ids` is a mutable array on a living event row. A gate
that derived its expected set from the event row at claim time could
be defeated without touching any consent record: remove a decliner
from `panel_member_ids` after the recording and the set silently
shrinks. So the set is frozen **at recording creation**, on the
recording itself:

- The single writer is `livekitService.createRecordingRecord` (the one
  place event-linked recording rows are born, verified) — it derives
  the set from the event row at that moment: `recruiter_id ∪
  panel_member_ids`, minus `candidate_id` (defensive: the candidate
  appearing in the panel list does not create a panel obligation for
  them; their leg is the biometric one), deduplicated, sorted
  ascending, written to `panel_expected_user_ids`.
- From then on, the gate reads **only the recording's snapshot** for
  who had to agree. Editing the event afterwards changes future
  recordings, never this one's set. (Event edits after recording are
  also visible in the interview audit trail as they are today; this
  design does not need to rely on that, because the snapshot is the
  authority.)

## 7. Gate changes — the panel leg (exact algorithm Nova builds)

`lib/diarizationGate.js` gains a third leg, evaluated **only on the
event-bridge path**, after bridge steps 5–6 (the candidate legs) and
before the step-7 allow. The session-linked path is byte-for-byte
unchanged (it has no event participant set, and diarization enqueue is
event-only — §3). Candidate codes keep precedence: a recording that
fails the candidate leg cancels with the candidate code, exactly as
today, and the panel leg is never evaluated. The leg runs identically
at claim and at write; neither call caches anything from the other.

- **P1 — Expected set.** Read `interview_recordings.panel_expected_user_ids`
  (the §6 snapshot). NULL (pre-299 recording, or a creation path that
  did not freeze) → block **`PANEL_SET_UNRESOLVABLE`**. An empty set is
  impossible from the writer (the recruiter is always a member —
  `recruiter_id NOT NULL`) and is treated as the same block if ever
  read. The live event row's `panel_member_ids` is **never** consulted
  by the gate.
- **P2 — Load decisions.** For each user in the set, load the
  `event_labelling_consent` row for `(recording.interview_event_id,
  user_id)`. A throwing query → block **`PANEL_AGREEMENT_UNVERIFIABLE`**
  (fail-closed, as everywhere in this gate).
- **P3 — Per-user judgement, in set order.** For each expected user,
  the first failing posture blocks:
  - no row → **`PANEL_AGREEMENT_MISSING`**
  - `decision = 'declined'` → **`PANEL_AGREEMENT_DECLINED`**
  - `decision = 'withdrawn'` → **`PANEL_AGREEMENT_WITHDRAWN`**
  - `notice_version ≠ PANEL_LABELLING_NOTICE_VERSION` → **`PANEL_AGREEMENT_STALE`**
  - `decided_at > recording.started_at`, or `started_at IS NULL`
    (precedence unprovable) → **`PANEL_AGREEMENT_AFTER_RECORDING`** /
    **`PANEL_AGREEMENT_UNVERIFIABLE`** respectively — the bridge's
    temporal-precedence rule, applied to panel decisions unchanged:
    an agreement given after the recording started cannot
    retroactively authorize templating a recording already made.
- **P4 — Speaking presence is irrelevant** (privacy condition P-1,
  stated so no build "optimizes" it away): an expected user who never
  spoke still blocks if they never decided, and their grant is still
  required even though the engine may find no turn for them. The gate
  conditions on the *expected set*, never on detected speakers —
  presence data is an output of the processing being authorized, so it
  cannot be an input to its own authorization.
- **P5 — Allow + snapshot.** Allow returns, alongside the existing
  bridge provenance, `panelSnapshot = { expected_user_ids: [...],
  decisions: [{ user_id, record_id, decision: 'granted',
  notice_version, decided_at }] }` (set sorted, decisions in set
  order). The worker persists it on `diarization_jobs` at claim,
  exactly where it persists `governing_session_id` /
  `consent_receipt_id` today.
- **P6 — Write-time comparison.** The write evaluation re-resolves
  from scratch; the worker compares the write-time snapshot against
  the claim-time one — expected set, and per user the
  `(record_id, decision, notice_version, decided_at)` tuple. **Any
  difference** → cancel `consent_blocked_at_write:PANEL_AGREEMENT_CHANGED`,
  output discarded (the existing write-block pattern; the code is a
  panel-leg code, the mechanics are S-D04's). A decision flipped
  granted → declined → granted between claim and write still differs
  in `decided_at` and still blocks: the run that was authorized is not
  the run that would be written.

Every block cancels the job with `consent_blocked_at_claim:<CODE>` or
`consent_blocked_at_write:<CODE>` and sets the recording's diarization
state to the folded `unavailable` — **no panel posture is ever
distinguishable to a recruiter or candidate from the transcript
state** (architecture §6.3's no-consent-posture-leak rule, extended to
panel postures unchanged). Which user blocked, and why, exists only in
the job's cancel reason and the persisted snapshots — operator
surfaces, per the S-D12 visibility split.

**Panel-leg independence** (privacy condition P-4a): the panel leg is
judged on panel rows only, the candidate leg on the governing session
only. A candidate withdrawal does not alter, cascade to, or auto-
withdraw any panel row; a panel withdrawal does not alter the
candidate's receipt. Each leg can block on its own; neither leg's
state is evidence about the other's.

## 8. Failure and decline semantics — complete table

| Posture | Recording / interview | Diarization |
|---|---|---|
| All panel granted (current version, pre-start) + candidate legs pass | Proceeds | **Proceeds** (claim and write) |
| Any expected panel user never decided | Proceeds (recording consent is a separate, existing gate) | Blocks `PANEL_AGREEMENT_MISSING` |
| Any expected panel user declined | Proceeds; decliner participates fully | Blocks `PANEL_AGREEMENT_DECLINED` — ADR-D07 |
| Panel user withdrew (incl. between claim and write) | Proceeds | Blocks `PANEL_AGREEMENT_WITHDRAWN` at claim, or `…_at_write:PANEL_AGREEMENT_CHANGED` if the flip lands mid-job |
| Panel decision under an older notice version | Proceeds | Blocks `PANEL_AGREEMENT_STALE`; notice re-renders at next join for a fresh decision |
| Panel grant recorded after recording started (late joiner, late decider) | Proceeds | Blocks `PANEL_AGREEMENT_AFTER_RECORDING` for **that recording**; the decision stands for any later recording of the same event whose start it precedes |
| Expected set never frozen (legacy recording) | (already recorded) | Blocks `PANEL_SET_UNRESOLVABLE` |
| Candidate declined / withdrew / stale | Proceeds | Blocks with the existing candidate code; panel leg not evaluated |
| Capture endpoint fails (500) at click time | Unaffected | Decision **not recorded**; notice stays open with an honest error; gate later blocks `PANEL_AGREEMENT_MISSING` if still undecided — no fake success anywhere in the chain |
| Token labelling lookup fails | Unaffected | Notice renders with `own_decision: null` (re-decision offered); gate is server-side and unaffected by what the client showed |
| Session-linked recording (any panel posture) | Unaffected | Exactly today's behaviour — this design does not touch that path |

**Necessary, not sufficient — stated in the product, not just here**
(privacy condition P-5): a panel grant authorizes only the panel leg.
Both the token field (§4.2) and the capture response (§5.2) carry
`"decision_scope": "panel_leg_only"`, and the §4.3 grant copy says
labelling additionally requires the candidate's biometric consent. No
surface — API or UI — may present a panel grant, or a full panel set
of grants, as "labelling is on."

## 9. UX surfaces per participant type (summary)

| Surface | Candidate | Recruiter | Panel member |
|---|---|---|---|
| Room token response | No labelling field | `labelling_notice` with **own** state only | Same |
| Room page pre-recording | Biometric consent flow (existing) | `PanelLabellingNotice` + own Agree/Decline | Same |
| Room page after deciding | — | Collapsed own-status line + Change | Same |
| Interview-detail page (recruiter) | n/a | Own status line + Change (pre-interview re-decision path, §10); **no** view of other participants' decisions | n/a (panel members reach their status via the room page) |
| ConsentDialog (starter's screen) | BR-7 block (standing disclosure) | Same + "labelling is decided on each participant's own screen" clarification | Never the capture surface |
| Invite/join email | — | Canonical sentence as advance notice (courtesy) | Same |
| Transcript / recording surfaces | Folded `unavailable`, no posture leak | Same folded value (raw cancel codes stay on operator surfaces, S-D12 split) | Same |

## 10. Changing one's mind, erasure, and retention

- **Re-decision path** (privacy condition P-3): a decision can be
  changed from (a) the room page status line at any join, and (b) for
  the recruiter, the interview-detail status line before the
  interview. The governing rule is simple and stated in the notice:
  *the latest decision recorded before a recording starts is the one
  that governs that recording* — plus the gate's claim/write
  re-checks, which honour a withdrawal that lands after the recording
  but before processing. There is no separate "race" semantics to
  design: `decided_at` precedence + write-time comparison cover the
  timeline completely.
- **Retention:** `event_labelling_consent` rows live exactly as long
  as their event/recording under the existing retention clock (FK
  CASCADE from `interview_events`); there is no independent, longer
  retention for panel decisions. The claim/run snapshots live and die
  with `diarization_jobs` / `diarization_runs`, already inside the E-3
  erasure family (S-D13).
- **Erasure — two directions, kept separate** (privacy condition P-6):
  - *A panel user's own erasure:* their rows' `ip_address` /
    `user_agent` are nulled and the decision fact is retained while
    the event/recording is retained — the `recording_consent`
    precedent in `lib/erasureService.js` (consent fact vs network
    metadata), applied by adding this table to that same step. The
    build story's AC names this explicitly; it is not left to
    "CASCADE will handle it."
  - *The candidate's erasure:* panel rows are **not** the candidate's
    personal data and are not deleted, altered, or "helpfully"
    cascaded by a candidate erasure; they are the other users'
    records and the authorization provenance for the recording, and
    they leave when the recording/event itself reaches its retention
    end. (The diarization artefacts the candidate's erasure *does*
    reach — labels, runs, snapshots — are already E-3 via S-D13.)
- **No new personal data** is created about anyone's voice: decisions
  and timestamps only. BR-4/BR-5 are untouched — embeddings remain
  memory-only, per job, never stored, never cross-recording.

## 11. N-3 artefacts (build story S-D21 — non-code gate)

1. **Customer-terms clause** (Lex drafts; counsel reviews under CF-6):
  the employer must inform its interviewers/panellists that recorded
  interviews may carry automated speaker labelling, using the
  canonical sentence as the supplied text, and must not instruct its
  staff to agree or decline in any particular way (the clause protects
  the decline's freeness, §2 ADR-D07 point 3). Filed as a companion
  artefact in this folder by the build story; integration into the
  live customer terms is a release action for Suga/Sumanth, not a
  build task.
2. **Recruiter onboarding/setup copy:** the canonical sentence shown
  during recruiter setup and on the interview-scheduling surface, so
  the duty is visible where panels are composed — not buried in terms.
3. **`privacy.tsx` §13 rider:** gate sentence becomes "…only where the
  candidate has given biometric consent **and every other participant
  has agreed to speaker labelling on their own screen**" (Lex's minor
  rider, verbatim intent).

## 12. Scope boundaries (what this design deliberately does not do)

- **The ConsentDialog recording-consent proxy defect** (§3 — buttons
  in the starter's browser recording the starter's consent, disabled
  without a recording id) is a pre-existing defect in the
  *recording*-consent surface. It is recorded here as evidence and
  flagged for Lead to file as its own follow-up; #1952's builds must
  not inherit the pattern, but fixing the recording-consent dialog is
  a separate story with its own gates, not a silent passenger here.
- **No guest/link participants.** Room access today requires a
  Rekrut account on the event's participant list. A future guest-join
  flow creates speakers with no account to capture a decision from;
  under this design such a recording's expected set cannot include
  them and — if they can speak on a diarized recording at all — that
  flow needs its own Lex position first. Not designed here.
- **No change to candidate consent** — types, texts, versions, the
  governing-session model, and the claim/write mechanics are all
  exactly as S-D15/#1925 left them.
- **CF-6 is not answered here.** BIPA §15(b) written-release form for
  panellists, the §15(a) schedule, GDPR employment basis, and DPDP
  employer legitimate-use are counsel's. This design builds the
  click-capture Lex specified as the N-2 shape; if counsel requires
  the fuller release for IL/TX/WA panellists, §5.3's version constant
  is where that requirement lands.

## 13. Architecture reconciliation (lands in Nova's build PRs)

Documentation-first: the build PRs that implement this design must,
in the same PRs —

1. Amend `architecture.md` §3.4 with the panel leg (after the two
   existing checks; new codes `PANEL_AGREEMENT_MISSING`,
   `PANEL_AGREEMENT_DECLINED`, `PANEL_AGREEMENT_WITHDRAWN`,
   `PANEL_AGREEMENT_STALE`, `PANEL_AGREEMENT_AFTER_RECORDING`,
   `PANEL_AGREEMENT_UNVERIFIABLE`, `PANEL_AGREEMENT_CHANGED`,
   `PANEL_SET_UNRESOLVABLE` added to §3.3's cancel-reason list).
2. Update §6.1's BR-7 row from the S-D15 notice-only description to
   the N-1/N-2/N-4 mechanism (delivery via token + room page, capture
   per event, ADR-D07 decline semantics).
3. Add migration 299 to §4.4's sequencing and the
   `event_labelling_consent` table + snapshot columns to §4.1/§4.2.
4. Append **ADR-D07** to §9 (this document's §2 text, condensed),
   recording the rejected exclusion option and the
   `recording_consent`-keying rejection with its two code facts.
5. Update the `lib/diarizationGate.js` header with the panel leg, in
   the same style as the #1925 bridge paragraph.
6. Link this document from `architecture.md`'s header companion list.

## 14. Test specification (acceptance for the build stories)

Unit — gate (extends `server/__tests__/lib/diarizationGate.test.js`;
mocked DB + consentService, the **real** observer gate, as today; all
pre-existing session-path and bridge-path tests pass untouched, with
bridge pass-path fixtures gaining a frozen set + grants — assertions
for candidate codes unchanged):

- **T1 (panel pass path):** bridge recording + candidate legs pass +
  frozen set {recruiter, panel} + both granted at current version,
  `decided_at ≤ started_at` → allowed, `panelSnapshot` returned with
  both records, and the candidate checks asserted called exactly as
  in today's T1.
- **T2:** one expected user with no row → `PANEL_AGREEMENT_MISSING`.
  **T3:** declined → `PANEL_AGREEMENT_DECLINED`. **T4:** withdrawn →
  `PANEL_AGREEMENT_WITHDRAWN`. **T5:** older `notice_version` →
  `PANEL_AGREEMENT_STALE`. **T6:** grant with `decided_at > started_at`
  → `PANEL_AGREEMENT_AFTER_RECORDING`; `started_at` NULL →
  `PANEL_AGREEMENT_UNVERIFIABLE`. **T7:** decision query throws →
  `PANEL_AGREEMENT_UNVERIFIABLE`.
- **T8 (snapshot authority):** event row's `panel_member_ids` edited
  after recording creation (decliner removed, stranger added) →
  gate outcome unchanged: still blocks on the frozen set's decliner,
  never requires the stranger.
- **T9:** `panel_expected_user_ids` NULL → `PANEL_SET_UNRESOLVABLE`.
- **T10 (candidate precedence + independence):** candidate leg fails
  AND a panel decline exists → cancel code is the candidate code;
  panel rows untouched by the evaluation.
- **T11 (never-speaks member, privacy P-1):** expected user with a
  grant but no turns anywhere in fixtures → allowed (gate does not
  consult speaking data); expected user with no decision and no turns
  → still `PANEL_AGREEMENT_MISSING`.
- **T12:** candidate id present in `panel_member_ids` at freeze time →
  excluded from the frozen set; no panel row required for them.

Unit — capture + token (new suites beside the recordings/livekit
route tests):

- **T-C1:** POST as panel member → row keyed to the *caller*; a body
  carrying another `user_id`, a forged `notice_version`, or a forged
  timestamp is ignored in full.
- **T-C2:** POST as the candidate → 403, no row. POST as a
  non-participant user → 403, no row. POST to a nonexistent event →
  404.
- **T-C3:** re-decision upserts the same row (decision + `decided_at`
  advance; no duplicate rows) — the write-time comparison's
  `decided_at` signal depends on this.
- **T-C4:** token response for recruiter/panel contains only the
  caller's own decision; for the candidate, no `labelling_notice`
  field; neither response contains any other participant's decision
  or posture, in any field.

Real-DB integration (extends `diarizationWorker.integration.test.js`,
HL-003 standard — fresh-migrated local Postgres incl. migration 299,
resulting state read back; mocks do not satisfy this):

- **I1:** full pass — governing-session grant + frozen set + all panel
  grants → worker passes claim, `diarization_jobs.panel_consent_snapshot`
  reads back with the expected set and record ids; passes write;
  `diarization_runs.panel_consent_snapshot` reads back identical.
- **I2:** panel decline → `consent_blocked_at_claim:PANEL_AGREEMENT_DECLINED`,
  no run row, segments stay unlabelled, recording state `unavailable`.
- **I3:** grant at claim, withdrawal before write →
  `consent_blocked_at_write:PANEL_AGREEMENT_CHANGED`, output
  discarded, no run row.
- **I4:** decision flipped granted → declined → granted between claim
  and write → still `PANEL_AGREEMENT_CHANGED` (decided_at moved).
- **I5:** erasure step — panel user's erasure nulls their row's
  `ip_address`/`user_agent` and retains the decision fact; candidate
  erasure leaves panel rows byte-identical.

Quinn user-journeys (per the user-perspective testing mandate; with
the Recruiter persona for the panel/recruiter legs and Candidate
Experience for the candidate leg) — **JT-D8, the panel journey**, one
continuous run per variant:

- **JT-D8a (all agree):** recruiter schedules a human interview with
  one panel member → each of recruiter, panel member, candidate joins
  on their own screen → panel member sees the BR-7 notice *before*
  recording and agrees; recruiter agrees on theirs; candidate gives
  biometric consent in their flow → interview is recorded →
  transcript carries speaker labels.
- **JT-D8b (decline twin):** panel member declines → they are told,
  before clicking, that the interview and recording still go ahead
  without labels → interview and recording proceed normally → the
  transcript is unlabelled and shows the same honest `unavailable`
  labelling state as any other block; **no surface tells the candidate
  or the panel member that a decline is why** (posture leak check),
  and the decliner's participation is otherwise identical.
- **JT-D8c (never asked, never decided):** panel member joins, makes
  no decision, recording proceeds → no labels; the operator surface
  alone shows `PANEL_AGREEMENT_MISSING`.

## 15. Story breakdown for Lead (from this design; epic #1900 sequence)

Sizing: Fibonacci, the epic's convention (1 pt ≈ half-day). Every
story's specialist decision is stated, per the standing rule — the
risk domain of every one of these changes is **third-party biometric
consent**, so the privacy engineer is mandatory throughout, not
optional; "considered and skipped" is recorded where it applies.

### S-D18 — Capture: migration 299 + capture endpoint + token state — **5 pts**
Migration 299 (§5.1, expand-only, post-Nov-1 execution in promotion
order; dev-rig proof on local Postgres), `POST /events/:eventId/labelling-consent`
(§5.2), token `labelling_notice` field (§4.2), expected-set freeze in
`createRecordingRecord` (§6). Tests T-C1…T-C4 + freeze coverage.
**Specialists:** privacy engineer **MANDATORY** (capture shape is the
consent record itself); `ecc/database-reviewer` **MANDATORY** on the
migration (296/298 precedent); security reviewer **MANDATORY** on the
endpoint (proxy-capture is its named risk). **Dependencies:** none
(parallel with S-D20's static copy work). Blocks S-D19, S-D22.

### S-D19 — Gate panel leg + worker snapshot/compare — **5 pts**
`evaluateDiarizationGate` panel leg (§7 P1–P6), worker persistence +
write-time comparison, erasure-step addition for
`event_labelling_consent` (§10). Tests T1–T12, I1–I5.
**Specialists:** privacy engineer **MANDATORY** (gate semantics are
BR-2/BR-3's panel extension); security reviewer **MANDATORY**
(snapshot authority, T8). Database reviewer considered and **skipped**
— no schema in this story (299 is S-D18's). **Dependencies:** S-D18.
Blocks S-D22. Also blocks S-D17.

### S-D20 — Own-screen notice UX — **3 pts**
`PanelLabellingNotice` (§4.3) in the room page, collapsed status +
Change, ConsentDialog clarification line (§4.4), recruiter
interview-detail status line (§9). Component tests in the
ObserverDisclosure/SD15Disclosure style: notice renders per join for
non-candidates only; controls act only for the caller; decline
consequence copy present before the click.
**Specialists:** privacy engineer **MANDATORY** (the notice *is* the
disclosure; copy is consent copy); `ecc/a11y-architect` **INCLUDED**
for the decision controls — a consent control a keyboard/screen-reader
user cannot operate is consent not captured, so accessibility is part
of this story's AC, not a later polish. **Dependencies:** S-D18 (API
shape). Blocks S-D22.

### S-D21 — N-3 artefacts + §13 rider — **2 pts**
Customer-terms clause companion artefact (Lex drafts), recruiter
onboarding/setup canonical copy, `privacy.tsx` §13 gate-sentence
rider (§11). **Specialists:** Lex **owns the text** (not a review —
authorship); privacy engineer **MANDATORY** review of the rider
against shipped gate behaviour (the #777 pattern: no published page
may contradict the gate). **Dependencies:** S-D19 (the gate behaviour
the text must match). Does **not** block S-D17's internal enablement;
**does** block external-customer enablement.

### S-D22 — Quinn panel journey + gate integration execution — **3 pts**
JT-D8a/b/c (§14) on the fresh-install dev rig, real HTTP, state read
back; integration suite I1–I5 executed and recorded on #1952.
**Specialists:** Quinn owns execution (Phase 6) with the Recruiter +
Candidate Experience personas (journey authorship rule); privacy
engineer **MANDATORY** on the JT-D8b posture-leak assertions.
**Dependencies:** S-D18, S-D19, S-D20. Blocks S-D17.

**Total: 18 pts.** Sequence: S-D18 → (S-D19 ∥ S-D20) → S-D21 → S-D22
→ S-D17 checklist update.

## 16. Sequencing, interim state, and what still blocks S-D17

- **Interim (today, safe):** nothing changes. Event-linked recordings
  keep gating on the candidate leg alone *in code*, but
  `DIARIZATION_ENABLED` stays OFF for real recordings, so no real
  recording is labelled on an incomplete basis while these stories
  build. Internal/synthetic testing is unaffected.
- **S-D17 (#1919) gate list, updated by this design:** the BR-7 item
  ("Lex confirmation of the notice basis") is **answered** — Lex's
  position is CONSISTENT-WITH-CONDITIONS (comment 6486823870) — and is
  replaced on the checklist by its conditions as build state:
  **N-1 + N-2 + N-4 land via S-D18…S-D20 and are proven via S-D22**,
  **CF-6 lodged with counsel**, and **N-3 (S-D21) before
  external-customer enablement**. The flag does not flip on this
  design alone; it flips, if at all, on the built + proven conditions
  alongside the existing G2 / D2 (#1837) / HA-1 (#1918) waits. G1
  stays closed by founder ruling and is not re-opened.
- **#1952 closes** only when S-D18…S-D20 + S-D22 land with their tests
  green on the real-DB rig and §13's reconciliation is in the same
  PRs — this design document alone does not close it.

## Appendix — Evidence index (all verified first-hand, 2026-10-28, dev @ 223f15c6f)

- Lex position: #1919 comment **6486823870** (re-fetched via the API
  this run) + `LEX-POSITION.md` BR-7 addendum (launch goal,
  diarization-build folder) — conditions N-1…N-4, CF-6, the §13 rider.
- ConsentDialog + 403 path + dialog button mechanics:
  `client/src/pages/candidate/livekit-room.tsx` (`ConsentDialog`,
  `handleStartRecording`, `handleConsentGiven`) — §3.
- Consent action + start gate: `server/routes/recordings.js`
  (`POST /:id/consent`, `POST /start` `CONSENT_REQUIRED`,
  `_checkAllConsented`); `recording_consent` schema: migrations
  128/129; erasure precedent (fact retained, IP/UA nulled):
  `lib/erasureService.js`.
- Gate + worker: `lib/diarizationGate.js` (two paths, claim/write,
  provenance), `workers/diarization/index.js` (claim/write calls,
  snapshot persistence points), enqueue condition in
  `server/routes/recordings.js` transcribe handler
  (`isDiarizationEnabled() && recording.interview_event_id`).
- Participant model + room access: migrations 126
  (`interview_events`), 130 (recording source XOR), 298 (governing
  session); `server/services/livekit.js` (`validateRoomAccess` roles,
  `createRecordingRecord`); token handler `server/routes/livekit.js`
  (`POST /rooms/:id/token` observer-field precedent for §4.2).
- Candidate consent machinery (not to be overloaded): migrations 244
  (`consent_texts` / `consent_receipts`), 297 (biometric text v1.2);
  `lib/consentService.js`.
- Session-room scope exclusion: `client/src/pages/recruiter/session-room.tsx`
  (no consent/recording/diarization surface; #323 session rooms).
- Public text: `client/src/pages/privacy.tsx` §13; canonical sentence
  also in the ConsentDialog BR-7 block (S-D15, #1917).
- Specialist verdicts: §2.1.
