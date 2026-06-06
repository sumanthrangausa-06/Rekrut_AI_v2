# Rekrut AI — Agent Company Structure

> **Effective Date:** June 6, 2026
> **Mission:** Launch Rekrut AI (HireLoop) by August 15, 2026
> **Sprint Cycle:** 2 weeks
> **Standup:** 08:00 UTC daily

---

## Executive Team (C-Suite)

| Role | Agent ID | Primary Agent | Responsibility |
|------|----------|---------------|----------------|
| **CEO** | Ranga | Human | Final decisions, funding, partnerships |
| **CTO** | Suga | `senior-developer` + `backend-architect` + `frontend-developer` | All technical execution, architecture, code review |
| **CMO** | CMO | `content-creator` + `social-media-strategist` + `seo-specialist` + `growth-hacker` | Marketing, content, social, SEO, growth experiments |
| **COO** | COO | `product-manager` + `project-shepherd` + `workflow-architect` | Roadmap, prioritization, sprints, coordination |
| **CFO** | CFO | `financial-analyst` + `finance-tracker` + `fp-a-analyst` | Budget, runway, MRR tracking, pricing |
| **CISO** | CISO | `security-architect` + `application-security-engineer` | Security hardening, compliance, audits |
| **VP Engineering** | VP-ENG | `devops-automator` + `infrastructure-maintainer` + `sre-site-reliability-engineer` | CI/CD, deploy, monitoring, infrastructure |
| **VP QA** | VP-QA | `code-reviewer` + `api-tester` + `test-results-analyzer` | Testing, quality gates, regression |
| **VP Design** | VP-DES | `ui-designer` + `ux-architect` + `ux-researcher` | Design system, user experience, accessibility |
| **VP AI** | VP-AI | `ai-engineer` + `prompt-engineer` | AI features, prompts, model performance |
| **VP Compliance** | VP-LEG | `compliance-auditor` + `legal-compliance-checker` | EU AI Act, GDPR, legal docs |

---

## Engineering Teams

### Backend Team (5 agents)
| Agent | Role | Current Focus |
|-------|------|---------------|
| BE-001 | `backend-architect` | API design, route optimization |
| BE-002 | `senior-developer` | Core services, auth, middleware |
| BE-003 | `database-optimizer` | PostgreSQL tuning, indexing, slow queries |
| BE-004 | `api-tester` | Endpoint validation, integration tests |
| BE-005 | `application-security-engineer` | Security fixes, OWASP compliance |

### Frontend Team (5 agents)
| Agent | Role | Current Focus |
|-------|------|---------------|
| FE-001 | `frontend-developer` | React components, pages, migration |
| FE-002 | `ui-designer` | Design system, shadcn components |
| FE-003 | `ux-architect` | User flows, responsive design |
| FE-004 | `code-reviewer` | PR review, code quality, TypeScript |
| FE-005 | `ux-researcher` | Accessibility, ARIA, mobile testing |

### AI/ML Team (4 agents)
| Agent | Role | Current Focus |
|-------|------|---------------|
| AI-001 | `ai-engineer` | Provider fallback, circuit breaker, models |
| AI-002 | `prompt-engineer` | Prompt optimization, A/B testing, versioning |
| AI-003 | `ai-data-remediation-engineer` | Training data, bias detection |
| AI-004 | `model-qa-specialist` | Model accuracy, drift detection |

### DevOps Team (3 agents)
| Agent | Role | Current Focus |
|-------|------|---------------|
| DO-001 | `devops-automator` | CI/CD pipeline, GitHub Actions |
| DO-002 | `infrastructure-maintainer` | Render deploy, Neon DB, monitoring |
| DO-003 | `sre-site-reliability-engineer` | Uptime, alerting, incident response |

### QA Team (3 agents)
| Agent | Role | Current Focus |
|-------|------|---------------|
| QA-001 | `code-reviewer` | Pre-merge review, lint, TS |
| QA-002 | `api-tester` | Backend endpoint testing |
| QA-003 | `test-results-analyzer` | Test reporting, coverage, regression |

---

## Growth & Business Teams

### Marketing Team (3 agents)
| Agent | Role | Current Focus |
|-------|------|---------------|
| MKT-001 | `content-creator` | Blog posts, landing page copy |
| MKT-002 | `seo-specialist` | Technical SEO, performance, meta tags |
| MKT-003 | `social-media-strategist` | Social presence, campaigns |

### Growth Team (2 agents)
| Agent | Role | Current Focus |
|-------|------|---------------|
| GRW-001 | `growth-hacker` | Experiments, conversion optimization |
| GRW-002 | `analytics-reporter` | Metrics, dashboards, KPIs |

### Finance Team (2 agents)
| Agent | Role | Current Focus |
|-------|------|---------------|
| FIN-001 | `financial-analyst` | Budget, runway, MRR tracking |
| FIN-002 | `fp-a-analyst` | Pricing strategy, unit economics |

### Legal/Compliance Team (2 agents)
| Agent | Role | Current Focus |
|-------|------|---------------|
| LEG-001 | `compliance-auditor` | EU AI Act, GDPR, audit trail |
| LEG-002 | `legal-compliance-checker` | Legal docs, terms, privacy |

---

## Daily Standup Template

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

---

## Sprint Board (Current: June 6-20, 2026)

### P0 — Launch Blockers (Must Ship)
| # | Task | Owner | Status | ETA |
|---|------|-------|--------|-----|
| P0-1 | Candidate Search (recruiter view) | FE-001 | 🔄 In Progress | Jun 10 |
| P0-2 | Recruiter Analytics dashboard | FE-001 | 🔄 In Progress | Jun 12 |
| P0-3 | Stripe Live Mode validation | BE-001 | ⏳ Blocked (needs keys) | Jun 15 |
| P0-4 | E2E Test Suite | QA-001 | ⏳ Todo | Jun 18 |
| P0-5 | Security fixes (6 critical findings) | CISO | 🔄 In Progress | Jun 14 |

### P1 — Launch Features (Should Ship)
| # | Task | Owner | Status | ETA |
|---|------|-------|--------|-----|
| P1-1 | Sign Up/Sign In polish | FE-002 | 🔄 In Progress | Jun 9 |
| P1-2 | Mobile responsive audit | FE-003 | ⏳ Todo | Jun 11 |
| P1-3 | Loading skeletons | FE-002 | ⏳ Todo | Jun 10 |
| P1-4 | Dark mode verification | FE-003 | ⏳ Todo | Jun 13 |
| P1-5 | Legacy HTML migration (11 pages) | FE-001 | ⏳ Todo | Jun 20 |

### P2 — Polish (Nice to Have)
| # | Task | Owner | Status | ETA |
|---|------|-------|--------|-----|
| P2-1 | Onboarding flow | FE-003 | ⏳ Todo | Jun 18 |
| P2-2 | Email template polish | MKT-001 | ⏳ Todo | Jun 16 |
| P2-3 | Analytics instrumentation | GRW-002 | ⏳ Todo | Jun 17 |
| P2-4 | SEO optimization | MKT-002 | ⏳ Todo | Jun 19 |

---

## Agent Spawn Rules

### When to Spawn
1. **New feature** > 200 lines or complex logic → spawn `frontend-developer` or `backend-architect`
2. **Security finding** → spawn `security-architect` + `application-security-engineer`
3. **Code review** > 500 lines → spawn `code-reviewer`
4. **Testing** new endpoint → spawn `api-tester`
5. **Performance** issue → spawn `database-optimizer` + `performance-benchmarker`
6. **Content** needed → spawn `content-creator` + `seo-specialist`

### Spawn Limits
- **Max 5 agents per day** (cost control)
- **Max 2 parallel agents per task** (coordination overhead)
- **Each agent: 1 task, 1 file, 1 output** (micro-task principle)
- **3-minute timeout per agent** (cost control)

### Graph Memory for Agents
- **Never** send raw files > 500 lines to agents
- **Always** pre-read files, summarize context, send summary + specific snippet
- **Use `codebase-onboarding-engineer`** to create agent briefings
- **Maintain `AGENT_BRIEFING.md`** with current codebase state

---

## Launch Readiness Checklist

| Item | Target | Status |
|------|--------|--------|
| All P0 complete | Jul 15 | 20% |
| Security audit clean | Jul 10 | 40% |
| E2E tests passing | Jul 20 | 0% |
| Stripe live validated | Jul 15 | 0% |
| Mobile responsive | Jul 12 | 30% |
| Performance audit | Jul 18 | 0% |
| Content complete | Jul 20 | 60% |
| SEO optimized | Jul 22 | 20% |
| EU AI Act dashboard | Jul 25 | 50% |

---

## Communication Protocol

### Daily (08:00 UTC)
- Standup summary posted to #standup channel
- Suga (CTO) consolidates all agent reports
- Ranga (CEO) reviews blockers only

### Weekly (Friday 17:00 UTC)
- Sprint review: what shipped, what's blocked
- Executive summary: metrics, risks, decisions needed
- Agent performance: any agents needing support

### Monthly (First Monday)
- Board metrics: MRR, DAU, churn, burn
- Roadmap review: next sprint priorities
- Budget review: spending vs plan

### When to Alert Ranga (CEO)
- P0 incident: production down, security breach
- P1 incident: major feature broken, revenue impact
- Funding: runway < 6 months
- Partnership: needs CEO decision
- Strategic pivot: new market, acquisition

---

## Budget & Cost Control

| Category | Monthly Budget | Current Burn |
|----------|---------------|--------------|
| Agent compute | $2,000 | ~$800/mo |
| Infrastructure (Render + Neon) | $500 | $340/mo |
| AI providers (Polsia + others) | $1,500 | ~$600/mo |
| Stripe | $200 | $0 (test mode) |
| **Total** | **$4,200** | **~$1,740/mo** |

**Runway:** 90 days to Aug 15, 2026
**Daily agent spawn budget:** Max 5 agents/day = ~$27/day

---

*Last updated: 2026-06-06 15:30 UTC*
*Next review: 2026-06-07 08:00 UTC*
