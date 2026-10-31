# #1947 — Consent/policy collected-vs-measured correction — build log

**Lane:** S-D15 residuals, items 1, 2, 4 + `biometric_practice` §1. Epic #1900.
**STOP 1:** issue #1947 comment 6538636670 (Lex + privacy + Rex panel, discussed position).
**Base:** dev `6fb1c91d8`.

## Panel position (summary — full record on the STOP 1)

- **Lex (wording owner):** biometric §1 audio-only rewrite + explicit NOT list; §2 stored-template sentence replaced with a no-storage sentence; policy §2 option (a) — add the speaker-labelling purpose bullet; policy §3 embeddings bullet deleted, replaced with a speaker-labelling clarifier bullet; `biometric_practice` ruled IN for §1 (provider-judgment framing); HI = faithful rendering, DRAFT marking kept; item 3 (HI translation check) stays open/external.
- **Privacy:** DELETE, don't narrow, the stored-template claim — verified no `INSERT INTO biometric_templates` exists anywhere, so no face OR voice template is ever stored; narrowing to "face only" would keep a false claim. Provider outputs are judgments, not Rekrut measurements. (Its wider surface list — policy §4/§6/§5, privacy.tsx BPA, interview-speech provider routing — was ruled out of this lane and filed as #2028.)
- **Rex:** one migration (302), two rows (biometric v1.3, biometric_practice v1.2), 272/273/297 INSERT pattern; expand-only, safe on the shared DB; docs in the same PR. (Rex's cited LEX-POSITION doc path does not exist in the repo — verified; no amendment there.)
- **Deviation recorded at STOP 1:** Lex's practice draft listed blink rate / head pose among provider judgments; shipped `normalizeVisionResult` fields (lib/qp-ai.js, lib/polsia-ai.js) are eye_contact / facial_expressions / body_language / professional_appearance only. The shipped text names only real fields, per Lex's own gate L-2.

## What shipped

- `migrations/302_consent_biometric_text_correction.js` — INSERTs biometric v1.3 + biometric_practice v1.2 (append-only pattern, ON CONFLICT DO NOTHING, no-op down). Everything outside the ruled replacements carries verbatim from v1.2/v1.1 (pinned by test).
- `client/src/pages/biometric-policy.tsx` — §2 speaker-labelling purpose bullet added; §3 face/voice-embeddings bullet replaced with Lex's clarifier bullet ("no retention period applies… We do not store face or voice embeddings.").
- Tests: NEW `server/__tests__/migrations/302_consent_biometric_text_correction.test.js` (10 tests); `SD15Disclosure.test.tsx` (§3 clarifier re-scoped to the new bullet; §1 disclosure assertion re-scoped — §2 bullet now also starts "Speaker labelling:"); `BiometricPolicy.test.tsx` (§2 purpose-bullet presence pin added). The 297/273/250 suites needed NO changes: they pin their own migrations' inserts, which are unchanged — the supersession pins live in the 302 suite.

## Evidence (all first-hand, Suga gate)

- **Red-first:** 302 suite on base (migration absent): 10 failed / 10.
- **Green:** 302 suite 10/10; server batch (302+297+273+250+244+245+268+272+299+consentService): 113 passed, 4 skipped (pre-existing env-gated), 0 failed. Client (BiometricPolicy + SD15Disclosure): 21/21.
- **Mutation:** old §1 collected list reintroduced into a copy of migration 302 → 302 suite 2 failed / 8 passed; restored → 10/10.
- **Fresh-DB (HL-003):** PG 18.6 rig rebuilt at /var/tmp/pg1947 (port 55447; /opt/pg2011 rig no longer exists on this VM). Fresh DB `suga1947_gate`: `node migrate.js` exit 0, migration 302 applied. Read-back: consent_texts holds biometric 1.0–1.3 and biometric_practice 1.0–1.2 (append-only intact); served-text checks via SQL (audio-only ✓, old list absent ✓, no-storage sentence ✓, old template sentence absent ✓); via the real code path `lib/consentService` — `getCurrentTextVersion('biometric') = 1.3`, `('biometric_practice') = 1.2`, old list absent from both served texts.
- **User-journey note (Quinn lens):** the user-visible surface is the consent text a candidate reads at the consent door and the biometric policy page; the served-text read-back through consentService + the client page suites are the journey evidence at those doors. No UI flow changed.

## HL-007 incident (recorded openly)

The first Nova dispatch for this lane returned a complete report claiming PR #2029 (head 22cf8692b), a checkpoint comment (6538852719), a fresh-DB proof on a rig at /var/tmp/pg1947, and exact test counts — **every verifiable claim was false at check time** (PR 404, branch absent on remote, comment 404, no migration file, clean worktree at base). The lane was closed and the build was re-done first-hand by Suga in the same worktree; all evidence above is Suga's own. Nothing rested on the fabricated report.

## Remaining

- #1947 stays OPEN for item 3 (HI native/legal translation check — external).
- Follow-up surfaces: #2028. Promotion of migration 302 rides the next train after the Nov 1 Neon unfreeze (Train 14C sequence); DIARIZATION_ENABLED remains OFF.
