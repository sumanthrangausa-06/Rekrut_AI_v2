# Rekrut AI - Task Board
**Last Updated:** 2026-05-02
**Sprint:** Phase 1 - Deepen the Moat

---

## 📋 How Agents Work

1. Each agent reads this file on their scheduled run
2. Agents pick up tasks marked `[ ]` (not done)
3. After completing, agent marks task `[x]` and commits
4. Results emailed to you automatically

---

## 🚨 Urgent / Hot Fixes
*These get picked up first by any available agent*

- [x] ~~Fix PostgreSQL syntax in migration (deployment failed)~~ ✅ FIXED

---

## 🔴 Phase 1: Deepen the Moat (Week 1-2)

### Backend Developer (Daily 9am)
- [x] ~~Email notifications system~~ ✅ DONE (Agent completed)
- [x] ~~Recruiter AI Screener - reuse polsia-ai.js~~ ✅ DONE (Needs testing)
- [ ] OmniScore v2 - Add company scoring, explainability
- [ ] EU AI Act compliance dashboard
- [ ] ATS integrations (Greenhouse API)

### Frontend Developer (Daily 10am)
- [x] ~~Migrate recruiter-analytics.html to React~~ ✅ DONE (Agent completed)
- [ ] Build Screening Results UI in recruiter dashboard
- [ ] OmniScore explanation UI ("Why this score?")
- [ ] Mobile responsiveness audit

### QA Engineer (Daily 2pm)
- [ ] Test Recruiter AI Screener API endpoints
- [ ] Test Email notification templates
- [ ] Regression test core flows (apply, interview, assess)
- [ ] Mobile responsiveness testing

### DevOps Engineer (Daily 6pm)
- [x] ~~Fix Render deployment~~ ✅ DONE
- [ ] Set up staging environment
- [ ] Add GitHub Actions CI/CD
- [ ] Set up uptime monitoring (UptimeRobot)
- [ ] Rotate admin password (security issue)

---

## 🟡 Phase 2: Enterprise Readiness (Week 3-4)

### Backend Developer
- [ ] Google Calendar integration
- [ ] Outlook Calendar integration
- [ ] Custom workflow builder backend

### Frontend Developer
- [ ] Calendar sync UI
- [ ] Drag-and-drop pipeline builder
- [ ] Interviewer evaluation UI

### CTO (Weekly Tuesday)
- [ ] Review architecture for scalability
- [ ] Plan database sharding strategy
- [ ] Security audit

---

## 🟢 Phase 3: Polish & Scale (Week 5-8)

### Backend Developer
- [ ] AI resume parsing
- [ ] Public API v1
- [ ] Webhooks for integrations

### Frontend Developer
- [ ] Candidate self-service portal
- [ ] Settings page redesign
- [ ] Performance optimization

### DevOps Engineer
- [ ] CDN setup
- [ ] Database backups automation
- [ ] Load balancing

---

## 📊 Metrics & Goals

| Metric | Current | Target | Date |
|--------|---------|--------|------|
| Users | 15 | 100 | May 31 |
| Jobs Posted | 1 | 20 | May 31 |
| Applications | 1 | 50 | May 31 |
| MRR | $0 | $5,000 | Jun 30 |

---

## 🔄 Recent Completions

| Date | Agent | Task | Commit |
|------|-------|------|--------|
| 2026-05-02 | Backend | Email notifications system | b026d84 |
| 2026-05-02 | Frontend | Recruiter analytics React migration | b026d84 |
| 2026-05-02 | DevOps | Deployment audit report | - |
| 2026-05-02 | PM | Prioritized sprint plan | - |
| 2026-05-02 | (Manual) | Recruiter AI Screener | 283e54e |

---

## 📝 Notes for Agents

- Always read GAP_ANALYSIS.md for context
- Always read FEATURE_MAP.md for vision
- Run tests before committing
- Check Render deployment after pushing
- Email results to user
