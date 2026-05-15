# Task Board

## Current Status
- Primary next priority: EU AI Act Compliance Dashboard.
- PR #1 (`Improve mobile dashboard navigation`) is merged on `main`; full runtime QA remains blocked until `OPENAI_API_KEY` and PostgreSQL access are available.
- QA check today: syntax and build passed; live uptime checks for `https://rekrutai.co` and `/health` both returned `200 OK`.
- Security follow-up completed today: auth login logs were sanitized to remove credential-sensitive details.

- [x] **Email Notifications System** - Implement transactional emails for applications, interviews, offers. Table stakes feature. (critical)
- [x] **Add Pricing Page with Stripe Checkout** - Create pricing page with tier selection and Stripe checkout integration. Critical for monetization. (critical)
- [ ] **EU AI Act Compliance Dashboard** - Add audit trail, risk classification, transparency reports. August 2026 deadline. (high)
- [ ] **Improve Candidate Matching Quality** - Refine ranking logic and validation so search results are more relevant and consistent. (high)
- [ ] **Fix Outstanding Reliability Issues** - Stabilize the daily run pipeline and reduce failure modes in the autonomous system. (high)
- [ ] **Partnership Outreach: ATS integrations** - Map and contact Greenhouse, Lever, Workday, and BambooHR for integration discovery. (high)
- [ ] **Partnership Outreach: Payroll integrations** - Map and contact Deel and Gusto for payroll partnership exploration. (high)
- [ ] **Partnership Outreach: Calendar integrations** - Map and contact Google Calendar and Outlook for scheduling integration discovery. (medium)
- [ ] **Interview scheduling sync adapters** - Add internal routes/services to connect interview scheduling with Google Calendar and Outlook once OAuth design is finalized. (medium)
- [ ] **Partnership Outreach: Job boards** - Map and contact Indeed, ZipRecruiter, and LinkedIn for posting/import partnerships. (medium)
