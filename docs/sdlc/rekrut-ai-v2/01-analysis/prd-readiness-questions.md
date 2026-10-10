# PRD Readiness Questions — Unified Interview Engine

**Date:** 2026-10-10
**Analyst:** Aria (Business Analyst, smart-sdlc Phase 1)
**Purpose:** Product questions that must be answered before Phase 2 (PRD) can be written completely. Grounded in Phase 0 (Scout's relearn) + Phase 1 (integrity research, competitive analysis, failure-mode analysis).
**Status:** Awaiting Sumanth's answers. Items marked 🔴 block PRD completeness; 🟡 can be decided during PRD drafting with a documented assumption.

> Note: Questions Sumanth already answered (mode outputs, integrity posture, consent-decline path, retention direction, $0 budget, 100 sessions) are NOT repeated here. These are the genuinely open ones Phase 1 surfaced.

---

## 1. Commercial & Packaging

### Q1. Pricing model 🔴
Competitive analysis found quote-gated enterprise pricing ($25k–$145k/yr) is the norm, but India players prove per-interview pricing works (₹249/interview), and transparent pricing is a verified differentiation gap.
**Question:** Per-interview pricing, tiered subscription, or enterprise-quote? This affects multi-tenancy and metering design in Phase 3 — it can't be deferred.
**Options:** (a) Per-interview published pricing (b) Tiered subscription (c) Enterprise quote-gated (d) Freemium + paid tiers

### Q2. Launch market: India, US, or both? 🔴
PMaps proves India demand for multilingual mobile-first assessment. US has the strictest AI-hiring laws (BIPA, NYC LL144, CA FEHA). Building for both from day one doubles compliance and i18n scope.
**Question:** Is India a launch market or phase 2? If launch: which languages are must-have vs nice-to-have?
**Why it blocks:** Determines NFRs for languages, bandwidth, compliance regimes.

---

## 2. Integrity & Fairness

### Q3. event_type vocabulary 🔴
Rex drafted 14 integrity event types (`gaze_away`, `face_absent`, `multiple_faces`, `tab_switch`, `challenge_issued`, `challenge_failed`, `voice_deviation`, `lip_sync_fail`, `reading_pattern`, `latency_anomaly`, `zero_hesitation`, `screen_flash_anomaly`, `signal_gap`, `signal_unavailable`).
**Question:** Approve the 14 as-is, or add/remove/rename?

### Q4. Fairness bar 🔴
Failure analysis (I1/I9/I13) identified false positives on legitimate candidates as the #1 risk. Mitigations include disparate-impact monitoring, accommodation paths, per-candidate baselines.
**Question:** What is our fairness commitment at launch? Specifically: (a) Do we ship disparate-impact monitoring as a launch metric? (b) What accommodation paths are guaranteed (disability, neurodivergence, cultural gaze norms)? (c) Is the warm-up calibration period mandatory?
**Why it blocks:** These are PRD-level requirements, not QA tasks.

### Q5. Candidate appeal path 🟡
If a candidate disputes an integrity finding (U12), what happens?
**Question:** Is there a formal appeal/review process? Who reviews? What SLA?
**Recommendation:** At minimum, candidate report includes plain-language integrity summary + "request human review" path.

### Q6. AI-interviewer modality 🟡
HireVue's flagship 2026 AI Interviewer is **voice-based**, not video-avatar. Our design assumes video (MediaPipe load).
**Question:** Should the AI Interviewer be video-first, voice-first, or candidate's choice? Voice-first dramatically reduces client compute and iOS risk.

---

## 3. Compliance & Legal

### Q7. Legal review timing 🔴
Compliance analysis produced a jurisdiction matrix (BIPA, AIVIA, NYC LL144, CA FEHA, Colorado AI Act, EU AI Act, India DPDP) and flagged indefinite retention of biometric-derived data as legally risky. Sumanth requested global compliance.
**Question:** Do we engage counsel before PRD (to lock requirements) or run legal review in parallel with Phase 3 (and accept rework risk)?
**Recommendation:** At minimum, counsel reviews the consent flow and retention schedule before Phase 3.

### Q8. Minor candidates 🟡
Campus recruiting means under-18 candidates. Biometric consent validity for minors varies by jurisdiction (C1).
**Question:** Do we support minor candidates at launch? If yes: age gate + parental consent path, or biometric-free interview track?

### Q9. Interviewer consent 🟡
Two-party consent laws cut both ways — the interviewer's voice is recorded too (C10).
**Question:** Capture interviewer consent at account setup, per-session, or both? Is there an observer-muting option where consent is absent?

### Q10. AI Observer disclosure wording 🔴
C9: the AI Observer in human interviews must be explicitly disclosed. This is a separate consent item, not buried in general terms.
**Question:** Approve the principle that observer disclosure is a standalone explicit consent per session, with decline → observer-free interview? (Wording can be drafted in Phase 2.)

---

## 4. Technical Inputs (need product decisions before architecture)

### Q11. Cohere removal 🔴
Security/compliance analysis: Cohere free tier has no zero-data-retention without enterprise approval, and trial terms allow data use for R&D. Flagged for removal from the LLM fallback chain.
**Question:** Confirm removal of Cohere from the fallback chain? If yes, the fallback becomes Groq → (approved fallback TBD in Q12).

### Q12. LLM fallback when Groq fails/throttles 🔴
T6/T7: Groq outage or free-tier rate limits at 100 concurrent sessions would kill the AI interviewer.
**Question:** What is the approved fallback provider? (Must have ZDR or equivalent.) Options: (a) Self-hosted model (b) Another ZDR-capable provider (c) Graceful pause-and-resume with no fallback (accept downtime)

### Q13. Screening question authorship 🟡
Screening uses standardized per-job questions. I15: question banks leak to cheating forums.
**Question:** Who authors screening questions — recruiters per-job, platform-provided templates, or AI-generated from JD? Who owns rotation against leaks?

### Q14. Consent-decline SLA 🟡
Decline path → human interview is decided. U2: declines could flood the human-interview queue.
**Question:** Is there a target turnaround for human interviews offered after biometric decline? (Affects capacity planning, not engine design.)

### Q15. 100-session target: launch or design? 🟡
O4: what happens at 101 concurrent sessions?
**Question:** Is 100 concurrent sessions the launch capacity target (with waitlist beyond) or the architectural design point (with headroom)? This determines whether Phase 3 designs a concurrency governor.

---

## Question Priority for Phase Gate

**Must answer before Phase 2 starts:** Q1, Q2, Q3, Q4, Q7, Q10, Q11, Q12
**Can answer during Phase 2 drafting:** Q5, Q6, Q8, Q9, Q13, Q14, Q15

**Aria's assessment:** Q1 (pricing) and Q2 (launch market) are the two highest-impact unknowns — they shape the PRD's scope more than any other open question. Q4 (fairness bar) is the highest-risk unknown — getting it wrong is a HireVue-style event.

---

## Sumanth's Decisions (2026-10-10)

| # | Question | Decision |
|---|----------|----------|
| Q3 | event_type vocabulary | No change for now; improve later with dedicated research |
| Q4 | Fairness bar | **(c) Warm-up calibration ships at launch** (mandatory). **(a) Disparate-impact monitoring** → post-launch dashboard. **(b) Accommodation paths** → minimum manual override ("recruiter can dismiss flags with a reason") at launch. |
| Q5 | Legal review timing | Counsel reviews consent flow + retention schedule before Phase 3 |
| Q6 | AI Observer disclosure | **Corrected model:** Observer is recruiter's tool. Recruiter toggles on/off in interview setup. No separate candidate consent. Disclosed in general interview consent. |
| Q7 | Cohere removal | N/A — Cohere not in provider chain (verified in `lib/ai-provider.js`). No action needed. |
| Q8 | LLM fallback | Interview chain: Groq (ZDR on) → NIM/Cerebras (DPA verify) → graceful pause. Drop Kimi + OpenAI from interview chain until DPA confirmed. |
| Q2 | Launch market | Global vision; launch with USA + Europe + India. CTO recommends USA + India first, Europe phase 2 (build architecture for all three, defer EU-specific features). **Pending Sumanth confirmation.** |
| Q1 | Pricing model | **Research in progress** — business strategy brief to follow. |
