# S-D20 Build Log — BR-7 own-screen notice UX (#1957)

Persona: Nova (Phase 4). STOP 1: #1957 comment 6493448474. Design:
`03-solutioning/speaker-labelled-transcripts/br7-panel-notice-design.md`
§§4.3, 4.4, 9, 14, 15 (S-D20). Branch: `nova/1957-sd20-notice-ux` from
dev `5ee4e1793` (PR #1960 merge — S-D18/#1955 closed, verified live
before starting).

## Specialist decisions (STOP 1)

- **Privacy engineer — MANDATORY** (the notice IS the disclosure; copy
  is consent copy). All copy is the canonical BR-7 sentence verbatim
  (same string as ConsentDialog / `privacy.tsx` §13) plus §4.3's pinned
  decision/consequence lines — no new consent wording invented.
- **ecc/a11y-architect — INCLUDED** (a consent control a
  keyboard/screen-reader user cannot operate is consent not captured):
  native button controls reachable by role/name, the decision pair
  grouped in a `fieldset`/`legend`, the collapsed status as an
  `aria-live` line, capture failure as `role="alert"`, 44px targets,
  no autofocus on either decision.
- Security reviewer considered, not mandatory: no new endpoint, auth
  surface, or data read — the story consumes S-D18's reviewed
  token/capture contract exactly, and the contract is pinned in tests.
  Database reviewer considered and skipped: no schema in this story.

## What was built

- **`PanelLabellingNotice`** (exported from
  `client/src/pages/candidate/livekit-room.tsx`, §4.3): rendered in
  `RoomUI` above the room controls, driven by the token's
  `labelling_notice` (S-D18 shape, unaltered). Renders per join for
  non-candidates only — candidates get no token field and the
  component renders nothing without one. Undecided → full notice:
  canonical sentence, "You are agreeing as {caller's own name}",
  decline consequence AND grant consequence stated before the click.
  Decided → collapsed one-line status + Change. Clicking Agree/Decline
  (or Withdraw, offered when a grant stands) POSTs the S-D18 capture
  endpoint (`POST /api/interviews/events/:eventId/labelling-consent`
  with `{decision, room_id, roster_version}`) as the caller and the
  component re-renders **only from the server's response** — never
  optimistic local state. A failed POST leaves the notice open with an
  honest error; no success is shown for an unrecorded decision.
- **C-10 (§15) as built and tested:** the labelling decision is a
  separate section with its own heading and fieldset — mechanically
  and visually distinct from recording consent, no bundled control;
  Decline and Agree are the same button variant/size/classes (equal
  prominence, asserted by class equality in tests); neither is
  pre-selected (no pressed/checked state, no autofocus); a recorded
  decline renders as the collapsed status on rejoin with no
  re-prompt — Agree/Decline do not render again until the caller
  clicks Change themselves.
- **ConsentDialog clarification (§4.4):** the participant list is now
  labelled "Recording consent", and a line states speaker labelling
  is decided by each participant on their own screen and is not
  recorded in the dialog. The dialog gains **no** labelling buttons.
- **Recruiter interview-detail status line (§9):**
  `InterviewLabellingStatus` on the interview card in
  `client/src/pages/recruiter/interviews.tsx` — this codebase has no
  separate interview-detail page; the card is the per-interview
  surface. For upcoming interviews with a LiveKit room it reads the
  recruiter's OWN state via the S-D18 token field (the only read of
  own state that exists; own decision only, never another
  participant's) and renders the same `PanelLabellingNotice` (light
  variant) — collapsed status + Change, i.e. the §10 pre-interview
  re-decision path. No room → renders nothing. A failed load renders
  an honest "status unavailable — you can decide in the interview
  room" line, never a fabricated status.

## Red-first evidence

On unmodified dev (`5ee4e1793`), before any implementation:

- `client/src/__tests__/pages/PanelLabellingNotice.test.tsx` →
  **14 failed, 1 passed (15)**.
- `client/src/__tests__/pages/RecruiterLabellingStatus.test.tsx` →
  **4 failed, 0 passed (4)**.
- Combined red: **18 failed, 1 passed (19)** — the one pass is a
  negative assertion that already held (the ConsentDialog had no
  labelling buttons to begin with).

## Green + verification

- Both new suites: **19 passed, 19 total**.
- Neighbour suites (same surfaces): SD15Disclosure +
  ObserverDisclosure + AssessmentAiDisclosure → **16 passed**.
- Full client suite: see PR body for the final count.
- TypeScript: `tsc --noEmit` reports 83 errors on this branch vs 85
  on the dev baseline; **none are in S-D20 files** (the one
  `interviews.tsx` error the filter surfaces is the pre-existing
  `resendScreening` argument, untouched by this diff).

## What was NOT verified (stated honestly, per the completion gate)

- No full HTTP journey was run for this UI-only piece: the component
  tests drive the notice through an injected `onDecide` and the
  status line through the real token-response **shape**, but the
  live token → capture → read-back chain over real HTTP against a
  fresh-install rig is **S-D22's JT-D8 journey** (its dependency list
  is exactly S-D18 + S-D19 + S-D20). The default (non-injected)
  capture path in the room page is the literal S-D18 endpoint shape
  and is covered by S-D18's own real-DB integration suite
  (T-C1…T-C6, PR #1960).
- No gap was found in S-D18's contract for this story: the token
  field carries everything §4.3 needs (`event_id`, `notice_version`,
  `roster_version`, `own_decision`, `decision_scope`), and the
  capture response returns the caller's own recorded state, which is
  what the component re-renders from.

## Boundaries held

No staging/main promotion, no schema changes, no emails,
`DIARIZATION_ENABLED` untouched (stays off). S-D19's in-flight files
(`lib/diarizationGate.js`, worker, migrations, its test files) were
not touched — this PR's diff is frontend room UI + copy + tests +
this log only.

## Fix — independent review BLOCK-1 + minors (PR #1962, review comment 6493944820)

Reviewer verdict on head `45e730637`: BLOCK scoped to the §9 recruiter
status line, plus four non-blocking minors. All five addressed on the
same branch; §4.3 room notice itself was cleared by the review and is
unchanged in behaviour except minors 1–3 below.

- **BLOCK-1 — token POST auto-fired per card (fixed, lazy fetch):**
  `InterviewLabellingStatus` previously POSTed
  `/livekit/rooms/:roomId/token` in a `useEffect` on mount for every
  upcoming card. That endpoint sits behind `rateLimits.strict`
  (5 req / 15 min, IP+route) — the same bucket that gates joining a
  room — so opening the interviews page with 5+ upcoming interviews
  could 429 the recruiter out of joining, and each mount minted a
  discarded 1-hour join token. **Fix:** no fetch on render. The card
  now renders a neutral line ("your status for this interview has not
  been checked") with a "Check speaker labelling status" control
  (44px); the token POST fires only on that explicit click (once,
  guarded while in flight). Loaded → the same `PanelLabellingNotice`
  (light). Failed (or a token response with no notice field) → the
  same honest "status unavailable — you can decide in the interview
  room" line. No new read endpoint was built (reviewer's follow-up
  route via Lead/Suga, out of scope here).
- **Minor 1 — 409 `ROSTER_CHANGED` copy:** the capture failure branch
  now detects `code === 'ROSTER_CHANGED'` or HTTP 409 and says the
  participant list has changed and to **re-join the interview** for
  the latest information — retrying the stale `roster_version` can
  never succeed, so "Please try again" is no longer shown for that
  case. Other failures keep the generic honest error.
- **Minor 2 — 44px targets:** Change, Withdraw-my-agreement, and
  Keep-my-current-decision are now `min-h-[44px]`, matching the
  decision pair (the earlier "44px targets" claim now holds for all
  notice controls).
- **Minor 3 — focus on collapse:** after a decision (or Keep)
  collapses the notice, focus moves to the collapsed Change control
  via a ref set only on that transition — initial renders with a
  recorded decision do not steal focus.
- **Minor 4 — default capture path pinned by test:** a new test
  renders `PanelLabellingNotice` with NO injected `onDecide`, clicks
  Agree, and asserts `apiCall` was called with exactly
  `('/interviews/events/123/labelling-consent', {method:'POST',
  body:{decision:'granted', room_id:7,
  roster_version:'hmac-sha256:abc123'}})` and that the component
  collapses from the server response.

### Test evidence (this fix)

- Red first (tests updated/added before the fix): **7 failed, 17
  passed** across the two S-D20 suites.
- Green: `PanelLabellingNotice` **19/19** + `RecruiterLabellingStatus`
  **5/5** = **24/24 passed**, including the BLOCK-1 regression test
  pinning that rendering `InterviewLabellingStatus` fires **zero**
  token POSTs before the click and exactly one after it.
- Neighbours re-run: SD15Disclosure + ObserverDisclosure +
  AssessmentAiDisclosure → **16/16 passed**.
- TypeScript: `tsc --noEmit` = **83 errors**, identical to this
  branch's documented baseline; the only error in a touched file is
  the pre-existing `resendScreening` argument error at
  `interviews.tsx:1002`, untouched by this diff.
