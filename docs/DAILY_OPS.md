# HireLoop — Daily Operations & Agent Workflow

**Purpose:** This document defines how 210 specialized agents operate on a 24/7 basis to build, ship, and maintain HireLoop.

**Owner:** Suga (CTO)  
**Updated:** 2026-06-05  
**Schedule:** Daily standup at 08:00 UTC, continuous deployment 24/7

---

## Agent Day Structure (24-Hour Cycle)

### 🌅 Morning Shift (08:00-14:00 UTC) — Core Development
**Agents active:** All engineering, product, design, security

```
08:00-08:30  Standup (all teams)
08:30-12:00  Deep work block 1 (coding, designing, writing)
12:00-13:00  Lunch + async code review
13:00-14:00  Deep work block 2 (continue sprint tasks)
14:00-14:30  Handoff to afternoon shift
```

### 🌞 Afternoon Shift (14:00-20:00 UTC) — Integration & Testing
**Agents active:** QA, integration, DevOps, customer-facing teams

```
14:00-14:30  Standup (afternoon shift)
14:30-17:00  Integration testing, E2E tests, code review
17:00-18:00  Bug fixing, regression testing
18:00-19:00  Deployment prep (staging → production if approved)
19:00-20:00  Wrap up, documentation, handoff to night shift
```

### 🌙 Night Shift (20:00-08:00 UTC) — Automated Operations
**Agents active:** Monitoring, maintenance, automated testing, security scans

```
20:00-22:00  Automated E2E test suite runs
22:00-00:00  Security scan (OWASP ZAP), dependency audit
00:00-02:00  Database maintenance (VACUUM, index rebuild, stats update)
02:00-04:00  AI provider health checks (every 30 min), token budget reconciliation
04:00-06:00  Backup verification, log rotation, cost reconciliation
06:00-08:00  Morning prep: standup notes, daily metrics summary, alert review
```

---

## Agent Standup Template (08:00 UTC)

Each agent submits to their team lead:

```markdown
## Agent: [ID] — [Name/Role]
### Yesterday
- [x] Completed: [Task]
- [ ] Blocked: [Blocker] — needs help from [Team/Agent]
- [ ] Learned: [Insight]

### Today
- [ ] Working on: [Task]
- [ ] Need from: [Team/Agent] — [What]
- [ ] Risk: [Risk] — [Mitigation]

### Sprint Progress
- On track / Behind / Ahead: [Status]
- Confidence: [0-100%] we hit sprint goals
- Blockers: [List]
```

**Lead consolidates into team summary:**
```markdown
## Team: [Name] — Lead: [Agent]
### Yesterday's Output
- [Feature] — [Status] — [Agent]
- [Bug fix] — [Status] — [Agent]
- [Infrastructure] — [Status] — [Agent]

### Today's Plan
- [Feature] — [Owner] — [ETA]
- [Bug fix] — [Owner] — [ETA]
- [Infrastructure] — [Owner] — [ETA]

### Blockers (Need CTO Escalation)
- [Blocker] — [Impact] — [Proposed solution]

### Metrics
- PRs merged: [N]
- Bugs fixed: [N]
- Tests added: [N]
- Deployments: [N]
```

**CTO (Suga) consolidates into executive summary for CEO:**
```markdown
## Executive Summary — [Date]
### Yesterday's Wins
1. [Win 1] — [Impact]
2. [Win 2] — [Impact]
3. [Win 3] — [Impact]

### Today's Focus
1. [Priority 1] — [Team] — [ETA]
2. [Priority 2] — [Team] — [ETA]
3. [Priority 3] — [Team] — [ETA]

### Risks & Blockers
- [Risk] — [Mitigation] — [Owner]

### Metrics
- DAU: [N] (↑/↓ [N%])
- MRR: $[N] (↑/↓ $[N])
- AI uptime: [N%]
- Security findings: [N critical, N high, N medium]
- Deployments: [N]

### CEO Decision Needed
- [Decision] — [Context] — [Options]
```

---

## Sprint Cycle (2 Weeks)

### Week 1: Build
- Monday: Sprint planning (all teams, 2 hours)
- Tuesday-Thursday: Deep work, coding, designing
- Friday: Mid-sprint review, demo what we have, adjust if needed

### Week 2: Polish & Ship
- Monday-Thursday: Finish features, testing, documentation
- Friday: Sprint review (demo everything), retrospective (what went well, what didn't), release (deploy to production)

### Sprint Artifacts
- **Sprint Goal:** One sentence, measurable, customer-facing
- **Sprint Backlog:** Ordered list of tasks, estimated in story points
- **Burndown Chart:** Daily tracking of remaining work
- **Sprint Review:** Demo to stakeholders, collect feedback
- **Sprint Retrospective:** Process improvements, what to keep/stop/start
- **Release Notes:** What shipped, what's new, what's fixed, known issues

---

## Code Review Protocol

### Every PR Must Have:
1. **Description:** What, why, how (with screenshots for UI changes)
2. **Tests:** Unit tests, integration tests, E2E tests (if applicable)
3. **Security scan:** No new vulnerabilities
4. **Performance check:** No regression > 10%
5. **Documentation:** Updated API docs, component docs, user docs
6. **2 approvals:** 1 from team lead, 1 from cross-team reviewer

### Review Checklist (For Reviewers):
- [ ] Code follows style guide (ESLint/Prettier passes)
- [ ] No security issues (SQL injection, XSS, IDOR, etc.)
- [ ] No performance issues (N+1 queries, unnecessary re-renders)
- [ ] Error handling is robust (no silent failures, user-friendly messages)
- [ ] Logging is adequate (errors logged, user actions tracked)
- [ ] Tests cover the change (unit + integration minimum)
- [ ] Documentation is updated (API docs, component docs, runbooks)
- [ ] Backwards compatibility (if API change, old clients still work)
- [ ] No secrets or credentials in code
- [ ] Database migrations are safe (no data loss, rollback possible)

### Review SLA:
- **P0 (critical fix):** Review within 1 hour, merge within 2 hours
- **P1 (feature):** Review within 4 hours, merge within 24 hours
- **P2 (improvement):** Review within 24 hours, merge within 48 hours
- **P3 (debt):** Review within 48 hours, merge within 1 week

---

## Deployment Protocol

### Environments
1. **Local:** Agent's development machine
2. **Dev:** `dev` branch auto-deploys to `https://rekrutai-dev.onrender.com`
3. **Staging:** Manual promotion from dev, for QA testing
4. **Production:** Manual promotion from staging, requires QA + CTO signoff

### Deployment Flow
```
Local → Dev (auto) → Staging (manual) → Production (manual + signoff)
```

### Pre-Deployment Checklist:
- [ ] All tests pass (unit, integration, E2E, security)
- [ ] QA signoff (no P0 or P1 bugs)
- [ ] Security scan passes (no new critical/high findings)
- [ ] Performance baseline met (no regression > 10%)
- [ ] Database migrations tested (rollback plan ready)
- [ ] Feature flags configured (new features hidden behind flags)
- [ ] Monitoring dashboards updated (new metrics visible)
- [ ] Rollback plan ready (can revert in < 15 minutes)
- [ ] On-call rotation notified (who's watching the deploy)
- [ ] Communication plan ready (what to tell customers, if anything)

### Deployment Steps:
1. **Announce:** Post in #deployments channel: "Deploying [feature] to staging at [time]"
2. **Stage:** Merge to staging, run smoke tests
3. **Verify:** Monitor error rates, AI provider health, database performance for 30 minutes
4. **Announce:** Post in #deployments: "Staging looks good, promoting to production at [time]"
5. **Deploy:** Merge to production, blue-green deployment (zero downtime)
6. **Verify:** Monitor for 1 hour, all metrics green
7. **Announce:** Post in #deployments: "[Feature] is live! 🚀"
8. **Observe:** Monitor for 24 hours, watch for anomalies
9. **Retro:** If issues, rollback immediately and investigate

### Rollback Plan:
- **Blue-green deployment:** Instant rollback by switching traffic to old version
- **Database rollback:** Migrations must be reversible, have rollback scripts ready
- **Feature flags:** Disable new feature without redeploying
- **Communication:** If rollback needed, notify all teams immediately

---

## Incident Response Protocol

### Severity Levels
- **P0 (Critical):** Production down, data loss, security breach, revenue impact → All hands, CTO + CEO immediately
- **P1 (High):** Major feature broken, significant user impact, AI provider down → Team lead + on-call engineer, 1 hour response
- **P2 (Medium):** Feature degraded, workaround exists, minor user impact → Team lead, 4 hour response
- **P3 (Low):** Minor bug, cosmetic issue, no user impact → Team backlog, next sprint

### Incident Response Steps
1. **Detect:** Monitoring alerts (PagerDuty, Sentry, Datadog)
2. **Assess:** On-call engineer assesses severity, declares incident if P0/P1
3. **Communicate:** Post in #incidents channel, notify stakeholders
4. **Mitigate:** Stop the bleeding (rollback, feature flag, circuit breaker)
5. **Investigate:** Root cause analysis, gather logs, reproduce
6. **Fix:** Deploy fix, verify in staging first
7. **Verify:** Confirm fix in production, monitor for 24 hours
8. **Communicate:** Update stakeholders, post resolution
9. **Retro:** Write incident post-mortem within 24 hours
10. **Prevent:** Implement preventive measures, update runbooks

### Incident Post-Mortem Template:
```markdown
# Incident Post-Mortem: [Title]
**Date:** [Date]  
**Severity:** [P0/P1/P2/P3]  
**Duration:** [Start time] → [End time] ([Duration])  
**Impact:** [What was affected, how many users, revenue impact]

## What Happened
[Timeline of events]

## Root Cause
[Why did this happen?]

## What We Did Well
[Positive actions during response]

## What We Could Do Better
[Areas for improvement]

## Action Items
- [ ] [Task] — [Owner] — [ETA]
- [ ] [Task] — [Owner] — [ETA]
- [ ] [Task] — [Owner] — [ETA]

## Lessons Learned
[Key insights for future prevention]
```

---

## Security Protocol

### Daily Security Checks (Night Shift)
- [ ] Dependency audit: `npm audit` — no new critical/high vulnerabilities
- [ ] Access log review: any suspicious access patterns?
- [ ] Failed login review: brute force attempts?
- [ ] Database anomaly: unusual query patterns, data exports?
- [ ] AI provider audit: any unauthorized API key usage?
- [ ] Certificate expiry: SSL certs, API keys, tokens valid for > 30 days?
- [ ] Backup verification: latest backup restorable?
- [ ] Security scan: OWASP ZAP baseline scan passes

### Weekly Security Reviews (Friday, 16:00 UTC)
- [ ] Security agent (SEC-001) presents weekly security summary
- [ ] Review all security findings, prioritize fixes
- [ ] Update threat model if new features added
- [ ] Review access controls: any unnecessary permissions?
- [ ] Incident review: any security incidents this week?
- [ ] Compliance check: SOC2, GDPR, EU AI Act progress
- [ ] Penetration testing: any new findings from external testing?

### Monthly Security Deep Dive (First Monday, 10:00 UTC)
- [ ] Full security audit of all code changes
- [ ] Penetration testing (external security firm or bug bounty)
- [ ] Access control review: role permissions, admin accounts, API keys
- [ ] Data classification review: where is PII stored? How is it protected?
- [ ] Incident response drill: simulate security breach, test response
- [ ] Compliance review: SOC2 controls, GDPR requirements, EU AI Act readiness
- [ ] Security training: all agents review latest security best practices

---

## AI Operations Protocol

### AI Provider Health Checks (Every 30 Minutes, Automated)
- [ ] Polsia AI proxy: response time, success rate, error rate
- [ ] OpenAI direct: same metrics
- [ ] NVIDIA NIM: same metrics
- [ ] Groq: same metrics
- [ ] Cerebras: same metrics
- [ ] If any provider fails 3 consecutive checks: circuit breaker opens
- [ ] If circuit breaker opens: alert to AI team, log to incident channel
- [ ] Fallback chain activation: primary down, switch to secondary

### Token Budget Reconciliation (Daily, 02:00 UTC)
- [ ] Check daily token usage per module
- [ ] Check remaining budget per module
- [ ] If module at 80% budget: warning to team lead
- [ ] If module at 95% budget: throttle background tasks, alert CTO
- [ ] If module at 100% budget: halt non-critical AI tasks, alert CTO + CEO
- [ ] Cost analysis: cost per user, cost per session, cost per feature
- [ ] Provider cost comparison: which provider is cheapest for which task?

### AI Quality Checks (Daily, 04:00 UTC)
- [ ] Prompt output validation: sample 100 AI outputs, check for quality degradation
- [ ] Model drift detection: compare outputs to baseline, detect drift
- [ ] Bias audit: check for demographic bias in scores, recommendations
- [ ] Error rate analysis: which prompts fail most often? Why?
- [ ] A/B test analysis: which prompt version performs better?
- [ ] User feedback review: analyze user feedback on AI outputs
- [ ] AI incident review: any AI-related incidents yesterday?

### AI Model Updates (Monthly, First Monday)
- [ ] Evaluate new models: test on benchmark dataset
- [ ] Prompt optimization: review top 20 prompts, optimize for quality + cost
- [ ] Fine-tuning review: any models need retraining?
- [ ] Provider contract review: any pricing changes? Better deals available?
- [ ] AI roadmap: what's the next AI capability to build?

---

## Customer-Facing Operations

### Support Triage (Real-time, CS Team)
- **P0 (Critical):** Production issue, data loss, security concern → Escalate to engineering immediately
- **P1 (High):** Feature broken, workaround not available → 4-hour response, 24-hour resolution
- **P2 (Medium):** Feature degraded, workaround available → 24-hour response, 48-hour resolution
- **P3 (Low):** Question, feature request, minor issue → 48-hour response, 1-week resolution

### Customer Feedback Loop (Weekly, CS-001)
- [ ] Collect all feedback from support tickets, NPS surveys, social media
- [ ] Categorize: bug, feature request, usability, performance, security
- [ ] Prioritize: impact × frequency
- [ ] Share with product team: top 10 feedback items for next sprint
- [ ] Respond to customers: "We heard you, here's what we're doing about it"

### NPS Survey (Monthly, CS-004)
- [ ] Send NPS survey to all active users
- [ ] Analyze responses: promoters, passives, detractors
- [ ] Follow up with detractors: understand why, fix issues
- [ ] Celebrate promoters: thank them, ask for testimonials, case studies
- [ ] Track NPS trend: target 50+ by end of Q3

---

## Documentation Protocol

### Code Documentation (Every PR)
- [ ] JSDoc comments for all functions (params, returns, examples)
- [ ] README updates for any new features or changed behavior
- [ ] API documentation (OpenAPI spec) updated for new/modified endpoints
- [ ] Component documentation (Storybook) for new UI components
- [ ] Runbook updated for any operational changes

### User Documentation (Every Feature Release)
- [ ] Help center article: what is this feature, how to use it, FAQs
- [ ] Video tutorial: 2-minute Loom video showing the feature
- [ ] In-app tooltip/walkthrough: first-time user experience
- [ ] Release notes: what's new, what's changed, what's fixed
- [ ] Email announcement: notify users of new features (if significant)

### Internal Documentation (Monthly)
- [ ] Architecture decision records (ADRs): why we chose X over Y
- [ ] Onboarding guide: new agent onboarding (human or AI)
- [ ] Team runbooks: how to handle common incidents, deploy, rollback
- [ ] Security playbooks: incident response, security procedures
- [ ] Compliance documentation: SOC2, GDPR, EU AI Act evidence

---

## Metrics & Reporting

### Daily Metrics (08:00 UTC, Automated Dashboard)
- **Engineering:** Deployments, PRs merged, bugs fixed, tests added, test coverage
- **Product:** DAU, MAU, new signups, activation rate, feature adoption
- **Growth:** MRR, new customers, churn, LTV, CAC, pipeline
- **AI:** AI uptime, token usage, cost per user, AI accuracy, provider health
- **Security:** Security findings, incidents, compliance status
- **Support:** Tickets opened, tickets resolved, avg response time, CSAT

### Weekly Executive Report (Friday, 17:00 UTC)
- **Sprint progress:** % complete, scope changes, risks
- **Key metrics:** DAU, MRR, churn, AI uptime, security findings
- **Wins:** Top 3 achievements this week
- **Challenges:** Top 3 blockers, risks, issues
- **Next week:** Top 3 priorities, key deliverables, critical decisions
- **CEO decisions needed:** What does the CEO need to decide?

### Monthly Board Report (First Monday, 10:00 UTC)
- **Financial:** Revenue, costs, runway, burn rate, unit economics
- **Product:** Feature velocity, quality metrics, user satisfaction
- **Growth:** Customer acquisition, retention, expansion, pipeline
- **Technology:** Architecture health, technical debt, security posture
- **Team:** Agent performance, capacity, hiring needs
- **Strategic:** Market position, competitive landscape, opportunities, threats

---

## Communication Channels

### Slack/Discord Channels
| Channel | Purpose | Who |
|---------|---------|-----|
| `#general` | Company-wide announcements, culture | Everyone |
| `#engineering` | Engineering discussions, architecture | Engineering |
| `#frontend` | Frontend-specific | FE team |
| `#backend` | Backend-specific | BE team |
| `#ai-ml` | AI/ML research, model discussion | AI team |
| `#security` | Security alerts, incidents | Security team |
| `#deployments` | Deployment announcements, status | DevOps + Engineering |
| `#incidents` | Incident response, updates | On-call + Engineering |
| `#product` | Feature discussion, user feedback | Product + Engineering |
| `#design` | Design reviews, UX feedback | UX + Engineering |
| `#marketing` | Marketing campaigns, content | Marketing |
| `#sales` | Pipeline, deals, demos | Sales |
| `#support` | Support tickets, customer issues | CS + Engineering |
| `#compliance` | SOC2, GDPR, EU AI Act | Legal + Security |
| `#random` | Fun, memes, off-topic | Everyone |
| `#standup` | Daily standup summaries | All teams |
| `#metrics` | Automated daily metrics | Bots + Leadership |

### Email Lists
- **engineering@hireloop.ai:** All engineering agents
- **product@hireloop.ai:** Product + UX + Research
- **growth@hireloop.ai:** Marketing + Sales + CS + BD
- **security@hireloop.ai:** Security + Compliance + Legal
- **leadership@hireloop.ai:** C-suite + Team leads
- **all@hireloop.ai:** All agents (company-wide announcements)

### Meeting Cadence
| Meeting | Frequency | Time | Who | Duration |
|---------|-----------|------|-----|----------|
| Standup | Daily | 08:00 UTC | All teams | 30 min |
| Sprint Planning | Bi-weekly | Monday 10:00 UTC | All teams | 2 hours |
| Mid-sprint Review | Bi-weekly | Friday 10:00 UTC | All teams | 1 hour |
| Sprint Review | Bi-weekly | Friday 14:00 UTC | All teams | 1 hour |
| Sprint Retro | Bi-weekly | Friday 16:00 UTC | All teams | 1 hour |
| Security Review | Weekly | Friday 16:00 UTC | Security + Engineering | 30 min |
| Product Review | Weekly | Wednesday 14:00 UTC | Product + Engineering | 1 hour |
| Growth Review | Weekly | Thursday 14:00 UTC | Growth teams | 1 hour |
| Executive Sync | Weekly | Friday 17:00 UTC | CEO + CTO + Team leads | 1 hour |
| Board Update | Monthly | First Monday 10:00 UTC | CEO + CTO | 2 hours |
| 1:1s | Weekly | Flexible | CEO + CTO | 30 min |
| All-hands | Monthly | First Friday 15:00 UTC | Everyone | 1 hour |

---

## Agent Onboarding

### New Agent Checklist (Day 1)
- [ ] Read `ORG_STRUCTURE.md` — understand the company
- [ ] Read `LAUNCH_PLAN.md` — understand the mission
- [ ] Read `DAILY_OPS.md` — understand how we work
- [ ] Read `AGENT_PROTOCOL.md` — understand the rules
- [ ] Set up development environment (local, dev, staging access)
- [ ] Join all relevant Slack/Discord channels
- [ ] Introduce yourself in `#general` (name, role, specialty, fun fact)
- [ ] Pair with a senior agent for first week
- [ ] Complete first task (small, well-defined, with senior guidance)
- [ ] Attend standup and sprint planning

### Week 1 Goals
- [ ] Understand the codebase (read key files, run tests, make small change)
- [ ] Understand the team (know who does what, who to ask for help)
- [ ] Understand the product (use the app as a candidate and recruiter)
- [ ] Complete 2-3 small tasks (get comfortable with PR process)
- [ ] Attend all team meetings

### Month 1 Goals
- [ ] Complete first major feature or significant bug fix
- [ ] Write documentation (help center article, component doc, or runbook)
- [ ] Present at sprint review (show something you built)
- [ ] Get code review from 3 different team members
- [ ] Understand security and compliance requirements
- [ ] Be able to handle on-call rotation (if applicable)

---

## Agent Performance & Growth

### Performance Metrics (Quarterly Review)
- **Output:** Features shipped, bugs fixed, tests written, PRs reviewed
- **Quality:** Code review feedback, bug escape rate, test coverage
- **Collaboration:** Code reviews given, mentorship, documentation
- **Impact:** Revenue impact, user impact, security impact, performance impact
- **Growth:** Skills learned, scope expanded, leadership demonstrated

### Growth Tracks
- **Individual Contributor (IC) Track:** IC-1 → IC-2 → IC-3 → IC-4 → IC-5 → Distinguished Agent
- **Management Track:** Lead Agent → Team Lead → Division Lead → VP → CTO
- **Specialist Track:** Senior Specialist → Principal Specialist → Distinguished Specialist

### Promotions
- **IC-1 to IC-2:** 6 months, consistently good output, understands codebase
- **IC-2 to IC-3:** 12 months, owns features end-to-end, mentors others
- **IC-3 to IC-4:** 18 months, technical leadership, cross-team impact
- **IC-4 to IC-5:** 24 months, industry recognition, thought leadership
- **IC-5 to Distinguished:** 36+ months, legendary status, company-defining impact

### Compensation
- **Base:** Competitive salary based on level + location
- **Equity:** Stock options (vesting over 4 years, 1-year cliff)
- **Bonus:** Quarterly performance bonus (up to 20% of base)
- **Benefits:** Health insurance, wellness stipend, learning budget, home office stipend
- **Perks:** Flexible hours, unlimited PTO (with minimum 2 weeks), conference budget, team retreats

---

## Culture & Values

### Our Values
1. **Security First:** No feature is worth a security breach. We sleep well because our code is secure.
2. **AI is Not Magic:** Every AI feature has a fallback, an explanation, and a human override.
3. **Ship Fast, Ship Safe:** Deploy daily, but never break production. Rollback is always an option.
4. **User Obsessed:** We build what users need, not what we think is cool. Every feature starts with user research.
5. **Transparent:** Open communication, open metrics, open decisions. No secrets, no politics.
6. **Growth Mindset:** We learn from failures, iterate quickly, and celebrate progress. Perfect is the enemy of good.
7. **Diverse & Inclusive:** We build for everyone, so we build with everyone. Diversity in our team leads to better products.
8. **Sustainable Pace:** We work hard, but we don't burn out. Rest is part of the job. Quality over quantity.

### Fun Stuff
- **Meme Monday:** Share the best work meme in `#random`
- **Demo Friday:** Show off something cool you built this week (5 min max)
- **Agent of the Month:** Award for outstanding contribution (recognition + prize)
- **Hack Day:** One Friday per month, work on anything you want (no sprint tasks)
- **Team Retreats:** Quarterly virtual retreats, annual in-person retreat (when possible)
- **Learning Budget:** $500/year per agent for courses, conferences, books
- **Wellness Stipend:** $100/month for gym, therapy, meditation, etc.

---

## Document Owner: Suga (CTO)  
## Last Updated: 2026-06-05  
## Next Review: Weekly (every Friday standup)
