# PRD — M10: Human Interviews, Panels & Recordings

**State (verified, Scout §2; premise corrected 2026-10-13): WORKS (presence path); ONE scorecard system — panels serves the migration-125 tables.** **Surfaces:** `routes/panels.js`, `server/routes/livekit.js`, `recordings.js`, `human-interview-requests.js`, `frame-proxy.js` · client: livekit-room, InterviewSession, panels, panel-room, recordings, recording-playback.
**Sprint 11 overlap:** S-093 (#810, scorecard AI-section gate + session resolver) is filed Sprint 11 scope — the committed layer for §4's first item.

## 1. Purpose & users
Real people interviewing: LiveKit rooms, panel assignment, human scorecards, and encrypted recording + playback. Users: candidates, interviewers/panel members, recruiters. This module carries the consent moment for human interviews (with M11/M19).

## 2. End-to-end journey
Book (M8) → room opens (LiveKit tokens from `server/routes/livekit.js`, which derives `observer_consent` server-side) → interview runs (Observer presence per M11) → recording stored encrypted (`lib/r2RecordingStore.js`), playback via encrypted path → panel members score on **panel scorecards** → aggregate. Consent paths (M11 tiered model, Sumanth 2026-10-13): declining analysis/biometric consent drops the session to **Tier 1+2** (Observer present, no-media, no analysis; combined candidate feedback is composed from the locked panel scorecards); only the candidate's **objection to presence itself** takes the **Tier 0** path — the candidate may still take the human interview and the recruiter decides whether to proceed. Objection and decline are never negative signals.

## 3. Current state (verified)
Rooms, tokens, recordings, playback, and panels all work. **One scorecard system — verified:** `routes/panels.js` serves the **migration-125** `scorecards`/`scorecard_items` tables — scorecards incl. **submit-and-lock** (`:451` submit locks; `:382` blocks post-submit edits) and peer aggregate (`:595`), gated by `verifyPanelMember`. The earlier "two parallel systems / split-brain" framing (Scout's KB, this PRD's first pass, and the S-039 panel's working assumption) was **falsified on verification** (panel, 2026-10-13 — Scout corrected his own KB; ADR-R4 resolved): there is no second system and nothing to deprecate. The real gap is **consumption**: the S-039 report page does not read the panel scorecards — its human column renders `missing` by design until S-093 lands the report wiring/resolver.

## 4. Gap to launch-ready
(1) **S-093:** one session resolver that lets the report read the panel system's submitted scorecards, plus the **AI-section gate** — a scorer must not view a session's AI/Observer section until their own scorecard is submitted and locked (panel rule, binding on #686/#697; attaches to the person-as-scorer, incl. the recruiter-interviewer overlap case). (2) S-093's re-scope at STOP 1: its filed 8 pts partly pay for routes that already exist — the genuine remainder is the report wiring/resolver + AI-section gate above. (3) Recording retention is M19's armed-purge problem (#805) — this module's recordings are its largest data class.

## 5. Functional requirements
- FR-M10-1: Panel scorecards (migration-125 tables, served by the panels routes) are the human-evaluation system of record; the report's human column resolves from submitted+locked panel scorecards via the S-093 resolver, with states `present` / `not_submitted` / `missing` (linkage-unresolved = `missing`, never "not submitted").
- FR-M10-2: The AI-section gate (submit-and-lock before AI visibility) is enforced **server-side** at the report/status read — a UI that hides what it was sent is not a control (S-039 panel rule).
- FR-M10-3: Recordings remain encrypted at rest with per-recording keys; playback is authorised (same-company or candidate-self) and audit-logged; frames/recordings inherit M19 retention classes (90 d / 30 d).
- FR-M10-4: Consent state shown in-room comes only from server-derived values (the `livekit.js` pattern) — clients never compute consent from raw config.

## 6. Non-functional
- Privacy: recordings are biometric-adjacent data — capture consent (M11/M19) gates any recording; the dormant capture substrate (M11) does not change this module's recording path.
- Responsive: the room must run on phone/tablet/laptop (Sumanth's standing directive; he tests on iPhone Chrome) — room QA on staging is part of promotion evidence.

## 7. Dependencies (verified states)
M8 engine (exists) · M11 consent/observer (exists) · M19 retention (built, **not armed** — #805) · LiveKit service (external, configured).

## 8. Sprint 11 overlap
S-093 (#810) is filed in Sprint 11's sequenced set (planning re-scoped it to AI-gate + resolver; ceiling 8 pts, ≈6 realistic) — and per the 2026-10-13 premise resolution its scope **re-opens at STOP 1**, because the filed body still carries the falsified two-systems premise (D-M10-1). FR-M10-1/2 state its requirements; the sprint's story is the committed layer.

## 9. ⚠ Unverified
Recording playback behaviour on staging (R2 TLS wall); whether any client reads the scorecard tables outside the panels routes (client-side reads not separately swept).

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M10-1: scorecard "split-brain" end-state — ✅ RESOLVED 2026-10-13 (premise falsified).** Panels and migration-125 are one system (§3); there is no second system to deprecate and no bridge to build. The genuine remainder is S-093 (#810) — report consumption of panel scorecards + the AI-section gate — re-scoped at STOP 1.
  **Rex's recommendation ((a) panels canonical, deprecate 125 in writing, drop post-launch) is recorded as NOT ADOPTED — its premise was false.** Rex conceded on the record.
