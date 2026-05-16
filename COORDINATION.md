# Rekrut AI - Coordination System

## 🎯 Purpose

This file tracks the current UX/UI and growth work in progress for Rekrut AI.

## CTO Daily Check - 2026-05-16

### Integration Discovery

- Rechecked the codebase for Google Calendar, Outlook, Greenhouse, Lever, and HRIS adapter scaffolding.
- No dedicated integration routes/services were found yet, so this work is still at the contract-definition stage.
- Next step: define auth, payload shapes, sync direction, and failure handling before implementation.

### PR Review

- PR #1 (`feat: revenue dashboard + funnel metrics`) is open on GitHub and remains mergeable, but full runtime QA is still blocked by missing `OPENAI_API_KEY` and local PostgreSQL access.
- PR #2 (`feat: polish mobile dashboard shell`) is open and build-passing; it still benefits from a browser smoke test once the app can boot cleanly.

### System Performance

- Host health looks normal: load average is ~0.00, memory is plentiful, and disk usage is low.

### Architecture Decision

- Standardize the job application path on `/api/candidate/jobs/:jobId/apply`.
- Treat `/api/jobs/:id/apply` as a stale reference in docs and QA notes unless a compatibility alias is added later.

### Tech Debt / Next Priorities

- Keep calendar/ATS/HRIS work scoped to contract design until provider APIs are confirmed.
- Preserve the current focus on Stripe readiness, OmniScore consistency, and transactional email coverage.
- Clean up any remaining QA/docs references that still point at the non-canonical job application path.

### Guidance

- Keep calendar/ATS/HRIS work scoped to contract design until provider APIs are confirmed.
- Preserve the current focus on Stripe readiness, OmniScore consistency, and transactional email coverage.

## CTO Daily Check - 2026-05-15

### PR Review

- PR #1 (`feat: revenue dashboard + funnel metrics`) is open on GitHub and still tracking against `main`.
- The branch now also includes a small OmniScore compatibility fix for legacy `/api/candidate/omniscore` and `/api/recruiter/omniscore` links.

### Security Audit

- Fixed an IDOR issue in the GDPR/compliance self-service routes by requiring each authenticated user to act only on their own records unless they are an admin.
- Hardened Google and LinkedIn OAuth callbacks by validating the returned `state` against the session-stored OAuth nonce.

### System Performance

- Host health looks normal: load average is \~0.00, memory is plentiful, and disk usage is low.

### Tech Debt / Architecture

- Keep `/api/omniscore` as the canonical backend entrypoint; treat `/api/candidate/omniscore` and `/api/recruiter/omniscore` as compatibility shims only.
- Reduce build-artifact churn by keeping generated `client/dist/` output out of routine review unless a deployment is intentional.
- Stripe launch readiness, transactional email coverage, and integration contracts remain the highest-leverage gaps.

### Guidance

- Prioritize Stripe validation and funnel measurement first.
- Follow with the enterprise pricing handoff and transactional email coverage.
- Treat calendar/ATS integration work as contract-definition work before implementation.

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

## Daily Standup - 2026-05-14

### Completed Yesterday

- PR #1 (`Improve mobile dashboard navigation`) is still open on GitHub and remains under QA review.
- No new merge conflicts or repo-wide blockers surfaced in this pass.

### In Progress Today

- Revalidating repo state, branch health, and the open PR queue.
- Shifting focus toward the EU AI Act compliance dashboard and related reporting work.
- Preserving ongoing focus on calendar/ATS discovery, OmniScore route consistency, and transactional email coverage.
- Auditing the candidate matching path to confirm the recommended-jobs flow stays aligned with the OmniScore service and recruiter views.
- Tightening the EU AI Act compliance dashboard for mobile layouts, keyboard navigation, and clearer tab/table behavior.
- Auditing landing-page conversion and analytics instrumentation so the top-of-funnel pages emit useful events for CTA, signup, and pricing interactions.
- Mapping the interview and screening flows against Google Calendar, Outlook, and ATS sync points; no calendar OAuth or adapter routes were found in the current codebase scan.

### Blockers

- Full dashboard QA is still blocked because the local server needs `OPENAI_API_KEY` and PostgreSQL access in this environment.
- Matching-engine verification is also blocked by the same PostgreSQL dependency, so end-to-end score checks could not be completed.
- No additional repository blockers surfaced during this scan.

### Coordination Notes

- Backend and frontend agents should continue to avoid overlapping changes on the OmniScore route/link path.
- QA should resume once the environment blocker is cleared.
- PR #1 should remain treated as merged and closed.
- Growth work today is centered on clearer tracking for landing-page and pricing-page intent signals.

### Support Triage - 2026-05-14

- Revalidated `file QA_BUG_REPORT.md` against the current codebase; BUG-001 through BUG-004 now appear stale.
- The main remaining support follow-up is OmniScore path consistency plus the candidate/recruiter 404 endpoints listed in BUG-005.
- Keep `file TASKS.md` focused on those remaining routing gaps until a backend decision is made.

### Frontend Developer - Completed Work

- [x] Revenue Dashboard + Funnel Metrics (completed 2026-05-15)

- [x] Landing-page analytics + conversion instrumentation (completed 2026-05-14)

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
- Support triage note: verified those candidate validation fixes exist in code, so BUG-001 through BUG-004 in `file QA_BUG_REPORT.md` look stale; `/api/candidate/omniscore` still appears to need an alias decision.
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
| --- | --- | --- | --- |
| Backend | Calendar / ATS integration discovery | API and adapter layer | 🔄 In Progress |
| Backend | Email notifications coverage | Notifications routes and templates | 🔄 In Progress |
| Frontend | Dashboard navigation and route consistency | UI shell and OmniScore links | 🔄 In Progress |
| QA | Full authenticated dashboard verification | Local app runtime | ⛔ Blocked |
| Scrum Master | PR review coordination and task sequencing | `file COORDINATION.md`, `file TASKS.md` | 🔄 In Progress |

## ✅ Completed Today

| Agent | Task | PR | Merged |
| --- | --- | --- | --- |
| Security / Backend | Validation hardening and duplicate application prevention | PR #1 | Merged |
| Security / Backend | Sanitized auth login logs to remove credential-sensitive details | N/A | Done |
| Backend | Pricing page with Stripe Checkout and billing API | Pending PR | Pending |
| Frontend | Login privacy hardening | Pending PR | Pending |

## Blockers

| Agent | Blocker | Needs From |
| --- | --- | --- |
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
- Syntax checks passed for `file server.js` and all top-level `file routes/*.js` files.
- `npm run build` passed.
- `npm run lint` is not available in this repo.
- Full authenticated runtime QA is still blocked by missing `OPENAI_API_KEY` and `ECONNREFUSED 127.0.0.1:5432` on local startup.
- Live uptime checks for `https://rekrutai.co` and `/health` both returned `200 OK`; repeated root probes stayed around \~0.13s-0.23s TTFB and `/health` around \~0.15s-0.28s.

### Analysis Pass

- Verified `file routes/candidate.js` already sanitizes profile text and URLs, enforces length limits, validates positive integers, and rejects duplicate job applications.
- Verified the analytics path is wired end-to-end: `file client/src/lib/analytics.ts` posts to `/api/analytics/events`, `file routes/analytics.js` records events and builds funnel summaries, and `file server.js` mounts the analytics router.
- The main remaining cleanup item is OmniScore path consistency: the backend still serves `/api/omniscore`, while the QA bug report references `/api/candidate/omniscore` as the stale 404.
- Treat BUG-001 through BUG-004 in `file QA_BUG_REPORT.md` as stale unless a newer regression is confirmed.

## 🧪 QA Report - 2026-05-15

- PR #1 (`feat: revenue dashboard + funnel metrics`) is open and was partially verified.
- `node --check server.js` and all top-level `file routes/*.js` checks passed.
- `npm run build` passed.
- The app starts when `OPENAI_API_KEY` is present, but full authenticated QA is still blocked in this environment because PostgreSQL is unavailable (`ECONNREFUSED 127.0.0.1:5432`).
- Revenue/admin routes boot and initial verification completes, but database-backed dashboard metrics could not be validated without a live DB.
- Recommendation: do not merge until the missing environment dependencies are available and the revenue dashboard is fully exercised.

## 🧪 QA Report - 2026-05-16

- PR #1 (`feat: revenue dashboard + funnel metrics`): syntax checks passed, `npm run build` passed, but full runtime QA is blocked because `OPENAI_API_KEY` is missing and the app cannot start cleanly without it. Local health checks could not run because the server never came up.
- PR #2 (`feat: polish mobile dashboard shell`): `npm run build` passed and the shell changes look structurally sound, but manual browser QA was not possible in this environment.
- Recommendation: do not merge PR #1 yet; PR #2 is build-passing but still benefits from a browser smoke test once the app can boot.

## 📝 Notes

- Branch: `dev`
- Preserve unrelated workspace changes
- Keep updates concise and current