# Technical Research: Anti-Cheat / Integrity Layer for AI Video Interviews

**Date:** 2026-10-10 (updated)
**Skill:** `smart-sdlc/1-analysis/technical-research`
**Method:** Structured research via `browser.deep_research` (7 research questions) + follow-up voice-layer research
**Full report:** [Interview Integrity Research Report](sandbox://workspace/research_notes/interview-integrity-research-papers-20261010-1044/report.md)

---

## Research Questions & Findings

### Q1: Gaze-based cheating detection

| Paper | Year | Key Finding |
|-------|------|-------------|
| Frontiers in Education (vision-based framework) | 2026 | Acc 0.94, F1 0.93 (lab). Authors caution: indicators for review, not proof. |
| IJSRA (MediaPipe proctoring) | 2025 | F1 91.4% eye / 93.7% hand |
| Duolingo (arXiv 2409.16923) | 2024 | Gaze as human-in-the-loop triage, not verdict |
| L2CS-Net (baseline method) | 2022 | 3.92° error constrained, 10.41° in-the-wild |

**Limitation:** Glasses glare and lighting break tracking. Error doubles in unconstrained settings.

### Q2: Phone-use detection (out-of-frame)

**In-frame:** Solved. YOLO phone detection ~97% accuracy.

**Out-of-frame:** NO peer-reviewed detection rate exists. Only indirect signals:
- Reading-like gaze sweeps (repeated left-to-right eye movements)
- Response-latency variance (extended pause → fluent delivery)
- Interactive follow-ups (industry consensus: most reliable probe)

### Q3: Voice-based deception/stress detection

**What works:** Vocal prosody marks stress/cognitive load (raised F0, intensity). PLOS ONE 2025 systematic review confirms.

**What doesn't:** Deception detection. Layered Voice Analysis scientifically discredited:
- NRC 2003: "little or no scientific basis"
- NIJ 2007 field study: ~10% of lies caught, ~50% overall = chance
- Horvath 2013: 48% accuracy = chance

**Decision:** Ship stress/cognitive-load meter. NEVER a "deception score."

### Q4: Real-time deepfake detection

| Approach | Accuracy | Notes |
|----------|----------|-------|
| Challenge-response (NYU GOTCHA) | 88.6% AUC human / 80.1% automated | 56k videos, code on GitHub |
| Active illumination / Screen-flash (Gerstner & Farid) | Qualitative | Screen hue changes, 1-4 frame lag in fakes. **Approved by Sumanth 2026-10-10.** |
| Corneal reflection (Guo et al.) | Near-zero NCC for fakes | Needs good resolution |
| Gaze-behavior (Kohler et al.) | 82.5% acc / 88% AUC | Fakes can't mimic natural gaze |
| Passive CNN detectors | 94% → 48-62% on 2025 generators | **COLLAPSED on new generators** |

**Decision:** Use active methods (challenge-response + screen-flash + gaze). Don't rely on passive detectors alone.

### Q5: Multimodal behavioral analysis

| Paper | Finding |
|-------|---------|
| MIST (ESWA 2025) | 74.21% multimodal vs 72.68% unimodal. Text strongest (84.97%), speech weakest (43.70%) |
| CVPR 2025 Workshops | +17% over facial-only via Wav2Vec2 fusion |
| Face2Fate (IJGET 2026) | MediaPipe + Whisper + YIN-pitch pipeline (proposal, no benchmarks) |

**Pattern:** Text/transcript is strongest single signal. Fusion beats unimodal. Temporal dynamics > static labels.

### Q6: AI-generated answer detection

**Canagasuriam & Lukacik (2025):** ChatGPT-assisted candidates scored 3.78/3.62 vs 2.52 control (η²=0.41, very large effect). Delivery ratings did NOT differ. No peer-reviewed detector exists.

**Decision:** Detection must be behavioral + interactive probing. Can't rely on content quality.

### Q7: Open-source implementations

12 GitHub projects catalogued. ALL student/demo-grade, none production-ready.

**Decision:** Build on mature primitives (MediaPipe Tasks Apache-2.0, TensorFlow.js, face-api.js MIT, Whisper). Don't adopt demo repos wholesale. Caution: Ultralytics YOLO is AGPL-3.0 (copyleft risk).

---

## Q8: Voice-Layer Integrity Research (added 2026-10-10)

### Voice Consistency & AI Speech Detection

| Finding | Source | Implication |
|---------|--------|-------------|
| ElevenLabs synthetic speech: human detection **43%** (chance level) | arXiv 2608.19959 | Cannot rely on human ears; need machine analysis |
| Partial spoofs (AI sentence in real speech): detection **22.65%** | Same | Even harder when embedded in genuine speech |
| Cybersecurity-trained participants: **37.5%** accuracy (worse than random) | arXiv 2602.20061 | Training doesn't help; only automated detection works |
| XGBoost/Random Forest detect AI speech in **0.004–0.057ms** | arXiv 2308.12734 | Real-time classification is feasible |
| Spectral flux is dominant marker of confident vs. doubtful speech | eGeMAPS research | Works across human AND AI voices (0.65 cross-source accuracy) |

### Lip-Sync Verification

| Finding | Source | Implication |
|---------|--------|-------------|
| LipFD: **95.3% accuracy** detecting lip-sync deepfakes | NeurIPS 2024 | Best-in-class for lip-forgery detection |
| **90.2%** in real-world video calls (WeChat) | Same | Deployable in production video calls |
| Method: phoneme-viseme alignment + lip-head coupling | Same | Biological link between lips and head breaks in fakes |

### Physiological Signals (No Extra Hardware)

| Signal | Method | Accuracy | Source |
|--------|--------|----------|--------|
| Heart rate | Remote PPG from facial video | **3.16 bpm** mean error | DDPM dataset |
| Heart rate as deception indicator | — | **Most reliable** physiological signal | DDPM + card game study |
| Blink rate | MediaPipe Eye Aspect Ratio | Increases in free recall (32.5/min), decreases in unexpected questions (27.1/min) | Springer 2020 |
| Blink rate for liar/truth-teller | — | **No significant difference** alone | Same — must combine with other signals |
| Micro-expressions | Frame-by-frame classification | **Random accuracy** alone | DDPM baseline |

### BAVA Framework (South Korea's Supreme Prosecutors' Office)

Operationalizes deception detection into 4 observable factors:
1. **Cognitive load** → speech disfluencies, response latency, pauses
2. **Affective changes** → FACS-coded facial action units
3. **Autonomic arousal** → fidgeting, blinking, anxiety movements
4. **Impression management** → restrained body movements

**Key principle:** No single factor proves deception. All combined, never alone.

### Voice-Layer Decision

| Component | Decision | Rationale |
|-----------|----------|-----------|
| eGeMAPS 88-feature extraction | **Build** (Web Audio API) | Mature, standardized |
| Voice profile + deviation detection | **Build** | Simple statistical approach, real-time feasible |
| WPM + filler analysis | **Build** (Whisper timestamps) | Whisper is MIT, word-level timestamps available |
| Lip-sync verification | **Build** (LipFD-inspired) | 95.3% accuracy, code available |
| Remote PPG heart rate | **Build** (supplementary only) | 3.16 bpm error, no extra hardware |
| Voice deception detection | **Reject** | Scientifically discredited |
| Passive voice-clone detection | **Reject** | ElevenLabs defeats human detection; need active methods |

---

## Q9: Compliance Research (added 2026-10-10)

### Applicable Regulations

| Regulation | Scope | Key Requirements | Penalties |
|------------|-------|-----------------|-----------|
| **GDPR** (EU) Art. 9 | Biometric = "special category" | Explicit consent, data minimization, right to erasure, DPA | Up to 4% global revenue |
| **BIPA** (Illinois, US) | Face geometry, fingerprints | **Written consent before collection**, published retention policy | **$1,000–$5,000 per violation** (private right of action) |
| **CCPA/CPRA** (California) | Biometric identifiers | Right to know, delete, opt-out; access logging | Per-violation fines |
| **DPDP Act** (India, 2023) | Personal data incl. biometric | Free/specific/informed consent, purpose limitation, Hindi notices | Up to **₹250 crore** per incident |

### Compliance Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| 3 separate consent screens (never bundled) | GDPR Art. 9 + BIPA + DPDP §6 all require granular consent |
| Extract embedding, delete ID image in 24h | Data minimization (GDPR Art. 5) |
| Biometric data segregated from PII | BIPA "reasonable security" + GDPR integrity principle |
| Published retention policy before collection | BIPA §15(a) mandatory |
| Automated deletion (90-day video, 3-year biometric) | GDPR storage limitation + BIPA destruction deadline |
| "Delete my data" → 30-day purge | GDPR right to erasure |
| Audit log for every access | CCPA §1798.100 requirement |

---

## Updated Build vs Adopt Decision

| Component | Decision | Rationale |
|-----------|----------|-----------|
| Gaze tracking | **Build** on MediaPipe | Mature primitive, Apache-2.0 |
| Face detection | **Build** on MediaPipe | Same |
| Challenge-response | **Build** (GOTCHA-inspired) | Paper provides method, code available |
| Screen-flash test | **Build** (Gerstner & Farid) | Passive, browser-deployable, Sumanth approved |
| Voice stress meter | **Build** on Web Audio API | Simple prosody features, no deception claims |
| eGeMAPS voice profiling | **Build** | Standardized toolkit, real-time feasible |
| Lip-sync verification | **Build** (LipFD-inspired) | 95.3% accuracy, code available |
| Remote PPG | **Build** (supplementary) | 3.16 bpm error, no extra hardware |
| WPM + filler analysis | **Build** (Whisper) | MIT licensed, word timestamps available |
| AI Observer (LiveKit bot) | **Build** | Reuses existing LiveKit infra |
| Deepfake passive detection | **Reject** | Collapsed on 2025 generators |
| Demo proctoring repos | **Reject** | None production-ready |
| YOLO (Ultralytics) | **Reject** | AGPL-3.0 copyleft risk |
| Voice deception detection | **Reject** | Scientifically discredited |

---

## Architectural Implications

1. **Layered, human-in-the-loop.** No single autonomous "cheat detector."
2. **Evidence, not verdicts.** All output is for recruiter review.
3. **Interview first.** Nothing blocks the candidate from completing.
4. **Active > passive** for deepfakes (challenge-response + screen-flash + gaze).
5. **Interactive probing** is the most reliable anti-AI-cheating method.
6. **Voice layer is multi-signal.** eGeMAPS + WPM + lip-sync + PPG combined, never alone.
7. **Compliance is architectural.** Segregation, encryption, auto-deletion, and audit logging are system design requirements, not afterthoughts.
8. **Conservative flagging.** ≥0.85 confidence + 3+ corroborating signals. Target <2% false positive rate.
