# Rekrut AI Codebase Architecture Map

> **Purpose:** Central reference for ALL subagents working on Rekrut AI. Read this file BEFORE starting work to understand the codebase structure.  
> **Updated:** 2026-06-11  
> **Repo:** https://github.com/sumanthrangausa-06/Rekrut_AI_v2  
> **Branch:** staging (default) → main (production)  
> **Tech Stack:** React + TypeScript (frontend), Express.js (backend), PostgreSQL (Neon), Tailwind CSS, shadcn/ui, Lucide icons

---

## Table of Contents

1. [Repo Structure](#1-repo-structure)
2. [Frontend (client/)](#2-frontend-client)
3. [Backend (routes/ + lib/ + server/)](#3-backend-routes--lib--server)
4. [Database (migrations/)](#4-database-migrations)
5. [E2E Tests (e2e/)](#5-e2e-tests-e2e)
6. [Key Configuration](#6-key-configuration)
7. [Security Critical Files](#7-security-critical-files)
8. [External Skills Reference](#8-external-skills-reference)
9. [How to Read This File](#9-how-to-read-this-file)

---

## 1. Repo Structure

```
Rekrut_AI_v2/
├── client/              # React + TypeScript frontend (Vite + Tailwind)
│   ├── src/
│   │   ├── pages/       # Page components (tsx) — see Frontend section
│   │   ├── components/  # Shared components (tsx)
│   │   ├── hooks/       # Custom React hooks
│   │   ├── lib/         # Utility functions, API clients
│   │   └── types/       # TypeScript type definitions
│   ├── public/          # Static assets
│   └── dist/            # Build output (production)
├── routes/              # Express.js route handlers (js) — see Backend section
├── lib/                 # Backend utilities, auth, DB, rate limiting (js)
├── server/              # Server services (email, etc.)
├── migrations/          # Database schema migrations (js + sql)
├── e2e/                 # Playwright E2E tests (spec.ts)
├── e2e-reports/         # E2E test reports (per test)
├── docs/                # Documentation (Cartesia setup, etc.)
├── scripts/             # Utility scripts
├── public/              # Static assets (CSS, JS)
├── .env.example         # Environment variables template
├── render.yaml          # Render.com deployment config
├── package.json         # Dependencies
├── vite.config.ts       # Vite build config
├── playwright.config.ts # Playwright test config
└── server.js            # Express server entry point
```

---

## 2. Frontend (client/)

### Pages (client/src/pages/)

**Public Pages:**
| File | Route | Purpose |
|------|-------|---------|
| `landing.tsx` | `/` | Homepage |
| `about.tsx` | `/about` | About page |
| `contact.tsx` | `/contact` | Contact page |
| `pricing.tsx` | `/pricing` | Pricing page |
| `privacy.tsx` | `/privacy` | Privacy policy |
| `terms.tsx` | `/terms` | Terms of service |
| `blog.tsx` | `/blog` | Blog page (uses `dangerouslySetInnerHTML` at line 356) |
| `login.tsx` | `/login` | Login page |
| `register.tsx` | `/register` | Registration page |
| `forgot-password.tsx` | `/forgot-password` | Password reset request |
| `reset-password.tsx` | `/reset-password` | Password reset confirmation |
| `test-camera.tsx` | `/test-camera` | Camera test page |

**Candidate Pages (client/src/pages/candidate/):**
| File | Route | Purpose |
|------|-------|---------|
| `dashboard.tsx` | `/candidate-dashboard` | Candidate dashboard |
| `jobs.tsx` | `/candidate-jobs` | Job listings |
| `job-detail.tsx` | `/candidate-jobs/:id` | Job detail |
| `applications.tsx` | `/candidate-applications` | Application tracking |
| `profile.tsx` | `/candidate-profile` | Candidate profile |
| `documents.tsx` | `/candidate-documents` | Document management |
| `assessments.tsx` | `/candidate-assessments` | Assessment list |
| `assessment-take.tsx` | `/candidate-assessments/:id` | Take assessment |
| `interviews.tsx` | `/candidate-interviews` | Interview list |
| `interview.tsx` | `/candidate-interviews/:id` | Interview detail |
| `video-interview.tsx` | `/candidate-video-interview` | Video interview |
| `mock-interview.tsx` | `/candidate-mock-interview` | Mock interview |
| `interview-practice.tsx` | `/candidate-interview-practice` | Practice interview |
| `interview-analysis.tsx` | `/candidate-interview-analysis` | Interview analysis |
| `quick-practice.tsx` | `/candidate-quick-practice` | Quick practice |
| `screening.tsx` | `/candidate-screening` | Screening |
| `chat.tsx` | `/candidate-chat` | Chat with recruiter |
| `company-profile.tsx` | `/candidate-company/:id` | Company profile |
| `onboarding.tsx` | `/candidate-onboarding` | Onboarding |
| `offers.tsx` | `/candidate-offers` | Offer management |
| `offer-management.tsx` | `/candidate-offers/:id` | Offer detail |
| `payroll.tsx` | `/candidate-payroll` | Payroll |
| `post-hire-feedback.tsx` | `/candidate-post-hire` | Post-hire feedback |
| `history.tsx` | `/candidate-history` | History |
| `ai-coaching.tsx` | `/candidate-ai-coaching` | AI coaching |
| `ai-coaching-progress.tsx` | `/candidate-ai-coaching-progress` | Coaching progress |
| `omniscore.tsx` | `/candidate-omniscore` | OmniScore (AI assessment score) |
| `assessment-results.tsx` | `/candidate-assessment-results` | Assessment results |
| `job-assessment-take.tsx` | `/candidate-job-assessment/:id` | Job-specific assessment |

**Recruiter Pages (client/src/pages/recruiter/):**
| File | Route | Purpose |
|------|-------|---------|
| `dashboard.tsx` | `/recruiter-dashboard` | Recruiter dashboard |
| `jobs.tsx` | `/recruiter-jobs` | Job management |
| `job-create.tsx` | `/recruiter-jobs/create` | Create job |
| `job-form.tsx` | `/recruiter-jobs/:id/edit` | Edit job |
| `job-applicants.tsx` | `/recruiter-jobs/:id/applicants` | Job applicants |
| `candidates.tsx` | `/recruiter-candidates` | Candidate pool |
| `applications.tsx` | `/recruiter-applications` | Application review |
| `assessments.tsx` | `/recruiter-assessments` | Assessment management |
| `job-assessment.tsx` | `/recruiter-assessments/:id` | Job assessment detail |
| `interviews.tsx` | `/recruiter-interviews` | Interview management |
| `screening.tsx` | `/recruiter-screening` | Screening setup |
| `chat.tsx` | `/recruiter-chat` | Chat with candidates |
| `company.tsx` | `/recruiter-company` | Company profile |
| `analytics.tsx` | `/recruiter-analytics` | Analytics dashboard |
| `communications.tsx` | `/recruiter-communications` | Communications |
| `trustscore.tsx` | `/recruiter-trustscore` | TrustScore (recruiter credibility) |
| `omniscore.tsx` | `/recruiter-omniscore` | OmniScore for candidates |
| `onboarding.tsx` | `/recruiter-onboarding` | Onboarding management |
| `onboarding-ai.tsx` | `/recruiter-onboarding-ai` | AI onboarding |
| `onboarding-docs.tsx` | `/recruiter-onboarding-docs` | Onboarding docs (uses `dangerouslySetInnerHTML` at line 383) |
| `offers.tsx` | `/recruiter-offers` | Offer management |
| `payroll.tsx` | `/recruiter-payroll` | Payroll |
| `payroll-dashboard.tsx` | `/recruiter-payroll-dashboard` | Payroll dashboard |
| `payroll-run.tsx` | `/recruiter-payroll-run` | Run payroll |
| `post-hire-feedback.tsx` | `/recruiter-post-hire` | Post-hire feedback |
| `career-page.tsx` | `/recruiter-career-page` | Career page builder |
| `public-company.tsx` | `/recruiter-public-company` | Public company page |

**Admin Pages (client/src/pages/admin/):**
| File | Route | Purpose |
|------|-------|---------|
| `login.tsx` | `/admin-login` | Admin login |
| `dashboard.tsx` | `/admin-dashboard` | Admin dashboard |
| `analytics.tsx` | `/admin-analytics` | Admin analytics |
| `revenue.tsx` | `/admin-revenue` | Revenue analytics |
| `ai-health.tsx` | `/admin-ai-health` | AI health monitoring |
| `compliance.tsx` | `/admin-compliance` | Compliance dashboard |
| `compliance/EUAIActDashboard.tsx` | `/admin-compliance/eu-ai-act` | EU AI Act compliance |
| `agents.tsx` | `/admin-agents` | Agent management |
| `agent-dashboard.tsx` | `/admin-agent-dashboard` | Agent dashboard |

**Recruiter Auth Pages (client/src/pages/):**
| File | Route | Purpose |
|------|-------|---------|
| `recruiter-register.tsx` | `/recruiter-register` | Recruiter registration |
| `recruiter-profile.tsx` | `/recruiter-profile` | Recruiter profile |

**Other Pages:**
| File | Route | Purpose |
|------|-------|---------|
| `employee-payroll.tsx` | `/employee-payroll` | Employee payroll |
| `payment-success.tsx` | `/payment-success` | Payment success |
| `compliance-dashboard.tsx` | `/compliance-dashboard` | Compliance dashboard |
| `not-found.tsx` | `*` | 404 page |
| `placeholder.tsx` | `/placeholder` | Placeholder page |
| `debug/mock-interview.tsx` | `/debug/mock-interview` | Debug mock interview |

### Components (client/src/components/)

**UI Components (shadcn/ui):**
`avatar.tsx`, `badge.tsx`, `button.tsx`, `card.tsx`, `checkbox.tsx`, `dialog.tsx`, `input.tsx`, `label.tsx`, `logo.tsx`, `progress.tsx`, `scroll-area.tsx`, `select.tsx`, `separator.tsx`, `sheet.tsx`, `skeleton.tsx`, `slider.tsx`, `switch.tsx`, `table.tsx`, `tabs.tsx`, `textarea.tsx`, `theme-toggle.tsx`, `tooltip.tsx`

**Domain Components:**
`calendar-picker.tsx`, `candidate-card.tsx`, `chart-card.tsx`, `chat.tsx`, `data-table.tsx`, `empty-state.tsx`, `file-upload.tsx`, `filter-bar.tsx`, `job-card.tsx`, `notification-center.tsx`, `omniscore-ring.tsx`, `skeleton.tsx`

**Layout Components:**
`dashboard-layout.tsx`, `header.tsx`, `sidebar.tsx`

**Other:**
`admin-auth-guard.tsx`, `ai-onboarding-dashboard.tsx`, `ai-onboarding-recruiter.tsx`, `error-boundary.tsx`

---

## 3. Backend (routes/ + lib/ + server/)

### Express Routes (routes/)

| File | API Prefix | Purpose | Key Endpoints |
|------|-----------|---------|---------------|
| `auth.js` | `/api/auth` | Authentication | POST /login, /register, /logout, /refresh, /forgot-password, /reset-password, /change-password, Google/LinkedIn OAuth |
| `candidate.js` | `/api/candidate` | Candidate profile | GET /profile, /jobs, /applications, PUT /profile |
| `jobs.js` | `/api/jobs` | Job management | GET /jobs, POST /jobs (recruiter), /jobs/:id, /jobs/:id/apply |
| `company.js` | `/api/company` | Company management | GET /company/:id, POST /company/register, /company/profile |
| `recruiter.js` | `/api/recruiter` | Recruiter operations | GET /dashboard, /candidates, /applications, /jobs, POST /jobs, /screening |
| `assessments.js` | `/api/assessments` | Assessments | GET /assessments, POST /assessments, /assessments/:id/take |
| `interviews.js` | `/api/interviews` | Interviews | GET /interviews, POST /interviews, /interviews/:id, /interviews/:id/feedback |
| `screening.js` | `/api/screening` | Screening | GET /screening, POST /screening/questions, /screening/:id |
| `onboarding.js` | `/api/onboarding` | Onboarding | GET /onboarding, POST /onboarding/complete, AI-generated docs (line 105: stores HTML) |
| `documents.js` | `/api/documents` | Documents | GET /documents, POST /documents/upload, /documents/:id |
| `matching.js` | `/api/matching` | AI matching | GET /matching/candidates, /matching/jobs, AI matching engine |
| `omniscore.js` | `/api/omniscore` | OmniScore | GET /omniscore/:candidateId, POST /omniscore/calculate |
| `trustscore.js` | `/api/trustscore` | TrustScore | GET /trustscore/:recruiterId, POST /trustscore/calculate |
| `analytics.js` | `/api/analytics` | Analytics | GET /analytics/dashboard, /analytics/revenue, /analytics/candidates |
| `billing.js` | `/api/billing` | Billing/Stripe | POST /billing/checkout, /billing/subscription, webhooks |
| `communications.js` | `/api/communications` | Messaging | GET /communications, POST /communications/send, /communications/:id |
| `notifications.js` | `/api/notifications` | Notifications | GET /notifications, POST /notifications, /notifications/:id/read |
| `notify-email.js` | `/api/notify` | Email service | POST /notify/email, GET /notify/status (NEW — added 2026-06-11) |
| `payroll.js` | `/api/payroll` | Payroll | GET /payroll, POST /payroll/run, /payroll/:id |
| `compliance.js` | `/api/compliance` | Compliance | GET /compliance, /compliance/eu-ai-act, POST /compliance/audit |
| `admin.js` | `/api/admin` | Admin | GET /admin/dashboard, /admin/analytics, /admin/users, /admin/agents |
| `settings.js` | `/api/settings` | User settings | GET /settings, PUT /settings, /settings/notifications |
| `tts.js` | `/api/tts` | Text-to-speech | POST /tts/synthesize, requires Cartesia API key |
| `voice-notifications.js` | `/api/voice-notifications` | Voice notifications | POST /voice-notifications, requires Cartesia API key |
| `quick-practice.js` | `/api/quick-practice` | Quick practice | POST /quick-practice, GET /quick-practice/:id |
| `countries.js` | `/api/countries` | Country data | GET /countries, /countries/:code |
| `memory.js` | `/api/memory` | AI memory | GET /memory, POST /memory, /memory/:id |

### Backend Libraries (lib/)

| File | Purpose | Key Exports |
|------|---------|-------------|
| `db.js` | PostgreSQL pool (Neon) | `pool` — database connection |
| `auth.js` | JWT auth, tokens | `generateToken`, `authMiddleware`, `generateRefreshToken`, `rotateRefreshToken`, `revokeAllTokens` |
| `distributed-rate-limiter.js` | Rate limiting | `rateLimits`, `distributedRateLimiter` |
| `email-service.js` | Email (legacy) | Email sending utilities |
| `crypto-utils.js` | **NEW** AES-256-GCM encryption | `encrypt()`, `decrypt()` — OAuth token encryption |
| `ai-provider.js` | AI provider integration | OpenAI/Claude API wrapper |
| `polsia-ai.js` | Polsia AI integration | Polsia AI service |
| `qp-ai.js` | Quick Practice AI | QP AI service |
| `qp-provider.js` | QP provider | QP provider wrapper |
| `recruiter-screener.js` | Recruiter screening | Screening logic |
| `self-hosted-audio.js` | Self-hosted audio | Audio processing |
| `metrics-collector.js` | Metrics collection | Application metrics |
| `activity-logger.js` | Activity logging | User activity tracking |
| `null-guard.js` | Null safety | Null checking utilities |
| `token-budget.js` | Token budget management | AI token budget tracking |
| `ai-call-logger.js` | AI call logging | AI API call logging |

### Server Services (server/)

| File | Purpose |
|------|---------|
| `server/services/email.js` | **NEW** Nodemailer email service (SMTP, templates, rate limiting) |
| `server/services/email-service.js` | Legacy email service |

---

## 4. Database (migrations/)

| Migration | Tables/Changes |
|-----------|----------------|
| `001_add_omniscore.js` | `omniscore` table |
| `002_add_trustscore.js` | `trustscore` table |
| `003_add_company_profile_fields.js` | Company profile fields |
| `003b_add_role_column.js` | `role` column to users |
| `004_candidate_profiles.js` | `candidate_profiles` table |
| `005_backfill_application_company_id.js` | Backfill `company_id` |
| `005b_oauth_refresh_tokens.js` | OAuth refresh tokens |
| `006_dynamic_assessments.js` | Dynamic assessments |
| `007_practice_sessions.js` | Practice sessions |
| `008_matching_engine.js` | Matching engine tables |
| `009_document_verification.js` | Document verification |
| `010_video_analysis.js` | Video analysis |
| `011_payroll_system.js` | Payroll system |
| `012_payroll_fixes.js` | Payroll fixes |
| `013_compliance_system.js` | Compliance system |
| `014_onboarding_system.js` | Onboarding system |
| `015_add_company_id_to_offers.js` | `company_id` to offers |
| `016_conversion_tracking.js` | Conversion tracking |
| `017_fix_missing_schema.js` | Schema fixes |
| `018_extend_onboarding_documents.js` | Onboarding docs |
| `019_candidate_onboarding_wizard.js` | Candidate onboarding wizard |
| `020_w4_filing_status.js` | W4 filing status |
| `021_payroll_company_bridge.js` | Payroll company bridge |
| `022_screening_questions.js` | Screening questions |
| `023_fix_interviews_updated_at.js` | Interview timestamps |
| `024_offer_letter_generation.js` | Offer letters |
| `025_real_onboarding_documents.js` | Real onboarding docs |
| `026_i9_government_spec_fields.js` | I9 government fields |
| `027_multi_country_support.js` | Multi-country support |
| `028_video_practice.js` | Video practice |
| `029_global_payroll_enhancements.js` | Global payroll |
| `030_omniscore_v2.js` | OmniScore v2 |
| `031_question_bank.js` | Question bank |
| `032_mock_interview_cached_feedback.js` | Mock interview feedback |
| `033_tts_audio_cache.js` | TTS audio cache |
| `034_activity_log.js` | Activity log |
| `035_email_notifications.js` | Email notifications |
| `035_pg_sessions.js` | PostgreSQL sessions |
| `036_smart_data_reuse.js` | Smart data reuse |
| `037_smart_profile_memory.js` | Smart profile memory |
| `038_ai_agents_pipeline_automation.js` | AI agents pipeline |
| `039_ai_health_monitoring.js` | AI health monitoring |
| `040_communication_hub.js` | Communication hub |
| `040_mock_per_question_analysis.js` | Mock question analysis |
| `041_interview_scheduling_screening.js` | Interview scheduling |
| `042_job_assessments.js` | Job assessments |
| `043_ai_health_persistence.js` | AI health persistence |
| `044_ai_onboarding_plans.js` | AI onboarding plans |
| `045_fix_company_id_fk_constraints.sql` | **CRITICAL FIX** — Fixed FK constraints for 5 tables referencing `companies(id)` |
| `046_password_reset_tokens.js` | Password reset tokens |
| `046_voice_notifications.js` | Voice notifications |
| `047_p2_schema_hardening.js` | Phase 2 schema hardening |
| `051_screening_tables.js` | Screening tables |
| `060_add_user_settings.js` | User settings |
| `061_add_notification_system.js` | Notification system |
| `062_fix_jobs_columns.js` | Jobs columns fix |
| `1739617200000_p1_interview_flow_schema.js` | Interview flow schema |
| `p2_schema_hardening.sql` | Phase 2 schema hardening (SQL) |
| `p3_schema_optimizations.js` | Phase 3 schema optimizations |
| `seed_notification_templates.js` | Seed notification templates |

---

## 5. E2E Tests (e2e/)

| Test File | What It Tests |
|-----------|---------------|
| `auth-persistence.spec.ts` | Auth session persistence |
| `candidate-flow.spec.ts` | Full candidate journey |
| `candidate-critical-flow.spec.ts` | Critical candidate paths |
| `candidate-apply-flow.spec.ts` | Job application flow |
| `candidate-profile-flow.spec.ts` | Profile management |
| `candidate-job-apply-flow.spec.ts` | Job-specific application |
| `candidate-documents-flow.spec.ts` | Document upload/management |
| `candidate-full-journey.spec.ts` | End-to-end candidate journey |
| `recruiter-flow.spec.ts` | Full recruiter journey |
| `recruiter-critical-flow.spec.ts` | Critical recruiter paths |
| `recruiter-job-create-flow.spec.ts` | Job creation flow |
| `recruiter-job-post-flow.spec.ts` | Job posting flow |
| `recruiter-job-posting-flow.spec.ts` | Job posting (alt) |
| `recruiter-candidates-management.spec.ts` | Candidate management |
| `recruiter-applicant-review-flow.spec.ts` | Applicant review |
| `recruiter-interview-scheduling.spec.ts` | Interview scheduling |
| `recruiter-analytics.spec.ts` | Recruiter analytics |
| `admin-dashboard-flow.spec.ts` | Admin dashboard |
| `admin-critical-flow.spec.ts` | Critical admin paths |
| `admin-analytics-flow.spec.ts` | Admin analytics |
| `admin-revenue-flow.spec.ts` | Revenue analytics |
| `ai-coaching-flow.spec.ts` | AI coaching |
| `application-submission-flow.spec.ts` | Application submission |
| `job-search-filtering.spec.ts` | Job search and filtering |
| `navigation-flow.spec.ts` | Navigation across pages |
| `navigation.spec.ts` | Navigation (alt) |
| `mobile-navigation.spec.ts` | Mobile navigation |
| `public-pages.spec.ts` | Public page rendering |
| `dark-mode.spec.ts` | Dark mode toggle |
| `settings-flow.spec.ts` | User settings |
| `password-reset-flow.spec.ts` | Password reset |
| `payment-flow.spec.ts` | Payment/Stripe flow |
| `payment.spec.ts` | Payment (alt) |
| `debug-candidate.spec.ts` | Debug candidate flow |
| `debug-jobs-html.spec.ts` | Debug job HTML |
| `debug-localStorage.spec.ts` | Debug localStorage |

---

## 6. Key Configuration

| File | Purpose | Key Settings |
|------|---------|-------------|
| `package.json` | Dependencies | Express, React, TypeScript, Vite, Tailwind, shadcn/ui, Playwright, Stripe, Nodemailer, isomorphic-dompurify (NEW) |
| `vite.config.ts` | Vite build | React plugin, path aliases, proxy config |
| `playwright.config.ts` | E2E config | Test projects, timeout, retries, workers |
| `render.yaml` | Render deployment | Staging + production services, env vars |
| `.env.example` | Env template | `DATABASE_URL`, `JWT_SECRET`, `STRIPE_*`, `CARTESIA_API_KEY` (NEW), `SMTP_*` (NEW), `OAUTH_TOKEN_ENCRYPTION_KEY` (NEW) |
| `server.js` | Server entry | Express setup, middleware, route mounting, `emailService` import (NEW) |
| `knip.json` | Dead code | Knip configuration |

---

## 7. Security Critical Files

| File | Issue | Status | Fix |
|------|-------|--------|-----|
| `routes/auth.js` | Account enumeration via `oauth_only: true` | ✅ **FIXED** | Generic error message |
| `routes/auth.js:479` | OAuth token stored plaintext | ⚠️ **PARTIAL** | `lib/crypto-utils.js` created, NOT applied to auth.js yet |
| `routes/auth.js:629` | OAuth token stored plaintext | ⚠️ **PARTIAL** | Same as above |
| `routes/onboarding.js:105` | AI HTML stored unsanitized | ❌ **NOT FIXED** | Need DOMPurify before DB storage |
| `routes/recruiter.js:2122` | AI HTML stored unsanitized | ❌ **NOT FIXED** | Need DOMPurify before DB storage |
| `client/src/pages/blog.tsx:356` | `dangerouslySetInnerHTML` | ❌ **NOT FIXED** | Replace with DOMPurify + sanitizer |
| `client/src/pages/recruiter/onboarding-docs.tsx:383` | `dangerouslySetInnerHTML` | ❌ **NOT FIXED** | Replace with DOMPurify + sanitizer |
| `set-test-password.js` | Hardcoded DB credentials | ✅ **FIXED** | Uses env vars only |
| `lib/crypto-utils.js` | AES-256-GCM encryption | ✅ **NEW** | For OAuth token encryption |

---

## 8. External Skills Reference

**For skill files, agents, and workflows — see:**
`/root/.openclaw/workspace/EXTERNAL_SKILLS.md`

Key skills for this codebase:
- `external-skills/gstack/autoplan/SKILL.md` — Planning
- `external-skills/gstack/ship/SKILL.md` — Deployment
- `external-skills/gstack/health/SKILL.md` — Code quality
- `external-skills/gstack/qa/SKILL.md` — Browser testing
- `external-skills/gstack/cso/SKILL.md` — Security audit
- `external-skills/defending-code-reference-harness/.claude/skills/vuln-scan/SKILL.md` — Vulnerability scanning
- `external-skills/agency-agents/engineering/engineering-frontend-developer.md` — React frontend
- `external-skills/agency-agents/engineering/engineering-backend-architect.md` — Backend API
- `external-skills/agency-agents/security/security-application-security-engineer.md` — Security fixes

---

## 9. How to Read This File

**For subagents:**
1. **Before starting work:** Read this file to understand the codebase structure
2. **Find your relevant files:** Use the tables above to locate the files you need to modify
3. **Check security critical files:** If working on auth, onboarding, or recruiter routes, check Section 7
4. **Use external skills:** Read relevant skill files from `EXTERNAL_SKILLS.md` before coding
5. **Commit when done:** Run `git add -A && git commit -m "type: message"`

**For Suga (CEO):**
- This file is updated after major structural changes
- Reference this when spawning subagents to give them context
- Point subagents to specific sections: "see REKRUT_AI_CODEBASE.md Section 3 for routes"

---

*Last updated: 2026-06-11 03:30 SGT*  
*Maintained by: Suga (CEO Agent)*  
*Next update: After major schema or architecture changes*
