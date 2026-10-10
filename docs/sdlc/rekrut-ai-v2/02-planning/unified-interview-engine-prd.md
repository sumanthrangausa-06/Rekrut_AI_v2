---
project: Unified Interview Engine
version: 1
status: draft
created: 2026-10-10
owner: Sumanth
stepsCompleted: ["step-01-requirements", "step-02-draft"]
---

# Unified Interview Engine — Product Requirements Document

> **Status:** Draft | **Version:** 1 | **Owner:** Sumanth

---

## 1. Overview

The Unified Interview Engine is a single configurable platform that powers all four interview modes at Rekrut AI: Mock Interview (candidate practice), AI Screening (automated voice/video filter), AI Interview (recruiter-triggered deep assessment), and Human Interview (with AI Observer). It replaces fragmented per-mode implementations with one engine, delivering advanced integrity detection (deepfake, AI-assistance, and behavioral), multimodal behavioral analysis, and dual reporting (recruiter + candidate) — all within a $0 infrastructure budget and full biometric data compliance.

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

## 3. User Personas

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

---

## 4. Interview Modes

### 4.1 Mock Interview

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Candidate practice with AI feedback |
| **Trigger** | Candidate self-initiated |
| **Questions** | Standardized practice questions |
| **Integrity** | Minimal (practice mode — no identity verification) |
| **Behavioral analysis** | Basic (for practice feedback) |
| **Candidate sees** | Numerical scores (feeds OmniScore) + qualitative feedback |
| **Recruiter sees** | N/A (practice only, not shared unless candidate opts in) |

### 4.2 AI Screening

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Automated voice/video filter on job application |
| **Trigger** | Auto-sent on apply (per job settings) or recruiter-triggered |
| **Questions** | Standardized per-job-topic template — same for every candidate |
| **Identity verification** | Face match + liveness + government ID photo |
| **Integrity** | Standard (gaze, face presence, tab switch) |
| **Behavioral analysis** | Standard |
| **Candidate sees** | TBD (pass/fail or qualitative — to be confirmed) |
| **Recruiter sees** | Screening score + integrity flags + transcript |

### 4.3 AI Interview

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

### 4.4 Human Interview (with AI Observer)

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

## 5. Functional Requirements

### 5.1 Session Management

| ID | Requirement |
|----|-------------|
| FR-01 | System SHALL support creating interview sessions of type: `mock`, `screening`, `ai-interview`, `human` |
| FR-02 | System SHALL store session configuration as validated JSON (Zod schema per mode) |
| FR-03 | System SHALL support invite tokens for candidate access |
| FR-04 | System SHALL track session lifecycle: `invited` → `in_progress` → `paused` → `completed` / `abandoned` |
| FR-05 | System SHALL auto-save partial progress on interruption |

### 5.2 Voice & Video

| ID | Requirement |
|----|-------------|
| FR-06 | System SHALL support camera + microphone on phones, tablets, and laptops |
| FR-07 | AI Interview SHALL use automatic turn-taking (no manual mic toggle) |
| FR-08 | System SHALL perform pre-flight checks (camera, mic, internet, display) before session start |
| FR-09 | System SHALL obtain explicit recording consent before capturing any media |

### 5.3 Identity Verification (AI Screening + AI Interview)

| ID | Requirement |
|----|-------------|
| FR-10 | System SHALL perform liveness check at session start (gaze challenge: "look left, look right") |
| FR-11 | System SHALL perform face match between government ID photo and live video |
| FR-12 | System SHALL extract face embedding from ID photo and **delete the image within 24 hours** |
| FR-13 | System SHALL store only: match score (0-100), timestamp, ID type — never ID number, address, or DOB |
| FR-14 | System SHALL present separate consent screens for: interview recording, biometric analysis, ID verification |

### 5.4 Integrity Layer — Deepfake Detection

| ID | Requirement |
|----|-------------|
| FR-15 | System SHALL run passive screen-flash test during interview (subtle hue shift, measure facial light response in 1-4 frames) |
| FR-16 | System SHALL verify lip-sync using phoneme-viseme alignment (target: LipFD-class accuracy) |
| FR-17 | System SHALL check audio-visual sync (offset must be <80ms) |
| FR-18 | System SHALL issue gaze-based liveness challenges when AV-sync anomaly detected |
| FR-19 | System SHALL treat all deepfake signals as evidence for human review, never as autonomous verdicts |

### 5.5 Integrity Layer — AI-Assistance Detection

| ID | Requirement |
|----|-------------|
| FR-20 | System SHALL continuously monitor reading-like gaze patterns (repeated left-to-right sweeps) |
| FR-21 | System SHALL track response latency anomalies (extended pause → fluent delivery pattern) |
| FR-22 | System SHALL analyze speech rate consistency and filler word absence (WPM + "um/uh" counter) |
| FR-23 | System SHALL perform transcript linguistic forensics post-interview (formulaic patterns, robotic completeness, specificity scoring) |
| FR-24 | System SHALL trigger interactive probing (unscripted follow-up questions) when 3+ behavioral signals fire within 30 seconds |
| FR-25 | Probing questions SHALL feel conversational, never accusatory (e.g., "Can you walk me through that differently?") |

### 5.6 Integrity Layer — Voice Analysis

| ID | Requirement |
|----|-------------|
| FR-26 | System SHALL extract eGeMAPS 88-feature voice profile from first 60 seconds (baseline) |
| FR-27 | System SHALL flag voice deviations >2 standard deviations from baseline (possible voice switch) |
| FR-28 | System SHALL measure vocal stress indicators (F0 increase, intensity increase) for **stress/cognitive load only** |
| FR-29 | System SHALL NEVER present voice analysis as deception detection |
| FR-30 | System SHALL estimate heart rate via remote PPG (facial video) as supplementary signal only |

### 5.7 Integrity Challenges

| ID | Requirement |
|----|-------------|
| FR-31 | System SHALL issue liveness challenge at session start (framed as "setup check") |
| FR-32 | System SHALL support challenge types: gaze verification, number reading, workspace show, comprehension probe, dot-following |
| FR-33 | Failed challenge SHALL trigger a second challenge (not interview termination) |
| FR-34 | Two failed challenges SHALL create a silent flag for recruiter review; interview continues normally |
| FR-35 | System SHALL use conservative flagging: high-confidence only, no false positives |

### 5.8 Behavioral Analysis

| ID | Requirement |
|----|-------------|
| FR-36 | System SHALL analyze facial expressions (7 basic emotions) per answer turn |
| FR-37 | System SHALL analyze voice prosody (pitch, pace, energy, stress indicators) |
| FR-38 | System SHALL analyze linguistic content (STAR structure, specificity, depth) |
| FR-39 | System SHALL fuse multimodal signals with attention weighting (text strongest, speech-emotion weakest per MIST research) |
| FR-40 | System SHALL track temporal behavior transitions (e.g., confident → nervous shifts) |
| FR-41 | Behavioral scores SHALL show "N/A" or "Insufficient data" when confidence is low — never fake scores |

### 5.9 Camera/Voice Failure Recovery

| ID | Requirement |
|----|-------------|
| FR-42 | On camera/mic failure, system SHALL pause the session and prompt candidate to fix the issue |
| FR-43 | System SHALL allow resume from last completed question after fix |
| FR-44 | If unresolvable, system SHALL allow reschedule via new recruiter invite |
| FR-45 | Recruiter SHALL choose on reschedule: Resume (from last question) or Restart (fresh session) |
| FR-46 | Report SHALL always disclose technical interruptions ("session resumed after technical interruption") |

### 5.10 Reporting

| ID | Requirement |
|----|-------------|
| FR-47 | System SHALL generate recruiter report: full assessment scores + integrity evidence timeline + behavioral analysis + transcript |
| FR-48 | System SHALL generate candidate report: qualitative feedback only (strengths, areas to improve, no numerical scores) — except Mock Interview which includes scores |
| FR-49 | Human Interview report SHALL show human interviewer feedback + AI Observer analysis side by side |
| FR-50 | Reports SHALL disclose all integrity flags as evidence with timestamps and confidence levels |

---

## 6. Data Requirements

### 6.1 New Tables

| Table | Purpose |
|-------|---------|
| `integrity_events` | Integrity flag timeline (event type, severity, timestamps, confidence, details JSONB) |
| `behavioral_signals` | Per-turn behavioral analysis (modality, signal type, score, label, confidence) |
| `ai_observer_reports` | AI Observer analysis for human interviews |
| `session_analysis` | Unified per-question analysis (replaces legacy `interview_analysis`) |

### 6.2 Data Retention

| Data Type | Retention |
|-----------|-----------|
| Raw video/audio | Delete 90 days after hiring decision |
| Per-turn raw emotion/stress vectors | Delete 90 days with video |
| ID photo images | Delete within 24 hours of extraction |
| Integrity flag timelines | Indefinite |
| Aggregated behavioral scores | Indefinite |
| ID match scores | Indefinite |

### 6.3 Data Minimization

- Store face embeddings (vectors), not face images
- Store voice features (F0, intensity), not raw audio (beyond 90 days)
- Store match score, not ID number/address/DOB
- Biometric templates in separate storage from PII

---

## 7. Compliance Requirements

### 7.1 Applicable Regulations

GDPR (EU), BIPA (Illinois), CCPA/CPRA (California), DPDP Act (India)

### 7.2 Compliance Rules

| ID | Requirement |
|----|-------------|
| CR-01 | System SHALL present 3 separate consent screens (interview, biometric, ID) — never bundled |
| CR-02 | System SHALL publish biometric retention/destruction policy at `/privacy/biometric-policy` before any collection |
| CR-03 | System SHALL encrypt biometric templates at rest (AES-256) and in transit (TLS 1.3) |
| CR-04 | System SHALL segregate biometric data from PII (separate table/encryption key) |
| CR-05 | System SHALL log every biometric data access (timestamp, user, role, action, data type) |
| CR-06 | System SHALL provide "Delete my data" button → purges all biometric data within 30 days |
| CR-07 | System SHALL auto-delete biometric data at 3-year mark (BIPA) or when purpose fulfilled, whichever first |
| CR-08 | System SHALL require MFA for admin access to biometric data |
| CR-09 | System SHALL NEVER sell, rent, or share biometric data with third parties |
| CR-10 | DPDP consent notices SHALL be available in English + Hindi |

### 7.3 Pre-Launch Compliance Gate

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

## 8. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | **Performance:** Real-time voice analysis inference <100ms per turn |
| NFR-02 | **Performance:** Video analysis frame processing <500ms |
| NFR-03 | **Scalability:** Support 100 concurrent interview sessions |
| NFR-04 | **Availability:** 99.5% uptime for interview sessions |
| NFR-05 | **Devices:** Full functionality on phones, tablets, laptops |
| NFR-06 | **Browsers:** Chrome, Safari (iOS), Firefox, Edge |
| NFR-07 | **Budget:** $0 additional infrastructure cost |
| NFR-08 | **Security:** All biometric data encrypted; audit trail for all access |

---

## 9. Open Questions

| # | Question | Status |
|---|----------|--------|
| 1 | Screen flash test — confirm comfort with passive screen hue manipulation | Awaiting Sumanth |
| 2 | AI Screening candidate feedback: pass/fail or qualitative? | Open |
| 3 | If candidate declines biometric consent — human-only interview path? | Open |

---

## 10. Research References

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
| Compliance | GDPR Art. 9; BIPA §15 ($1K-$5K/violation); DPDP Act 2023 (₹250 crore max) |

Full research: `docs/sdlc/rekrut-ai-v2/01-analysis/technical-research-integrity.md`

---

> **Next:** Step 03 (Finalize) → `validate-prd` → Sumanth's approval
