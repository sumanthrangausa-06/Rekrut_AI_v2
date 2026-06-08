# QA Test Plan — Staging Deployment (June 6, 2026)

> **Target:** https://rekrutai-dev.onrender.com
> **Branch:** staging
> **Commit:** 5eff4fc
> **Tester:** Suga (CTO) + automated agents
> **Duration:** Full QA cycle before main promotion

---

## 1. Smoke Tests (Must Pass)

### 1.1 Homepage
- [ ] Page loads < 3s
- [ ] Hero section renders with gradient
- [ ] CTA buttons clickable (Sign Up, Get Started)
- [ ] Features grid renders 6 cards
- [ ] How it works section shows 3 steps
- [ ] Social proof section renders testimonials
- [ ] FAQ accordion opens/closes
- [ ] Footer links work (About, Contact, Privacy, Terms)
- [ ] Mobile: hamburger menu works
- [ ] Mobile: all sections stack vertically

### 1.2 Legal Pages
- [ ] /about loads with company story
- [ ] /contact loads with contact form
- [ ] /privacy loads with privacy policy
- [ ] /terms loads with terms of service
- [ ] All pages have consistent header/footer
- [ ] Navigation links between pages work

### 1.3 Auth Pages
- [ ] /login loads with social auth buttons
- [ ] /register loads with social auth buttons
- [ ] /forgot-password loads
- [ ] Login form submits (test account)
- [ ] Register form submits (new account)
- [ ] Social auth buttons visible (Google, LinkedIn, GitHub)
- [ ] Form validation shows errors
- [ ] "Remember me" checkbox works
- [ ] Password visibility toggle works

---

## 2. Candidate Flow (Priority: P0)

### 2.1 Job Search (/candidate/jobs)
- [ ] Page loads with hero search bar
- [ ] Search returns results (test query: "software engineer")
- [ ] Filters work: location, salary, experience, type
- [ ] Sticky filters stay visible on scroll
- [ ] Split view: list left, detail right
- [ ] Match scores visible on job cards
- [ ] Save job button works (authenticated)
- [ ] AI search toggle works
- [ ] AI search returns results with explanation
- [ ] Pagination works (next/prev page)
- [ ] Mobile: filters collapse into drawer
- [ ] Mobile: single column layout

### 2.2 Job Detail (/candidate/jobs/:id)
- [ ] Page loads with job details
- [ ] Company info card renders
- [ ] Skills match indicator works
- [ ] One-click apply button visible
- [ ] Apply modal opens with resume/cover letter preview
- [ ] AI-generated tailored resume renders
- [ ] AI-generated cover letter renders
- [ ] Manual apply form works (cover letter textarea)
- [ ] Apply button submits successfully
- [ ] Success state shows after apply
- [ ] Mobile: modal full-screen

### 2.3 Profile (/candidate/profile)
- [ ] Page loads with profile header
- [ ] OmniScore ring renders with animation
- [ ] Skills timeline renders
- [ ] Portfolio section renders
- [ ] Edit profile button works
- [ ] Profile completeness percentage accurate
- [ ] Analytics sidebar renders (views, searches, applications)
- [ ] Mobile: single column, stacked sections

### 2.4 Applications (/candidate/applications)
- [ ] Page loads with application list
- [ ] Match scores visible on each application
- [ ] Progress bars show application status
- [ ] AI next-steps recommendations visible
- [ ] Filter by status works
- [ ] Mobile: cards stack vertically

---

## 3. Recruiter Flow (Priority: P0)

### 3.1 Dashboard (/recruiter/dashboard)
- [ ] Page loads with pipeline Kanban
- [ ] Pipeline columns: New, Screening, Interview, Offer, Hired
- [ ] Cards draggable between columns
- [ ] Quick stats render (open roles, applicants, interviews, offers)
- [ ] Action items list renders
- [ ] Performance widgets render (time-to-hire, source quality)
- [ ] Mobile: Kanban becomes horizontal scroll or list

### 3.2 Candidates (/recruiter/candidates)
- [ ] Page loads with search bar
- [ ] Saved searches section renders
- [ ] Bulk actions dropdown works (select all, send message, export)
- [ ] AI screener button visible
- [ ] Kanban/list toggle works
- [ ] Candidate cards show fit score, skills match
- [ ] Filter by pipeline stage works
- [ ] Mobile: list view default, filters in drawer

### 3.3 Jobs (/recruiter/jobs)
- [ ] Page loads with job list
- [ ] Pipeline mini-bars render for each job
- [ ] Grid/list toggle works
- [ ] Create job button navigates to /recruiter/jobs/new
- [ ] Mobile: single column cards

### 3.4 Job Form (/recruiter/jobs/new)
- [ ] Page loads with 3-step wizard
- [ ] Step 1: Title input works, AI suggestions appear
- [ ] Step 2: Skills input works, AI suggestions appear
- [ ] Step 3: Preview renders full job description
- [ ] Publish button works (creates job)
- [ ] Mobile: steps stack vertically

### 3.5 Screening (/recruiter/screening)
- [ ] Page loads with candidate fit score
- [ ] Circular fit score renders with animation
- [ ] Skill analysis section renders
- [ ] Red flags section renders (if any)
- [ ] Scorecard renders with detailed breakdown
- [ ] Mobile: sections stack vertically

### 3.6 Analytics (/recruiter/analytics)
- [ ] Page loads with dashboard
- [ ] Hiring funnel chart renders
- [ ] Velocity chart renders (time-to-hire trend)
- [ ] Source breakdown chart renders
- [ ] OmniScore distribution chart renders
- [ ] Date range filter works
- [ ] Mobile: charts scroll horizontally or stack

---

## 4. Backend API Tests (Automated)

### 4.1 Health Check
- [ ] GET /health returns 200
- [ ] GET /api/health returns 200

### 4.2 Auth Endpoints
- [ ] POST /api/auth/register — creates user
- [ ] POST /api/auth/login — returns tokens
- [ ] POST /api/auth/refresh — returns new access token
- [ ] POST /api/auth/logout — invalidates session
- [ ] GET /api/auth/me — returns user profile

### 4.3 Job Endpoints
- [ ] GET /api/jobs — returns job list with pagination
- [ ] GET /api/jobs/:id — returns job details
- [ ] POST /api/jobs — creates job (recruiter only)
- [ ] PUT /api/jobs/:id — updates job
- [ ] DELETE /api/jobs/:id — deletes job

### 4.4 Candidate Endpoints
- [ ] GET /api/candidate/profile — returns profile
- [ ] PUT /api/candidate/profile — updates profile
- [ ] GET /api/candidate/jobs — returns job search results
- [ ] POST /api/candidate/jobs/:id/apply — applies to job
- [ ] GET /api/candidate/applications — returns applications

### 4.5 Recruiter Endpoints
- [ ] GET /api/recruiter/dashboard — returns stats
- [ ] GET /api/recruiter/candidates — returns candidates
- [ ] GET /api/recruiter/analytics — returns analytics data
- [ ] POST /api/recruiter/screening — runs AI screening

### 4.6 AI Endpoints
- [ ] POST /api/ai/match — returns match scores
- [ ] POST /api/ai/screen — returns screening results
- [ ] POST /api/ai/interview — starts mock interview
- [ ] GET /api/ai/health — returns AI provider status

### 4.7 Admin Endpoints
- [ ] GET /api/admin/health — returns system health
- [ ] GET /api/admin/revenue — returns revenue data
- [ ] GET /api/admin/compliance/decisions — returns audit trail
- [ ] GET /api/admin/compliance/bias-report — returns bias report
- [ ] GET /api/admin/compliance/risk-classifications — returns risk categories

---

## 5. Performance Tests

### 5.1 Lighthouse Scores
- [ ] Homepage: Performance > 90
- [ ] Homepage: Accessibility > 90
- [ ] Homepage: Best Practices > 90
- [ ] Homepage: SEO > 90
- [ ] Job Search: Performance > 85
- [ ] Job Detail: Performance > 85
- [ ] Recruiter Dashboard: Performance > 80

### 5.2 Load Times
- [ ] First Contentful Paint < 1.5s
- [ ] Largest Contentful Paint < 2.5s
- [ ] Time to Interactive < 3.5s
- [ ] Total Bundle Size < 1.5MB (gzipped)
- [ ] API Response Time < 200ms (p95)

### 5.3 Database
- [ ] Query time < 100ms (p95)
- [ ] Connection pool < 80% utilization
- [ ] No slow queries (> 200ms) in last 24h

---

## 6. Security Tests

### 6.1 OWASP Top 10
- [ ] No SQL injection (tested with sqlmap)
- [ ] No XSS (tested with XSS payloads)
- [ ] No CSRF (tokens validated)
- [ ] Secure headers present (CSP, HSTS, X-Frame-Options)
- [ ] Rate limiting active (test with 100 req/s)
- [ ] JWT tokens expire correctly
- [ ] Refresh token rotation works
- [ ] Password reset flow secure

### 6.2 Data Protection
- [ ] GDPR consent banner present
- [ ] Data deletion request works
- [ ] PII encrypted in transit (HTTPS)
- [ ] PII encrypted at rest (if applicable)
- [ ] Audit logs capture access

---

## 7. Cross-Browser Testing

### 7.1 Desktop
- [ ] Chrome 120+ (primary)
- [ ] Firefox 121+
- [ ] Safari 17+ (Mac)
- [ ] Edge 120+

### 7.2 Mobile
- [ ] iOS Safari (iPhone 14)
- [ ] iOS Safari (iPhone 12)
- [ ] Chrome Android (Pixel 7)
- [ ] Chrome Android (Samsung S23)

### 7.3 Tablet
- [ ] iPad Safari (iPad Pro)
- [ ] iPad Safari (iPad Mini)
- [ ] Chrome Android (Galaxy Tab)

---

## 8. Accessibility Testing

- [ ] Keyboard navigation works (Tab, Enter, Escape)
- [ ] Screen reader announces page titles
- [ ] ARIA labels present on interactive elements
- [ ] Color contrast WCAG 2.1 AA compliant
- [ ] Focus indicators visible
- [ ] Form labels associated with inputs
- [ ] Images have alt text
- [ ] No keyboard traps

---

## 9. Regression Testing

### 9.1 Existing Features (Must Still Work)
- [ ] Mock interview flow (video + AI analysis)
- [ ] Quick Practice (isolated from mock interview)
- [ ] OmniScore generation
- [ ] TrustScore generation
- [ ] Job matching (pgvector semantic search)
- [ ] Document verification (OCR + fraud detection)
- [ ] AI coaching
- [ ] Payroll (US + India)
- [ ] Email notifications (6 templates)
- [ ] Admin AI health dashboard
- [ ] Admin revenue dashboard

### 9.2 Data Integrity
- [ ] Existing user profiles load correctly
- [ ] Existing job listings display correctly
- [ ] Existing applications show correct status
- [ ] No data loss from migration
- [ ] Database migrations apply cleanly

---

## 10. Stripe Testing (Test Mode)

- [ ] /pricing page loads with plans
- [ ] Plan selection works (Basic, Pro, Enterprise)
- [ ] Checkout redirect works
- [ ] Test payment succeeds (4242 4242 4242 4242)
- [ ] Test payment fails (4000 0000 0000 0002)
- [ ] Webhook receives event
- [ ] Subscription status updates in DB
- [ ] Invoice generated
- [ ] Customer portal link works

---

## 11. EU AI Act Compliance (Priority: P2)

- [ ] Compliance dashboard loads (/admin/compliance)
- [ ] Audit trail shows AI decisions
- [ ] Bias report shows demographic breakdown
- [ ] Risk classifications show correct categories
- [ ] Human review button works on decisions
- [ ] Transparency report generates
- [ ] Consent records accessible

---

## 12. Error Handling

- [ ] 404 page renders for unknown routes
- [ ] 500 error shows friendly message (not stack trace)
- [ ] Network error shows retry button
- [ ] API timeout shows error message
- [ ] Invalid form data shows validation errors
- [ ] Unauthorized access redirects to login
- [ ] Forbidden access shows error message

---

## Test Results Log

| Date | Test | Result | Notes | Fix Required |
|------|------|--------|-------|-------------|
| 2026-06-06 | Smoke: Homepage | ⏳ | Pending | |
| 2026-06-06 | Smoke: Legal Pages | ⏳ | Pending | |
| 2026-06-06 | Smoke: Auth | ⏳ | Pending | |
| 2026-06-06 | Candidate: Job Search | ⏳ | Pending | |
| 2026-06-06 | Candidate: Job Detail | ⏳ | Pending | |
| 2026-06-06 | Candidate: Profile | ⏳ | Pending | |
| 2026-06-06 | Candidate: Applications | ⏳ | Pending | |
| 2026-06-06 | Recruiter: Dashboard | ⏳ | Pending | |
| 2026-06-06 | Recruiter: Candidates | ⏳ | Pending | |
| 2026-06-06 | Recruiter: Jobs | ⏳ | Pending | |
| 2026-06-06 | Recruiter: Job Form | ⏳ | Pending | |
| 2026-06-06 | Recruiter: Screening | ⏳ | Pending | |
| 2026-06-06 | Recruiter: Analytics | ⏳ | Pending | |
| 2026-06-06 | Backend: Health | ⏳ | Pending | |
| 2026-06-06 | Backend: Auth | ⏳ | Pending | |
| 2026-06-06 | Backend: Jobs | ⏳ | Pending | |
| 2026-06-06 | Performance: Lighthouse | ⏳ | Pending | |
| 2026-06-06 | Security: OWASP | ⏳ | Pending | |
| 2026-06-06 | Mobile: iOS Safari | ⏳ | Pending | |
| 2026-06-06 | Mobile: Android Chrome | ⏳ | Pending | |
| 2026-06-06 | Accessibility | ⏳ | Pending | |
| 2026-06-06 | Regression: Mock Interview | ⏳ | Pending | |
| 2026-06-06 | Regression: OmniScore | ⏳ | Pending | |
| 2026-06-06 | Stripe: Test Payment | ⏳ | Pending | |
| 2026-06-06 | EU AI Act: Dashboard | ⏳ | Pending | |

---

## Go/No-Go Criteria for Main Promotion

| Criteria | Threshold | Status |
|----------|-----------|--------|
| Smoke tests | 100% pass | ⏳ |
| P0 features | 100% functional | ⏳ |
| Lighthouse | All > 85 | ⏳ |
| Security | 0 critical, 0 high | ⏳ |
| API tests | 100% pass | ⏳ |
| Mobile responsive | All pages usable | ⏳ |
| Accessibility | WCAG 2.1 AA | ⏳ |
| Regression | 0 broken features | ⏳ |
| TypeScript | ≤ 3 errors | ✅ |
| Build | Pass | ✅ |

**Final Decision:**
- [ ] GO — Promote staging → main
- [ ] NO-GO — Fix issues, retest

---

*Test plan created: 2026-06-06 15:30 UTC*
*QA Lead: Suga (CTO)*
*Next update: As tests complete*
