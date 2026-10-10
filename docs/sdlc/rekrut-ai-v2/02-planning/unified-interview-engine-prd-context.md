# Unified Interview Engine — PRD Requirements Context

**Phase:** 2-Planning, Step 01 (Requirements)
**Date:** 2026-10-10
**Status:** Requirements gathered, awaiting Step 02 (Draft)

---

## Project Overview

| Item | Value |
|------|-------|
| **Project** | Unified Interview Engine |
| **Type** | Brownfield — unifying existing Mock, Screening, AI Interview + new Human Observer mode |
| **Primary goal** | One configurable engine supporting all 4 interview modes end-to-end |
| **Secondary goals** | (1) Advanced integrity layer better than any cheating app (2) Dual reports (recruiter detailed + candidate qualitative) (3) Works on phones, tablets, laptops |
| **Non-goals** | Text-only interviews. Autonomous cheating verdicts (human review mandatory). Voice deception detection (scientifically discredited). |

## Stakeholders

| Role | Person |
|------|--------|
| Founder/CEO | Sumanth (product direction, cost, approvals) |
| CTO | Suga (technical ownership, SDLC enforcement) |

## User Personas

| Persona | Goal | Pain Point Today |
|---------|------|------------------|
| **Candidate** | Complete interview smoothly, get useful feedback | Fragmented experience across modes; no feedback |
| **Recruiter** | Configure interviews, review candidates with integrity evidence | No unified view; manual integrity assessment |
| **Human Interviewer** | Conduct interview with AI-powered behavioral insights | No objective behavioral data to supplement judgment |

## Constraints

- **$0 infrastructure budget** — no paid services without Sumanth's approval
- **Voice + video only** — no text fallback for Screening/AI Interview
- **No fake scores** — "N/A" or "Insufficient data" where no data exists
- **Integrity = evidence for human review** — never autonomous cheating verdicts
- **Cross-device** — phones, tablets, laptops

---

## Confirmed Requirements (Sumanth's Answers)

### 1. Candidate Scoring & Feedback

| Interview Mode | Candidate Sees |
|----------------|---------------|
| **Mock Interview** | Numerical scores (feeds into OmniScore) |
| **AI Interview** | Qualitative feedback only (no numbers) |
| **Human Interview** | Qualitative feedback only (human + AI combined, no raw scores) |
| **AI Screening** | TBD (likely pass/fail or qualitative) |

### 2. Integrity Flagging Posture

**Conservative** — fewer flags, high confidence only. No false positives.

**Combined signals approach:** AI raises suspicion only when 3+ signals fire within a 30-second window. No single signal triggers a challenge alone.

| Signal | Research Backing | Weight |
|--------|-----------------|--------|
| Reading-like gaze sweeps | BrightHire: most reliable behavioral indicator of AI assistance | High |
| Response latency anomaly | PLOS ONE: validated cognitive-load cue | High |
| Gaze away duration | Lab F1 ~0.93, but no validated threshold | Medium |
| Voice stress (F0, intensity) | PLOS ONE 2025: reliable for stress, NOT deception | Medium (stress only) |
| LLM-answer similarity | Industry practice: transcript comparison | Medium |

### 3. Integrity Challenge Design

**Challenge types (all confirmed):**

| Challenge | Research | Catches |
|-----------|----------|---------|
| "Look left, look right" | GOTCHA: 88.6% AUC | Deepfakes, pre-recorded video |
| "Read this number aloud: 8472" | AV-sync: 0.952 AUC | Voice cloning, lip-sync fakes |
| "Show your desk/workspace" | YOLO phone detection: 97.08% | Visible phones, notes, second person |
| "Say that in your own words" | Canagasuriam & Lukacik: interactive probing most reliable | AI-generated answers |
| "Follow this dot with your eyes" | Kohler et al.: 82.5% acc, 88% AUC | Deepfakes |

**Challenge flow:**
1. **Session start:** Liveness challenge (gaze) — framed as "setup check"
2. **During interview:** Comprehension probes when suspicious (conversational, never accusatory)
3. **Failed challenge:** Issue second challenge → if second fails → silent flag for recruiter, interview continues
4. **Never:** End interview automatically, accuse candidate, or show "suspicious behavior detected"

**Challenge presentation:**
- **Liveness:** AI voice + on-screen visual guide. Framed as technical setup.
- **Integrity:** AI voice only, conversational follow-up style. Example: *"Interesting — can you walk me through that in your own words?"*

**Screen flash test:** Passive deepfake detection. The interview page briefly shifts background hue; real faces reflect the change in 1-4 frames, deepfakes lag. Runs silently — candidate barely notices. (Sumanth to confirm comfort level.)

### 4. Evidence Retention

| Data Type | Retention | Rationale |
|-----------|-----------|-----------|
| **Raw video** | Delete 90 days after hiring decision | Storage cost + privacy |
| **Integrity flag timelines** | Indefinite | Audit records, not biometric data |
| **Aggregated behavioral scores** | Indefinite | Assessment results |
| **Per-turn raw emotion/stress vectors** | Delete after 90 days with video | Biometric-derived data |
| **Match scores (ID verification)** | Indefinite | Assessment result, not biometric |

### 5. Identity Verification

**AI Interview + AI Screening:** Face match + liveness + government ID photo.

**ID handling (compliant design):**
1. Capture ID photo → extract face embedding → compare to live face
2. **Delete ID image within 24 hours**
3. Keep only: match score (0-100), match timestamp, ID type (not number)
4. **Never store:** ID number, address, date of birth from document

### 6. Camera/Voice Failure Recovery

**Primary flow:** Pause mid-session → candidate fixes issue → resume from where they left off.

**If unresolvable:** Reschedule. Recruiter sends new invite as completely new session.

**Enhancement (Suga's suggestion):** Auto-save partial progress. On reschedule, recruiter chooses:
- **Resume** — continue from last completed question (report notes: "session resumed after technical interruption")
- **Restart** — completely fresh session

### 7. Accessibility

Not required for initial release. Revisit post-launch.

### 8. Video Access Control

| Role | Access |
|------|--------|
| Recruiter | ✅ Full video access |
| Hiring Manager | ✅ Full video access |
| Admin | ✅ Full video access |
| Candidate | ❌ Cannot request own video |

### 9. Cross-Candidate Data

Anonymized behavioral patterns MAY be used to improve models. All candidate data siloed per company by default.

---

## Compliance Framework: Biometric & ID Data

### Applicable Regulations

| Regulation | Scope | Key Requirements |
|------------|-------|-----------------|
| **GDPR** (EU) Art. 9 | Biometric data = "special category" | Explicit consent, data minimization, right to erasure, DPA |
| **BIPA** (Illinois, US) | Face geometry, fingerprints | **Written consent before collection**, published retention/destruction policy, $1K-$5K per violation |
| **CCPA/CPRA** (California) | Biometric identifiers | Right to know, delete, opt-out; 1-year retention guideline |
| **DPDP Act** (India, 2023) | Personal data including biometric | Free/specific/informed consent, purpose limitation, ₹250 crore max penalty |

### Compliance Rules Built Into Our System

#### Rule 1: Granular Consent (Before Any Collection)

Three separate consent screens — **never bundled:**

1. **Interview consent:** "This interview will be recorded (video + audio) for assessment purposes."
2. **Biometric consent:** "We will analyze your facial expressions, voice patterns, and gaze for behavioral assessment. [What we collect] [How long we keep it] [Delete my data]"
3. **ID verification consent:** "We will verify your identity using your government ID. [What we collect] [What we delete] [Retention policy]"

Each has: ✅ Accept / ❌ Decline (decline = cannot proceed with AI Interview, can request human-only)

#### Rule 2: Published Retention Policy (Before Collection)

Required by BIPA §15(a). Must be publicly accessible at `/privacy/biometric-policy`:

- What biometric data we collect (face embeddings, voice features, gaze vectors)
- Why we collect it (identity verification, behavioral assessment, integrity)
- How long we keep each type (per retention table above)
- How we destroy it (irreversible deletion, including backups)
- How to request deletion

#### Rule 3: Data Minimization

| Collect | Don't Collect |
|---------|---------------|
| Face embedding (512-dim vector) | Raw face images (beyond 24hr) |
| Voice features (F0, intensity) | Raw audio (beyond 90 days) |
| Match score (0-100) | ID number, address, DOB |
| Gaze direction vectors | Eye images |

#### Rule 4: Segregation

- Biometric templates stored in **separate database** (or separate encryption key) from PII
- Face embeddings never stored alongside name/email in same table
- Access logged with timestamp + user ID (CCPA §1798.100 requirement)

#### Rule 5: Deletion Workflows

| Trigger | Action | Timeline |
|---------|--------|----------|
| Candidate clicks "Delete my data" | Purge embeddings, scores, video | Within 30 days (GDPR) |
| 90 days after hiring decision | Auto-delete raw video + per-turn vectors | Automated |
| BIPA 3-year limit | Auto-delete all biometric data | Automated (whichever comes first: purpose fulfilled or 3 years) |
| Consent withdrawn | Stop processing, delete biometric data | "Without undue delay" |

#### Rule 6: Security

- Encryption at rest (AES-256) for all biometric templates
- Encryption in transit (TLS 1.3)
- Role-based access: only recruiter/hiring manager/admin roles
- MFA required for admin access to biometric data
- Monthly access reviews

#### Rule 7: No Sale, No Sharing

- Biometric data never sold, rented, or shared with third parties
- Third-party AI providers (if any): must sign BAA/DPA, data processed in-memory only, no retention

#### Rule 8: Audit Trail

Every biometric data access logged:
```
[timestamp] [user_id] [role] [action: view/delete/export] [data_type] [candidate_id]
```

### Compliance Checklist (Pre-Launch Gate)

- [ ] Biometric privacy policy published at `/privacy/biometric-policy`
- [ ] Three granular consent screens implemented and tested
- [ ] Retention automation built (90-day video purge, 3-year biometric purge)
- [ ] "Delete my data" candidate dashboard functional
- [ ] Encryption at rest verified for biometric storage
- [ ] Access logging implemented
- [ ] BIPA written consent flow tested (Illinois candidates)
- [ ] DPDP consent in English + Hindi (India candidates)
- [ ] DPA signed with any third-party AI provider

---

## Open Questions

1. **Screen flash test:** Confirm comfort with passive screen hue manipulation for deepfake detection
2. **AI Screening candidate feedback:** Pass/fail or qualitative?
3. **Consent decline path:** If candidate declines biometric consent, can they still do a human-only interview?

---

**Next:** Step 02 (Draft PRD)
