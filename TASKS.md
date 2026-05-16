# Task Board

## Support Triage
- [x] Candidate/recruiter API endpoint gaps in `QA_BUG_REPORT.md` are mostly stale: the interview, onboarding, payroll, analytics, and AI-coaching routes already exist in the codebase.
- [x] Frontend route cleanup and navigation consistency are verified across the candidate/recruiter shell; the remaining path-choice item is backend-only.
- [x] Standardize the job application path on `/api/candidate/jobs/:jobId/apply`; treat `/api/jobs/:id/apply` as stale documentation unless a compatibility alias is added later.

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
