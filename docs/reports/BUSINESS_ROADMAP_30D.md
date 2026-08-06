# Rekrut AI — Business Strategy 30-Day Roadmap

**Owner:** Suga (CEO) | **Last Updated:** 2026-06-08 | **Review Cadence:** Weekly

---

## Executive Summary

This roadmap covers the 30-day post-launch sprint for Rekrut AI v2. The goal is to achieve product-market fit signals, acquire the first 1,000 candidates and 50 recruiters, and establish a repeatable growth engine. All timelines assume the prod deploy is fixed within Week 1.

**North Star Metrics:**
- 1,000 candidate signups by Day 30
- 50 recruiter signups by Day 30
- 100 completed mock interviews by Day 30
- $5,000 MRR (Monthly Recurring Revenue) by Day 30
- 4.5+ average app store rating (when launched)

---

## Week 1: Launch & Foundation (Days 1-7)

### Goal: Ship prod, validate core loop, fix critical issues

**Day 1-2: Prod Deploy**
- [ ] Merge dev → main, verify Render deploy succeeds
- [ ] Update prod env vars: Stripe webhook secret, admin password, live keys
- [ ] Run smoke test: homepage → register → login → candidate flow → recruiter flow → Stripe checkout
- [ ] Verify no 5xx errors in first 24 hours
- [ ] Set up Sentry/Rollbar for error monitoring

**Day 3-4: Soft Launch — Internal Circle**
- [ ] Share with 10 friends/colleagues in Singapore tech scene
- [ ] Collect feedback on: registration friction, UI clarity, feature gaps
- [ ] Fix any P0 bugs within 24 hours of discovery
- [ ] Set up Intercom/Drift for live chat support

**Day 5-7: Closed Beta — Referral Only**
- [ ] Launch landing page with "Request Access" CTA
- [ ] Send invite codes to 50 candidates from LinkedIn outreach
- [ ] Send invite codes to 10 recruiters from personal network
- [ ] Track metrics: signup rate, activation rate (completes profile), retention rate (returns within 48h)
- [ ] Daily standup: review metrics, triage bugs, prioritize fixes

**Business Milestones:**
- Prod is live and stable ✅
- 50 beta signups ✅
- 0 critical bugs ✅
- Feedback loop established ✅

---

## Week 2: Growth & Iteration (Days 8-14)

### Goal: Scale to 500 candidates, iterate based on feedback

**Day 8-10: Open Signups + Content Marketing**
- [ ] Remove invite code requirement, open to public
- [ ] Publish 3 blog posts: "How AI is Changing Job Search", "The OmniScore Explained", "5 Tips to Ace Your Next Interview"
- [ ] Post on LinkedIn, Twitter, Reddit r/cscareerquestions, Hacker News "Show HN"
- [ ] Set up Google Ads: $500/day budget, target "job search AI", "mock interview practice", "resume builder"
- [ ] Set up Facebook/Instagram Ads: $300/day, target fresh grads and career changers

**Day 11-12: Partnership Outreach**
- [ ] Reach out to 5 coding bootcamps (General Assembly, Le Wagon, etc.) — offer free Pro accounts for graduates
- [ ] Reach out to 3 university career centers (NUS, NTU, SMU) — offer campus partnership
- [ ] Reach out to 2 tech communities (Engineers.SG, TechLadies) — offer event sponsorship
- [ ] Document partnership terms: free Pro for 6 months, co-branded landing page, referral commission

**Day 13-14: Feature Iteration**
- [ ] Analyze top 5 user feedback requests
- [ ] Ship quick wins: dark mode toggle, password visibility, LinkedIn profile import
- [ ] A/B test landing page copy: "AI-Powered Career Companion" vs "Get Hired Faster with AI"
- [ ] A/B test pricing page: $19/mo vs $29/mo vs freemium conversion

**Business Milestones:**
- 500 total signups ✅
- 20% activation rate ✅
- 50% retention at Day 7 ✅
- 3 content pieces published ✅
- 1 partnership signed ✅

---

## Week 3: Monetization & Scale (Days 15-21)

### Goal: First paying customers, 1,000 candidates, revenue validation

**Day 15-17: Conversion Optimization**
- [ ] Implement drip email campaign: Day 0 (welcome), Day 1 (tips), Day 3 (interview practice), Day 7 (upgrade prompt)
- [ ] Add exit-intent modal: "Get 50% off Pro for your first month"
- [ ] Add social proof to landing page: "Join 1,000+ candidates using Rekrut AI"
- [ ] Add testimonials section (from beta users)
- [ ] Implement referral program: "Refer a friend, get 1 month free Pro"

**Day 18-19: Recruiter Focus**
- [ ] Launch recruiter-specific landing page: "Hire Smarter with AI"
- [ ] Offer free trial for recruiters: 14 days, 5 active jobs, no credit card
- [ ] Reach out to 20 recruiters on LinkedIn with personalized pitch
- [ ] Create case study: "How Company X hired 3 engineers in 2 weeks with Rekrut AI"
- [ ] Set up Calendly for recruiter demos

**Day 20-21: Revenue & Metrics Review**
- [ ] Review MRR, churn rate, LTV, CAC
- [ ] If MRR > $5,000: prepare seed pitch deck
- [ ] If MRR < $2,000: double down on free channels (content, SEO, partnerships)
- [ ] Document learnings: what works, what doesn't, what to pivot
- [ ] Set OKRs for Month 2

**Business Milestones:**
- 1,000 total signups ✅
- 50 recruiter signups ✅
- 10 paying customers ✅
- $5,000 MRR ✅
- 100 completed mock interviews ✅

---

## Week 4: Scale & Planning (Days 22-30)

### Goal: Establish growth engine, plan Month 2, prepare for fundraising

**Day 22-24: Growth Engine**
- [ ] Hire first growth contractor (part-time, $1,000/mo) — content writer or community manager
- [ ] Set up automated social media posting (Buffer/Hootsuite)
- [ ] Launch TikTok/YouTube Shorts: "AI Mock Interview in 60 seconds"
- [ ] SEO optimization: target long-tail keywords, fix meta tags, add structured data
- [ ] Set up Google Analytics 4 + Mixpanel for funnel tracking

**Day 25-27: Product Expansion**
- [ ] Launch "AI Resume Builder" feature (quick win, high demand)
- [ ] Launch "Salary Insights" feature (market data, high virality)
- [ ] Launch "Company Culture Fit" quiz (engagement, data collection)
- [ ] A/B test new features with 10% of users
- [ ] Collect NPS score from all users

**Day 28-30: Month 2 Planning**
- [ ] Review all metrics: signups, activation, retention, revenue, NPS
- [ ] Write Month 2 roadmap: features, growth, hiring, fundraising
- [ ] Prepare investor update (if applicable): metrics, traction, learnings
- [ ] Set up advisory board: 2-3 advisors from HR tech, recruitment, or SaaS
- [ ] Plan team expansion: hire first full-time engineer or designer

**Business Milestones:**
- 1,500 total signups ✅
- 100 recruiter signups ✅
- 25 paying customers ✅
- $10,000 MRR ✅
- NPS > 50 ✅
- Month 2 roadmap ready ✅

---

## Go-to-Market Strategy

### Positioning

**For Candidates:** "Your AI-Powered Career Companion — Get hired faster with AI mock interviews, skill assessments, and smart job matching."

**For Recruiters:** "Hire Smarter with AI — Find top talent in half the time with AI-powered screening, analytics, and candidate matching."

### Differentiation vs Competitors

| Competitor | Their Weakness | Our Strength |
|---|---|---|
| LinkedIn | Generic, noisy, no AI coaching | Personalized AI career companion |
| Indeed | Transactional, no engagement | Mock interviews + skill assessments |
| HackerRank | Code-only, no soft skills | OmniScore: technical + soft skills |
| Triplebyte | Expensive, dev-only | Affordable, all roles, B2C2B model |
| AngelList | Startup-only, no AI | AI matching + culture fit |

### Pricing Strategy (Current)

| Tier | Price | Features | Target |
|---|---|---|---|
| Free | $0 | 5 mock interviews, basic matching, profile | All candidates |
| Pro | $19/mo ($149/yr) | Unlimited interviews, AI coaching, priority matching, salary insights | Active job seekers |
| Teams | Custom | Multi-user, ATS integration, analytics, dedicated support | Recruiters |

### Pricing Strategy (Month 2 Test)

| Tier | Price | Features | Target |
|---|---|---|---|
| Free | $0 | 3 mock interviews, basic matching | All candidates |
| Starter | $9/mo | 10 interviews, AI coaching, resume builder | Casual seekers |
| Pro | $29/mo | Unlimited, salary insights, priority support | Active seekers |
| Enterprise | $99/mo/user | Full ATS, analytics, API access | Recruiters |

---

## User Acquisition Channels

### Priority 1: Free/Organic (Week 1-2)
- [ ] Content marketing (blog, LinkedIn, Twitter)
- [ ] SEO (long-tail keywords, job search advice)
- [ ] Referral program (viral loop)
- [ ] Community engagement (Reddit, Discord, Slack groups)
- [ ] Partnerships (bootcamps, universities, career centers)

### Priority 2: Paid (Week 2-4)
- [ ] Google Ads: $500/day, target "job search AI", "mock interview"
- [ ] Facebook/Instagram: $300/day, target fresh grads
- [ ] LinkedIn Ads: $200/day, target recruiters
- [ ] Influencer marketing: $1,000/mo, 3 micro-influencers in tech/career space

### Priority 3: Partnerships (Week 3-4)
- [ ] Bootcamp partnerships: free Pro for graduates, revenue share
- [ ] University career centers: campus license, co-branded
- [ ] Tech community sponsorships: event booths, speaker slots
- [ ] Corporate HR partnerships: pilot program, case studies

**Target CAC by Channel:**
- Organic: $0
- Google Ads: $5-10 per signup
- Facebook: $3-8 per signup
- LinkedIn: $15-30 per recruiter signup
- Partnerships: $2-5 per signup (revenue share)

---

## Revenue Model & Targets

### Month 1 Revenue Targets

| Week | Candidates | Recruiters | MRR | Notes |
|---|---|---|---|---|
| Week 1 | 50 | 0 | $0 | Beta, free only |
| Week 2 | 500 | 10 | $500 | First paid signups |
| Week 3 | 1,000 | 50 | $5,000 | 10% conversion to Pro |
| Week 4 | 1,500 | 100 | $10,000 | 15% conversion, recruiter upsells |

### LTV Projections

| Segment | Monthly Price | Churn (Month 1) | Churn (Month 6) | LTV |
|---|---|---|---|---|
| Pro Candidate | $19 | 30% | 15% | $95 |
| Teams Recruiter | $99 | 10% | 5% | $594 |

**LTV/CAC Target:** 3:1 minimum (LTV $95 / CAC $30 = 3.2x)

### Fundraising Timeline

| Milestone | When | Action |
|---|---|---|
| $5K MRR | Week 3 | Start investor conversations |
| $10K MRR | Week 4 | Pitch to 5 angel investors |
| 2,000 signups | Month 2 | Apply to YC, Techstars, 500 Startups |
| $25K MRR | Month 3 | Seed round ($500K-1M) |

---

## Competitive Landscape

### Direct Competitors

| Company | Model | Price | Strength | Weakness |
|---|---|---|---|---|
| LinkedIn | Social + Jobs | Freemium | Network effects | No AI, noisy |
| Indeed | Job board | Freemium | Traffic volume | No engagement |
| HackerRank | Assessments | $249/mo | Technical depth | Expensive, narrow |
| Triplebyte | Matching | Free for candidates | High quality | Dev-only, expensive |
| AngelList | Startup jobs | Free | Startup focus | Limited AI |

### Our Advantage

1. **AI-first:** Not a job board with AI bolted on. Built from ground up with AI coaching.
2. **B2C2B:** Candidates come first, recruiters follow. Network effects.
3. **OmniScore:** Unique scoring system that combines technical + soft skills.
4. **Affordable:** $19/mo vs $249/mo for HackerRank. Accessible to all candidates.
5. **Singapore-first:** Local market knowledge, partnerships, regulatory compliance.

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Prod deploy fails | High | Critical | Have rollback plan, test on staging first |
| Low signup conversion | Medium | High | A/B test pricing, improve onboarding |
| Competitor copies features | Medium | Medium | Build brand, community, data moat |
| Stripe live account delays | Medium | High | Keep test mode, manual billing fallback |
| AI provider downtime | Low | Medium | Multi-provider fallback already built |
| Regulatory issues (EU AI Act) | Medium | High | Complete dashboard, legal review |
| Team burnout | Medium | High | Clear roles, no overtime, async communication |
| Cash burn before revenue | Medium | High | Bootstrap, no hiring until $10K MRR |

---

## Key Metrics Dashboard

**Weekly Review Metrics:**
- Signups (total, by channel, by role)
- Activation rate (completes profile, takes first interview)
- Retention rate (returns within 7 days, 30 days)
- Conversion rate (free → Pro, candidate → recruiter)
- MRR, churn, LTV, CAC
- NPS score
- Support tickets (volume, resolution time, satisfaction)
- Bug count (P0, P1, P2)

**Tools:**
- Google Analytics 4 (web traffic)
- Mixpanel (product analytics)
- Stripe (revenue)
- Intercom (support)
- Sentry (errors)

---

## Immediate Actions (Next 24 Hours)

1. **Fix prod deploy** — delegate to kimiclaw, monitor
2. **Disable broken cron jobs** — switch to manual updates
3. **Update admin password** — change from `changeme123`
4. **Set up error monitoring** — Sentry free tier
5. **Write 3 blog post outlines** — for Week 2 content marketing
6. **Create LinkedIn outreach template** — for beta invites
7. **Set up Google Ads account** — ready to launch Week 2

---

## Team Structure (Month 1)

| Role | Person | Responsibility | Hours/Week |
|---|---|---|---|
| CEO | Suga | Strategy, fundraising, partnerships, metrics | 40 |
| CTO | kimiclaw | Tech execution, deploy, infrastructure, E2E tests | 40 |
| CPO | Kimi | Product roadmap, UX, feature prioritization, analytics | 40 |
| QA | Sunny | Testing, bug reports, manual verification | 20 |
| Growth (contractor) | TBD | Content, social media, community | 20 |

**Hiring Priority:**
1. Growth contractor (Week 2)
2. Full-stack engineer (Week 4, if MRR > $5K)
3. Designer (Month 2, if MRR > $10K)

---

*Written by Suga (CEO). Ready to execute. 🚀*
