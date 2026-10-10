---
project: Unified Interview Engine
prd_version: 3.2
architecture_version: 3
created: 2026-10-10
updated: 2026-10-10
owner: Sumanth
architect: Rex
stepsCompleted: ["step-01-analyze", "step-02-epics", "step-03-stories", "backlog-quality-review"]
status: draft
review: "Backlog quality reviewer: 32 issues found (8 🔴, 24 🟡). All incorporated in this revision."
---

# Unified Interview Engine — Epics & Stories Backlog

> **Status:** Draft v2 (review-incorporated) | **PRD:** v3.2 (approved) | **Architecture:** v3 (approved)
> **Method:** smart-sdlc `create-epics-stories` + backlog quality review (32 findings incorporated)
> **Sizing:** Fibonacci story points (1/2/3/5/8/13). 1pt ≈ half-day for one dev.
> **Capacity:** ~20 pts per 2-week sprint (single implementer). 59 stories, 322 points, 19 sprints.
> **Note for Lead (Phase 4):** This is the honest single-dev timeline. Parallelize tracks where dependencies allow to compress.

---

## Epic Dependency Order

```
E-002 (Consent & Compliance Foundation) ─┐
                                          ├─→ E-001 (Session Engine Core)
E-003 (Calibration & Fairness) ───────────┘         │
                                                     ├─→ E-004 (Integrity Detection) ─┐
                                                     │                                 ├─→ E-006 (Reporting) ─→ E-007 (Judge-First & Appeals)
                                                     └─→ E-005 (Behavioral Analysis) ─┘         │
                                                          (E-008 also needs E-005)               └─→ E-008 (AI Observer)
E-009 (Metering, Billing & Admin) ── parallel from mid-plan (needs E-001 metering hooks)
```

**Rationale:** Consent middleware (CR-21) must gate all biometric collection — nothing in E-004/E-005 ships without it. Session lifecycle (E-001) is the backbone. Calibration (E-003) before integrity signals are meaningful. Reporting needs integrity + behavioral outputs. Appeals need reports. Observer needs session + reporting + behavioral.

---

## Epic E-001: Session Engine Core

**Goal:** Candidates can join and complete interviews in all 4 modes with reliable voice/video, automatic turn-taking, and crash-safe progress.
**Personas:** Candidate, Recruiter
**PRD Coverage:** FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-42, FR-43, FR-44, FR-45, FR-46, FR-81
**Priority:** Core
**Dependencies:** E-002 (consent middleware S-011 must gate session start)
**Definition of Done:**
- [ ] All stories implemented and accepted
- [ ] E2E: complete mock + AI interview on iPhone Safari and desktop Chrome
- [ ] Interruption recovery tested (kill browser mid-session → resume)
- [ ] Documentation updated
**Estimated Stories:** 9

### Story S-001: Create interview session (all 4 modes)

**Epic:** E-001 | **PRD Ref:** FR-01, FR-02 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As a recruiter, I want to create an interview session of a specific type so that candidates get the right interview experience.

**Context:** Session type is immutable after creation. Each type has Zod-validated config defaults from ModeAdapter (shared module).

**Acceptance Criteria:**
- [ ] AC-1: Given a recruiter with valid permissions, when they POST `/api/interviews/sessions` with `type: "ai-interview"`, then a session is created with AI Interview defaults and `status: "invited"`.
- [ ] AC-2: Given a creation request with invalid config JSON, when Zod validation fails, then API returns 400 with specific field-level errors and no session is created.
- [ ] AC-3 (Error): Given a request with an unknown `type` value, when submitted, then API returns 400 `"INVALID_SESSION_TYPE"`.

**Technical Notes:** `SessionService.create()` → `ModeAdapter.getDefaults(type)` (shared/interview-modes/). Writes to `interview_sessions`. See ADR-006 (shared mode config).

**Dependencies:** Requires: S-011 (consent middleware gates session start). Blocks: S-002, S-003.

**Definition of Done:** Code + reviewed, unit tests, integration test, ACs verified, merged.

---

### Story S-002: Invite token generation and expiry

**Epic:** E-001 | **PRD Ref:** FR-03 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 3

**User Story:** As a recruiter, I want to generate a shareable invite link so that candidates can join without an account.

**Acceptance Criteria:**
- [ ] AC-1: Given a created session, when recruiter requests an invite link, then a unique token URL is generated (cryptographically random, ≥128 bits).
- [ ] AC-2: Given an invite token, when 7 days elapse or the candidate joins (single use), then the token is invalidated and session status → `expired` if never started.
- [ ] AC-3 (Error): Given an expired/used token, when candidate opens the link, then they see "This invite has expired. Contact your recruiter for a new one."

**Technical Notes:** Token stored hashed in `interview_sessions.invite_token_hash`.

**Dependencies:** Requires: S-001. Blocks: S-004.

---

### Story S-003: Session lifecycle state machine

**Epic:** E-001 | **PRD Ref:** FR-04, FR-05 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As a candidate, I want my progress saved if something goes wrong so that I don't lose my answers.

**Acceptance Criteria:**
- [ ] AC-1: Given a session in `in_progress`, when the candidate closes the browser, then status → `paused` within 60 seconds (heartbeat timeout) and all completed answers/transcripts/signals are persisted.
- [ ] AC-2: Given a paused session with 5/10 questions answered, when the candidate rejoins via a valid token, then they resume at question 6 with all prior data intact.
- [ ] AC-3 (Error): Given an invalid state transition (e.g., `completed` → `in_progress`), when requested, then API returns 409 `SESSION_STATE_CONFLICT`.

**Technical Notes:** `SessionService` owns the state machine. Heartbeat via LiveKit data channel or HTTP poll.

**Dependencies:** Requires: S-001. Blocks: S-005, S-008.

---

### Story S-004: Cross-device camera/mic initialization

**Epic:** E-001 | **PRD Ref:** FR-06 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As a candidate on my phone, I want the camera and mic to just work so that I can start my interview without troubleshooting.

**Acceptance Criteria:**
- [ ] AC-1: Given iPhone Safari, Android Chrome, or desktop Chrome/Firefox/Edge, when the candidate joins, then camera + mic initialize within 5 seconds and video renders ≥15fps.
- [ ] AC-2: Given a device where camera permission is denied, when joining, then the candidate sees device-specific remediation steps (not a generic error).
- [ ] AC-3 (Error): Given no camera hardware, when joining, then the candidate is blocked with a clear message (video is mandatory — no text fallback per Sumanth).

**Technical Notes:** Reuse `useInterviewCamera` hook. Fix the two-video-elements/one-ref bug found in Phase 0 (callback ref reattachment). NFR-05/NFR-06 device matrix: test iPhone Safari, Android Chrome, desktop Chrome/Firefox/Edge.

**Dependencies:** Requires: S-002. Blocks: S-006.

---

### Story S-005: Automatic turn-taking (AI Interview)

**Epic:** E-001 | **PRD Ref:** FR-07 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 8

**User Story:** As a candidate, I want the interview to flow naturally without me touching a mic button so that I can focus on answering.

**Acceptance Criteria:**
- [ ] AC-1: Given AI speech has finished, when 500ms elapse, then recording starts automatically (no mic button shown).
- [ ] AC-2: Given the candidate stops speaking for 2 seconds, when silence is detected, then the answer auto-submits and the AI turn begins.
- [ ] AC-3 (Error): Given silence detection fails (noisy environment), when 30 seconds elapse without auto-submit, then a subtle "Tap to submit" fallback appears (logged as `signal_unavailable` for VAD).

**Technical Notes:** `SpeechManager` (client) + `ConversationService` (server, 3.16). Silence detection via AnalyserNode (existing mock-interview pattern). TTS via `SpeechSynthesisService` (Cartesia). STT: client Web Speech API + server Whisper fallback (TranscriptionService 3.18).

**Dependencies:** Requires: S-003, S-009 (LLM chain for AI responses). Blocks: S-026 (probing needs turn-taking).

---

### Story S-006: Pre-flight device checks

**Epic:** E-001 | **PRD Ref:** FR-08 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 3

**User Story:** As a candidate, I want to verify my setup works before the interview starts so that I don't discover problems mid-interview.

**Context:** The consent screens (S-010) render after pre-flight in the candidate flow, but building the screens does not depend on pre-flight being built first.

**Acceptance Criteria:**
- [ ] AC-1: Given the pre-interview flow, when pre-flight runs, then camera, mic, speaker, internet speed, and display each show pass/fail.
- [ ] AC-2: Given a failed check, when displayed, then the candidate sees specific remediation steps for that check.
- [ ] AC-3: Given all checks pass or the candidate explicitly skips (with warning logged), when they continue, then they proceed to consent.

**Technical Notes:** Share the device-check portion with FR-56 calibration Step 1 to avoid duplicate checks. `CameraManager`/`AudioManager` expose `runDiagnostics()`.

**Dependencies:** Requires: S-004. Blocks: none (flow-ordering with S-010 noted in Context).

---

### Story S-007: Camera/mic failure recovery

**Epic:** E-001 | **PRD Ref:** FR-42, FR-43, FR-44, FR-45, FR-46 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As a candidate, I want to recover from a camera glitch without losing progress so that a technical issue doesn't ruin my interview.

**Acceptance Criteria:**
- [ ] AC-1: Given camera/mic signal lost >5 seconds, when detected, then session auto-pauses, AI stops, and candidate sees "We lost your [camera/microphone]. Check your device and click Resume."
- [ ] AC-2: Given a paused session, when the candidate fixes the issue and clicks Resume, then the interview resumes at the next unanswered question with all prior data intact.
- [ ] AC-3: Given an unresolvable issue, when the candidate clicks "Reschedule", then the recruiter is notified with partial session details and can send a new invite with "Resume from question N" or "Start fresh" (choice recorded in metadata).
- [ ] AC-4: Given a completed session with interruptions, when the report generates, then a "Session Notes" section lists each interruption with timestamp and duration.

**Technical Notes:** `SessionService.pause()` / `.resume()`. Interruption events logged to `integrity_events` as `signal_gap` (info severity — not a flag).

**Dependencies:** Requires: S-003, S-005.

---

### Story S-008: LiveKit room orchestration

**Epic:** E-001 | **PRD Ref:** FR-01 (human mode), FR-83 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 8

**User Story:** As a candidate in a human interview, I want to join a reliable video room so that I can talk to the interviewer without drops.

**Acceptance Criteria:**
- [ ] AC-1: Given a human interview session, when it starts, then a LiveKit room is created with name linked to `interview_rooms`.
- [ ] AC-2: Given participants joining, when tokens are issued, then `candidate-{userId}` / `interviewer-{userId}` identity prefixes are applied; room metadata (`candidate_id`, `interviewer_ids`) is the fallback source of truth on prefix mismatch (mismatches logged).
- [ ] AC-3 (Error): Given LiveKit Cloud is unreachable, when room creation fails, then the session is marked `paused` with a retry option (not `abandoned`).

**Technical Notes:** `LiveKitOrchestrator` (3.11). Reuse existing `server/services/livekit.js` token/dispatch patterns. Idempotent dispatch with `{interview_session_id, mode}` metadata.

**Dependencies:** Requires: S-001. Blocks: S-047 (observer bot joins rooms).

---

### Story S-009: Interview LLM fallback chain

**Epic:** E-001 | **PRD Ref:** FR-81 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As the platform, I need LLM inference to survive provider outages so that interviews never go silent.

**Acceptance Criteria:**
- [ ] AC-1: Given Groq available with ZDR enabled, when the interview needs LLM inference, then Groq is used.
- [ ] AC-2: Given Groq failure/throttle, when fallback triggers, then NIM is tried, then Cerebras. Kimi and OpenAI are excluded from the interview chain.
- [ ] AC-3: Given all providers failing, when the chain is exhausted, then the session pauses gracefully with "AI is temporarily unavailable. Your progress is saved." — never a silent dead room.
- [ ] AC-4: Given pre-launch checklist, when verified, then Groq ZDR is confirmed enabled in console (CR-20).

**Technical Notes:** Extend `lib/ai-provider.js` `getChain('llm', 'interview')` variant. DPA-gated at runtime per ADR-010. Groq removed from STT chain (biometric audio needs stricter ZDR verification).

**Dependencies:** Requires: S-001. Blocks: S-005 (turn-taking needs AI responses).

---

## Epic E-002: Consent & Compliance Foundation

**Goal:** Every biometric data collection is gated by explicit, versioned, withdrawable consent — enforced at the API layer, auditable, and deletable on request.
**Personas:** Candidate, Admin/Operator
**PRD Coverage:** FR-09, FR-12, FR-13, FR-14, FR-14a, FR-51, FR-52, FR-53, FR-54, CR-01, CR-02, CR-03, CR-04, CR-05, CR-06, CR-07, CR-08, CR-09, CR-10, CR-11, CR-12, CR-13, CR-17 (partial), CR-21
**Priority:** Core (legal blocker — nothing biometric ships without this)
**Dependencies:** None (foundation — must be first)
**Definition of Done:**
- [ ] All stories implemented and accepted
- [ ] Consent middleware blocks all biometric endpoints without valid consent (tested)
- [ ] DSAR export + deletion verified end-to-end
- [ ] Pre-launch compliance gate checklist completable
**Estimated Stories:** 15

### Story S-010: Three separate consent screens (+ AI disclosure)

**Epic:** E-002 | **PRD Ref:** FR-09, FR-14, CR-01, CR-10, CR-11 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 8

**User Story:** As a candidate, I want to understand exactly what I'm consenting to so that I can make informed choices about my biometric data.

**Context:** In the candidate flow, these screens render after pre-flight (S-006), but building them does not require S-006 to be complete first.

**Acceptance Criteria:**
- [ ] AC-1: Given the pre-interview flow, when the candidate reaches consent, then they see 3 separate screens: (1) interview recording, (2) biometric analysis, (3) ID verification — never bundled.
- [ ] AC-2: Given each screen, when displayed, then it shows "What we collect / How long we keep it / How to delete" with independent Accept/Decline.
- [ ] AC-3: Given the candidate declines *recording* consent, when they confirm, then the session cannot start (no interview without recording).
- [ ] AC-4: Given the candidate declines *biometric* consent, when they confirm, then the UI offers the human-interview alternative (the full decline → notification → approval flow is owned by S-012; this story covers only the offer UI).
- [ ] AC-5: Given locale set to Hindi, when consent screens render, then all text is in Hindi with English accessible (CR-10, DPDP).
- [ ] AC-6: Given the pre-interview flow, when the candidate approaches AI Screening or AI Interview, then they see a separate AI-use disclosure: "This interview uses AI to [analyze your responses / score your answers]. A human recruiter reviews all AI outputs before making decisions." (CR-11, IL HB 3773 / NYC LL144).

**Technical Notes:** `ConsentService` (3.20). Consent text versioned in `consent_texts` table; receipts in `consent_receipts`.

**Dependencies:** Requires: none (flow-ordering with S-006 noted in Context). Blocks: S-011.

---

### Story S-011: Consent enforcement middleware (API gate)

**Epic:** E-002 | **PRD Ref:** CR-21 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As the platform, I need biometric collection to be impossible without valid consent so that we are compliant by architecture, not by convention.

**Acceptance Criteria:**
- [ ] AC-1: Given any request to biometric endpoints (`POST /api/interviews/*/frames`, voice upload, ID verification), when `requireBiometricConsent` middleware runs, then it checks for a valid consent receipt.
- [ ] AC-2: Given no valid consent, when the request arrives, then API returns `403 CONSENT_REQUIRED` and zero biometric data is collected or stored.
- [ ] AC-3: Given consent text version has changed since the candidate consented, when they make a biometric request, then API returns `403 CONSENT_VERSION_STALE` and the client presents the new text inline.
- [ ] AC-4: Given mid-session consent withdrawal, when the candidate withdraws, then further collection is immediately blocked (`403 CONSENT_WITHDRAWN`); already-collected data follows retention policy.
- [ ] AC-5: Given high-traffic sessions, when middleware runs, then consent is checked via live DB lookup (never cached) — withdrawal must propagate immediately.
- [ ] AC-6 (Security): Given a crafted request with a forged consent receipt, when the middleware validates, then the receipt signature is verified server-side and the forgery is rejected.

**Technical Notes:** Express middleware in `server/middleware/requireBiometricConsent.js`. See error catalog: `CONSENT_REQUIRED`, `CONSENT_VERSION_STALE`, `CONSENT_WITHDRAWN`.

**Dependencies:** Requires: S-010. Blocks: S-001 (session start gate), S-022 (signal upload), S-028 (voice upload).

---

### Story S-012: Consent-decline → human interview path

**Epic:** E-002 | **PRD Ref:** FR-14a | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 3

**User Story:** As a candidate who doesn't want biometric analysis, I want the option of a human interview so that I can still be considered.

**Acceptance Criteria:**
- [ ] AC-1: Given a candidate who declined biometric consent and accepted the human-interview offer (S-010 AC-4), when they confirm, then the recruiter is notified with "Candidate declined biometric consent — human interview requested."
- [ ] AC-2: Given the notification, when the recruiter responds, then they can approve (creates human-mode session) or decline (candidate notified).
- [ ] AC-3: Given an approved human interview, when the session runs, then no biometric collection occurs (IntegrityMonitor disabled, only transcript + human assessment).

**Technical Notes:** `SessionService` creates `type: "human"` session with `biometric_collection: false` in config.

**Dependencies:** Requires: S-010, S-001.

---

### Story S-013a: ID face-match scoring

**Epic:** E-002 | **PRD Ref:** FR-11, FR-13 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As a recruiter, I want the candidate's face matched against their ID photo so that I know who I'm interviewing.

**Context:** Split from original S-013 per review (liveness challenges moved to S-024; deletion moved to S-013b).

**Acceptance Criteria:**
- [ ] AC-1: Given an uploaded ID photo, when face matching runs, then similarity score (0-100) is computed: ≥80 auto-accept, 60–79 flag for review, <60 block session.
- [ ] AC-2: Given the database, when queried, then no ID number, address, or DOB fields exist for any candidate (verified by automated test).

**Technical Notes:** Face embedding via MediaPipe FaceMesh or verification provider. Embedding stored; image handled by S-013b.

**Dependencies:** Requires: S-011 (consent gate).

---

### Story S-013b: 24-hour ID image deletion

**Epic:** E-002 | **PRD Ref:** FR-12 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As a candidate, I want my ID photo deleted quickly after verification so that my sensitive document isn't stored.

**Context:** Split from original S-013. The hourly purge job is built here (not deferred) because S-013a's deletion guarantee depends on it.

**Acceptance Criteria:**
- [ ] AC-1: Given a completed ID verification, when 24 hours elapse, then the raw ID image is deleted from primary storage via the hourly purge job; backup copies expire within 30 days; only embedding + score + timestamp + ID type remain.
- [ ] AC-2: Given a crash mid-purge, when the job restarts, then R2/B2 lifecycle rules act as backstop (crash-safe deletion).
- [ ] AC-3: Given each deletion, when completed, then it is logged to the biometric audit trail.

**Technical Notes:** Image stored in R2 with `expires_at` + lifecycle rule backstop. Hourly job (not daily) for the 24h SLA.

**Dependencies:** Requires: S-013a, S-014 (audit logging).

---

### Story S-014: Biometric audit log (append-only)

**Epic:** E-002 | **PRD Ref:** FR-54, CR-05 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 3

**User Story:** As an admin, I want every biometric data access logged immutably so that we can prove compliance during audits.

**Acceptance Criteria:**
- [ ] AC-1: Given any biometric data access, when it occurs, then a log entry records `[timestamp] [user_id] [role] [view|delete|export] [data_type] [candidate_id]`.
- [ ] AC-2: Given the audit log table, when an UPDATE or DELETE is attempted, then a database trigger blocks it (append-only enforced at DB level, not just app level).
- [ ] AC-3: Given the retention policy, when checked, then logs are retained for 7 years.

**Technical Notes:** `biometric_audit_log` table + trigger `prevent_audit_mutation`. App DB role gets INSERT/SELECT only.

**Dependencies:** Requires: none.

---

### Story S-015: Automated retention purges

**Epic:** E-002 | **PRD Ref:** FR-53, CR-07 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As the platform, I need old biometric data deleted automatically so that we never retain data beyond legal limits.

**Acceptance Criteria:**
- [ ] AC-1: Given the daily cron, when it runs, then videos >90 days past hiring decision are deleted; biometric data >3 years old is deleted (BIPA backstop).
- [ ] AC-2: Given the hourly job, when it runs, then face/voice embeddings >24 hours past session end are purged.
- [ ] AC-3: Given each deletion, when completed, then timestamp + record count are logged to the audit trail.
- [ ] AC-4: Given a crash mid-purge, when the job restarts, then the run is idempotent (safe to re-run) and R2/B2 lifecycle rules act as backstop.

**Technical Notes:** `deletion_jobs` table tracks purge runs. Part of pre-launch compliance gate.

**Dependencies:** Requires: S-014 (audit logging for deletions).

---

### Story S-016a: Step-up authentication for biometric data access

**Epic:** E-002 | **PRD Ref:** CR-12 (partial) | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As a candidate, I want extra verification before anyone (including me) downloads my biometric data so that a hijacked session can't exfiltrate it.

**Context:** Split from original S-016. This is a reusable capability — also used by S-017 (deletion confirmation).

**Acceptance Criteria:**
- [ ] AC-1: Given a request for biometric data export or deletion, when step-up is required, then an email OTP is sent via Brevo (Sumanth's decision: email OTP for biometric data).
- [ ] AC-2: Given the OTP, when entered within 15 minutes, then the protected action proceeds; expired OTPs are rejected.
- [ ] AC-3 (Rate limit): Given repeated OTP requests, when more than 3 per hour are made, then further requests are throttled.

**Technical Notes:** OTP service in `ConsentService` or shared auth module. Brevo transactional email.

**Dependencies:** Requires: none (Brevo already configured per project state).

---

### Story S-016b: DSAR data export generation

**Epic:** E-002 | **PRD Ref:** CR-12 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As a candidate, I want to download all my data so that I can exercise my privacy rights.

**Context:** Split from original S-016. Requires S-016a for the step-up auth step.

**Acceptance Criteria:**
- [ ] AC-1: Given valid step-up authentication (S-016a), when the candidate confirms export via `GET /api/candidates/me/export`, then an `export_jobs` record is created and generation begins.
- [ ] AC-2: Given the export, when generated, then it includes: profile, applications, scores, transcripts, consent records, integrity flags — in JSON + human-readable PDF.
- [ ] AC-3: Given the export completes, when checked, then it finishes within 72 hours (SLA tracking for 30-day GDPR / 45-day CCPA compliance).
- [ ] AC-4 (Privacy): Given the export, when it includes integrity flags, then flags are included per GDPR Art. 15 (overrides FR-48's UI hiding — the *report* hides them, the *export* includes them).
- [ ] AC-5 (Error): Given a duplicate export request while one is pending, when submitted, then API returns `409 EXPORT_IN_PROGRESS` with a link to poll status.

**Technical Notes:** Async job. `export_jobs` table with status polling. Max 1 export per 24h per candidate (rate limit).

**Dependencies:** Requires: S-016a, S-014 (audit log).

---

### Story S-017: "Delete my data" orchestration

**Epic:** E-002 | **PRD Ref:** FR-52, CR-06, CR-13 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 8

**User Story:** As a candidate, I want to delete all my biometric data so that I control my privacy.

**Acceptance Criteria:**
- [ ] AC-1: Given a candidate in their dashboard, when they click "Delete my biometric data" and confirm (with step-up auth per S-016a), then a deletion ticket is created.
- [ ] AC-2: Given the ticket, when processed, then data is purged from: primary DB, R2/B2 storage, LiveKit recordings, logs (PII scrubbed). Neon backups are tombstoned. Groq processes nothing (ZDR verified per CR-20).
- [ ] AC-3: Given completion, when verified, then deletion finishes within 30 days and the candidate receives email confirmation.
- [ ] AC-4: Given crypto-shredding (ADR-012), when per-candidate DEKs are destroyed, then encrypted biometric blobs become unrecoverable even if copies exist.
- [ ] AC-5 (Error): Given a duplicate deletion request while one is pending, when submitted, then API returns `409 DELETION_IN_PROGRESS`.

**Technical Notes:** `deletion_jobs` table. Per-candidate DEKs (random, not HKDF-derived) enable crypto-shredding. See ADR-012.

**Dependencies:** Requires: S-014, S-015, S-016a.

---

### Story S-018: Compliance dashboard (admin)

**Epic:** E-002 | **PRD Ref:** FR-51 | **PRD Version:** 3.2 | **Priority:** Important | **Points:** 5

**User Story:** As an admin, I want to see data retention status so that I can verify compliance at a glance.

**Acceptance Criteria:**
- [ ] AC-1: Given an admin user who has completed MFA (S-055), when they open the compliance dashboard, then they see: videos pending deletion (with countdown), biometric data by age bracket, upcoming auto-deletions in next 7 days.
- [ ] AC-2: Given any item, when the admin clicks "Delete now", then the deletion executes immediately and is logged.
- [ ] AC-3: Given the pre-launch gate, when reviewed, then the dashboard shows all 15 checklist items with pass/fail status.

**Technical Notes:** Admin-only route. MFA enforced via S-055.

**Dependencies:** Requires: S-014, S-015, S-055 (MFA).

---

### Story S-055: Admin MFA enrollment and enforcement (NEW)

**Epic:** E-002 | **PRD Ref:** CR-08 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As a platform admin, I want multi-factor authentication on biometric data access so that stolen passwords alone can't expose candidate biometrics.

**Context:** Added per backlog review — CR-08 had no implementing story; S-018 assumed MFA existed.

**Acceptance Criteria:**
- [ ] AC-1: Given an admin user, when they enroll in MFA, then a TOTP secret is generated (via `otplib`) and they complete a verification challenge to activate.
- [ ] AC-2: Given an admin accessing biometric data routes, when they authenticate, then a valid TOTP code is required; access is denied without it (`403 MFA_REQUIRED`).
- [ ] AC-3: Given an authenticated session, when the JWT is issued, then it carries a per-request `mfa_verified` claim (ADR-004); biometric endpoints re-verify the claim on every request.
- [ ] AC-4 (Recovery): Given a lost MFA device, when the admin requests recovery, then a super-admin must approve the reset (logged, auditable).

**Technical Notes:** See ADR-004 (TOTP MFA). Recovery flow requires manual super-admin approval — no self-service reset for biometric access.

**Dependencies:** Requires: none. Blocks: S-018.

---

### Story S-056: Biometric privacy policy page (NEW)

**Epic:** E-002 | **PRD Ref:** CR-02 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 2

**User Story:** As a candidate, I want to read the biometric data policy before consenting so that I know exactly what happens to my data.

**Context:** Added per backlog review — CR-02 was mapped to S-010 but had no AC.

**Acceptance Criteria:**
- [ ] AC-1: Given the production deployment, when accessing `/privacy/biometric-policy`, then a publicly accessible page describes: what biometric data is collected, why, retention periods per data type, destruction method, and how to request deletion.
- [ ] AC-2: Given the consent screens (S-010), when displayed, then each links to this policy page.
- [ ] AC-3: Given the pre-launch gate, when checked, then this page exists before any biometric collection occurs.

**Technical Notes:** Static page (can be markdown-rendered). Content reviewed by legal counsel per Sumanth's decision.

**Dependencies:** Requires: none. Blocks: S-010 (links to it).

---

### Story S-057: Encryption verification — AES-256 at rest, TLS 1.3 in transit (NEW)

**Epic:** E-002 | **PRD Ref:** CR-03 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 3

**User Story:** As the platform, I need biometric data encrypted at rest and in transit so that breaches don't expose raw biometrics.

**Context:** Added per backlog review — CR-03 had no implementing story.

**Acceptance Criteria:**
- [ ] AC-1: Given stored biometric templates, when inspected at the storage layer, then all are AES-256 encrypted.
- [ ] AC-2: Given any API transmitting biometric data, when inspected, then TLS 1.3 is enforced (no TLS 1.2 fallback for biometric routes).
- [ ] AC-3: Given every build, when CI runs, then an automated security scan verifies encryption configuration and fails the build on misconfiguration.

**Technical Notes:** Follows existing `lib/document-crypto.js` pattern. Neon encrypts at rest by default; this story covers application-layer field encryption for biometric templates.

**Dependencies:** Requires: S-058 (separate keys).

---

### Story S-058: Biometric/PII segregation with separate encryption keys (NEW)

**Epic:** E-002 | **PRD Ref:** CR-04 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As the platform, I need biometric data stored separately from personal identity so that a single breach can't link biometrics to named individuals.

**Context:** Added per backlog review — CR-04 had no implementing story.

**Acceptance Criteria:**
- [ ] AC-1: Given the database schema, when inspected, then biometric templates are in separate tables from `users`, using a different encryption key.
- [ ] AC-2: Given a query attempting to JOIN biometric templates directly to name/email, when executed, then it fails — linkage requires going through the session mapping table with proper authorization.
- [ ] AC-3: Given the key management, when reviewed, then per-candidate DEKs are used (random, enabling crypto-shredding per ADR-012).

**Technical Notes:** Two-role DB pattern ($0, no new infra — per architecture §4). Session mapping table is the only join path.

**Dependencies:** Requires: none. Blocks: S-057.

---

## Epic E-003: Calibration & Fairness

**Goal:** Every scored interview starts with a 60-second calibration that learns the candidate's baseline, with accommodation options that widen thresholds without disabling integrity.
**Personas:** Candidate
**PRD Coverage:** FR-56, FR-57, FR-58
**Priority:** Core (Sumanth: "single biggest false-positive reducer")
**Dependencies:** E-001 (session), E-002 (consent)
**Definition of Done:**
- [ ] Calibration runs before every scored interview
- [ ] Accommodation mode tested with widened thresholds
- [ ] No integrity flag fires on below-floor signals
**Estimated Stories:** 3

### Story S-019: 60-second passive calibration protocol

**Epic:** E-003 | **PRD Ref:** FR-56 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 8

**User Story:** As a candidate, I want the system to learn my normal behavior during a quick tech check so that my nervousness isn't mistaken for cheating.

**Acceptance Criteria:**
- [ ] AC-1: Given a scored interview starting, when calibration runs, then Step 1 (~15s): device check (camera, mic, lighting, device class) — reusing FR-08 pre-flight checks where possible.
- [ ] AC-2: Given Step 1 complete, when Step 2 runs (~45s), then ice-breaker questions are asked as "mic/camera test" while baselines are captured.
- [ ] AC-3: Given the session continues, when high-quality signal windows occur, then baselines are silently updated via EWMA re-anchoring (drift correction).
- [ ] AC-4: Given any signal with warm-up quality below its defined floor, when integrity evaluation runs, then no flag fires on that signal (logged as `signal_unavailable`).
- [ ] AC-5: Given the candidate experience, when calibration runs, then it feels like a tech check, not a test.

**Technical Notes:** `CalibrationService` (3.21). Baselines in `calibration_baselines` (per-session, Redis + DB snapshot for race-free handoff). eGeMAPS 88-feature voice baseline captured here.

**Dependencies:** Requires: S-006 (shares pre-flight checks), S-011 (consent). Blocks: S-027 (fusion needs baselines), S-028 (voice deviation needs baseline).

---

### Story S-020: Self-declared accommodation mode

**Epic:** E-003 | **PRD Ref:** FR-57 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 3

**User Story:** As a candidate who fidgets, I want the system to calibrate to me so that my natural movements aren't flagged.

**Acceptance Criteria:**
- [ ] AC-1: Given the pre-interview flow, when the candidate reaches the accommodation step, then they may select: "I fidget / move frequently," "I stutter or pause when speaking," "Apply wider tolerances (prefer not to say)," or skip.
- [ ] AC-2: Given accommodation selected, when integrity evaluation runs, then movement and speech-timing thresholds are widened; integrity monitoring is never disabled.
- [ ] AC-3 (Privacy): Given Sumanth's decision (accommodation is private), when a recruiter views the report, then they see `integrity_calibrated: true` (boolean only) — never the reason or numeric adjustments.
- [ ] AC-4: Given the framing, when displayed, then language is non-stigmatizing ("help us calibrate to you").

**Technical Notes:** `accommodation_modes` table. Boolean exposure only (ADR-011).

**Dependencies:** Requires: S-019.

---

### Story S-021: Per-candidate dual baselines

**Epic:** E-003 | **PRD Ref:** FR-58 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 3

**User Story:** As the system, I need to compare candidates against their own baseline (not just population average) so that natural variation isn't flagged.

**Acceptance Criteria:**
- [ ] AC-1: Given a calibrated session, when integrity signals are evaluated, then the candidate is compared against their own warm-up baseline AND the cohort distribution for the same question type.
- [ ] AC-2: Given a candidate whose pattern matches their warm-up, when evaluated, then they are NOT flagged even if they differ from population average.
- [ ] AC-3: Given session end, when cleanup runs, then per-session baselines are not retained across sessions.

**Technical Notes:** Dual reference in `calibration_baselines`. Cohort distributions are precomputed aggregates (no PII).

**Dependencies:** Requires: S-019.

---

## Epic E-004: Integrity Detection

**Goal:** Detect deepfakes, AI-assisted answers, and liveness anomalies using 14 event types with conservative, quality-weighted fusion — producing observations for human review, never autonomous verdicts.
**Personas:** Recruiter (evidence consumer), Candidate (challenge participant)
**PRD Coverage:** FR-10, FR-15, FR-16, FR-17, FR-18, FR-19, FR-20, FR-21, FR-22, FR-23, FR-24, FR-25, FR-31, FR-32, FR-33, FR-34, FR-35, FR-59, FR-60, FR-61
**Priority:** Core
**Dependencies:** E-001 (session + turn-taking), E-002 (consent gate), E-003 (calibration baselines)
**Definition of Done:**
- [ ] All 14 event types firing correctly in test harness
- [ ] Fusion: ≥0.85 + 3 signals → flag; 0.60–0.85 → uncertain queue
- [ ] Challenges feel natural (user tested)
- [ ] No autonomous verdicts (automated test)
**Estimated Stories:** 11

### Story S-022: Client-side integrity signal collection

**Epic:** E-004 | **PRD Ref:** FR-20, FR-21, FR-22 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 8

**User Story:** As a candidate's device, I need to detect reading patterns, latency anomalies, and zero-hesitation speech so that AI-assisted answers produce observable signals.

**Context:** "As a device" is used because this is client-side measurement code. The server independently verifies (ADR-002).

**Acceptance Criteria:**
- [ ] AC-1: Given an active interview, when gaze shows >3 left-to-right sweeps within 10 seconds, then a `reading_pattern` signal is recorded with sweep count, duration, and coordinates.
- [ ] AC-2: Given a completed answer with pause >8s before answering AND fluent delivery (WPM >130, <2 fillers), when evaluated, then a `latency_anomaly` signal is recorded.
- [ ] AC-3: Given a completed answer with WPM >140 AND zero fillers AND >50 words, when evaluated, then a `zero_hesitation` signal is recorded and the transcript segment is flagged for linguistic review.
- [ ] AC-4 (Trust): Given a crafted client fusion result claiming FLAG, when the server processes it, then the server runs independent fusion and ignores the client verdict (client is advisory/untrusted per ADR-002).

**Technical Notes:** `FrameAnalyzer` (MediaPipe, 2fps); `VoiceAnalyzer` (Web Audio); `IntegrityMonitor` (advisory). Signals batched via `SignalSync` every 5s; gaps logged as `signal_gap`.

**Dependencies:** Requires: S-005 (turn-taking), S-019 (baselines), S-011 (consent gate on upload).

---

### Story S-023a: Passive screen-flash deepfake test (NEW — split)

**Epic:** E-004 | **PRD Ref:** FR-15 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 4

**User Story:** As the system, I need to passively test whether the video feed responds to screen light changes so that deepfake video can be detected without alerting the candidate.

**Context:** Split from original S-023 (screen flash / lip-sync / AV-sync are independent detectors).

**Acceptance Criteria:**
- [ ] AC-1: Given an active AI Interview, when the screen-flash test triggers (random, 2–3× per session), then page background shifts hue for <200ms and facial pixel hue change is measured.
- [ ] AC-2: Given the measurement, when evaluated, then real faces show response within 4 frames; non-response creates a `screen_flash_anomaly` event.
- [ ] AC-3: Given the test, when it runs, then the candidate is not notified (passive).

**Technical Notes:** CSS hue-rotate on body background. Approved by Sumanth; covered under biometric consent.

**Dependencies:** Requires: S-022 (signal pipeline).

---

### Story S-023b: Lip-sync verification (NEW — split)

**Epic:** E-004 | **PRD Ref:** FR-16 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 4

**User Story:** As the system, I need to verify that lip movements match spoken audio so that dubbed or synthetic video is detected.

**Context:** Split from original S-023.

**Acceptance Criteria:**
- [ ] AC-1: Given active audio+video, when lip-sync verification runs (every 30s), then mouth shapes are compared to expected phonemes from audio.
- [ ] AC-2: Given misalignment >150ms sustained for >5 seconds, when detected, then a `lip_sync_fail` integrity event is created.

**Technical Notes:** MediaPipe FaceMesh landmarks vs. phoneme timing from TranscriptionService.

**Dependencies:** Requires: S-022.

---

### Story S-023c: AV-sync measurement with liveness challenge trigger (NEW — split)

**Epic:** E-004 | **PRD Ref:** FR-17, FR-18 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 4

**User Story:** As the system, I need to detect audio-visual desynchronization and trigger a natural liveness check so that suspected deepfakes get human-verifiable confirmation.

**Context:** Split from original S-023.

**Acceptance Criteria:**
- [ ] AC-1: Given AV-sync measurement, when offset >80ms sustained >10s, then the system issues a gaze-based liveness challenge: AI says "Quick check — could you look directly at the camera?" (framed naturally).
- [ ] AC-2: Given the challenge, when issued, then gaze compliance is verified within 10 seconds and the event is logged regardless of outcome.
- [ ] AC-3: Given any deepfake signal, when processed, then the interview continues uninterrupted with no accusatory message (FR-19).

**Technical Notes:** Offset between audio onset and lip movement calculated per measurement window.

**Dependencies:** Requires: S-022.

---

### Story S-024: Integrity challenge system (5 types)

**Epic:** E-004 | **PRD Ref:** FR-10, FR-31, FR-32, FR-33, FR-34 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 8

**User Story:** As a candidate, I want integrity checks to feel like natural interview moments so that I don't feel accused.

**Context:** Owns ALL liveness challenges including the session-start gaze challenge (FR-10). S-013 no longer covers liveness (deduplicated per review).

**Acceptance Criteria:**
- [ ] AC-1: Given session start, when the liveness challenge runs, then the AI says "Before we begin, a quick setup check — please look to your left... now to your right" with on-screen arrow. The words "verification" or "security check" are never used. Gaze is verified via MediaPipe iris tracking within 10 seconds.
- [ ] AC-2: Given the challenge system, when a challenge is selected, then it is one of 5 config-driven types: `gaze_verification`, `number_reading`, `workspace_show`, `comprehension_probe`, `dot_following` — each with defined pass/fail criteria; new types addable without code changes.
- [ ] AC-3: Given a failed challenge, when detected, then the AI says "Let me try that once more" and issues a different challenge type; the interview does not pause.
- [ ] AC-4: Given two consecutive failures, when the second occurs, then a high-severity (`critical`) integrity event is created silently and the interview proceeds normally with no candidate indication.

**Technical Notes:** Challenge definitions in `interview_flows` config (JSONB). Server issues and verifies (ADR-002).

**Dependencies:** Requires: S-005 (AI speech), S-022.

---

### Story S-025: Transcript linguistic forensics

**Epic:** E-004 | **PRD Ref:** FR-23 | **PRD Version:** 3.2 | **Priority:** Important | **Points:** 5

**User Story:** As a recruiter, I want to know if answers show AI-generated language patterns so that I can assess genuine ability.

**Acceptance Criteria:**
- [ ] AC-1: Given a completed transcript, when forensics runs, then it checks: formulaic transitions, robotic completeness, specificity score (named tools/dates/numbers/people).
- [ ] AC-2: Given the analysis, when complete, then a per-answer `ai_likelihood` score (0-100) is stored in `behavioral_signals` with modality=`linguistic`.
- [ ] AC-3: Given the output, when displayed, then it uses observational language ("formulaic transitions detected: 4") — never "AI-generated answer."

**Technical Notes:** `AnalysisService` (3.12) via LLM chain. Runs post-interview (async).

**Dependencies:** Requires: S-009 (LLM chain), S-003 (transcript).

---

### Story S-026: Interactive integrity probing

**Epic:** E-004 | **PRD Ref:** FR-24, FR-25 | **PRD Version:** 3.2 | **Priority:** Important | **Points:** 5

**User Story:** As the interviewer AI, I need to probe suspicious answers conversationally so that scripted responses fall apart naturally.

**Acceptance Criteria:**
- [ ] AC-1: Given 3+ sub-flag-threshold behavioral signals within 30 seconds, when the threshold is reached, then the AI generates an unscripted follow-up targeting the suspicious answer (logged as "integrity probe," not shown as such to candidate).
- [ ] AC-2: Given a triggered probe, when the AI speaks, then it uses natural language and NEVER uses "suspicious," "verify," "confirm," or "check."
- [ ] AC-3: Given the probe response, when evaluated, then consistency with the original answer is scored.

**Technical Notes:** `ConversationService` generates probes via LLM with a "probing" system prompt.

**Dependencies:** Requires: S-005 (turn-taking), S-022 (signal counting).

---

### Story S-027: Quality-weighted fusion engine

**Epic:** E-004 | **PRD Ref:** FR-35, FR-59, FR-60, FR-61 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 8

**User Story:** As the platform's integrity core, I need to combine signals intelligently so that low-quality data doesn't create false flags.

**Context:** Per OQ-6 decision: uncertain band (0.60–0.85 → review) ships at launch; quality-weighted fusion upgrades post-launch. AC-1–AC-4 are the testable launch contract.

**Acceptance Criteria:**
- [ ] AC-1: Given signals in a 30-second window, when fusion runs, then each signal is weighted by measured quality (quality²); fused ≥0.85 AND ≥3 independent signals → FLAG; 0.60 ≤ fused < 0.85 → UNCERTAIN (review queue); fused <0.60 OR total quality weight <1.0 → NO FLAG.
- [ ] AC-2: Given two signals from the same sensor with quality <0.5, when fusion runs, then the secondary signal's weight is halved (correlation discounting).
- [ ] AC-3: Given a signal below its quality floor, when fusion runs, then it is excluded entirely and logged as `signal_unavailable`.
- [ ] AC-4: Given the uncertain queue, when queried, then it is a query over `integrity_events` (partial index on confidence) — not a separate table.

**Technical Notes:** `IntegrityService` (3.13) — server-side authoritative fusion (ADR-002). Writes to `integrity_events`.

**Dependencies:** Requires: S-029 (event table migration must exist before fusion writes), S-022, S-021 (baselines).

---

### Story S-028: Voice consistency analysis

**Epic:** E-004 | **PRD Ref:** FR-26, FR-27 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As a recruiter, I want to know if a different person started speaking mid-interview so that I can detect proxy interviewers.

**Acceptance Criteria:**
- [ ] AC-1: Given the first 60 seconds of candidate speech, when the baseline is captured, then 88 eGeMAPS features are extracted and stored (completes within 5s of the 60s mark).
- [ ] AC-2: Given an established baseline, when a subsequent answer deviates >2σ on 3+ features, then a `voice_deviation` integrity event is created with the specific features and deviation amounts.
- [ ] AC-3: Given the voice profile, when stored, then it uses the per-candidate DEK encryption.

**Technical Notes:** `VoiceAnalyzer` extracts client-side; comparison server-side in `IntegrityService`. Baseline captured during calibration (S-019).

**Dependencies:** Requires: S-019 (calibration), S-022.

---

### Story S-029: Session integrity event timeline (data layer)

**Epic:** E-004 | **PRD Ref:** FR-19, FR-50 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 3

**User Story:** As the platform's data layer, I need to persist every integrity observation with full context so that recruiters can review evidence and auditors can verify.

**Acceptance Criteria:**
- [ ] AC-1: Given any integrity signal meeting thresholds, when processed, then an `integrity_events` row is created with: `event_type` (14-type CHECK constraint), `severity`, `offset_start_ms`/`offset_end_ms`, `confidence` (0–1), `details` JSONB.
- [ ] AC-2: Given the CHECK constraint, when an invalid `event_type` is inserted, then the database rejects it.
- [ ] AC-3: Given the timeline, when queried, then events are ordered by `offset_start_ms` using the composite index.

**Technical Notes:** Migration per architecture §4. Composite index `(interview_session_id, offset_start_ms)` + partial index on confidence.

**Dependencies:** Requires: none (migration must land before S-027). Blocks: S-027.

---

### Story S-030: Signal quarantine automation

**Epic:** E-004 | **PRD Ref:** FR-75 (partial) | **PRD Version:** 3.2 | **Priority:** Important | **Points:** 3

**User Story:** As a platform admin, I need unreliable signals to stop generating flags automatically so that false positives don't accumulate.

**Acceptance Criteria:**
- [ ] AC-1: Given a signal type with dismissal rate >50%, when the daily metrics job runs, then the signal is auto-quarantined (stops generating new flags).
- [ ] AC-2: Given a quarantined signal, when new data arrives, then collection continues (for retuning) but no flags are created.
- [ ] AC-3: Given the quarantine, when an admin reviews, then they can manually un-quarantine with a reason (logged).

**Technical Notes:** `signal_quarantine` table. Job in `IntegrityMetricsService` (3.24).

**Dependencies:** Requires: S-042 (dismissal workflow provides dismissal rate), S-053a (metrics dashboard).

---

## Epic E-005: Behavioral Analysis

**Goal:** Measure observable behavioral signals (vocal, visual, linguistic) per answer turn — reported as measurements, never labeled as emotions.
**Personas:** Recruiter
**PRD Coverage:** FR-28, FR-29, FR-30, FR-36, FR-37, FR-38, FR-39, FR-40, FR-41
**Priority:** Core
**Dependencies:** E-001 (turn-taking), E-003 (baselines), E-004 (signal pipeline)
**Definition of Done:**
- [ ] All modalities producing signals per answer turn
- [ ] Zero emotion/deception language in any output (automated test)
- [ ] "Insufficient data" shown (never fake scores) when confidence <0.5
**Estimated Stories:** 5

### Story S-031: Vocal behavior measurement (observational)

**Epic:** E-005 | **PRD Ref:** FR-28, FR-29, FR-37 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As a recruiter, I want vocal measurements (pitch, pace, energy) so that I can assess communication style objectively.

**Acceptance Criteria:**
- [ ] AC-1: Given a completed answer, when prosody analysis runs, then pitch range (F0), speech rate, energy level, and vocal variation are computed and stored in `behavioral_signals` with modality=`vocal`.
- [ ] AC-2: Given vocal effort indicators, when reported, then output is labeled "cognitive load estimate" or "speech variation" — NEVER "stress level," "deception," "lying," or any emotion.
- [ ] AC-3: Given every build, when tests run, then automated tests scan all UI strings, API responses, and logs for banned words and fail the build if found.
- [ ] AC-4: Given the inference step, when measured, then voice analysis inference completes in <100ms per turn (NFR-01); end-to-end per-answer processing completes within 2 seconds.

**Technical Notes:** `VoiceAnalyzer` (client) extracts; `AnalysisService` summarizes. AC-4 clarifies NFR-01 (<100ms inference) vs. per-answer budget (≤2s end-to-end).

**Dependencies:** Requires: S-005 (per-answer trigger), S-019 (baseline).

---

### Story S-032: Visual behavior measurement (non-affective)

**Epic:** E-005 | **PRD Ref:** FR-36, FR-41 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As a recruiter, I want observable visual measurements (gaze, head pose, blink rate) so that I can assess engagement without pseudoscientific emotion labels.

**Acceptance Criteria:**
- [ ] AC-1: Given a completed answer with video, when facial analysis runs, then only non-affective signals are extracted: gaze direction, head pose, blink rate, facial landmark displacement — and processing completes within 2 seconds.
- [ ] AC-2: Given the output, when reviewed, then no signal is labeled as an emotion (banned-word test extended with emotion terms).
- [ ] AC-3: Given low video quality with confidence <0.5, when reported, then the signal shows "Insufficient data" (FR-41) — never a placeholder score.

**Technical Notes:** `FrameAnalyzer` (MediaPipe FaceMesh, 2fps). Signal types per PRD §9.2.

**Dependencies:** Requires: S-022 (FrameAnalyzer pipeline).

---

### Story S-033: Linguistic analysis (STAR, specificity, depth)

**Epic:** E-005 | **PRD Ref:** FR-38 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As a recruiter, I want to know if answers are structured and specific so that I can assess communication quality.

**Acceptance Criteria:**
- [ ] AC-1: Given a completed answer transcript, when linguistic analysis runs, then STAR components are identified (Situation, Task, Action, Result).
- [ ] AC-2: Given the transcript, when scored, then specificity (0-100) and depth (surface vs. substantive) are computed.
- [ ] AC-3: Given text/linguistic signals in fusion, when weighted, then they receive the highest weight among modalities.

**Technical Notes:** `AnalysisService` via LLM chain. Async post-answer.

**Dependencies:** Requires: S-009 (LLM chain), S-003 (transcript).

---

### Story S-034: Multimodal fusion (non-affective)

**Epic:** E-005 | **PRD Ref:** FR-39, FR-40 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As a recruiter, I want combined behavioral insights per answer so that I see the full picture, not isolated metrics.

**Acceptance Criteria:**
- [ ] AC-1: Given visual, vocal, and linguistic signals for an answer, when fusion runs, then only non-affective signals are used and the output includes per-modality contributions for transparency.
- [ ] AC-2: Given a completed interview, when transition analysis runs, then temporal changes are tracked (e.g., "speech rate changed >20% between Q2 and Q3") with timestamps — described without emotion language.
- [ ] AC-3: Given the fused output, when stored, then it goes to `behavioral_signals` (modality=`fused`) and `session_analysis` per question (upsert — latest-wins).

**Technical Notes:** `AnalysisService` (3.12).

**Dependencies:** Requires: S-031, S-032, S-033.

---

### Story S-035: Supplementary rPPG heart rate

**Epic:** E-005 | **PRD Ref:** FR-30 | **PRD Version:** 3.2 | **Priority:** Nice-to-Have | **Points:** 3

**User Story:** As a recruiter, I want heart rate estimates as supplementary context so that I have an additional physiological signal.

**Acceptance Criteria:**
- [ ] AC-1: Given an active interview with face visible, when remote PPG runs, then heart rate is estimated from facial skin color changes with a confidence interval.
- [ ] AC-2: Given the estimate, when displayed, then it is always labeled "supplementary" and NEVER triggers integrity events alone.
- [ ] AC-3: Given low confidence, when evaluated, then the estimate is suppressed.

**Technical Notes:** Client-side rPPG via canvas pixel analysis. Deferrable to post-launch if sprint pressure.

**Dependencies:** Requires: S-032.

---

## Epic E-006: Reporting

**Goal:** Recruiters get full assessment + integrity evidence with three-tier progressive disclosure; candidates get qualitative feedback only. No integrity scores, no bare percentages — ever.
**Personas:** Recruiter, Candidate
**PRD Coverage:** FR-47, FR-48, FR-49, FR-50, FR-62, FR-63, FR-64, FR-65, FR-80
**Priority:** Core
**Dependencies:** E-004 (integrity events), E-005 (behavioral signals), E-001 (transcripts)
**Definition of Done:**
- [ ] Recruiter report loads <3s with all 4 sections
- [ ] Candidate report shows zero scores/flags (verified by test)
- [ ] No "integrity_score" in any API response (automated test)
- [ ] Three-tier evidence display working
**Estimated Stories:** 5

### Story S-036: Recruiter full report

**Epic:** E-006 | **PRD Ref:** FR-47, FR-50 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 8

**User Story:** As a recruiter, I want a comprehensive report so that I can make an informed hiring decision.

**Acceptance Criteria:**
- [ ] AC-1: Given a completed interview, when the recruiter opens the report, then they see: (1) Assessment scores by category, (2) Integrity timeline with all events + confidence, (3) Behavioral analysis per answer, (4) Full transcript with speaker labels and timestamps.
- [ ] AC-2: Given the report, when loaded, then it renders within 3 seconds.
- [ ] AC-3: Given integrity events, when displayed, then each shows: timestamp, event type, severity, confidence — plus "These are observations for your review, not determinations of misconduct."
- [ ] AC-4: Given a session with interruptions, when the report generates, then a "Session Notes" section lists each interruption (FR-46).

**Technical Notes:** `ReportService` (3.15) is the SOLE renderer (one-way data flow).

**Dependencies:** Requires: S-029 (event timeline), S-034 (behavioral), S-003 (transcript).

---

### Story S-037: Candidate qualitative report (3 variants)

**Epic:** E-006 | **PRD Ref:** FR-48, FR-79 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 8

**User Story:** As a candidate, I want helpful feedback on my interview so that I can improve — without seeing scores or flags.

**Context:** Three report variants share the report infrastructure but have different templates and disclosure rules.

**Acceptance Criteria:**
- [ ] AC-1: Given a completed AI Interview, when the candidate views their report, then they see qualitative feedback (strengths, areas to improve) with zero numerical scores.
- [ ] AC-2: Given a completed Mock Interview, when the candidate views their report, then they see numerical scores + qualitative feedback (mock is the exception).
- [ ] AC-3: Given a completed AI Screening, when the candidate views feedback, then they see qualitative feedback only — no formal report, no scores, no integrity details.
- [ ] AC-4: Given the OmniScore visibility model (Sumanth 2026-10-10), when the candidate views their profile, then they see their OmniScore number + activity feed, but never the score delta from this interview.
- [ ] AC-5 (Security): Given the candidate report API, when tested, then no integrity flags, scores, or embeddings are present in the response (automated test).
- [ ] AC-6 (Pricing): Given any tier including Free, when a candidate accesses their report, then no paywall is shown (FR-79 — candidate reports are free in all tiers).

**Technical Notes:** Separate report template from recruiter report. `ReportService.generateCandidateReport()` filters all quantitative fields.

**Dependencies:** Requires: S-036 (shares report infra).

---

### Story S-038: Three-tier integrity evidence display

**Epic:** E-006 | **PRD Ref:** FR-62, FR-63, FR-64, FR-65 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 8

**User Story:** As a recruiter, I want integrity evidence in plain language with progressive detail so that I understand what was observed without being told what to conclude.

**Acceptance Criteria:**
- [ ] AC-1: Given the integrity section, when opened (Tier 1 default), then observations appear in plain language with Low/Medium/High confidence tiers and timestamp chips.
- [ ] AC-2: Given Tier 1, when the recruiter clicks through (Tier 2), then they see contributing signals + alternative benign explanations.
- [ ] AC-3: Given Tier 2, when the recruiter clicks through (Tier 3 audit), then they see raw signal excerpts and full timeline (never the default view).
- [ ] AC-4: Given any observation text, when reviewed, then language uses "observed"/"recorded" — never "detected cheating," "suspicious," "abnormal," or "deceptive" — and every observation carries "This is an observation, not evidence of cheating."
- [ ] AC-5: Given confidence display, when shown, then tiers (Low/Medium/High) with reasons; if numeric, natural frequencies only, always paired with "This does not mean there is an X% chance the candidate cheated."
- [ ] AC-6: Given the entire report, when scanned, then no single "integrity score" exists anywhere (automated test asserts no `integrity_score` field in API responses or UI).

**Technical Notes:** Frontend progressive disclosure component. Banned-word CI test covers this surface.

**Dependencies:** Requires: S-036.

---

### Story S-039: Human interview side-by-side report

**Epic:** E-006 | **PRD Ref:** FR-49 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As a recruiter, I want to see human interviewer feedback alongside AI Observer analysis so that I can compare perspectives.

**Acceptance Criteria:**
- [ ] AC-1: Given a completed human interview, when the recruiter opens the report, then they see two columns: "Interviewer Assessment" (human scores, notes, hire/no-hire) and "AI Observer Analysis" (behavioral signals, integrity observations).
- [ ] AC-2: Given discrepancies, when detected, then they are highlighted — using observational language, never emotion labels.
- [ ] AC-3: Given observer was disabled for the session, when the report opens, then only the interviewer column shows with "AI Observer was not enabled for this session."

**Technical Notes:** `ReportService` merges `interview_evaluations` (human) + `ai_observer_reports` (AI).

**Dependencies:** Requires: S-036, S-049 (observer report data — build S-049 before S-039 within the sprint).

---

### Story S-040: Tier-gated evidence (pricing enforcement in reports)

**Epic:** E-006 | **PRD Ref:** FR-80 | **PRD Version:** 3.2 | **Priority:** Important | **Points:** 3

**User Story:** As the business, I want full evidence timelines gated to Professional+ so that packaging is enforced without compromising fairness.

**Acceptance Criteria:**
- [ ] AC-1: Given a Starter tier recruiter viewing a report with integrity events, when they view Tier 1, then they see flag counts + severity + one-line alternative explanations per flag.
- [ ] AC-2: Given the same recruiter, when they click to Tier 2/3, then they see a contextual upgrade prompt (not a blocking paywall).
- [ ] AC-3: Given any tier, when flags are displayed, then alternative explanations are always visible (evidentiary fairness is never tier-gated).

**Technical Notes:** `ReportService` checks `MeteringService.getTier()` before rendering Tier 2/3.

**Dependencies:** Requires: S-038, S-050 (metering — build S-050 before S-040 within the sprint).

---

## Epic E-007: Judge-First, Dismissal, Appeal & Onboarding

**Goal:** Recruiters form independent judgments before seeing AI output; incorrect flags can be dismissed with reasons; candidates can appeal; recruiters are trained on failure modes before getting access.
**Personas:** Recruiter, Candidate, Admin
**PRD Coverage:** FR-66, FR-67, FR-68, FR-69, FR-70, FR-71, FR-72, FR-74, FR-75, CR-17, CR-18
**Priority:** Core
**Dependencies:** E-006 (reports)
**Definition of Done:**
- [ ] Judge-first enforced (cannot skip)
- [ ] Dismissal requires reason (both confirm and dismiss)
- [ ] Candidate appeal creates case with 48h SLA
- [ ] Onboarding blocks integrity access until complete
**Estimated Stories:** 6

### Story S-041: Judge-first workflow enforcement

**Epic:** E-007 | **PRD Ref:** FR-66, FR-67, FR-68, CR-17 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As a recruiter, I want to record my own assessment first so that the AI doesn't anchor my judgment.

**Acceptance Criteria:**
- [ ] AC-1: Given a recruiter opening a completed report, when they reach the integrity section, then the AI panel is collapsed by default and they must select Advance / Hold / Reject with a one-sentence reason before proceeding.
- [ ] AC-2: Given the judgment is recorded, when they click "Show AI observations", then the panel expands (per-reviewer scope — each reviewer's judgment is independently recorded per Sumanth's decision).
- [ ] AC-3: Given a recorded judgment X and AI observations suggesting Y, when viewed, then the UI prompts for reflection and the response (or "no change") is logged with both judgments to `judgments` + `judgment_history`.
- [ ] AC-4: Given a session with zero integrity events, when the report opens, then no AI panel is shown — just "No integrity observations recorded for this session."
- [ ] AC-5 (Security): Given a direct API call to the observations endpoint without a recorded judgment, when attempted, then API returns `403 JUDGMENT_REQUIRED`.
- [ ] AC-6 (Compliance): Given any AI-generated score, when the recruiter views it, then no "auto-advance" or "auto-reject" control exists anywhere in the UI; an automated test fails the build if any code path bypasses human decision (CR-17 — no fully automated hiring decisions).

**Technical Notes:** `judgments` + `judgment_history` tables (per-reviewer scope). Backend enforces ordering.

**Dependencies:** Requires: S-036 (report), S-038 (observations panel).

---

### Story S-042: Symmetric flag dismissal workflow

**Epic:** E-007 | **PRD Ref:** FR-69, FR-70, FR-71 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 8

**User Story:** As a recruiter, I want to dismiss incorrect flags with a clear reason so that candidates aren't unfairly penalized and the system learns.

**Acceptance Criteria:**
- [ ] AC-1: Given a flag under review, when the recruiter clicks Confirm or Dismiss, then a one-sentence reason is required in both cases (symmetric).
- [ ] AC-2: Given the review screen, when opened, then all evidence is pre-assembled: observation, timestamped video clips, interview context, signal-quality notes, alternative explanations, base-rate context — no tab-hunting.
- [ ] AC-3: Given any flag, when displayed, then it includes base-rate context in natural frequencies: "Of every 100 flags like this, roughly N reflect real issues" (N from measured PPV, updated quarterly).
- [ ] AC-4: Given the dismissal, when confirmed, then the record goes to `integrity_event_reviews` (append-only, owned by IntegrityService) with reviewer identity, timestamp, evidence snapshot, and reason.

**Technical Notes:** `AppealService` (3.22) handles dismissal as a review case type. Video clip extraction is the heaviest lift here.

**Dependencies:** Requires: S-041 (judge-first before dismissal).

---

### Story S-043: Candidate appeal case creation (NEW — split)

**Epic:** E-007 | **PRD Ref:** FR-74 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As a candidate, I want to appeal if I believe something was unfair so that I get a human review.

**Context:** Split from original S-043. This story covers case creation + evidence assembly; S-043b covers SLA tracking + escalation.

**Acceptance Criteria:**
- [ ] AC-1: Given a candidate viewing their report, when they click "Request Review", then an `appeal_cases` record is created with `case_type` (integrity | feedback | technical | fairness) and the recruiter sees the evidence AND the candidate's written explanation side by side.
- [ ] AC-2: Given a dismissed integrity flag, when confirmed, then the flag is removed from the candidate's visible record and the dismissal feeds FP tracking.
- [ ] AC-3 (Error): Given a duplicate appeal for the same event, when submitted, then API returns `409 APPEAL_ALREADY_OPEN` with a link to the existing case.

**Technical Notes:** `AppealService` (3.22) with `case_type` column (single system per architecture decision).

**Dependencies:** Requires: S-037 (candidate report with Request Review button), S-042 (dismissal infra).

---

### Story S-043b: Appeal SLA tracking and escalation (NEW — split)

**Epic:** E-007 | **PRD Ref:** FR-74, CR-18 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As the platform, I need appeal SLAs tracked and breached cases escalated so that candidates aren't left waiting.

**Context:** Split from original S-043. Also serves S-045 (human review requests use the same SLA engine).

**Acceptance Criteria:**
- [ ] AC-1: Given an integrity appeal, when created, then SLA is 48 hours; given any other appeal type, SLA is 5 business days (Sumanth's single-system/two-tier decision).
- [ ] AC-2: Given SLA breach, when the deadline passes without action, then the case auto-escalates to platform admin with full context.
- [ ] AC-3: Given the escalation, when triggered, then the original recruiter and the candidate are both notified of the escalation.

**Technical Notes:** Scheduled SLA-check job. Business-day calculation excludes weekends + configurable holidays.

**Dependencies:** Requires: S-043.

---

### Story S-044: Recruiter integrity onboarding (failure-mode-first)

**Epic:** E-007 | **PRD Ref:** FR-72 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 8

**User Story:** As a new recruiter, I want to understand where the integrity system fails so that I use it responsibly from day one.

**Acceptance Criteria:**
- [ ] AC-1: Given a new recruiter, when they attempt to access integrity features, then they must complete onboarding: (1) What detectors measure (5 min), (2) Base rate — most flags are benign (3 min), (3) Known failure modes and blind spots (5 min), (4) 3–5 judge-first practice cases with feedback (10 min), (5) Override expectations (2 min).
- [ ] AC-2: Given incomplete onboarding, when they try to access integrity features, then API returns `403 ONBOARDING_REQUIRED` and the UI blocks with a resume-onboarding link.
- [ ] AC-3: Given completion, when 90 days elapse, then a quarterly "blind" refresher case (AI support withheld) is required to maintain access (tracked in `onboarding_refreshers`).
- [ ] AC-4: Given the content modules, when reviewed by the content checklist, then each module includes ≥2 documented failure modes with example cases (verified by content review — "AI 101" alone is insufficient per research).

**Technical Notes:** `recruiter_onboarding` table. Content is static + interactive practice cases (pre-built).

**Dependencies:** Requires: S-041 (practice cases use judge-first UI).

---

### Story S-045: "Request human review" (general AI decisions)

**Epic:** E-007 | **PRD Ref:** CR-18 | **PRD Version:** 3.2 | **Priority:** Important | **Points:** 3

**User Story:** As a candidate affected by an AI-influenced decision, I want a human to review it so that I'm not subject to purely automated judgment.

**Acceptance Criteria:**
- [ ] AC-1: Given any candidate-facing AI-influenced decision, when the candidate clicks "Request human review", then the case routes to a human reviewer (not the original AI pipeline) via the same `appeal_cases` system with `case_type: "human_review"`.
- [ ] AC-2: Given the review, when the human reviewer opens the case, then they see the full evidence, not just the score.
- [ ] AC-3: Given the SLA, when tracked, then it is 5 business days (via S-043b SLA engine).

**Technical Notes:** Reuses `AppealService` — CR-18 mapped onto the single appeal system.

**Dependencies:** Requires: S-043, S-043b.

---

## Epic E-008: AI Observer (Human Interviews)

**Goal:** Recruiters can toggle an invisible AI observer for human interviews that passively monitors and produces behavioral + integrity analysis alongside human feedback.
**Personas:** Recruiter, Candidate (passive participant), Interviewer
**PRD Coverage:** FR-82, FR-83, FR-84, FR-85, FR-86
**Priority:** Important (differentiator, but not launch-blocking for AI modes)
**Dependencies:** E-001 (LiveKit rooms), E-004 (integrity pipeline), E-005 (behavioral analysis), E-006 (reporting)
**Definition of Done:**
- [ ] Observer bot joins invisibly when enabled
- [ ] Observer never interrupts (verified by test)
- [ ] Side-by-side report renders correctly
- [ ] Recruiter can disable observer (no report generated)
**Estimated Stories:** 4

### Story S-046: Observer toggle in interview setup

**Epic:** E-008 | **PRD Ref:** FR-82 | **PRD Version:** 3.2 | **Priority:** Important | **Points:** 2

**User Story:** As a recruiter, I want to toggle the AI Observer for my human interviews so that I control when AI analysis is applied.

**Acceptance Criteria:**
- [ ] AC-1: Given a recruiter creating a human interview, when they reach settings, then they see an "AI Observer" toggle (default: ON).
- [ ] AC-2: Given the toggle OFF, when the session runs, then no observer bot joins and no observer report is generated.
- [ ] AC-3: Given the toggle state, when saved, then it is recorded in session metadata (`config.observer_enabled`).

**Technical Notes:** Simple UI toggle + config flag.

**Dependencies:** Requires: S-001.

---

### Story S-047: Invisible observer bot (LiveKit)

**Epic:** E-008 | **PRD Ref:** FR-83, FR-84, FR-86 | **PRD Version:** 3.2 | **Priority:** Important | **Points:** 8

**User Story:** As the platform, I need an invisible AI participant in human interviews so that behavioral analysis runs without disrupting the conversation.

**Acceptance Criteria:**
- [ ] AC-1: Given a human interview with observer enabled, when the LiveKit room starts, then a bot joins with identity `ai-observer-{sessionId}`, subscribe-only (no audio/video tracks published), invisible in participant UI.
- [ ] AC-2: Given participants in the room, when roles are resolved, then `candidate-{userId}` is the analysis target (full behavioral + integrity) and `interviewer-{userId}` is tracked for diarization only; room metadata is fallback on prefix mismatch (logged).
- [ ] AC-3: Given an active interview, when the observer detects signals, then it records them silently — it never speaks, never issues challenges, never interrupts (verified by automated test: zero published tracks, zero data channel messages from observer identity).
- [ ] AC-4 (Reliability): Given a deploy during an active observed session, when the web dyno restarts, then the observer worker (separate process, `workers/ai-observer/`, driven by `observer_jobs` table) continues uninterrupted.

**Technical Notes:** `AI Observer Worker` (3.19) as separate Render worker. Builds on existing `agents/voice-interviewer/worker.mjs` muted `runObserver` Track B (found in Phase 0).

**Dependencies:** Requires: S-008 (LiveKit rooms), S-046.

---

### Story S-048: Observer consent disclosure

**Epic:** E-008 | **PRD Ref:** FR-85 | **PRD Version:** 3.2 | **Priority:** Important | **Points:** 2

**User Story:** As a candidate in a human interview, I want to know AI analysis may occur so that I'm informed (without a separate consent screen).

**Acceptance Criteria:**
- [ ] AC-1: Given a candidate joining a human interview with observer enabled, when they reach consent, then they see: "This session may include AI-assisted analysis of the conversation to help the recruiter. [Learn more]" — part of general consent flow, not a standalone screen (per Sumanth's decision).
- [ ] AC-2: Given observer disabled, when the candidate reaches consent, then no AI disclosure is shown.

**Technical Notes:** Conditional consent text block based on `config.observer_enabled`.

**Dependencies:** Requires: S-010 (consent screens), S-046.

---

### Story S-049: Observer analysis report generation

**Epic:** E-008 | **PRD Ref:** FR-86 | **PRD Version:** 3.2 | **Priority:** Important | **Points:** 5

**User Story:** As the platform, I need to generate the AI Observer's analysis so that it appears in the side-by-side report.

**Acceptance Criteria:**
- [ ] AC-1: Given a completed observed human interview, when analysis runs, then behavioral signals + integrity observations for the candidate are computed (same pipeline as E-004/E-005, scoped to candidate identity).
- [ ] AC-2: Given the analysis, when stored, then it goes to `ai_observer_reports` (unique per session) with `analysis` JSONB + `integrity_summary` JSONB.
- [ ] AC-3: Given the report, when rendered, then the observer analysis appears in the "AI Observer Analysis" column (rendered by S-039).

**Technical Notes:** Observer worker writes to `ai_observer_reports` on session end. Reuses `AnalysisService` and `IntegrityService` with candidate-identity scoping.

**Dependencies:** Requires: S-047, S-034 (behavioral fusion), S-027 (integrity fusion). Blocks: S-039 (side-by-side report needs this data — build S-049 before S-039 within the sprint).

---

## Epic E-009: Metering, Billing, Admin & Observability

**Goal:** Usage is metered by tier, overage and PAYG billing work, admins can monitor integrity health, and the system alerts on anomalies.
**Personas:** Recruiter (billing), Admin/Operator
**PRD Coverage:** FR-55, FR-73, FR-76, FR-77, FR-78
**Priority:** Important (metering must exist before paid launch)
**Dependencies:** E-001 (session creation hooks for metering)
**Definition of Done:**
- [ ] Tier limits enforced (block + upgrade prompt)
- [ ] India PAYG charges correctly with geo-fencing
- [ ] Integrity metrics dashboard shows all 6 metric groups
- [ ] Anomaly alerts fire correctly
**Estimated Stories:** 6

### Story S-050: Tier-based interview metering

**Epic:** E-009 | **PRD Ref:** FR-76 | **PRD Version:** 3.2 | **Priority:** Core | **Points:** 5

**User Story:** As the business, I need to enforce interview limits by tier so that free users can't exceed their allocation.

**Acceptance Criteria:**
- [ ] AC-1: Given a recruiter on Free (5 screening/mo), Starter (50/mo), or Professional (300/mo), when they attempt to start an interview beyond their limit, then the system blocks with "Monthly interview limit reached. Upgrade or wait until [reset date]." (`402 TIER_LIMIT_REACHED` with `reset_at`).
- [ ] AC-2: Given usage tracking, when checked, then `usage_metering` records per-recruiter, per-billing-period counts.
- [ ] AC-3: Given mock interviews, when counted, then they are always unlimited and unmetered.

**Technical Notes:** `MeteringService` (3.23). Check in `SessionService.create()`. `usage_metering` + `overage_tokens` tables.

**Dependencies:** Requires: S-001 (hook into session creation). Blocks: S-040 (tier-gated evidence needs metering — build S-050 before S-040).

---

### Story S-051: India pay-as-you-go billing

**Epic:** E-009 | **PRD Ref:** FR-77 | **PRD Version:** 3.2 | **Priority:** Important | **Points:** 5

**User Story:** As an Indian recruiter, I want to pay per interview without a subscription so that I can try the platform with minimal commitment.

**Acceptance Criteria:**
- [ ] AC-1: Given an Indian recruiter (billing country = India), when they choose pay-as-you-go, then they are charged ₹199 per completed interview (any mode) with no monthly commitment.
- [ ] AC-2: Given a non-Indian billing country, when they attempt to access India PAYG, then API returns `403 GEO_PRICING_BLOCKED`.
- [ ] AC-3: Given a completed PAYG interview, when billing runs, then the charge is processed via Razorpay (fallback) or Stripe INR.

**Technical Notes:** Geo-fencing on billing country (from payment provider customer record, not IP). Idempotency keys on charges.

**Dependencies:** Requires: S-050 (metering infra).

---

### Story S-052: Overage billing with confirmation

**Epic:** E-009 | **PRD Ref:** FR-78 | **PRD Version:** 3.2 | **Priority:** Important | **Points:** 3

**User Story:** As a subscriber who exceeded my limit, I want to pay for extra interviews with clear confirmation so that I'm never surprised by charges.

**Acceptance Criteria:**
- [ ] AC-1: Given a paid subscriber over their tier limit, when they start an additional interview, then they see "This will incur a $1.50 overage charge. Continue?" and must confirm.
- [ ] AC-2: Given confirmation, when the interview starts, then the overage is recorded with an Idempotency-Key (`409 IDEMPOTENCY_KEY_REUSED` on key+payload mismatch).
- [ ] AC-3: Given the charge, when processed, then it appears on the next invoice as a line item.

**Technical Notes:** `OVERAGE_CONFIRMATION_REQUIRED` (402) when over limit without confirmation.

**Dependencies:** Requires: S-050.

---

### Story S-053a: Integrity metrics dashboard — core (NEW — split)

**Epic:** E-009 | **PRD Ref:** FR-73 (partial) | **PRD Version:** 3.2 | **Priority:** Important | **Points:** 5

**User Story:** As a platform admin, I want to see core integrity health metrics so that I can spot problems at a glance.

**Context:** Split from original S-053. This covers the dashboard skeleton + the three highest-signal metrics; S-053b covers the rest + audit sampling.

**Acceptance Criteria:**
- [ ] AC-1: Given an admin user, when they open the integrity dashboard, then they see: Flag rate (% sessions with ≥1 flag, alert if >15%), Dismissal rate (healthy 30–70%, alert if <20%), Subgroup flag ratio (alert if >2× baseline).
- [ ] AC-2: Given the metrics, when filtered, then they are filterable by mode, date range, and recruiter.

**Technical Notes:** `IntegrityMetricsService` (3.24). `integrity_alerts` table for alert history.

**Dependencies:** Requires: S-029 (events), S-042 (reviews).

---

### Story S-053b: Integrity metrics — advanced + audit sampling (NEW — split)

**Epic:** E-009 | **PRD Ref:** FR-73 (partial) | **PRD Version:** 3.2 | **Priority:** Important | **Points:** 5

**User Story:** As a platform admin, I want deeper integrity analytics and audit sampling so that I can tune the system and verify fairness over time.

**Context:** Split from original S-053.

**Acceptance Criteria:**
- [ ] AC-1: Given the dashboard, when viewed, then it additionally shows: Judge divergence rate (% where AI changed initial judgment), Median time-to-decision (alert if <30s), Positive predictive value (confirmed/total, validated sample).
- [ ] AC-2: Given the quarterly cycle, when due, then a random 5% override audit sample is generated for QA re-review.
- [ ] AC-3: Given aggregate data, when viewed, then per-recruiter confirm/dismiss rates vs. team average are shown (no individual candidate PII).

**Technical Notes:** Extends S-053a dashboard. Audit sample generation is a scheduled job.

**Dependencies:** Requires: S-053a, S-041 (judgments for divergence rate).

---

### Story S-054: Integrity pipeline anomaly alerts

**Epic:** E-009 | **PRD Ref:** FR-55 | **PRD Version:** 3.2 | **Priority:** Important | **Points:** 3

**User Story:** As an admin, I want to be alerted when the integrity system malfunctions so that I can intervene before candidates are affected.

**Acceptance Criteria:**
- [ ] AC-1: Given the integrity pipeline, when error rate exceeds 5% over 1 hour OR processing latency exceeds 2× baseline, then an alert is sent to admins with affected sessions and error details.
- [ ] AC-2: Given the alert, when received, then it includes a link to the relevant dashboard filtered to the affected time window.

**Technical Notes:** Health checks in `IntegrityService`; alerting via existing notification infra. Part of architecture §7 observability.

**Dependencies:** Requires: S-027 (pipeline to monitor).

---

## Sprint Plan (Revised — Honest Capacity)

**Capacity:** ~20 pts per 2-week sprint (single implementer, 1pt ≈ half-day).
**Total:** 59 stories, 322 points, 19 sprints (~38 weeks single-dev).
**Note for Lead (Phase 4):** Parallelize independent tracks to compress. E-002 compliance stories can run parallel to E-001 once S-011's middleware contract is defined. E-008 (observer) is largely independent after Sprint 8.

| Sprint | Focus | Stories | Points |
|--------|-------|---------|--------|
| 1 | Consent foundation | S-010(8), S-011(5), S-056(2), S-057(3) | 18 |
| 2 | Session core | S-001(5), S-002(3), S-003(5), S-014(3) | 16 |
| 3 | Security hardening + media | S-058(5), S-055(5), S-004(5), S-006(3) | 18 |
| 4 | Turn-taking + AI | S-005(8), S-009(5), S-012(3) | 16 |
| 5 | LiveKit + recovery | S-008(8), S-007(5) | 13 |
| 6 | Calibration | S-019(8), S-020(3), S-021(3), S-013a(5) | 19 |
| 7 | Client signals | S-022(8), S-028(5), S-013b(5) | 18 |
| 8 | Deepfake + challenges | S-023a(4), S-023b(4), S-023c(4), S-024(8) | 20 |
| 9 | Fusion + forensics | S-025(5), S-026(5), S-027(8) | 18 |
| 10 | Behavioral measurement | S-029(3), S-031(5), S-032(5), S-033(5) | 18 |
| 11 | Fusion + retention | S-034(5), S-035(3), S-015(5), S-030(3) | 16 |
| 12 | Recruiter reporting | S-036(8), S-038(8) | 16 |
| 13 | Candidate + side-by-side | S-037(8), S-039(5), S-040(3) | 16 |
| 14 | Judge-first + dismissal | S-041(5), S-042(8), S-045(3) | 16 |
| 15 | Appeals + onboarding | S-043(5), S-043b(5), S-044(8) | 18 |
| 16 | Observer | S-046(2), S-047(8), S-048(2), S-049(5) | 17 |
| 17 | Metering + billing | S-050(5), S-051(5), S-052(3), S-054(3) | 16 |
| 18 | DSAR + deletion | S-016a(5), S-016b(5), S-017(8) | 18 |
| 19 | Admin dashboards | S-018(5), S-053a(5), S-053b(5) | 15 |

**Critical path:** Sprints 1–9 (consent → session → calibration → integrity). If velocity lags, defer S-035 (rPPG, Nice-to-Have) and compress E-009.

---

## NFR Coverage

| NFR | Requirement | Owning Story / Activity |
|-----|-------------|------------------------|
| NFR-01 | Voice analysis inference <100ms per turn | S-031 AC-4 (inference <100ms; ≤2s end-to-end per answer) |
| NFR-02 | Turn-taking latency <2s p99 | S-005 (500ms record start + 2s silence detection); load test in Phase 6 (Quinn) |
| NFR-03 | 100 concurrent sessions | Architecture §8; load test in Phase 6 (Quinn) — no single story, QA activity |
| NFR-04 | 99.5% uptime | Infrastructure (Render SLA); monitoring in S-054 |
| NFR-05 | Phones, tablets, laptops | S-004 (device matrix: iPhone Safari, Android Chrome, desktop Chrome/Firefox/Edge) |
| NFR-06 | iOS Safari compatibility | S-004 AC-1 (explicit iPhone Safari coverage) |
| NFR-07 | $0 additional infrastructure | Architecture constraint; verified per-story (no paid services in Technical Notes) |
| NFR-08 | Encryption verified (AES-256, TLS 1.3) | S-057 (automated security scan in CI) |

---

## FR/CR Coverage Check (Revised)

| Requirement | Story |
|-------------|-------|
| FR-01–05 | S-001, S-002, S-003 |
| FR-06–08 | S-004, S-005, S-006 |
| FR-09, FR-14, FR-14a | S-010, S-012 |
| FR-10 | S-024 (all liveness challenges) |
| FR-11, FR-13 | S-013a |
| FR-12 | S-013b |
| FR-15 | S-023a |
| FR-16 | S-023b |
| FR-17, FR-18 | S-023c |
| FR-19 | S-023c AC-3, S-029 |
| FR-20–22 | S-022 |
| FR-23 | S-025 |
| FR-24, FR-25 | S-026 |
| FR-26, FR-27 | S-028 (baseline via S-019) |
| FR-28, FR-29, FR-37 | S-031 |
| FR-30 | S-035 |
| FR-31–34 | S-024 |
| FR-35 | S-027 |
| FR-36 | S-032 |
| FR-38 | S-033 |
| FR-39, FR-40 | S-034 |
| FR-41 | S-031 AC-3, S-032 AC-3 |
| FR-42–46 | S-007 |
| FR-47, FR-50 | S-036 |
| FR-48, FR-79 | S-037 |
| FR-49 | S-039 |
| FR-51 | S-018 |
| FR-52 | S-017 |
| FR-53 | S-015 |
| FR-54 | S-014 |
| FR-55 | S-054 |
| FR-56–58 | S-019, S-020, S-021 |
| FR-59–61 | S-027 |
| FR-62–65 | S-038 |
| FR-66–68 | S-041 |
| FR-69–71 | S-042 |
| FR-72 | S-044 |
| FR-73 | S-053a, S-053b |
| FR-74 | S-043, S-043b |
| FR-75 | S-043 AC-2, S-030 |
| FR-76–78 | S-050, S-051, S-052 |
| FR-80 | S-040 |
| FR-81 | S-009 |
| FR-82–86 | S-046, S-047, S-048, S-049 |
| CR-01 | S-010 |
| CR-02 | S-056 |
| CR-03 | S-057 |
| CR-04 | S-058 |
| CR-05 | S-014 |
| CR-06, CR-13 | S-017 |
| CR-07 | S-015 |
| CR-08 | S-055 |
| CR-09 | Architecture constraint (no third-party biometric sharing; DPA-gated per ADR-010) |
| CR-10 | S-010 AC-5 |
| CR-11 | S-010 AC-6 |
| CR-12 | S-016a, S-016b |
| CR-17 | S-041 AC-6 |
| CR-18 | S-045 |
| CR-21 | S-011 |

**Process/ops items (tracked in pre-launch compliance gate, not code stories):** CR-14 (FTC claims registry — docs/compliance/ai-claims-registry.md), CR-15 (DPIA document — must complete before launch), CR-16 (incident response runbook — 72h breach notification), CR-19 (DPA signing — 8 vendors), CR-20 (Groq ZDR verification — ops task in S-009 AC-4).

**All 86 FRs covered by stories. All 21 CRs covered (16 by stories, 5 by tracked process/ops items).**
