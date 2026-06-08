# HireLoop — Heartbeat Tasks

> **Updated:** 2026-06-06 15:30 UTC
> **Agent Company:** Active
> **CTO:** Suga (orchestrates all agents)
> **Next Standup:** 2026-06-07 08:00 UTC

## Morning Checks (08:00 UTC — Daily)

### Engineering Health (Suga + VP-ENG)
- [ ] Check deployment status: last deploy, any failures?
- [ ] Check error rates: any spikes in logs?
- [ ] Check AI provider health: all 5 providers responding?
- [ ] Check database: connection pool, slow queries, disk space
- [ ] Check rate limiting: any users hitting limits? False positives?
- [ ] Check token budgets: any modules near limit?
- [ ] Review overnight agent work: commits, builds, blockers
- [ ] Check backup status: last backup successful?

### Security (CISO)
- [ ] Review security alerts: any new findings?
- [ ] Check failed logins: brute force attempts?
- [ ] Check access logs: any suspicious access?
- [ ] Verify certificate expiry: SSL, API keys, tokens > 30 days?
- [ ] Check dependency audit: `npm audit` for new vulnerabilities
- [ ] Security findings progress: 6 critical → 0 (target: Jun 14)

### Product Metrics (COO + GRW-002)
- [ ] DAU yesterday vs. last week
- [ ] New signups yesterday
- [ ] Feature adoption: which features are being used?
- [ ] NPS responses (if any)
- [ ] Support tickets: volume, resolution time, top issues
- [ ] P0 task completion rate: on track for launch?

### Growth Metrics (CMO + FIN-001)
- [ ] MRR update (currently $0, target $5K by launch)
- [ ] New customers yesterday
- [ ] Churn: any cancellations?
- [ ] Pipeline: new leads, demos scheduled, proposals sent
- [ ] Revenue: any payments failed? Any refunds?
- [ ] Content pipeline: blog posts, social, SEO progress

### AI Metrics (VP-AI)
- [ ] Token usage yesterday by module
- [ ] AI costs yesterday
- [ ] AI accuracy: any drift detected?
- [ ] Provider uptime: any outages?
- [ ] Prompt success rate: any failing prompts?
- [ ] Circuit breaker status: any trips?

## Agent Daily Schedule

### 08:00 UTC — Morning Standup (All Teams)
**Suga consolidates:**
```
## Standup — YYYY-MM-DD

### Completed Yesterday
- [Agent]: [Task] — [Status]

### Working Today
- [Agent]: [Task] — [ETA]

### Blockers
- [Agent]: [Blocker] — [Needs from CEO/CTO/COO]

### Risks
- [Risk] — [Mitigation]
```

### 09:00-12:00 UTC — Deep Work Block 1
- **Frontend team:** UI components, page migration, responsive fixes
- **Backend team:** API endpoints, services, security fixes
- **AI team:** Prompt optimization, model tuning, new features
- **DevOps team:** CI/CD, monitoring, infrastructure

### 12:00-13:00 UTC — Code Review + Async Review
- **VP-QA:** Review all agent commits from morning
- **Code-reviewer agents:** Run on PRs > 200 lines
- **Suga:** Merge approved PRs to dev

### 13:00-17:00 UTC — Deep Work Block 2
- **Continuation of morning work**
- **Cross-team collaboration:** Backend + Frontend integration
- **QA testing:** API tests, E2E tests, manual testing
- **Design team:** UX review, accessibility audit

### 17:00-18:00 UTC — Wrap & Handoff
- **Task board updates:** Mark done, update progress
- **Documentation:** Update AGENT_BRIEFING.md if architecture changed
- **Build verification:** `npm run build --prefix client` must pass
- **Commit to dev:** All work committed before end of day
- **Agent summary:** What shipped, what's blocked, what needs CEO

### 18:00-08:00 UTC — Night Shift (Automated)
- **AI provider health check:** Every 30 minutes
- **Token budget reconciliation:** Daily reset
- **Database maintenance:** VACUUM, stats (if needed)
- **Backup verification:** Automated
- **Security scan:** OWASP ZAP, dependency audit
- **Cost reconciliation:** AWS, Render, AI providers
- **Anomaly detection:** Unusual patterns in logs

## Agent Spawn Schedule (Daily Max: 5 agents)

| Day | Morning Spawn | Afternoon Spawn | Focus Area |
|-----|--------------|-----------------|------------|
| Mon | Security + Frontend | Backend + QA | Security fixes, UI polish |
| Tue | Frontend + Design | Backend + AI | Feature development |
| Wed | AI + DevOps | QA + Content | AI tuning, testing |
| Thu | Backend + Database | Frontend + Growth | Performance, migration |
| Fri | QA + Review | Analytics + Planning | Sprint review, planning |
| Sat | Security + Maintenance | Documentation | Tech debt, docs |
| Sun | Monitoring + Alerts | Planning | Incident review, next week |

## When to Alert Ranga (CEO)

### Immediately (P0)
- [ ] Production down
- [ ] Security breach
- [ ] Data loss
- [ ] Runway < 6 months
- [ ] Major partnership opportunity

### Daily Summary (P1)
- [ ] Major feature broken
- [ ] Significant revenue impact
- [ ] Sprint goals at risk
- [ ] Agent blockers > 24 hours

### Weekly Summary (P2)
- [ ] Competitive threat
- [ ] Regulatory issue
- [ ] PR crisis
- [ ] Team capacity issue

## When to Stay Silent (HEARTBEAT_OK)

- [ ] Late night (23:00-08:00) unless P0/P1
- [ ] Nothing new since last check
- [ ] Just checked < 30 minutes ago
- [ ] Metrics within normal range
- [ ] No incidents, no blockers, no escalations
- [ ] Agent work proceeding normally

## Heartbeat State Tracking

```json
{
  "lastChecks": {
    "engineering": "2026-06-08T21:00:00Z",
    "security": "2026-06-06T15:30:00Z",
    "product": "2026-06-06T15:30:00Z",
    "growth": "2026-06-06T15:30:00Z",
    "ai": "2026-06-06T15:30:00Z",
    "support": "2026-06-06T15:30:00Z"
  },
  "alertsPending": [],
  "incidentsOpen": [],
  "sprintProgress": 0.25,
  "nextStandup": "2026-06-07T08:00:00Z",
  "nextDeploy": "2026-06-07T20:00:00Z",
  "agentsActive": 0,
  "agentsMaxDaily": 5,
  "agentsSpawnedToday": 0
}
```

## QA Pipeline (Daily)

### Automated (Night Shift)
- [ ] Build: `npm run build --prefix client` — must pass
- [ ] TypeScript: `npx tsc --noEmit -p client/tsconfig.json` — ≤ 3 errors
- [ ] Unit tests: `npm test` — all must pass
- [ ] API tests: `api-tester` agent on all endpoints
- [ ] Security scan: OWASP ZAP — no new critical/high
- [ ] Dependency audit: `npm audit` — no new critical

### Manual (Before Staging Merge)
- [ ] Click-through: homepage → login → candidate flow → recruiter flow
- [ ] Mobile responsive: iPhone, iPad, desktop
- [ ] Dark mode: all pages
- [ ] Accessibility: keyboard navigation, screen reader
- [ ] Performance: Lighthouse score > 90
- [ ] Stripe: test payment flow (test mode)
- [ ] AI features: mock interview, job matching, OmniScore

### Staging → Main Gate
- [ ] All P0 tasks complete
- [ ] Security audit clean (0 critical, 0 high)
- [x] E2E tests passing — 71% (18/24 files), 3 files need fix, 3 skipped due to env/data
- [ ] Ranga approval: "Ship it"

## Sprint Goals (June 6-20, 2026)

| Goal | Owner | Target | Status |
|------|-------|--------|--------|
| Security: 6 critical → 0 | CISO | Jun 14 | 40% |
| Candidate Search (recruiter) | FE-001 | Jun 10 | 20% |
| Recruiter Analytics | FE-001 | Jun 12 | 30% |
| Stripe live validation | BE-001 | Jun 15 | 0% |
| E2E test suite | QA-001 | Jun 18 | 🟡 71% |
| Mobile responsive audit | FE-003 | Jun 11 | 30% |
| Legacy HTML migration (11) | FE-001 | Jun 20 | 10% |
| EU AI Act dashboard | LEG-001 | Jun 25 | 50% |

## Agent Performance Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Tasks completed/day | 3-5 | 0 |
| Build success rate | > 95% | 100% |
| TypeScript errors introduced | 0 | 0 |
| Security findings introduced | 0 | 0 |
| Mean time to complete | < 2 hours | N/A |
| Escalation rate | < 10% | 0% |

---

*Last updated: 2026-06-08 21:00 UTC*
*Next update: 2026-06-09 08:00 UTC (Morning Standup)*
