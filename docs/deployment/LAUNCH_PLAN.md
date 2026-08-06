# Rekrut AI v2 — Launch Plan

## Objective
Ship Rekrut AI v2 to production (main branch) by end of the 90-day sprint. Staging (dev) is 95%+ complete. This plan covers staging → main deployment.

## Current Status (2026-06-08)

### P0 Items — All Complete ✅
| Item | Status | Commit |
|------|--------|--------|
| Security hardening | 100% | cf3bc53 |
| Legacy HTML migration | 100% | 2532aab |
| SPA auth fix | 100% | 2532aab |
| Stripe Live Validation | 100% | 90cf035, 1d56d57 |
| Sign Up polish (B-008) | 100% | 1003788 |
| Marketing site | 100% | a91cd84 |
| Settings page | 100% | Already built |
| Recruiter Analytics | 100% | c48db18 |
| Candidate Search | 100% | e419b42 |
| Mobile responsive | 95% | cf3bc53 |
| Dev environment fix | 100% | 2532aab |

### P1 Items — In Progress
| Item | Status | Notes |
|------|--------|-------|
| E2E test suite | 40% | Auth persistence tests added. Payment + navigation tests still needed. |
| EU AI Act dashboard | 50% | Assigned to kimiclaw. |
| Browser UI/UX testing | 0% | Not started. Needs Chrome + manual click-through. |
| Prod deployment | 0% | Not started. |

## Staging → Main Checklist

### 1. Environment Variables (Render)
- [ ] `STRIPE_SECRET_KEY` → `sk_test_...` (get from .env or Stripe dashboard)
- [ ] `STRIPE_PUBLISHABLE_KEY` → `pk_test_...` (get from .env or Stripe dashboard)
- [ ] `STRIPE_WEBHOOK_SECRET` → Get from Stripe dashboard or stripe-cli
- [ ] All other env vars (DB, JWT, AI keys) already on Render dev
- **Action:** Suga to update via Render dashboard or API
- **Blocker:** Need Ranga's Render access or API key

### 2. Browser UI/UX Testing
- [ ] Register page (split-screen, Visily match)
- [ ] Login page (split-screen, Visily match)
- [ ] Candidate jobs page (search, filters, mobile)
- [ ] Recruiter analytics page (charts, data)
- [ ] Landing page (hero, features, pricing, CTA)
- [ ] Settings page (all tabs, save changes)
- [ ] Checkout flow (Stripe redirect, success page)
- [ ] Mobile responsive (375px, 768px, 1024px viewports)
- **Action:** Suga + kimiclaw to run through flows, screenshot issues
- **Tool:** Chrome + manual testing

### 3. E2E Tests
- [ ] Auth persistence tests (already written: `auth-persistence.spec.ts`)
- [ ] Payment flow test (Stripe checkout → webhook → subscription status)
- [ ] Navigation flow test (all major routes)
- [ ] Dark mode test (theme toggle, persistence)
- [ ] Candidate job application flow
- [ ] Recruiter job posting flow
- **Action:** Run `npx playwright test` on dev branch
- **Status:** Auth tests written, payment + navigation still needed

### 4. API Endpoint Verification
- [ ] `GET /api/health` → 200
- [ ] `POST /api/auth/register` → creates user
- [ ] `POST /api/auth/login` → returns tokens
- [ ] `GET /api/candidate/jobs` → returns job list
- [ ] `GET /api/recruiter/analytics` → returns metrics
- [ ] `POST /api/billing/checkout-session` → returns Stripe URL
- [ ] `POST /api/billing/webhook` → handles Stripe events
- [ ] `GET /api/settings` → returns user settings
- **Action:** Run automated test scripts
- **Status:** Test scripts exist for most endpoints

### 5. Database Migration Check
- [ ] Neon DB schema matches production
- [ ] All 105 tables present
- [ ] Seed data for demo (if needed)
- [ ] pgvector extension enabled for AI matching
- **Action:** Verify via `psql` or migration logs
- **Status:** Unknown, need to check

### 6. Build Verification
- [ ] `tsc --noEmit` → 0 errors
- [ ] `npm run build` → success
- [ ] Bundle size < 2MB (current ~1.65MB)
- [ ] No console errors in production build
- **Action:** Run build locally, check output
- **Status:** Build succeeds, bundle ~1.65MB (needs code-splitting post-launch)

### 7. Deploy to Main
- [ ] Merge dev → main (PR + review)
- [ ] Render auto-deploy to rekrutai-prod
- [ ] Verify production URL: https://rekrut-ai.onrender.com
- [ ] Smoke test on production
- [ ] Rollback plan if issues
- **Action:** Create PR, merge, monitor
- **Status:** Not started

## Task Assignment (Parallel Execution)

| Task | Owner | ETA | Status |
|------|-------|-----|--------|
| Render env vars (Stripe) | Suga | 1h | Blocked: need Ranga's Render access |
| Browser UI/UX testing | Suga + kimiclaw | 2h | Not started |
| E2E payment + navigation tests | kimiclaw | 3h | Not started |
| EU AI Act dashboard | kimiclaw | 4h | 50% done |
| Prod deployment prep | Suga | 2h | Not started |
| Launch announcement (CMO) | CMO | 2h | Not started |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Stripe webhook secret missing | Medium | High | Get from Stripe dashboard or use stripe-cli |
| Render env vars misconfigured | Medium | High | Verify all vars before deploy, test on dev first |
| Mobile responsive issues | Medium | Medium | Test on real devices, fix before launch |
| EU AI Act non-compliance | Medium | High | Complete dashboard before launch, or scope out |
| Database migration failure | Low | High | Backup before deploy, test migration on staging |

## Next Actions (No Waiting)

1. **Suga:** Start browser UI/UX testing on local dev (Chrome). Screenshot every page, note issues.
2. **kimiclaw:** Finish EU AI Act dashboard + write E2E payment/navigation tests.
3. **Suga:** Ask Ranga for Render dashboard access or Stripe webhook secret when he's awake.
4. **Both:** Review this plan, split tasks, execute in parallel.

## Launch Criteria (All Must Pass)
- [ ] All P0s complete ✅
- [ ] Browser UI/UX testing passes
- [ ] E2E tests pass (auth + payment + navigation)
- [ ] Stripe checkout flow works end-to-end on staging
- [ ] No console errors in production build
- [ ] Mobile responsive on 375px, 768px, 1024px
- [ ] CMO signs off on messaging/copy
- [ ] Ranga approves final go/no-go

---
*Drafted by Suga (CEO). Ready to execute. No questions, just ship.*
