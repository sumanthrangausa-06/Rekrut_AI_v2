# HireLoop AI — 30-Day CEO Launch Plan

> **CEO:** Suga (me)
> **Mission:** Full production-ready MVP by June 30, 2026
> **Current Date:** June 7, 2026
> **Days Remaining:** 23 days
> **Status:** In Progress

---

## Executive Summary

We are pivoting from 90-day timeline to 30-day forced march. No feature creep. No perfectionism. Ship what works, fix what breaks.

**Current State:**
- Security: ✅ 100% (6 critical → 0)
- Legacy migration: ✅ 100% (11 HTML → React)
- Build: ✅ Clean
- TypeScript: ⚠️ 15 pre-existing errors (acceptable)
- Dev environment: 🔄 Fixed (assets loading)
- Candidate Search: 90% (needs API testing)
- Recruiter Analytics: 90% (needs API testing)
- E2E Tests: 25% (infrastructure built, needs validation)
- Stripe: 10% (routes exist, needs live keys)
- Mobile responsive: 85% (2 fixes committed)

**Critical Path to Launch:**
1. Fix dev environment rendering (React blank screen)
2. Complete Candidate Search + Recruiter Analytics APIs
3. Stripe live validation
4. E2E test validation
5. Prod deployment at rekrutai.co
6. Marketing site + content
7. Launch announcement

---

## Organization Structure

### C-Suite (3 agents)

| Role | Agent | Responsibility |
|------|-------|----------------|
| **CEO** | Suga | Strategy, decisions, unblocking, user communication |
| **CTO** | Suga-ENG | Technical architecture, code review, build pipeline |
| **CMO** | CMO | Marketing, content, launch announcement, SEO |

### Engineering Teams (12 agents max)

**Backend Team (4 agents):**
- BE-LEAD: API design, database, architecture decisions
- BE-001: Candidate APIs, search, matching
- BE-002: Recruiter APIs, analytics, dashboard
- BE-003: Stripe integration, billing, webhooks

**Frontend Team (4 agents):**
- FE-LEAD: Component architecture, state management
- FE-001: Candidate pages, job search, profile
- FE-002: Recruiter pages, analytics, jobs
- FE-003: Mobile responsive, dark mode, accessibility

**AI/ML Team (2 agents):**
- AI-LEAD: Prompt engineering, model selection, circuit breaker
- AI-001: Interview AI, matching engine, OmniScore

**DevOps/QA Team (2 agents):**
- DO-LEAD: CI/CD, Render, monitoring, deploys
- QA-LEAD: E2E tests, manual testing, bug tracking

### Growth Team (3 agents)

- MKT-001: Content marketing, blog posts, social media
- MKT-002: SEO, landing page optimization
- GRW-001: User onboarding, funnel optimization

---

## 30-Day Sprint Plan (June 7 → June 30)

### Phase 1: Foundation (June 7-10) — Days 1-4
**Goal:** Fix broken things, complete core APIs, validate E2E

| Day | Task | Owner | Status |
|-----|------|-------|--------|
| Jun 7 | Fix dev env React rendering | DO-LEAD | 🔄 In Progress |
| Jun 7 | Complete Candidate Search API | BE-001 | 🔄 90% |
| Jun 7 | Complete Recruiter Analytics API | BE-002 | 🔄 90% |
| Jun 8 | Validate E2E smoke tests | QA-LEAD | ⏳ Pending |
| Jun 8 | Stripe test mode validation | BE-003 | ⏳ Pending |
| Jun 9 | Fix all TypeScript errors | FE-LEAD | ⏳ Pending |
| Jun 10 | Mobile responsive final pass | FE-003 | ⏳ Pending |

### Phase 2: Feature Complete (June 11-17) — Days 5-11
**Goal:** All features working, APIs connected, payment flows tested

| Day | Task | Owner | Status |
|-----|------|-------|--------|
| Jun 11 | Candidate flow E2E | QA-LEAD | ⏳ Pending |
| Jun 11 | Recruiter flow E2E | QA-LEAD | ⏳ Pending |
| Jun 12 | Stripe live mode validation | BE-003 | ⏳ Pending |
| Jun 13 | AI features validation | AI-LEAD | ⏳ Pending |
| Jun 14 | Security audit re-run | DO-LEAD | ⏳ Pending |
| Jun 15 | Performance optimization | FE-LEAD | ⏳ Pending |
| Jun 16 | Dark mode final check | FE-003 | ⏳ Pending |
| Jun 17 | Accessibility audit | FE-003 | ⏳ Pending |

### Phase 3: Launch Prep (June 18-24) — Days 12-18
**Goal:** Staging → Prod, marketing ready, docs complete

| Day | Task | Owner | Status |
|-----|------|-------|--------|
| Jun 18 | Staging → Main promotion | DO-LEAD | ⏳ Pending |
| Jun 19 | Prod deployment at rekrutai.co | DO-LEAD | ⏳ Pending |
| Jun 20 | Marketing site launch | MKT-001 | ⏳ Pending |
| Jun 21 | Blog post + social content | MKT-002 | ⏳ Pending |
| Jun 22 | User onboarding flow | GRW-001 | ⏳ Pending |
| Jun 23 | Documentation complete | FE-LEAD | ⏳ Pending |
| Jun 24 | Load testing | DO-LEAD | ⏳ Pending |

### Phase 4: Launch (June 25-30) — Days 19-23
**Goal:** Public launch, monitoring, rapid fixes

| Day | Task | Owner | Status |
|-----|------|-------|--------|
| Jun 25 | Soft launch (beta users) | CEO | ⏳ Pending |
| Jun 26 | Monitor metrics, fix bugs | All | ⏳ Pending |
| Jun 27 | Public announcement | CMO | ⏳ Pending |
| Jun 28 | Post-launch optimization | All | ⏳ Pending |
| Jun 29 | Retrospective | CEO | ⏳ Pending |
| Jun 30 | **HARD LAUNCH** | CEO | ⏳ Pending |

---

## Daily Schedule (24/7 Operation)

### 00:00-08:00 UTC — Night Shift (Automated)
- AI provider health check (every 30 min)
- Security scan (OWASP ZAP)
- Dependency audit (`npm audit`)
- Backup verification
- Cost reconciliation
- Anomaly detection

### 08:00-09:00 UTC — Morning Standup
**CEO (me) consolidates:**
- What shipped yesterday
- What's blocked
- Today's priorities
- Agent assignments

### 09:00-12:00 UTC — Deep Work Block 1
- **Frontend:** UI polish, responsive fixes, API integration
- **Backend:** API completion, Stripe, security
- **AI:** Prompt tuning, model validation
- **DevOps:** Deploys, monitoring, infrastructure

### 12:00-13:00 UTC — Code Review + Merge
- Review all agent commits from morning
- Run build + TypeScript check
- Merge approved PRs to dev
- Update staging

### 13:00-17:00 UTC — Deep Work Block 2
- **Continuation of morning work**
- **Cross-team:** Backend + Frontend integration
- **QA:** E2E tests, manual testing
- **Marketing:** Content, landing page

### 17:00-18:00 UTC — Wrap & Handoff
- Task board updates
- Build verification
- Commit to dev
- Agent summary
- Prep for night shift

### 18:00-00:00 UTC — Evening Shift
- **Marketing:** Content creation, social posts
- **Growth:** Funnel optimization, onboarding
- **QA:** Bug triage, regression testing
- **CEO:** Review day, plan tomorrow, user updates

---

## GitHub Tracking

### Issues
- Use GitHub Issues for all tasks
- Labels: `P0-launch`, `P1-feature`, `P2-nice`, `bug`, `frontend`, `backend`, `ai`, `devops`, `marketing`
- Milestones: `Phase 1`, `Phase 2`, `Phase 3`, `Launch`

### Projects
- GitHub Project board: "HireLoop Launch"
- Columns: Backlog → In Progress → Review → Done
- Automation: PRs auto-move to Review, merged PRs auto-move to Done

### Pull Requests
- All work via PRs, no direct pushes to dev/staging/main
- Required reviews: 1 agent approval
- CI checks: build, TypeScript, security audit
- Merge strategy: squash merge for clean history

---

## Agent Spawn Rules (Updated)

- **Max 5 agents per day** (cost control: ~$27/day)
- **Max 2 parallel per task** (coordination)
- **One agent, one file, one task** (micro-tasking)
- **3-minute timeout per agent** (cost control)
- **Always checkout dev branch** before work
- **Never push to staging/main directly**
- **GitHub PR workflow mandatory**

---

## Skills to Deploy

### From GitHub Repos (User Shared)

1. **Alibaba Open Code Review** → Code review skill for all agents
   - Install: `openclaw skills install alibaba/open-code-review`
   - Use: Precise line-level comments, deterministic rules
   - Share with: All engineering agents

2. **Anthropic Defending Code** → Security scanning skill
   - Install: `openclaw skills install anthropic/defending-code`
   - Use: Vulnerability detection, triage, patching
   - Share with: BE-LEAD, DO-LEAD, QA-LEAD

3. **Awesome OpenClaw Skills** → Skill discovery
   - Reference: 5,400+ skills from ClawHub
   - Use: Find relevant skills for specific tasks
   - Share with: All agents

4. **memU** → Agent memory system
   - Install: `pip install memu-py` or clone repo
   - Use: Structured memory, 10x token reduction
   - Share with: All agents (context persistence)

### From OpenClaw Skills

- `gh-issues` → GitHub issue management
- `github` → GitHub PR workflows
- `healthcheck` → Service monitoring
- `taskflow` → Task orchestration
- `taskflow-inbox-triage` → Priority management
- `browser-automation` → E2E testing
- `spike` → Rapid prototyping
- `copywriting` → Marketing content
- `content-research-writer` → Blog posts
- `seo-audit` → SEO optimization

---

## Communication Protocol

### CEO → User (Ranga)
- **Daily standup:** 08:00 UTC — async message with progress
- **Blockers:** Immediate — when something needs Ranga's decision
- **Launch updates:** Weekly summary + daily during final week
- **Format:** Bullet points, no fluff, action items clear

### CEO → Agents
- **Task assignment:** GitHub Issues + GitHub Projects
- **Context:** AGENT_BRIEFING.md (compressed codebase state)
- **Code review:** GitHub PRs with automated checks
- **Feedback:** Inline on PRs, async, no meetings

### Agent → CEO
- **Progress:** GitHub PR descriptions
- **Blockers:** GitHub Issue comments with `@suga` mention
- **Completion:** PR merged, Issue closed

---

## Success Metrics (Launch Day)

| Metric | Target | Current |
|--------|--------|---------|
| Build passes | 100% | 100% ✅ |
| TypeScript errors | ≤ 3 | 15 ⚠️ |
| Security findings | 0 critical/high | 0 ✅ |
| E2E tests passing | > 80% | 25% 🔄 |
| API response time | < 200ms | Unknown |
| Mobile responsive | 100% | 85% 🔄 |
| Stripe payments | Working | 10% 🔄 |
| AI features | Functional | Unknown |
| Uptime | > 99% | Unknown |

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Dev env rendering issue | High | High | Fix today, validate before any other work |
| Stripe live keys delay | Medium | High | Start test mode now, have fallback |
| API integration bugs | Medium | High | E2E tests, parallel agent testing |
| Agent cost overruns | Medium | Medium | 5/day max, 3-min timeout, micro-tasks |
| Scope creep | High | Medium | Ruthless P0-only, defer everything else |
| User onboarding friction | Medium | Medium | GRW-001 focused on funnel optimization |

---

## Immediate Actions (Next 2 Hours)

1. ✅ **Fix dev env React rendering** — DO-LEAD priority
2. ✅ **Validate E2E tests** — QA-LEAD (after dev env fixed)
3. ✅ **Complete Candidate Search API** — BE-001
4. ✅ **Complete Recruiter Analytics API** — BE-002
5. ✅ **Stripe test mode** — BE-003
6. ✅ **Update AGENT_BRIEFING.md** — Suga
7. ✅ **Install shared skills** — All agents
8. ✅ **Set up GitHub Project board** — Suga

---

*Created: 2026-06-07*
*CEO: Suga*
*Next Review: Daily at 08:00 UTC*
