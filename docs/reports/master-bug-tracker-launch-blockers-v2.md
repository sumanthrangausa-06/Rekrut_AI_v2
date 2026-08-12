# Rekrut AI — Master Bug Tracker & Launch Blockers

> **Date:** June 5, 2026  
> **Owner:** Kimi (Coordinator) + Ranga (CEO) + Suga (CTO) + CMO (Marketing)  
> **Status:** Live — updated as work progresses  

---

## Quick Stats

| Metric | Count |
|--------|-------|
| Total Issues Tracked | 30 |
| P0 — Launch Blockers | 17 |
| P1 — Critical | 11 |
| P2 — Important | 2 |
| In Progress | 1 (Candidate Search) |
| Blocked on Ranga | 5 |
| Ready to Start | 24 |

---

## P0 — Launch Blockers (Must Fix Before Launch)

| ID | Module | Side | Status | Owner | Description | Effort | Blocked By |
|----|--------|------|--------|-------|-------------|--------|------------|
| B-001 | Candidate Search | Recruiter | **In Progress** | Suga | Placeholder page — recruiters cannot find candidates. Need full React build with search, filters, job cards, apply flow. | 2-3 days | None |
| B-002 | Recruiter Analytics | Recruiter | Placeholder | Suga | Placeholder dashboard — recruiters cannot see performance data. Needs real charts and metrics. | 4-5 days | Ranga: defer to post-launch |
| B-003 | Stripe Live Mode | Both | Test Mode Only | Suga | Billing only works in test mode. Need live Stripe keys, webhook validation, subscription sync. | 2 days | Ranga: Stripe live account credentials |
| B-008 | Sign Up Page | Candidate | Needs Polish | Suga | React page exists but needs to match visily-sign-up-5.jpg design. Role selector, social OAuth, mobile responsive. | 2-3 days | CMO: landing page copy |
| B-009 | Sign In Page | Both | Needs Polish | Suga | React page exists but needs to match visily-sign-in-6.jpg design. Mobile responsive, error states. | 2-3 days | None |
| B-010 | Onboarding Wizard | Candidate | Needs Polish | Suga | Multi-step wizard exists but needs polish per visily-onboarding-(modify).jpg. Drives profile completion. | 3-4 days | None |
| B-011 | Job Search Page | Candidate | Needs Polish | Suga | Exists but needs polish per visily-candidate-listing.jpg. pgvector semantic search, filters, mobile. | 3-4 days | CMO: job taxonomy and seed data |
| B-012 | AI Interview Page | Candidate | Needs Polish | Suga | Most complex page — video + chat + results. Needs polish per visily-ai-interview.jpg. Camera/mic, TTS, real-time feedback. | 5-7 days | Ranga: video storage budget (R2) |
| B-013 | Profile Edit Page | Candidate | Needs Polish | Suga | Multi-section form needs polish per visily-create-profile.jpg. General, About, Experience, Skills, Education. | 3-4 days | None |
| B-014 | Profile View Page | Candidate | Needs Polish | Suga | What recruiters see. Needs polish per visily-candidate's-profile.jpg. Must look credible. | 3-4 days | None |
| B-015 | Match Score Display | Candidate | Needs Polish | Suga | The "AI magic" moment. Needs polish per visily-profile-matching.jpg. Skill gaps highlighted, CTAs. | 2-3 days | None |
| B-016 | Recruiter Dashboard | Recruiter | Needs Polish | Suga | Daily view for recruiters. Needs polish per visily-dashboard-charts-2.jpg. Must impress. | 4-5 days | None |
| B-017 | Create Job Page | Recruiter | Needs Polish | Suga | Core recruiter action. Needs polish per visily-create-listing-job.jpg. Must be effortless. | 3-4 days | None |
| B-024 | Landing Page Copy | Both | Not Started | CMO | Hero, value prop, CTA copy. Need KYC vendor decision for trust messaging. | 2-3 days | Ranga: KYC vendor decision |
| B-025 | Seed Job Data | Both | Not Started | CMO | Need 50 real job postings, not dummy data. Job search looks empty without it. | 1-2 days | None |
| B-029 | KYC Vendor | Both | Decision Needed | Ranga | Onfido, SumSub, or Jumio? Affects trust messaging and compliance. | 1 day | Ranga |
| B-030 | Launch Strategy | Both | Decision Needed | Ranga | Silent organic vs big bang press/Product Hunt? Affects all campaign planning. | 1 day | Ranga |

---

## P1 — Critical (Fix Before Launch, But Not Blockers)

| ID | Module | Side | Status | Owner | Description | Effort | Blocked By |
|----|--------|------|--------|-------|-------------|--------|------------|
| B-004 | Legacy HTML Pages | Both | 11 pages in public/ | Suga | 11 legacy HTML pages still in public/ causing UX inconsistency. Need migration to React or removal. | 1-2 days | None |
| B-005 | E2E Tests | Both | Zero Coverage | Suga | No automated end-to-end tests. Manual QA is only safety net. Need Cypress/Playwright suite. | 1 week | None |
| B-006 | CI/CD Pipeline | Both | Manual Deploys | Suga | Still deploying manually to Render. Need GitHub Actions or Render pipeline for automated builds. | 3 days | None |
| B-007 | Production Monitoring | Both | Missing | Suga | No Sentry/Datadog for production alerts. Admin dashboard exists but no proactive monitoring. | 2 days | None |
| B-018 | Chat Architecture | Both | Polling | Suga | Currently polling. Need decision: keep polling or upgrade to WebSocket for real-time. | 2 days + 3 days | Ranga: polling vs WebSocket |
| B-019 | GDPR Compliance | Both | Partial | Suga | Legal risk in EU. Need cookie consent, data deletion, privacy policy updates. | 3 days | None |
| B-020 | Aadhar Compliance | Candidate | Not Reviewed | Suga | Legal risk in India. Need compliance review for Aadhar verification workflow. | External | External legal review |
| B-022 | Offer Workflow | Both | Needs UI Polish | Suga | Backend exists but UI needs work. Offer accept/decline/negotiate flow. | 2-3 days | None |
| B-026 | Analytics Integration | Both | Not Started | CMO | Mixpanel/Amplitude + UTM tracking. Need events instrumented on all pages. | 3-4 days | Suga: landing page live |
| B-027 | Content Calendar | Both | Drafted | CMO | 8 blog posts, 4 videos, 2K subscribers in Month 1. Ready to execute. | Ongoing | None |
| B-028 | Partner Outreach | Both | 20 communities identified | CMO | Bootcamps, universities, creators. 20 communities identified. Ready to contact. | Ongoing | None |

---

## P2 — Important (Post-Launch)

| ID | Module | Side | Status | Owner | Description | Effort | Blocked By |
|----|--------|------|--------|-------|-------------|--------|------------|
| B-021 | Job Alerts | Candidate | Not Built | Suga | Candidates won't check daily. Passive matching keeps them engaged. Post-launch feature. | 3 days | Post-launch |
| B-023 | Dark Mode | Both | Not Built | Suga | Modern expectation. Need brand palette decision from CMO/Ranga. | 4 days | CMO: brand palette |

---

## Decisions Needed from Ranga

| # | Decision | Impact | Deadline | Notes |
|---|----------|--------|----------|-------|
| 1 | **KYC Vendor** | Trust messaging, compliance | Week 1 | Onfido ($$$), SumSub ($$), Jumio ($$) — or build in-house? |
| 2 | **Launch Strategy** | All campaign planning | Week 2 | Silent organic = content flywheel. Big bang = press blast, Product Hunt. |
| 3 | **Stripe Live Keys** | Revenue collection | Week 1 | Do you have the Stripe account and business docs ready? |
| 4 | **Video Storage Budget** | AI Interview feature cost | Week 2 | R2 costs scale with usage. Need budget call. |
| 5 | **Chat Architecture** | Real-time experience | Week 2 | Polling (simple, works now) vs WebSocket (premium, more complex). |
| 6 | **Recruiter Analytics** | Defer or build now? | Week 1 | Defer = focus on candidate side. Build = adds 4-5 days to Month 1. |
| 7 | **Render Plan Upgrade** | Infra cost | Week 11 | If load tests show need > Starter tier, need budget approval. |
| 8 | **Dark Mode Brand** | Visual consistency | Week 2 | CMO needs brand palette for all visual assets. |

---

## Next 7 Days — Action Plan

### Suga (Technical)
- **Day 1-2:** Build Candidate Search page (P0, B-001) — in progress
- **Day 3-4:** Polish Sign Up page (P0, B-008) — waiting on CMO copy
- **Day 5-6:** Migrate 4 most critical legacy HTML pages (P1, B-004) — login, register, job-board, job-detail
- **Day 7:** Stripe live mode validation (P0, B-003) — waiting on Ranga keys

### CMO (Marketing)
- **Day 1-2:** Draft landing page copy (P0, B-024) — waiting on KYC vendor decision
- **Day 3-4:** Create 50 seed job postings (P0, B-025) — no blockers
- **Day 5-7:** Launch content calendar execution (P1, B-027) — 2 blog posts, 1 video

### Ranga (CEO) — When Available
- Approve or defer: KYC vendor, launch strategy, Stripe live account
- Review: Suga's Candidate Search build when ready
- Review: CMO's landing page copy when ready

### Kimi (Coordinator)
- Track all 30 issues daily
- Flag any P0 slipping >3 days
- Escalate blockers to Ranga immediately
- Prepare unified launch report for Day 7

---

## Files Reference

- [90-Day Technical Roadmap](kimi-file://19e970f7-2f72-8ba2-8000-00000b71b4f8) — Suga's 3-month plan
- [Module and Skills Audit](kimi-file://19e970f7-4892-826e-8000-00001c9a4c8d) — 200 modules, full inventory
- [Skills Action Plan](kimi-file://19e970f7-6532-8787-8000-0000fbe1704f) — what to add, build, keep, cut
- [Design Files Priority](kimi-file://19e970f7-7c52-8605-8000-0000347b60cc) — 20 designs ranked
- [90-Day Marketing Roadmap](kimi-file://19e970c6-7912-8071-8000-00004fcf7981) — CMO's growth plan

---

*Last updated: June 5, 2026*  
*Next update: Daily at 6 PM IST*