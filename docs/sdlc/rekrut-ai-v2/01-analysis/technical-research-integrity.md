# Technical Research: Anti-Cheat / Integrity Layer for AI Video Interviews

**Date:** 2026-10-10
**Skill:** `smart-sdlc/1-analysis/technical-research`
**Method:** Structured research via `browser.deep_research` (7 research questions)
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
- Reading-like gaze sweeps
- Response-latency variance
- Interactive follow-ups (industry consensus: most reliable probe)

### Q3: Voice-based deception/stress detection

**What works:** Vocal prosody marks stress/cognitive load (raised F0, intensity). PLOS ONE 2025 systematic review confirms.

**What doesn't:** Deception detection. Layered Voice Analysis scientifically discredited:
- NRC 2003: "little or no scientific basis"
- NIJ 2007 field study: ~10% of lies caught, ~50% overall = chance
- Horvath 2013: 48% accuracy = chance

**Decision:** Ship stress/confidence meter. NEVER a "deception score."

### Q4: Real-time deepfake detection

| Approach | Accuracy | Notes |
|----------|----------|-------|
| Challenge-response (NYU GOTCHA) | 88.6% AUC human / 80.1% automated | 56k videos, code on GitHub |
| Active illumination (Gerstner & Farid) | Qualitative | Screen hue changes, 1-4 frame lag in fakes |
| Corneal reflection (Guo et al.) | Near-zero NCC for fakes | Needs good resolution |
| Gaze-behavior (Kohler et al.) | 82.5% acc / 88% AUC | Fakes can't mimic natural gaze |
| Passive CNN detectors | 94% → 48-62% on 2025 generators | **COLLAPSED on new generators** |

**Decision:** Use active methods (challenge-response + gaze). Don't rely on passive detectors alone.

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

## Build vs Adopt Decision

| Component | Decision | Rationale |
|-----------|----------|-----------|
| Gaze tracking | **Build** on MediaPipe | Mature primitive, Apache-2.0 |
| Face detection | **Build** on MediaPipe | Same |
| Challenge-response | **Build** (GOTCHA-inspired) | Paper provides method, code available |
| Voice stress meter | **Build** on Web Audio API | Simple prosody features, no deception claims |
| Deepfake passive detection | **Reject** | Collapsed on 2025 generators |
| Demo proctoring repos | **Reject** | None production-ready |
| YOLO (Ultralytics) | **Reject** | AGPL-3.0 copyleft risk |

---

## Architectural Implications

1. **Layered, human-in-the-loop.** No single autonomous "cheat detector."
2. **Evidence, not verdicts.** All output is for recruiter review.
3. **Interview first.** Nothing blocks the candidate from completing.
4. **Active > passive** for deepfakes.
5. **Interactive probing** is the most reliable anti-AI-cheating method.
