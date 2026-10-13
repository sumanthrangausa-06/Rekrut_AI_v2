# PRD — M10: Human Interviews, Panels & Recordings

**State (verified, Scout §2): WORKS (presence path); TWO parallel scorecard systems.** **Surfaces:** `routes/panels.js`, `server/routes/livekit.js`, `recordings.js`, `human-interview-requests.js`, `frame-proxy.js` · client: livekit-room, InterviewSession, panels, panel-room, recordings, recording-playback.
**Sprint 11 overlap:** S-093 (#810, scorecard AI-section gate + session resolver) is filed Sprint 11 scope — the committed layer for §4's first item.

## 1. Purpose & users
Real people interviewing: LiveKit rooms, panel assignment, human scorecards, and encrypted recording + playback. Users: candidates, interviewers/panel members, recruiters. This module carries the consent moment for human interviews (with M11/M19).

## 2. End-to-end journey
Book (M8) → room opens (LiveKit tokens from `server/routes/livekit.js`, which derives `observer_consent` server-side) → interview runs (Observer presence per M11) → recording stored encrypted (`lib/r2RecordingStore.js`), playback via encrypted path → panel members score on **panel scorecards** → aggregate. Consent-decline path (Sumanth's decision): the candidate may still take the human interview; the recruiter decides whether to proceed.

## 3. Current state (verified)
Rooms, tokens, recordings, playback, and panels all work. **The split-brain:** (a) **panels** — `routes/panels.js` fully implements scorecards incl. **submit-and-lock** (`:451` submit locks; `:382` blocks post-submit edits) and peer aggregate (`:595`), gated by `verifyPanelMember`; (b) **migration-125** `scorecards`/`scorecard_items` tables linked to `scheduled_interviews`, which **no route serves**. The S-039 report page reads **neither** — its human column renders `missing` by design until S-093 lands the resolver. (The S-039 panel designed submit-and-lock believing (b) was the only system; (a) had it all along — ADR-R4.)

## 4. Gap to launch-ready
(1) **S-093:** one session resolver that lets the report read the panel system's submitted scorecards, plus the **AI-section gate** — a scorer must not view a session's AI/Observer section until their own scorecard is submitted and locked (panel rule, binding on #686/#697; attaches to the person-as-scorer, incl. the recruiter-interviewer overlap case). (2) A named owner for the split-brain's end-state (decision below). (3) Recording retention is M19's armed-purge problem (#805) — this module's recordings are its largest data class.

## 5. Functional requirements
- FR-M10-1: Panel scorecards are the human-evaluation system of record until D-M10-1 rules otherwise; the report's human column resolves from submitted+locked panel scorecards via the S-093 resolver, with states `present` / `not_submitted` / `missing` (linkage-unresolved = `missing`, never "not submitted").
- FR-M10-2: The AI-section gate (submit-and-lock before AI visibility) is enforced **server-side** at the report/status read — a UI that hides what it was sent is not a control (S-039 panel rule).
- FR-M10-3: Recordings remain encrypted at rest with per-recording keys; playback is authorised (same-company or candidate-self) and audit-logged; frames/recordings inherit M19 retention classes (90 d / 30 d).
- FR-M10-4: Consent state shown in-room comes only from server-derived values (the `livekit.js` pattern) — clients never compute consent from raw config.

## 6. Non-functional
- Privacy: recordings are biometric-adjacent data — capture consent (M11/M19) gates any recording; the dormant capture substrate (M11) does not change this module's recording path.
- Responsive: the room must run on phone/tablet/laptop (Sumanth's standing directive; he tests on iPhone Chrome) — room QA on staging is part of promotion evidence.

## 7. Dependencies (verified states)
M8 engine (exists) · M11 consent/observer (exists) · M19 retention (built, **not armed** — #805) · LiveKit service (external, configured).

## 8. Sprint 11 overlap
S-093 (#810) is filed in Sprint 11's sequenced set (Lead re-scoped it to AI-gate + resolver after Rex's correction; ceiling 8 pts, ≈6 realistic). FR-M10-1/2 state its requirements; the sprint's story is the committed layer.

## 9. ⚠ Unverified
Recording playback behaviour on staging (R2 TLS wall); whether any client still reads migration-125 tables (Scout: no route serves them; client-side reads not separately swept).

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M10-1: scorecard split-brain end-state + reconciliation ownership.** Options: (a) panels are canonical; migration-125 tables are formally deprecated and dropped at a later migration; (b) migrate panels onto the 125 schema. Either way, who owns the reconciliation — Nova under S-093's umbrella, or a named follow-up story?
  **Rex's recommendation: (a) — panels are canonical** (they're the system that works, with lock semantics the panel decisions assume), deprecate 125 in writing now, drop it in a post-launch migration; **S-093 stays scoped to gate + resolver**, with the deprecation note filed as its own follow-up so S-093 doesn't grow. Ownership: Lead files it; Sage executes the eventual drop post-launch.
