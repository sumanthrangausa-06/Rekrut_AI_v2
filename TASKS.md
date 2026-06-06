# Task Board

## Support Triage
- [x] Candidate/recruiter API endpoint gaps in `QA_BUG_REPORT.md` are mostly stale: the interview, onboarding, payroll, analytics, and AI-coaching routes already exist in the codebase.
- [x] Frontend route cleanup and navigation consistency are verified across the candidate/recruiter shell; the remaining path-choice item is backend-only.
- [x] Standardize the job application path on `/api/candidate/jobs/:jobId/apply`; treat `/api/jobs/:id/apply` as stale documentation unless a compatibility alias is added later.

## Team Structure (2026-06-06)
**Ranga** — CEO, Founder, Product Direction
**Suga** — CTO, Co-Founder, Orchestrator, Engineering Lead

All engineering, design, and QA work is now consolidated under Suga. No other agents active.

## Workflow: Dev → Staging → Prod

### Branch Strategy
- `dev` — Active development branch. All commits land here first.
- `staging` — Pre-production validation. Merged from dev when feature-complete.
- `main` — Production. Only merged from staging after QA pass.

### Process
1. **Develop** on `dev` branch (or feature branches → PR → dev)
2. **Test locally** — TypeScript build must pass, no new errors introduced
3. **Merge to `staging`** — Deploy to staging environment (Render)
4. **QA on staging** — Manual testing + smoke tests (Suga does QA)
5. **Merge to `main`** — Only after QA pass + Ranga approval for major features
6. **Deploy to prod** — Auto-deploy from main branch on Render

### QA Checklist (Before Staging → Prod)
- [ ] TypeScript build passes (`tsc --noEmit`)
- [ ] No runtime errors in staging logs
- [ ] Feature works end-to-end (manual test)
- [ ] No regressions on existing flows (login, apply, interview)
- [ ] Database migrations tested (if applicable)
- [ ] API endpoints respond correctly
- [ ] Mobile responsive check (quick)

### Staging Environment
- **URL:** https://rekrutai-staging.onrender.com
- **Auto-deploy:** From `staging` branch
- **Database:** Neon staging branch (needs Ranga to create)
- **API Keys:** Need Ranga to add to Render env vars

### Production Environment
- **URL:** https://hireloop-vzvw.polsia.app (or rekrutai.co)
- **Auto-deploy:** From `main` branch
- **Database:** Neon production
- **Status:** Currently the main product URL

## Current Sprint Priority (June 6-12, 2026)
1. **Recruiter Dashboard Analytics** — P0 launch blocker. Verify real API wiring, not placeholder.
2. **Email Notifications** — Templates seeded, triggers wired. Need SMTP credentials in production.
3. **EU AI Act Compliance Dashboard** — August 2026 deadline. Verify API wiring.
4. **Brand Cleanup** — Logo done, need responsive audit + remaining placeholder removal
5. **Sign Up/Sign In Polish** — Match Visily reference, social auth ready
6. **Legacy HTML Migration** — 11 pages still need React migration

## Done Today (2026-06-06)
- Public Company Profile page (real API endpoints)
- Brand cleanup (Logo component everywhere)
- Email notification infrastructure (6 templates, 4 auto-triggers)


### ✅ Foundation (Done — June 5, 2026)
- [x] **Component Library: Domain Components** — JobCard, CandidateCard, EmptyState, Skeleton, ChartCard, FilterBar, OmniScoreRing built in `client/src/components/domain/`
- [x] **Component Library: Advanced Components** — Need DataTable, NotificationCenter, FileUpload, CalendarPicker, ProfileCompletion, RichTextEditor
- [ ] **Brand Cleanup** — Replace ALL "Logo" / "Brand" / "Lorem ipsum" placeholders across all screens. Add Rekrut AI logo SVG, correct footer text ("© 2026 Rekrut AI, Inc."), remove Visily watermarks.
- [ ] **Responsive Audit** — Run mobile/tablet/desktop pass on all 20 reference screens. Ensure bottom nav on mobile, collapsible sidebar on tablet, fixed sidebar on desktop.

### ✅ Wave 1: Revenue & Trust (Done — Mostly built, needs polish)
- [x] Pricing Page — Already built with Stripe checkout, billing cycle toggle, plan cards. **Needs:** brand polish, enterprise CTA flow, analytics events.
- [x] Login — Already built with JWT auth, error handling, redirect. **Needs:** social auth buttons (Google/LinkedIn), "magic link" option, brand polish.
- [x] Register — Already built with role selector. **Needs:** social auth, progress indicator, brand polish.
- [x] Candidate Profile — Already built. **Needs:** match to Visily reference (analytics sidebar, skill badges, experience timeline).
- [x] Edit Profile — Edit mode in profile page. **Needs:** multi-section accordion, progress indicators, inline validation.

### 🔄 Wave 2: Core Differentiators (In Progress — June 5, 2026)
- [x] **Recruiter Candidate Search** — Built `recruiter/candidates.tsx` with real implementation: filters, tabs, stats, CandidateCard, search, export. (June 5, 2026)
- [x] **Candidate Documents** — Built `candidate/documents.tsx` with upload, OCR preview, fraud detection, document score, verification. (June 5, 2026)
- [x] **Recruiter AI Screener** — Built `recruiter/screening.tsx` with fit score, skill/experience/culture breakdown, strengths/concerns, auto-generated questions. (June 5, 2026)
- [ ] **EU AI Act Compliance Dashboard** — Built `admin/compliance.tsx` with audit trail, bias detection, risk classification, transparency reports. (June 5, 2026) — needs API wiring verification.
- [ ] **Recruiter Dashboard Analytics** — Already real implementation: KPI cards, funnel, source breakdown, OmniScore distribution. Don't rebuild, verify API wiring.
- [ ] **AI Interview** — Upgrade `candidate/interviews.tsx` to match Visily: video + chat side panel, participant tiles, transcript sidebar, AI coaching overlay. Wire to `/api/interviews/*`.
- [ ] **OmniScore Explainability** — Upgrade `candidate/omniscore.tsx` and `recruiter/omniscore.tsx`. "Why this score?" breakdown, historical trends, peer comparison, score improvement suggestions. Wire to `/api/omniscore/*` and `services/scoreExplainer.js`.
- [ ] **Create Job Listing** — Upgrade `recruiter/job-form.tsx`. 3-step wizard (details → skills → preview), AI skill suggestions, live preview, salary insights. Wire to `/api/jobs/*` and `/api/recruiter/job-optimizer/*`.
- [ ] **Profile Matching** — Upgrade `candidate/jobs.tsx` and `candidate/matching.tsx`. Show match % on job cards, skills gap breakdown, "Top Applicant" badges. Wire to `/api/matching/*`.

### Wave 3: Enterprise & Compliance (Days 8-10) — NEW SCREENS
- [ ] **Company Profile Public Page** — Upgrade `recruiter/company.tsx`. Public-facing with ratings, reviews, job cards, TrustScore, team photos, benefits. SEO-friendly.
- [ ] **Career Page** — NEW `recruiter/career-page.tsx`. Public careers page: team photos, benefits, culture, open positions, application CTA. Link from company profile.
- [ ] **Chat with Recruiter** — Upgrade communications. Full chat UI with file sharing, profile sidebar, read receipts, emoji reactions. Wire to `/api/communications/*`.
- [ ] **EU AI Act Compliance Dashboard** — NEW `admin/compliance.tsx`. Audit trail of all AI decisions, risk classification, transparency reports, bias detection results. August 2026 deadline. Wire to `/api/compliance/*` and `services/biasDetection.js`.
- [ ] **Email Notifications** — Implement transactional emails: application received, interview scheduled, offer sent, status change. Wire to Postmark (not SendGrid). Templates in `communication-generator.js`.
- [ ] **Onboarding Verify** — Verify `candidate/onboarding.tsx` matches Visily reference. Already 97K lines — check it doesn't need simplification.

### Wave 4: Advanced Features (Days 11-14) — FUTURE SPRINT
- [ ] **Skill Upgrade Catalog** — NEW `candidate/skills.tsx`. Course catalog, video player, progress tracking, certification badges, AI career path suggestions. Wire to new skill content API.
- [ ] **WorkWave Contract** — NEW `recruiter/contract/create.tsx`. Contract creation wizard: stepper (Employee → Job → Compensation → Extras → Quote), template selection, e-sign integration. Wire to contract generation API.
- [ ] **PayMaven KYC** — NEW `candidate/verification.tsx`. Business verification flow: owner info, ID upload, stepper, fraud detection. Wire to `services/document-verification.js`.
- [ ] **Aadhar Verification** — Mode in verification page. India-specific ID verification UI with OTP flow.
- [ ] **Candidate Search** — Replace placeholder `recruiter/candidates.tsx` with real implementation: filters (skills, location, salary, experience), candidate cards with match scores, bulk actions, save to pipeline. Wire to `/api/candidate/*` and `/api/matching/*`.
- [ ] **Candidate Documents** — Replace placeholder `candidate/documents.tsx` with real implementation: upload, OCR preview, fraud detection results, document score impact. Wire to `/api/documents/*`.

### Polish & QA (Ongoing)
- [ ] **Dark Mode** — Toggle + CSS tokens. All screens support light/dark.
- [ ] **Loading States** — Skeleton screens on all data-driven pages. No blank pages.
- [ ] **Empty States** — Illustrations + CTA on empty lists (no jobs, no candidates, no applications).
- [ ] **Error Boundaries** — Toast notifications for all API failures. No silent errors.
- [ ] **Accessibility** — Keyboard navigation, screen reader labels, focus management, ARIA roles.
- [ ] **Performance** — Code splitting per route, lazy loading, image optimization, bundle analysis.
- [ ] **Analytics** — Track all user interactions with meaningful event names. Already using `trackEvent` — verify coverage.
- [ ] **Testing** — Storybook for domain components. Basic E2E for login → pricing → checkout flow.

## Backend Tasks (Parallel to UI)
- [ ] **Stripe Launch Readiness** - Verify live/test keys, success/cancel flows, payment sync, and error handling. (high)
- [ ] **Enterprise Pricing Motion** - Define qualification, handoff, and follow-up flow for custom plans. (high)
- [ ] **EU AI Act Compliance Dashboard** - Add audit trail, risk classification, transparency reports. August 2026 deadline. (high)
- [ ] **Improve Candidate Matching Quality** - Refine ranking logic and validation so search results are more relevant and consistent. (high)
- [ ] **Fix Outstanding Reliability Issues** - Stabilize the daily run pipeline and reduce failure modes in the autonomous system. (high)
- [ ] **Partnership Outreach: ATS integrations** - Map and contact Greenhouse, Lever, Workday, and BambooHR for integration discovery. (high)
- [ ] **Partnership Outreach: Payroll integrations** - Map and contact Deel and Gusto for payroll partnership exploration. (high)
- [ ] **Partnership Outreach: Calendar integrations** - Map and contact Google Calendar and Outlook for scheduling integration discovery. (medium)
- [ ] **Interview scheduling sync adapters** - Add internal routes/services to connect interview scheduling with Google Calendar and Outlook once OAuth design is finalized. (medium)
- [ ] **Partnership Outreach: Job boards** - Map and contact Indeed, ZipRecruiter, and LinkedIn for posting/import partnerships. (medium)
- [ ] **Add Pricing Page with Stripe Checkout** - Create pricing page with tier selection and Stripe checkout integration. Critical for monetization. (critical)
- [ ] **Email Notifications System** - Implement transactional emails for applications, interviews, offers. Table stakes feature. (critical)

## Notes
- Integration discovery on 2026-05-16: no dedicated Google Calendar, Outlook, Greenhouse, Lever, or HRIS adapter scaffolding was found in the current codebase scan.
- Calendar/ATS/HRIS work should stay in contract-definition mode until auth, payloads, and sync rules are confirmed.
- OmniScore score decay now uses elapsed time more accurately, which should improve ranking stability over older activity.
- Candidate matching now uses stricter skill normalization to reduce false positives on similar-looking skill names.
- Job application routing is now canonically documented as `/api/candidate/jobs/:jobId/apply`.

## QA Run - 2026-05-16
- Tested PR #1 (`feat: revenue dashboard + funnel metrics`): build passes, runtime blocked by missing `OPENAI_API_KEY`.
- Tested PR #2 (`feat: polish mobile dashboard shell`): build passes.
- Current blocker for deeper QA: the app cannot boot cleanly in this environment without `OPENAI_API_KEY`.

---

## Session Update — 2026-06-05 (June 5, 2026) — UI Build Phase Sprint

### Completed Today
1. **Domain Components (10)** — JobCard, CandidateCard, EmptyState, Skeleton, ChartCard, FilterBar, OmniScoreRing, DataTable, NotificationCenter, FileUpload, CalendarPicker
2. **Shadcn Primitives (2)** — Table, Progress
3. **Screens Built/Upgraded (13):**
   - `recruiter/candidates.tsx` — Real implementation with filters, tabs, stats, search, export
   - `candidate/documents.tsx` — Upload, OCR preview, fraud detection, document score, verification
   - `recruiter/screening.tsx` — AI screener with fit score, skill/experience/culture breakdown
   - `admin/compliance.tsx` — EU AI Act compliance dashboard with audit trail, bias detection, risk classification
   - `admin/agents.tsx` — Agent Monitor for 210 agents with real-time stats, health, agent grid, run history
   - `recruiter/career-page.tsx` — Public careers page with hero, stats, benefits, team, open positions
   - `candidate/omniscore.tsx` — Upgraded with explainability: "Why this score?" factor breakdown, peer comparison (percentile, avg, median, top), improvement roadmap with difficulty/time estimates
   - `candidate/chat.tsx` + `recruiter/chat.tsx` — Full chat UI with sidebar, message bubbles, read receipts, typing indicator, file sharing, date separators, mobile responsive
   - Verified existing: `candidate/interviews.tsx`, `recruiter/job-form.tsx`, `candidate/jobs.tsx`, `recruiter/omniscore.tsx` — all comprehensive

### Next Priority
- Company Profile Public Page (`recruiter/company.tsx` upgrade)
- Email Notifications (transactional templates)
- Brand Cleanup (replace placeholders, logo SVG)
- Responsive Audit (mobile/tablet/desktop)
- Dark Mode, Loading States, Error Boundaries, Accessibility, Performance, Testing

## SESSION: 2026-06-05 (Wave 3 + Infrastructure)

### Completed
- [x] Footer with copyright + links (dashboard-layout.tsx)
- [x] Logo SVG component (components/ui/logo.tsx)
- [x] Dark mode CSS variables (index.css)
- [x] Theme toggle (header.tsx)
- [x] Skeleton loading states (components/ui/skeleton.tsx)
- [x] Responsive fixes on candidate/jobs.tsx (partial: filter stacking, search layout)

### Agent Delegation Results
- ✅ NEW FILE tasks: Footer (1m31s), Logo (1m4s) — agents succeed
- ❌ MODIFY FILE tasks: Responsive (timeout), ARIA (timeout), Brand (timeout), Dark Mode (timeout), Accessibility (timeout) — agents fail
- **Root cause**: Reading existing files consumes agent runtime budget
- **Solution**: Either (a) provide exact code snippets in task, or (b) handle modifications directly

### Remaining Polish
- [ ] Responsive audit on remaining pages (recruiter screens, admin screens)
- [ ] ARIA accessibility on forms (login, register, job-form)
- [ ] Performance: lazy loading, code splitting
- [ ] Testing: component tests, E2E setup
- [ ] Email notification templates
