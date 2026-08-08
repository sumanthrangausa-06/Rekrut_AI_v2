# QA Master Tracker — Rekrut AI

> **Environment:** Staging (`https://rekrutai-staging.onrender.com`) + **Production (`https://rekrutai.co`)** as of 2026-08-07  
> **Started:** 2026-07-08  
> **Schedule:** Every 2 hours via cron (`rekrut-qa-phase-batch`)  
> **Status:** Full end-to-end sweep of both candidate and recruiter flows completed **2026-08-08** on
> staging (all 54 authenticated routes + hiring loop + Stripe/AI/email/video), with a read-only
> production smoke pass. See `live-qa-2026-08-08/REPORT.md`. The earlier 2026-08-07 production
> session is in `live-qa-2026-08-06/REPORT.md`.

---

## Phase Overview

| Phase | Module | Status | Started | Completed | Issues Found | Critical | High | Medium | Low |
|-------|--------|--------|---------|-----------|--------------|----------|------|--------|-----|
| 1 | Authentication & Foundation | ✅ VERIFIED (staging + prod) | 2026-07-08 | 2026-08-08 | 2 | 0 | 0 | 2 | 0 |
| 2 | Candidate Flow | ✅ FULL SWEEP (staging, 29 routes) | 2026-08-07 | 2026-08-08 | 5 | 2 | 1 | 1 | 1 |
| 3 | Recruiter Flow | ✅ FULL SWEEP (staging, 25 routes) | 2026-08-07 | 2026-08-08 | 3 | 1 | 2 | 0 | 0 |
| 4 | Payments & Subscriptions | ✅ TESTED (staging) | 2026-08-08 | 2026-08-08 | 1 | 1 | 0 | 0 | 0 |
| 5 | Extended Features | ✅ TESTED (AI, video, email) | 2026-08-08 | 2026-08-08 | 2 | 0 | 0 | 1 | 1 |
| 6 | Admin & Settings | ⏳ PENDING | — | — | — | — | — | — | — |
| 7 | Mobile Responsiveness | ✅ VERIFIED (prod, no overflow) | 2026-08-07 | 2026-08-08 | 0 | 0 | 0 | 0 | 0 |
| 8 | Security & Performance | 🔄 PARTIAL | 2026-08-08 | — | 2 | 2 | 0 | 0 | 0 |

### 2026-08-08 end-to-end QA session (staging `472c89f`, identical to prod)

Full report: [`live-qa-2026-08-08/REPORT.md`](live-qa-2026-08-08/REPORT.md). Covered all 29 candidate
routes, all 25 recruiter routes, the complete hiring loop, Stripe, AI, email and video, plus a
read-only production smoke pass.

**Core hiring loop works** — job posted, discovered, applied to, and advanced through the pipeline.
No stuck spinners and no uncaught JS exceptions anywhere.

**Issues filed:**
[#85](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/85) (P0, infinite render loops — 1,255 API calls/page),
[#86](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/86) (P0, staging using LIVE Stripe keys),
[#87](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/87) (P0, cannot apply from job board drawer),
[#88](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/88) (P1, ten missing API endpoints),
[#89](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/89) (P1, recruiter Candidates list + fabricated data),
[#90](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/90) (P2, candidate route calls recruiter endpoint),
[#91](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/91) (P2, no email provider on staging),
[#92](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/92) (P3, video interview error card).

**Evidence added to existing:** #15, #48, #49, #68, #69, #70, and #76–#83 (placeholder confirmations).

---

**2026-08-07 production QA session — GitHub issues filed:** [#67](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/67) (P0, Job Board infinite spinner), [#68](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/68) (P1, OmniScore infinite spinner), [#69](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/69) (P1, recruiter mock data), [#70](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/70) (P2, slow auth redirect), [#71](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/71) (P3, leftover E2E test data), [#72](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/72) (P3, chart label truncation). Added fresh evidence to existing [#15](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/15), [#48](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/48), [#49](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/49).

---

## Phase 1: Authentication & Foundation

### Test Areas
- [ ] Landing page loads correctly on staging
- [ ] Sign-up (candidate) — email/password
- [ ] Sign-up (recruiter) — email/password
- [ ] Login (candidate) — credentials work
- [ ] Login (recruiter) — credentials work
- [ ] Logout — clears session correctly
- [ ] Password reset flow
- [ ] Social auth (if configured)
- [ ] Navigation between pages works
- [ ] 404 page behavior
- [ ] Console errors on page load
- [ ] API health check endpoint

### Test Accounts
- **Candidate:** (create during test)
- **Recruiter:** (create during test)

### Findings Log
<!-- Append findings as they are discovered -->

| # | Date | Severity | Module | Description | Status |
|---|------|----------|--------|-------------|--------|

---

## Phase 2: Candidate Flow

### Test Areas
- [ ] Candidate dashboard loads
- [ ] Job search functionality
- [ ] Job detail page rendering
- [ ] Apply to job flow
- [ ] Profile creation / edit
- [ ] Resume upload
- [ ] Application status tracking
- [ ] Notifications

---

## Phase 3: Recruiter Flow

### Test Areas
- [ ] Recruiter dashboard loads
- [ ] Job posting creation
- [ ] Job listing management
- [ ] Candidate search
- [ ] Applicant review
- [ ] Analytics / metrics display
- [ ] Subscription management

---

## Phase 4: Payments & Subscriptions

### Test Areas
- [ ] Stripe integration (test mode)
- [ ] Plan selection UI
- [ ] Checkout flow
- [ ] Billing history
- [ ] Subscription cancellation
- [ ] Webhook handling

---

## Phase 5: Extended Features

### Test Areas
- [ ] AI-powered features (if deployed)
- [ ] Cartesia.ai voice (if integrated)
- [ ] Advanced search filters
- [ ] Email notifications
- [ ] Export / reporting

---

## Phase 6: Admin & Settings

### Test Areas
- [ ] Settings page
- [ ] Profile update
- [ ] Notification preferences
- [ ] Dark/light mode toggle (if exists)
- [ ] Help / support links

---

## Phase 7: Mobile Responsiveness

### Test Areas
- [ ] Landing page on mobile
- [ ] Dashboard on mobile (< 768px)
- [ ] Tablet views (768px – 1024px)
- [ ] Touch interactions
- [ ] Navigation menu collapse
- [ ] Job cards / lists on small screens

---

## Phase 8: Security & Performance

### Test Areas
- [ ] HTTPS enforcement
- [ ] No sensitive data in console
- [ ] Auth token handling
- [ ] SQL injection attempts (basic)
- [ ] XSS vectors (basic)
- [ ] Page load times
- [ ] API response times
- [ ] Lighthouse score

---

## Notes
- Test on staging: `https://rekrutai-staging.onrender.com`
- Each phase runs via cron every 2 hours
- Report findings immediately; do not batch
- If a critical bug is found, escalate to user immediately

## 2026-08-07 — Live Production QA Session

Full report, scripts, screenshots, and raw API logs: [`docs/qa/live-qa-2026-08-06/REPORT.md`](live-qa-2026-08-06/REPORT.md)

**Critical:** Candidate Job Board (`/candidate/jobs`) shows "0 active jobs" + infinite spinner despite the API returning real data — core product loop blocked (#67).

**High:** OmniScore page infinite spinner (#68); Recruiter Dashboard/Candidates/Analytics show fabricated mock data for brand-new zero-activity accounts (#69, extends #15).

**Medium:** Login/registration redirect takes 5-20+ seconds and is inconsistent (#70); `/api/analytics/events` fails CSRF validation sitewide (extends #49).

**Low:** Leftover E2E test job postings visible to real users (#71); truncated chart labels on recruiter dashboard (#72); SPA 404 pages return HTTP 200 (extends #48).

**What worked well:** all public marketing/auth pages, candidate Applications/Interviews/Assessments/Profile/Settings pages, recruiter Jobs page empty state, mobile viewport rendering on public pages.
