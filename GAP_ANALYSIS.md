# Rekrut AI — Gap Analysis

**Date:** February 10, 2026
**Sources:** MODULE_AUDIT.md (Feb 9) + COMPETITIVE_ANALYSIS.md (Feb 9) + codebase inspection

---

## TL;DR

Rekrut AI has **13 of 15 original modules fully built** with real backend logic and frontend UIs. The codebase is large (10K+ lines of routes, 29 migrations, 10 services). But "built" ≠ "competitive." Cross-referencing with the competitive analysis reveals significant gaps in depth, polish, and missing competitive features.

**Biggest strategic gap:** OmniScore is the #1 differentiator (zero competitors) but the implementation is only 160 lines. That's the priority.

---

## 1. Fully Built & Working

These modules have real backend routes, database tables, AI integration, and frontend UIs on both candidate and recruiter sides.

| Module | Route Size | Frontend | AI Depth | Competitive Position |
|--------|-----------|----------|----------|---------------------|
| **AI Skill Assessments** | 980 lines | React + legacy | Adaptive questions, scoring, feedback | Ahead of TestGorilla, on par with Codility |
| **AI Interview Coaching** | 913 lines | React + legacy (73K tsx) | Video analysis, body language, speech metrics | On par with HireVue (minus enterprise scale) |
| **AI Profile Matching** | 206 lines + matching-engine service | React | Semantic matching, weighted scoring | Behind LinkedIn (data moat), ahead of most ATS |
| **AI Document Management** | 422 lines + doc-verification service | Legacy HTML | AI extraction, verification, authenticity | Ahead of Greenhouse, on par with Checkr |
| **Hiring Dashboard** | 754 lines (recruiter.js) | React + legacy | Pipeline, analytics, status tracking | Competitive with Greenhouse/Lever |
| **AI Feedback Loop** | Part of interviews.js | React | Analysis of responses, coaching recs | Unique: both-sides approach |
| **Performance Analytics** | 124 lines | Legacy HTML (recruiter-analytics) | Assessment + interview metrics | Basic — Workday is far ahead |
| **Candidate Ranking** | Part of matching.js | React | Semantic ranking | Functional, needs scale data |
| **Personalized Candidate Experience** | 1416 lines (candidate.js) | React (7 pages) | Tailored dashboard, personalized flow | Ahead of most ATS platforms |
| **Compliance & Security** | 553 lines + biasDetection service | Legacy HTML | Background checks, legal tracking, bias detection | Good foundation. EU AI Act gap (see below) |
| **Job Recommendations** | Part of matching.js | React | Smart recommendations | Behind LinkedIn, ahead of Indeed |
| **Onboarding** | 2364 lines (largest route!) | React (97K tsx!) + legacy (52K) | AI-driven paperwork, doc generation, E2E flow | Ahead of BambooHR. Strongest module. |
| **Global Payroll** | 941 lines + payroll-calculator service | React (45K tsx) + legacy | US + India tax calculations, multi-country | Behind Deel/Remote. Partnership recommended. |

---

## 2. Partially Built (Needs Completion)

### Real-time Collaboration Tools
- **Current state:** Room creation endpoints in recruiter.js, chat signal references
- **Missing:** No WebSocket server (server.js has no socket.io/ws setup). No live presence. No real-time messaging.
- **Competitive context:** Most ATS platforms use Slack integrations. Real-time is a differentiator IF built.
- **Effort:** Medium (2-3 days). Add socket.io to server.js, build chat UI.
- **Priority:** LOW — Slack integration would deliver 80% of value at 20% of effort.

### Customizable Hiring Workflow
- **Current state:** Job stages exist in jobs.js. Recruiter can create jobs with stages.
- **Missing:** No custom stage creation UI. No drag-and-drop pipeline builder. No workflow templates.
- **Competitive context:** Greenhouse and Lever are strong here. Table stakes for enterprise.
- **Effort:** Medium-High (3-5 days). Pipeline builder UI + backend stage CRUD.
- **Priority:** MEDIUM — Important for enterprise, but not a differentiator.

### React SPA Migration (Dual Frontend)
- **Current state:** React SPA exists with 23 pages (12 candidate, 11 recruiter). But 39 legacy HTML files still in public/.
- **Missing:** Legacy HTML pages are the primary frontend for many modules (compliance, documents, analytics, company profile). React versions don't exist for all.
- **Competitive context:** Not user-facing, but affects development speed and consistency.
- **Effort:** High (1-2 weeks). Migrate remaining legacy pages to React.
- **Priority:** MEDIUM — Technical debt. Blocks rapid iteration.

---

## 3. Missing Entirely

These capabilities don't exist in the codebase but are critical based on competitive analysis.

### 🔴 HIGH PRIORITY — Build Now

| Gap | Why It Matters | Competitive Benchmark | Effort |
|-----|---------------|----------------------|--------|
| **OmniScore depth** | #1 differentiator with ZERO competitors. Current implementation is 160 lines — needs to be 10x deeper with company scoring, historical trends, explainability. | Nobody does this. Own the category. | 3-5 days |
| **EU AI Act compliance module** | Deadline August 2026. Bias auditing exists (biasDetection.js) but no formal audit trail, no risk classification, no transparency reports. | Checkr and HireVue are scrambling. First-mover advantage. | 3-5 days |
| **ATS/HRIS integrations** | No integrations with Greenhouse, Lever, Workday, BambooHR. Enterprise buyers need this. | Every competitor has integration marketplaces. | 5-10 days (per integration) |
| **Email notifications** | No transactional email system. Candidates/recruiters get no notifications for applications, offers, interviews. | Every competitor has this. Table stakes. | 2-3 days |

### 🟡 MEDIUM PRIORITY — Build Soon

| Gap | Why It Matters | Competitive Benchmark | Effort |
|-----|---------------|----------------------|--------|
| **Interviewer evaluation** | Competitive analysis says coach both sides. Currently only coaches candidates. | HireVue does this for enterprise. | 2-3 days |
| **AI-suggested job descriptions** | Recruiter creates jobs manually. AI should generate/optimize descriptions. | LinkedIn and Indeed offer this. | 1-2 days |
| **Candidate self-service portal** | Candidates can't check application status independently (no status page). | Greenhouse, Lever offer this. | 1-2 days |
| **Mobile responsiveness** | Unknown state across legacy HTML pages. React pages likely responsive (Tailwind). | All competitors are mobile-first. | 2-4 days audit + fix |
| **Pricing page** | pricing.html is 577 bytes (empty shell). No actual pricing flow. | Every SaaS competitor has this. | 1 day |
| **Automated scheduler (calendar integration)** | Interview scheduling exists but no Google Calendar/Outlook integration. Manual scheduling defeats the purpose. | Calendly sets the bar. | 3-5 days |

### 🟢 LOW PRIORITY — Nice to Have

| Gap | Why It Matters | Competitive Benchmark | Effort |
|-----|---------------|----------------------|--------|
| **Payroll API partnerships** | In-house payroll (US + India) exists but can't compete with Deel ($17.3B). API integration would extend to 100+ countries. | Deel, Remote, Papaya APIs. | 5-10 days |
| **AI resume parsing** | Document management extracts data, but no dedicated resume parser for auto-filling profiles. | Most ATS platforms have this. | 2-3 days |
| **Candidate CRM** | No talent pool/pipeline for nurturing candidates over time. | LinkedIn Recruiter, Greenhouse. | 5-7 days |
| **White-label / API access** | No public API or embeddable widgets for partners. | Enterprise feature. Later. | 10+ days |

---

## 4. Priority Roadmap — What to Build Next

Based on competitive advantage × effort × user impact:

### Phase 1: Deepen the Moat (Weeks 1-2)
1. **OmniScore v2** — Company scoring, historical trends, explainable AI. This is the ONE thing nobody else has. Make it undeniable.
2. **Email notifications** — Applications, offers, interviews, onboarding milestones. Table stakes that are currently missing.
3. **Pricing page + Stripe checkout** — Can't monetize without it.

### Phase 2: Enterprise Readiness (Weeks 3-4)
4. **EU AI Act compliance dashboard** — Bias audit trails, risk classification, transparency reports. Beat the Aug 2026 deadline.
5. **Calendar integration** — Google Calendar + Outlook for interview scheduling. Current manual scheduling is a dealbreaker.
6. **Custom workflow builder** — Drag-and-drop pipeline stages. Enterprise expectation.

### Phase 3: Polish & Scale (Weeks 5-8)
7. **React SPA migration** — Kill legacy HTML. Unified frontend for faster iteration.
8. **Interviewer evaluation** — Coach both sides of the interview. Unique positioning.
9. **ATS integrations** — Start with Greenhouse API. Enterprise sales pipeline.
10. **Mobile audit** — Ensure all flows work on mobile.

### Phase 4: Expansion (Months 3+)
11. **Payroll API partnerships** — Deel/Remote integration for global coverage.
12. **AI resume parsing** — Auto-fill candidate profiles from uploaded resumes.
13. **Candidate CRM** — Talent pools for long-term nurturing.

---

## Summary Scorecard

| Category | Count | Details |
|----------|-------|---------|
| ✅ Fully built | 13 modules | Strong AI integration across assessments, interviews, matching, onboarding |
| ⚠️ Partially built | 2 modules + frontend migration | Real-time collab, custom workflows, React migration |
| ❌ Missing (high priority) | 4 capabilities | OmniScore depth, EU AI Act, integrations, email notifications |
| ❌ Missing (medium priority) | 6 capabilities | Interviewer eval, AI job descriptions, status portal, mobile, pricing, calendar |
| ❌ Missing (low priority) | 4 capabilities | Payroll APIs, resume parsing, CRM, white-label |

**Bottom line:** The foundation is solid — 86% of modules are built with real AI. The gap isn't in breadth, it's in **depth** (OmniScore), **compliance** (EU AI Act), and **table-stakes features** (email, pricing, calendar) that every competitor already has.

Build OmniScore v2 first. That's the moat.
