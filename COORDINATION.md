# Rekrut AI - Coordination System

## 🎯 Purpose
This file tracks the current UX/UI and growth work in progress for Rekrut AI.

## Daily Standup - 2026-05-14

### Completed Yesterday
- No new merged code was detected in this coordination pass.
- PR #1 (`Improve mobile dashboard navigation`) remains open and mergeable.

### In Progress Today
- Revalidating repo state, branch health, and the open PR queue.
- Shifting focus toward the EU AI Act compliance dashboard and related reporting work.
- Preserving ongoing focus on calendar/ATS discovery, OmniScore route consistency, and transactional email coverage.
- Auditing the candidate matching path to confirm the recommended-jobs flow stays aligned with the OmniScore service and recruiter views.

### Blockers
- Full dashboard QA is still blocked because the local server needs `OPENAI_API_KEY` and PostgreSQL access in this environment.
- Matching-engine verification is also blocked by the same PostgreSQL dependency, so end-to-end score checks could not be completed.
- No additional repository blockers surfaced during this scan.

### Coordination Notes
- Backend and frontend agents should continue to avoid overlapping changes on the OmniScore route/link path.
- QA should resume once the environment blocker is cleared.
- PR #1 should remain gated until QA signoff.


### Frontend Developer - Active Work
- [ ] EU AI Act Compliance Dashboard (started 2026-05-14)
## ✅ Completed Work
- Audited the public landing page for SEO and conversion improvements
- Added clearer hero messaging, repeated CTAs, funnel-oriented sections, and basic analytics hooks
- Updated metadata for stronger search and social sharing previews
- Security audit completed for auth, candidate profile, and recruiter job flows:
  - Added profile input sanitization and field-length validation
  - Blocked duplicate job applications
  - Added auth rate limiting and stronger password checks
  - Added recruiter job input validation for titles, descriptions, and salaries
- Support triage note: verified those candidate validation fixes exist in code, so BUG-001 through BUG-004 in `QA_BUG_REPORT.md` look stale; `/api/candidate/omniscore` still appears to need an alias decision.
- Added a pricing page with Stripe Checkout flow and plan-selection UI at `/pricing`
- Wired a new `/api/billing` route for plans, checkout-session creation, and post-checkout confirmation
- Added pricing navigation from the landing page header

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
| Security / Backend | Validation hardening and duplicate application prevention | PR #1 | Pending |
| Backend | Pricing page with Stripe Checkout and billing API | Pending PR | Pending |

## Blockers
| Agent | Blocker | Needs From |
|--------|---------|------------|
| QA | App cannot start cleanly without `OPENAI_API_KEY` and PostgreSQL access | Backend / Infra |
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

## 📝 Notes
- Branch: `dev`
- Preserve unrelated workspace changes
- Keep updates concise and current