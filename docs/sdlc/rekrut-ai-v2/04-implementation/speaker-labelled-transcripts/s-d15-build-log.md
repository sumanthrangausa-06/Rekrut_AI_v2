# S-D15 Build Log — Disclosure, policy, and attribution surfaces

- **Story:** S-D15 · **Issue:** #1917 · **Epic:** #1900 (speaker-labelled transcripts)
- **Persona:** Nova (build), text authored by **Lex** (Legal & Compliance) per AC-6
- **Branch:** `nova/1917-disclosure-surfaces` from `origin/dev` @ `c5d210ed5`
- **Traces:** PRD §7 guardrail · Lex BR-6, BR-7, BR-10, BR-14 (LEX-POSITION.md §2.2) · Architecture §6.1
- **Authority:** this lane does not merge or close; PR to `dev` only, merge/close reserved to Suga.

## STOP 1 summary (posted on #1917, comment 6482773387)

Surface map verified first-hand on dev tip `c5d210ed5`: consent machinery resolves the
current text by `MAX(effective_from)` (`lib/consentService.js`); `biometric` was v1.1
(migration 273); `consent_texts` is append-only (migration 245 trigger), so a bump is an
INSERT migration — 297 is the next number (296 = diarization schema). The recording/joining
notice is the `ConsentDialog` in `client/src/pages/candidate/livekit-room.tsx` (one room page
serves candidate + recruiter/panel; `session-room.tsx` has no dialog of its own).
`privacy.tsx` had no speaker-labelling content.

**Specialist decision:** Lex MANDATORY as text author (AC-6); privacy engineer YES (BR-14
completeness + cross-page contradiction check, folded into independent review); security
reviewer YES at review stage for the consent-version path (bump must force re-consent, never
silently widen a v1.1 grant). Database reviewer skipped (single INSERT following the proven
272/273 pattern, no schema change); UX skipped (text-only inside existing components).

## AC-5 blocker (recorded, not worked around)

There is **no public legal/acknowledgements page in the app** (verified: no such page in
`client/src/pages/`, no route in `App.tsx`, no credits section in `terms.tsx`). Per the story's
instruction, no page was invented — creating one is a new-surface/product-scope call for
Suga/Sumanth. The **repository-documentation half of BR-10 lands in this PR** (`README.md`
Acknowledgements). Lex notes (LEX-POSITION Q1.5) that License §9's background-service rule is
met by documentation/repository credit where there is no user-visible surface; the story text
nevertheless names a page, so the page half is recorded BLOCKED for Suga's ruling.

## What landed

| AC | Change |
|---|---|
| AC-1 | `migrations/297_consent_biometric_diarization_text.js` — INSERTs `biometric` consent text **v1.2** (EN+HI), Lex's text: §1 gains the "Speaker labels in your transcript" paragraph built on the canonical sentence; §2 gains the never-stored carve-out + labels stay with the transcript under the recording's retention clock; Your-rights gains decline ⇒ no labelling. V1.1 carried verbatim otherwise; DRAFT marking kept (CF-4: clause within the existing type, not a new type). |
| AC-2 | `client/src/pages/biometric-policy.tsx` §1 — the false "We do not extract face measurements or voice measurements…" line replaced with Lex's corrected passage (face measurements not extracted; speaker labelling disclosed as the exception, canonical sentence verbatim). §3 gains Lex's clarifier: the 90-day embeddings period does not apply to labelling templates (never stored). §1 also gains the full "Speaker labelling:" passage (BR-14 for this page). |
| AC-3 | `ConsentDialog` (`livekit-room.tsx`) — Lex's two-sentence all-speaker disclosure added as a standing block in the dialog description, next to the S-048 observer branches. Phrased as mechanism explanation, not a promise labelling runs on that call (it stays gated on the candidate's live biometric consent at claim time, BR-2/BR-3 — Lex note). |
| AC-4 | `client/src/pages/privacy.tsx` — new §13 "Speaker Labels in Interview Transcripts" (Lex's text): purpose + consent gate, canonical sentence, labels kept with the transcript under the retention clock, who sees them, BR-12 fence (never in OmniScore/TrustScore/matching/ranking), and the SDK telemetry disclosure with the measured payload values (install ID, model "who" v0.3.4, platform "server", SDK 4.2.1; no audio/templates/participant data). Biometric policy carries the same processing description (above). |
| AC-5 | Repo half: `README.md` "Acknowledgements" — "Speaker labelling in interview transcripts (who spoke when) is powered by [Desert Ant Labs](https://desertant.com) — the 'Who' diarization SDK." Page half: BLOCKED (see above). |
| AC-6 | Lex drafted all operative text (lane report, this log) and the Lex review of the landed text is recorded on epic #1900. |

## Lex drafts (verbatim as landed)

Consent v1.2 EN/HI: exactly as in `migrations/297_consent_biometric_diarization_text.js`
(Lex lane output, canonical sentence from LEX-POSITION §2.2 used verbatim:
*"to label who said what in a recorded interview, we create a temporary mathematical template
of each speaker's voice during processing; the template exists only while the labelling runs
and is never stored"*).

Joining notice (BR-7): "Speaker labelling: to label who said what in a recorded interview, we
create a temporary mathematical template of each speaker's voice during processing; the
template exists only while the labelling runs and is never stored. This applies to everyone
in the call — candidate, recruiters, and panel members alike."

## Tests (red-first)

New: `server/__tests__/migrations/297_consent_biometric_diarization_text.test.js` (7 tests),
`server/__tests__/lib/sd15-attribution.test.js` (2), `client/src/__tests__/pages/SD15Disclosure.test.tsx` (8).

- **RED (pre-build):** server 9/9 failed; client 8/8 failed.
- **GREEN (post-build):** server new 9/9; client SD15 8/8. One test-side fix during green:
  a `getByText(/never stored/)` ambiguity in my own test (the phrase now correctly appears in
  two policy sections) → `getAllByText`.
- **Neighbours:** client BiometricPolicy + ObserverDisclosure + ConsentScreens +
  consent-screens-human-interview: 43/43 pass (incl. SD15 file). Server consentService (unit +
  integration harness) + migrations 250/272/273 + diarizationGate: 83 pass, 12 skipped
  (pre-existing DB-gated skips).

## HL-003 E2E gate (fresh-install local PG rig, /tmp/sd12pg — PG 16.15 + pgvector, 127.0.0.1:55433)

- Fresh DB `sd15_e2e`: `DATABASE_URL=… node migrate.js` → **exit 0**; migration 297 ran;
  `consent_texts` for `biometric` = 1.0, 1.1, **1.2**.
- Real `consentService` against that DB (no mocks): `getCurrentTextVersion('biometric')` →
  `1.2`; served text contains the canonical sentence (EN) and its HI rendering; a receipt
  granted at **v1.1** → `checkConsentState` = `{state:'stale', receiptVersion:'1.1',
  currentVersion:'1.2'}`, `isConsentValid` = false (the CONSENT_VERSION_STALE re-consent
  path); after `recordConsent` the latest receipt is v1.2 and state = `valid`.
- **Rig incident (recorded honestly):** the first `sd15_e2e` migrate died at migration 133
  with PG error 53100 — /tmp tmpfs hit 100% (the shared rig cluster holds ~13 DBs ≈ 34 MB
  each). The PG server crashed and auto-recovered. Only this lane's own scratch DBs
  (`sd15_baseline`, partial `sd15_e2e`) were dropped to reclaim 59 MB; no other lane's data
  was touched. Re-run from empty then passed as above. (HL-009's one-rig-bootstrap helper
  would not have prevented this; the constraint is aggregate cluster size on a 512 MB tmpfs.)

## Follow-ups filed

- **#1947** — Lex's residuals: (1) pre-existing collected-vs-not-measured contradiction
  (consent §1 lists gaze/blink/head pose as collected; biometric policy says not measured) —
  not created by S-D15, must clear before/with S-D17's #777 check; (2) possible narrowing of
  the stored "face/voice embeddings" sentences if no other feature stores voice embeddings;
  (3) HI v1.2 native-speaker/legal translation check (CF-5 family).

## Review

Independent review (separate reviewer, code + privacy + security-on-consent-path): recorded
on the PR. Lex AC-6 review: recorded on epic #1900.

## AC-5 completion — About-page attribution line (2026-10-28 follow-up lane)

- **Ruling:** Sumanth (2026-10-28, recorded on #1917): NO new page; the credit itself stays
  (attribution term in the maker's licence). Placement: one line on the existing About page —
  "Speaker labelling powered by Desert Ant Labs." The README credit landed earlier in PR #1948;
  this line completes AC-5.
- **STOP 1:** posted on #1917 for this lane (specialist decision: UX/a11y No — single plain-text
  line reusing the footer's existing classes, no new layout/interaction; privacy/Lex no new
  specialist — wording and placement already ruled; security/DB/API skipped — static text only).
- **Change:** `client/src/pages/about.tsx` — one `<p>` line added in the existing `Footer()`
  credits area, next to the © line, inheriting the footer's `text-sm text-muted-foreground`
  styling. No new page, route, or component (ponytail: minimum diff).
- **Tests (red-first):** two source-guard tests added to
  `client/src/__tests__/pages/AboutHonestClaims.test.ts` (exact line present; present exactly
  once). RED on pristine dev `223f15c6f`: 2 failed / 23 passed (25). GREEN after the line:
  About suite 25/25; focused neighbours (About + SD15Disclosure + BiometricPolicy +
  ConsentScreens + ObserverDisclosure + consent-screens-human-interview) 68/68 across 6 files.
  A full `src/__tests__/pages/` run also surfaced pre-existing failures in
  `SettingsLinkedInUrl.test.tsx` (7) and `CandidateInterviewsScreening.test.tsx` (2) —
  verified failing identically (9/9) on pristine dev with this lane's changes stashed, so
  they are not caused by this change.
- **Authority:** PR to `dev` only; merge/close reserved to Suga.
