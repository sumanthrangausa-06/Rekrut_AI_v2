# Rekrut AI - Complete Feature Map
**Vision:** Two-sided AI-native hiring platform with AI coaches for BOTH sides
**Updated:** May 2, 2026

---

## 🎯 THE BIG VISION

                    ┌─────────────────────────────────────────────────────────────┐
                    │                    REKRUT AI PLATFORM                        │
                    ├─────────────────────────────────────────────────────────────┤
                    │                                                              │
                    │   CANDIDATE SIDE                 RECRUITER SIDE               │
                    │   ─────────────                  ─────────────                │
                    │                                                              │
                    │   ┌──────────────┐              ┌──────────────┐            │
                    │   │  AI COACH    │              │  AI COACH    │            │
                    │   │  (Personal)  │◄────────────►│  (Screener)  │            │
                    │   └──────────────┘              └──────────────┘            │
                    │         │                              │                    │
                    │         ▼                              ▼                    │
                    │   ┌──────────────┐              ┌──────────────┐            │
                    │   │  OmniScore   │              │  Match Score │            │
                    │   │  (Credit)    │◄────────────►│  (Fit %)     │            │
                    │   └──────────────┘              └──────────────┘            │
                    │         │                              │                    │
                    │         ▼                              ▼                    │
                    │   ┌──────────────┐              ┌──────────────┐            │
                    │   │  Profile +   │              │  Job +       │            │
                    │   │  Skills      │◄────────────►│  Requirements│            │
                    │   └──────────────┘              └──────────────┘            │
                    │                                                              │
                    └─────────────────────────────────────────────────────────────┘

---

## 🧠 TWO AI COACHES - THE CORE INNOVATION

### 1. CANDIDATE AI COACH (Partially Built ✅)
**Purpose:** Help candidates improve and get hired

| Feature | Status | Description |
|---------|--------|-------------|
| Interview Practice | ✅ Built | Mock interviews with AI feedback |
| Quick Practice | ✅ Built | Short practice sessions |
| Skill Assessments | ✅ Built | Technical + soft skill tests |
| Resume Analysis | ⚠️ Partial | Extract skills from resume |
| Career Path Advice | ❌ Missing | AI suggests career moves |
| Skill Gap Analysis | ❌ Missing | "Learn X to qualify for Y jobs" |
| Salary Negotiation Coach | ❌ Missing | Practice salary conversations |
| Company Research Assistant | ❌ Missing | AI researches companies for candidate |
| Application Optimizer | ❌ Missing | AI improves cover letters, applications |

### 2. RECRUITITER AI COACH / SCREENER (NOT BUILT ❌)
**Purpose:** Help recruiters screen and evaluate candidates efficiently

| Feature | Status | Description |
|---------|--------|-------------|
| Candidate Screening | ❌ Missing | AI screens candidates against job req |
| Fit Score Calculation | ❌ Missing | % match based on OmniScore + skills + experience |
| Interview Question Generator | ❌ Missing | AI generates questions based on candidate profile |
| Red Flag Detection | ❌ Missing | AI spots inconsistencies, gaps, concerns |
| Reference Check Assistant | ❌ Missing | AI helps conduct reference calls |
| Offer Recommendation | ❌ Missing | "Should we hire? Why/why not?" |
| Bias Detection | ⚠️ Partial | Exists but needs recruiter-side UI |
| Pipeline Insights | ❌ Missing | "Your pipeline is weak on X skill" |
| Competitor Talent Pool | ❌ Missing | "These candidates also applied to..." |
| Salary Benchmarking | ❌ Missing | AI suggests fair offer based on market |

---

## 📊 OmniScore - The Credit Score for Candidates

**Current State:** 160 lines of basic calculation
**Needed:** Deep, multi-factor scoring system

### Factors to Include:

| Factor Category | Weight | Data Sources |
|-----------------|--------|--------------|
| **Verified Skills** | 25% | Assessments, certifications, work samples |
| **Interview Performance** | 20% | Mock interviews, real interviews, communication |
| **Experience Quality** | 15% | Tenure, company tier, role progression |
| **Education & Credentials** | 10% | Degrees, courses, verified credentials |
| **Reliability Signals** | 10% | Response time, attendance, follow-through |
| **Soft Skills** | 10% | Collaboration, leadership, adaptability |
| **Market Demand** | 5% | Skills match current job market needs |
| **Growth Trajectory** | 5% | Learning velocity, skill acquisition rate |

### Missing OmniScore Features:
- ❌ Historical trend tracking (is candidate improving?)
- ❌ Explainability ("Why is my score 650?")
- ❌ Improvement recommendations ("Do X to gain 50 points")
- ❌ Company-specific scores (how candidate fits YOUR company)
- ❌ Role-specific scores (candidate = 700 for frontend, 550 for backend)
- ❌ Peer comparison (you're in top 20% for your role)
- ❌ Fraud detection (fake credentials, resume inflation)

---

## 🏢 TrustScore - Company Reputation

**Current State:** Basic implementation exists
**Needed:** Deep company scoring

### Factors:
- Employee satisfaction
- Interview experience ratings
- Offer acceptance rate
- Time to hire
- Salary competitiveness
- Diversity & inclusion metrics
- Career growth opportunities

---

## 📋 COMPLETE FEATURE INVENTORY

### ✅ BUILT & WORKING (13 modules)

| Module | Candidate Side | Recruiter Side | AI Depth |
|--------|---------------|----------------|----------|
| Skill Assessments | ✅ Take tests | ✅ Create tests | Adaptive questions |
| Interview Coaching | ✅ Practice | ⚠️ View recordings | Video analysis |
| Job Matching | ✅ See matches | ✅ See candidates | Semantic matching |
| Document Management | ✅ Upload | ✅ Verify | AI extraction |
| Hiring Dashboard | ✅ Track apps | ✅ Pipeline | Basic analytics |
| Onboarding | ✅ Complete docs | ✅ Manage | AI doc generation |
| Payroll | ✅ View paychecks | ✅ Run payroll | US + India tax |
| OmniScore | ✅ View score | ✅ See candidate score | Basic calculation |
| Profile | ✅ Build profile | ❌ Missing | Needs AI suggestions |
| Job Board | ✅ Browse jobs | ✅ Post jobs | Basic recommendations |
| Offers | ✅ Accept/decline | ✅ Create offers | Template-based |
| Compliance | ⚠️ Partial | ⚠️ Partial | Bias detection |
| Communications | ⚠️ Partial | ⚠️ Partial | Basic templates |

### ❌ NOT BUILT - CRITICAL MISSING FEATURES

#### 1. RECRUITER AI SCREENER (High Priority)
```
What it should do:
- Analyze candidate profile vs job requirements
- Calculate fit score with explanation
- Generate screening questions
- Detect red flags (employment gaps, inconsistencies)
- Recommend: "Interview" / "Reject" / "More Info"
- Provide interview talking points
```

#### 2. ADVANCED OmniScore (High Priority)
```
What it should do:
- Multi-factor scoring with weights
- Historical trend tracking
- Explainability dashboard
- Improvement recommendations
- Role-specific and company-specific scores
- Peer benchmarking
- Fraud detection
```

#### 3. CANDIDATE AI CAREER COACH (Medium Priority)
```
What it should do:
- Career path recommendations
- Skill gap analysis
- Learning resource suggestions
- Company research
- Application optimization
- Salary negotiation practice
```

#### 4. REAL-TIME COLLABORATION (Medium Priority)
```
What it should do:
- Hiring team comments on candidates
- @mentions and notifications
- Shared notes and ratings
- Interview scheduling coordination
```

#### 5. ANALYTICS & INSIGHTS (Medium Priority)
```
What it should do:
- Funnel analytics (applied → screened → interviewed → hired)
- Time-to-hire tracking
- Source effectiveness
- Cost-per-hire
- Diversity metrics
- Predictive hiring (will candidate accept?)
```

#### 6. INTEGRATIONS (Table Stakes)
```
Needed:
- Google Calendar / Outlook
- LinkedIn (post jobs, import candidates)
- Indeed / ZipRecruiter
- Greenhouse / Lever / Workday
- Deel / Gusto (payroll)
- Slack / Teams notifications
```

---

## 🚀 PHASED BUILD PLAN

### PHASE 1: Core Differentiation (Weeks 1-4)
1. **Recruiter AI Screener** - Build the "AI recruiter assistant"
2. **Advanced OmniScore v2** - Deep scoring with explanations
3. **Email notifications** - Table stakes
4. **Pricing + Stripe** - Enable revenue

### PHASE 2: Candidate Experience (Weeks 5-8)
5. **Candidate AI Career Coach** - Skill gap analysis, career path
6. **Application Optimizer** - AI improves applications
7. **Company Research Assistant** - AI researches for candidates
8. **Mobile responsiveness audit** - Ensure mobile works

### PHASE 3: Enterprise Features (Weeks 9-12)
9. **Calendar integration** - Google + Outlook
10. **Real-time collaboration** - Team notes on candidates
11. **Advanced analytics** - Funnel, time-to-hire, predictive
12. **ATS integrations** - Greenhouse, Lever APIs

### PHASE 4: Scale & Polish (Months 4-6)
13. **Job board integrations** - LinkedIn, Indeed, ZipRecruiter
14. **Payroll partnerships** - Deel, Remote APIs
15. **White-label option** - Enterprise customization
16. **API access** - Public API for partners

---

## 💰 MONETIZATION MODEL

### For Candidates (Freemium)
| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | Basic OmniScore, job browsing, 3 practice interviews/month |
| Pro | $19/mo | Unlimited practice, AI career coach, skill gap analysis |
| Premium | $49/mo | Priority matching, salary coaching, company research |

### For Recruiters (SaaS)
| Tier | Price | Features |
|------|-------|----------|
| Starter | $49/mo | 1 job, 50 candidates, basic screener |
| Growth | $149/mo | 5 jobs, 500 candidates, AI screener, analytics |
| Enterprise | $499/mo | Unlimited, advanced AI, integrations, white-label |

---

## 🎯 SUCCESS METRICS

| Metric | Target (Year 1) |
|--------|-----------------|
| Registered Candidates | 10,000 |
| Registered Recruiters | 500 |
| Active Companies | 100 |
| Jobs Posted | 1,000 |
| Hires Made | 500 |
| MRR | $50,000 |

