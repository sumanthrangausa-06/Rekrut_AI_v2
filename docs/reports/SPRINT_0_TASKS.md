# Sprint 0: Foundation — June 5-19, 2026

**Sprint Goal:** Fix the foundation. Nothing ships on a broken foundation. Zero critical security issues, email notifications working, EU AI Act compliance dashboard started.

**Sprint Duration:** June 5 - June 19, 2026 (2 weeks)  
**Sprint Review:** Friday, June 19, 2026 at 14:00 UTC  
**Sprint Retro:** Friday, June 19, 2026 at 16:00 UTC  

---

## Sprint Backlog

### P0 — Critical (Security)

| # | Task | Owner | Status | ETA | Blockers |
|---|------|-------|--------|-----|----------|
| 1 | Fix CORS: only allow `hireloop-vzvw.polsia.app` and `rekrutai-dev.onrender.com` | BE-001 | 🔵 In Progress | Jun 6 | None |
| 2 | Add `secure: true` to session cookies (with `trust proxy` fix) | BE-001 | 🔵 In Progress | Jun 6 | None |
| 3 | Implement CSRF protection for all state-changing endpoints | SEC-001 | 🟡 Queued | Jun 8 | Needs BE-001 CORS fix first |
| 4 | Fix document IDOR: recruiters only access their own applicants' docs | SEC-002 | 🟡 Queued | Jun 9 | None |
| 5 | Add CSP headers + Helmet middleware | SEC-001 | 🟡 Queued | Jun 9 | None |
| 6 | Sanitize error messages in production (no stack traces, no file paths) | SEC-003 | 🟡 Queued | Jun 10 | None |
| 7 | Enable HSTS (HTTP Strict Transport Security) | SEC-001 | 🟡 Queued | Jun 10 | None |
| 8 | Security scan with OWASP ZAP — zero critical findings | QA-003 | 🟡 Queued | Jun 12 | Needs all fixes above |
| 9 | Penetration testing (internal) | QA-003 | 🟡 Queued | Jun 14 | Needs all fixes above |

### P1 — High (Email Notifications)

| # | Task | Owner | Status | ETA | Blockers |
|---|------|-------|--------|-----|----------|
| 10 | Build email service queue (BullMQ + Redis or PostgreSQL-backed) | BE-002 | 🔵 In Progress | Jun 7 | None |
| 11 | Transactional email templates: 15 templates | BE-003 | 🟡 Queued | Jun 10 | Needs BE-002 queue |
| 12 | SMTP provider setup (SendGrid/Postmark/Amazon SES) | BE-002 | 🟡 Queued | Jun 8 | Needs provider selection |
| 13 | SPF, DKIM, DMARC records setup | DEVOPS-001 | 🟡 Queued | Jun 9 | Needs domain access |
| 14 | Bounce handling, unsubscribe management | BE-003 | 🟡 Queued | Jun 11 | None |
| 15 | Email analytics: open rates, click rates, bounce rates | BE-003 | 🟡 Queued | Jun 12 | None |
| 16 | Integration: trigger emails from all key events | FE-001 | 🟡 Queued | Jun 13 | Needs templates |
| 17 | Email notification UI (settings, preferences) | FE-001 | 🟡 Queued | Jun 14 | None |

### P1 — High (EU AI Act Compliance Dashboard)

| # | Task | Owner | Status | ETA | Blockers |
|---|------|-------|--------|-----|----------|
| 18 | Bias audit dashboard (per-job, per-company, per-demographic) | LEG-001 | 🟡 Queued | Jun 10 | Needs PM-001 spec |
| 19 | Consent management UI | LEG-002 | 🟡 Queued | Jun 11 | Needs PM-001 spec |
| 20 | Data lineage tracking (model, prompt version, provider) | AI-001 | 🟡 Queued | Jun 12 | None |
| 21 | Explainability panel for AI decisions | AI-001 | 🟡 Queued | Jun 13 | Needs AI-001 data lineage |
| 22 | Human-in-the-loop review workflow | PM-001 | 🟡 Queued | Jun 14 | None |
| 23 | EU AI Act technical documentation | LEG-001 | 🟡 Queued | Jun 15 | None |
| 24 | Compliance dashboard frontend | FE-002 | 🟡 Queued | Jun 16 | Needs backend APIs |

### P2 — Medium (Recruiter AI Screener)

| # | Task | Owner | Status | ETA | Blockers |
|---|------|-------|--------|-----|----------|
| 25 | Structured candidate evaluation against job requirements | AI-003 | 🟡 Queued | Jun 12 | None |
| 26 | Custom screening criteria per job (weighted) | AI-003 | 🟡 Queued | Jun 13 | None |
| 27 | Screening summary reports (PDF export) | AI-003 | 🟡 Queued | Jun 14 | None |
| 28 | Batch processing (50+ applicants at once) | BE-004 | 🟡 Queued | Jun 15 | Needs AI-003 |
| 29 | Recruiter screener UI | FE-003 | 🟡 Queued | Jun 16 | Needs backend APIs |

### P2 — Medium (Analytics & Insights)

| # | Task | Owner | Status | ETA | Blockers |
|---|------|-------|--------|-----|----------|
| 30 | Recruiter funnel analytics (post → hire) | BE-005 | 🟡 Queued | Jun 14 | None |
| 31 | Time-to-hire tracking | BE-005 | 🟡 Queued | Jun 15 | None |
| 32 | Candidate quality by source | DB-001 | 🟡 Queued | Jun 15 | None |
| 33 | Revenue dashboard | BE-005 | 🟡 Queued | Jun 16 | None |
| 34 | Analytics dashboard frontend | FE-004 | 🟡 Queued | Jun 17 | Needs backend APIs |
| 35 | Analytics reporting tables | DB-001 | 🟡 Queued | Jun 14 | None |

### Infrastructure (Running in Parallel)

| # | Task | Owner | Status | ETA | Blockers |
|---|------|-------|--------|-----|----------|
| 36 | Staging environment setup | DEVOPS-001 | 🔵 In Progress | Jun 7 | None |
| 37 | Automated backup verification | DEVOPS-004 | 🟡 Queued | Jun 8 | None |
| 38 | Monitoring: Datadog + Sentry + PagerDuty | DEVOPS-003 | 🟡 Queued | Jun 10 | Needs accounts |
| 39 | Alerting setup (P0 → CTO+CEO, P1 → Team Lead) | DEVOPS-003 | 🟡 Queued | Jun 11 | None |
| 40 | E2E test suite (Playwright or Cypress) | QA-001 | 🟡 Queued | Jun 12 | None |
| 41 | API test suite (Postman + Newman) | QA-002 | 🟡 Queued | Jun 13 | None |
| 42 | Load testing (k6 or Artillery) | QA-004 | 🟡 Queued | Jun 14 | None |
| 43 | CI/CD pipeline: tests on every PR | DEVOPS-001 | 🟡 Queued | Jun 15 | None |
| 44 | Log aggregation: structured JSON logging | DEVOPS-003 | 🟡 Queued | Jun 16 | None |

---

## Sprint Metrics

### Burndown
- **Total story points:** 132
- **Completed:** 8
- **Remaining:** 124
- **Days left:** 14
- **Velocity needed:** 8.9 points/day
- **Current velocity:** 4 points/day
- **At risk:** Yes (velocity needs to double)

### Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| Security fixes take longer than expected | High | Parallel work, SEC team has 6 agents, can swarm |
| Email provider selection delays | Medium | Evaluate 3 providers in parallel, pick by Jun 8 |
| EU AI Act spec not ready | Medium | PM-001 owns spec, due Jun 7, can start with backend data |
| Staging setup blocked | Medium | DEVOPS-001 working on it, should be ready by Jun 7 |
| Agent velocity too low | High | Add more agents to security swarm, cut scope if needed |

---

## Agent Status

### Active (In Progress)
| Agent | Task | Status | Blockers |
|-------|------|--------|----------|
| BE-001 | Security hardening (CORS, cookies) | 🔵 In Progress | None |
| BE-002 | Email service queue | 🔵 In Progress | None |
| SEC-001 | CSP/Helmet planning | 🔵 In Progress | None |
| DEVOPS-001 | Staging environment | 🔵 In Progress | None |
| QA-001 | E2E test suite planning | 🔵 In Progress | None |
| PM-001 | EU AI Act spec | 🔵 In Progress | None |
| QA-003 | Security scan planning | 🔵 In Progress | None |
| FE-001 | Email notification UI planning | 🔵 In Progress | None |

### Blocked
| Agent | Task | Blocked By | Resolution |
|-------|------|------------|------------|
| SEC-002 | Document IDOR fix | Waiting for BE-001 CORS fix | BE-001 ETA Jun 6 |
| SEC-003 | Error sanitization | Waiting for security framework | SEC-001 ETA Jun 9 |
| BE-003 | Email templates | Waiting for BE-002 queue | BE-002 ETA Jun 7 |
| FE-002 | Compliance dashboard | Waiting for PM-001 spec | PM-001 ETA Jun 7 |
| AI-003 | Screener evaluation | Waiting for PM-002 spec | PM-002 ETA Jun 8 |
| FE-003 | Recruiter screener UI | Waiting for AI-003 backend | AI-003 ETA Jun 12 |
| FE-004 | Analytics dashboard | Waiting for BE-005 APIs | BE-005 ETA Jun 14 |
| QA-003 | Security scan | Waiting for all security fixes | All fixes ETA Jun 12 |

### Idle (Available for Assignment)
| Agent | Specialty | Can Help With |
|-------|-----------|---------------|
| BE-006 | Billing | Revenue dashboard, Stripe improvements |
| BE-007 | Matching | Job matching improvements |
| BE-008 | Interview | Interview pipeline optimization |
| BE-009 | Onboarding | Onboarding document improvements |
| BE-010 | Payroll | Tax calculation fixes |
| BE-011 | API Design | API documentation, standardization |
| BE-012 | Performance | Query optimization, caching |
| FE-005 | Forms | Form validation library (Zod) |
| FE-006 | Performance | Code splitting, lazy loading |
| FE-007 | Accessibility | A11y audit, WCAG compliance |
| FE-008 | Mobile | Responsive design improvements |
| AI-004 | Matching | Matching algorithm improvements |
| AI-005 | Interview | Interview analysis improvements |
| AI-006 | Speech | TTS/ASR pipeline |
| AI-007 | Resume | Resume parsing improvements |
| AI-008 | Communication | Message generation improvements |
| AI-009 | OmniScore | Score calculation improvements |
| AI-010 | Provider | Provider health optimization |
| AI-011 | Fine-tuning | Model training |
| AI-012 | Vision | Video analysis improvements |
| AI-013 | NLP | JD optimization, bias detection |
| AI-014 | Document | OCR, fraud detection |
| AI-015 | Testing | AI evaluation suite |
| AI-016 | Cost | Token budget optimization |
| AI-017 | Prompt | A/B testing, prompt versioning |
| AI-018 | Research | New model evaluation |
| QA-002 | API Testing | API test automation |
| QA-004 | Performance | Load testing |
| QA-005 | AI Testing | AI output validation |
| QA-006 | Accessibility | A11y testing |
| QA-007 | Mobile | Mobile testing |
| QA-008 | Regression | Regression suite |
| DB-002 | Performance | Indexing, query optimization |
| DB-003 | Data | ETL, data migration |
| DB-004 | Analytics | Analytics views, reporting |
| PM-002 | Analytics | Analytics feature spec |
| PM-003 | Growth | User onboarding, activation flow |
| PM-004 | Enterprise | Enterprise features, admin controls |
| UX-001 | Design Systems | Component library improvements |
| UX-002 | Recruiter UX | Recruiter workflow optimization |
| UX-003 | Candidate UX | Candidate journey improvements |
| UX-004 | Dashboard | Dashboard design |
| UX-005 | Mobile | Mobile UX |
| UX-006 | Accessibility | A11y design |
| MKT-001 | Content | Blog posts, technical articles |
| MKT-002 | SEO | Keyword research, technical SEO |
| MKT-003 | Social | Social media content |
| MKT-004 | PR | Press releases, media outreach |
| MKT-005 | Video | Demo videos, tutorials |
| MKT-006 | Email | Newsletter, drip campaigns |
| MKT-007 | Community | Community building |
| MKT-008 | Events | Webinars, conferences |
| MKT-009 | Case Studies | Customer success stories |
| MKT-010 | Brand | Brand guidelines, voice, tone |
| SAL-001 | Enterprise | Enterprise sales outreach |
| SAL-002 | SMB | SMB sales |
| SAL-003 | Partnerships | Partnership outreach |
| SAL-004 | Demos | Demo preparation |
| SAL-005 | Pipeline | CRM management |
| SAL-006 | Proposals | Proposal writing |
| SAL-007 | Customer Success | Onboarding, retention |
| SAL-008 | SDR | Lead generation |
| CS-001 | Onboarding | New customer onboarding |
| CS-002 | Support | Ticket handling |
| CS-003 | Training | Training materials |
| CS-004 | Feedback | NPS surveys, feedback |
| CS-005 | Retention | Churn prevention |
| CS-006 | Expansion | Upsell, cross-sell |
| LEG-003 | SOC2 | SOC2 audit preparation |
| LEG-004 | Contracts | Terms of service, privacy policy |
| FIN-001 | Billing | Stripe integration, invoicing |
| FIN-002 | Pricing | Pricing strategy |
| FIN-003 | Revenue | Revenue recognition, forecasting |
| AI-RND-001 | Core Models | Foundation model evaluation |
| AI-RND-002 | Fine-tuning | Recruitment-specific fine-tuning |
| AI-RND-003 | RLHF | Reinforcement learning from human feedback |
| AI-RND-004 | Prompt Optimization | Automated prompt tuning (DSPy) |
| AI-RND-005 | Benchmarking | Evaluation suites, leaderboards |
| AI-RND-006 | Efficiency | Model distillation, quantization |
| AI-RND-007 | Multimodal | Vision + audio + text integration |
| AI-RND-008 | Reasoning | Chain-of-thought, structured reasoning |
| AI-RND-009 | Safety | AI safety, red-teaming, guardrails |
| AI-RND-010 | Papers | Research paper review, publication |
| SCORE-001 | Algorithm | Score calculation improvements |
| SCORE-002 | Fairness | Demographic parity, equalized odds |
| SCORE-003 | Explainability | Score explanation generation |
| SCORE-004 | Appeals | Appeals process, review workflow |
| SCORE-005 | Time Decay | Temporal scoring, recency weighting |
| SCORE-006 | Role Scores | Role-specific scoring models |
| VISION-001 | Body Language | Gesture, posture, engagement analysis |
| VISION-002 | Eye Contact | Gaze tracking, attention metrics |
| VISION-003 | Emotion | Facial expression, emotional state |
| VISION-004 | Environment | Background check, lighting, noise |
| SPEECH-001 | TTS | Text-to-speech quality, voice cloning |
| SPEECH-002 | ASR | Speech recognition, transcription |
| SPEECH-003 | Analysis | Pace, filler words, clarity, sentiment |
| BD-001 | ATS | Greenhouse, Lever, Workday integrations |
| BD-002 | HRIS | BambooHR, Gusto, Workday partnerships |
| BD-003 | API | Public API, developer portal, webhooks |
| BD-004 | Channel | Reseller partnerships, affiliate programs |
| UR-001 | Interviews | User interviews, persona development |
| UR-002 | Analytics | User behavior, funnel analysis |
| UR-003 | Testing | Usability testing, A/B testing |
| DEVOPS-002 | Infrastructure | Terraform, Render, Cloudflare |
| DEVOPS-003 | Monitoring | Datadog, Sentry, log aggregation |
| DEVOPS-004 | Database | Neon management, backups, replication |
| DEVOPS-005 | Security | Container security, image scanning |
| DEVOPS-006 | Cost | Resource optimization, billing alerts |
| SUPPORT-001 through SUPPORT-081 | General | Documentation, operations, analytics, general support |

---

## Completed This Sprint

| Date | Task | Owner | Impact |
|------|------|-------|--------|
| Jun 5 | Fixed JWT secret fallback | BE-001 | Removed auth bypass vulnerability |
| Jun 5 | Fixed session secret fallback | BE-001 | Removed session hijacking risk |
| Jun 5 | Deployed distributed rate limiter | BE-001 | Replaced in-memory with PostgreSQL-backed |
| Jun 5 | Fixed IMMUTABLE constraint in rate limiter | BE-001 | Rate limiter now works on dev |
| Jun 5 | Created company org structure | CTO | 210-agent company structure defined |
| Jun 5 | Created 90-day launch plan | CTO | Launch plan through Aug 15, 2026 |
| Jun 5 | Created daily operations protocol | CTO | 24/7 workflow defined |

---

## Sprint Review Agenda (Jun 19, 14:00 UTC)
1. **Security demo** (15 min): Show all 6 critical fixes, OWASP scan results
2. **Email notifications demo** (15 min): Show email templates, queue, triggered emails
3. **EU AI Act dashboard demo** (15 min): Show bias audit, consent management, explainability
4. **Analytics demo** (10 min): Show funnel analytics, time-to-hire, revenue dashboard
5. **Infrastructure demo** (10 min): Show staging, CI/CD, monitoring, E2E tests
6. **Metrics review** (15 min): Sprint metrics, velocity, what went well, what didn't
7. **CEO feedback** (15 min): CEO review, priorities for next sprint
8. **Next sprint planning** (15 min): Rough priorities for Sprint 1 (Jun 19 - Jul 3)

---

## Document Owner: Suga (CTO)  
## Last Updated: 2026-06-05  
## Next Update: Daily (standup), Weekly (sprint review)
