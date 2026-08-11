# QA Master Tracker — Rekrut AI

> **Environment:** Staging (`https://rekrutai-staging.onrender.com`) + **Production (`https://rekrutai.co`)** as of 2026-08-07  
> **Started:** 2026-07-08  
> **Schedule:** Every 2 hours via cron (`rekrut-qa-phase-batch`)  
> **Status:** Phase 1 (auth) verified working on prod. Phase 2 (candidate) and Phase 3 (recruiter) run live against **production** on 2026-08-07. Full staging QA run on **2026-08-11** against commit `8748bc7` — see [`docs/qa/QA_STAGING_2026-08-11.md`](QA_STAGING_2026-08-11.md) for full findings.

> ⚠️ **2026-08-11 staging is NOT ready for production promotion.** Six blocking issues (#154, #155, #156, #157, #153, #162) must be resolved first. See QA report for details.

---

## Phase Overview

| Phase | Module | Status | Started | Completed | Issues Found | Critical | High | Medium | Low |
|-------|--------|--------|---------|-----------|--------------|----------|------|--------|-----|
| 1 | Authentication & Foundation | ✅ VERIFIED (prod) | 2026-07-08 | 2026-08-07 | 1 | 0 | 0 | 1 | 0 |
| 2 | Candidate Flow | ✅ TESTED (prod) | 2026-08-07 | 2026-08-07 | 3 | 1 | 1 | 0 | 1 |
| 3 | Recruiter Flow | ✅ TESTED (prod) | 2026-08-07 | 2026-08-07 | 2 | 0 | 1 | 0 | 1 |
| 4 | Payments & Subscriptions | ⏳ PENDING | — | — | — | — | — | — | — |
| 5 | Extended Features | ⏳ PENDING | — | — | — | — | — | — | — |
| 6 | Admin & Settings | ⏳ PENDING | — | — | — | — | — | — | — |
| 7 | Mobile Responsiveness | 🔄 SPOT-CHECKED (prod) | 2026-08-07 | — | 0 | 0 | 0 | 0 | 0 |
| 8 | Security & Performance | ⏳ PENDING | — | — | — | — | — | — | — |

**2026-08-07 production QA session — GitHub issues filed:** [#67](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/67) (P0, Job Board infinite spinner), [#68](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/68) (P1, OmniScore infinite spinner), [#69](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/69) (P1, recruiter mock data), [#70](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/70) (P2, slow auth redirect), [#71](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/71) (P3, leftover E2E test data), [#72](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/72) (P3, chart label truncation). Added fresh evidence to existing [#15](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/15), [#48](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/48), [#49](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/49).

---

## 2026-08-11 Staging QA Run (commit `8748bc7`)

Full report: [`docs/qa/QA_STAGING_2026-08-11.md`](QA_STAGING_2026-08-11.md)

| Area | Result |
|---|---|
| Infrastructure (health, metrics, security headers) | PASS |
| Auth (register, login, rate limiting, CSRF) | PASS |
| Public job board | PASS |
| Candidate profile & applications | PASS |
| Pending-recruiter holding + blocking | PASS |
| Database isolation (staging vs prod) | PASS |
| Owner join-requests queue (`/company/join-requests`) | **FAIL** — route shadowed by `/:slug` (#154) |
| Team members list (`/company/team/members`) | **FAIL** — `suspended_at` column missing (#157, #162) |
| Suspend / reinstate enforcement | **FAIL** — fails open, column absent (#157) |
| In-app notifications (`user_notifications` table) | **FAIL** — table missing (#155, #162) |
| Audit log writes | **FAIL** — `audit_logs` schema incompatible (#156) |
| Email delivery (SMTP) | **FAIL** — Connection timeout (#153) |
| Interview reminder cron | **FAIL** — wrong table queried (#163) |
| Admin dashboard stats | **FAIL** — `/admin/analytics` missing, `/admin/ai-health` wrong path (#164) |
| Admin agents page | **FAIL** — agents/runs, agents/stats missing (#164) |

**Issues filed in this session:**
- Reopened: [#104](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/104), [#153](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/153), [#154](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/154), [#155](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/155), [#156](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/156), [#157](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/157)
- New: [#162](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/162) (migrate.js skips .sql), [#163](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/163) (reminder cron wrong table), [#164](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/164) (admin dashboard zeros)

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
