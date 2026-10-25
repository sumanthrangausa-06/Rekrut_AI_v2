# PRD — M19: Consent, Privacy & Compliance

**State (verified, Scout §2): STRONGEST MODULE — two live defects.** **Surfaces:** `server/routes/consent.js`, `lib/consentService.js` (403 lines), `lib/erasureService.js` (495 lines), `routes/compliance.js`, `lib/biometricAudit.js`, `services/euComplianceService.js` · client: consent-screens, biometric-policy, privacy, admin/compliance, admin/biometric-audit, EU AI Act dashboard.
**Sprint 11 overlap:** #780 erasure family, #799 legal hold, #805 purge-arming, #777 policy page — the sprint's compliance spine runs through this module.

## 1. Purpose & users
The platform's legal machinery: consent capture and receipts, DSAR (access/export/delete), erasure, retention enforcement, biometric audit, compliance reporting. Users: candidates (rights), recruiters (their candidates' consent states), platform admin/compliance.

## 2. End-to-end journey
Candidate consents/declines (receipts stored) → consent state drives gates downstream (M11) → candidate files a DSAR → identity-checked fulfilment: export generation, or erasure — **31 table DELETEs + `recording_consent` redaction + users tombstone in one transaction**, storage objects queued post-commit via the migration-252 ledger → retention purge runs nightly against the policy (90 d recordings / 30 d frames / 24 mo embeddings; capture audio 30-day sub-policy per D-1) → biometric audit trail records the compliance events.

## 3. Current state (verified)
The machinery is built and largely proven (S-073 DSAR endpoint PR #757; S-076/S-078 erasure completeness; S-077 retention lifecycle, migrations 253/254). **Defect 1 — arming:** the purge arms only when `RETENTION_PURGE_LIVE === 'true' && NODE_ENV === 'production'` (`server.js:1012`), and `NODE_ENV` is **unset on both Render services** → the retention promise currently has **no working enforcement anywhere** (#805; and Sumanth has separately never flipped `RETENTION_PURGE_LIVE` — two gates, both closed). **Defect 2 — coverage:** Applications family outside erasure (#780 family, Sprint 11); Post-Hire/Payroll never examined (M17 FR-M17-1). Counsel still owes (from the retention design review): final legal bases per data type, DPIA, public BIPA policy wording, consent-receipt retention after erasure — all inside #788's paused track.

## 4. Gap to launch-ready
#805's arming fix (DB-identity check replaces the env gate — Rex's S-077 follow-up design), the flip decision (below), #780-family coverage (Sprint 11), M17 disposition (M17's decision), and the design doc §9 audit surface completed into `compliance_audit_trail` (#801 — purge events already land there via migration 254; the remainder is aggregate-only entries + a read surface).

## 5. Functional requirements
- FR-M19-1: Purge arming is determined by **database identity** (an explicit check of which database the process is connected to), never by `NODE_ENV`; the arm state is visible in an admin/compliance surface, not buried in env config. (Closes #805's class.)
- FR-M19-2: Erasure completeness is a maintained inventory: every table holding personal data appears in the erasure map with a disposition (delete / redact / retain-with-basis); a new personal-data table without a map entry fails review (the S-076/S-078 lesson, made procedural).
- FR-M19-3: Retention purges consult the legal hold (#799) at **every** purge site and fail closed (a hold-check error stops the purge, never skips the check).
- FR-M19-4: Consent receipts are retained post-erasure per the counsel-set period; until counsel answers, the design's proposal (receipt metadata survives, content does not) is the operating rule and is labelled provisional in the compliance docs.
- FR-M19-5: The `[purged]` transcript sentinel must not leak into user-facing API responses (Rex's S-077 follow-up; recordings API lines named in #802-family follow-ups) — purged content renders as absence, not as a marker string.

## 6. Non-functional
- Privacy (privacy-engineer lens): this module *is* the privacy surface; every requirement here was shaped by a specialist finding in Sprints 6–10 and carries that provenance.
- EU surfaces (EU AI Act dashboard, `euComplianceService.js`) exist but the **EU launch is postponed** (2026-10-13) — they are maintained, not launch-promoted; Art. 88 design coverage stays on file for EU's return.

## 7. Dependencies (verified states)
#799 hold (**building**) · #788 counsel (**open/paused**) · every module's personal-data tables (inventory = FR-M19-2).

## 8. Sprint 11 overlap
Direct: #780, #799, #802/#803 (audit surface + backfills family), #805 — filed stories are the committed/sequenced layer.

## 9. ⚠ Unverified
Append-only guarantees of the biometric audit log (Scout: unverified); DSAR export completeness against a live DB (impossible from this VM); consent middleware generality (S-011 as written was never fully implemented — §3.1 of Scout's reconciliation).

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M19-1: flip `RETENTION_PURGE_LIVE`.** After #805's fix lands and is verified, do we arm live retention deletion (dry-run first on the record, then live)?
  **Rex's recommendation: yes — arm it, in that order, before launch.** A published 90/30-day policy with no enforcement is the exact promise-vs-mechanism gap this module exists to close; dry-run evidence + the #799 hold make live deletion defensible. (The flip itself stays your manual act, per the standing no-environment-changes rule.)
- **D-M19-2:** None on counsel items — they wait on your outreach decision (#788).
