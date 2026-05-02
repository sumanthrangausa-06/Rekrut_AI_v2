# Rekrut AI — Sprint Plan

**Sprint Start:** May 5, 2026 (Week 1)
**Sprint Duration:** 1 Week
**Product Manager:** Zo (AI PM)
**Last Updated:** May 2, 2026

---

## Executive Summary

Based on GAP_ANALYSIS.md, MODULE_AUDIT.md, and COMPETITIVE_ANALYSIS.md, this sprint focuses on **monetization blockers** and **competitive moat deepening**. The platform has 13/15 modules built, but lacks table-stakes features (email, pricing) that block revenue.

---

## Prioritized Task List (Top 5)

### 🔴 Priority 1: Pricing Page + Stripe Checkout
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Business Impact | ⭐⭐⭐⭐⭐ | **Blocks all revenue.** Can't monetize without it. |
| User Value | ⭐⭐⭐⭐ | Conversion flow for paying customers |
| Competitive Advantage | ⭐⭐⭐ | Every SaaS competitor has this |
| Effort | ⭐⭐⭐⭐⭐ | 1-2 days (Stripe integration exists in skills) |

**Deliverables:**
- [ ] Pricing page with 3 tiers (Starter, Pro, Enterprise)
- [ ] Stripe Checkout integration
- [ ] Webhook handling for subscription events
- [ ] Subscription state in user model

**Dependencies:** Stripe account configured (see `GET_API_KEYS.md`)

---

### 🔴 Priority 2: Email Notifications System
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Business Impact | ⭐⭐⭐⭐⭐ | Table stakes. Users expect notifications. |
| User Value | ⭐⭐⭐⭐⭐ | Engagement, retention, trust |
| Competitive Advantage | ⭐⭐⭐ | Every competitor has this |
| Effort | ⭐⭐⭐⭐ | 2-3 days |

**Deliverables:**
- [ ] Transactional email service (SendGrid/Postmark/Resend)
- [ ] Email templates for key events:
  - Application received
  - Interview scheduled
  - Offer sent
  - Onboarding milestones
- [ ] Email preferences in user settings
- [ ] Email queue for bulk notifications

**Dependencies:** Email provider API key

---

### 🟡 Priority 3: EU AI Act Compliance Dashboard
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Business Impact | ⭐⭐⭐⭐ | Enterprise sales enabler. Aug 2026 deadline. |
| User Value | ⭐⭐⭐ | Transparency, trust |
| Competitive Advantage | ⭐⭐⭐⭐⭐ | First-mover. Most competitors scrambling. |
| Effort | ⭐⭐⭐ | 3-5 days (biasDetection.js foundation exists) |

**Deliverables:**
- [ ] Risk classification system (high/medium/low risk AI use cases)
- [ ] Audit trail for all AI decisions
- [ ] Transparency report generation
- [ ] Candidate-facing AI decision explanations
- [ ] Admin compliance dashboard

**Dependencies:** Legal review of EU AI Act requirements

---

### 🟡 Priority 4: Calendar Integration (Google + Outlook)
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Business Impact | ⭐⭐⭐ | Interview scheduling core feature |
| User Value | ⭐⭐⭐⭐⭐ | Eliminates manual scheduling pain |
| Competitive Advantage | ⭐⭐⭐ | Expected feature, not differentiator |
| Effort | ⭐⭐⭐ | 3-5 days |

**Deliverables:**
- [ ] Google Calendar OAuth integration
- [ ] Microsoft Outlook OAuth integration
- [ ] Calendar availability fetching
- [ ] Auto-schedule based on mutual availability
- [ ] Calendar event creation with video links

**Dependencies:** Google Cloud Console project, Microsoft Azure app registration

---

### 🟡 Priority 5: OmniScore Explainability Enhancement
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Business Impact | ⭐⭐⭐⭐ | #1 differentiator with zero competitors |
| User Value | ⭐⭐⭐⭐⭐ | Trust in scoring system |
| Competitive Advantage | ⭐⭐⭐⭐⭐ | Unique in market |
| Effort | ⭐⭐⭐⭐ | 2-3 days (`scoreExplainer.js` exists) |

**Deliverables:**
- [ ] "Why this score?" breakdown for every component
- [ ] Historical trend visualization
- [ ] Peer comparison (anonymized)
- [ ] Actionable recommendations to improve
- [ ] Company-side TrustScore explanations

**Dependencies:** None (foundation exists)

---

## Weekly Sprint Plan

### Week 1: May 5-9, 2026

| Day | Focus | Tasks |
|-----|-------|-------|
| **Mon** | Monetization | Pricing page UI + Stripe integration |
| **Tue** | Monetization | Stripe webhooks + subscription state |
| **Wed** | Engagement | Email service setup + core templates |
| **Thu** | Engagement | Email queue + preferences UI |
| **Fri** | Compliance | EU AI Act audit trail foundation |

**Sprint Goal:** Enable revenue collection + basic user notifications

---

### Week 2: May 12-16, 2026

| Day | Focus | Tasks |
|-----|-------|-------|
| **Mon** | Compliance | EU AI Act dashboard + transparency reports |
| **Tue** | Compliance | AI decision explanations UI |
| **Wed** | Integration | Google Calendar OAuth + availability |
| **Thu** | Integration | Outlook integration + auto-scheduling |
| **Fri** | Differentiation | OmniScore explainability UI |

**Sprint Goal:** Enterprise-ready compliance + scheduling automation

---

## Blockers & Dependencies

### 🔴 Critical Blockers
| Blocker | Impact | Resolution | Owner |
|---------|--------|------------|-------|
| Stripe account not configured | Blocks Priority 1 | Complete Stripe onboarding | Biz Ops |
| Email provider not selected | Blocks Priority 2 | Choose SendGrid/Postmark/Resend | Tech Lead |

### 🟡 Dependencies
| Dependency | For Task | Status | Action Needed |
|------------|----------|--------|---------------|
| Google Cloud Console | Calendar | ❌ Not set up | Create OAuth credentials |
| Microsoft Azure App | Calendar | ❌ Not set up | Register app in Azure AD |
| Legal review | EU AI Act | ⚠️ Needed | Schedule with legal counsel |
| React migration | All UI | 🔄 In progress | Continue FRONTEND_MIGRATION.md |

---

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|--------------|
| Paying customers | 0 | 5+ | Stripe dashboard |
| Email open rate | N/A | 30%+ | Email provider analytics |
| Compliance audit log entries | 0 | 100% of AI decisions | Database query |
| Calendar integrations | 0 | 10+ users | OAuth connections |
| OmniScore explanation views | N/A | 50%+ of score views | Analytics event |

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Stripe onboarding delays | Medium | High | Start process immediately |
| EU AI Act requirements unclear | Medium | Medium | Legal review early Week 1 |
| Calendar OAuth complexity | Low | Medium | Use established libraries |
| Frontend migration conflicts | Medium | Medium | Test in React first |
| Email deliverability issues | Low | High | Use reputable provider with warming |

---

## Notes & Decisions

### Decisions Made
1. **Pricing before email** — Revenue is existential; notifications improve UX but don't block sales
2. **EU AI Act over ATS integrations** — Compliance deadline is fixed; integrations can be sold later
3. **Calendar over real-time collab** — Scheduling pain is acute; Slack integration is lower effort alternative

### Deferred to Future Sprints
- ATS/HRIS integrations (Greenhouse, Lever, Workday)
- Real-time collaboration (consider Slack integration instead)
- Payroll API partnerships (Deel, Remote)
- AI resume parsing
- Candidate CRM
- White-label / API access

---

## Next Sprint Preview

**Week 3-4 Focus:** Enterprise Readiness
- Custom workflow builder
- Interviewer evaluation (both sides coaching)
- React migration completion
- Mobile responsiveness audit
- ATS integration #1 (Greenhouse)

---

*This document will be updated at the end of each sprint with actual progress and retrospective notes.*
