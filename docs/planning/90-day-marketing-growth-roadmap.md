# Rekrut AI — 90-Day Marketing & Growth Roadmap

**Goal:** Launch a candidate-first dual-sided platform (B2C2B) in 90 days.  
**Core flow:** Candidate profiles → AI job matching → Mock interviews → Offers.  
**Primary acquisition:** Content + organic channels.  
**Secondary:** Paid acquisition (Month 2–3 once funnels are validated).

---

## Month 1: Foundation + Content Engine (Days 1–30)

**Theme:** Build the engine, start the flywheel.

### Week 1–2: Infrastructure & Setup

| Task | Owner | Output | Dependencies |
|------|-------|--------|-------------|
| Candidate landing page (hero, value prop, CTA) | Suga | Live page | None |
| Signup flow + profile creation UX | Suga | Working flow | Auth system ready |
| Core analytics stack (Mixpanel/Amplitude + UTM) | Suga | Events instrumented | Landing page live |
| Brand voice + messaging guide | CMO | 1-pager | Product scope from Suga |
| Content hub setup (blog, YouTube, LinkedIn) | CMO | Accounts live | None |

### Week 3–4: Content Production & First Signal

| Content Pillar | Format | Cadence | Purpose |
|---------------|--------|---------|---------|
| AI Job Matching | Blog + LinkedIn | 2x/week | SEO + authority |
| Mock Interview Series | YouTube/TikTok | 1x/week | Viral candidate acquisition |
| Resume & Skills Tips | Twitter/X threads | 3x/week | Community building |
| "How I got hired with AI" | Candidate stories | 1x/week | Social proof |

**Month 1 Targets:**
- 8 blog posts published
- 4 video shorts published
- 2,000 email subscribers / waitlist signups
- 500 candidate profiles created
- 50 organic applications via AI matching

**Key Metrics:**
- Landing page conversion rate (target: >15%)
- Signup → profile completion (target: >40%)
- Content engagement rate (target: >3% on LinkedIn)
- Organic traffic growth (target: 20% week-over-week)

---

## Month 2: Growth Acceleration + Partnerships (Days 31–60)

**Theme:** Scale content, open partner channels, test paid.

### Week 5–6: Partner Channel Launch

| Partner Type | Target Partners | Value Exchange | Expected Volume |
|-------------|-----------------|---------------|-----------------|
| Coding bootcamps | 3–5 local/global | Free premium access for grads | 500–1,000 candidates |
| University career centers | 5–10 | Co-branded job board + AI tools | 300–500 candidates |
| YouTube/TikTok creators | 5–10 micro-influencers | Affiliate or exposure deal | 2,000–5,000 reach |
| Discord/Slack communities | 5 tech communities | Sponsored AMAs + free tools | 500–1,000 signups |

### Week 7–8: Paid Acquisition (Soft Launch)

| Channel | Budget | Test Hypothesis | Success Criteria |
|---------|--------|-----------------|------------------|
| LinkedIn Ads | $2,000 | Job seekers 22–35, tech roles | CPL < $5 |
| TikTok/YouTube Shorts | $1,500 | Mock interview clips | CPV < $0.05 |
| Google Search (long-tail) | $1,500 | "AI job matching", "mock interview prep" | CPA < $10 |

**Month 2 Targets:**
- 5,000 total candidate profiles
- 500 partner-sourced candidates
- 10,000 monthly unique visitors
- 100 AI-powered interviews completed
- 20 offers extended (beta)
- Paid CAC validated (< $10)

**Key Metrics:**
- Partner conversion rate (target: >20%)
- Paid CAC (target: < $10 per candidate)
- Interview completion rate (target: >60%)
- Offer acceptance rate (target: >30%)

---

## Month 3: Launch Push + Recruiter Teaser (Days 61–90)

**Theme:** Public launch, press push, recruiter waitlist.

### Week 9–10: Public Launch Campaign

| Asset | Owner | Status Needed |
|-------|-------|---------------|
| Launch landing page (candidate-focused) | Suga | Day 60 |
| Product demo video (60 sec) | CMO | Day 60 |
| Press kit + founder story | CMO | Day 58 |
| Email nurture sequence (7-touch) | CMO | Day 55 |
| Launch day social blast | CMO | Day 60 |

**Launch Day Checklist:**
- [ ] ProductHunt launch (prepared 2 weeks early)
- [ ] HackerNews "Show HN" post
- [ ] LinkedIn founder post + employee advocacy
- [ ] Email blast to all waitlist subscribers
- [ ] Press outreach to 20 tech/job media outlets
- [ ] Community AMAs (3–5)

### Week 11–12: Recruiter Waitlist & B2B Teaser

| Activity | Purpose | Target |
|----------|---------|--------|
| "Recruiters: Join the Waitlist" page | Capture recruiter interest | 100 recruiter signups |
| "How AI is changing hiring" content | Position for B2B | 5 pieces |
| Case study: first 10 placements | Social proof | 1 published |

**Month 3 Targets:**
- 15,000 total candidate profiles
- 50,000 monthly unique visitors
- 500 AI-powered interviews completed
- 100 offers extended
- 50 placements (hired)
- 100 recruiter waitlist signups
- ProductHunt top 5 of the day

**Key Metrics:**
- Launch day signup spike (target: 2,000 in 48h)
- NPS (target: >40)
- Retention: Week-1 return rate (target: >30%)
- Recruiter waitlist → demo request (target: >20%)

---

## Content Calendar Template (Month 1–2)

| Week | Blog | LinkedIn | Video | Twitter/X | Community |
|------|------|----------|-------|-----------|-----------|
| 1 | "How AI job matching works" | 2 posts | — | 3 threads | — |
| 2 | "Resume tips for 2026" | 2 posts | Mock interview #1 | 3 threads | Bootcamp outreach |
| 3 | "OmniScore explained" | 2 posts | Mock interview #2 | 3 threads | Reddit AMA |
| 4 | Candidate story #1 | 2 posts | Mock interview #3 | 3 threads | Discord drop |
| 5 | "AI vs. traditional recruiting" | 2 posts | — | 3 threads | Partner launch |
| 6 | "Interview prep checklist" | 2 posts | Partner collab | 3 threads | Influencer push |
| 7 | Paid landing page variants | 2 posts | Ad creative test | 3 threads | — |
| 8 | Candidate story #2 | 2 posts | Mock interview #4 | 3 threads | Case study drop |

---

## Dependencies on Suga (Technical)

| Deliverable | Needed By | Blocks If Missing |
|-------------|-----------|-------------------|
| Candidate landing page | Day 7 | All acquisition |
| Signup + profile flow | Day 14 | Content → conversion |
| Analytics events | Day 14 | Metrics tracking |
| Job matching algorithm live | Day 21 | Core value prop |
| Mock interview flow | Day 30 | Key content pillar |
| Offer workflow (basic) | Day 45 | Month 2 targets |
| Launch page (polished) | Day 60 | Public launch |
| Recruiter waitlist page | Day 70 | B2B teaser |

**Blockers to surface now:**
- Which of the 11 legacy HTML pages include the candidate landing/signup flow?
- Are the 3 placeholder pages the mock interview, job matching, and offer pages?
- Is Stripe billing validation a blocker for free-tier candidate signup?
- What is the current status of the AI provider circuit breaker — is it safe for launch traffic?

---

## Budget Summary (90 Days)

| Category | Month 1 | Month 2 | Month 3 | Total |
|----------|---------|---------|---------|-------|
| Content production | $1,000 | $1,500 | $2,000 | $4,500 |
| Paid ads (test) | — | $5,000 | $3,000 | $8,000 |
| Partner/affiliate | — | $1,000 | $500 | $1,500 |
| Launch PR + events | — | — | $2,000 | $2,000 |
| Tools (analytics, design, etc.) | $500 | $500 | $500 | $1,500 |
| **Total** | **$1,500** | **$8,000** | **$8,000** | **$17,500** |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Suga delays on landing page | Medium | High | Start with no-code landing page (Webflow/Carrd) as backup |
| Content doesn't convert | Medium | High | A/B test hooks weekly; double down on formats that work |
| Paid CAC too high | Medium | Medium | Cap spend at $5K until CAC < $10 validated |
| Partner channels slow | Low | Medium | Run 3 parallel partner tracks; don't depend on one |
| AI matching quality poor | Low | High | Run 20 manual QA matches weekly; flag to Suga |

---

## Weekly Cadence

- **Monday:** CMO + Suga sync (15 min) — blockers, metrics, week ahead
- **Wednesday:** Content review — upcoming posts, creative assets
- **Friday:** Metrics standup — CMO presents numbers to Ranga + Kimi

---

## Success Criteria at Day 90

1. **15,000 candidate profiles** with >40% profile completion
2. **50,000 monthly visitors** with >15% landing page conversion
3. **500 AI interviews** completed with >60% finish rate
4. **50 successful placements** (candidates hired)
5. **100 recruiter waitlist** signups with >20% demo interest
6. **NPS > 40** from placed candidates
7. **Content engine** running at 8–10 pieces/week without heavy manual effort

---

*Prepared by CMO for Rekrut AI Team*  
*Target: Align with Suga's technical scope and Ranga's 90-day launch goal*
