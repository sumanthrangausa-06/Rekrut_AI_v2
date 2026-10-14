# PRD — M4: Candidates & Profiles

**State (verified, Scout §2): WORKS; structural risk.** **Surfaces:** `routes/candidate.js` (5,715 lines), `candidate-preferences.js`, `candidate-documents.js` · client: candidate/profile, documents, saved-jobs, onboarding.

## 1. Purpose & users
The candidate's home: profile, CV/documents, preferences, saved jobs — and, today, several application writes that conceptually belong to M6. Users: candidates (primary), recruiters (read via M7).

## 2. End-to-end journey
Candidate completes profile → uploads CV (parsed into `parsed_resumes`) and documents (encrypted at rest, `lib/document-crypto.js`) → sets preferences/visibility → saves jobs → applies (writes live in this file: `:2759` INSERT, `:3796` one-click apply).

## 3. Current state (verified)
All surfaces wired and working. The risk is structural: one 5,715-line god-file carries profile + documents + applications writes, so every M6 change touches M4's file and vice versa — change-risk, not user-facing breakage.

## 4. Gap to launch-ready
Functionally launch-ready. The launch-relevant gap is **visibility/consent integrity**: candidate visibility controls must be honoured by every reader (M7 #416 is the known violation — preview/invite bypassing soft-delete + opt-out), and profile fields rendered to recruiters must match what the candidate believes they shared (the 2026-10-07 candidates-page audit: snake_case/camelCase mismatches meant photos/experience/scores silently never rendered — correctness of the *displayed* profile is part of this module's contract with M7).

## 5. Functional requirements
- FR-M04-1: Candidate visibility/opt-out settings are authoritative data: every recruiter-facing read path (M7) must consume them; no reader may bypass (test-covered at the M7 boundary).
- FR-M04-2: Documents stay encrypted at rest; document access is candidate- or same-company-recruiter-scoped, audit-logged.
- FR-M04-3: Profile completeness shown to the candidate must be computed from the same fields recruiters see — no phantom completeness.
- FR-M04-4 (structural, post-launch candidate): extract application writes from `candidate.js` into the M6 router when M6's Sprint 11 work stabilises — **not** a launch blocker; named so the option isn't lost (Sage/modernize territory, requires Sumanth's decision to schedule).

## 6. Non-functional
- Privacy: profile data is the DSAR/erasure core — M19 coverage verified for this module; any new profile field must join the erasure list in the same change (standing rule from S-076/S-078).
- Responsive: profile editing is mobile-primary for candidates; document upload must work from phone cameras.

## 7. Dependencies (verified states)
M19 erasure/DSAR (exists, covers this module) · M7 readers (exist; #416 defect open) · M6 (writes entangled — see FR-M04-4).

## 8. Sprint 11 overlap
Sprint 11's M6 stories will edit application-write paths inside `candidate.js`; Lead sequences them as M6 work. This PRD adds no Sprint 11 scope.

## 9. ⚠ Unverified
Parsed-resume accuracy (no evaluation exists); document upload behaviour on staging (R2 TLS wall).

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M04-1:** Schedule the `candidate.js` extraction (FR-M04-4) post-launch with Sage, or leave the god-file indefinitely?
  **Rex's recommendation: post-launch, Sage-led, after Applications stabilises.** Splitting it pre-launch risks the module that works; ignoring it forever guarantees every future M6 change stays expensive.
