# #2031 — Mock-interview audio routes: biometric-consent gate + biometric v1.4 provider-routing text

Build log, advance run 2026-10-31. STOP 1 on #2031 (comment 6544288754).
Lex ruling 6544214423 + AMENDMENT 6544238952 govern this lane; the
amendment supersedes the ruling's part (a) for `/respond` only.

## What changed

Scout's #2028 item-5 verification found the mock-interview consent
gating inconsistent in `routes/interviews.js`: `/mock/:sessionId/end`
and `/mock/analyze-frame` carried `requireBiometricConsent('biometric')`,
while `/mock/:sessionId/respond` and `/mock/:sessionId/voice-respond`
carried no gate — yet both reach the external transcription cascade
(`transcribeAudioWithWhisper` / `aiProvider.transcribeAudio`).
`biometric` v1.3 §1 also had no provider-routing disclosure.

One lane, one PR (Lex: gate + text ship together):

1. **`/mock/:sessionId/voice-respond` — unconditional gate.**
   `authMiddleware → requireBiometricConsent('biometric') →
   upload.single('audio') → handler`. The gate sits BEFORE multer,
   following the `/mock/analyze-frame` pattern (auth → consent →
   handler): the middleware resolves the session from
   `req.params.sessionId`, so a non-consented request is rejected
   before the candidate's audio is even buffered in memory, and can
   never reach transcription. (This route has no rate-limit
   middleware today; none was added — out of scope.)
2. **`/mock/:sessionId/respond` — conditional gate (amendment).**
   `authMiddleware → rateLimits.ai → requireBiometricConsentIfPayload
   → handler`. The wrapper delegates to the existing
   `requireBiometricConsent('biometric')` unchanged — same DB check,
   fail-closed semantics, same CONSENT_REQUIRED /
   CONSENT_VERSION_STALE / CONSENT_WITHDRAWN /
   CONSENT_CHECK_UNAVAILABLE responses; no second consent check was
   written. Predicate on the raw body: gate fires iff `audio_data`
   is present and non-empty OR `frames` is a non-empty array; any
   malformed non-empty value in either field counts as
   payload-present (fail closed). Text-only requests call `next()`
   immediately — a candidate who declined biometric consent keeps a
   real text path, per the consent text's own promise. On gate
   failure the whole request is rejected; nothing is stripped to
   proceed text-only.
3. **Migration 303 — `biometric` v1.4.** Append-only INSERT following
   migrations 297/302: v1.3 EN/HI carried verbatim (the constants
   were generated from migration 302's text with only the one
   sentence inserted) except Lex's provider-routing sentence added
   to §1 EN verbatim — "When you answer by voice, your audio is sent
   to an external speech-to-text provider to be turned into a
   transcript. The provider returns the transcript only; your audio
   is not used to identify you, and no voice template is created or
   stored from it." — with a faithful HI rendering of the same
   sentence (the external Hindi legal/native check already open on
   #1947 is not closed by this lane). No provider names: the cascade
   rotates. Receipts pinned to v1.3 read STALE → re-consent by
   design. `biometric_practice` and all other types untouched.

Handler logic on both routes is unchanged.

**Session pinning (specialist-review BLOCK, fixed in-lane).** The
first independent specialist review BLOCKED the initial diff with a
fail-open the implementer had missed: `requireBiometricConsent`
resolves the session body-first, then query, then params
(`server/middleware/requireBiometricConsent.js`), while both
handlers act on the URL session (`req.params.sessionId`). A caller
holding a valid receipt for one of their OWN sessions could name
that session in the body/query and route audio through a different
session where they never consented — consent here is per-session,
so the gate must check the session in the URL. The fix stays inside
this lane's routes: before delegating, `pinSessionIdToUrlParam`
overwrites any client-supplied body/query `sessionId` with the URL
param (setting `req.body = { sessionId }` when the pre-multer body
is undefined, and shadowing Express 4's re-parsing `req.query`
getter on the instance with a pinned copy). The shared middleware
itself, its DB check and its responses are unchanged. Regression
tests 7–8 in the suite below cover both mismatch shapes and were
verified to fail with the pin removed and pass with it in place.

## Specialist decision

Privacy/security specialist: YES (STOP 1 on #2031) — the lane changes
a consent-enforcement boundary on routes sending candidate audio to
external ASR providers. Considered and skipped: database specialist
beyond the migration-pattern check (no schema change); UX (no
surface change); voice/AI (no transcription behaviour changes).

Independent specialist review record (findings on #2031 and in the
PR): first review **BLOCKED** the diff — one Blocker (the
session-resolution mismatch described in the pinning note above;
the reviewer proved it dynamically against the real middleware),
plus three Minors (test gaps for malformed `frames` / empty-payload
boundaries — closed by tests 3c/3d; case-2's indirect transcription
proof — accepted as adequate, reasoning recorded in the suite
header; the weak Hindi migration pin — strengthened to an exact
remove-the-sentence equality, EN + HI). The Blocker was fixed
in-lane (session pinning + regression tests 7–8, verified red
without the pin and green with it) and the independent re-review
returned **PASS**: no Blockers, no Majors, one theoretical Minor
(pin's null/non-object body branch combined with a query-shadow
failure — a combination no parser in this stack produces;
defence-in-depth only, no action required for this lane).

## Evidence

- **Red-first** (base dev `dddc31bf9`, fresh DB `rekrut_2031` built
  only by `node migrate.js`, exit 0): the new real-DB suite failed
  6/8 — migration pin (current version was 1.3, expected 1.4),
  audio-no-consent, frames-no-consent, malformed-audio, stale, and
  voice-respond cases all returned 200 instead of 403. The two
  passes on base are the behaviours that must be preserved:
  text-only succeeds and valid-consent passes.
- **Green** (branch, fresh DB `rekrut_2031_green` built only by
  `node migrate.js`, exit 0, migration 303 applied): 12/12 — Lex's
  six cases, the malformed-payload fail-closed cases (audio as a
  number; frames as a string), the empty-payload boundary
  (`audio_data: ''` + `frames: []` passes), the sessionId-mismatch
  regressions 7–8 from the specialist BLOCK, and the v1.4 migration
  pin (sentence verbatim in §1; removing it restores the v1.3 EN
  and HI texts exactly). "Transcription never called" in the
  no-consent audio case is proved by the handler never running: the
  session conversation in the DB is unchanged after the rejected
  request, and transcription lives only inside the handler /
  background path the handler invokes.
- **Neighbours:** requireBiometricConsent middleware suite,
  qp-consent-gate, and six existing interviews route suites — 57/57
  pass. Consent-migration suites 297/302 — 18/18 pass.

## Gates

STOP 1 → red-first → fresh-DB green (HL-003) → independent
specialist review (BLOCK → in-lane fix → re-review PASS) → PR to
dev, gate-ready for Suga. Nova does not merge; the issue is not
closed by this lane.
RETENTION_PURGE_LIVE and DIARIZATION_ENABLED untouched; no other
routes change.
