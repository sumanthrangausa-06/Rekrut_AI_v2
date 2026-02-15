# HireLoop — Current Architecture

**Last Audited:** Feb 15, 2026

## Overview

HireLoop is an AI-native hiring platform with dual frontend (React SPA + legacy HTML), Express.js backend, and Neon PostgreSQL. 351 API endpoints, 105 tables, 50 migrations. Deployed on Render.

**Live URL:** https://hireloop-vzvw.polsia.app

---

## UI Framework & CSS Architecture (Decision: Feb 15, 2026)

### Chosen Approach: Hybrid — Tailwind CDN + Custom CSS Design System

**Decision:** Keep the current hybrid approach. Not worth migrating 40+ HTML pages to a single framework.

### Two CSS Systems

| System | Files | Pages | Theme |
|--------|-------|-------|-------|
| **Light theme** | `globals.css` + Tailwind CDN | ~8 pages (landing, auth, dashboards via ui.js) | Light, Inter font, indigo accent |
| **Dark theme** | `styles.css` + `dashboard.css` + `responsive.css` | ~25+ pages (all sidebar-based app pages) | Dark, Space Grotesk + Inter, green accent |

### CSS Files

| File | Purpose | Responsive? |
|------|---------|-------------|
| `public/css/globals.css` | Light theme design system (buttons, cards, forms, sidebar, topbar, auth) | ✅ 768px breakpoint |
| `public/css/styles.css` | Dark theme design system (landing page, nav, hero, features, pricing, footer, omniscore) | ✅ 768px + 1024px |
| `public/css/dashboard.css` | Dark theme dashboard layout (sidebar, stats grid, action grid, interviews, upgrade banner, user dropdown) | ✅ 480px + 768px + 1024px + 1200px |
| `public/css/responsive.css` | Comprehensive responsive overrides for ALL pages (mobile nav, hero, grids, forms, tables, modals, touch, iOS zoom, inline-style grid collapse) | ✅ 360px + 480px + 768px + 1024px |
| `public/css/auth.css` | Dark theme auth pages (login/register split layout) | ✅ 480px + 768px + 1024px |
| `public/css/interview.css` | Interview flow (setup, question, response, feedback, results) | ✅ 480px + 768px + 1024px |

### JS Components

| File | Purpose |
|------|---------|
| `public/js/ui.js` | Renders sidebar + topbar for light-theme pages (recruiter/candidate nav, mobile toggle, dropdown) |
| `public/js/mobile-nav.js` | Auto-injects hamburger menu + overlay for dark-theme sidebar pages. Detects if ui.js already handled mobile and skips double-injection. |
| `public/js/core.js` | Auth, Utils, API helpers |

### Responsive Breakpoints

- **360px** — Ultra-small phones (320px-360px)
- **480px** — Small phones
- **768px** — Tablets / primary mobile breakpoint
- **1024px** — Small laptops / tablets in landscape
- **1200px** — Standard desktop

### Why Not Full Migration?

1. **40+ HTML pages** with hardcoded dark-theme CSS — too risky to migrate mid-sprint
2. **Two distinct design languages** (dark app vs light marketing) — intentional, not accidental
3. **Tailwind CDN + custom CSS** covers all needs without a build step for HTML pages
4. **React SPA (`client/`)** exists but is secondary — most users hit the HTML pages

### Mobile Navigation Strategy

- **Dark-theme pages** → `mobile-nav.js` auto-injects hamburger (☰) button at top-left, overlay behind sidebar
- **Light-theme pages** → `ui.js` renders topbar with built-in mobile toggle
- **Landing page** → Inline hamburger + slide-down menu panel
- **Standalone pages** (compliance, offer mgmt, post-hire) → Already use Tailwind responsive classes

---

## Frontend (client/src/)

### React Pages (36 page files, 42 routes)

#### Candidate (15 page files, 15 routes)
| Route | File | API Endpoints Used |
|-------|------|--------------------|
| `/candidate` | `pages/candidate/dashboard.tsx` | `/api/candidate/profile`, `/api/jobs` |
| `/candidate/profile` | `pages/candidate/profile.tsx` | `/api/candidate/profile`, `/api/candidate/skills` |
| `/candidate/jobs` | `pages/candidate/jobs.tsx` | `/api/jobs`, `/api/matching/recommendations` |
| `/candidate/jobs/:id` | `pages/candidate/job-detail.tsx` | `/api/jobs/:id`, `/api/candidate/applications` |
| `/candidate/assessments` | `pages/candidate/assessments.tsx` | `/api/assessments` |
| `/candidate/assessments/:id/take` | `pages/candidate/assessment-take.tsx` | `/api/assessments/:id` |
| `/candidate/job-assessment/:id` | `pages/candidate/job-assessment-take.tsx` | `/api/assessments/:id` |
| `/candidate/interviews` | `pages/candidate/interviews.tsx` | `/api/interviews` |
| `/candidate/ai-coaching` | `pages/candidate/ai-coaching.tsx` (shell) | `/api/interviews/practice/*`, `/api/interviews/mock/*` |
| `/candidate/applications` | `pages/candidate/applications.tsx` | `/api/candidate/applications` |
| `/candidate/offers` | `pages/candidate/offers.tsx` | `/api/candidate/offers` |
| `/candidate/omniscore` | `pages/candidate/omniscore.tsx` | `/api/omniscore` |
| `/candidate/documents` | `pages/placeholder.tsx` | (placeholder) |
| `/candidate/onboarding` | `pages/candidate/onboarding.tsx` | `/api/onboarding` |
| `/candidate/payroll` | `pages/candidate/payroll.tsx` | `/api/payroll` |

**Support files (not routed pages):**
- `pages/candidate/quick-practice.tsx` — Quick Practice tab (~1442 lines) — practice modal, camera/recording, video+text response submission, AI coaching results display
- `pages/candidate/mock-interview.tsx` — Mock Interview tab (~1665 lines) — voice interview with TTS, camera, frame capture, speech recognition, silence detection, real-time body language analysis
- `pages/candidate/ai-coaching-progress.tsx` — Progress + History tabs (~370 lines) — category progress bars, recent sessions, history with filter/review dialog
- `pages/candidate/coaching-types.ts` — Shared TypeScript types (185 lines)
- `pages/candidate/coaching-utils.tsx` — Shared utility components (68 lines)
- `pages/candidate/screening.tsx` — Routed at `/screening/:token` (top-level, not under /candidate)

#### Recruiter (13 page files, 17 routes)
| Route | File | API Endpoints Used |
|-------|------|--------------------|
| `/recruiter` | `pages/recruiter/dashboard.tsx` | `/api/recruiter/dashboard` |
| `/recruiter/jobs` | `pages/recruiter/jobs.tsx` | `/api/jobs` |
| `/recruiter/jobs/new` | `pages/recruiter/job-form.tsx` | `/api/jobs`, `/api/recruiter/job-optimizer` |
| `/recruiter/jobs/:id/applicants` | `pages/recruiter/job-applicants.tsx` | `/api/recruiter/jobs/:id/applicants` |
| `/recruiter/jobs/:id/edit` | `pages/recruiter/job-form.tsx` | `/api/jobs/:id` (reuses job-form) |
| `/recruiter/jobs/:id` | `pages/recruiter/job-applicants.tsx` | `/api/recruiter/jobs/:id/applicants` (reuses job-applicants) |
| `/recruiter/jobs/:id/assessment` | `pages/recruiter/job-assessment.tsx` | `/api/assessments` |
| `/recruiter/applications` | `pages/recruiter/applications.tsx` | `/api/recruiter/applications` |
| `/recruiter/assessments` | `pages/recruiter/assessments.tsx` | `/api/assessments` |
| `/recruiter/candidates` | `pages/placeholder.tsx` | (placeholder) |
| `/recruiter/interviews` | `pages/recruiter/interviews.tsx` | `/api/interviews` |
| `/recruiter/offers` | `pages/recruiter/offers.tsx` | `/api/recruiter/offers` |
| `/recruiter/onboarding` | `pages/recruiter/onboarding.tsx` | `/api/onboarding` |
| `/recruiter/analytics` | `pages/placeholder.tsx` | (placeholder) |
| `/recruiter/company` | `pages/recruiter/company.tsx` | `/api/company` |
| `/recruiter/payroll` | `pages/recruiter/payroll.tsx` | `/api/payroll` |
| `/recruiter/omniscore` | `pages/recruiter/omniscore.tsx` | `/api/omniscore` |

#### Admin (2 pages, 6 tabs)
| Route | File |
|-------|------|
| `/admin/login` | `pages/admin/login.tsx` |
| `/admin/ai-health` | `pages/admin/ai-health.tsx` |

**Admin Dashboard Tabs (ai-health.tsx):**
- **Overview** — 16 module cards (all architecture domain groups), token budget, system metrics, provider call distribution, failover events
- **AI Monitoring** — budget predictions, NL query, usage summary, hourly chart, module cost breakdown, daily token breakdown, model performance, AI call log
- **AI Providers** — real-time verification, modality status cards, module chain health
- **Routes** — 351-endpoint monitoring, route files breakdown, per-endpoint performance (requests, errors, p50/p95/p99)
- **Prompts** — prompt registry with versioning, A/B testing
- **Activity Feed** — real-time + historical event log with category filtering

#### Auth, Utility & Debug Routes
| Route | File | Notes |
|-------|------|-------|
| `/` | `pages/landing.tsx` | Landing page |
| `/login` | `pages/login.tsx` | Auth |
| `/register` | `pages/register.tsx` | Auth |
| `/dashboard` | (RoleRedirect) | Redirects to /candidate or /recruiter based on role |
| `/test-camera` | `pages/test-camera.tsx` | Camera testing utility |
| `/screening/:token` | `pages/candidate/screening.tsx` | Candidate screening (top-level route) |
| `/debug/mock-interview` | `pages/debug/mock-interview.tsx` | Mock interview debug tool |
| `/settings` | `DashboardLayout` | Settings section |
| `*` | Catch-all → Navigate to `/` | 404 redirect |

### Shared Components
- **UI (components/ui/):** avatar, badge, button, card, dialog, input, label, select, tabs, textarea
- **Layout (components/layout/):** dashboard-layout, header, sidebar
- **Feature:** admin-auth-guard, ai-onboarding-dashboard, ai-onboarding-recruiter, error-boundary
- **Context (contexts/):** auth-context.tsx (authentication state)
- **Lib (lib/):** api.ts (Axios client), utils.ts

### Legacy Frontend (public/)
42 HTML pages still served. Major ones: recruiter-*.html, candidate-*.html, assessment-*.html. Gradually being replaced by React SPA.

---

## Backend (server.js + routes/ + services/ + lib/)

### API Routes (19 files, 351 endpoints)

| Route File | Lines | Count | Domain |
|-----------|-------|-------|--------|
| `routes/quick-practice.js` | 465 | 7 | **ISOLATED** Quick Practice routes — uses qp-ai.js, NOT polsia-ai.js |
| `routes/interviews.js` | 2691 | 37 | Mock interviews, video analysis (practice routes REMOVED — now in quick-practice.js) |
| `routes/onboarding.js` | 3119 | 43 | Document generation, I-9, W-4, policies, benefits |
| `routes/candidate.js` | 2230 | 46 | Candidate profile, resume, skills, experience, education |
| `routes/assessments.js` | 1898 | 22 | Skill assessments, grading, AI feedback |
| `routes/recruiter.js` | 1850 | 43 | Dashboard, analytics, job optimization, candidate fit |
| `routes/payroll.js` | 941 | 16 | Payroll runs, paychecks, tax calculations |
| `routes/communications.js` | 633 | 13 | Message templates, bulk messaging |
| `routes/memory.js` | 598 | 14 | Smart profile memory, autofill |
| `routes/omniscore.js` | 578 | 13 | Candidate/company scoring |
| `routes/compliance.js` | 553 | 16 | Bias detection, consent, audit, fairness |
| `routes/auth.js` | 540 | 13 | Registration, login, OAuth, refresh tokens |
| `routes/documents.js` | 422 | 8 | Upload, OCR, fraud detection |
| `routes/company.js` | 418 | 7 | Company profile, settings |
| `routes/jobs.js` | 238 | 6 | Job CRUD |
| `routes/matching.js` | 206 | 6 | Job/candidate matching, ranking |
| `routes/trustscore.js` | 204 | 6 | Company trust scoring |
| `routes/admin.js` | 160 | 3 | Admin auth |
| `routes/analytics.js` | 124 | 2 | Event logging |
| `routes/countries.js` | 109 | 4 | Country config, tax/labor laws |
| `server.js` | ~1130 | 28 | Health, AI health dashboard (14), admin metrics (modules + routes) |

### Services (14 files)

| Service | Lines | Purpose |
|---------|-------|---------|
| `services/matching-engine.js` | 662 | Semantic job/candidate matching |
| `services/document-verification.js` | 524 | OCR, fraud detection, authenticity |
| `services/interview-ai.js` | 485 | Question gen, response analysis, coaching |
| `services/communication-generator.js` | 446 | Email/message templates |
| `services/job-optimizer.js` | 397 | JD optimization, salary insights |
| `services/trustscore.js` | 352 | Company trust scoring |
| `services/omniscore.js` | 343 | Multi-factor candidate scoring |
| `services/payroll-calculator.js` | 307 | Tax calculations, deductions |
| `services/country-config.js` | 280 | Tax config per country |
| `services/scoreExplainer.js` | 273 | Score transparency reports |
| `services/autofill-service.js` | 239 | Smart data reuse |
| `services/biasDetection.js` | 217 | Fairness scoring |
| `services/memory-service.js` | 214 | Profile caching |
| `services/auditLogger.js` | 124 | Audit trail logging |

### Core Libraries (lib/)

| Library | Lines | Purpose |
|---------|-------|---------|
| `lib/ai-provider.js` | 2493 | Multi-provider LLM with circuit breaker, fallback chains (used by Mock Interview + other features) |
| `lib/polsia-ai.js` | 1571 | AI function wrappers (Mock Interview, assessments, matching, resume parsing) |
| `lib/qp-provider.js` | 2493 | **ISOLATED** Quick Practice AI provider (forked from ai-provider.js) |
| `lib/qp-ai.js` | 967 | **ISOLATED** Quick Practice AI analysis pipeline (forked from polsia-ai.js) |
| `lib/ai-call-logger.js` | 545 | AI call logging, usage summary |
| `lib/activity-logger.js` | 399 | Request tracking for admin feed |
| `lib/metrics-collector.js` | 361 | Request/latency/error tracking |
| `lib/token-budget.js` | 331 | Token tracking, budget enforcement |
| `lib/self-hosted-audio.js` | 270 | Piper TTS self-hosted audio pipeline |
| `lib/auth.js` | 192 | JWT handling, authorization middleware |
| `lib/db.js` | 48 | PostgreSQL pool (Neon) |

### AI Provider Architecture
- **Primary:** Polsia OpenAI proxy (routes to Anthropic Claude, GPT-4o, Google Gemini)
- **Fallback chain:** OpenAI → NIM models (Llama, Nemotron, GPT-OSS) → Groq → Cerebras
- **Vision chain:** OpenAI GPT-4o → NIM Cosmos Reason → NIM Nemotron Nano VL
- **TTS:** Piper (self-hosted via `self-hosted-audio.js`) → browser fallback
- **ASR:** Whisper → Web Speech API
- **Circuit breaker:** Auto-opens on 3 consecutive failures, half-open after 60s
- **Token budget:** Daily limits with priority throttling

---

## Database (105 tables, 50 migrations)

### Schema Health Summary

| Metric | Count |
|--------|-------|
| Tables | 105 |
| Columns | 1,358 |
| Foreign Keys | 164 |
| Indexes | 386 (105 PKs + 242 custom + 39 other) |
| Partial Indexes | 10 (status-filtered queries) |
| CHECK Constraints | 56 (42 custom `chk_*` + 14 system) |
| Unique Constraints | 36 |
| TEXT columns | 373 |
| VARCHAR columns | 25 (genuinely bounded: country_code, currency_code, phone, zip, etc.) |
| timestamptz columns | 227 |
| timestamp w/o tz | 2 (only `_migrations.applied_at` + `user_sessions.expire` — system tables) |

**Schema pattern:** Normalized Relational (3NF) with JSONB extensions
**Vector indexes:** 2 IVFFlat (candidate_embeddings, job_embeddings)
**Schema hardening:** P0–P3 complete ✅ (Feb 14, 2026)

### Schema Hardening History (P0–P3) ✅ ALL COMPLETE

| Phase | Migration | Changes |
|-------|-----------|---------|
| **P0** | `041_fix_company_fk.js` | 5 company_id FK corrections (users.id → companies.id) |
| **P1** | `042_p1_interview_flow_schema.js` | 20 timestamp→timestamptz, NOT NULL constraints, 4 FKs, 14 indexes, 5 updated_at columns |
| **P2** | `045_p2_schema_hardening.js` | 37 CHECK constraints, 274 varchar→TEXT, 5 timestamp→timestamptz |
| **P3** | `046_p3_schema_optimizations.js` | 64 FK indexes, 182 timestamptz conversions, 6 partial indexes, 7 unique constraints |

### Domain Groups (16 groups, 105 tables)

#### 1. Users & Auth (4 tables)
| Table | Purpose | Key FKs |
|-------|---------|---------|
| users | Core user accounts | — |
| refresh_tokens | JWT refresh tokens | users.id |
| user_sessions | Active sessions | users.id |
| oauth_connections | OAuth provider links | users.id |

#### 2. Companies & Employees (4 tables)
| Table | Purpose | Key FKs |
|-------|---------|---------|
| companies | Company profiles | — |
| employees | Company employees | users.id, companies.id |
| company_policies | HR policies | companies.id |
| company_ratings | Company reviews | companies.id, users.id |

#### 3. Jobs & Applications (6 tables)
| Table | Purpose | Key FKs |
|-------|---------|---------|
| jobs | Job postings | companies.id |
| job_applications | Applications | jobs.id, users.id |
| job_analytics | Job performance metrics | jobs.id |
| job_recommendations | AI job matches | users.id, jobs.id |
| saved_jobs | User bookmarks | users.id, jobs.id |
| job_embeddings | Vector embeddings (IVFFlat) | jobs.id |

#### 4. Candidate Profiles (9 tables)
| Table | Purpose | Key FKs |
|-------|---------|---------|
| candidate_profiles | Extended profiles | users.id |
| candidate_skills | Skill tags | users.id |
| candidate_feedback | Feedback received | users.id |
| candidate_onboarding_data | Onboarding info | users.id |
| candidate_embeddings | Vector embeddings (IVFFlat) | users.id |
| education | Education history | users.id |
| work_experience | Work history | users.id |
| portfolio_projects | Portfolio items | users.id |
| parsed_resumes | Resume parsing results | users.id |

#### 5. Interview Flow (8 tables) — P0+P1 hardened ⭐
| Table | Purpose | Key FKs |
|-------|---------|---------|
| interviews | Mock/video interviews | users.id, jobs.id |
| scheduled_interviews | Recruiter-scheduled | companies.id, jobs.id, users.id |
| interview_questions | Question bank | — |
| interview_evaluations | AI/human evaluations | interviews.id, screening_sessions.id, users.id, jobs.id, companies.id |
| interview_analysis | Per-question analysis | interviews.id |
| interview_composite_scores | Composite scoring | interviews.id, screening_sessions.id, users.id, jobs.id, companies.id |
| interview_reminders | Reminder scheduling | scheduled_interviews.id, users.id |
| mock_interview_sessions | Conversational mock | users.id |

#### 6. Screening & Assessment (13 tables)
| Table | Purpose | Key FKs |
|-------|---------|---------|
| screening_templates | Screening question sets | companies.id |
| screening_sessions | Active screenings | companies.id, jobs.id, users.id |
| screening_answers | Candidate responses | screening_sessions.id |
| assessment_sessions | Assessment sessions | — |
| assessment_questions | Assessment questions | — |
| assessment_conversations | Assessment chat logs | — |
| assessment_events | Assessment events | — |
| job_assessments | Job-specific assessments | jobs.id |
| job_assessment_questions | Assessment question bank | job_assessments.id |
| job_assessment_attempts | Candidate attempts | job_assessments.id, users.id |
| skill_assessments | Skill evaluations | users.id |
| practice_sessions | Practice sessions | users.id |
| question_bank | Global question bank | — |

#### 7. Scoring & Trust (10 tables)
| Table | Purpose | Key FKs |
|-------|---------|---------|
| omni_scores | Primary scoring | users.id |
| omniscore_results | Detailed results | users.id |
| score_components | Score breakdowns | — |
| score_history | Score changes | users.id |
| score_appeals | Score appeal requests | users.id |
| role_scores | Role-specific scores | users.id |
| trust_scores | Trust metrics | users.id |
| trust_score_components | Trust breakdowns | trust_scores.id |
| trust_score_history | Trust changes | users.id |
| document_score_impacts | Doc effect on score | — |

#### 8. Offers & Onboarding (7 tables)
| Table | Purpose | Key FKs |
|-------|---------|---------|
| offers | Job offers | users.id, jobs.id, companies.id |
| offer_templates | Offer templates | companies.id |
| onboarding_plans | Onboarding plans | users.id, companies.id |
| onboarding_tasks | Onboarding tasks | onboarding_plans.id |
| onboarding_checklists | Checklists | users.id |
| onboarding_documents | Required docs | — |
| onboarding_chats | Onboarding chat | users.id |

#### 9. Communication (4 tables)
| Table | Purpose | Key FKs |
|-------|---------|---------|
| communications | Message log | users.id |
| communication_templates | Message templates | companies.id |
| communication_sequences | Drip sequences | companies.id |
| sequence_enrollments | Sequence tracking | users.id |

#### 10. Documents & Verification (4 tables)
| Table | Purpose | Key FKs |
|-------|---------|---------|
| verification_documents | ID verification | users.id |
| verified_credentials | Credential verification | users.id |
| document_verifications | Verification results | users.id |
| document_access_logs | Access audit trail | users.id |

#### 11. Compliance & Privacy (8 tables)
| Table | Purpose | Key FKs |
|-------|---------|---------|
| consent_records | GDPR consent | users.id |
| data_requests | Data export/delete | users.id |
| data_retention_policies | Retention rules | companies.id |
| country_configs | Country regulations | — |
| country_document_types | Required docs by country | — |
| bias_reports | Bias detection | — |
| fairness_audits | Fairness monitoring | — |
| audit_logs | System audit trail | — |

#### 12. Payroll (6 tables)
| Table | Purpose | Key FKs |
|-------|---------|---------|
| payroll_configs | Payroll settings | companies.id |
| payroll_runs | Payroll cycles | companies.id |
| pay_periods | Pay periods | payroll_configs.id |
| paychecks | Individual paychecks | employees.id |
| tax_documents | Tax forms | users.id |
| employee_benefits | Benefits | employees.id |

#### 13. AI Infrastructure (9 tables)
| Table | Purpose | Key FKs |
|-------|---------|---------|
| ai_prompts | Prompt storage | — |
| ai_prompt_versions | Prompt versioning | ai_prompts.id |
| ai_call_log | API call tracking | — |
| ai_token_budget_daily | Token budgets | — |
| ai_ab_tests | A/B test configs | — |
| ai_agent_actions | Agent action log | — |
| ai_provider_stats | Provider metrics | — |
| ai_provider_verification | Provider health | — |
| ai_verification_meta | Verification metadata | — |

#### 14. Matching & Recommendations (7 tables)
| Table | Purpose | Key FKs |
|-------|---------|---------|
| match_results | Match scores | users.id, jobs.id |
| mutual_matches | Mutual interest | users.id, jobs.id |
| recruiter_preferences | Recruiter criteria | users.id |
| recruiter_feedback | Recruiter feedback | users.id |
| pipeline_automation_rules | Pipeline rules | companies.id |
| scheduling_preferences | Scheduling prefs | users.id |
| post_hire_feedback | Post-hire reviews | users.id |

#### 15. Memory & Context (2 tables)
| Table | Purpose | Key FKs |
|-------|---------|---------|
| user_memory | User memory/context | users.id |
| tts_cache | TTS audio cache | — |

#### 16. System (4 tables)
| Table | Purpose |
|-------|---------|
| _migrations | Migration tracking |
| activity_log | User activity |
| events | System events |
| agent_data | Agent SDK data storage |

---

## Infrastructure

- **Hosting:** Render (web service)
- **Database:** Neon PostgreSQL
- **Storage:** Polsia R2 (file uploads)
- **Build:** Vite (frontend) → Express serves static from `client/dist/`
- **Sessions:** PostgreSQL session store (connect-pg-simple), 7-day expiry
- **Body limit:** 50MB JSON for video frame uploads
- **CORS:** Credentials enabled
- **Permissions:** Camera + microphone access headers

---

## Quick Practice Isolation Architecture (Feb 15, 2026 — #32717)

Quick Practice was breaking every time Mock Interview code changed because they shared the same analysis pipeline. They are now **fully decoupled**:

```
QUICK PRACTICE (isolated)          MOCK INTERVIEW (shared modules)
─────────────────────────          ──────────────────────────────
quick-practice.tsx (frontend)      mock-interview.tsx (frontend)
        │                                  │
        ▼                                  ▼
routes/quick-practice.js           routes/interviews.js
        │                                  │
        ▼                                  ▼
lib/qp-ai.js                      lib/polsia-ai.js
        │                                  │
        ▼                                  ▼
lib/qp-provider.js                 lib/ai-provider.js
```

**Rules:**
- Changes to `polsia-ai.js`, `ai-provider.js`, or `interviews.js` → affect Mock Interview ONLY
- Changes to `qp-ai.js`, `qp-provider.js`, or `quick-practice.js` → affect Quick Practice ONLY
- Shared utilities (auth, DB, etc.) remain common — they're stable and rarely change
- If Quick Practice needs a fix, edit `qp-ai.js` and `routes/quick-practice.js`
- If Mock Interview needs a fix, edit `polsia-ai.js` and `routes/interviews.js`

---

## Problem Areas

### 1. Monolith Files
- **~~`ai-coaching.tsx` (4044 lines)~~** **SPLIT Feb 15** — now a thin router/shell (291 lines) managing shared state and tab structure. Split into: `quick-practice.tsx` (~1442 lines), `mock-interview.tsx` (~1665 lines), `ai-coaching-progress.tsx` (~370 lines), plus pre-existing `coaching-types.ts` (185 lines) and `coaching-utils.tsx` (68 lines).
- **`ai-provider.js` (2287 lines):** Provider abstraction + 15+ provider implementations + circuit breaker logic. Largest backend file.
- **~~`interviews.js` (3190 lines)~~** **SPLIT Feb 15 (#32717)** — now 2691 lines (Mock Interview + video analysis only, 37 endpoints). Quick Practice routes (7 endpoints) moved to `routes/quick-practice.js` (465 lines) with isolated AI pipeline.
- **`onboarding.js` (3119 lines):** Document generation, I-9, W-4, policies, benefits — 43 endpoints.
- **`polsia-ai.js` (1304 lines):** AI function wrappers growing with each new feature.
- **`server.js` (988 lines):** Express setup + 26 AI health endpoints + admin metrics all in one file.

### 2. Tight Coupling
- ~~Quick Practice and Mock Interview share state variables in the same component~~ **SPLIT Feb 15** — separated into `quick-practice.tsx`, `mock-interview.tsx`, and `ai-coaching-progress.tsx`; shared state managed by parent shell `ai-coaching.tsx`
- ~~Quick Practice and Mock Interview share backend analysis pipeline~~ **DECOUPLED Feb 15 (#32717)** — Quick Practice now has its own isolated code path: `routes/quick-practice.js` → `lib/qp-ai.js` → `lib/qp-provider.js`. Changes to Mock Interview code (polsia-ai.js, ai-provider.js, interviews.js) have ZERO effect on Quick Practice.
- ~~AI provider errors cascade into null-safety crashes~~ **FIXED Feb 14** — allSettled checks now validate `value != null`
- Legacy HTML pages and React SPA co-exist, causing route conflicts

### 3. Known Tech Debt
- 42 legacy HTML pages still served alongside React SPA
- ~~`JSON.parse()` of AI responses can return null~~ **FIXED Feb 14** — `generateInterviewCoaching` and `analyzeInterviewResponse` now validate parsed results are objects
- 43% of mock_interview_sessions stuck in_progress (zombie records)
- ~~5 tables have company_id FK pointing to users instead of companies~~ **FIXED Feb 14 (P0)** — corrected to companies.id
- ~~Missing FK indexes for common queries~~ **FIXED Feb 14 (P1+P3)** — 78 FK indexes added
- ~~274 arbitrary VARCHAR limits~~ **FIXED Feb 14 (P2)** — converted to TEXT, only 25 genuinely bounded VARCHARs remain
- ~~Mixed timestamp/timestamptz~~ **FIXED Feb 14 (P1+P2+P3)** — 227 timestamptz columns, only 2 system-table timestamps remain
- ~~Missing CHECK constraints on enums~~ **FIXED Feb 14 (P2)** — 42 custom CHECK constraints enforcing valid enum values
- 3 placeholder routes (candidate/documents, recruiter/candidates, recruiter/analytics) with no real implementation
- No E2E test suite
- No TypeScript on backend (pure JS)

---

## Changelog

| Date | Change |
|------|--------|
| Feb 15, 2026 | **Admin dashboard full coverage (#32837):** Added 6 missing domain group module cards (Users & Auth, Scoring & Trust, Communications, Matching, Screening, Memory & System) — dashboard now covers all 16 architecture domain groups. Added new "Routes" tab with full 351-endpoint monitoring including route files breakdown, per-endpoint performance metrics (requests, errors, p50/p95/p99 latency), and API latency percentiles. Backend `/api/admin/modules` now queries all domain group tables; new `/api/admin/routes` endpoint for route metrics. Updated admin section documentation with all 6 tabs. |
| Feb 14, 2026 | **Audit & corrections:** Fixed page count (23→36 files/42 routes), added 8 missing candidate routes, 5 missing recruiter routes, 6 missing utility/debug routes. Fixed endpoint count (322→351). Verified migration count (47 correct — 44 numbered sequences with 3 duplicates at 003, 005, 040). Fixed HTML page count (39→42). Corrected all service/lib line counts (many were dramatically wrong — e.g. ai-provider.js was listed as 930 lines but is actually 2287). Added missing services (auditLogger.js, memory-service.js). Moved memory-service.js from lib/ to services/ where it actually lives. Added missing lib (self-hosted-audio.js). Added missing feature component (ai-onboarding-recruiter.tsx). Added route line counts. Identified additional monolith files (interviews.js, onboarding.js, polsia-ai.js). |
| Feb 14, 2026 | **Schema hardening (P0–P3 complete):** Merged detailed schema reference from DATABASE_SCHEMA.md into this doc. Updated table count (75+→105), migration count (47→50), added full schema health metrics. Documented all 16 domain groups with 105 tables, 164 FKs, 386 indexes, 56 CHECK constraints, 36 unique constraints. Marked P0–P3 schema hardening as complete: P0 (5 FK corrections), P1 (interview flow: 20 timestamptz + NOT NULL + 4 FKs + 14 indexes), P2 (37 CHECK constraints + 274 varchar→TEXT + 5 timestamptz), P3 (64 FK indexes + 182 timestamptz + 6 partial indexes + 7 unique constraints). Updated tech debt section. |
