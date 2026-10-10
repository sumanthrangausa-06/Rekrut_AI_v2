# Failure Mode Analysis — Unified Interview Engine

**Date:** 2026-10-10
**Analyst:** Aria (Business Analyst, smart-sdlc Phase 1)
**Researcher:** Failure-mode specialist (74 modes via divergent→convergent ideation, `superpowers/brainstorming` methodology; raw findings in `/tmp/failure-mode-findings.md`)
**Scoring:** Likelihood Low=1 / Med=2 / High=3; Impact Low=1 / Med=2 / High=3 / Critical=4. Risk = L×I.
**Gate:** 🚫 = launch blocker · 🔧 = post-launch hardening.

---

## Executive Summary

📊 **Bottom line:** 74 failure modes identified; 44 are launch blockers. The two highest risks (score 12) are both about the *human* side of the integrity pipeline — **false positives on legitimate candidates (I1)** and **recruiter misinterpretation of evidence (O3)**. The conservative-flagging + mandatory-human-review design is correct, but it concentrates the hardest risks in candidate experience and reviewer judgment, which is where Phase 2/3 design effort must go. The densest blocker clusters: integrity fairness (I1/I9/I13), consent/compliance (C1/C2/C9), and core session reliability (T3/T11/T12).

---

## Top-10 Risk Register

| Rank | Failure mode | L×I | Highest-leverage mitigation |
|---|---|---|---|
| 1 | **I1 — False positive: legitimate candidate flagged** | 12 | Candidate explanation channel + diverse calibration data + disparate-impact monitoring as a launch metric |
| 2 | **O3 — Recruiter misinterprets integrity evidence** | 12 | Evidence UX for non-experts (plain language, confidence ranges, mandatory context field) + reviewer attestation before adverse action |
| 3 | **T3 — Network drop severs LiveKit session** | 9 | Server-persistent session state; auto-reconnect with resume-at-same-question; defined reschedule policy |
| 4 | **T7 — Groq free-tier rate limits at 100 concurrent sessions** | 9 | Throughput-vs-tier load model in design; concurrency governor + start queue; throttle-vs-upgrade decided before launch |
| 5 | **T11 — iOS Safari incompatibilities** | 9 | Real-iPhone verification gate on every media change; documented iOS capability matrix |
| 6 | **I13 — No per-candidate baseline; anxiety misread as deception** | 9 | Warm-up calibration period; normalize against self, never against population |
| 7 | **U8 — Surveillance anxiety degrades performance (systematic bias)** | 9 | Legibility-by-design: transparent "what we measure and why," practice mode, visible signal status; anxiety as fairness metric |
| 8 | **O5 — Deploy during active interviews kills sessions** | 9 | Externalize session state from restarted processes; pre-deploy active-session check with abort threshold |
| 9 | **C9 — AI Observer undisclosed in human interviews** | 8 | Separate explicit observer-consent item; persistent recording indicator; decline → observer-free interview |
| 10 | **C2 — Recording-consent jurisdiction violations** | 8 | Strictest-applicable-rule default (explicit all-party consent); jurisdiction matrix reviewed by counsel pre-launch |

---

## 1. Technical Failures (20 modes)

**Theme:** Session reliability is the foundation — nothing else matters if the interview itself breaks.

| # | Failure mode | L | I | Mitigation | Gate |
|---|---|---|---|---|---|
| T1 | Camera drops mid-interview | Med | High | Defined degraded state: pause, reconnect prompt, auto-resume; gap marked "unavailable," never "suspicious" | 🚫 |
| T2 | Microphone drops mid-interview | Med | High | Same degraded-state pattern; pre-interview mic check; reschedule if unrecoverable | 🚫 |
| T3 | Network drop / ICE failure severs LiveKit session | High | High | Auto-reconnect with backoff + server-side session persistence; max-gap reschedule policy | 🚫 |
| T4 | LiveKit room/token dispatch failure | Low | Critical | Retry with fresh token; pre-flight room-health check; one-click retry + support path | 🚫 |
| T5 | LiveKit Cloud free-tier limits hit under load *(ASSUMPTION: caps unverified)* | Med | High | Capacity model before launch; hard cap + waitlist; usage alerts at 70% | 🚫 |
| T6 | Groq LLM API outage | Low | Critical | Provider fallback chain; graceful pause-and-resume, never a dead silent room | 🚫 |
| T7 | Groq free-tier rate limits at 100 concurrent sessions *(ASSUMPTION)* | High | High | Load-model token throughput vs tier limits; concurrency governor; decide before launch | 🚫 |
| T8 | Context window overflow on long interviews | Med | Med | Rolling summarization; cap interview length by design | 🔧 |
| T9 | Cartesia TTS outage | Low | High | TTS fallback; text-fallback mode; never a silent room | 🚫 |
| T10 | MediaPipe WASM fails on low-end phones | Med | Med | Progressive enhancement; pre-flight capability check → reduced-signal mode | 🔧 |
| T11 | iOS Safari incompatibilities *(Sumanth tests on iPhone; prior iOS audio issues)* | High | High | iOS-first test gate on every media change; documented capability matrix | 🚫 |
| T12 | Browser refresh loses session state | Med | High | Server-authoritative state with client checkpointing; explicit resume affordance | 🚫 |
| T13 | AI voice inaudible while mic works *(occurred before on iOS)* | Med | High | Pre-interview audio loopback test; runtime audio-health heartbeat; one-tap escape hatch | 🚫 |
| T14 | Client/server timestamp skew misaligns signals | Med | Med | Server timestamps on ingest; client sends monotonic offsets only | 🔧 |
| T15 | Neon Postgres pool exhaustion at 100 sessions *(ASSUMPTION)* | Med | High | Per-session connection budget; pooler sizing verified under load test | 🚫 |
| T16 | Express monolith overload under peak | Med | Critical | Load test to 100+ sessions; defined shedding order (integrity signals shed first) | 🚫 |
| T17 | STT cascade latency/failure | Med | Med | Per-tier timeout budgets; partial-transcript acceptance; per-mode latency SLOs | 🔧 |
| T18 | MediaPipe download timeout on slow mobile data | Med | Med | Lazy-load after interview starts; service-worker cache; reduced-signal fallback | 🔧 |
| T19 | Mobile OS kills backgrounded tab | Low | High | Wake-lock API; rejoin-via-link recovery | 🔧 |
| T20 | Timezone/scheduling errors *(known Asia/Kolkata issue family)* | Med | High | UTC storage; explicit named-timezone rendering with double confirmation | 🚫 |

**Structural note:** The $0-infra constraint concentrates risk in free-tier quotas (T5/T7). A **quota/cost model is a prerequisite design artifact** for Phase 3, not an ops afterthought.

---

## 2. Integrity Failures (19 modes)

**Theme:** Conservative flagging (≥0.85 confidence + 3+ signals, human review mandatory) is the right posture — but it makes false positives the dominant risk and false negatives an accepted residual.

| # | Failure mode | L | I | Mitigation | Gate |
|---|---|---|---|---|---|
| I1 | **False positive: legitimate candidate flagged** (nerves, disability, cultural gaze norms, lighting) | High | Critical | Candidate explanation channel; diverse calibration data; disparate-impact monitoring as launch metric | 🚫 |
| I2 | False negative: sophisticated cheater missed *(accepted tradeoff)* | High | Med | Document as accepted residual risk; never silently upgrade thresholds to chase recall | 🔧 |
| I3 | Second screen / second device off-camera | High | Med | Reading-pattern + latency signals; randomized question order; standard environment scan | 🔧 |
| I4 | Hidden earpiece / audio feed | Med | Med | Voice-latency anomaly detection; randomized follow-up probing | 🔧 |
| I5 | Real-time deepfake / face-swap | Low | Critical | Active liveness challenges; lip-sync + voice cross-checks; never rely on passive detectors alone | 🔧 |
| I6 | Virtual camera spoofing (OBS feeding pre-recorded video) | Med | High | Device-label heuristics + challenge-response liveness ("hold up N fingers"); signal, not verdict | 🚫 |
| I7 | AI-generated answers read aloud | High | Med | Reading-pattern detection + latency baselines; randomized deep follow-ups | 🔧 |
| I8 | Off-camera human proxy coaching *(Sumanth's explicit attack vector)* | Med | High | Multi-face detection + "main candidate" continuity; audio diarization; flag for human review | 🚫 |
| I9 | Gaze tracking penalizes disability/neurodivergence/cultural norms | Med | Critical | Accommodation path by design; gaze never standalone; fairness review of signal weights pre-launch | 🚫 |
| I10 | Poor lighting misread as evasive | High | Med | Pre-interview lighting check; hard rule: absent data ≠ suspicious data | 🚫 |
| I11 | Low-quality mic → voice features unusable | Med | Med | Pre-flight mic gate; graceful degradation to unavailable | 🔧 |
| I12 | Lip-sync false positive from compression artifacts | Med | High | Compression-aware thresholds; never standalone flag | 🚫 |
| I13 | **No per-candidate baseline; first-session anxiety misread as deception** | High | High | Warm-up calibration period; normalize against self, not population | 🚫 |
| I14 | Network latency misread as AI-assistance latency | Med | High | Subtract measured RTT/jitter; disable latency features on poor networks | 🚫 |
| I15 | Screening question bank leaks to cheating forums | High | Med | Question rotation + parameterized variants; screening as filter, not verdict | 🔧 |
| I16 | Prompt injection via spoken answers | Low | High | Transcript/system-prompt sanitization boundary; injections logged as integrity events | 🔧 |
| I17 | Signal gaming (candidate performs "clean" signals) | Low | Med | Undisclosed signal set; multi-channel fusion; periodic rotation | 🔧 |
| I18 | Multiple faces in frame; unclear who is the candidate | Med | High | Continuous multi-face monitoring; pause + human review, never auto-fail | 🚫 |
| I19 | Voice inconsistency across sessions (different person) | Med | Med | Cross-session voiceprint comparison; mismatch → human review | 🔧 |

**Structural note:** Fairness modes (I1/I9/I13) form the densest blocker cluster. The PRD must treat **fairness as a first-class requirement**, not a QA checkbox.

---

## 3. UX Failures (12 modes)

**Theme:** The consent flow and the feeling of being watched are the two UX risks that double as compliance and fairness risks.

| # | Failure mode | L | I | Mitigation | Gate |
|---|---|---|---|---|---|
| U1 | 3-screen consent causes drop-off | Med | Med | Plain-language copy (8th-grade level); progress indicator; funnel measured post-launch | 🔧 |
| U2 | Consent declines flood human-interview queue | Med | Med | Decline as first-class path with wait estimates; decline-rate KPI with copy-review trigger | 🔧 |
| U3 | Liveness challenges confuse on mobile | Med | Med | Demo animation before each challenge; generous retry; skip-with-human-review escape | 🔧 |
| U4 | Screen-reader users blocked by camera challenges | Med | High | Non-visual equivalent for every visual challenge; accessibility audit pre-launch | 🚫 |
| U5 | Motor-impaired candidates blocked by movement challenges | Low | High | Alternative modalities (verbal); self-declared accommodation path without penalty | 🚫 |
| U6 | Mobile layout breakage *(prior Quick Practice scroll issues)* | Med | High | Mobile-first gate with real-device matrix; no critical control below fold at 375px | 🚫 |
| U7 | English-only challenges disadvantage non-native speakers | Med | High | Explicit language disclosure; human-interview alternative; phased i18n | 🔧 |
| U8 | **Surveillance anxiety degrades performance (systematic bias)** | High | High | Legibility-by-design: transparent measurement disclosure, practice mode, visible status; anxiety as fairness metric | 🚫 |
| U9 | Silent device failure — candidate in a dead room | Med | High | Persistent device-health indicators; auto-pause with recovery prompt on track failure | 🚫 |
| U10 | Low-bandwidth candidates excluded | Med | High | Adaptive quality ladder to audio-only; audio-only scored fairly, never "suspicious" | 🚫 |
| U11 | Notification deep-links fail *(prior issue family)* | Low | Med | Session resume tokens in links; in-app list as reliable entry point | 🔧 |
| U12 | "Black box" outcome — candidate never learns what influenced their result | Med | Med | Candidate report includes plain-language integrity summary + appeal path | 🔧 |

---

## 4. Compliance Failures (11 modes)

**Theme:** Disclosure and jurisdiction are the clusters. The 3-screen consent flow is load-bearing for compliance, not just UX.

| # | Failure mode | L | I | Mitigation | Gate |
|---|---|---|---|---|---|
| C1 | Minor candidates: biometric consent validity | Med | Critical | Age gate; parental-consent path or biometric-free track; jurisdictional thresholds in config | 🚫 |
| C2 | Recording-consent law violations (one-party vs two-party states; India; EU) | Med | Critical | Strictest-applicable-rule default; jurisdiction matrix reviewed by counsel pre-launch | 🚫 |
| C3 | Retention violations: deletion cron misconfigured | Med | High | Retention as code: TTLs + deletion jobs with success alerting; quarterly audit report | 🚫 |
| C4 | Data breach of biometric tables | Low | Critical | Encryption at rest/in transit; least privilege; store features not raw video; breach runbook pre-launch | 🚫 |
| C5 | Cross-border transfer violations (India DPDP + EU GDPR) | Med | High | Data-residency decision in design; transfer mechanisms chosen pre-launch | 🚫 |
| C6 | No DSAR pipeline across 5 new tables + vendor copies | Med | High | DSAR-by-design: single export/delete routine; 30-day SLA tracked | 🔧 |
| C7 | Vendor without zero-data-retention processes candidate data *(Cohere flagged)* | Med | Critical | Remove/replace Cohere pre-launch; approved-vendor list with ZDR attestation | 🚫 |
| C8 | Subprocessors undisclosed in consent | Med | Med | Subprocessor list generated from architecture; embedded in consent copy; change-process | 🚫 |
| C9 | **AI Observer undisclosed in human interviews** | Med | Critical | Separate explicit observer-consent item; persistent recording indicator; decline → observer-free | 🚫 |
| C10 | Interviewer voice recorded without consent | Med | High | Interviewer consent at account setup + per-session notice | 🚫 |
| C11 | Audit log gaps in disputes | Low | High | Append-only `biometric_audit_log`; access logging on all biometric reads | 🔧 |

---

## 5. Operational Failures (12 modes)

**Theme:** The interview must survive deploys, provider outages, and reviewer error.

| # | Failure mode | L | I | Mitigation | Gate |
|---|---|---|---|---|---|
| O1 | AI Observer bot crashes mid-interview → silent gap | Med | Med | Supervisor auto-restart; gap explicitly marked in timeline; interview never depends on bot | 🔧 |
| O2 | Report generation failure → recruiter gets nothing | Med | High | Decouple capture from generation; retry with backoff; "report pending" + raw transcript fallback | 🚫 |
| O3 | **Recruiter misinterprets integrity evidence → wrongful rejection** | High | Critical | Evidence UX for non-experts; confidence as ranges; mandatory context; reviewer attestation; training guide | 🚫 |
| O4 | Demand exceeds 100-session target | Med | High | Hard concurrency cap + graceful waitlist; alert at 80%; pre-made scale-up decision | 🔧 |
| O5 | Deploy kills active interviews | High | High | Externalize session state; pre-deploy active-session check with abort threshold | 🚫 |
| O6 | No monitoring — failures discovered by candidates | High | Med | Minimum viable observability at launch: error rates, latency dashboards, failure-spike alerts | 🚫 |
| O7 | Free-tier quota overrun → surprise bills *(violates $0 contract)* | Med | High | Per-provider usage meters with hard stops; 70/90% alerts; monthly cost review ritual | 🚫 |
| O8 | Silent LLM model drift | Med | Med | Pin model versions; golden-interview regression on schedule | 🔧 |
| O9 | Migration failure adding 5 new tables | Low | High | Existing migration-QA practice (empty-DB + rollback); backward-compatible migrations | 🔧 |
| O10 | Backup/restore never tested for biometric tables | Low | High | Restore drill on staging copy pre-launch; defined RPO/RTO | 🔧 |
| O11 | Recruiter overrides flags without rationale | Med | High | Override requires written rationale, logged immutably; override-rate monitoring | 🚫 |
| O12 | No incident runbook | Med | Med | One-page runbook pre-launch: pause authority, candidate comms template, data preservation | 🔧 |

---

## Gate Summary

**44 launch blockers.** Densest clusters: integrity fairness (I1/I9/I13), consent/compliance (C1/C2/C9), session reliability (T3/T11/T12).
**30 post-launch hardening.** Adversarial modes are near-all 🔧 by design — false negatives are accepted residual risk.

## Phase 2/3 Design Implications

1. **Fairness is a first-class requirement** — disparate-impact monitoring, accommodation paths, per-candidate baselines belong in the PRD, not QA.
2. **Evidence UX is a design discipline** — O3 means the recruiter report needs as much design rigor as the integrity engine itself.
3. **Quota/cost model is a Phase 3 prerequisite** — T5/T7/O7 can't be answered in ops; they need design-time numbers.
4. **Consent flow is load-bearing** — C8/C9/U1/U2 mean the 3-screen flow must be designed with counsel input, not just UX copy.
5. **Assumptions to verify in Phase 3:** LiveKit Cloud free-tier caps, Groq TPM/RPM vs 100 sessions, Neon pool limits, Cartesia free-tier terms.
