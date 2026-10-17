# Competitive Analysis — Unified Interview Engine

**Date:** 2026-10-10
**Analyst:** Aria (Business Analyst, smart-sdlc Phase 1)
**Researcher:** Competitive research specialist (findings in `/tmp/competitive-research-findings.md`)
**Method:** smart-sdlc `market-research` — vendor-primary sources preferred; marketing claims flagged; unverifiable items marked UNVERIFIED.

---

## Executive Summary

📊 **Bottom line:** The AI-interview market has a trust-shaped hole. The category leader (HireVue) retreated from visual/behavioral analysis after regulatory action and paid $3.75M for biometric consent failures. The most aggressive integrity claimant (Talview) publishes no methodology. No competitor offers a unified engine across mock/screening/AI-interview/human-observed modes, candidate-facing reports, or published per-interview pricing. Rekrut AI's planned differentiators — consent-by-architecture, evidence-not-verdicts integrity, dual reports, one engine/four modes — map directly onto verified competitor gaps, not assumed ones.

---

## Competitor Profiles

### HireVue (category leader; acquired Modern Hire May 2023)

| Dimension | Finding | Source class |
|-----------|---------|--------------|
| Integrity signals | Webcam snapshots (identity only, not facial recognition), MOSS code-similarity, copy/paste disable, window-focus event logging (human-reviewer decision, not auto-verdict) | Vendor-stated ✅ |
| Consent/biometrics | Candidates "review and agree" before AI interview (post-2021). **$3.75M Illinois BIPA class-action settlement (2026)** — voice + facial biometrics collected Jan 2017–Jun 2026 without written consent | Legal filings ✅ |
| Scoring | **Transcript-based only since Jan 2021.** Facial-expression scoring discontinued after 2019 EPIC/FTC complaint | Vendor-stated ✅ |
| Pricing | Quote-gated. Third-party estimates ~$35k+/yr entry | UNVERIFIED ⚠️ |
| AI interviewer | Yes — 2026 "AI Interviewer": two-way **voice**-based conversational AI, dynamic follow-ups, IO-validated rubrics | Vendor-stated ✅ |
| Compliance infra | FedRAMP, SOC 2 Type II, ISO 27001, third-party algorithmic audits | Vendor-stated ✅ |

**Key lesson:** HireVue's 2021 retreat from facial analysis was an overcorrection — they abandoned visual signals entirely rather than making them defensible. Their BIPA exposure persisted *after* discontinuation (voice biometrics + retention). Consent and retention are the real battleground, not just which signals you collect.

### Talview (enterprise AI interviewer + proctoring)

| Dimension | Finding | Source class |
|-----------|---------|--------------|
| Integrity signals | Claims "real-time deepfake/AI-assistance detection," impersonation, mobile-phone use, screen mirroring, second-person detection, multi-camera, ID + liveness | Vendor marketing ⚠️ — **no public technical methodology** |
| Consent/biometrics | GDPR/CCPA alignment claimed in blogs; consent notices "before the exam begins" | Vendor blog ⚠️ — independent verification not found |
| Pricing | Quote-gated, "custom pricing" | UNVERIFIED ⚠️ |
| AI interviewer | Yes — "Talview Ivy": two-way conversational, competency-based, multilingual | Vendor-stated ✅ |

**Key lesson:** Strongest feature claims in the market, weakest verifiability. Their "38.5% of interviews flagged for AI cheating" stat is a third-party figure cited in vendor marketing — treat with caution.

### Spark Hire (SMB async video)

| Dimension | Finding | Source class |
|-----------|---------|--------------|
| Integrity signals | None documented | — |
| Pricing | Transparent: from ~$119/mo, unlimited interviews | Aggregators ✅ |
| AI interviewer | No — async video + AI summaries/transcription only | Vendor-stated ✅ |

**Key lesson:** Competes on price and simplicity, not intelligence. No integrity story at all.

### Willo (async screening, transparent pricing)

| Dimension | Finding | Source class |
|-----------|---------|--------------|
| Integrity signals | "Real Talk AI" — delivery-authenticity detection + ID verification, but **Enterprise-tier only** | Vendor-stated ✅ |
| Pricing | Transparent: Lite $59/live role/mo; Enterprise from $3,799/yr | Vendor-stated ✅ |
| AI interviewer | No — async one-way only, **no live interviews at all** | Vendor-stated ✅ |

**Key lesson:** Transparent pricing + async-only = SMB wedge. Integrity is a paywall feature, not a core promise.

### BarRaiser / Intervue.io (India, human-led IaaS)

| Dimension | Finding | Source class |
|-----------|---------|--------------|
| Model | Human experts conduct interviews; AI assists with highlights, scorecards, bias detection | Vendor-stated ✅ |
| Pricing | BarRaiser ~$6/interview (self-claimed vs rival); Intervue.io ~$50/mo | Mixed ⚠️ |
| Relevance | **Validates the human+AI-observer hybrid** — exactly what Rekrut's Human-with-AI-Observer mode plans | Analysis ✅ |

### PMaps (India, psychometric-first)

| Dimension | Finding | Source class |
|-----------|---------|--------------|
| Model | Psychometric assessments + EVA (voice-at-scale screening) + VITA (AI video) | Vendor-stated ✅ |
| Market signal | 20+ languages, mobile-first, frontline-volume hiring (BPO/banking/retail) | Vendor-stated ✅ |
| Relevance | Proves India demand for multilingual, mobile-first, high-volume AI assessment | Analysis ✅ |

### myInterview → Radancy (acquired Sep 2025)
Brand folded into Radancy's Talent Acquisition Cloud. No longer a standalone competitor. Historical pricing ($59–$349 tiers) is stale.

---

## Regulatory Landscape (verified, Oct 2026)

| Law/Rule | Jurisdiction | What it requires |
|----------|--------------|------------------|
| Illinois BIPA | Illinois | Written consent before biometric collection; private right of action |
| Illinois AI Video Interview Act (2020) | Illinois | Consent + explanation + 30-day deletion on request |
| NYC Local Law 144 (2023) | New York City | Independent bias audit; 10-day candidate notice |
| CA FEHA automated-decision rules (Oct 2025) | California | Vendor liability extends to employers; 4-year record retention |
| Illinois Human Rights Act AI amendment (Jan 2026) | Illinois | Discriminatory-effect AI use = civil rights violation |
| Colorado AI Act (Feb 2026) | Colorado | Algorithmic discrimination protections |
| Texas TRAIGA (Jan 2026) | Texas | AI governance requirements |
| EU AI Act | EU | High-risk AI system obligations (hiring = high-risk) |

**Net:** Consent, data minimization, published retention schedules, bias audits, and human-in-the-loop are statutory — not best practice. (Source: specialist research compiling digitalapplied.com and heymilo.ai legal trackers.)

---

## Differentiation Gaps (verified against competitor evidence)

| # | Gap | Evidence it's real | Rekrut AI's planned answer |
|---|-----|-------------------|---------------------------|
| 1 | **Biometric-consent-by-architecture** | HireVue paid $3.75M for consent failures; no competitor ships consent + retention schedule as a product feature | 3-screen consent flow; per-signal opt-in; published retention/destruction schedule |
| 2 | **Multimodal integrity as evidence, not verdicts** | HireVue retreated entirely (transcript-only); Talview claims detection with no methodology | $0-stack integrity layer; signals as reviewer-visible evidence; human review mandatory; no autonomous verdicts |
| 3 | **Candidate-facing reports** | No competitor publishes qualitative candidate feedback as standard output | Dual reports: recruiter (full) + candidate (qualitative, no pseudo-scores) |
| 4 | **One engine, four modes** | HireVue: no observer mode; Talview: no mock mode; Willo: async-only; BarRaiser: human-only | Mock / Screening / AI Interview / Human+AI-Observer on single configurable engine |
| 5 | **Transparent per-interview pricing** | HireVue/Talview quote-gated ($25k–$145k+/yr bands); India players prove per-interview works (₹249/interview) | Published pricing; per-interview option |
| 6 | **India-market fit** | No global vendor combines conversational AI + Indian-language coverage + low-bandwidth design | Multilingual, mobile-first, low-bandwidth resilience as core design |
| 7 | **Audit-ready explainability** | HireVue's explainability is enterprise-gated; scoring opaque | Every flag/score ships with underlying evidence (timestamps, transcript spans, signal values) |
| 8 | **Defensible behavioral layer** | Nobody offers structured behavioral observation (HireVue abandoned it; others never tried) | Stress indicators as candidate-wellbeing context, not deception verdicts; published scientific caveats |

---

## Threats to Watch

1. **HireVue's 2026 AI Interviewer** (voice-based, two-way) — closest to Rekrut's AI Interview mode; enterprise distribution advantage.
2. **Talview's Ivy** — most feature-complete rival; if they publish methodology, their integrity claims become harder to dismiss.
3. **Regulatory ratchet** — every new AI-hiring law raises the compliance bar; Rekrut's compliance-by-architecture is an asset only if it ships before enforcement bites.
4. **India IaaS players** (BarRaiser, Intervue.io) — own the human-interview outsourcing motion; Rekrut's AI Observer must clearly beat "human expert + AI notes."

---

## Implications for PRD (Phase 2)

1. FRs for consent must reference specific statutes (BIPA, AIVIA, NYC LL144, CA FEHA) — not generic "compliance."
2. Integrity FRs must specify **evidence-not-verdicts** as a hard requirement (this is the differentiator).
3. Candidate report FRs are a first-class deliverable, not a nice-to-have.
4. Pricing/packaging is a product decision Sumanth must make — it affects the engine's multi-tenancy design.
5. India-market requirements (languages, bandwidth, mobile) need explicit NFRs.
