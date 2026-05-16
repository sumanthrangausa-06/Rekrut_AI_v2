# Rekrut AI - Coordination System

## 🎯 Purpose
This file tracks the current UX/UI and growth work in progress for Rekrut AI.

## Daily Standup - 2026-05-16

### Completed Yesterday
- PR #1 (`feat: revenue dashboard + funnel metrics`) remains open on GitHub and is still mergeable; no new merges landed.
- Revalidated the QA bug report against the current codebase; the legacy OmniScore alias issue is now resolved in `server.js`.

### In Progress Today
- Running a mobile UX polish pass on the dashboard shell: sidebar, header, and content spacing for better touch targets and viewport consistency.
- Keeping revenue/Stripe launch readiness and funnel measurement at the top of the queue.
- Tracking the remaining `/api/jobs/:id/apply` versus `/api/candidate/jobs/:jobId/apply` decision.
- Preserving calendar automation, ATS/HRIS integration discovery, and transactional email coverage.
- Watching the authenticated dashboard QA path for a clean environment to validate against.
- Improving candidate matching quality and OmniScore accuracy with backend-only scoring fixes.

### Blockers
- Full authenticated dashboard QA is still blocked until `OPENAI_API_KEY` and PostgreSQL access are available in this environment.

### Coordination Notes
- Frontend route cleanup and navigation consistency are verified; the remaining path-choice item is backend-only.
- The next path-consistency item is the job application endpoint decision.
- QA should resume once the environment blocker is cleared.
- Open PR queue remains at 1 item, and there are no review requests yet.
- Backend validation today confirmed the candidate interview, onboarding, payroll, and AI coaching routes are already implemented.
- Candidate matching logic now uses stricter skill normalization to reduce false positives.
- OmniScore decay now uses elapsed time more accurately across weeks and months.

## 🛠️ Active Work
| Agent | Task | File | Status |
|-------|------|------|--------|
| Scrum Master | PR review coordination, task sequencing, and QA unblock | `COORDINATION.md`, `TASKS.md` | 🔄 In Progress |
| Backend | Revenue dashboard validation and Stripe launch readiness | API routes and billing flows | 🔄 In Progress |
| Backend | Calendar / ATS integration discovery | API and adapter layer | 🔄 In Progress |
| Backend | Email notifications coverage | Notifications routes and templates | 🔄 In Progress |
| Frontend | Candidate/recruiter route cleanup and navigation consistency | UI shell and remaining 404 links | ✅ Completed |
| QA | Full authenticated dashboard verification | Local app runtime | ⛔ Blocked |

## ✅ Completed Today
| Agent | Task | PR | Merged |
|--------|------|-----|--------|
| Scrum Master | Coordination refresh and daily standup update | N/A | Pending |
| Backend | Candidate matching quality tuning and OmniScore decay fix | N/A | Pending |
| Frontend | Candidate/recruiter route cleanup and navigation consistency | N/A | Done |
| Backend | Resolve OmniScore route consistency and align recruiter screening lookups | PR #1 | Done |

## Blockers
| Agent | Blocker | Needs From |
|--------|---------|------------|
| QA | App cannot start cleanly without `OPENAI_API_KEY` and local PostgreSQL access | Backend / Infra |

## Tomorrow's Priority
1. Unblock authenticated dashboard QA
2. Resolve candidate/recruiter route cleanup and job application alias consistency
3. Confirm revenue dashboard and Stripe launch readiness
4. Continue calendar and ATS integration planning
5. Keep transactional email coverage moving

## Revenue Review - 2026-05-15

### Findings
- Pricing and billing infrastructure is already in place: `/pricing` and `/api/billing` exist, so the monetization path is past the initial build stage.
- The remaining revenue gap is launch readiness: Stripe secret/config validation, payment success handling, and reliable measurement of checkout and sales-conversion events.
- Enterprise revenue is still manual today because the custom-plan CTA routes to email; that should be treated as a measurable sales handoff, not just a button.
- No explicit MRR, churn, or realized revenue report was present in the workspace, so this pass is a readiness review rather than a performance report.

### Next Actions
- Verify Stripe live/test setup and payment sync behavior.
- Add or confirm funnel metrics for plan views, checkout starts, completed purchases, and contact-sales clicks.
- Define the enterprise qualification and follow-up process.
- Keep billing work aligned with the existing landing-page analytics pass.

## Daily Standup - 2026-05-15

### Completed Yesterday
- Revalidated repo state and the open PR queue; no new merges changed the priority order.
- PR #1 (`Improve mobile dashboard navigation`) is still open on GitHub and awaiting full authenticated QA/review.
- Security follow-up remains complete: auth login logs were sanitized to remove credential-sensitive details.

### In Progress Today
- Keeping the EU AI Act Compliance Dashboard as the primary product priority.
- Continuing landing-page analytics + conversion instrumentation.
- Tracking OmniScore route consistency and the candidate/recruiter 404 cleanup decision.
- Preserving coverage for calendar automation, ATS/HRIS integrations, and transactional email work.
- Verifying OmniScore lookups stay aligned with the current `omni_scores` schema across screening and matching paths.
- Running a UX/UI polish pass on mobile responsiveness, component consistency, and accessibility for the landing, auth, and pricing surfaces.
- Tightening landing-page SEO and conversion copy plus homepage metadata so the public funnel is better aligned with search intent.
- Auditing Google Calendar, Outlook, Greenhouse, Lever, and HRIS integration surfaces; no matching implementation or adapter scaffolding has been found yet, so the next step is to define the contract before coding.

### Blockers
- Full dashboard QA is still blocked until `OPENAI_API_KEY` and PostgreSQL access are available in this environment.
- OmniScore path naming still needs a backend decision before frontend links are changed.

### Coordination Notes
- Frontend and backend agents should avoid touching the OmniScore path independently.
- QA should resume once the environment blocker is cleared.
- Open PR queue remains at 1 item.
- Integration work should stay scoped until the provider contracts and payload shapes are confirmed.

### Backend Developer - Completed Work
- [x] Resolve OmniScore route consistency for `/api/omniscore` vs `/api/candidate/omniscore` (completed 2026-05-15)
- [x] Align recruiter screening OmniScore queries to `total_score` / `last_updated` in the current schema

## ✅ Completed Work
- Audited the public landing page for SEO and conversion improvements
- Added clearer hero messaging, repeated CTAs, funnel-oriented sections, and basic analytics hooks
- Updated metadata for stronger search and social sharing previews
- Security audit completed for auth, candidate profile, and recruiter job flows:
  - Added profile input sanitization and field-length validation
  - Blocked duplicate job applications
  - Added auth rate limiting and stronger password checks
  - Added recruiter job input validation for titles, descriptions, and salaries
- Removed credential-debug logging from the login flow and stopped echoing the submitted email in login errors
- Sanitized auth login logs to remove credential-sensitive details
- Support triage note: verified those candidate validation fixes exist in code, so BUG-001 through BUG-004 in `QA_BUG_REPORT.md` look stale; `/api/candidate/omniscore` still appears to need an alias decision.
- Added a pricing page with Stripe Checkout flow and plan-selection UI at `/pricing`
- Wired a new `/api/billing` route for plans, checkout-session creation, and post-checkout confirmation
- Added pricing navigation from the landing page header
- Added landing, pricing, login, and signup analytics tracking for funnel measurement

## Daily Standup - 2026-05-03

### Completed Yesterday
- Security hardening landed on `dev` for candidate profile, duplicate applications, auth, and recruiter job validation.
- Build verification for PR #1 still passes.
- The stale QA bug report items for BUG-001 through BUG-004 were rechecked against code and appear outdated.

### In Progress Today
- Auditing calendar and ATS integration gaps, with a focus on Google Calendar, Outlook, Greenhouse, Lever, and HRIS workflows.
- Checking whether existing recruiter APIs need calendar hooks, sync endpoints, or adapter services before implementation.
- Verifying transactional email coverage and notification templates for application, interview, and offer flows.
- Reviewing PR #1 (`Improve mobile dashboard navigation`) and tracking its QA status.
- Deciding whether to add an alias for `/api/candidate/omniscore` or update the frontend links instead.

### Blockers
- Full dashboard QA is blocked because the local server still needs `OPENAI_API_KEY` and PostgreSQL access in this environment.
- PR #1 is mergeable, but it should not move forward until the QA blocker is resolved.

### Coordination Notes
- Backend and frontend agents should coordinate before touching the OmniScore route/link path.
- QA should re-run dashboard verification after the environment blocker is cleared.
- Calendar, ATS, and HRIS work stays secondary until the dashboard path is unblocked.

## 🛠️ Active Work
| Agent | Task | File | Status |
|-------|------|------|--------|
| Backend | Calendar / ATS integration discovery | API and adapter layer | 🔄 In Progress |
| Backend | Email notifications coverage | Notifications routes and templates | 🔄 In Progress |
| Frontend | Dashboard navigation and route consistency | UI shell and OmniScore links | 🔄 In Progress |
| QA | Full authenticated dashboard verification | Local app runtime | ⛔ Blocked |
| Scrum Master | PR review coordination and task sequencing | `COORDINATION.md`, `TASKS.md` | 🔄 In Progress |

## ✅ Completed Today
| Agent | Task | PR | Merged |
|--------|------|-----|--------|
| Security / Backend | Validation hardening and duplicate application prevention | PR #1 | Merged |
| Security / Backend | Sanitized auth login logs to remove credential-sensitive details | N/A | Done |
| Backend | Pricing page with Stripe Checkout and billing API | Pending PR | Pending |
| Frontend | Login privacy hardening | Pending PR | Pending |

## Blockers
| Agent | Blocker | Needs From |
|--------|---------|------------|
| QA | App cannot start cleanly without `OPENAI_API_KEY` and local PostgreSQL access | Backend / Infra |
| Frontend | OmniScore path ambiguity between `/api/omniscore` and `/api/candidate/omniscore` | Backend |

## Tomorrow's Priority
1. Unblock authenticated dashboard QA
2. Resolve OmniScore route/link consistency
3. Continue calendar and ATS integration planning
4. Review PR #1 for merge readiness after QA

## 🧪 QA Report - 2026-05-03
- PR #1: Improve mobile dashboard navigation — mergeable, but still waiting on full authenticated QA.
- `npm run build` passed.
- Mobile landing page smoke test passed.
- Full dashboard QA remains blocked because the local server crashes without `OPENAI_API_KEY`, and the app also cannot reach PostgreSQL in this environment.
- `gh pr list` currently shows one open PR on `dev`.
- Daily SRE check: `https://rekrutai.co` and `/health` both returned `200 OK`.

## 🧪 QA Report - 2026-05-14
- PR #1 (`Improve mobile dashboard navigation`): open on GitHub and still awaiting full authenticated QA.
- Syntax checks passed for `server.js` and all top-level `routes/*.js` files.
- `npm run build` passed.
- `npm run lint` is not available in this repo.
- Full authenticated runtime QA is still blocked by missing `OPENAI_API_KEY` and `ECONNREFUSED 127.0.0.1:5432` on local startup.
- Live uptime checks for `https://rekrutai.co` and `/health` both returned `200 OK`; repeated root probes stayed around ~0.13s-0.23s TTFB and `/health` around ~0.15s-0.28s.

### Analysis Pass
- Verified `routes/candidate.js` already sanitizes profile text and URLs, enforces length limits, validates positive integers, and rejects duplicate job applications.
- Verified the analytics path is wired end-to-end: `client/src/lib/analytics.ts` posts to `/api/analytics/events`, `routes/analytics.js` records events and builds funnel summaries, and `server.js` mounts the analytics router.
- The main remaining cleanup item is OmniScore path consistency: the backend still serves `/api/omniscore`, while the QA bug report references `/api/candidate/omniscore` as the stale 404.
- Treat BUG-001 through BUG-004 in `QA_BUG_REPORT.md` as stale unless a newer regression is confirmed.

## 🧪 QA Report - 2026-05-15
- PR #1 (`feat: revenue dashboard + funnel metrics`) is open and was partially verified.
- `node --check server.js` and all top-level `routes/*.js` checks passed.
- `npm run build` passed.
- The app starts when `OPENAI_API_KEY` is present, but full authenticated QA is still blocked in this environment because PostgreSQL is unavailable (`ECONNREFUSED 127.0.0.1:5432`).
- Revenue/admin routes boot and initial verification completes, but database-backed dashboard metrics could not be validated without a live DB.
- Recommendation: do not merge until the missing environment dependencies are available and the revenue dashboard is fully exercised.

## 📝 Notes
- Branch: `dev`
- Preserve unrelated workspace changes
- Keep updates concise and current

## Support Triage - 2026-05-15
- Rechecked `QA_BUG_REPORT.md` against the current codebase.
- BUG-001 through BUG-004 and BUG-007 still appear stale based on the current implementation.
- The remaining customer-facing follow-ups are the missing candidate/recruiter API endpoints listed in BUG-005 and the `/api/jobs/:id/apply` alias decision in BUG-006.
- No new support escalation surfaced in this pass.

## Scheduled Analysis - 2026-05-15

### Findings
- `routes/candidate.js` already sanitizes profile text, enforces length limits, validates URLs, clamps numeric fields, and blocks duplicate job applications.
- `routes/recruiter.js` already validates job titles, descriptions, salary ranges, and job types before saving jobs.
- `server.js` already mounts legacy OmniScore aliases for `/api/candidate/omniscore` and `/api/recruiter/omniscore`.
- The remaining route gaps in `QA_BUG_REPORT.md` are the prefixed 404s for candidate/recruiter interviews, onboarding, payroll, analytics, and AI coaching, plus the `/api/jobs/:id/apply` vs `/api/candidate/jobs/:jobId/apply` path mismatch.

### Guidance
- Treat BUG-001 through BUG-004 and BUG-007 as stale unless a fresh regression appears.
- Keep Stripe launch readiness and funnel measurement as the top active revenue work.
- Leave candidate/recruiter route cleanup as the next path-consistency item.