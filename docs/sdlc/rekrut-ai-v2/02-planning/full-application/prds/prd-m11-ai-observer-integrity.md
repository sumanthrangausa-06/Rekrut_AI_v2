# PRD — M11: AI Observer & Integrity

**State (verified, Scout §2): PRESENCE-ONLY WORKS; CAPTURE BUILT DORMANT; ANALYSIS ABSENT.** **Surfaces:** `lib/observerConsentGate.js`, `observerJobs.js`, `observerReportWriter.js`, `observerReportStates.js`, `observerCapture*.js`, `workers/ai-observer/` · client: InterviewReport, InterviewPanel, proctoring pages.
**Governing ruling: Gate A = B AMENDED (Sumanth, 2026-10-13).** This PRD encodes it; it does not reopen it.

## 1. Purpose & users
An AI observer that may join a human interview **only** with the candidate's biometric consent, records its presence honestly, and — in a later, separately-gated phase — produces observational analysis. Users: recruiters (toggle + report), candidates (consent), hiring team (gated audit record).

## 2. End-to-end journey (January truth)
Recruiter enables the observer in setup (cohort companies only at launch — D2 allow-list) → at the interview, the candidate is asked for biometric consent in the in-room dialog (the only consent moment) → **only `biometric_collection === true` admits the Observer** (default-deny gate; unknown/unset/declined all block, `BIOMETRIC_CONSENT_UNKNOWN`) → worker joins subscribe-only, in-process → presence + consent + attendance recorded → the report's Observer sections render their honest states (for January: `missing` / the neutral notice per the S-039 audience split). Declined/withdrawn/unknown collapse to **one neutral sentence** on recruiter surfaces; candidate surfaces and the gated audit record name the reason — canonical text lives only in `lib/observerReportStates.js`.

## 3. Current state (verified)
Toggle (S-046), default-deny gate, in-process worker (S-047, `server.js:1059`), disclosure UI (S-048), report-writer scaffold (S-049a), renderer + audience split (S-039, PR #795 + copy #797), payload minimisation (S-087) — all merged. Capture substrate (S-085, PR #800) merged **dormant**: `lib/observerCaptureFlag.js` is the only reader of `OBSERVER_AUDIO_CAPTURE_ENABLED`, ON only for the exact string `'true'`, and the flag is **unset in every environment — capture has never run**. Dormancy Evidence Pack 10/10 (Rung 1). Analysis chain (E-004/E-005: S-027 #674, S-034 #681, S-049b #697) is **spec-only** — no AnalysisService/IntegrityService exists; integrity-*adjacent* legacy proctoring pages are a separate older system, not this module's analysis.

## 4. Gap to launch-ready (January definition)
(1) **Cohort Enablement** (S-089): the audit spine — consent record, attended, "analysis: not provided in this release" — must be complete before *any* enablement; it blocks enablement, not the January date. (2) **#777:** the public biometric policy page promises a 60-second calibration baseline that is spec-only (E-003) — a pre-launch story that **blocks any Observer enablement** until the promise is removed/softened or built. (3) Lex's activation conditions from the S-085 ruling (C-L1 outcome-rows deviation, C-L2 PITR evidence, C-L4 Rung 2) stand as activation blockers, tracked in §8. Analysis itself is **not** a January gap — it is deferred scope under the re-entry contract.

## 5. Functional requirements
- FR-M11-1: The default-deny gate is absolute: no code path may admit the Observer, enqueue a job, or subscribe media unless `biometric_collection === true` at decision time (the gate's three checkpoints + S-049a's in-transaction re-check are the pattern).
- FR-M11-2: Capture stays flag-off in every environment until the re-entry contract fires (counsel + design cleared by 2026-11-01 → cohort-pilot path for the speech-pattern slice only; after 2026-12-01 → nothing activates pre-launch; open triggers escalate to Sumanth). January consent is **never banked** for capture — activation requires the distinct `observer_capture` artefact (Lex RL-01).
- FR-M11-3: Measurement returns **slice-by-slice, never as a bundle**; voice stress may only ever ship as a meter with uncertainty shown; **deception claims are banned**; body language is out of the programme until a validation path exists; no heuristic fallback scores, ever (S-082 anti-pattern).
- FR-M11-4: Report states are resolved server-side via `lib/observerReportStates.js` only — no forked copy, no client-side derivation (S-039 provenance rule, Quinn-verified).
- FR-M11-5: Erasure covers observer data day-one-style for any future artefact: jobs, reports, capture registry, and outcome rows per Lex's C-L1 resolution path.

## 6. Non-functional
- Privacy (privacy-engineer lens; Lex's 12 red lines are requirements, not advice): consent receipts for every observer decision; withdrawal = stop + queue-for-deletion (≤2 s kill watchdog on the capture path); capture retention = recording-class 30-day sub-policy (D-1 ruling).
- Honesty: no surface may claim analysis exists (copy audit discipline from S-039; the #777 fix is the public-page instance).

## 7. Dependencies (verified states)
M10 rooms/recordings (exist) · M19 consent/erasure (exists; C-L1 deviation tracked there) · Counsel determinations C-01…C-08 (**open**, #788; no outreach per Sumanth's 2026-10-13 instruction).

## 8. Sprint 11 overlap
S-089 Cohort Enablement + #777 are filed Sprint 11 items (sequenced set). C-L conditions: C-L3 (jest) → discharged in part, remainder #817; C-L2 → Relay (promotion track); C-L4 → Quinn (Rung 2).

## 9. ⚠ Unverified
Rung 2 (live-room dormancy on staging) — not run; jest capture-mirror suites — don't execute (#817); Neon PITR window — unverifiable from this VM (C-L2).

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M11-1 (#334): the Record/Observer toggle split.** Phase 2 decided separate toggles; code ships one `observer_enabled` flag. Implement the split, or formally revoke #334 and record the single-toggle as the decision?
  **Rex's recommendation: formally revoke the split for launch.** One toggle + the consent gate is the shipped, tested behaviour; a second toggle adds a consent-surface nobody has designed copy for. Revisit only if the capture activation design needs it (the `observer_capture` artefact already separates *capture* consent where it matters).
