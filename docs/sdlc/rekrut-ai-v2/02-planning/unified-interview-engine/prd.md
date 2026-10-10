---
project: Unified Interview Engine
version: 3.2
status: approved
created: 2026-10-10
updated: 2026-10-10
owner: Sumanth
analyst: Aria (Business Analyst, smart-sdlc Phase 2)
stepsCompleted: ["step-01-requirements", "step-02-draft", "step-02-fixes", "step-03-v3-update", "step-03-specialist-review", "step-04-oq3-correction"]
change_log:
  v3.1: "OQ-3 contradiction fix (Rex Phase 3 review): §9.2 facial_expression → facial_landmark_displacement, voice_stress → vocal_pitch_variation; FR-37 'stress indicators' → 'vocal variation indicators'; FR-49 example rewritten in observational language; FR-36/39/40 conditional emotion-inference branches collapsed to non-affective path only; §9.7 'Fused integrity' → 'Fused observations' (OQ-2); definitions section scrubbed of emotion-inference language. All FRs now consistent with OQ-3 (observe, don't label) and FR-28/29."
  v3.0: "86 FRs, 21 CRs, 8 NFRs. Incorporated Phase 1 redo findings: 15 must-have compliance items, 8 integrity mitigation recommendations (R1-R8), problem playbook, pricing/packaging requirements, vocabulary appendix (14 event types, 8 signal categories, 5 challenge types, 6 session statuses), Sumanth's new decisions (observer=recruiter tool, warm-up mandatory, manual dismissal, two-sided pricing). Flagged emotion-inference FRs for legal review (EU AI Act Art. 5). Specialist-reviewed by PRD completeness reviewer + compliance requirements reviewer."
  v2.1: "Approved by Sumanth 2026-10-10. 55 FRs, 10 CRs, 8 NFRs."
---

# Unified Interview Engine — Product Requirements Document

> **Status:** Draft v3.1 | **Version:** 3.1 | **Owner:** Sumanth | **Analyst:** Aria
> **Phase Gate:** ✅ APPROVED by Sumanth (2026-10-10). All 8 open questions resolved. Cleared for Phase 3.
> **Change log:** v3.1 fixes OQ-3 contradictions (see frontmatter). v3.0 incorporates Phase 1 redo findings (compliance blueprint, mitigation brief, pricing, Sumanth's new decisions).

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
| **Advanced integrity** | Standard integrity PLUS: (1) Deepfake detection — screen-flash test, lip-sync verification (phoneme-viseme alignment), AV-sync check (<80ms); (2) AI-assistance detection — reading gaze pattern monitor, response latency tracker, WPM + filler analysis, transcript linguistic forensics; (3) Voice analysis — eGeMAPS 88-feature voice profiling, >2σ deviation flagging, vocal variation measurement (never labeled as stress); (4) Interactive probing — unscripted follow-up questions when 3+ signals fire in 30 seconds. |
| **Basic behavioral analysis** | Per-answer non-affective behavioral signals: gaze direction, head pose, blink rate, facial landmark displacement, speech rate, pause patterns, linguistic specificity. **No emotion inference** (OQ-3 resolved: observe, don't label). See FR-36. |
| **Standard behavioral analysis** | Basic PLUS: voice prosody limited to non-affective features (pitch, pace, energy variation, speech rate, pause patterns, intensity variation) — never labeled as stress or emotion. Linguistic scoring (specificity, depth). Per-turn scores. See FR-37, FR-28. |
| **Full behavioral analysis** | Standard PLUS: multimodal fusion with attention weighting (non-affective signals only), temporal behavior transition tracking, per-turn visual + vocal + linguistic signals stored in `behavioral_signals` table. See FR-39, FR-40. |
| **Passive integrity** | Monitoring without interrupting. Used in Human Interview mode — AI Observer watches and records but never issues challenges or speaks. |
| **Conservative flagging** | Only flag when confidence ≥0.85 AND 3+ independent signals corroborate within a 30-second window. Target: <2% false positive rate. |
| **Integrity evidence** | Timestamped records in `integrity_events` table: event type, severity, confidence score, supporting signal data. Presented to recruiter as **observations** in plain language with the footer "This is an observation, not evidence of cheating." Never presented as verdicts. |

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
| **AI Observer** | **Recruiter's tool** — Recruiter opts in/out in interview setup. When enabled, LiveKit bot (`ai-observer-{sessionId}`) joins as invisible participant. **No standalone candidate consent** — observer is disclosed in the general interview consent ("this session may include AI-assisted analysis"). If recruiter disables: no observer joins, no observer report generated. |
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
| FR-04 | System SHALL track session lifecycle: `invited` → `in_progress` → `paused` → `completed` / `abandoned` / `expired` | **Given** a session in `in_progress` state **When** the candidate closes the browser **Then** the session transitions to `paused` within 60 seconds **And** partial progress is saved **And** if the invite token expires (7 days) before session start, status transitions to `expired` |
| FR-05 | System SHALL auto-save partial progress on interruption | **Given** a session with 5 of 10 questions answered **When** an interruption occurs **Then** all 5 answers, transcripts, and behavioral data are persisted **And** resume is possible from question 6 |

### 6.2 Voice & Video

**User Story:** As a candidate, I want the interview to work on my phone/laptop with automatic turn-taking so I can focus on answering, not managing the microphone.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-06 | System SHALL support camera + microphone on phones, tablets, and laptops | **Given** a candidate on iPhone Safari, Android Chrome, or desktop Chrome/Firefox/Edge **When** they join an interview **Then** camera and microphone initialize within 5 seconds **And** video renders at ≥15fps |
| FR-07 | AI Interview SHALL use automatic turn-taking (no manual mic toggle) | **Given** an active AI Interview **When** the AI finishes speaking **Then** recording starts automatically within 500ms **And** when the candidate stops speaking for 2 seconds **Then** the answer auto-submits **And** no mic button is shown |
| FR-08 | System SHALL perform pre-flight checks (camera, mic, internet, display) before session start | **Given** a candidate joining a session **When** pre-flight checks run **Then** each check shows pass/fail status **And** if any check fails, the candidate sees specific remediation steps **And** they cannot start until all checks pass or they explicitly skip (with warning logged) |
| FR-09 | System SHALL obtain explicit recording consent before capturing any media | **Given** a candidate who has passed pre-flight **When** they reach the consent screen **Then** they see what will be recorded (video, audio) and why **And** recording does not start until they click "I consent" **And** declining *recording* consent prevents session start (no interview is possible without recording) **And** declining *biometric analysis* consent follows FR-14a (human interview alternative), not session termination |

### 6.3 Identity Verification (AI Screening + AI Interview)

**User Story:** As a recruiter, I want to verify the candidate's identity so that I know the person interviewing is who they claim to be.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-10 | System SHALL perform liveness check at session start (gaze challenge: "look left, look right") | **Given** a session requiring identity verification **When** the liveness challenge runs **Then** the AI voice instructs the candidate **And** gaze direction is verified via MediaPipe iris tracking **And** the check passes if gaze follows instructions within 10 seconds |
| FR-11 | System SHALL perform face match between government ID photo and live video | **Given** a candidate who uploaded their ID **When** face matching runs **Then** a similarity score (0-100) is computed **And** scores ≥80 are auto-accepted **And** scores 60-79 are flagged for recruiter review **And** scores <60 block the session |
| FR-12 | System SHALL extract face embedding from ID photo and **delete the image within 24 hours** | **Given** a completed ID verification **When** 24 hours elapse **Then** the raw ID image is deleted from primary storage **And** backup copies expire within the backup retention window (max 30 days) **And** only the embedding vector and match score remain in primary storage **And** deletion is logged in the audit trail |
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
| FR-19 | System SHALL treat all deepfake signals as observations for human review, never as autonomous verdicts | **Given** any deepfake signal fires **When** the system processes it **Then** an integrity event is created with confidence score **And** the interview continues uninterrupted **And** no *accusatory* message is shown to the candidate **And** liveness challenges (FR-18, FR-31–34) are the exception — they are framed as natural setup checks, not accusations **And** the recruiter sees observations, not verdicts |

### 6.5 Integrity Layer — AI-Assistance Detection

**User Story:** As a recruiter, I want to know if the candidate is reading AI-generated answers so that I can assess their genuine ability.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-20 | System SHALL continuously monitor reading-like gaze patterns (repeated left-to-right sweeps) | **Given** an active interview **When** the candidate's gaze shows >3 left-to-right sweeps within 10 seconds **Then** a reading-pattern signal is recorded with timestamp **And** the signal includes sweep count, duration, and gaze coordinates |
| FR-21 | System SHALL track response latency anomalies (extended pause → fluent delivery pattern) | **Given** a completed answer **When** the pause before answering was >8 seconds AND the answer delivery was fluent (WPM >130, <2 fillers) **Then** a latency anomaly signal is recorded **And** the pause duration and WPM are stored |
| FR-22 | System SHALL analyze speech rate consistency and filler word absence (WPM + "um/uh" counter) | **Given** a completed answer **When** WPM is calculated **Then** if WPM >140 AND filler count = 0 AND answer length >50 words **Then** a zero-hesitation signal is recorded **And** the transcript segment is flagged for linguistic review |
| FR-23 | System SHALL perform transcript linguistic forensics post-interview (formulaic patterns, robotic completeness, specificity scoring) | **Given** a completed interview transcript **When** forensics analysis runs **Then** it checks for: formulaic transitions ("firstly," "furthermore," "in conclusion"), robotic completeness (covers all angles with zero gaps), specificity score (named tools/dates/numbers/people) **And** produces a per-answer AI-likelihood score (0-100) |
| FR-24 | System SHALL trigger interactive probing (unscripted follow-up questions) when 3+ behavioral signals fire within 30 seconds | **Given** 3+ sub-flag-threshold behavioral signals (any combination of FR-20, FR-21, FR-22 — signals that are recorded but do not individually meet the FR-35/FR-59 flag threshold) within a 30-second window **When** the threshold is reached **Then** the AI generates an unscripted follow-up question targeting the suspicious answer **And** the probe is logged as "integrity probe" (not shown as such to candidate) |
| FR-25 | Probing questions SHALL feel conversational, never accusatory | **Given** a triggered probe **When** the AI speaks the follow-up **Then** it uses natural language (e.g., "Interesting — can you walk me through that differently?") **And** it NEVER uses words like "suspicious," "verify," "confirm," or "check" **And** the candidate experience is indistinguishable from a normal follow-up |

### 6.6 Integrity Layer — Voice Analysis

**User Story:** As a recruiter, I want voice consistency analysis so that I can detect if a different person is speaking or if voice cloning is used.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-26 | System SHALL extract eGeMAPS 88-feature voice profile from first 60 seconds (baseline) | **Given** the start of an interview **When** the candidate speaks for 60 seconds **Then** 88 eGeMAPS acoustic features are extracted **And** stored as the baseline voice profile **And** extraction completes within 5 seconds of the 60-second mark |
| FR-27 | System SHALL flag voice deviations >2 standard deviations from baseline (possible voice switch) | **Given** an established baseline **When** a subsequent answer's voice features deviate >2σ on 3+ features **Then** a voice-deviation integrity event is created **And** the event includes which features deviated and by how much |
| FR-28 | System SHALL measure vocal effort indicators (F0 variation, intensity variation) for **cognitive load estimation only** — pending legal review on "stress" labeling | **Given** an active interview **When** vocal indicators are measured per answer **Then** F0, intensity, and speech rate variation are tracked **And** the output is labeled "speech variation" or "cognitive load estimate" — **NOT "stress level"** (per compliance blueprint gate: no model output labeled "stress level") **And** the words "deception," "lying," "dishonesty," or "stress" NEVER appear in any user-facing output **And** per OQ-3 resolution: output is observational only ("cognitive load estimate" / "speech variation"), never an emotion label |
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
| FR-35 | System SHALL use conservative flagging: high-confidence only, minimizing false positives | **Given** any integrity signal **When** evaluating whether to create a flag **Then** the signal confidence must be ≥0.85 **And** 3+ independent signals must corroborate within 30 seconds **And** the target false positive rate is <2% **And** where FR-59's quality-weighted fusion is implemented, the uncertain band (0.60–0.85) routes to human review instead of auto-flagging |

### 6.8 Behavioral Analysis

**User Story:** As a recruiter, I want behavioral insights (confidence, communication style, engagement) so that I can assess soft skills objectively.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-36 | System SHALL analyze facial behavior per answer turn using non-affective signals only (OQ-3 resolved: observe, don't label) | **Given** a completed answer with video **When** facial analysis runs **Then** only non-affective signals are extracted (gaze direction, head pose, blink rate, facial landmark displacement) **And** no output is labeled as an emotion **And** processing completes within 2 seconds **And** no UI element, report, or API response labels any output as an emotion |
| FR-37 | System SHALL analyze voice prosody (pitch, pace, energy, vocal variation) | **Given** a completed answer with audio **When** prosody analysis runs **Then** pitch range, speech rate, energy level, and vocal variation indicators are computed **And** results are stored in `behavioral_signals` with modality=`vocal` **And** no output is labeled "stress," "stress level," or any emotion |
| FR-38 | System SHALL analyze linguistic content (STAR structure, specificity, depth) | **Given** a completed answer transcript **When** linguistic analysis runs **Then** STAR components are identified (Situation, Task, Action, Result) **And** specificity is scored (0-100 based on named entities, numbers, concrete details) **And** depth is assessed (surface vs. substantive) |
| FR-39 | System SHALL fuse multimodal signals using non-affective signals only | **Given** visual, vocal, and linguistic signals for an answer **When** fusion runs **Then** fusion uses only non-affective signals (gaze, speech rate, pause patterns, linguistic specificity) **And** text/linguistic signals receive highest weight **And** the fused output includes per-modality contributions for transparency |
| FR-40 | System SHALL track temporal behavior transitions using non-affective signals only | **Given** a completed interview **When** transition analysis runs **Then** only non-affective transitions are tracked (e.g., speech rate change >20%, gaze pattern shift) **And** transitions are listed in the recruiter report with timestamps **And** no transition is described using emotion language |
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
| FR-49 | Human Interview report SHALL show human interviewer feedback + AI Observer analysis side by side | **Given** a completed human interview **When** the recruiter opens the report **Then** they see two columns: "Interviewer Assessment" (human scores, notes, hire/no-hire) and "AI Observer Analysis" (behavioral signals, integrity flags) **And** discrepancies are highlighted (e.g., "Interviewer rated confidence 8/10; AI measured vocal pitch variation outside baseline range") |
| FR-50 | Reports SHALL disclose all integrity flags as evidence with timestamps and confidence levels | **Given** a report with integrity events **When** the recruiter views the integrity section **Then** each flag shows: timestamp, event type, severity, confidence score (0-100%), supporting signals **And** a disclaimer: "These are observations for your review, not determinations of misconduct" |

### 6.11 Admin / Operator

**User Story:** As an admin, I want to manage compliance and monitor system health so that we meet regulatory requirements and maintain reliability.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-51 | System SHALL provide compliance dashboard showing data retention status | **Given** an admin user **When** they open the compliance dashboard **Then** they see: videos pending deletion (with countdown), biometric data by age bracket, upcoming auto-deletions in next 7 days **And** manual "Delete now" action per item |
| FR-52 | System SHALL process "Delete my data" requests within 30 days | **Given** a candidate clicks "Delete my biometric data" **When** the request is submitted **Then** a ticket is created **And** all biometric data (embeddings, scores, videos, signals) is purged within 30 days **And** the candidate receives confirmation email **And** the purge is logged in the audit trail |
| FR-53 | System SHALL run automated retention purges on schedule | **Given** the retention policy **When** the daily cron runs **Then** videos >90 days past hiring decision are deleted **And** ID images >24 hours old are deleted **And** face/voice embeddings >24 hours past session end are deleted (hourly `purge_embeddings` job) **And** biometric data >3 years old is deleted (BIPA backstop) **And** each deletion is logged with timestamp and record count |
| FR-54 | System SHALL log every biometric data access with timestamp, user, role, action | **Given** any access to biometric data **When** the access occurs **Then** a log entry is created: `[timestamp] [user_id] [role] [view|delete|export] [data_type] [candidate_id]` **And** logs are immutable (append-only) **And** retained for 7 years |
| FR-55 | System SHALL alert admins on integrity system anomalies | **Given** the integrity pipeline **When** error rate exceeds 5% over 1 hour OR processing latency exceeds 2x baseline **Then** an alert is sent to admins **And** the alert includes affected sessions and error details |

### 6.12 Calibration & Fairness (R1, R8 — Mitigation Brief)

**User Story:** As a candidate, I want the system to learn my normal behavior before scoring me so that my nervousness or natural mannerisms aren't mistaken for cheating.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-56 | System SHALL perform ≤60-second passive calibration before scored questions (MANDATORY) | **Given** a candidate starting a scored interview **When** calibration runs **Then** Step 1 (~15s): device check (camera, mic, lighting estimate, device class) — shares checks with FR-08 pre-flight where possible to avoid duplication **And** Step 2 (~45s): ice-breaker questions framed as "mic/camera test" (e.g., "Tell me about your commute today") **And** Step 3 (ongoing): silent EWMA re-anchoring — baselines update during high-quality signal windows to correct for drift **And** the candidate experiences this as a tech check, not a test **And** no integrity flag fires on any signal whose warm-up quality was below floor (floor = minimum signal quality threshold defined per signal type in architecture) |
| FR-57 | System SHALL offer self-declared accommodation mode pre-interview ("help us calibrate to you") | **Given** the pre-interview flow **When** the candidate reaches the accommodation step **Then** they may select: "I fidget / move frequently," "I stutter or pause when speaking," "Apply wider tolerances (prefer not to say)," or skip **And** accommodation widens movement and speech-timing thresholds **And** integrity monitoring is never disabled **And** the framing is non-stigmatizing |
| FR-58 | System SHALL use per-candidate baselines (personal + cohort dual reference) | **Given** a calibrated session **When** integrity signals are evaluated **Then** the candidate is compared against their own warm-up baseline AND the cohort distribution for the same question type **And** a candidate whose pattern matches their warm-up is not flagged even if they differ from population average **And** baselines are per-session (not stored across sessions) |

### 6.13 Fusion Rules (R2 — Mitigation Brief)

**User Story:** As a system, I need to combine integrity signals intelligently so that low-quality data doesn't produce false flags.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-59 | System SHALL use quality-weighted fusion with an "uncertain" band (0.60–0.85) routing to human review | **Given** integrity signals in a 30-second window **When** fusion runs **Then** each signal is weighted by measured quality (quality²) **And** fused ≥0.85 AND ≥3 independent signals → FLAG **And** 0.60 ≤ fused < 0.85 → UNCERTAIN (review queue, lower priority) **And** fused <0.60 OR total quality weight <1.0 → NO FLAG |
| FR-60 | System SHALL apply correlation discounting for shared-sensor signals | **Given** two signals from the same sensor (e.g., gaze + face presence from same camera frame) with quality <0.5 **When** fusion runs **Then** the secondary signal's weight is halved **And** correlated signals are never double-counted as independent |
| FR-61 | System SHALL exclude below-floor signals from fusion (log as `signal_unavailable`, never as flag) | **Given** a signal with quality below its defined floor **When** fusion runs **Then** the signal is excluded entirely (not counted as positive or negative evidence) **And** an integrity event of type `signal_unavailable` is logged **And** the recruiter UI shows "Insufficient data" for that signal, never a gap |

### 6.14 Evidence Display (R3 — Mitigation Brief)

**User Story:** As a recruiter, I want integrity evidence presented clearly so that I understand what was observed without being told what to conclude.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-62 | System SHALL use three-tier progressive disclosure for integrity evidence | **Given** a recruiter viewing integrity observations **When** they open the default view (Tier 1) **Then** they see fused observations in plain language with Low/Medium/High confidence tiers and timestamp chips **And** clicking through (Tier 2) shows contributing signals + alternative benign explanations **And** Tier 3 (audit) shows raw signal excerpts and full timeline, available but never default |
| FR-63 | System SHALL use observational language standard (no verdict nouns) | **Given** any integrity observation displayed **When** reviewed **Then** language uses "observed," "recorded," event counts, temporal scoping **And** NEVER uses "detected cheating," "suspicious behavior," "integrity violation," "abnormal," or "deceptive" **And** every observation carries the footer: "This is an observation, not evidence of cheating." **And** alternative benign explanations are listed alongside every flag |
| FR-64 | System SHALL display confidence as tiers (Low/Medium/High), never bare percentages | **Given** an integrity observation **When** confidence is shown **Then** it displays as Low, Medium, or High with the reasons visible (which signals, what quality) **And** if numeric: natural frequencies only ("About 3 in 10 flags like this reflect real issues" — the positive predictive value) **And** NEVER shows "X% probability the candidate cheated" **And** always pairs with "This does not mean there is an X% chance the candidate cheated." |
| FR-65 | System SHALL NOT present a single fused "integrity score" | **Given** the recruiter report **When** the integrity section renders **Then** no single numeric integrity score is displayed **And** observations are listed individually with their evidence tiers **And** automated tests verify no "integrity_score" field appears in any API response or UI |

### 6.15 Judge-First Workflow (R4 — Mitigation Brief)

**User Story:** As a recruiter, I want to form my own judgment before seeing AI observations so that I'm not anchored by the AI's output.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-66 | System SHALL require recruiter to record initial judgment BEFORE revealing AI observations | **Given** a recruiter opening a completed interview report **When** they reach the integrity section **Then** the AI panel is collapsed by default **And** they must select: Advance / Hold / Reject with a one-sentence reason **And** only after recording judgment can they click "Show AI observations" |
| FR-67 | System SHALL prompt reflection when recruiter judgment diverges from AI evidence | **Given** a recruiter who recorded initial judgment X **When** they view AI observations suggesting Y **Then** the UI prompts: "Your initial assessment was X. The observations note Y. What changed your mind, or what didn't?" **And** their response (or "no change") is logged with both judgments |
| FR-68 | Sessions with zero integrity flags SHALL skip the AI panel entirely | **Given** a completed interview with zero integrity events **When** the recruiter opens the report **Then** no AI observations panel is shown **And** the report notes "No integrity observations recorded for this session" |

### 6.16 Dismissal Workflow (R5 — Mitigation Brief)

**User Story:** As a recruiter, I want to dismiss incorrect flags with a clear reason so that the system learns and candidates aren't unfairly penalized.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-69 | System SHALL require symmetric one-sentence justification for confirming AND dismissing flags | **Given** a recruiter reviewing an integrity flag **When** they click Confirm or Dismiss **Then** a one-sentence reason is required in both cases **And** the reason, reviewer identity, timestamp, and evidence shown are logged immutably |
| FR-70 | System SHALL pre-assemble all evidence on one dismissal review screen | **Given** a flag under review **When** the recruiter opens the review screen **Then** they see: the observation, timestamped video clips, interview context, signal-quality notes, alternative explanations, and base-rate context — with no tab-hunting required |
| FR-71 | System SHALL show base-rate context in natural frequencies on every flag | **Given** an integrity flag **When** displayed **Then** it includes: "Of every 100 flags like this, roughly N reflect real issues" (from measured positive predictive value) **And** the N is updated quarterly from validated data |

### 6.17 Recruiter Onboarding (R6 — Mitigation Brief)

**User Story:** As a new recruiter, I want to understand how the integrity system works and where it fails so that I use it responsibly from day one.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-72 | System SHALL require failure-mode-first onboarding before granting integrity feature access | **Given** a new recruiter account **When** they attempt to access integrity features **Then** they must complete onboarding: (1) What detectors measure (5 min), (2) Base rate — most flags are benign (3 min), (3) Known failure modes and blind spots (5 min), (4) 3–5 judge-first practice cases with feedback (10 min), (5) Override expectations (2 min) **And** access is blocked until completion **And** shallow "AI 101" content alone is insufficient **And** quarterly "blind" refresher cases (AI support withheld) are required to maintain access |

### 6.18 Integrity Metrics Dashboard (R7 — Mitigation Brief)

**User Story:** As a platform admin, I want to monitor integrity system health so that I can detect false-positive patterns and tune the system before they harm candidates.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-73 | System SHALL provide integrity metrics dashboard for admins | **Given** an admin user **When** they open the integrity dashboard **Then** they see: Flag rate (% sessions with ≥1 flag, alert if >15%), Dismissal rate (healthy 30–70%, alert if <20%), Judge divergence rate (% where AI changed initial judgment), Subgroup flag ratio (alert if any subgroup >2× baseline — baseline = overall flag rate), Median time-to-decision (alert if <30s), Positive predictive value (confirmed/total, validated sample) **And** quarterly random 5% override audit sample for QA re-review **And** aggregate outcome feedback per recruiter (their confirm/dismiss rates vs. team average) **And** all metrics are filterable by mode, date range, and recruiter |

### 6.19 Candidate Appeal Workflow (Problem Playbook)

**User Story:** As a candidate, I want to appeal an integrity flag I believe is wrong so that I get a fair review.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-74 | System SHALL provide "Request Review" path for candidates who dispute integrity findings | **Given** a candidate viewing their report **When** they click "Request Review" on any integrity-related feedback **Then** a case is created in the recruiter's queue **And** the recruiter sees: the flag, the evidence, AND the candidate's written explanation side by side **And** the SLA is 48 hours **And** if no action within 48h, the case auto-escalates to platform admin |
| FR-75 | Dismissed flags SHALL be removed from candidate record and logged for FP tracking | **Given** a recruiter dismissing a flag with reason **When** the dismissal is confirmed **Then** the flag is removed from the candidate's visible record **And** the dismissal is logged in the FP tracking dataset **And** if a flag type exceeds 50% dismissal rate, it is auto-quarantined (stops generating new flags, continues collecting data for retuning) |

### 6.20 Pricing & Packaging Enforcement

**User Story:** As the business, I need tier enforcement so that free users can't access paid features and usage is metered accurately.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-76 | System SHALL enforce tier-based interview metering (Free: 5 screening/mo; Starter: 50/mo; Professional: 300/mo) | **Given** a recruiter on a specific tier **When** they attempt to start an interview beyond their monthly limit **Then** the system blocks with "Monthly interview limit reached. Upgrade or wait until [reset date]." **And** usage is tracked per billing period **And** mock interviews are always unlimited and unmetered |
| FR-77 | System SHALL support India pay-as-you-go at ₹199/interview (no subscription) | **Given** an Indian recruiter (billing country = India) **When** they choose pay-as-you-go **Then** they are charged ₹199 per completed interview (any mode) **And** no monthly commitment is required **And** geo-fencing prevents US/EU customers from accessing India pricing |
| FR-78 | System SHALL support overage billing at $1.50/interview (~₹125) for subscription tiers | **Given** a paid subscriber who exceeds their tier limit **When** they start an additional interview **Then** they are charged $1.50 per overage interview **And** a warning is shown before the charge: "This will incur a $1.50 overage charge. Continue?" |
| FR-79 | Candidate-facing reports SHALL be free in all tiers (including Free) | **Given** any completed interview **When** the candidate accesses their report **Then** no paywall is shown **And** this applies to Free tier recruiters' candidates as well |
| FR-80 | Basic integrity flags SHALL be visible in all paid tiers; full evidence timeline in Professional+ | **Given** a Starter tier recruiter **When** they view a report with integrity events **Then** they see flag counts + severity levels + one-line alternative explanations per flag (e.g., "Also consistent with: reading notes") **But** the full Tier 2/3 evidence (timestamped clips, signal-quality details, raw forensics) requires Professional+ **And** the upgrade prompt is contextual, not blocking **And** the evidentiary fairness standard (alternative explanations visible) is never tier-gated |

### 6.21 LLM Provider Chain

**User Story:** As the platform, I need a resilient LLM fallback chain so that interviews never go silent when a provider fails.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-81 | Interview LLM chain SHALL be: Groq (ZDR enabled) → NIM → Cerebras → graceful pause | **Given** the interview engine needing LLM inference **When** Groq is available **Then** Groq is used (with zero-data-retention enabled in console) **And** if Groq fails/throttles, fallback to NIM, then Cerebras **And** Kimi and OpenAI are excluded from the interview chain until DPA posture is confirmed **And** if all providers fail, the session pauses gracefully with "AI is temporarily unavailable. Your progress is saved." — never a silent dead room |

### 6.22 AI Observer Implementation

**User Story:** As a recruiter, I want to toggle the AI Observer for my human interviews so that I get AI-powered behavioral analysis alongside my own assessment.

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-82 | System SHALL provide AI Observer opt-in/out toggle in human interview setup | **Given** a recruiter creating a human interview **When** they reach the interview settings **Then** they see an "AI Observer" toggle (default: ON) **And** toggling OFF means no observer bot joins and no observer report is generated **And** the toggle state is recorded in session metadata |
| FR-83 | System SHALL join AI Observer as invisible LiveKit participant when enabled | **Given** a human interview with observer enabled **When** the LiveKit room starts **Then** a bot joins with identity `ai-observer-{sessionId}` **And** the bot is subscribe-only (no audio/video tracks published) **And** the bot is invisible in the participant UI |
| FR-84 | System SHALL resolve participant roles via identity prefix + room metadata fallback | **Given** a human interview room **When** participants join **Then** `candidate-{userId}` is the analysis target (full behavioral + integrity) **And** `interviewer-{userId}` is tracked for diarization only **And** if identity prefix is missing or mismatched, room metadata (`candidate_id`, `interviewer_ids`) is the source of truth **And** mismatches are logged |
| FR-85 | System SHALL disclose AI Observer in the general interview consent | **Given** a candidate joining a human interview with observer enabled **When** they reach consent **Then** they see: "This session may include AI-assisted analysis of the conversation to help the recruiter. [Learn more]" **And** this is part of the general consent flow, not a standalone observer consent screen |
| FR-86 | AI Observer SHALL be passive-only (monitor, never interrupt) | **Given** an active human interview with observer **When** the observer detects integrity signals **Then** it records them silently **And** it never speaks, never issues challenges, never interrupts the human conversation **And** all observations appear only in the post-interview report |

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

### 8.3 Additional Compliance Requirements (from Whole-App Compliance Blueprint)

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| CR-11 | System SHALL disclose AI use to candidates before any AI-scored interaction | **Given** a candidate about to start AI Screening or AI Interview **When** they reach the pre-interview flow **Then** they see: "This interview uses AI to [analyze your responses / score your answers]. A human recruiter reviews all AI outputs before making decisions." **And** this disclosure is separate from biometric consent **And** the job application form includes: "Your application may be screened using AI. [Learn more]" with link to explanation (IL HB 3773 / NYC LL144 compliance) |
| CR-12 | System SHALL provide DSAR export endpoint (`GET /api/candidates/me/export`) | **Given** an authenticated candidate **When** they request data export **Then** they receive: profile, applications, scores, transcripts, consent records, integrity flags, in JSON + human-readable PDF **And** the export completes within 72 hours **And** SLA tracking ensures 30-day (GDPR), 45-day (CCPA) compliance |
| CR-13 | System SHALL provide orchestrated data deletion (`DELETE /api/candidates/me`) | **Given** a candidate requesting full deletion **When** the request is confirmed **Then** data is purged from: primary DB, R2/B2 storage, LiveKit recordings, logs (PII scrubbed) **And** Neon backup copies are tombstoned (marked for exclusion on restore; expire within backup retention window) **And** Groq processes nothing (ZDR on — verified pre-launch per CR-20) **And** deletion is confirmed via email within 30 days |
| CR-14 | System SHALL maintain FTC AI claims registry | **Given** the product marketing site and UI **When** audited quarterly **Then** every public claim about AI capability maps to evidence in `docs/compliance/ai-claims-registry.md` **And** claims without evidence are removed |
| CR-15 | System SHALL complete Data Protection Impact Assessment (DPIA) before launch | **Given** the pre-launch checklist **When** reviewed **Then** a DPIA document exists covering: systematic evaluation, necessity assessment, risk to rights, mitigation measures **And** it is signed off before any production biometric collection |
| CR-16 | System SHALL maintain incident response runbook for 72-hour breach notification | **Given** a detected data breach **When** the runbook is followed **Then** supervisory authority is notified within 72 hours (GDPR), affected individuals without undue delay (GDPR) / immediately (DPDP India) **And** pre-drafted notification templates exist per jurisdiction |
| CR-17 | System SHALL enforce "no fully automated hiring decisions" in UI | **Given** any AI-generated score **When** a recruiter views it **Then** no "auto-reject" or "auto-advance" button exists **And** the recruiter must explicitly click Advance/Reject/Hold **And** automated tests verify no code path bypasses human decision |
| CR-18 | System SHALL provide human appeal path ("Request human review" button) | **Given** a candidate who received an AI-influenced decision **When** they click "Request human review" **Then** the case routes to a human reviewer (not the original AI pipeline) **And** SLA is 5 business days **And** the reviewer sees the full evidence, not just the score |
| CR-19 | System SHALL execute DPAs with all subprocessors before launch | **Given** the pre-launch checklist **When** reviewed **Then** signed DPAs exist for: Neon (PostgreSQL), Render (hosting), LiveKit (video/audio), Groq (LLM), Cartesia (TTS/STT), Cloudflare R2 (storage), Backblaze B2 (storage fallback), Brevo (email) **And** the subprocessor register (`docs/compliance/subprocessor-register.md`) is current **And** any new vendor triggers a DPA check before integration |
| CR-20 | System SHALL enable Groq zero-data-retention (ZDR) in console settings before launch | **Given** the Groq console **When** inspected pre-launch **Then** the ZDR setting is enabled **And** this is verified by attempting a test call and confirming no data retention **And** the verification is documented |
| CR-21 | System SHALL enforce biometric consent at the API layer (middleware gate) | **Given** any request to biometric collection endpoints (`POST /api/interviews/*/frames`, voice upload, ID verification) **When** the request arrives **Then** middleware `requireBiometricConsent` checks for a valid consent record **And** if no valid consent exists, returns `403 CONSENT_REQUIRED` **And** no biometric data is collected or stored **And** consent records are versioned (`consent_text_version`); if consent text changes, re-consent is required **And** mid-session consent withdrawal immediately blocks further collection |

### 8.4 Pre-Launch Compliance Gate

- [ ] Biometric privacy policy published
- [ ] Three granular consent screens implemented and tested
- [ ] Retention automation built (90-day video purge, 3-year biometric purge, 24-hour ID purge)
- [ ] "Delete my data" dashboard functional
- [ ] Encryption at rest verified
- [ ] Access logging implemented
- [ ] BIPA written consent flow tested
- [ ] DPDP consent in English + Hindi
- [ ] DPA signed with any third-party AI provider
- [ ] DPIA completed and signed off
- [ ] Incident response runbook tested (tabletop exercise)
- [ ] Groq ZDR verified enabled
- [ ] DSAR export endpoint functional
- [ ] AI-use disclosure in all candidate flows
- [ ] FTC claims registry populated

---

## 9. Vocabulary Appendix

**All canonical lists.** These are the single source of truth for product-level vocabulary. The architecture document references these definitions; it does not redefine them.

### 9.1 Integrity Event Types (14)

| # | Event Type | Definition | Typical Severity |
|---|------------|------------|-----------------|
| 1 | `gaze_away` | Candidate's gaze directed off-screen for >3 seconds during a question | info |
| 2 | `face_absent` | No face detected in video frame for >5 seconds | warning |
| 3 | `multiple_faces` | More than one face visible in frame | warning |
| 4 | `tab_switch` | Browser tab lost focus during active interview | info |
| 5 | `challenge_issued` | Integrity challenge was presented to candidate | info |
| 6 | `challenge_failed` | Candidate did not pass a liveness/integrity challenge | warning |
| 7 | `voice_deviation` | Voice features deviated >2σ from session baseline on 3+ features | warning |
| 8 | `lip_sync_fail` | Lip movements misaligned with audio >150ms sustained for >5 seconds | warning |
| 9 | `reading_pattern` | Eye movements match reading text (>3 left-to-right sweeps in 10s) | info |
| 10 | `latency_anomaly` | Extended pause (>8s) followed by fluent delivery (WPM >130, <2 fillers) | info |
| 11 | `zero_hesitation` | High WPM (>140) + zero filler words + answer >50 words (unnaturally fluent) | info |
| 12 | `screen_flash_anomaly` | Face did not respond to screen hue change within 4 frames | warning |
| 13 | `signal_gap` | Client stopped sending integrity signals temporarily (network/device issue) | info |
| 14 | `signal_unavailable` | Sensor could not produce signal (e.g., camera covered, mic muted) — NOT a flag | info |

**Note:** `signal_gap` and `signal_unavailable` are system-health events, not integrity flags. They render as "Insufficient data" in the recruiter UI.

### 9.2 Behavioral Signal Types

| Modality | Signal Types |
|----------|-------------|
| `visual` | `facial_landmark_displacement`, `gaze_direction`, `head_pose`, `blink_rate`, `face_presence` |
| `vocal` | `pitch_f0`, `intensity`, `speech_rate_wpm`, `filler_count`, `pause_distribution`, `vocal_pitch_variation`, `spectral_flux` |
| `linguistic` | `star_structure`, `specificity_score`, `depth_score`, `formulaic_language`, `ai_likelihood` |
| `fused` | `multimodal_confidence`, `temporal_transition` |

### 9.3 Modality Values

| Value | Description |
|-------|-------------|
| `visual` | Signals derived from video frames (MediaPipe) |
| `vocal` | Signals derived from audio (Web Audio API, eGeMAPS) |
| `linguistic` | Signals derived from transcript text (LLM analysis) |
| `fused` | Combined multimodal signals with attention weighting |

### 9.4 Severity Levels

| Level | Meaning | Recruiter Action |
|-------|---------|-----------------|
| `info` | Observation noted; no action required | Review if pattern emerges |
| `warning` | Multiple corroborating signals; review recommended | Open Tier 2 evidence |
| `critical` | High-confidence multi-signal event (e.g., 2 failed challenges) | Mandatory review before decision |

### 9.5 Challenge Types (5)

| # | Type | Description | Pass Criterion |
|---|------|-------------|----------------|
| 1 | `gaze_verification` | "Look left... now right" with on-screen arrow | Gaze follows direction within 10s |
| 2 | `number_reading` | Display a number; candidate reads it aloud | Correct number spoken within 10s |
| 3 | `workspace_show` | "Show me your desk/workspace" | Camera pans; no second person visible |
| 4 | `comprehension_probe` | "Restate your last answer in your own words" | Semantic similarity >0.7 to original |
| 5 | `dot_following` | Follow a moving dot with eyes | Gaze tracks dot path within tolerance |

### 9.6 Session Statuses

| Status | Meaning |
|--------|---------|
| `invited` | Invite sent; candidate hasn't joined |
| `in_progress` | Active interview session |
| `paused` | Interrupted (tech issue, candidate action); resumable |
| `completed` | All questions answered; reports generating/generated |
| `abandoned` | Candidate left without completing; no resume within 24h |
| `expired` | Invite token expired (7 days) without session start |

### 9.7 Score Scales

**All scores use 0–100 scale** (consistent with ID match score). Key scales:

| Score | Range | Interpretation |
|-------|-------|----------------|
| Integrity confidence | 0–100 | Per-event confidence; flag threshold ≥85 |
| ID face match | 0–100 | ≥80 auto-accept; 60–79 review; <60 block |
| Behavioral signals | 0–100 | Per-signal; <50 confidence → "Insufficient data" |
| AI-likelihood (linguistic) | 0–100 | Higher = more likely AI-assisted |
| Specificity | 0–100 | Named entities, numbers, concrete details |
| Fused observations | 0–100 | Quality-weighted signal combination; ≥85 flag, 60–85 uncertain, <60 no flag. Never presented as a single "integrity score" (OQ-2) — recruiters see tiered observations. |

**Never show fake scores.** Where confidence <0.5, display "N/A" or "Insufficient data" — never a placeholder number.

### 9.8 Consent Types

| # | Consent Screen | Required For | Decline Path |
|---|---------------|--------------|--------------|
| 1 | Interview recording | All modes with media | Cannot proceed without (no interview possible) |
| 2 | Biometric analysis | AI Screening, AI Interview | May opt for human interview instead |
| 3 | ID verification | AI Screening, AI Interview | Cannot proceed with AI modes; human interview option |

---


### OmniScore Visibility Model (Sumanth, 2026-10-10)

The OmniScore engine is a separate feature. Interview results feed into OmniScore internally,
but the **causal link is invisible to everyone**:

| Visibility | Candidate | Recruiter |
|------------|-----------|-----------|
| OmniScore number | ✅ Visible | ✅ Visible |
| Activity feed ("completed AI interview Oct 10") | ✅ Visible | ✅ Visible |
| Score delta from this interview | ❌ Hidden | ❌ Hidden |
| Interview-specific scores | ❌ Hidden | ✅ Visible |
| Qualitative feedback | ✅ Visible | ✅ Visible |
| Integrity flags/evidence | ❌ Hidden | ✅ Visible |

**Rationale:** Prevents reverse-engineering ("my score dropped after the interview, I must have been flagged").
Neither party sees "+2.3 from this interview" or "−1.5 from integrity flags."

## 10. Open Questions

### Resolved in v2.1

| # | Question | Resolution |
|---|----------|------------|
| 1 | Screen flash test — confirm comfort with passive screen hue manipulation | ✅ **Approved** by Sumanth (2026-10-10). Covered under biometric consent. |
| 2 | AI Screening candidate feedback: pass/fail or qualitative? | ✅ **No report shared with candidate.** Recruiter gets match score + full report. |
| 3 | If candidate declines biometric consent — human-only interview path? | ✅ **Candidate may opt for human interview.** Recruiter decides whether to move forward. |

### New in v3.0 (from Phase 1 Redo)

| # | Question | For | Status |
|---|----------|-----|--------|
| OQ-1 | Judge-first workflow | ✅ **Approved** by Sumanth (2026-10-10). Recruiter records assessment before seeing AI flags. |
| OQ-2 | No single "integrity score" | ✅ **Approved** by Sumanth (2026-10-10). Observations grouped by severity, no aggregate score. |
| OQ-3 | Emotion inference scope | ✅ **Resolved** by Sumanth (2026-10-10): **Option A — observe, don't label.** System reports behavioral measurements (pitch, gaze, pauses); never labels emotions. EU AI Act Art. 5 compliant by design. |
| OQ-4 | Subgroup audit threshold | ✅ **Approved** by Sumanth (2026-10-10): 2× baseline as starting alert bar. Tunable post-launch. |
| OQ-5 | Accommodation visibility | ✅ **Decided** by Sumanth (2026-10-10): **Private.** Recruiters see widened thresholds applied but not the reason. Prevents selective-adherence bias. |
| OQ-6 | Fusion timing | ✅ **Decided** by Sumanth (2026-10-10): Ship **uncertain band** (0.60–0.85 → human review) at launch with simpler fusion; upgrade to quality-weighted fusion post-launch. |
| OQ-7 | Launch market | ✅ **Decided** by Sumanth (2026-10-10): **USA + India first**, Europe phase 2. Architecture built for all three. |
| OQ-8 | Pricing | ✅ **Approved** by Sumanth (2026-10-10): Hybrid model (Free/$49/$199/Enterprise) + India ₹199 PAYG. Two-sided: recruiters pay, candidates free. |

---

## 11. Non-Functional Requirements

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

## 12. Success Metrics

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
| **Compliance audit pass** | 100% | All 15 pre-launch gate items (§8.3) checked |
| **Zero data breaches** | 0 incidents | Any unauthorized biometric data access |

---

## 13. Research References

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
