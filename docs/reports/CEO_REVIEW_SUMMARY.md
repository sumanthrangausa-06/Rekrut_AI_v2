# Rekrut AI — CEO Review Summary

> **Date:** August 8, 2026  
> **Mode:** SCOPE EXPANSION  
> **Approach:** Parallel Tracks (bug fixes + code sandbox simultaneously)  
> **Status:** DONE — Review complete, scope locked

---

## Scope Decisions

### ✅ ACCEPTED EXPANSIONS

| Feature | Effort | Phase |
|---------|--------|-------|
| AI Career Coach | +40h | Phase 3 |
| AI Recruiter Screener | +50h | Phase 2 |
| Proctored Assessment | +60h | Phase 3 |
| Real-Time Collaboration | +35h | Phase 4 |
| Advanced Analytics | +45h | Phase 4 |
| OmniScore v2 (Deep Scoring) | +60h | Phase 2 |
| TrustScore v2 (Company Scoring) | +45h | Phase 3 |
| **Total Added** | **+335h** | |

### ❌ DEFERRED

| Feature | Reason | When |
|---------|--------|------|
| White-Label | Not needed for MVP | Phase 6+ |
| Regional Languages | English-first for launch | Phase 6+ |
| Native Mobile Apps | Responsive web is sufficient | Post-launch |

---

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Code Sandbox | **Docker + Judge0** | Full language support (Python, Java, C++, JS) |
| Video Infrastructure | **LiveKit (self-hosted)** | OSS, scalable, no vendor lock-in |
| E-Signature | **In-house PKCS#7 + TSA** | Legal validity without DocuSign |
| Analytics DB | **PostgreSQL + ClickHouse** | Operational + analytics separation |
| Monitoring | **Prometheus + Grafana + Loki** | Self-hosted, full control |

---

## Security Requirements

| Requirement | Status |
|-------------|--------|
| Code sandbox security audit | **Required before launch** |
| BGC data encryption (AES-256) | In scope |
| Access logging | In scope |
| Data retention limits | In scope |
| GDPR/DPDP compliance | In scope |
| Right to deletion | In scope |

---

## Quality Gates

| Metric | Target |
|--------|--------|
| E2E Test Coverage | **95%** |
| Error Rate | < 1% |
| API p95 Latency | < 500ms |
| Uptime | 99.9% |

---

## Revised Phase Plan

### Phase 0: Critical Bug Fixes (1 week)
- Fix 14-page render loops
- Fix apply-from-drawer bug
- Swap Stripe test keys
- Connect email provider
- Remove mock data

### Phase 1: MVP Launch (2 weeks)
- Company email domain validation
- Recruiter approval workflow
- Basic email notifications
- Stripe live mode

### Phase 2: Structured Screening (4 weeks) ⬆️
- Screening questions + API completion
- Aptitude test templates (timed)
- **AI Recruiter Screener** (NEW)
- **OmniScore v2** (NEW)
- Chat/messaging completion

### Phase 3: Technical Assessment (5 weeks) ⬆️
- **Docker + Judge0 code sandbox** (full languages)
- Auto-grading (AI + test cases)
- **Proctored assessment system** (NEW)
- **AI Career Coach** (NEW)
- **TrustScore v2** (NEW)

### Phase 4: Interview Excellence (5 weeks) ⬆️
- **LiveKit video infrastructure**
- Multi-interviewer panel
- Recording + playback
- AI transcript
- Calendar integration (Google/Outlook OAuth)
- **Real-Time Collaboration** (NEW)
- **Advanced Analytics Dashboard** (NEW)

### Phase 5: Secure Hiring (5 weeks)
- Built-in e-signature (PKCS#7)
- Self-hosted BGC system
- Document OCR + fraud detection
- Aadhaar verification
- Full audit trail

### Phase 6: Enterprise Complete (6 weeks)
- Role-based permissions
- Team hierarchy
- API access
- Bulk import
- Compliance reports

---

## Total Effort

| Category | Original | Expanded | Delta |
|----------|----------|----------|-------|
| Bug Fixes (P0) | 40h | 40h | — |
| MVP (P1) | 80h | 80h | — |
| Screening (P2) | 120h | 230h | +110h |
| Technical (P3) | 160h | 280h | +120h |
| Interviews (P4) | 160h | 240h | +80h |
| BGC/E-Sign (P5) | 200h | 200h | — |
| Enterprise (P6) | 240h | 265h | +25h |
| **TOTAL** | **1000h** | **1335h** | **+335h** |

---

## Timeline Impact

| | Original | Expanded |
|--|----------|----------|
| Total Duration | 25 weeks | ~33 weeks |
| MVP Launch | Week 3 | Week 3 (unchanged) |
| Code Sandbox | Week 9 | Week 12 |
| Full Platform | Week 25 | Week 33 |

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Code sandbox security vuln | Medium | High | Security audit before launch |
| Docker infra complexity | Medium | Medium | Start with Judge0 defaults |
| LiveKit scaling | Low | Medium | Load test before launch |
| ClickHouse ops overhead | Medium | Low | Simple config, scale later |
| 335h scope creep | High | Medium | Parallel tracks, 2 teams |

---

## NOT in Scope (Explicitly Excluded)

- White-label / multi-tenant
- Regional language support (Hindi, Tamil, etc.)
- Native mobile apps (iOS/Android)
- Third-party API integrations (Checkr, DocuSign, HackerRank)
- ATS integrations (Greenhouse, Lever, Workday)
- Job board integrations (LinkedIn, Indeed)
- Payroll partner integrations (Deel, Gusto)

---

## Recommended Path

1. **Ship Phase 0 (bugs) immediately** — 1 week
2. **Ship Phase 1 (MVP) fast** — get real users
3. **Start Phase 2 + Phase 3 in parallel** (2 teams)
   - Team A: Screening + OmniScore v2 + AI Screener
   - Team B: Code Sandbox + Proctored + AI Career Coach
4. **Security audit at end of Phase 3** — before public code sandbox
5. **Ship Phase 4-6 sequentially** — interviews → BGC → enterprise

---

## Strongest Challenges (Top 3)

1. **Code sandbox security is non-trivial** — Running untrusted user code requires careful isolation. Judge0 helps, but still needs audit.

2. **ClickHouse adds ops complexity** — Separate analytics DB is powerful but adds infrastructure. Have a rollback plan to Postgres-only.

3. **+335h scope is real** — The expansions are valuable but add 33% more work. Parallel tracks mitigate but require coordination.

---

## Final Sign-Off

**Mode:** SCOPE EXPANSION  
**Approach:** Parallel Tracks  
**Scope:** Locked as documented above  
**Status:** DONE

The plan is ambitious but achievable. The expansions (AI Career Coach, AI Recruiter Screener, OmniScore v2, TrustScore v2, Proctored Assessment) transform Rekrut AI from "another ATS" into "the Crossover-style platform with transparency."

**Ship the bugs. Ship the MVP. Build the moat.**

---

*Generated by gstack CEO Review*  
*August 8, 2026*
