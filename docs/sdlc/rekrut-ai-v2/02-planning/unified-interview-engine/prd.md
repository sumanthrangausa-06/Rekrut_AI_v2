---
project: Unified Interview Engine
version: 2
status: approved
created: 2026-10-10
owner: Sumanth
stepsCompleted: ["step-01-requirements", "step-02-draft", "step-02-fixes"]
---

# Unified Interview Engine — Product Requirements Document

> **Status:** Draft | **Version:** 2 | **Owner:** Sumanth

---

## 1. Overview

The Unified Interview Engine is a single configurable platform that powers all four interview modes at Rekrut AI: Mock Interview (candidate practice), AI Screening (automated voice/video filter), AI Interview (recruiter-triggered deep assessment), and Human Interview (with AI Observer). It replaces fragmented per-mode implementations with one engine, delivering integrity detection (deepfake, AI-assistance, and behavioral), multimodal behavioral analysis, and dual reporting (recruiter + candidate) — all within a $0 infrastructure budget and full biometric data compliance.

---

## 2. Goals and Non-Goals

### Goals

- **One engine, four modes:** A single configurable interview engine supports Mock, Screening, AI Interview, and Human (with AI Observer) end-to-end.
- **Best-in-class integrity:** Detect deepfakes, AI-generated answers, and behavioral cheating better than any existing solution — using evidence-backed, multi-signal analysis.
- **Dual reporting:** Recruiters get detailed assessment + integrity evidence; candidates get qualitative performance feedback.
- **Compliance by design:** GDPR, BIPA, CCPA, and DPDP Act compliance built into the data architecture from day one.

### Non-Goals

- Text-only interviews (all modes are voice + video).
- Autonomous cheating verdicts — integrity output is evidence for human review, never an automated "cheating detected" decision.
- Voice-based deception detection — scientifically discredited; we measure stress/cognitive load only.
- Accessibility accommodations (deferred to post-launch).

---

## 3. Definitions

Concrete definitions for terms used throughout this PRD:

| Term | Definition |
|------|------------|
| **Standard integrity** | Gaze tracking (off-screen detection), face presence monitoring, tab-switch detection. No deepfake or AI-assistance layers. |
| **Advanced integrity** | Standard integrity PLUS: (1) Deepfake detection — screen-flash test, lip-sync verification (phoneme-viseme alignment), AV-sync check (<80ms); (2) AI-assistance detection — reading gaze pattern monitor, response latency tracker, WPM + filler analysis, transcript linguistic forensics; (3) Voice analysis — eGeMAPS 88-feature voice profiling, >2σ deviation flagging, vocal stress measurement; (4) Interactive probing — unscripted follow-up questions when 3+ signals fire in 30 seconds. |
| **Basic behavioral analysis** | Per-answer emotion classification (7 emotions) + overall confidence score. For practice feedback only. |
| **Standard behavioral analysis** | Basic PLUS: voice prosody (pitch, pace, energy), linguistic scoring (specificity, depth). Per-turn scores. |
| **Full behavioral analysis** | Standard PLUS: multimodal fusion with attention weighting (text 85% weight per MIST, face incremental, speech-emotion lowest), temporal behavior transition tracking (confident→nervous shifts), per-turn visual + vocal + linguistic signals stored in `behavioral_signals` table. |
| **Passive integrity** | Monitoring without interrupting. Used in Human Interview mode — AI Observer watches and records but never issues challenges or speaks. |
| **Conservative flagging** | Only flag when confidence ≥0.85 AND 3+ independent signals corroborate within a 30-second window. Target: <2% false positive rate. |
| **Integrity evidence** | Timestamped records in `integrity_events` table: event type, severity, confidence score, supporting signal data. Presented to recruiter as timeline, never as verdict. |

---

## 4. User Personas

### Candidate

- **Goal:** Complete interviews smoothly on any device; receive useful feedback to improve.
- **Pain today:** Fragmented experience across modes; no feedback after AI interviews.
- **Success:** Completes interview without technical issues; receives clear qualitative feedback.

### Recruiter

- **Goal:** Configure interview flows, review candidates efficiently with integrity evidence alongside assessment.
- **Pain today:** No unified view; manual integrity judgment; scattered reports.
- **Success:** One dashboard showing candidate assessment + integrity timeline + AI behavioral insights.

### Human Interviewer

- **Goal:** Conduct natural interviews augmented by AI behavioral analysis.
- **Pain today:** Subjective assessment only; no objective behavioral data.
- **Success:** Receives AI Observer report (behavioral signals, integrity flags) alongside their own evaluation.

### Admin / Operator

- **Goal:** Ensure system health, manage compliance, handle data deletion requests.
- **Pain today:** No centralized compliance dashboard; manual data purge.
- **Success:** Automated retention policies run on schedule; audit logs accessible; deletion requests fulfilled within SLA.

---

## 5. Interview Modes

### 5.1 Mock Interview

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Candidate practice with AI feedback |
| **Trigger** | Candidate self-initiated |
| **Questions** | Standardized practice questions |
| **Integrity** | Minimal (practice mode — no identity verification) |
| **Behavioral analysis** | Basic (for practice feedback) |
| **Candidate sees** | Numerical scores (feeds OmniScore) + qualitative feedback |
| **Recruiter sees** | N/A (practice only, not shared unless candidate opts in) |

### 5.2 AI Screening

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Automated voice/video filter on job application |
| **Trigger** | Auto-sent on apply (per job settings) or recruiter-triggered |
| **Questions** | Standardized per-job-topic template — same for every candidate |
| **Identity verification** | Face match + liveness + government ID photo |
| **Integrity** | Standard (gaze, face presence, tab switch) |
| **Behavioral analysis** | Standard |
| **Candidate sees** | No formal report, but qualitative feedback may be shared (e.g., "Strong communication skills") |
| **Recruiter sees** | Match score + full screening report + integrity flags + transcript |

### 5.3 AI Interview

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Deep personalized assessment |
| **Trigger** | Recruiter-triggered per candidate |
| **Questions** | Personalized from JD + resume + role; adaptive follow-ups probing actual experience |
| **Identity verification** | Face match + liveness + government ID photo |
| **Integrity** | Advanced (full deepfake + AI-assistance + behavioral layers) |
| **Behavioral analysis** | Full (visual + vocal + linguistic + fused) |
| **Turn-taking** | Automatic — AI speaks → auto-record → silence detection → auto-submit → AI responds |
| **Candidate sees** | Qualitative feedback only (no numerical scores) |
| **Recruiter sees** | Full assessment + integrity evidence timeline + behavioral analysis |

### 5.4 Human Interview (with AI Observer)

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Human-led interview augmented by AI analysis |
| **Trigger** | Recruiter schedules via calendar |
| **AI Observer** | LiveKit bot (`ai-observer-{sessionId}`) joins as invisible participant |
| **Role detection** | Identity prefix (`candidate-` / `interviewer-`) + room metadata |
| **Integrity** | Passive only — monitors, never interrupts human conversation |
| **Behavioral analysis** | Full on candidate (same as AI Interview); interviewer tracked for diarization only |
| **Candidate sees** | Qualitative feedback (human + AI combined, no raw scores) |
| **Recruiter sees** | Human interviewer feedback + AI behavioral analysis side by side |

---

## 6. Functional Requirements

### 6.1 Session Management

**User Story:** As a recruiter, I want to create interview sessions for different modes so that I can assess candidates through the appropriate interview type.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-01 | System SHALL support creating interview sessions of type: `mock`, `screening`, `ai-interview`, `human` | **Given** a recruiter with valid permissions **When** they create a session with `type: "ai-interview"` **Then** the session is created with AI Interview defaults **And** the type is immutable after creation |
| FR-02 | System SHALL store session configuration as validated JSON (Zod schema per mode) | **Given** a session creation request **When** the config JSON fails Zod validation for the session type **Then** the API returns 400 with specific validation errors **And** no session is created |
| FR-03 | System SHALL support invite tokens for candidate access | **Given** a created session **When** the recruiter requests an invite link **Then** a unique token URL is generated **And** the token expires after 7 days or single use (whichever comes first) |
| FR-04 | System SHALL track session lifecycle: `invited` → `in_progress` → `paused` → `completed` / `abandoned` | **Given** a session in `in_progress` state **When** the candidate closes the browser **Then** the session transitions to `paused` within 60 seconds **And** partial progress is saved |
| FR-05 | System SHALL auto-save partial progress on interruption | **Given** a session with 5 of 10 questions answered **When** an interruption occurs **Then** all 5 answers, transcripts, and behavioral data are persisted **And** resume is possible from question 6 |

### 6.2 Voice & Video

**User Story:** As a candidate, I want the interview to work on my phone/laptop with automatic turn-taking so I can focus on answering, not managing the microphone.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-06 | System SHALL support camera + microphone on phones, tablets, and laptops | **Given** a candidate on iPhone Safari, Android Chrome, or desktop Chrome/Firefox/Edge **When** they join an interview **Then** camera and microphone initialize within 5 seconds **And** video renders at ≥15fps |
| FR-07 | AI Interview SHALL use automatic turn-taking (no manual mic toggle) | **Given** an active AI Interview **When** the AI finishes speaking **Then** recording starts automatically within 500ms **And** when the candidate stops speaking for 2 seconds **Then** the answer auto-submits **And** no mic button is shown |
| FR-08 | System SHALL perform pre-flight checks (camera, mic, internet, display) before session start | **Given** a candidate joining a session **When** pre-flight checks run **Then** each check shows pass/fail status **And** if any check fails, the candidate sees specific remediation steps **And** they cannot start until all checks pass or they explicitly skip (with warning logged) |
| FR-09 | System SHALL obtain explicit recording consent before capturing any media | **Given** a candidate who has passed pre-flight **When** they reach the consent screen **Then** they see what will be recorded (video, audio) and why **And** recording does not start until they click "I consent" **And** declining prevents session start |

### 6.3 Identity Verification (AI Screening + AI Interview)

**User Story:** As a recruiter, I want to verify the candidate's identity so that I know the person interviewing is who they claim to be.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-10 | System SHALL perform liveness check at session start (gaze challenge: "look left, look right") | **Given** a session requiring identity verification **When** the liveness challenge runs **Then** the AI voice instructs the candidate **And** gaze direction is verified via MediaPipe iris tracking **And** the check passes if gaze follows instructions within 10 seconds |
| FR-11 | System SHALL perform face match between government ID photo and live video | **Given** a candidate who uploaded their ID **When** face matching runs **Then** a similarity score (0-100) is computed **And** scores ≥80 are auto-accepted **And** scores 60-79 are flagged for recruiter review **And** scores <60 block the session |
| FR-12 | System SHALL extract face embedding from ID photo and **delete the image within 24 hours** | **Given** a completed ID verification **When** 24 hours elapse **Then** the raw ID image is irreversibly deleted from all storage including backups **And** only the embedding vector and match score remain **And** deletion is logged in the audit trail |
| FR-13 | System SHALL store only: match score (0-100), timestamp, ID type — never ID number, address, or DOB | **Given** an ID verification result **When** data is persisted **Then** the database contains only: score, timestamp, ID type (e.g., "passport", "driver_license") **And** a database query confirms no ID number, address, or DOB fields exist |
| FR-14 | System SHALL present separate consent screens for: interview recording, biometric analysis, ID verification | **Given** a candidate starting verification **When** they reach consent **Then** they see 3 separate screens (not bundled) **And** each has independent Accept/Decline **And** declining any one shows the consequence (e.g., "Without biometric consent, you can opt for a human interview instead") |
| FR-14a | If candidate declines biometric consent, system SHALL offer human interview as alternative; recruiter decides whether to proceed | **Given** a candidate who declined biometric consent **When** they choose the human interview option **Then** the recruiter is notified **And** the recruiter dashboard shows "Candidate declined biometric consent — human interview requested" **And** the recruiter can approve or decline |

### 6.4 Integrity Layer — Deepfake Detection

**User Story:** As a recruiter, I want to know if the candidate's video is AI-generated so that I don't evaluate a fake person.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-15 | System SHALL run passive screen-flash test during interview (subtle hue shift, measure facial light response in 1-4 frames) | **Given** an active AI Interview **When** the screen-flash test triggers (random, 2-3 times per session) **Then** the page background shifts hue for <200ms **And** facial pixel hue change is measured **And** real faces show response within 4 frames **And** the candidate is not notified (passive) |
| FR-16 | System SHALL verify lip-sync using phoneme-viseme alignment | **Given** an active interview with audio + video **When** lip-sync verification runs (every 30 seconds) **Then** mouth shapes are compared to expected phonemes from audio **And** misalignment >150ms sustained for >5 seconds creates an integrity event |
| FR-17 | System SHALL check audio-visual sync (offset must be <80ms) | **Given** an active interview **When** AV-sync is measured **Then** the offset between audio onset and corresponding lip movement is calculated **And** offsets >80ms sustained for >10 seconds trigger a gaze-based liveness challenge |
| FR-18 | System SHALL issue gaze-based liveness challenges when AV-sync anomaly detected | **Given** an AV-sync anomaly **When** the system issues a challenge **Then** the AI says "Quick check — could you look directly at the camera?" **And** gaze compliance is verified within 10 seconds **And** the event is logged regardless of outcome |
| FR-19 | System SHALL treat all deepfake signals as evidence for human review, never as autonomous verdicts | **Given** any deepfake signal fires **When** the system processes it **Then** an integrity event is created with confidence score **And** the interview continues uninterrupted **And** no message is shown to the candidate **And** the recruiter sees it as "evidence" not "verdict" |

### 6.5 Integrity Layer — AI-Assistance Detection

**User Story:** As a recruiter, I want to know if the candidate is reading AI-generated answers so that I can assess their genuine ability.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-20 | System SHALL continuously monitor reading-like gaze patterns (repeated left-to-right sweeps) | **Given** an active interview **When** the candidate's gaze shows >3 left-to-right sweeps within 10 seconds **Then** a reading-pattern signal is recorded with timestamp **And** the signal includes sweep count, duration, and gaze coordinates |
| FR-21 | System SHALL track response latency anomalies (extended pause → fluent delivery pattern) | **Given** a completed answer **When** the pause before answering was >8 seconds AND the answer delivery was fluent (WPM >130, <2 fillers) **Then** a latency anomaly signal is recorded **And** the pause duration and WPM are stored |
| FR-22 | System SHALL analyze speech rate consistency and filler word absence (WPM + "um/uh" counter) | **Given** a completed answer **When** WPM is calculated **Then** if WPM >140 AND filler count = 0 AND answer length >50 words **Then** a zero-hesitation signal is recorded **And** the transcript segment is flagged for linguistic review |
| FR-23 | System SHALL perform transcript linguistic forensics post-interview (formulaic patterns, robotic completeness, specificity scoring) | **Given** a completed interview transcript **When** forensics analysis runs **Then** it checks for: formulaic transitions ("firstly," "furthermore," "in conclusion"), robotic completeness (covers all angles with zero gaps), specificity score (named tools/dates/numbers/people) **And** produces a per-answer AI-likelihood score (0-100) |
| FR-24 | System SHALL trigger interactive probing (unscripted follow-up questions) when 3+ behavioral signals fire within 30 seconds | **Given** 3+ signals (any combination of FR-20, FR-21, FR-22) within a 30-second window **When** the threshold is reached **Then** the AI generates an unscripted follow-up question targeting the suspicious answer **And** the probe is logged as "integrity probe" (not shown as such to candidate) |
| FR-25 | Probing questions SHALL feel conversational, never accusatory | **Given** a triggered probe **When** the AI speaks the follow-up **Then** it uses natural language (e.g., "Interesting — can you walk me through that differently?") **And** it NEVER uses words like "suspicious," "verify," "confirm," or "check" **And** the candidate experience is indistinguishable from a normal follow-up |

### 6.6 Integrity Layer — Voice Analysis

**User Story:** As a recruiter, I want voice consistency analysis so that I can detect if a different person is speaking or if voice cloning is used.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-26 | System SHALL extract eGeMAPS 88-feature voice profile from first 60 seconds (baseline) | **Given** the start of an interview **When** the candidate speaks for 60 seconds **Then** 88 eGeMAPS acoustic features are extracted **And** stored as the baseline voice profile **And** extraction completes within 5 seconds of the 60-second mark |
| FR-27 | System SHALL flag voice deviations >2 standard deviations from baseline (possible voice switch) | **Given** an established baseline **When** a subsequent answer's voice features deviate >2σ on 3+ features **Then** a voice-deviation integrity event is created **And** the event includes which features deviated and by how much |
| FR-28 | System SHALL measure vocal stress indicators (F0 increase, intensity increase) for **stress/cognitive load only** | **Given** an active interview **When** vocal stress is measured per answer **Then** F0, intensity, and speech rate are tracked **And** the output is labeled "stress level" or "cognitive load" **And** the words "deception," "lying," or "dishonesty" NEVER appear in any output |
| FR-29 | System SHALL NEVER present voice analysis as deception detection | **Given** any voice analysis output **When** reviewed for compliance **Then** no UI element, report, API response, or log contains deception-related claims about voice **And** automated tests verify this on every build |
| FR-30 | System SHALL estimate heart rate via remote PPG (facial video) as supplementary signal only | **Given** an active interview with face visible **When** remote PPG runs **Then** heart rate is estimated from facial skin color changes **And** the estimate includes a confidence interval **And** it is labeled "supplementary" in all outputs **And** it NEVER triggers integrity events alone |

### 6.7 Integrity Challenges

**User Story:** As a candidate, I want integrity checks to feel like natural parts of the interview so that I don't feel accused of cheating.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-31 | System SHALL issue liveness challenge at session start (framed as "setup check") | **Given** a session requiring verification **When** the liveness challenge starts **Then** the AI says "Before we begin, a quick setup check — please look to your left... now to your right" **And** an on-screen arrow guides the candidate **And** the word "verification" or "security check" is not used |
| FR-32 | System SHALL support challenge types: gaze verification, number reading, workspace show, comprehension probe, dot-following | **Given** the challenge system **When** a challenge is selected **Then** it is one of the 5 supported types **And** each type has a defined pass/fail criterion **And** new types can be added without code changes (config-driven) |
| FR-33 | Failed challenge SHALL trigger a second challenge (not interview termination) | **Given** a failed liveness challenge **When** the failure is detected **Then** the AI says "Let me try that once more" and issues a different challenge type **And** the interview does not pause or terminate **And** the first failure is logged |
| FR-34 | Two failed challenges SHALL create a silent flag for recruiter review; interview continues normally | **Given** two consecutive failed challenges **When** the second failure occurs **Then** a high-severity integrity event is created **And** the interview proceeds to the first question normally **And** the candidate receives no indication of the flag |
| FR-35 | System SHALL use conservative flagging: high-confidence only, no false positives | **Given** any integrity signal **When** evaluating whether to create a flag **Then** the signal confidence must be ≥0.85 **And** 3+ independent signals must corroborate within 30 seconds **And** the target false positive rate is <2% |

### 6.8 Behavioral Analysis

**User Story:** As a recruiter, I want behavioral insights (confidence, communication style, engagement) so that I can assess soft skills objectively.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-36 | System SHALL analyze facial expressions (7 basic emotions) per answer turn | **Given** a completed answer with video **When** facial analysis runs **Then** the 7 emotions (happy, sad, angry, surprised, fearful, disgusted, neutral) are scored 0-100 **And** the dominant emotion is identified **And** processing completes within 2 seconds of answer end |
| FR-37 | System SHALL analyze voice prosody (pitch, pace, energy, stress indicators) | **Given** a completed answer with audio **When** prosody analysis runs **Then** pitch range, speech rate, energy level, and stress indicators are computed **And** results are stored in `behavioral_signals` with modality=`vocal` |
| FR-38 | System SHALL analyze linguistic content (STAR structure, specificity, depth) | **Given** a completed answer transcript **When** linguistic analysis runs **Then** STAR components are identified (Situation, Task, Action, Result) **And** specificity is scored (0-100 based on named entities, numbers, concrete details) **And** depth is assessed (surface vs. substantive) |
| FR-39 | System SHALL fuse multimodal signals with attention weighting | **Given** visual, vocal, and linguistic signals for an answer **When** fusion runs **Then** text/linguistic signals receive highest weight (per MIST: ~85% unimodal accuracy) **And** speech-emotion receives lowest weight (~44%) **And** the fused score includes per-modality contributions for transparency |
| FR-40 | System SHALL track temporal behavior transitions (e.g., confident → nervous shifts) | **Given** a completed interview **When** transition analysis runs **Then** significant emotion/confidence shifts between consecutive answers are identified **And** transitions are listed in the recruiter report with timestamps (e.g., "Confidence dropped from 80 to 45 between Q3 and Q4") |
| FR-41 | Behavioral scores SHALL show "N/A" or "Insufficient data" when confidence is low — never fake scores | **Given** a behavioral signal with confidence <0.5 **When** the report is generated **Then** the score displays "Insufficient data" **And** no numerical score is shown **And** no placeholder (e.g., 50/100) is used |

### 6.9 Camera/Voice Failure Recovery

**User Story:** As a candidate, I want to recover from technical issues without losing my progress so that a glitch doesn't ruin my interview.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-42 | On camera/mic failure, system SHALL pause the session and prompt candidate to fix the issue | **Given** an active interview **When** camera or mic signal is lost for >5 seconds **Then** the session auto-pauses **And** the candidate sees "We lost your [camera/microphone]. Please check your device and click Resume." **And** the AI stops speaking/listening |
| FR-43 | System SHALL allow resume from last completed question after fix | **Given** a paused session with 5 questions completed **When** the candidate fixes the issue and clicks Resume **Then** the interview resumes at question 6 **And** all prior answers and data are intact |
| FR-44 | If unresolvable, system SHALL allow reschedule via new recruiter invite | **Given** a paused session where the candidate cannot fix the issue **When** they click "Reschedule" **Then** the recruiter is notified with the partial session details **And** the recruiter can send a new invite |
| FR-45 | Recruiter SHALL choose on reschedule: Resume (from last question) or Restart (fresh session) | **Given** a reschedule request **When** the recruiter creates the new invite **Then** they see options: "Resume from question 6" or "Start fresh" **And** their choice is recorded in the new session's metadata |
| FR-46 | Report SHALL always disclose technical interruptions | **Given** a completed session with interruptions **When** the report is generated **Then** a "Session Notes" section lists each interruption with timestamp and duration **And** for resumed sessions: "Session resumed after technical interruption at [timestamp]" |

### 6.10 Reporting

**User Story:** As a recruiter, I want a comprehensive report with assessment scores and integrity evidence so that I can make informed hiring decisions.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-47 | System SHALL generate recruiter report: full assessment scores + integrity evidence timeline + behavioral analysis + transcript | **Given** a completed interview **When** the recruiter opens the report **Then** they see: (1) Assessment scores by category, (2) Integrity timeline with all events and confidence levels, (3) Behavioral analysis per answer, (4) Full transcript with speaker labels and timestamps **And** the report loads within 3 seconds |
| FR-48 | System SHALL generate candidate report: qualitative feedback only — except Mock (scores). AI Screening SHALL NOT share a formal report but MAY share qualitative feedback (no scores, no integrity details). | **Given** a completed AI Interview **When** the candidate views their report **Then** they see qualitative feedback (strengths, areas to improve) **And** no numerical scores are displayed **Given** a completed Mock Interview **When** the candidate views their report **Then** they see numerical scores + qualitative feedback **Given** a completed AI Screening **When** the candidate views feedback **Then** they see qualitative feedback only (e.g., strengths observed) **And** no formal report, no scores, and no integrity details are shared |
| FR-49 | Human Interview report SHALL show human interviewer feedback + AI Observer analysis side by side | **Given** a completed human interview **When** the recruiter opens the report **Then** they see two columns: "Interviewer Assessment" (human scores, notes, hire/no-hire) and "AI Observer Analysis" (behavioral signals, integrity flags) **And** discrepancies are highlighted (e.g., "Interviewer rated confidence 8/10; AI measured stress indicators elevated") |
| FR-50 | Reports SHALL disclose all integrity flags as evidence with timestamps and confidence levels | **Given** a report with integrity events **When** the recruiter views the integrity section **Then** each flag shows: timestamp, event type, severity, confidence score (0-100%), supporting signals **And** a disclaimer: "These are observations for your review, not determinations of misconduct" |

### 6.11 Admin / Operator

**User Story:** As an admin, I want to manage compliance and monitor system health so that we meet regulatory requirements and maintain reliability.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-51 | System SHALL provide compliance dashboard showing data retention status | **Given** an admin user **When** they open the compliance dashboard **Then** they see: videos pending deletion (with countdown), biometric data by age bracket, upcoming auto-deletions in next 7 days **And** manual "Delete now" action per item |
| FR-52 | System SHALL process "Delete my data" requests within 30 days | **Given** a candidate clicks "Delete my biometric data" **When** the request is submitted **Then** a ticket is created **And** all biometric data (embeddings, scores, videos, signals) is purged within 30 days **And** the candidate receives confirmation email **And** the purge is logged in the audit trail |
| FR-53 | System SHALL run automated retention purges on schedule | **Given** the retention policy **When** the daily cron runs **Then** videos >90 days past hiring decision are deleted **And** ID images >24 hours old are deleted **And** biometric data >3 years old is deleted **And** each deletion is logged with timestamp and record count |
| FR-54 | System SHALL log every biometric data access with timestamp, user, role, action | **Given** any access to biometric data **When** the access occurs **Then** a log entry is created: `[timestamp] [user_id] [role] [view|delete|export] [data_type] [candidate_id]` **And** logs are immutable (append-only) **And** retained for 7 years |
| FR-55 | System SHALL alert admins on integrity system anomalies | **Given** the integrity pipeline **When** error rate exceeds 5% over 1 hour OR processing latency exceeds 2x baseline **Then** an alert is sent to admins **And** the alert includes affected sessions and error details |

---

## 7. Data Requirements

### 7.1 New Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `integrity_events` | Integrity flag timeline | `interview_session_id` FK, `event_type`, `severity`, `started_at_ms`, `ended_at_ms`, `confidence` DECIMAL(4,3), `details` JSONB |
| `behavioral_signals` | Per-turn behavioral analysis | `interview_session_id` FK, `turn_index`, `modality` (visual/vocal/linguistic/fused), `signal_type`, `score` DECIMAL(5,2), `label`, `confidence` |
| `ai_observer_reports` | AI Observer analysis for human interviews | `interview_session_id` FK (unique), `livekit_room_name`, `observer_identity`, `candidate_identity`, `analysis` JSONB, `integrity_summary` JSONB |
| `session_analysis` | Unified per-question analysis | `interview_session_id` FK, `question_index`, `analysis_data` JSONB, per-category scores |

### 7.2 Data Retention

| Data Type | Retention | Automation |
|-----------|-----------|------------|
| Raw video/audio | Delete 90 days after hiring decision | Daily cron |
| Per-turn raw emotion/stress vectors | Delete 90 days with video | Daily cron |
| ID photo images | Delete within 24 hours of extraction | Hourly check |
| Integrity flag timelines | Indefinite | — |
| Aggregated behavioral scores | Indefinite | — |
| ID match scores | Indefinite | — |
| Biometric data (all) | Max 3 years (BIPA) or when purpose fulfilled | Daily cron |

### 7.3 Data Minimization

- Store face embeddings (vectors), not face images
- Store voice features (F0, intensity), not raw audio (beyond 90 days)
- Store match score, not ID number/address/DOB
- Biometric templates in separate storage from PII

---

## 8. Compliance Requirements

### 8.1 Applicable Regulations

GDPR (EU), BIPA (Illinois), CCPA/CPRA (California), DPDP Act (India)

### 8.2 Compliance Rules

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| CR-01 | System SHALL present 3 separate consent screens (interview, biometric, ID) — never bundled | **Given** a candidate starting verification **When** they proceed through consent **Then** they encounter 3 distinct screens **And** accepting one does not auto-accept others **And** each screen has its own "What we collect / How long / Delete my data" disclosure |
| CR-02 | System SHALL publish biometric retention/destruction policy at `/privacy/biometric-policy` before any collection | **Given** the production deployment **When** accessing `/privacy/biometric-policy` **Then** a publicly accessible page describes: what biometric data is collected, why, retention periods per data type, destruction method, how to request deletion **And** the page exists before any biometric collection occurs |
| CR-03 | System SHALL encrypt biometric templates at rest (AES-256) and in transit (TLS 1.3) | **Given** stored biometric data **When** inspected at the storage layer **Then** all templates are AES-256 encrypted **And** all API transmissions use TLS 1.3 **And** encryption is verified by automated security scan |
| CR-04 | System SHALL segregate biometric data from PII (separate table/encryption key) | **Given** the database schema **When** inspected **Then** biometric templates are in separate tables from `users` **And** use a different encryption key **And** no JOIN can directly link a template to a name/email without going through the session mapping |
| CR-05 | System SHALL log every biometric data access | **Given** any biometric data access **When** it occurs **Then** the audit log records: timestamp, user_id, role, action, data_type, candidate_id **And** logs are append-only |
| CR-06 | System SHALL provide "Delete my data" button → purges all biometric data within 30 days | **Given** a candidate in their dashboard **When** they click "Delete my biometric data" and confirm **Then** all their biometric data is queued for deletion **And** deletion completes within 30 days **And** they receive email confirmation |
| CR-07 | System SHALL auto-delete biometric data at 3-year mark (BIPA) or when purpose fulfilled | **Given** biometric data older than 3 years OR associated hiring decision finalized + 90 days **When** the daily cron runs **Then** the data is irreversibly deleted **And** deletion is logged |
| CR-08 | System SHALL require MFA for admin access to biometric data | **Given** an admin accessing biometric data **When** they authenticate **Then** MFA challenge is required **And** access is denied without successful MFA |
| CR-09 | System SHALL NEVER sell, rent, or share biometric data with third parties | **Given** the system architecture **When** audited **Then** no code path transmits biometric data to third parties except processors with signed DPAs **And** processors receive data in-memory only with no retention |
| CR-10 | DPDP consent notices SHALL be available in English + Hindi | **Given** a candidate with locale set to Hindi **When** they reach consent screens **Then** all consent text is displayed in Hindi **And** the English version is also accessible |

### 8.3 Pre-Launch Compliance Gate

- [ ] Biometric privacy policy published
- [ ] Three granular consent screens implemented and tested
- [ ] Retention automation built (90-day video purge, 3-year biometric purge, 24-hour ID purge)
- [ ] "Delete my data" dashboard functional
- [ ] Encryption at rest verified
- [ ] Access logging implemented
- [ ] BIPA written consent flow tested
- [ ] DPDP consent in English + Hindi
- [ ] DPA signed with any third-party AI provider

---

## 9. Non-Functional Requirements

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| NFR-01 | Real-time voice analysis inference <100ms per turn | **Given** a completed answer **When** voice analysis runs **Then** results are available within 100ms **And** p99 latency is measured and dashboarded |
| NFR-02 | Video analysis frame processing <500ms | **Given** active video stream **When** frames are processed for behavioral analysis **Then** each frame completes within 500ms **And** no frame backlog accumulates |
| NFR-03 | Support 100 concurrent interview sessions | **Given** 100 simultaneous active sessions **When** load tested **Then** all sessions maintain <2s response time for AI turn-taking **And** no session drops |
| NFR-04 | 99.5% uptime for interview sessions | **Given** production deployment **When** measured monthly **Then** interview session availability is ≥99.5% **And** downtime is tracked excluding planned maintenance |
| NFR-05 | Full functionality on phones, tablets, laptops | **Given** each device type **When** running the full interview flow **Then** all features work (camera, mic, AI voice, challenges, behavioral analysis) **And** tested on iPhone, Android, iPad, MacBook, Windows laptop |
| NFR-06 | Browser support: Chrome, Safari (iOS), Firefox, Edge | **Given** each browser **When** running the interview **Then** no browser-specific failures occur **And** automated cross-browser tests pass |
| NFR-07 | $0 additional infrastructure cost | **Given** the production deployment **When** monthly costs are reviewed **Then** no new paid services were added for the interview engine **And** all ML runs in-browser or on existing Render instances |
| NFR-08 | All biometric data encrypted; audit trail for all access | **Given** a security audit **When** biometric data handling is reviewed **Then** encryption is verified at rest and in transit **And** every access has a corresponding audit log entry |

---

## 10. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Integrity false positive rate** | <2% | % of sessions with integrity flags where recruiter determines no misconduct |
| **Deepfake detection accuracy** | >85% AUC | Evaluated on held-out test set quarterly |
| **AI-assistance detection precision** | >70% | % of flagged sessions where recruiter confirms suspicious behavior |
| **Session completion rate** | >90% | % of started sessions that reach completion (excluding candidate abandonment) |
| **Pre-flight pass rate** | >95% | % of candidates who pass pre-flight checks on first attempt |
| **Turn-taking latency** | <2s p99 | Time from candidate silence to AI response |
| **Candidate satisfaction** | >4.0/5.0 | Post-interview survey (AI Interview + Human) |
| **Recruiter report load time** | <3s p99 | Time to render full recruiter report |
| **Compliance audit pass** | 100% | All 9 pre-launch gate items checked |
| **Zero data breaches** | 0 incidents | Any unauthorized biometric data access |

---

## 11. Open Questions — Resolved

| # | Question | Resolution |
|---|----------|------------|
| 1 | Screen flash test — confirm comfort with passive screen hue manipulation | ✅ **Approved** by Sumanth (2026-10-10). Covered under biometric consent. |
| 2 | AI Screening candidate feedback: pass/fail or qualitative? | ✅ **No report shared with candidate.** Recruiter gets match score + full report. |
| 3 | If candidate declines biometric consent — human-only interview path? | ✅ **Candidate may opt for human interview.** Recruiter decides whether to move forward. |

---

## 12. Research References

| Area | Key Sources |
|------|-------------|
| Gaze detection | Frontiers in Education 2026 (F1 0.93); L2CS-Net (3.92° constrained, 10.41° wild) |
| AI-assistance | Canagasuriam & Lukacik 2025 (η²=0.41); BrightHire 2026 (interactive probing most reliable) |
| Voice stress | PLOS ONE 2025 (F0/intensity for stress, NOT deception); NRC 2003 (voice-stress lie detection discredited) |
| Deepfake (active) | GOTCHA (88.6% AUC); Gerstner & Farid (active illumination); Guo et al. (corneal reflection) |
| Lip-sync | LipFD, NeurIPS 2024 (95.3% accuracy, 90.2% real-world) |
| Voice cloning | ElevenLabs: 43% human detection (chance); partial spoof: 22.65% |
| Multimodal | MIST 2025 (74.21% multimodal; text 85% strongest, speech 44% weakest) |
| Physiology | DDPM dataset (remote PPG 3.16 bpm error; heart rate most reliable) |
| Voice prosody | eGeMAPS 88 features; spectral flux dominant marker (confidence/doubt) |
| Compliance | GDPR Art. 9; BIPA §15 ($1K-$5K/violation); DPDP Act 2023 (₹250 crore max) |

Full research: `docs/sdlc/rekrut-ai-v2/01-analysis/technical-research-integrity.md`

---

> **Next:** Step 03 (Finalize) → Sumanth's approval → Phase 3 (Solutioning)
