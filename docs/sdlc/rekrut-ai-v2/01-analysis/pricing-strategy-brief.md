# Pricing Strategy Brief — Rekrut AI Unified Interview Engine

**Date:** 2026-10-10
**Author:** Business strategy researcher → Suga (CTO) → Sumanth (Founder, decides)
**Status:** Recommendation only. Sumanth decides.
**Method:** `pricing-strategist` skill (model picker + packaging designer), web research Oct 2026. Unverifiable items marked UNVERIFIED.

---

## 1. Executive Summary

**Recommended model: Hybrid — subscription tiers with per-interview overage.**

The pricing-strategist model picker scored **Usage-Based (80/100)** and **Hybrid (80/100)** tied for best fit, driven by high usage variance across customers (a startup doing 20 interviews/mo vs an enterprise doing 5,000/mo). Pure seat-based subscription (58/100) leaves money on the table because a 5-recruiter team doing 1,000 interviews/mo creates 50× the value — and cost — of a 5-recruiter team doing 20/mo.

**The $0 marginal cost advantage is the strategic weapon.** Every competitor pays for GPU inference, per-minute video processing, or per-API-call LLM fees. Rekrut runs ML in the candidate's browser (free) and LLMs on Groq's free tier (free). Marginal cost per interview: ~$0.02–0.05. This means:

1. We can profitably price **below every competitor** while maintaining 95%+ gross margins.
2. We can offer a **genuine free tier** (not a loss leader) as a PLG acquisition channel.
3. Per-interview pricing doesn't create margin anxiety — competitors fear it because their costs scale; ours don't.

**Recommended tiers (details in §5):**

| Tier | USD | INR (approx) | Interviews/mo | Target |
|------|-----|--------------|---------------|--------|
| Free | $0 | ₹0 | 5 (screening) + unlimited mock | PLG acquisition |
| Starter | $49/mo | ~₹4,000/mo | 50 | Startups, SMBs |
| Professional | $199/mo | ~₹16,500/mo | 300 | Mid-market, agencies |
| Enterprise | Custom quote | Custom | Unlimited | 500+ employees |

**Per-interview overage:** $1.50/interview (~₹125). **India pay-as-you-go:** ₹199/interview, no subscription.

---

## 2. Competitive Pricing Landscape

### 2.1 Enterprise (quote-gated, $25k+/yr)

| Platform | Pricing | Model | Source |
|----------|---------|-------|--------|
| HireVue | ~$35k/yr Essential; $50k–$145k/yr Enterprise/Premium; +$15k–$40k implementation | Annual contract | Third-party estimates (pin.com, finalroundai.com, getkira.com) — UNVERIFIED, HireVue publishes nothing |
| Talview | ~$25k/yr (~₹21 lakh) | Annual contract + unit costs | eklavvya.com blog — UNVERIFIED |
| VidCruiter | Quote only | Enterprise | usebraintrust.com 2026 comparison |
| Paradox (Olivia) | Quote only | Enterprise | usebraintrust.com 2026 comparison |

**Pattern:** No published pricing, no free trial, multi-year contracts, $15k+ implementation fees. This is the "nobody gets fired for buying IBM" segment. **Rekrut should not compete here at launch** — we lack the compliance certifications (SOC 2, ISO 27001) and reference customers enterprise buyers require.

### 2.2 Mid-market (subscription, $100–$600/mo)

| Platform | Pricing | Model | Source |
|----------|---------|-------|--------|
| Spark Hire | $149/mo Lite → $249/mo Pro → $599/mo Team → Enterprise custom | Subscription (jobs/users) | saasworthy.com, getapp.com (Sep 2026) |
| Willo | $59/live role/mo Lite → $3,799/yr Enterprise | Per-role subscription | willo.video, hiretruffle.com (Aug 2026) |
| PMaps (India) | $100/mo Startup (20 invites) → $400/mo Grow (100 invites) → $1,500/mo Scale (500 invites) → Enterprise custom | Subscription (invites) | goodfirms.co, g2.com (2026) |
| TestGorilla | $142/mo Core → $400/mo Plus | Subscription | usebraintrust.com 2026 |
| Xobin | ~$249/mo (~$166/mo annual) | Subscription | GitHub market-research.md — UNVERIFIED |
| Interviewer.AI | $500–$850/yr (50–100 credits) | Credit pack | g2.com (Jul 2026) |
| Intervue.io | ~$50/mo | Subscription | slashdot.org — UNVERIFIED |
| OpenIntervue | ~$275/mo | Subscription | slashdot.org — UNVERIFIED |

**Pattern:** Published pricing, monthly/annual choice, 14-day free trials common. **This is Rekrut's launch segment.** Price anchor: $100–$250/mo for meaningful volume.

**Key PMaps insight:** AI cheat detection is gated to their $1,500/mo Scale tier. This is a packaging mistake we can exploit — making integrity available at lower tiers is a differentiator.

### 2.3 Per-interview / usage-based (disruptors)

| Platform | Pricing | Model | Source |
|----------|---------|-------|--------|
| Einstellen.AI (India) | **₹249/interview** flat, published | Per-interview | einstllen.ai (self-published) |
| InterviewFlowAI | **$1/interview**, proctoring free | Per-interview | medium.com (founder-published) |
| HireHunch (India) | $55/interview | Per-interview | slashdot.org — UNVERIFIED |
| Hirevire | $19–$39/mo flat, unlimited responses | Flat subscription | medium.com (vendor content) |
| myInterview | Was $29/mo; **acquired by Radancy, no published pricing** | — | interviewflowai.com (2026) |

**Pattern:** India players prove per-interview pricing works and can be published transparently. The $1/interview floor (InterviewFlowAI) is set by someone who also built lean infra — validating our cost thesis.

### 2.4 Candidate-side (mock interview / practice)

| Platform | Pricing | Source |
|----------|---------|--------|
| Yoodli | $11/mo | toughtongueai.com (Sep 2026, prices checked) |
| Tough Tongue AI | $20/mo | toughtongueai.com |
| Huru | $24.99/mo | toughtongueai.com |
| Big Interview | $39/mo | toughtongueai.com |
| Aced (Expert) | $99/mo | toughtongueai.com |
| Final Round AI | $150/mo | toughtongueai.com |

**Pattern:** Candidates pay $11–$150/mo for AI interview practice. **Rekrut's Mock Interview mode could be a candidate-paid product** — but the strategic play is making it free to drive candidate-side adoption (see §5.3).

### 2.5 Pricing model distribution

| Model | Who uses it | Fit for Rekrut |
|-------|-------------|----------------|
| Enterprise quote-gated | HireVue, Talview, VidCruiter, Paradox | Phase 2+ only |
| Subscription (seat/job/invite) | Spark Hire, Willo, PMaps, TestGorilla | ✅ Launch |
| Per-interview | Einstellen.AI, InterviewFlowAI, HireHunch | ✅ Launch (India, overage) |
| Credit packs | Interviewer.AI, Adaface | Viable alternative |
| Freemium | Willo (trial), Hirevire (flat) | ✅ Acquisition |

---

## 3. Pricing Model Analysis

Ran `pricing-strategist` model picker with Rekrut context (usage variance 0.8, hybrid signal 0.7, $0 marginal cost):

| Model | Fit-score | Verdict |
|-------|-----------|---------|
| Usage-based | 80/100 | ✅ Aligned to value; India market already trained on per-interview |
| Hybrid | 80/100 | ✅ Captures SMB (subscription) + enterprise (usage) segments |
| Subscription seat-based | 58/100 | Predictable but leaves money on table with high usage variance |
| Freemium | 55/100 | ✅ Powerful acquisition (cost-to-serve is near-zero); 3.7% HR benchmark conversion |
| Value-based | 40/100 | Requires ROI instrumentation we don't have yet |

**Packaging designer finding:** When I assigned interview modes to separate tiers, the tool flagged **"no clear upgrade trigger"** — the core modes are all high-importance, so gating modes by tier creates a broken ladder. **Correct packaging: all 4 modes in every paid tier; differentiate on volume, seats, and enterprise features** (SSO, SLA, data residency, ATS integrations).

**Freemium benchmark (HR SaaS, 2026):** 12.7% visitor-to-free, **3.7% free-to-paid** (firstpagesage.com). With near-zero cost-to-serve, even 2% conversion is profitable — the free tier is a marketing expense that costs almost nothing.

---

## 4. Packaging Options

### 4.1 The 4 modes

**Recommendation: All 4 modes in every paid tier. Differentiate on volume.**

| Mode | Free | Starter | Professional | Enterprise | Rationale |
|------|------|---------|--------------|------------|-----------|
| Mock Interview | ✅ Unlimited | ✅ | ✅ | ✅ | Candidate acquisition channel; costs ~$0.01/session |
| AI Screening | ✅ 5/mo | ✅ 50/mo | ✅ 300/mo | ✅ Unlimited | Cheapest to run (pre-generated TTS, standardized Qs) |
| AI Interview | ❌ | ✅ 50/mo | ✅ 300/mo | ✅ Unlimited | Premium; adaptive LLM + full analysis |
| Human + AI Observer | ❌ | ❌ | ✅ | ✅ | Premium; observer compute + report generation |

Gating modes by tier (e.g., "AI Interview only in Professional") creates the broken upgrade ladder the packaging tool flagged. A startup that needs AI Interview but only does 30/mo shouldn't be forced into a $199 tier.

### 4.2 Integrity / fraud detection

**Recommendation: Basic integrity in all tiers; full evidence in Professional+.**

| Capability | Free | Starter | Professional | Enterprise |
|------------|------|---------|--------------|------------|
| Basic integrity flags (count + severity) | ✅ | ✅ | ✅ | ✅ |
| Full evidence timeline + behavioral analysis | ❌ | ❌ | ✅ | ✅ |
| Warm-up calibration | ✅ | ✅ | ✅ | ✅ |
| Fairness/disparate-impact dashboard | ❌ | ❌ | ❌ | ✅ |

**Do not repeat PMaps' mistake** of gating cheat detection to the top tier ($1,500/mo). Integrity is our core differentiator — it must be visible from the cheapest paid tier. The *depth* of evidence (not its existence) is what scales with tier.

### 4.3 Candidate-facing reports

**Recommendation: Free in all tiers. This is the moat — don't charge for it.**

No competitor shares AI scoring with candidates (HireVue explicitly does not). Making candidate reports free:
1. Creates candidate goodwill → word-of-mouth → inbound employer leads
2. Is nearly free to serve (report generation is a DB read + template render)
3. Becomes a switching cost (candidates expect it; competitors don't offer it)

### 4.4 What gates the tiers (the real differentiators)

- **Volume:** interviews/month (5 → 50 → 300 → unlimited)
- **Seats:** recruiters (1 → 3 → 10 → unlimited)
- **Jobs:** active job postings (3 → 10 → 50 → unlimited)
- **Integrations:** ATS (❌ → basic → full → custom), API access (❌ → ❌ → ✅ → ✅)
- **Compliance:** SSO/SAML, SLA, data residency, audit logs → Enterprise only
- **Support:** community → email → priority → dedicated CSM

---

## 5. Recommendation

### 5.1 Tiers

#### Free — $0 (₹0)
- 5 AI Screening interviews/month
- Unlimited Mock Interview (candidate self-practice)
- Basic integrity flags
- Candidate feedback reports
- 1 recruiter seat, 3 active jobs
- **Purpose:** PLG acquisition. A recruiter tries 5 screenings, sees the integrity evidence, converts.
- **Cost to serve:** ~$0.15/mo per free user. At 3.7% conversion to $49/mo, each free user is worth $1.81/mo in expected revenue — **12× the cost.**

#### Starter — $49/mo (~₹4,000/mo)
- 50 interviews/month (any mode except Observer)
- AI Screening + AI Interview + Mock
- Basic integrity flags + candidate reports
- 3 recruiter seats, 10 active jobs
- Email support
- **Target:** Startups, SMBs, individual recruiters
- **Effective cost:** $0.98/interview — undercuts Spark Hire Lite ($149/mo for unlimited but with 1 job cap) on flexibility

#### Professional — $199/mo (~₹16,500/mo)
- 300 interviews/month (all 4 modes including AI Observer)
- Full integrity evidence timeline + behavioral analysis
- Recruiter + candidate reports
- ATS integrations (Greenhouse, Lever, Ashby)
- API access
- 10 recruiter seats, 50 active jobs
- Priority support
- **Target:** Mid-market, staffing agencies, high-volume recruiters
- **Effective cost:** $0.66/interview

#### Enterprise — Custom quote (~$12k–$25k/yr starting)
- Unlimited interviews
- SSO/SAML, SLA (99.9%), data residency options
- Custom AI models / white-label
- Fairness/disparate-impact dashboard
- Dedicated CSM, onboarding
- **Trigger to introduce:** When 3+ inbound requests ask for SSO, SLA, or data residency. Do not build enterprise features speculatively.

### 5.2 Overage & India-specific

- **Overage (all paid tiers):** $1.50/interview (~₹125). Matches the $1 floor set by InterviewFlowAI while preserving margin. Prevents bill shock from hard caps.
- **India pay-as-you-go:** ₹199/interview, no subscription. Undercuts Einstellen.AI's ₹249 by 20% while offering 4 modes + integrity (they offer 1 mode). No monthly commitment — critical for Indian SMB buying behavior.
- **Annual discount:** 20% off (2 months free). Standard SaaS practice; improves cash flow for a solo founder.

### 5.3 Freemium strategy

**Yes, with a specific design:**

1. **Candidate-side free forever:** Mock Interview unlimited, free. Candidates are not the buyers — they're the acquisition channel. Every candidate who practices tells their network; some work at companies that hire.
2. **Recruiter-side free tier:** 5 screening interviews/mo. Enough to run one real hiring round and see the product's value. The upgrade trigger is volume, not features.
3. **No credit card for free tier.** HR benchmark: opt-in trials convert at 3.1% median; the friction reduction is worth it when cost-to-serve is $0.15/mo.
4. **Reverse trial (consider post-launch):** Give new signups Professional features for 14 days, then downgrade to Free. Converts at 7.4% median vs 2.4% for standard freemium (ChartMogul 2026). Revisit after 6 months of data.

### 5.4 Enterprise path

| Phase | Trigger | Action |
|-------|---------|--------|
| Launch (Jan 2027) | — | No enterprise tier. "Contact us" link captures inbound. |
| 3+ enterprise inquiries | SSO/SLA/data residency requests | Introduce quote-gated tier at $12k/yr floor. Build SSO first (most common ask). |
| $50k+ pipeline | Security questionnaires | Pursue SOC 2 Type I (~$15k–$30k audit cost — budget for this, not infra). |
| Scale | EU enterprise deals | Data residency (EU region on Render). |

**Do not build SSO, SLA infrastructure, or custom data residency before a paying customer asks.** Every week spent on speculative enterprise features is a week not spent on the core engine.

---

## 6. Unit Economics

| Metric | Value | Notes |
|--------|-------|-------|
| Marginal cost per AI interview | ~$0.03 | Groq free tier (LLM) + browser ML (free) + LiveKit (sunk) |
| Marginal cost per screening | ~$0.01 | Pre-generated TTS, standardized questions |
| Gross margin at $1.50 overage | ~98% | |
| Gross margin at $49/mo (50 interviews) | ~97% | $1.50 cost on $49 revenue |
| Free tier cost per user/mo | ~$0.15 | 5 screenings × $0.03 |
| Break-even free→paid conversion | 0.3% | $0.15 / $49 — we need 1 in 333 to convert; benchmark is 1 in 27 |
| CAC payback (assuming $50 CAC) | ~1 month | At $49/mo and 97% margin |

**The math is overwhelmingly favorable.** The risk is not margin — it's acquisition. Every pricing decision should optimize for getting recruiters to try the product, not for extracting maximum revenue per interview.

---

## 7. Risks & Open Questions

| # | Risk / Question | Mitigation / Next step |
|---|-----------------|------------------------|
| 1 | **Groq free tier limits** at scale — what happens at 10,000 interviews/mo? | Model the Groq TPM/RPM ceiling in Phase 3 (Rex). Fallback chain (NIM → Cerebras) already planned. |
| 2 | **Per-interview pricing invites gaming** (recruiters splitting interviews) | Interview = session; can't be split meaningfully. Monitor for abuse post-launch. |
| 3 | **India ₹199 vs US $1.50** — arbitrage (US customers buying India pricing)? | Geo-fence by billing country + company registration. Standard practice. |
| 4 | **No Van Westendorp data** — prices are benchmark-derived, not survey-validated | Run WTP survey with 30+ recruiters before locking prices (Q2 2027). Prices above are starting frames. |
| 5 | **LiveKit costs at scale** — currently sunk, but usage-based | Model LiveKit per-minute cost at 1,000+ interviews/mo. May need to add ~$0.10/interview to marginal cost. |
| 6 | **Stripe India** — can we bill in INR? | Stripe supports INR billing. Razorpay is the local alternative if Stripe has issues. Verify before launch. |
| 7 | **EU VAT / GST compliance** | Stripe Tax handles this automatically. Enable from day one. |

---

## 8. What This Means for Phase 2 (PRD) and Phase 3 (Architecture)

**Aria (PRD):**
- Add pricing/packaging requirements: tier definitions, interview metering, overage billing, free tier limits
- Add billing integration requirements (Stripe + Stripe Tax)
- Multi-tenancy must support per-customer tier enforcement (Rex needs this in architecture)

**Rex (Architecture):**
- Metering service: count interviews per customer per billing period, enforce tier caps
- Tier gating: feature flags by tier (Observer, API access, ATS integrations)
- Billing webhooks: Stripe → tier activation/deactivation
- India geo-fencing for ₹ pricing

---

## 9. Sources

**Pricing data (all accessed Oct 10, 2026):**
- HireVue enterprise estimates: https://einstellen.ai/einstellen-ai-vs-hirevue/ (citing pin.com), https://www.finalroundai.com/blog/hirevue-pricing, https://getkira.com/blog/hirevue-pricing, https://www.trustradius.com/products/hirevue/pricing
- Talview: https://www.eklavvya.com/blog/best-ai-interview-software/
- Spark Hire: https://www.saasworthy.com/product/spark-hire, https://www.getapp.com/hr-employee-management-software/a/spark-hire/
- Willo: https://www.willo.video/blog/one-way-video-interview-platforms, https://www.hiretruffle.com/blog/compare-willo-vs-spark-hire
- PMaps: https://www.goodfirms.co/software/pmaps-assessment-platform, https://www.g2.com/products/pmaps-pmaps/reviews
- myInterview/Radancy: https://interviewflowai.com/compare/myinterview
- Einstellen.AI: https://einstellen.ai/einstellen-ai-vs-hirevue/
- InterviewFlowAI: https://medium.com/@mukulmunjal1995/ai-interview-software-pricing-why-platforms-charge-10-and-how-we-hit-1-124dbe284ba8
- Interviewer.AI: https://www.g2.com/products/interviewer-ai/pricing
- Intervue.io, HireHunch, OpenIntervue, BarRaiser: https://slashdot.org/software/comparison/ (multiple)
- Hirevire: https://medium.com/hirevire/ (multiple posts)
- Mock interview platforms: https://www.toughtongueai.com/blog/best-ai-mock-interview-platforms-2026
- Market overview: https://usebraintrust.com/blog/best-ai-interview-software-2026
- India market research: https://github.com/udayaixpert-lang/interview-xp/blob/HEAD/docs/research/market-research.md

**Methodology:**
- `pricing-strategist` skill v2.8.0 (claude-skills/commercial/skills/pricing-strategist): model picker + packaging designer scripts
- Freemium benchmarks: https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/ (2026), ChartMogul via https://www.digitalapplied.com/blog/saas-marketing-statistics-2026-data-points-trends

**Confidence notes:** Enterprise prices (HireVue $35k+, Talview $25k) are third-party estimates — neither company publishes pricing. Per-interview and subscription prices from published pricing pages are higher confidence. Slashdot aggregator figures (Intervue $50/mo, HireHunch $55/interview) are UNVERIFIED single-source.
