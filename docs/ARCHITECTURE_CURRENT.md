# HireLoop — Current Architecture (Feb 2026)

## Overview

HireLoop is an AI-native hiring platform with dual frontend (React SPA + legacy HTML), Express.js backend, and Neon PostgreSQL. 322 API endpoints, 75+ tables, 47 migrations. Deployed on Render.

**Live URL:** https://hireloop-vzvw.polsia.app

---

## Frontend (client/src/)

### React Pages (23 pages)

#### Candidate (12 pages)
| Route | File | API Endpoints Used |
|-------|------|--------------------|
| `/candidate` | `pages/candidate/dashboard.tsx` | `/api/candidate/profile`, `/api/jobs` |
| `/candidate/profile` | `pages/candidate/profile.tsx` | `/api/candidate/profile`, `/api/candidate/skills` |
| `/candidate/jobs` | `pages/candidate/jobs.tsx` | `/api/jobs`, `/api/matching/recommendations` |
| `/candidate/jobs/:id` | `pages/candidate/job-detail.tsx` | `/api/jobs/:id`, `/api/candidate/applications` |
| `/candidate/assessments` | `pages/candidate/assessments.tsx` | `/api/assessments` |
| `/candidate/assessments/:id/take` | `pages/candidate/assessment-take.tsx` | `/api/assessments/:id` |
| `/candidate/interviews` | `pages/candidate/interviews.tsx` | `/api/interviews` |
| `/candidate/ai-coaching` | `pages/candidate/ai-coaching.tsx` | `/api/interviews/practice/*`, `/api/interviews/mock/*` |
| `/candidate/applications` | `pages/candidate/applications.tsx` | `/api/candidate/applications` |
| `/candidate/offers` | `pages/candidate/offers.tsx` | `/api/candidate/offers` |
| `/candidate/omniscore` | `pages/candidate/omniscore.tsx` | `/api/omniscore` |
| `/candidate/onboarding` | `pages/candidate/onboarding.tsx` | `/api/onboarding` |
| `/candidate/payroll` | `pages/candidate/payroll.tsx` | `/api/payroll` |

#### Recruiter (11 pages)
| Route | File | API Endpoints Used |
|-------|------|--------------------|
| `/recruiter` | `pages/recruiter/dashboard.tsx` | `/api/recruiter/dashboard` |
| `/recruiter/jobs` | `pages/recruiter/jobs.tsx` | `/api/jobs` |
| `/recruiter/jobs/new` | `pages/recruiter/job-form.tsx` | `/api/jobs`, `/api/recruiter/job-optimizer` |
| `/recruiter/jobs/:id/applicants` | `pages/recruiter/job-applicants.tsx` | `/api/recruiter/jobs/:id/applicants` |
| `/recruiter/applications` | `pages/recruiter/applications.tsx` | `/api/recruiter/applications` |
| `/recruiter/interviews` | `pages/recruiter/interviews.tsx` | `/api/interviews` |
| `/recruiter/assessments` | `pages/recruiter/assessments.tsx` | `/api/assessments` |
| `/recruiter/offers` | `pages/recruiter/offers.tsx` | `/api/recruiter/offers` |
| `/recruiter/onboarding` | `pages/recruiter/onboarding.tsx` | `/api/onboarding` |
| `/recruiter/payroll` | `pages/recruiter/payroll.tsx` | `/api/payroll` |
| `/recruiter/company` | `pages/recruiter/company.tsx` | `/api/company` |
| `/recruiter/omniscore` | `pages/recruiter/omniscore.tsx` | `/api/omniscore` |

#### Admin (2 pages)
| Route | File |
|-------|------|
| `/admin/login` | `pages/admin/login.tsx` |
| `/admin/health` | `pages/admin/ai-health.tsx` |

#### Auth & Other
| Route | File |
|-------|------|
| `/login` | `pages/login.tsx` |
| `/register` | `pages/register.tsx` |
| `/` | `pages/landing.tsx` |

### Shared Components
- **UI (components/ui/):** avatar, badge, button, card, dialog, input, label, select, tabs, textarea
- **Layout (components/layout/):** dashboard-layout, header, sidebar
- **Feature:** admin-auth-guard, ai-onboarding-dashboard, error-boundary
- **Context:** auth-context.tsx (authentication state)
- **Lib:** api.ts (Axios client), utils.ts

### Legacy Frontend (public/)
39 HTML pages still served. Major ones: recruiter-*.html (11), candidate-*.html (8), assessment-*.html (4). Gradually being replaced by React SPA.

---

## Backend (server.js + routes/ + services/ + lib/)

### API Routes (19 files, 322 endpoints)

| Route File | Count | Domain |
|-----------|-------|--------|
| `routes/interviews.js` | 44 | Interview scheduling, AI coaching, mock interviews, video analysis |
| `routes/candidate.js` | 46 | Candidate profile, resume, skills, experience, education |
| `routes/recruiter.js` | 43 | Dashboard, analytics, job optimization, candidate fit |
| `routes/onboarding.js` | 43 | Document generation, I-9, W-4, policies, benefits |
| `routes/assessments.js` | 22 | Skill assessments, grading, AI feedback |
| `routes/compliance.js` | 16 | Bias detection, consent, audit, fairness |
| `routes/payroll.js` | 16 | Payroll runs, paychecks, tax calculations |
| `routes/memory.js` | 14 | Smart profile memory, autofill |
| `routes/auth.js` | 13 | Registration, login, OAuth, refresh tokens |
| `routes/communications.js` | 13 | Message templates, bulk messaging |
| `routes/omniscore.js` | 13 | Candidate/company scoring |
| `routes/documents.js` | 8 | Upload, OCR, fraud detection |
| `routes/company.js` | 7 | Company profile, settings |
| `routes/jobs.js` | 6 | Job CRUD |
| `routes/matching.js` | 6 | Job/candidate matching, ranking |
| `routes/trustscore.js` | 6 | Company trust scoring |
| `routes/countries.js` | 4 | Country config, tax/labor laws |
| `routes/admin.js` | 3 | Admin auth |
| `routes/analytics.js` | 2 | Event logging |
| `server.js` | 26 | Health, AI health dashboard (14), admin metrics |

### Services (14 files)

| Service | Lines | Purpose |
|---------|-------|---------|
| `services/interview-ai.js` | 475 | Question gen, response analysis, coaching |
| `services/communication-generator.js` | 430 | Email/message templates |
| `services/document-verification.js` | 410 | OCR, fraud detection, authenticity |
| `services/job-optimizer.js` | 355 | JD optimization, salary insights |
| `services/country-config.js` | 300 | Tax config per country |
| `services/trustscore.js` | 295 | Company trust scoring |
| `services/omniscore.js` | 289 | Multi-factor candidate scoring |
| `services/payroll-calculator.js` | 260 | Tax calculations, deductions |
| `services/scoreExplainer.js` | 227 | Score transparency reports |
| `services/matching-engine.js` | 211 | Semantic job/candidate matching |
| `services/autofill-service.js` | 205 | Smart data reuse |
| `services/biasDetection.js` | 169 | Fairness scoring |

### Core Libraries (lib/)

| Library | Lines | Purpose |
|---------|-------|---------|
| `lib/ai-provider.js` | 930 | Multi-provider LLM with circuit breaker, fallback chains |
| `lib/polsia-ai.js` | 550 | AI function wrappers (chat, vision, TTS, ASR, analysis) |
| `lib/token-budget.js` | 287 | Token tracking, budget enforcement |
| `lib/ai-call-logger.js` | 190 | AI call logging, usage summary |
| `lib/activity-logger.js` | 164 | Request tracking for admin feed |
| `lib/auth.js` | 130 | JWT handling, authorization middleware |
| `lib/metrics-collector.js` | 116 | Request/latency/error tracking |
| `lib/memory-service.js` | 160 | Profile caching |
| `lib/db.js` | 50 | PostgreSQL pool (Neon) |

### AI Provider Architecture
- **Primary:** Polsia OpenAI proxy (routes to Anthropic Claude, GPT-4o, Google Gemini)
- **Fallback chain:** OpenAI → NIM models (Llama, Nemotron, GPT-OSS) → Groq → Cerebras
- **Vision chain:** OpenAI GPT-4o → NIM Cosmos Reason → NIM Nemotron Nano VL
- **TTS:** Piper (self-hosted) → browser fallback
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
- **`ai-coaching.tsx` (4000+ lines):** Quick Practice AND Mock Interview crammed together. Types + utilities extracted to `coaching-types.ts` and `coaching-utils.tsx` (Feb 14). Full component split pending.
- **`server.js` (989 lines):** Express setup + 26 AI health endpoints + admin metrics all in one file.
- **`ai-provider.js` (930 lines):** Provider abstraction + 15+ provider implementations + circuit breaker logic.

### 2. Tight Coupling
- Quick Practice and Mock Interview share state variables in the same component
- ~~AI provider errors cascade into null-safety crashes~~ **FIXED Feb 14** — allSettled checks now validate `value != null`
- Legacy HTML pages and React SPA co-exist, causing route conflicts

### 3. Known Tech Debt
- 39 legacy HTML pages still served alongside React SPA
- ~~`JSON.parse()` of AI responses can return null~~ **FIXED Feb 14** — `generateInterviewCoaching` and `analyzeInterviewResponse` now validate parsed results are objects
- 43% of mock_interview_sessions stuck in_progress (zombie records)
- 5 tables have company_id FK pointing to users instead of companies
- No E2E test suite
- No TypeScript on backend (pure JS)
