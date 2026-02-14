# HireLoop — Current Architecture

**Last Audited:** Feb 14, 2026

## Overview

HireLoop is an AI-native hiring platform with dual frontend (React SPA + legacy HTML), Express.js backend, and Neon PostgreSQL. 351 API endpoints, 75+ tables, 47 migrations. Deployed on Render.

**Live URL:** https://hireloop-vzvw.polsia.app

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
| `/candidate/ai-coaching` | `pages/candidate/ai-coaching.tsx` | `/api/interviews/practice/*`, `/api/interviews/mock/*` |
| `/candidate/applications` | `pages/candidate/applications.tsx` | `/api/candidate/applications` |
| `/candidate/offers` | `pages/candidate/offers.tsx` | `/api/candidate/offers` |
| `/candidate/omniscore` | `pages/candidate/omniscore.tsx` | `/api/omniscore` |
| `/candidate/documents` | `pages/placeholder.tsx` | (placeholder) |
| `/candidate/onboarding` | `pages/candidate/onboarding.tsx` | `/api/onboarding` |
| `/candidate/payroll` | `pages/candidate/payroll.tsx` | `/api/payroll` |

**Support files (not routed pages):**
- `pages/candidate/coaching-types.ts` — TypeScript types extracted from ai-coaching.tsx
- `pages/candidate/coaching-utils.tsx` — Utility functions extracted from ai-coaching.tsx
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

#### Admin (2 pages)
| Route | File |
|-------|------|
| `/admin/login` | `pages/admin/login.tsx` |
| `/admin/ai-health` | `pages/admin/ai-health.tsx` |

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
| `routes/interviews.js` | 3190 | 44 | Interview scheduling, AI coaching, mock interviews, video analysis |
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
| `server.js` | 988 | 26 | Health, AI health dashboard (14), admin metrics |

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
| `lib/ai-provider.js` | 2287 | Multi-provider LLM with circuit breaker, fallback chains |
| `lib/polsia-ai.js` | 1304 | AI function wrappers (chat, vision, TTS, ASR, analysis) |
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

## Database (75+ tables, 47 migrations)

### Core Domains
- **Users & Auth:** users, oauth_refresh_tokens, sessions
- **Candidates:** candidate_profiles, candidate_skills, candidate_experience, candidate_education
- **Jobs:** jobs, applications, screening_questions
- **Interviews:** interviews, interview_questions, mock_interview_sessions, mock_conversation_turns
- **Assessments:** assessments, assessment_questions, assessment_responses, job_assessments
- **Practice:** practice_sessions (video + text practice data)
- **Scoring:** omniscores, trustscores
- **Onboarding:** onboarding_documents, onboarding_plans, company_policies, i9_forms, w4_forms
- **Payroll:** payroll_runs, paychecks, tax_configs
- **Compliance:** bias_audit_logs, consent_records, data_access_requests
- **AI:** ai_call_log, ai_health_snapshots, prompt_registry, ab_tests
- **Matching:** candidate_embeddings, job_embeddings
- **Communication:** message_templates, communication_logs
- **Memory:** smart_profile_memory, data_reuse_suggestions

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

## Problem Areas

### 1. Monolith Files
- **`ai-coaching.tsx` (4044 lines):** Quick Practice AND Mock Interview crammed together. Types + utilities extracted to `coaching-types.ts` (184 lines) and `coaching-utils.tsx` (67 lines) on Feb 14. Full component split pending.
- **`ai-provider.js` (2287 lines):** Provider abstraction + 15+ provider implementations + circuit breaker logic. Largest backend file.
- **`interviews.js` (3190 lines):** Interview scheduling, AI coaching, mock interviews, video analysis — 44 endpoints in a single route file.
- **`onboarding.js` (3119 lines):** Document generation, I-9, W-4, policies, benefits — 43 endpoints.
- **`polsia-ai.js` (1304 lines):** AI function wrappers growing with each new feature.
- **`server.js` (988 lines):** Express setup + 26 AI health endpoints + admin metrics all in one file.

### 2. Tight Coupling
- Quick Practice and Mock Interview share state variables in the same component
- ~~AI provider errors cascade into null-safety crashes~~ **FIXED Feb 14** — allSettled checks now validate `value != null`
- Legacy HTML pages and React SPA co-exist, causing route conflicts

### 3. Known Tech Debt
- 42 legacy HTML pages still served alongside React SPA
- ~~`JSON.parse()` of AI responses can return null~~ **FIXED Feb 14** — `generateInterviewCoaching` and `analyzeInterviewResponse` now validate parsed results are objects
- 43% of mock_interview_sessions stuck in_progress (zombie records)
- 5 tables have company_id FK pointing to users instead of companies
- 3 placeholder routes (candidate/documents, recruiter/candidates, recruiter/analytics) with no real implementation
- No E2E test suite
- No TypeScript on backend (pure JS)

---

## Changelog

| Date | Change |
|------|--------|
| Feb 14, 2026 | **Audit & corrections:** Fixed page count (23→36 files/42 routes), added 8 missing candidate routes, 5 missing recruiter routes, 6 missing utility/debug routes. Fixed endpoint count (322→351). Verified migration count (47 correct — 44 numbered sequences with 3 duplicates at 003, 005, 040). Fixed HTML page count (39→42). Corrected all service/lib line counts (many were dramatically wrong — e.g. ai-provider.js was listed as 930 lines but is actually 2287). Added missing services (auditLogger.js, memory-service.js). Moved memory-service.js from lib/ to services/ where it actually lives. Added missing lib (self-hosted-audio.js). Added missing feature component (ai-onboarding-recruiter.tsx). Added route line counts. Identified additional monolith files (interviews.js, onboarding.js, polsia-ai.js). |
