# QA Master Tracker — Rekrut AI

> **Environment:** Staging (`https://rekrutai-staging.onrender.com`)  
> **Started:** 2026-07-08  
> **Schedule:** Every 2 hours via cron (`rekrut-qa-phase-batch`)  
> **Status:** Phase 1 in progress  

---

## Phase Overview

| Phase | Module | Status | Started | Completed | Issues Found | Critical | High | Medium | Low |
|-------|--------|--------|---------|-----------|--------------|----------|------|--------|-----|
| 1 | Authentication & Foundation | 🔄 IN PROGRESS | 2026-07-08 | — | 0 | 0 | 0 | 0 | 0 |
| 2 | Candidate Flow | ⏳ PENDING | — | — | — | — | — | — | — |
| 3 | Recruiter Flow | ⏳ PENDING | — | — | — | — | — | — | — |
| 4 | Payments & Subscriptions | ⏳ PENDING | — | — | — | — | — | — | — |
| 5 | Extended Features | ⏳ PENDING | — | — | — | — | — | — | — |
| 6 | Admin & Settings | ⏳ PENDING | — | — | — | — | — | — | — |
| 7 | Mobile Responsiveness | ⏳ PENDING | — | — | — | — | — | — | — |
| 8 | Security & Performance | ⏳ PENDING | — | — | — | — | — | — | — |

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
