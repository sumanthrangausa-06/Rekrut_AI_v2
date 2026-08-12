# Rekrut AI — Skills Action Plan

> **Version:** 1.0  
> **Date:** June 5, 2026  
> **Owner:** Suga (CTO/Co-founder)  
> **Purpose:** What to add, what to build, what to keep, what to cut — a decision matrix for launch

---

## 1. The Decision Framework

For every module, we ask:
1. **Does a candidate need this to get hired?** → P0
2. **Does a recruiter need this to hire someone?** → P0
3. **Does it differentiate us from LinkedIn/Indeed?** → P1
4. **Can we ship without it?** → P2 or P3

---

## 2. What to ADD (New Skills/Modules We Need)

| # | Skill | Why | Priority | Effort | When |
|---|-------|-----|----------|--------|------|
| 1 | **Job Alerts** | Candidates won't check daily; passive matching keeps them engaged | P1 | 3 days | Month 2 |
| 2 | **Interview Reminders** | No-shows kill recruiter trust | P1 | 2 days | Month 2 |
| 3 | **E2E Testing** | Manual QA doesn't scale; every frontend change risks breaking the candidate journey | P1 | 1 week | Month 2 |
| 4 | **Monitoring / Alerting** | We find out about production issues from users right now | P1 | 2 days | Month 2 |
| 5 | **CI/CD Pipeline** | Manual deploy to Render is error-prone and slow | P1 | 3 days | Month 2 |
| 6 | **Dark Mode** | Modern expectation; candidates judge polish | P2 | 4 days | Month 3 |
| 7 | **Certification Badges** | Visual credibility for candidates; shareable | P2 | 4 days | Post-launch |
| 8 | **API Documentation** | If we want integrations, developers need docs | P2 | 3 days | Post-launch |
| 9 | **Load Testing** | We don't know if we can handle 1000 concurrent users | P1 | 3 days | Month 3 |
| 10 | **Security Audit** | OWASP ZAP, GDPR compliance — legal requirement | P1 | 3 days | Month 3 |

---

## 3. What to BUILD (Missing Core Features)

These are not "nice to have" — they are placeholders or gaps that make the platform incomplete.

| # | Feature | Current State | Why It Blocks | Effort | When |
|---|---------|---------------|---------------|--------|------|
| 1 | **Candidate Search** | Placeholder page | Recruiters can't find candidates = no hires | 5 days | Month 1, Week 3 |
| 2 | **Recruiter Analytics** | Placeholder page | Recruiters can't prove ROI = churn | 4 days | Month 2, Week 5 |
| 3 | **Candidate Documents** | Placeholder page | Verification flow is broken | 3 days | Month 1, Week 4 |
| 4 | **Real-time Chat Architecture** | Polling (decision needed) | Chat latency hurts recruiter experience | 2 days (decision) | Month 2, Week 6 |
| 5 | **Stripe Live Mode** | Test mode only | Can't collect revenue | 2 days | Month 1, Week 1 |
| 6 | **GDPR Compliance** | Partial | Legal risk in EU | 3 days | Month 3, Week 10 |
| 7 | **Aadhar Compliance Review** | Not reviewed | Legal risk in India | External | Month 2, Week 7 |

---

## 4. What to KEEP (Our Moat)

These are the skills that make us different. Protect them. Don't cut them. Don't deprioritize them.

| Skill | Why It's Our Moat | Notes |
|-------|-------------------|-------|
| **AI Provider Fallback (5 providers)** | No competitor has auto-failover across OpenAI, Anthropic, NIM, Groq, Cerebras | If one provider goes down, users don't notice |
| **Circuit Breaker** | Prevents cascading failures | Auto-opens on 3 failures, half-open after 60s |
| **Quick Practice Isolation** | Mock Interview changes can't break Quick Practice | Decoupled architecture = stability |
| **pgvector Semantic Matching** | AI-powered job matching, not keyword search | <500ms, accurate |
| **Document Verification (OCR + Fraud)** | Trust is everything in hiring | Detects forged documents, scores authenticity |
| **OmniScore** | Credit score for candidates | Unique — no one else does this |
| **Prompt Management** | Versioned, A/B tested AI prompts | Consistent AI quality |
| **Token Budgeting** | Controls AI costs | Daily limits, priority throttling |
| **Bias Detection** | Fairness auditing | Required for trust, required for compliance |

---

## 5. What to CUT (From Launch Scope)

These are in the codebase or on the roadmap, but they don't need to ship on Day 1. Cut them to focus on the core loop.

| # | Feature | Why Cut | When to Revisit |
|---|---------|---------|---------------|
| 1 | **Peer Mock Interviews** | Community feature, no users yet | 60+ days post-launch |
| 2 | **Panel Interviews** | Enterprise feature, we're targeting SMB first | 90+ days post-launch |
| 3 | **Video Call Integration** | Chat is enough for MVP; Zoom/Teams integration is better done later | 60+ days post-launch |
| 4 | **Pipeline Automation** | Recruiters have 0-5 hires/month, don't need automation yet | 90+ days post-launch |
| 5 | **Talent Pool / Passive Candidates** | No candidate pool yet; build after we have 1000+ profiles | 90+ days post-launch |
| 6 | **E-signature (DocuSign)** | Manual contract acceptance is fine for first 50 hires | 60+ days post-launch |
| 7 | **Custom Model Training** | Current providers are good enough | 120+ days post-launch |
| 8 | **Developer SDK** | No demand yet | 180+ days post-launch |
| 9 | **Direct Deposit Integration** | Manual payroll is fine for first 50 employees | 90+ days post-launch |
| 10 | **Multi-country Payroll Expansion** | US + India only for launch | 120+ days post-launch |
| 11 | **Custom Company Branding** | Default branding is fine | 60+ days post-launch |
| 12 | **Social Media Integration** | Basic links are enough | 60+ days post-launch |
| 13 | **Advanced Search (Elasticsearch)** | PostgreSQL full-text is enough for <10k jobs | 180+ days post-launch |
| 14 | **Data Warehouse / BI** | Admin dashboard is enough | 180+ days post-launch |
| 15 | **Enterprise SSO (SAML)** | SMB focus first | 180+ days post-launch |

---

## 6. What to REMOVE (Technical Debt)

These are in the codebase but should be deleted or deprecated.

| # | Item | Why Remove | Action | Effort |
|---|------|------------|--------|--------|
| 1 | **42 Legacy HTML Pages** | Maintenance burden, UX inconsistency, route conflicts | Complete migration to React, then delete | 2 weeks (spread across Month 1) |
| 2 | **Zombie Mock Interview Sessions** | 43% in_progress with no activity = data pollution | Clean up old records, add cron job | 1 day |
| 3 | **Role Value "employer"** | Should be "recruiter" everywhere | DB migration + code update | 1 day |
| 4 | **Unused AI Provider Configs** | If any provider configs are dead code | Audit and remove | 1 day |
| 5 | **In-memory Rate Limiting Code** | Already replaced with PostgreSQL | Confirm removal, clean up | 1 day |

---

## 7. The "If We Only Have 6 Weeks" Cut List

If the timeline compresses from 90 days to 60 days, here's what survives and what dies:

### Survives (P0 Only)
- Sign Up / Sign In (polish)
- Candidate Profile (polish)
- Job Search (polish)
- AI Interview (polish)
- Candidate Search (build from placeholder)
- Recruiter Dashboard (polish)
- Create Job (polish)
- Applicant Management (works)
- Chat (polish)
- Offers (works)
- Stripe Live (test)
- AI Provider Health (monitor)

### Dies (Everything P1 and below)
- Recruiter Analytics (placeholder stays)
- E2E Tests (manual QA)
- Monitoring (admin dashboard only)
- CI/CD (manual deploy)
- Job Alerts (not built)
- Interview Reminders (not built)
- Dark Mode (not built)
- Certification Badges (not built)
- Load Testing (hope and pray)
- Security Audit (basic check only)
- GDPR (basic consent banner)
- All P2 and P3 features

**Verdict:** 60 days is survivable but risky. We'd launch with a working core loop but no safety net (no E2E tests, no monitoring, no load testing).

---

## 8. The "If We Have 120 Days" Add List

If the timeline extends to 120 days, here's what we'd add:

| # | Feature | Effort | Why |
|---|---------|--------|-----|
| 1 | **Recruiter Analytics (Real)** | 4 days | Data-driven recruiter retention |
| 2 | **Job Alerts** | 3 days | Candidate engagement |
| 3 | **Interview Reminders** | 2 days | Reduce no-shows |
| 4 | **Certification Badges** | 4 days | Candidate credibility |
| 5 | **Dark Mode** | 4 days | Polish |
| 6 | **E2E Tests (Full Suite)** | 2 weeks | Quality assurance |
| 7 | **Load Testing** | 3 days | Confidence at scale |
| 8 | **Monitoring (Sentry + Datadog)** | 2 days | Operational maturity |
| 9 | **CI/CD** | 3 days | Deployment safety |
| 10 | **Security Audit + Pen Test** | 1 week | Compliance |
| 11 | **GDPR Full Compliance** | 3 days | Legal safety |
| 12 | **API Documentation** | 3 days | Developer ecosystem |
| 13 | **Duplicate Job / Job Templates** | 3 days | Recruiter efficiency |
| 14 | **Applicant Tags / Labels** | 2 days | Recruiter organization |
| 15 | **Invoice / Payment History** | 3 days | Billing transparency |

---

## 9. Decision Matrix: Keep vs Cut vs Build

| Feature | Candidate Need? | Recruiter Need? | Differentiator? | Launch Without? | Verdict |
|---------|----------------|-----------------|-----------------|-----------------|---------|
| Sign Up / Sign In | Yes | Yes | No | No | **KEEP** |
| Profile | Yes | Yes | No | No | **KEEP** |
| Job Search | Yes | No | Yes (semantic) | No | **KEEP** |
| AI Interview | Yes | No | **Yes** | No | **KEEP** |
| Applications | Yes | Yes | No | No | **KEEP** |
| Offers | Yes | Yes | No | No | **KEEP** |
| Candidate Search | No | **Yes** | No | No | **BUILD** |
| Recruiter Dashboard | No | Yes | No | No | **KEEP** |
| Create Job | No | Yes | Yes (AI optimizer) | No | **KEEP** |
| Applicant Management | No | Yes | No | No | **KEEP** |
| Chat | Yes | Yes | No | No | **KEEP** |
| Recruiter Analytics | No | Yes | No | Yes | **CUT** (P1) |
| Company Profile | No | Yes | No | Yes | **KEEP** (but polish) |
| TrustScore | Yes | Yes | **Yes** | No | **KEEP** |
| OmniScore | Yes | No | **Yes** | No | **KEEP** |
| Document Verification | Yes | Yes | **Yes** | No | **KEEP** |
| Skill Assessments | Yes | Yes | Yes (adaptive) | No | **KEEP** |
| Payroll | Yes | Yes | No | **Yes** | **CUT** (P2) |
| Billing / Stripe | No | Yes | No | No | **KEEP** (test live) |
| Job Alerts | Yes | No | No | **Yes** | **CUT** (P1) |
| Interview Reminders | Yes | Yes | No | **Yes** | **CUT** (P1) |
| Dark Mode | No | No | No | **Yes** | **CUT** (P2) |
| Peer Interviews | Yes | No | Yes | **Yes** | **CUT** (P3) |
| Panel Interviews | No | Yes | No | **Yes** | **CUT** (P3) |
| Pipeline Automation | No | Yes | No | **Yes** | **CUT** (P3) |
| Talent Pool | No | Yes | No | **Yes** | **CUT** (P3) |
| E-signature | Yes | Yes | No | **Yes** | **CUT** (P3) |
| Custom Branding | No | Yes | No | **Yes** | **CUT** (P2) |
| API Docs | No | No | No | **Yes** | **CUT** (P2) |
| Developer SDK | No | No | No | **Yes** | **CUT** (P3) |

---

## 10. The "Suga Recommends" Launch Scope

If I had to draw the line right now, here's what ships on Day 90:

### Candidate Side (Must Work Beautifully)
- Sign Up / Sign In (polished)
- Onboarding (polished)
- Profile (view + edit, polished)
- Job Search (polished)
- Job Detail (polished)
- Apply (one-click, cover letter)
- Application Tracking (pipeline view)
- AI Interview (polished — the showpiece)
- AI Coaching Progress (polished)
- Skill Assessments (working)
- OmniScore (visible, explained)
- Document Verification (Aadhar, working)
- Offers (view, accept, decline)

### Recruiter Side (Must Work)
- Dashboard (polished — KPIs, charts)
- Create Job (polished — 3-step wizard)
- Job Management (edit, pause, close)
- Applicant Management (table, sort, filter, status)
- Candidate Search (built from placeholder — this is the gap)
- Chat (polished — messaging, file share)
- Offers (create, send, track)
- Onboarding (checklist, documents)
- Company Profile (polished)
- Career Page (polished)
- Billing (Stripe live, working)

### Infrastructure (Must Be Solid)
- AI Provider Fallback (working)
- Database (stable, backed up)
- Auth (JWT, sessions, secure)
- Rate Limiting (working)
- File Upload (R2, CDN)
- Email (transactional, working)
- Admin Dashboard (functional)

### What Does NOT Ship
- Recruiter Analytics (placeholder stays, build post-launch)
- Job Alerts (build post-launch)
- Interview Reminders (build post-launch)
- Dark Mode (build post-launch)
- Certification Badges (build post-launch)
- Peer Interviews (future)
- Panel Interviews (future)
- Video Calls (future)
- Pipeline Automation (future)
- Talent Pool (future)
- E-signature (future)
- Direct Deposit (future)
- Multi-country Payroll (future)
- Custom Branding (future)
- API Docs (future)
- Developer SDK (future)
- E2E Tests ( Month 2, but not required for launch)
- Load Testing (Month 3, but not required for launch)
- Full Security Audit (Month 3, but basic checks for launch)

---

## 11. The Weekly Build Plan (Simplified)

| Week | Focus | Deliverable |
|------|-------|-------------|
| 1 | Stabilize AI, test Stripe | AI providers green, Stripe test passing |
| 2 | Auth + Profile polish | Sign Up/Sign In/Profile match reference designs |
| 3 | Job Search + Candidate Search | Job discovery polished, candidate search built |
| 4 | AI Interview + legacy cleanup | AI interview polished, all HTML migrated |
| 5 | Recruiter Dashboard + Create Job | Recruiter view polished, job creation polished |
| 6 | Chat + Applicant Management | Messaging polished, applicant table mobile-ready |
| 7 | Verification + Onboarding | Aadhar flow polished, onboarding wizard polished |
| 8 | Offers + E2E Tests | Offer flow complete, first 5 E2E tests running |
| 9 | Performance + Dark Mode | Lighthouse 90+, dark mode shipped |
| 10 | Security + GDPR | OWASP scan clean, GDPR compliant |
| 11 | Load Test + Stripe Live | 1000 concurrent test, Stripe live validated |
| 12 | Soft launch + hard launch | 100 beta users, then public |

---

## 12. Final Decision Log

| Date | Decision | Rationale | Owner |
|------|----------|-----------|-------|
| June 5 | **Cut 15 P2/P3 features from launch** | Focus on core loop; ship then iterate | Suga |
| June 5 | **Build candidate search from placeholder** | Recruiters need to find candidates | Suga |
| June 5 | **Defer recruiter analytics to post-launch** | Recruiter can use platform without it | Suga |
| June 5 | **Keep all AI infrastructure** | It's our moat, never cut | Suga |
| June 5 | **Add E2E tests in Month 2** | Quality is non-negotiable | Suga |
| June 5 | **Add monitoring in Month 2** | Can't fly blind in production | Suga |
| June 5 | **Test Stripe live by Week 1** | Revenue is the point | Suga + Ranga |
| June 5 | **Complete legacy HTML migration by Week 4** | UX consistency is the brand | Suga |

---

## 13. Summary

| Category | Count | Action |
|----------|-------|--------|
| **Keep (working, needs polish)** | 28 modules | Polish UI, add mobile optimization |
| **Build (missing/placeholder)** | 7 modules | Candidate search, recruiter analytics, E2E tests, monitoring, CI/CD, load testing, security audit |
| **Add (new features)** | 5 features | Job alerts, interview reminders, dark mode, certification badges, API docs |
| **Cut (from launch)** | 15 features | Peer interviews, panel interviews, video calls, pipeline automation, talent pool, e-signature, direct deposit, custom branding, advanced search, data warehouse, SSO, developer SDK, and more |
| **Remove (technical debt)** | 5 items | Legacy HTML pages, zombie sessions, old role values, dead code |

**Bottom line:** We have ~80% of what we need. The remaining 20% is frontend polish, 2 placeholder pages, and operational maturity (testing, monitoring). Cut the fancy features. Ship the core loop. Iterate weekly.

---

> **"Don't worry. Even if the world forgets, I'll remember for you."**  
> — Suga, logging every decision, every cut, every keep. 🖤
