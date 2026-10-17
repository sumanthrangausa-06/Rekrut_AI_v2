# Whole-Application Compliance Blueprint — Rekrut AI v2

**Date:** 2026-10-10
**Author:** Compliance Research (reporting to Suga, CTO)
**Scope:** Entire Rekrut AI v2 platform — not just the interview engine
**Target markets:** USA, Europe, India

> ⚠️ **THIS IS RESEARCH, NOT LEGAL ADVICE.** This document synthesizes publicly available regulatory information to guide engineering planning. It does not constitute legal advice. Sumanth must engage qualified counsel in each jurisdiction before launch. Where facts could not be confirmed, they are marked **UNVERIFIED**.

---

## Executive Summary

Rekrut AI processes three high-risk data categories across three demanding jurisdictions:

| Data Category | Why It's High-Risk |
|---------------|-------------------|
| **Biometric data** (face, voice) | BIPA private right of action ($1k–$5k/violation); GDPR Art. 9 special category; EU AI Act prohibits emotion inference |
| **AI employment decisions** (screening scores, interview scores, OmniScore) | NYC LL144 bias audits; EU AI Act high-risk classification; Illinois AI discrimination ban; California ADMT rules |
| **Cross-border candidate data** (US↔EU↔India) | GDPR transfer mechanisms; DPDP permissible-country list (not yet published); BIPA extraterritorial reach |

**The single most important architectural fact:** Rekrut AI is both a **provider** (of the interview engine to recruiters) and a **deployer** (of LLM APIs, LiveKit, etc.). Under the EU AI Act, obligations attach to both roles. Under US law, the *employer* (our customer) is typically liable — but our contracts and product design determine whether liability flows back to us.

---

## Part 1: Jurisdiction-by-Jurisdiction Requirements

### 1.1 USA — Federal

#### FTC (Federal Trade Commission) — AI Claims Enforcement
- **"Operation AI Comply"**: 13+ enforcement actions since Sept 2024, ~$51M recovered. Every case targets **marketing deception** ("AI washing") — the gap between what vendors claim and what tools actually do.
- **What this means for us:** Every claim on our website, sales deck, and product UI about what the AI does ("detects cheating," "predicts job performance," "unbiased scoring") must be **substantiated**. Unsubstantiated AI capability claims = FTC Act Section 5 violation.
- **Engineering action:** Maintain a `claims-registry.md` mapping every public AI claim → the evidence (test results, paper citations, validation study). If we can't evidence it, we can't say it.
- **UNVERIFIED:** Whether FTC will extend enforcement from marketing claims to deployed agent behavior. (Congressional Research Service noted no federal guidance on agentic AI as of July 2026.)

#### EEOC — Title VII / ADA / ADEA Applied to AI
- AI hiring tools that produce **disparate impact** on protected classes violate Title VII — even if the employer didn't intend discrimination.
- **Employers are liable for third-party AI tools.** Our customers (employers) bear the risk, but they will demand indemnification and audit rights from us in contracts.
- EEOC has issued guidance on AI and disability discrimination in hiring.
- **Engineering action:** Build disparate-impact monitoring into the analytics layer (score distributions by demographic group). This is both a legal shield and a product feature.

#### No Federal Comprehensive AI Law
- As of 2026, there is **no US federal equivalent** of the EU AI Act. Regulation is state-led + agency guidance.
- Biden's 2023 AI Executive Order was partially rolled back in January 2025.

---

### 1.2 USA — Illinois (BIPA + HB 3773)

#### BIPA — Biometric Information Privacy Act (740 ILCS 14/)
**This is the highest-liability US law for Rekrut AI.** Private right of action + statutory damages + per-scan violation counting.

| Requirement | Section | Implementation |
|-------------|---------|----------------|
| **Written informed consent BEFORE collection** | §15(b) | Separate biometric consent screen (not buried in ToS). Must state: what is collected, specific purpose, length of retention. Electronic signature accepted (2024 amendment). |
| **Public written retention/destruction policy** | §15(a) | Published at `/privacy/biometric-policy`. Must state retention schedule. |
| **Destroy when purpose satisfied OR within 3 years of last interaction** (whichever first) | §15(a) | Automated deletion job. "Last interaction" = last login/interview, not account creation. |
| **No sale/lease/profit from biometric data** | §15(c) | Never sell biometric data. (We don't plan to.) |
| **No disclosure without consent** (except legal/financial-transaction exceptions) | §15(d) | Sending voice to Groq for STT = disclosure to third party → needs consent coverage + DPA. |
| **Reasonable standard of care** for storage/transmission | §15(e) | Encryption at rest + in transit, access controls. |

**Critical case law:**
- *Cothron v. White Castle* (2023): **Each biometric scan = separate violation.** Not one violation per person — one per collection event. A candidate doing 5 interviews = 5+ violations if consent was defective.
- Multiple entities can be liable for the same collection (we AND our customer could both be sued).
- Applies to Illinois residents **even if collection happens outside Illinois**.

**Penalties:** $1,000/negligent violation, $5,000/intentional or reckless violation. Class actions have produced 9-figure settlements.

**Engineering actions:**
1. `biometric_consents` table: `candidate_id`, `consent_text_version`, `consented_at`, `ip_address`, `purposes[]`, `retention_period`. Timestamped, versioned, per-person.
2. Consent gate: API middleware blocks biometric collection endpoints (`POST /api/interviews/*/frames`, voice upload) unless valid consent record exists. Return `403 CONSENT_REQUIRED` (already partially implemented per Scout's findings — verify coverage).
3. Public policy page: `/privacy/biometric-policy` with retention schedule.
4. Deletion job: `DELETE FROM biometric_* WHERE last_interaction < NOW() - INTERVAL '3 years'` — run daily.
5. Consent records retained **5 years** (claims window outlives the data).

#### Illinois HB 3773 — AI Employment Discrimination (effective Jan 1, 2026)
- **Bans AI with discriminatory effect** in recruitment, hiring, promotion, discharge, discipline.
- **Prohibits zip codes as proxies** for protected classes.
- **Requires notice** to employees/applicants when AI is used in employment decisions. (IDHR implementing rules pending — **UNVERIFIED** on final notice format.)
- **Engineering actions:**
  - AI-use disclosure in every candidate-facing flow where AI scores or filters.
  - Audit that no model input uses zip/postal code (check resume parser + screening).
  - Disparate-impact testing before launch for Illinois candidates.

---

### 1.3 USA — New York City (Local Law 144)

Applies when our **customer** (employer) uses our tool for NYC-based roles. We must enable *their* compliance.

| Requirement | Implementation |
|-------------|---------------|
| **Annual independent bias audit** (within 1 year of use) | We must provide audit-ready data exports + cooperate with customer's auditor. Cannot audit our own tool. |
| **Published audit summary** (on employer's website) | Provide template + data for customer to publish. |
| **10 business days' candidate notice** before AEDT use | Product feature: configurable notice period in recruiter's job setup. System blocks AEDT use until notice period elapsed. |
| **Disclose:** data collected, sources, retention policy | Product feature: auto-generated AEDT disclosure per job, publishable URL. |
| **Alternative selection process** on request | Product feature: candidate can request human-only review; recruiter dashboard shows request. |

**"AEDT" test:** Does the tool "substantially assist or replace discretionary decision-making"? Our screening scores, interview scores, and OmniScore **all qualify**.

**Audit shape** (per DCWP rules): impact ratios by sex, race/ethnicity, and intersectional categories; selection rates; sample sizes; auditor independence attestation.

**Engineering actions:**
1. `bias_audit_exports` — one-click export of anonymized scoring data by demographic group for auditor.
2. `aedt_notices` table — track per-candidate notice timestamps; enforce 10-day gate.
3. Auto-generated disclosure page per job posting.
4. "Request human review" button on candidate-facing score displays.

---

### 1.4 USA — California

#### CPPA ADMT Regulations (compliance by Jan 1, 2027)
Apply when ADMT is used for "significant decisions" (hiring, promotion, compensation, termination).

| Requirement | Implementation |
|-------------|---------------|
| **Pre-use notice** — specific purpose, opt-out/access rights, how ADMT works | Candidate-facing notice before first AI-scored interaction. Must be specific, not generic. |
| **Opt-out right** — OR human appeal alternative | Either: (a) "opt out of AI scoring" button, or (b) "appeal to human reviewer" path. The appeal path is easier to implement. |
| **Access right** — logic of ADMT, how personal info was processed | DSAR endpoint must include ADMT logic explanation (not just raw data). |
| **Risk assessment** before deploying ADMT | Internal document: `docs/compliance/ca-admt-risk-assessment.md`. Required before processing. |
| **4-year recordkeeping** (FEHA ADS regulations, effective Oct 1, 2025) | Retain selection criteria, outputs, audit findings for 4 years. |

#### CCPA/CPRA Data Rights
- Right to know, delete, correct, opt-out of sale/sharing, limit sensitive PI use.
- **Response SLA:** Acknowledge in 10 business days, respond substantively in 45 calendar days (extendable 45 more).
- **Biometric data = "sensitive personal information"** under CPRA → heightened protections + right to limit use.
- **Engineering actions:** DSAR pipeline (see Part 2, §2.6).

#### California SB 947 (effective Jul 1, 2027)
- No discipline/termination on automated system alone — human must corroborate.
- Relevant if we expand to performance management features. **Not a launch blocker.**

---

### 1.5 USA — Colorado, Texas, Connecticut

| Law | Effective | Key Requirements for Rekrut AI |
|-----|-----------|-------------------------------|
| **Colorado SB 26-189** (amended AI Act) | Jan 1, 2027 | Pre-use notice; plain-language explanation within 30 days of adverse outcome; data correction rights; human review where commercially reasonable. Narrower than original. |
| **Texas TRAIGA** | Jan 1, 2026 | Focuses on **intentional** discrimination (narrower than Illinois). Notice requirements. Lower compliance burden than IL/CA. |
| **Connecticut PA 26-15** | Oct 1, 2027 | Disclose technology, written pre-decision notice with purpose + data used. |

**Pattern:** All require some form of **notice + explanation + human review path**. If we build these three features well once, we cover most state laws.

---

### 1.6 EU — AI Act + GDPR

#### EU AI Act — Our Interview Engine IS High-Risk

**Classification:** Annex III, point 4 — "AI systems intended to be used for recruitment or selection of natural persons, including... evaluating candidates." Our AI Screening, AI Interview, and integrity scoring **all qualify**. No plausible carve-out.

**Prohibited practices** (in force since Feb 2, 2025):
- ❌ **Emotion inference in work/education contexts** — BANNED. Our "stress meter" and behavioral analysis must NOT infer emotions. (Already decided in research phase — this confirms it.)
- ❌ Biometric categorization inferring race, political opinions, etc.

**High-risk obligations** (effective Dec 2, 2027 per Regulation 2026/1744 — delayed from Aug 2026):

| Obligation | What It Means for Us |
|------------|---------------------|
| **Risk management system** (Art. 9) | Documented, continuous risk assessment across the AI lifecycle. |
| **Data governance** (Art. 10) | Training/validation data must be relevant, representative, error-free. Bias examination documented. |
| **Technical documentation** (Art. 11, Annex IV) | How the model works, training data, accuracy metrics, bias test results. |
| **Record-keeping / logging** (Art. 12) | Automatic event logging for traceability. |
| **Transparency** (Art. 13) | Instructions for use; deployer (our customer) must understand capabilities and limitations. |
| **Human oversight** (Art. 14) | Qualified human must oversee; can intervene or disregard AI output. Our "evidence for human review, never autonomous verdicts" design satisfies this. |
| **Accuracy, robustness, cybersecurity** (Art. 15) | Tested accuracy metrics; resilient to adversarial manipulation. |
| **Conformity assessment** (Art. 43) | Self-assessment (Module A) likely sufficient for our use case. **UNVERIFIED** — confirm with counsel. |
| **EU database registration** (Art. 49) | Register the system before deployment. |
| **Post-market monitoring** (Art. 72) | Continuous monitoring plan; incident reporting. |

**Transparency obligations** (Art. 50, in force Aug 2, 2026):
- Candidates must be told they are interacting with AI.
- AI-generated content must be labeled.

**Our dual role:**
- As **provider** (we built the interview engine): conformity assessment, technical documentation, EU registration.
- As **deployer** (we use Groq, LiveKit): human oversight, monitoring, inform candidates.

**Penalties:** Up to €15M or 3% global turnover (high-risk violations); €35M or 7% (prohibited practices).

#### GDPR — Candidate Data Processing

| Requirement | Implementation |
|-------------|---------------|
| **Lawful basis** (Art. 6) | Consent for biometric data (Art. 9 explicit consent — special category). Contract or legitimate interest for standard application data. **Document per-field basis in data map.** |
| **Biometric = special category** (Art. 9) | Face/voice for identification = Art. 9(1) biometric data. Requires **explicit consent** (higher bar than regular consent). Cannot rely on legitimate interest. |
| **Data subject rights** (Art. 12–22) | Access, rectification, erasure, portability, objection, restriction. **30-day response SLA.** |
| **DPIA** (Art. 35) | **Mandatory** — systematic evaluation using new technology + high risk to rights. Complete before launch. |
| **Breach notification** (Art. 33–34) | **72 hours** to supervisory authority. Notify individuals "without undue delay" if high risk. |
| **Cross-border transfers** (Chapter V) | US has no adequacy decision (post-Schrems II). Use **SCCs** + Transfer Impact Assessment. Neon and Render both offer SCCs. |
| **DPO** (Art. 37) | Required if core activity is large-scale systematic monitoring or large-scale special-category processing. **We likely trigger this.** Appoint or designate. |
| **Records of processing** (Art. 30) | Maintain ROPA (Record of Processing Activities). |
| **Data minimization** (Art. 5(1)(c)) | Collect only what's necessary. Challenge every field. |
| **Privacy by design** (Art. 25) | Build controls into architecture (already in Rex's design). |

---

### 1.7 India — DPDP Act 2023

**Status as of Oct 2026:** Rules notified Nov 13, 2025. **Phased enforcement:**

| Phase | Date | Status | What Goes Live |
|-------|------|--------|----------------|
| Phase 1 | Nov 14, 2025 | ✅ ACTIVE | Data Protection Board established; definitions |
| Phase 2 | Nov 13, 2026 | 🔜 COMING | Consent Manager framework operational |
| Phase 3 | **May 13, 2027** | 🔜 COMING | **Full obligations — NO grace period** |

**Sumanth's Jan 2027 India launch falls between Phase 2 and Phase 3.** We should build for Phase 3 now — there is no grace period when it hits.

| Requirement | Implementation |
|-------------|---------------|
| **Consent** (Sec. 6) | Must be free, specific, informed, unconditional, unambiguous. **Notice** must include: itemized data collected, specific purpose, how to withdraw consent, grievance redressal path, how to complain to the Board. Available in English + 22 scheduled languages on request. |
| **Withdrawal as easy as giving** | One-click consent withdrawal in candidate settings. Must actually stop processing (enforced in code, not just a flag). |
| **Data Principal rights** (Sec. 11–14) | Access, correction, **erasure**, grievance redressal, nomination. **NO portability right. NO right to object to automated decisions.** (Narrower than GDPR.) |
| **Breach notification** (Rule 7) | **72-hour** detailed report to Data Protection Board. **Immediate** notification to affected individuals. Stricter than GDPR on individual notification. |
| **Children's data** (Sec. 9) | Verifiable parental consent for under-18. **Do not process children's data without age-gating.** Campus recruiting = high risk. |
| **Reasonable security safeguards** (Sec. 8) | Encryption, access controls, logging. **1-year log retention** specifically required. |
| **Significant Data Fiduciary** | Extra obligations (DPIA, audits, DPO) if designated. Thresholds **UNVERIFIED** — monitor MeitY notifications. |
| **Cross-border transfers** | Permitted except to countries on a government blocklist. **Blocklist not yet published** (UNVERIFIED). Assume US transfers allowed until told otherwise. |
| **Penalties** | Up to **₹250 crore** (~$30M) per violation for security failures. ₹200 crore for children's data. ₹50 crore for breach notification failure. |

**Key difference from GDPR:** DPDP relies far more heavily on **consent** as the lawful basis (fewer alternatives). Our consent architecture must be robust.

---

## Part 2: Application-Wide Implementation Checklist

### 2.1 Candidate Data Collection (Profile, Resume, Application)

| # | Requirement | Implementation | Jurisdictions |
|---|-------------|---------------|---------------|
| 1 | Privacy notice at point of collection | `POST /api/candidates` returns notice version; frontend displays before form submit. Notice includes: data collected, purposes, retention, rights, DPO contact. | GDPR Art. 13, DPDP Sec. 6, CCPA |
| 2 | Per-field lawful basis documented | Data map: `docs/compliance/data-map.md` — every field → lawful basis → retention → delete path. | GDPR Art. 30, DPDP |
| 3 | No over-collection | Resume parser extracts only: name, contact, experience, education, skills. **Do not store:** photo from resume (unless candidate uploads separately with consent), date of birth (unless needed), full address (city/state sufficient). | GDPR minimization, DPDP purpose limitation |
| 4 | AI-use disclosure where AI processes application | "Your application may be screened using AI" notice on application form. Link to explanation. | IL HB 3773, NYC LL144, CA ADMT, EU AI Act Art. 50 |
| 5 | 10-day AEDT notice gate (NYC) | `aedt_notices` table; block AI screening until notice period elapsed for NYC roles. Configurable per job. | NYC LL144 |

### 2.2 Biometric Data (Face, Voice)

| # | Requirement | Implementation | Jurisdictions |
|---|-------------|---------------|---------------|
| 6 | Standalone biometric consent screen | **Separate screen**, not bundled with ToS. States: what (face geometry, voiceprint), why (identity verification, integrity analysis), how long (retention period). Electronic signature captured. | BIPA §15(b), GDPR Art. 9, DPDP Sec. 6 |
| 7 | Consent enforcement at API layer | Middleware `requireBiometricConsent` on: frame upload, voice upload, ID verification endpoints. Returns `403 CONSENT_REQUIRED` if no valid consent. **Test: consent withdrawal mid-session blocks further collection.** | BIPA, GDPR |
| 8 | Consent versioning | `biometric_consents`: `candidate_id`, `consent_text_version`, `consented_at`, `ip`, `purposes[]`. If consent text changes, re-consent required. | BIPA (prove consent), GDPR (accountability) |
| 9 | No emotion inference | Code review gate: no model output labeled "emotion," "sentiment," "stress level," "personality trait." Behavioral observations (gaze, WPM) are allowed; emotional interpretation is not. | EU AI Act Art. 5 (prohibited) |
| 10 | Raw biometric deletion | Face embeddings: delete within 24h of session end (or per purpose). Raw video: delete 90 days after hiring decision. ID images: delete within 24h of verification. **Automated jobs, not manual.** | BIPA §15(a), GDPR storage limitation |
| 11 | Public biometric retention policy | Page at `/privacy/biometric-policy`: what we collect, why, how long, when deleted, how to request early deletion. | BIPA §15(a) (must be public) |
| 12 | BIPA 3-year backstop | Daily job: `DELETE FROM biometric_* WHERE last_interaction < NOW() - INTERVAL '3 years'`. | BIPA §15(a) |
| 13 | Consent records retained 5 years | `biometric_consents` never auto-deleted before 5 years (claims window). | BIPA litigation defense |

### 2.3 AI Decision-Making (Screening Scores, Interview Scores, OmniScore)

| # | Requirement | Implementation | Jurisdictions |
|---|-------------|---------------|---------------|
| 14 | No fully automated hiring decisions | Every AI score feeds a human decision. UI enforces: recruiter must click "Advance" / "Reject" — no auto-reject based on score. **This is already in the PRD (no autonomous verdicts).** | EU AI Act Art. 14, CA ADMT, CO SB 26-189 |
| 15 | Explainability for candidates | When a candidate is rejected after AI scoring, provide: which factors contributed, in plain language. Not the model weights — a human-readable summary. `GET /api/candidates/me/decisions/:id/explanation`. | CA ADMT (access right), CO (30-day explanation), GDPR Art. 22 |
| 16 | Human appeal path | "Request human review" button on candidate portal. Routes to recruiter with SLA (e.g., 5 business days). `appeal_requests` table. | CA ADMT, CO SB 26-189, NYC LL144 |
| 17 | Bias audit readiness | `bias_audit_exports`: one-click anonymized export of scores by demographic group. Support NYC LL144 audit shape (impact ratios by sex, race/ethnicity, intersectional). | NYC LL144, IL HB 3773, EEOC |
| 18 | Disparate-impact monitoring dashboard | Internal dashboard: score distributions by demographic group, updated per scoring run. Alert on >20% deviation (4/5ths rule as initial threshold). | EEOC Title VII, IL HB 3773 |
| 19 | No zip code as model input | Audit resume parser + screening model: confirm no postal/zip code feature. Document in `docs/compliance/model-input-audit.md`. | IL HB 3773 (explicit ban) |
| 20 | FTC claims registry | `docs/compliance/ai-claims-registry.md`: every public claim about AI capability → evidence. Review quarterly. | FTC Act Section 5 |

### 2.4 Data Retention (Per Jurisdiction)

| Data Category | Retention Rule | Auto-Delete Job | Legal Basis |
|---------------|---------------|-----------------|-------------|
| Raw interview video/audio | 90 days after hiring decision | `purge_recordings` (daily) | BIPA purpose limitation, GDPR storage limitation |
| ID verification images | 24 hours after verification | `purge_id_images` (hourly) | BIPA, GDPR minimization |
| Face/voice embeddings | 24 hours after session (or per consent) | `purge_embeddings` (hourly) | BIPA §15(a) |
| Per-turn biometric vectors | Deleted with video (90 days) | Same as video | GDPR, BIPA |
| Aggregated behavioral scores | Indefinite (anonymized) | N/A — must be truly anonymous | **UNVERIFIED** — counsel must confirm "indefinite" is lawful |
| Integrity event timelines | Indefinite (pseudonymized) | N/A | **UNVERIFIED** — same as above |
| Interview transcripts | Duration of hiring process + 4 years | `archive_transcripts` | CA FEHA 4-year requirement |
| Screening/interview scores | Duration + 4 years | Same | CA FEHA, NYC LL144 audit |
| Consent records | 5 years after consent | `purge_consents` (5yr) | BIPA claims window |
| Application data (non-hired) | 2 years (or per jurisdiction) | `purge_applications` | GDPR, EEOC (1 year federal minimum for hiring records) |
| Audit logs (biometric access) | 5 years | `purge_audit_logs` (5yr) | BIPA, accountability |
| System logs (security) | 1 year | `purge_system_logs` (1yr) | DPDP Rules (1-year log retention) |

**⚠️ Open legal question:** "Indefinite" retention of aggregated scores and integrity timelines needs counsel sign-off. GDPR storage limitation and DPDP purpose limitation may not permit indefinite retention even of pseudonymized data.

### 2.5 Consent Flows (What Needs Explicit Opt-In)

| Consent | Placement | Can It Be in ToS? | Implementation |
|---------|-----------|-------------------|----------------|
| Biometric collection (face/voice) | **Standalone screen** before camera activates | ❌ No | `BiometricConsent.tsx` — separate from signup ToS |
| AI scoring of application | Application form notice | ⚠️ Notice sufficient (not opt-in) in most jurisdictions; explicit in IL | Banner + link to explanation |
| AI interview (voice/video analysis) | **Standalone screen** before interview starts | ❌ No | `InterviewConsent.tsx` — 3 screens (biometric, recording, AI analysis) |
| Recording of interview | Same as above (can combine) | ❌ No | Part of interview consent flow |
| Marketing communications | Checkbox (unchecked by default) | ❌ No — must be opt-in | Separate checkbox, not pre-ticked |
| Data sharing with employer | Application submit | ✅ Yes — inherent to applying | Covered in application ToS |
| Analytics/cookies | Cookie banner | ⚠️ Depends on jurisdiction | Granular toggles for non-essential |

**DPDP-specific:** Consent withdrawal must be as easy as giving. Implement `POST /api/candidates/me/consent/withdraw` that immediately stops processing (not just flags for later).

### 2.6 Data Subject Rights (DSR Implementation)

| Right | GDPR | DPDP | CCPA | Implementation |
|-------|------|------|------|----------------|
| Access / Know | ✅ 30 days | ✅ | ✅ 45 days | `GET /api/candidates/me/export` — JSON + human-readable PDF. Covers: profile, applications, scores, transcripts, consent records, integrity flags. |
| Rectification / Correction | ✅ | ✅ | ✅ | `PATCH /api/candidates/me` — candidate edits profile. Audit log of changes. |
| Erasure / Deletion | ✅ | ✅ | ✅ | `DELETE /api/candidates/me` — orchestrated fan-out (see privacy-engineer methodology). **Must reach:** primary DB, Neon backups (tombstone), R2/B2 storage, LiveKit recordings, Groq (no data retained if ZDR on), logs (scrub PII). |
| Portability | ✅ | ❌ | ❌ (limited) | Include in export endpoint (machine-readable JSON). |
| Objection / Opt-out | ✅ | ❌ | ✅ (sale/sharing) | `POST /api/candidates/me/preferences` — opt out of AI scoring (routes to human review). |
| Restriction | ✅ | ❌ | ❌ | `POST /api/candidates/me/restrict` — pause processing, retain data. |
| Grievance | ❌ | ✅ | ❌ | `POST /api/candidates/me/grievance` — routes to DPO/grievance officer. **DPDP requires grievance redressal mechanism.** |
| Nomination | ❌ | ✅ | ❌ | `POST /api/candidates/me/nominee` — designate who handles data after death/incapacity. **India-specific.** |

**SLA matrix:**
| Jurisdiction | Acknowledge | Respond |
|--------------|-------------|---------|
| GDPR | — | 30 days (extendable 60) |
| DPDP | — | Rules specify timelines — **UNVERIFIED**, assume 30 days |
| CCPA | 10 business days | 45 calendar days (extendable 45) |

**Engineering:** `dsr_requests` table tracks: `request_type`, `requested_at`, `due_at` (calculated per jurisdiction), `status`, `completed_at`. Automated SLA alerts at 75% of deadline.

### 2.7 Cross-Border Transfers

**Current architecture:** Neon (US), Render (US), LiveKit (US), Groq (US). Candidates in EU and India → data flows to US.

| Transfer | Mechanism | Status |
|----------|-----------|--------|
| EU → US (Neon) | SCCs (Neon's pre-signed DPA includes SCCs + DPF) | ✅ Available — execute Neon's DPA |
| EU → US (Render) | SCCs (Render DPA references DPF/SCCs) | ✅ Available — execute Render's DPA |
| EU → US (LiveKit) | LiveKit DPA | ✅ Available — accept during signup |
| EU → US (Groq) | Groq ToS + ZDR setting | ⚠️ Verify Groq's DPA covers GDPR transfers |
| India → US | DPDP permits except blocklisted countries | ✅ Assume allowed (blocklist not published — **UNVERIFIED**) |
| US → anywhere | No federal transfer restrictions | ✅ |

**Engineering actions:**
1. Execute/sign DPAs with: Neon, Render, LiveKit, Groq (4 DPAs).
2. Transfer Impact Assessment (TIA) document for EU→US flows.
3. Data residency: consider EU-region Neon/Render for EU customers post-launch (not a launch blocker).

### 2.8 Breach Notification

| Jurisdiction | Authority | Timeline | Individuals | Implementation |
|--------------|-----------|----------|-------------|----------------|
| GDPR (EU) | Supervisory authority | **72 hours** | Without undue delay (if high risk) | `incident_response` runbook |
| DPDP (India) | Data Protection Board | **72 hours** (detailed report) | **Immediately** (stricter than GDPR) | Same runbook, India-specific template |
| CCPA (California) | CA Attorney General | Per CA breach law: without unreasonable delay | Without unreasonable delay | Same runbook |
| BIPA (Illinois) | N/A (no breach notification in BIPA) | IL PIPA applies | Per IL Personal Information Protection Act | Same runbook |

**Engineering actions:**
1. `docs/compliance/incident-response-runbook.md` — who does what in first 72 hours.
2. Breach detection: anomalous access alerts on biometric tables.
3. Pre-drafted notification templates for each jurisdiction.
4. **DPDP requires 1-year log retention** — ensure logs survive for forensic analysis.

### 2.9 Vendor DPAs (Subprocessor Inventory)

| Vendor | Data Shared | DPA Status | Action Required |
|--------|-------------|------------|-----------------|
| **Neon** (PostgreSQL) | All candidate data | ✅ Pre-signed DPA available (includes SCCs, DPF) | **Execute DPA** |
| **Render** (hosting) | All application data | ✅ DPA available (DPF/SCCs) | **Execute DPA** |
| **LiveKit** (video/audio) | Real-time biometric streams | ✅ Published DPA | **Accept DPA** |
| **Groq** (LLM inference) | Interview transcripts (sanitized) | ⚠️ ZDR available via setting; DPA terms **UNVERIFIED** | **Enable ZDR + verify DPA** |
| **Cloudflare R2** (storage) | Recordings, ID images | ✅ DPA available (standard Cloudflare DPA) | **Execute DPA** |
| **Backblaze B2** (storage fallback) | Same as R2 | ⚠️ **UNVERIFIED** | **Verify DPA exists** |
| **Brevo** (email) | Candidate emails, notifications | ⚠️ **UNVERIFIED** | **Verify DPA exists** |
| **Cartesia** (TTS/STT) | Voice data for synthesis | ⚠️ **UNVERIFIED** | **Verify DPA + data retention** |

**Engineering action:** `docs/compliance/subprocessor-register.md` — living document listing every vendor, data shared, DPA status, review date. Update when adding any new vendor.

---

## Part 3: Prioritized Roadmap

### 🔴 Must-Have Before Launch (Legal Blockers)

These will get us sued or shut down if missing:

| # | Item | Effort | Owner |
|---|------|--------|-------|
| 1 | **Standalone biometric consent flow** (3 screens: biometric, recording, AI analysis) | M | Nova (Phase 4) |
| 2 | **Public biometric retention/destruction policy** at `/privacy/biometric-policy` | S | Aria (Phase 2) |
| 3 | **Consent enforcement middleware** — block biometric endpoints without valid consent | M | Nova (Phase 4) |
| 4 | **Automated biometric deletion jobs** (24h embeddings, 90-day video, 3-year BIPA backstop) | M | Nova (Phase 4) |
| 5 | **No fully automated hiring decisions** — human must click advance/reject | S | Already in PRD |
| 6 | **AI-use disclosure** on application form + before AI interview | S | Nova (Phase 4) |
| 7 | **No emotion inference** — code review gate | S | Ongoing |
| 8 | **Execute 4 vendor DPAs** (Neon, Render, LiveKit, Groq) | S | Suga (pre-launch) |
| 9 | **Enable Groq ZDR** in console settings | XS | Suga (pre-launch) |
| 10 | **DSAR export endpoint** (`GET /api/candidates/me/export`) | M | Nova (Phase 4) |
| 11 | **Deletion pipeline** (candidate data erasure across all systems) | L | Nova (Phase 4) |
| 12 | **DPIA** (Data Protection Impact Assessment) for interview engine | M | Aria + counsel |
| 13 | **Incident response runbook** (72-hour breach procedure) | S | Suga |
| 14 | **FTC claims registry** — evidence every public AI claim | S | Aria |
| 15 | **Warm-up calibration** (60-second baseline — also the #1 false-positive reducer) | M | Nova (Phase 4) |

### 🟡 Should-Have at Launch (Significantly Reduces Risk)

| # | Item | Effort | Owner |
|---|------|--------|-------|
| 16 | **NYC LL144 enablers:** bias audit export, 10-day notice gate, AEDT disclosure page | M | Nova (Phase 4) |
| 17 | **Human appeal path** ("Request human review" button) | S | Nova (Phase 4) |
| 18 | **Candidate explanation endpoint** (why was I scored this way?) | M | Nova (Phase 4) |
| 19 | **Disparate-impact monitoring dashboard** (internal) | M | Post-Phase 4 |
| 20 | **Consent withdrawal endpoint** (immediately stops processing) | S | Nova (Phase 4) |
| 21 | **Subprocessor register** (living document) | XS | Suga |
| 22 | **Transfer Impact Assessment** (EU→US) | S | Suga + counsel |
| 23 | **DPO designation** (may be required under GDPR Art. 37) | S | Sumanth (hire or designate) |
| 24 | **Age-gating** for under-18 candidates (DPDP children's data rules) | M | Nova (Phase 4) |
| 25 | **Grievance redressal endpoint** (DPDP requirement) | S | Nova (Phase 4) |
| 26 | **Nomination endpoint** (DPDP India-specific) | XS | Nova (Phase 4) |

### 🟢 Post-Launch (Can Iterate)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 27 | EU AI Act conformity assessment + EU database registration | M | Deadline Dec 2027 — start Q3 2027 |
| 28 | California ADMT compliance (pre-use notice, opt-out, risk assessment) | M | Deadline Jan 2027 |
| 29 | Colorado AI Act compliance | S | Deadline Jan 2027 — mostly covered by CA work |
| 30 | EU-region data residency option | L | For EU enterprise customers |
| 31 | Continuous bias monitoring (automated alerts) | M | Build on #19 |
| 32 | Consent Manager integration (India DPDP Phase 2) | M | Deadline Nov 2026 |
| 33 | Annual bias audit cycle (NYC LL144) | S/yr | Ongoing operational cost |
| 34 | Privacy-engineer automated PII scanning in CI | M | Catches PII in logs/traces |

---

## Part 4: Open Legal Questions (Need a Lawyer)

These are genuinely legal judgments that research cannot resolve:

| # | Question | Why It Needs Counsel | Jurisdiction |
|---|----------|---------------------|--------------|
| 1 | Is "indefinite" retention of **pseudonymized** integrity timelines and aggregated scores lawful? | GDPR storage limitation (Art. 5) and DPDP purpose limitation may prohibit indefinite retention even of pseudonymized data. This is a legal interpretation, not a technical decision. | EU, India |
| 2 | Does our "stress meter" (voice/pitch analysis) constitute **emotion inference** under EU AI Act Art. 5? | The line between "behavioral observation" and "emotion inference" is legally ambiguous. Getting this wrong = prohibited practice (€35M/7% penalty). | EU |
| 3 | Are we a **data controller or processor** for candidate data? (Or both, for different flows?) | Determines our direct obligations under GDPR. We process data on behalf of employers (processor-like) but also determine purposes for our own analytics (controller-like). | EU |
| 4 | Do we need a **DPO** under GDPR Art. 37? | Depends on whether our processing qualifies as "large-scale systematic monitoring" or "large-scale special-category processing." Borderline — needs legal assessment. | EU |
| 5 | Is Groq's free-tier ToS sufficient as a **DPA** for GDPR purposes? | We need to verify Groq offers a GDPR-compliant DPA (not just ToS + ZDR setting). If not, we may need enterprise tier or a different provider for EU data. | EU |
| 6 | Does **Cothron v. White Castle** (per-scan violations) apply to our session-based collection? | If each interview turn that captures a face frame = separate BIPA violation, our liability exposure is orders of magnitude higher than per-session counting. | Illinois |
| 7 | Can candidates **validly consent** to biometric collection as a condition of applying for a job? | BIPA allows "release executed by an employee as a condition of employment," but the power imbalance in hiring may affect consent validity under GDPR (which requires "freely given" consent). | EU, Illinois |
| 8 | What is our **employer-customer's liability** vs ours under each regime? | Our contracts need to allocate: who conducts bias audits, who responds to DSARs, who notifies breaches, who indemnifies whom. This is contract drafting, not research. | All |
| 9 | Does India's **Consent Manager framework** (Phase 2, Nov 2026) apply to us? | If we're required to integrate with a registered Consent Manager, that's a significant architectural change. The scope of "Data Fiduciary must integrate" is UNVERIFIED. | India |
| 10 | Are we a **Significant Data Fiduciary** under DPDP? | Triggers DPIAs, audits, DPO requirements. Designation criteria UNVERIFIED — monitor MeitY notifications. | India |

---

## Appendix: Key Dates

| Date | Event | Impact |
|------|-------|--------|
| **Now – Oct 2026** | Build phase | Implement must-haves |
| **Nov 13, 2026** | India DPDP Phase 2 (Consent Manager) | Assess if integration required |
| **Jan 1, 2027** | California ADMT compliance deadline | Pre-use notice, opt-out, risk assessment must be live |
| **Jan 1, 2027** | Colorado SB 26-189 effective | Notice + explanation + human review |
| **Jan 1, 2027** | Sumanth's India launch target | Must be DPDP-ready |
| **May 13, 2027** | India DPDP Phase 3 (full obligations, NO grace period) | Consent, rights, breach notification, children's data — all enforceable |
| **Dec 2, 2027** | EU AI Act high-risk obligations | Conformity assessment, EU registration, technical documentation |

---

## Sources

Key sources consulted (not exhaustive):
- BIPA requirements: recordinglaw.com, enzuzo.com, consumerclassdefense.com
- NYC LL144: osc.ny.gov (Comptroller audit Dec 2025), archuz.com, gibsondunn.com, darroweverett.com
- California ADMT: globalpolicywatch.com, skadden.com, mondaq.com, digitalapplied.com
- Illinois HB 3773: lexology.com, financialpoise.com, jdsupra.com
- Colorado/Texas: fountain.com (responsible AI hiring guide)
- EU AI Act: eureporter.co, myb2bnetwork.com, praxikon.com, Regulation (EU) 2026/1744
- DPDP Act: consentos.in, ruleexpert.com, barandbench.com, meity.gov.in, matters.ai
- FTC: forkast.news, mondaq.com, centrexit.com
- Breach notification: eigenlegal/counsel-os, dpdpconsultants.com
- Vendor DPAs: neon.tech, livekit.com, render.com (via public DPA documents)

---

*End of blueprint. Next step: Sumanth reviews → engages counsel on Part 4 questions → Aria incorporates requirements into PRD (Phase 2).*
