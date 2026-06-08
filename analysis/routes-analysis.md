# Rekrut AI — Backend Routes Architecture Analysis

> **Generated:** 2026-06-05 | **Scope:** All 21 route files under `routes/` + mounting structure in `server.js`

---

## 1. Route Mounting Structure (server.js)

Routes are mounted under the `/api` prefix with the following mappings:

| Base Path | Route File | Mount Order Note |
|-----------|-----------|-----------------|
| `/api/admin` | `admin.js` | |
| `/api/auth` | `auth.js` | |
| `/api/jobs` | `jobs.js` | |
| `/api/interviews` | `quick-practice.js` | **Must be BEFORE interview routes** (#32717) |
| `/api/interviews` | `interviews.js` | Mock Interview + video analysis |
| `/api/omniscore` | `omniscore.js` | |
| `/api/candidate/omniscore` | `omniscore.js` | Duplicated mount |
| `/api/recruiter/omniscore` | `omniscore.js` | Duplicated mount |
| `/api/candidate` | `candidate.js` | |
| `/api/assessments` | `assessments.js` | |
| `/api/company` | `company.js` | |
| `/api/trustscore` | `trustscore.js` | |
| `/api/recruiter` | `recruiter.js` | |
| `/api/matching` | `matching.js` | |
| `/api/documents` | `documents.js` | |
| `/api/payroll` | `payroll.js` | |
| `/api/compliance` | `compliance.js` | |
| `/api/onboarding` | `onboarding.js` | |
| `/api/analytics` | `analytics.js` | |
| `/api/countries` | `countries.js` | |
| `/api/memory` | `memory.js` | |
| `/api/communications` | `communications.js` | |
| `/api/notifications` | `notifications.js` | |
| `/api/billing` | `billing.js` | |
| `/api/screening` | `screening.js` | |

**⚠️ Note:** `quick-practice.js` and `interviews.js` are both mounted at `/api/interviews`. Quick-practice routes must be mounted first because they are isolated (no overlapping path prefixes). The `omniscore.js` router is mounted at **three different paths** (`/api/omniscore`, `/api/candidate/omniscore`, `/api/recruiter/omniscore`), allowing the same router to handle requests from different user contexts.

---

## 2. Per-File Route Analysis

---

### `admin.js` — Admin Panel Auth & Revenue Analytics

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| POST | `/login` | Rate limit (distributed) | Admin login with bcrypt + session |
| GET | `/me` | — | Check admin auth status (session or JWT bridge) |
| GET | `/revenue` | `requireAdmin` | Revenue funnel metrics (page views, signup, checkout) |
| POST | `/bridge` | — | Auto-elevate JWT admin users into admin session |
| POST | `/logout` | — | Clear admin session |

**Key Imports:** `express`, `bcryptjs`, `crypto`, `pool` (db), `activity-logger`, `auth.verifyToken`, `distributed-rate-limiter`

**Notable Patterns:**
- **Dual auth path:** `requireAdmin` middleware supports both (1) direct admin session login and (2) JWT bridge — any user with `role === 'admin'` in their JWT gets auto-elevated to admin session.
- **Rate limiting:** Uses `distributedRateLimiter` (PostgreSQL-backed) for login attempts — 5 attempts per 15 min window.
- **Development credential generation:** If `ADMIN_PASSWORD` env var is missing in dev, generates a random password and writes it to `.admin-credentials` with `0o600` permissions.
- **Bug:** `loginAttempts.delete(ip)` on line ~249 references a `loginAttempts` Map that is never defined in this file (should be `distributedRateLimiter` reset).

---

### `analytics.js` — Event Tracking & Dashboard

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| POST | `/events` | `optionalAuth` | Log client-side events (page views, interactions) |
| GET | `/dashboard` | `authMiddleware` | Full analytics dashboard (page views, funnels, engagement) |

**Key Imports:** `express`, `pool`, `optionalAuth`, `authMiddleware`

**Notable Patterns:**
- Events table captures `event_type`, `user_id`, `session_id`, `metadata` JSON.
- Default date range: last 30 days.
- Computes conversion rates (landing → signup, pricing → checkout) directly in SQL + JS.
- Same funnel logic as `/admin/revenue` but accessible to authenticated recruiters.

---

### `assessments.js` — Skill Assessments (AI-Powered Adaptive Testing)

**Endpoints (20+):**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| GET | `/available` | `authMiddleware` | Skill catalog with user's assessment history overlay |
| GET | `/results` | `authMiddleware` | Past assessment results |
| POST | `/start` | `authMiddleware` + `rateLimits.ai` | Start new adaptive assessment (AI generates Q1) |
| POST | `/answer` | `authMiddleware` | Submit answer, get next question (adaptive difficulty) |
| POST | `/event` | `authMiddleware` | Anti-cheat events (tab switch, copy/paste) |
| GET | `/session/:sessionId/current` | `authMiddleware` | Current question in active session |
| GET | `/session/:sessionId` | `authMiddleware` | Full session details |
| GET | `/candidate/:candidateId` | `authMiddleware` | Candidate assessment history (recruiter view) |
| GET | `/recruiter/all` | `authMiddleware` | All assessments for recruiter's company |
| GET | `/recruiter/detail/:assessmentId` | `authMiddleware` | Detailed assessment breakdown |
| GET | `/recruiter/catalog` | `authMiddleware` | Pre-built skill catalog |
| POST | `/generate` | `authMiddleware` + `rateLimits.ai` | AI-generate assessment questions for a skill |
| GET | `/job/:jobId` | `authMiddleware` | Job-specific assessment data |
| PUT | `/job-assessment/:id/question/:qId` | `authMiddleware` | Edit job assessment question |
| POST | `/job-assessment/:id/publish` | `authMiddleware` | Publish job assessment |
| POST | `/job-assessment/:id/start` | `authMiddleware` | Start job-specific assessment |
| POST | `/job-assessment/:id/answer` | `authMiddleware` | Submit job assessment answer |
| POST | `/job-assessment/:id/score` | `authMiddleware` | Score completed job assessment |
| GET | `/job-assessment/:id/results` | `authMiddleware` | Job assessment results |
| GET | `/job-assessments/all` | `authMiddleware` | List all job assessments |
| POST | `/job-assessment/:id/converse` | `authMiddleware` + `rateLimits.ai` | Conversational AI follow-up during assessment |
| POST | `/job-assessment/:id/event` | `authMiddleware` | Anti-cheat event logging |

**Key Imports:** `express`, `pool`, `authMiddleware`, `chat`/`handleAIError` (polsia-ai), `omniscoreService`, `rateLimits`

**Notable Patterns:**
- **Largest route file** — contains the most complex AI-driven assessment logic.
- **Adaptive difficulty engine:** Increases difficulty (1-5) on correct answers, decreases on wrong. Tracks time anomalies, tab switches, copy-paste attempts for anti-cheat.
- **Two assessment types:** (1) General skill assessments (candidate-driven) and (2) Job-specific assessments (recruiter-configured).
- **AI rate limiting:** `rateLimits.ai` on start, generate, and converse endpoints.
- **Transaction safety:** Uses `pool.connect()` + `BEGIN/COMMIT/ROLLBACK` for all DB mutations.
- **Short answer evaluation:** Uses AI (`chat`) to evaluate free-text answers with rubric-based scoring.
- **Conversational follow-ups:** AI asks up to 3 probing follow-up questions per assessment item.
- **Hardcoded skill catalog:** 16 pre-defined skills in `SKILL_CATALOG` array. Auto-creates skills not in catalog when user starts assessment.

---

### `auth.js` — Authentication & OAuth

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| POST | `/register` | `rateLimits.strict` | User registration (candidate/recruiter) |
| POST | `/login` | `rateLimits.strict` | Login with JWT + refresh tokens |
| POST | `/refresh` | — | Refresh access token |
| GET | `/me` | `authMiddleware` | Get current user profile |
| POST | `/logout` | `authMiddleware` | Logout (invalidate refresh token) |
| POST | `/logout-all` | `authMiddleware` | Logout all sessions |
| GET | `/google/url` | — | Get Google OAuth URL |
| GET | `/google/callback` | — | Google OAuth callback |
| GET | `/linkedin/url` | — | Get LinkedIn OAuth URL |
| GET | `/linkedin/callback` | — | LinkedIn OAuth callback |
| GET | `/oauth/status` | — | Check OAuth connection status |
| GET | `/oauth/connections` | `authMiddleware` | List user's connected OAuth accounts |
| GET | `/verify-payment` | `authMiddleware` | Verify payment/subscription status |
| POST | `/forgot-password` | `rateLimits.strict` | Send password reset email |
| POST | `/reset-password` | `rateLimits.strict` | Reset password with token |

**Key Imports:** `express`, `bcryptjs`, `crypto`, `fs`, `nodemailer`, `pool`, `generateToken`, `generateRefreshToken`, `authMiddleware`, `rateLimits`, `distributedRateLimiter`

**Notable Patterns:**
- **JWT + Refresh Token dual system:** Short-lived access tokens + long-lived refresh tokens stored in DB.
- **OAuth support:** Google and LinkedIn OAuth flows with URL generation and callback handling.
- **Strict rate limiting:** `rateLimits.strict` on register, login, forgot-password, reset-password.
- **Role-based registration:** Supports `candidate`, `recruiter`, `hiring_manager`, `admin`, `employer` roles.
- **Company association:** Recruiter registrations auto-create or link to a company.
- **Email verification:** Sends verification emails via `nodemailer` with token-based verification.

---

### `billing.js` — Stripe Payment Integration

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| GET | `/plans` | — | Get available pricing plans |
| POST | `/checkout-session` | `optionalAuth` | Create Stripe checkout session |
| POST | `/confirm-session` | `optionalAuth` | Confirm payment and update subscription |

**Key Imports:** `express`, `node-fetch`, `pool`, `optionalAuth`

**Notable Patterns:**
- Stripe integration via `node-fetch` (REST API calls to Stripe).
- Plans are hardcoded in the file (not fetched from DB).
- Supports both authenticated and anonymous checkout flows.
- Updates `company_subscriptions` table on successful payment.

---

### `candidate.js` — Candidate Profile & Job Application

**Endpoints (25+):**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| GET | `/profile` | `authMiddleware` | Get candidate profile |
| PUT | `/profile` | `authMiddleware` | Update candidate profile |
| POST | `/profile/photo` | `authMiddleware` + `upload` | Upload profile photo |
| POST | `/resume/upload` | `authMiddleware` + `upload` | Upload resume (PDF/DOCX parsing) |
| POST | `/resume/apply` | `authMiddleware` | AI-powered resume parsing + job application |
| POST | `/experience` | `authMiddleware` | Add work experience |
| PUT | `/experience/:id` | `authMiddleware` | Update experience |
| DELETE | `/experience/:id` | `authMiddleware` | Delete experience |
| POST | `/education` | `authMiddleware` | Add education |
| PUT | `/education/:id` | `authMiddleware` | Update education |
| DELETE | `/education/:id` | `authMiddleware` | Delete education |
| GET | `/skills` | `authMiddleware` | Get candidate skills |
| POST | `/skills` | `authMiddleware` | Add skill |
| PUT | `/skills/:id` | `authMiddleware` | Update skill |
| DELETE | `/skills/:id` | `authMiddleware` | Delete skill |
| GET | `/assessments` | `authMiddleware` | Get assessment history |
| POST | `/assessments/start` | `authMiddleware` | Start assessment |
| POST | `/assessments/:id/submit` | `authMiddleware` | Submit assessment |
| POST | `/projects` | `authMiddleware` | Add project |
| PUT | `/projects/:id` | `authMiddleware` | Update project |
| DELETE | `/projects/:id` | `authMiddleware` | Delete project |
| GET | `/jobs/recommended` | `authMiddleware` | AI-recommended jobs |
| POST | `/jobs/:jobId/save` | `authMiddleware` | Save job |
| DELETE | `/jobs/:jobId/save` | `authMiddleware` | Unsave job |
| GET | `/jobs/saved` | `authMiddleware` | List saved jobs |
| POST | `/jobs/:jobId/apply` | `authMiddleware` | Apply to job |
| GET | `/applications` | `authMiddleware` | List applications |
| PUT | `/applications/:id/withdraw` | `authMiddleware` | Withdraw application |
| POST | `/coaching` | `authMiddleware` | AI career coaching |
| GET | `/dashboard/stats` | `authMiddleware` | Candidate dashboard stats |

**Key Imports:** `express`, `node-fetch`, `FormData`, `multer`, `pdf-parse`, `mammoth`, `authMiddleware`, `pool`, `chat` (polsia-ai), `omniscoreService`, `rateLimits`, `matchingEngine`

**Notable Patterns:**
- **Resume parsing:** Uses `pdf-parse` for PDFs and `mammoth` for DOCX files to extract text.
- **AI resume analysis:** Calls `chat` (polsia-ai) to extract structured data from resume text.
- **AI job recommendations:** Uses `matchingEngine` (if available) to recommend jobs based on profile.
- **AI coaching:** Multiple AI-powered endpoints (interview prep, career advice, salary negotiation) all using `chat` with different prompts.
- **Omniscore integration:** Updates omniscore on profile changes, resume uploads, and applications.
- **File upload:** Multer with disk storage for profile photos and resumes.
- **Deferred imports:** Several `chat` imports are done inside route handlers (not at top), likely to avoid circular dependency issues.

---

### `communications.js` — Recruiter-Candidate Communication

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| POST | `/generate` | `authMiddleware` + `requireRecruiter` | AI generate email/message |
| POST | `/send` | `authMiddleware` + `requireRecruiter` | Send email/SMS to candidate |
| POST | `/draft` | `authMiddleware` + `requireRecruiter` | Save draft message |
| POST | `/pipeline` | `authMiddleware` + `requireRecruiter` | Pipeline-stage communication |
| GET | `/history/:candidateId` | `authMiddleware` + `requireRecruiter` | Communication history |
| GET | `/` | `authMiddleware` + `requireRecruiter` | List all communications |
| POST | `/bulk` | `authMiddleware` + `requireRecruiter` | Bulk send messages |
| POST | `/sequences` | `authMiddleware` + `requireRecruiter` | Create communication sequence |
| GET | `/sequences` | `authMiddleware` + `requireRecruiter` | List sequences |
| POST | `/sequences/:id/enroll` | `authMiddleware` + `requireRecruiter` | Enroll candidate in sequence |
| GET | `/templates` | `authMiddleware` + `requireRecruiter` | List templates |
| POST | `/templates` | `authMiddleware` + `requireRecruiter` | Create template |
| GET | `/analytics` | `authMiddleware` + `requireRecruiter` | Communication analytics |

**Key Imports:** `express`, `pool`, `authMiddleware`, `communication-generator`

**Notable Patterns:**
- **Recruiter-only:** All endpoints protected by `requireRecruiter` middleware.
- **Communication sequences:** Drip campaigns for candidate engagement (enrollment-based).
- **Bulk messaging:** Supports sending to multiple candidates with personalization tokens.
- **Template system:** Pre-built and custom templates for common communication scenarios.
- **Analytics:** Open rates, response rates, time-to-response tracking.

---

### `company.js` — Company Management

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| POST | `/register` | — | Company registration (with admin user) |
| GET | `/profile` | `authMiddleware` | Get company profile |
| PUT | `/profile` | `authMiddleware` | Update company profile |
| GET | `/:slug` | `optionalAuth` | Public company profile |
| POST | `/verify` | `authMiddleware` | Verify company (email domain check) |
| GET | `/team/members` | `authMiddleware` | List team members |
| POST | `/team/invite` | `authMiddleware` | Invite team member |

**Key Imports:** `express`, `bcryptjs`, `pool`, `generateToken`, `generateRefreshToken`, `authMiddleware`, `optionalAuth`, `trustscoreService`

**Notable Patterns:**
- **Company + Admin registration:** Single endpoint creates company + admin user atomically.
- **Trustscore integration:** Company trustscore is calculated/updated on profile changes.
- **Public profiles:** Company profile accessible via slug without auth (with optional auth for personalized view).
- **Team management:** Invite flow with email sending.

---

### `compliance.js` — GDPR, Bias & Fairness Auditing

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| POST | `/gdpr/export` | `authMiddleware` | Export all user data (GDPR) |
| POST | `/gdpr/delete` | `authMiddleware` | Delete all user data (GDPR right to erasure) |
| POST | `/gdpr/consent` | `authMiddleware` | Record consent |
| GET | `/gdpr/consents/:userId` | `authMiddleware` | List consent history |
| POST | `/bias/analyze` | `authMiddleware` | Analyze job description for bias |
| GET | `/bias/reports` | `authMiddleware` | Bias analysis reports |
| POST | `/fairness/audit` | `authMiddleware` | Run fairness audit on hiring data |
| GET | `/fairness/audits` | `authMiddleware` | List fairness audits |
| POST | `/appeal` | `authMiddleware` | Submit algorithmic decision appeal |
| GET | `/appeal/:userId` | `authMiddleware` | View appeal status |
| GET | `/audit/logs` | `authMiddleware` | Audit log query |
| POST | `/audit/export` | `authMiddleware` | Export audit logs |
| GET | `/retention/policies` | `authMiddleware` | Data retention policies |
| PUT | `/retention/policies/:id` | `authMiddleware` | Update retention policy |
| GET | `/explain/omniscore/:userId` | `authMiddleware` | Explain omniscore calculation |
| GET | `/explain/decision/:applicationId` | `authMiddleware` | Explain hiring decision |

**Key Imports:** `express`, `pool`, `authMiddleware`, `AuditLogger`, `BiasDetection`, `ScoreExplainer`

**Notable Patterns:**
- **GDPR compliance:** Full data export (JSON) and deletion (cascade across all tables).
- **XAI (Explainable AI):** Score explainer breaks down omniscore and hiring decisions into human-readable factors.
- **Bias detection:** Analyzes job descriptions for gendered, racial, or ableist language.
- **Fairness audits:** Statistical analysis of hiring outcomes across demographic groups.
- **Audit logging:** Immutable audit trail for compliance purposes.
- **Algorithmic appeals:** Candidates can appeal automated decisions with human review workflow.

---

### `countries.js` — Country Configuration & Localization

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| GET | `/` | — | List all supported countries |
| GET | `/:code` | — | Get country details |
| GET | `/:code/onboarding` | — | Country-specific onboarding requirements |
| GET | `/:code/currency` | — | Country currency info |

**Key Imports:** `express`, `authMiddleware`, `optionalAuth`, `countryConfig`

**Notable Patterns:**
- Static country data served from `countryConfig` service.
- Used by onboarding, payroll, and compliance modules for country-specific rules.

---

### `documents.js` — Document Upload & Verification

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| POST | `/upload` | `authMiddleware` + `upload` | Upload document |
| GET | `/` | `authMiddleware` | List documents |
| GET | `/:id` | `authMiddleware` | Get document details |
| GET | `/:id/verification` | `authMiddleware` | Document verification status |
| GET | `/credentials/list` | `authMiddleware` | List credential documents |
| GET | `/:id/access-log` | `authMiddleware` | Document access audit log |
| DELETE | `/:id` | `authMiddleware` | Delete document |
| GET | `/stats/summary` | `authMiddleware` | Document stats |

**Key Imports:** `express`, `multer`, `node-fetch`, `FormData`, `pool`, `authMiddleware`, `document-verification`

**Notable Patterns:**
- **Document verification:** Uses external verification service (identity, credentials, background checks).
- **Access logging:** Every document access is logged for compliance.
- **File upload:** Multer with configurable storage.
- **Credential tracking:** Special handling for credential/qualification documents.

---

### `interviews.js` — AI Interviews, Mock Interviews & Video Analysis

**Endpoints (30+):**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| POST | `/start` | `authMiddleware` + `rateLimits.ai` | Start AI interview session |
| POST | `/:id/respond` | `authMiddleware` | Submit interview response |
| POST | `/:id/complete` | `authMiddleware` | Complete interview |
| GET | `/history` | `authMiddleware` | Interview history |
| GET | `/:id` | `authMiddleware` | Interview details |
| POST | `/upload-video` | `authMiddleware` + `rateLimits.ai` + `upload` | Upload video response |
| GET | `/stats/summary` | `authMiddleware` | Interview stats |
| POST | `/save-analysis` | `authMiddleware` | Save AI analysis |
| GET | `/:id/analysis` | `authMiddleware` | Get interview analysis |
| POST | `/mock/start` | `authMiddleware` + `rateLimits.ai` | Start mock interview |
| POST | `/mock/:sessionId/respond` | `authMiddleware` + `rateLimits.ai` | Mock interview response |
| POST | `/mock/:sessionId/end` | `authMiddleware` | End mock interview |
| GET | `/mock/sessions` | `authMiddleware` | Mock interview session history |
| GET | `/mock/sessions/:id` | `authMiddleware` | Session details |
| GET | `/mock/question-bank` | `authMiddleware` | Question bank |
| GET | `/mock/question-bank/browse` | `authMiddleware` | Browse question bank |
| GET | `/mock/sessions/:id/feedback` | `authMiddleware` | Per-session feedback |
| GET | `/mock/sessions/:id/per-question` | `authMiddleware` | Per-question analysis |
| GET | `/mock/debug` | `authMiddleware` | Debug session data |
| POST | `/mock/analyze-frame` | `authMiddleware` + `rateLimits.ai` | Analyze video frame (real-time) |
| POST | `/mock/tts` | `authMiddleware` | Text-to-speech for interview |
| POST | `/mock/:sessionId/voice-respond` | `authMiddleware` + `upload` | Voice response (audio upload) |
| POST | `/suggest-slots` | `authMiddleware` | Suggest interview time slots |
| POST | `/schedule` | `authMiddleware` | Schedule interview |
| PUT | `/reschedule` | `authMiddleware` | Reschedule interview |
| POST | `/scheduling-preferences` | `authMiddleware` | Save scheduling preferences |
| GET | `/scheduling-preferences` | `authMiddleware` | Get scheduling preferences |
| POST | `/screening/create-template` | `authMiddleware` | Create screening template |
| GET | `/screening/templates` | `authMiddleware` | List screening templates |
| POST | `/screening/send` | `authMiddleware` | Send screening interview |

**Key Imports:** `express`, `pool`, `authMiddleware`, `polsia-ai` (many functions), `crypto`, `omniscoreService`, `multer`, `node-fetch`, `FormData`, `rateLimits`, `interviewAI`

**Notable Patterns:**
- **Largest route file** by endpoint count (30+ endpoints).
- **Real-time video analysis:** `analyze-frame` endpoint for live video interview analysis (uses R2 upload).
- **Voice interviews:** Supports audio upload + Whisper transcription + TTS for voice-based mock interviews.
- **Mock interview engine:** Full AI-driven mock interview with per-question feedback, overall scoring, and coaching.
- **Interview scheduling:** Calendar integration with time slot suggestions.
- **AI rate limiting:** Multiple endpoints hit `rateLimits.ai` due to heavy AI usage.
- **Question bank:** Pre-built and AI-generated question bank for mock interviews.
- **Video storage:** Uploads video files to Cloudflare R2 via `uploadFrameToR2`.

---

### `jobs.js` — Job Postings

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| GET | `/` | `optionalAuth` | List jobs (public with optional personalization) |
| GET | `/search` | `optionalAuth` | Search jobs |
| GET | `/:id` | `optionalAuth` | Job details |
| POST | `/` | `authMiddleware` + `requireRole(...)` | Create job |
| PUT | `/:id` | `authMiddleware` | Update job |
| DELETE | `/:id` | `authMiddleware` | Delete job |

**Key Imports:** `express`, `pool`, `authMiddleware`, `optionalAuth`, `requireRole`

**Notable Patterns:**
- **Public job listing:** Jobs are publicly viewable with optional auth for personalized features (saved, applied status).
- **Role-based creation:** Only `hiring_manager`, `admin`, `recruiter`, `employer` can create jobs.
- **Country-specific rules:** Uses `countryConfig` for location-based salary, compliance, and formatting rules.
- **Simple CRUD:** Relatively straightforward job posting management.

---

### `matching.js` — AI Candidate-Job Matching

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| GET | `/recommendations` | `authMiddleware` | Get job recommendations for candidate |
| GET | `/candidates/:jobId` | `authMiddleware` + `requireRole(...)` | Get matched candidates for a job |
| GET | `/explain/:candidateId/:jobId` | `authMiddleware` | Explain match score |
| POST | `/update-profile-embedding` | `authMiddleware` | Trigger profile embedding update |
| POST | `/update-job-embedding/:jobId` | `authMiddleware` + `requireRole(...)` | Trigger job embedding update |
| GET | `/stats` | `authMiddleware` | Matching statistics |

**Key Imports:** `express`, `authMiddleware`, `requireRole`, `matching-engine`

**Notable Patterns:**
- **Vector embeddings:** Uses `matching-engine` service for vector-based semantic matching.
- **Explainability:** Match explanations break down why a candidate matches a job (skills, experience, location).
- **Role-restricted:** Recruiter-only endpoints for viewing matched candidates.
- **Async embedding updates:** Embedding updates are triggered manually (not automatic on every profile change).

---

### `memory.js` — AI Memory & Context System

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| GET | `/autofill/candidate` | `authMiddleware` | AI-autofill candidate form data |
| GET | `/autofill/recruiter` | `authMiddleware` | AI-autofill recruiter form data |
| GET | `/screening-answers` | `authMiddleware` | Get saved screening answers |
| POST | `/screening-answers` | `authMiddleware` | Save screening answers |
| GET | `/memories` | `authMiddleware` | List AI memories |
| GET | `/memory-context` | `authMiddleware` | Get AI context for current user |
| GET | `/question-bank` | `authMiddleware` | AI-curated question bank |
| POST | `/question-bank` | `authMiddleware` | Add question to bank |
| DELETE | `/question-bank/:id` | `authMiddleware` | Delete question from bank |
| GET | `/recruiter-preferences` | `authMiddleware` | Get recruiter preferences |
| PUT | `/recruiter-preferences` | `authMiddleware` | Update recruiter preferences |
| POST | `/recruiter-feedback` | `authMiddleware` | Submit recruiter feedback |
| GET | `/match-breakdown/:candidateId/:jobId` | `authMiddleware` | Detailed match breakdown |
| GET | `/omniscore-trend` | `authMiddleware` | Omniscore trend over time |

**Key Imports:** `express`, `authMiddleware`, `memory-service`, `autofill-service`, `pool`, `omniscoreService`

**Notable Patterns:**
- **AI memory system:** Persistent memory for AI interactions across sessions.
- **Autofill:** AI-powered form autofill based on user history and context.
- **Question bank:** AI-curated interview questions that learn from recruiter feedback.
- **Recruiter feedback loop:** Feedback is used to improve matching and recommendations.
- **Omniscore trends:** Time-series tracking of omniscore changes.

---

### `notifications.js` — Notification System

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| POST | `/send` | `authMiddleware` + `requireRecruiter` | Send notification |
| POST | `/queue` | `authMiddleware` + `requireRecruiter` | Queue notification |
| POST | `/process-queue` | `authMiddleware` + `requireAdmin` | Process notification queue (admin) |
| GET | `/history` | `authMiddleware` | Notification history |
| GET | `/preferences` | `authMiddleware` | Get notification preferences |
| PUT | `/preferences` | `authMiddleware` | Update preferences |
| GET | `/templates` | `authMiddleware` | List templates |
| GET | `/templates/:id` | `authMiddleware` | Template details |
| POST | `/templates` | `authMiddleware` + `requireRecruiter` | Create template |
| PUT | `/templates/:id` | `authMiddleware` + `requireAdmin` | Update template (admin) |
| GET | `/stats` | `authMiddleware` + `requireAdmin` | Notification stats (admin) |
| POST | `/test` | `authMiddleware` + `requireAdmin` | Test notification (admin) |
| GET | `/verify` | `authMiddleware` + `requireAdmin` | Verify notification config (admin) |
| POST | `/quick/application-received` | `authMiddleware` + `requireRecruiter` | Quick notification: application received |
| POST | `/quick/interview-scheduled` | `authMiddleware` + `requireRecruiter` | Quick notification: interview scheduled |
| POST | `/quick/offer-extended` | `authMiddleware` + `requireRecruiter` | Quick notification: offer extended |

**Key Imports:** `express`, `pool`, `authMiddleware`, `emailService`

**Notable Patterns:**
- **Queue-based processing:** Notifications are queued and processed asynchronously.
- **Template system:** Pre-built templates for common notifications.
- **Multi-channel:** Email, SMS, and in-app notifications.
- **Quick actions:** Simplified endpoints for common recruiter notification scenarios.
- **Admin controls:** Template management, stats, and queue processing restricted to admin.
- **User preferences:** Granular notification preferences per user.

---

### `omniscore.js` — Omniscore (Candidate Scoring System)

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| GET | `/` | `authMiddleware` | Get user's omniscore |
| GET | `/breakdown` | `authMiddleware` | Score breakdown |
| GET | `/roles` | `authMiddleware` | Role-specific scores |
| GET | `/history` | `authMiddleware` | Score history |
| GET | `/recommendations` | `authMiddleware` | Improvement recommendations |
| POST | `/checkin` | `authMiddleware` | Daily check-in |
| GET | `/company-score/:companyId` | `authMiddleware` | Company aggregate score |
| POST | `/rate-company` | `authMiddleware` | Rate a company |
| GET | `/ratable-companies` | `authMiddleware` | Companies user can rate |
| GET | `/mutual-matches` | `authMiddleware` | Mutual match scores |
| GET | `/candidate/:candidateId` | `authMiddleware` | Recruiter view of candidate score |
| GET | `/leaderboard` | `authMiddleware` | Score leaderboard |
| GET | `/company-dashboard` | `authMiddleware` | Company dashboard |

**Key Imports:** `express`, `authMiddleware`, `omniscoreService`, `trustscoreService`, `AuditLogger`, `pool`

**Notable Patterns:**
- **Multi-mount:** Mounted at `/api/omniscore`, `/api/candidate/omniscore`, `/api/recruiter/omniscore` — same router handles different contexts.
- **Comprehensive scoring:** Skills, experience, assessments, interviews, activity, and feedback all contribute to score.
- **Company perspective:** Recruiters can view candidate omniscores and company aggregate scores.
- **Gamification:** Leaderboard and daily check-ins for engagement.
- **Mutual matching:** Both candidate and company rate each other for mutual fit scoring.
- **Audit logging:** Score changes are logged for explainability.

---

### `onboarding.js` — Offer & Onboarding Workflow

**Endpoints (20+):**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| POST | `/offers` | `authMiddleware` | Create offer |
| POST | `/offers/:id/generate-letter` | `authMiddleware` | AI generate offer letter |
| GET | `/offers/:id/letter` | `authMiddleware` | View offer letter |
| GET | `/offers` | `authMiddleware` | List offers (recruiter view) |
| GET | `/offers/me` | `authMiddleware` | My offers (candidate view) |
| POST | `/offers/:id/send` | `authMiddleware` | Send offer |
| POST | `/offers/:id/view` | `authMiddleware` | Candidate views offer |
| POST | `/offers/:id/accept` | `authMiddleware` | Accept offer |
| POST | `/offers/:id/withdraw` | `authMiddleware` | Withdraw offer |
| POST | `/offers/:id/decline` | `authMiddleware` | Decline offer |
| GET | `/checklists` | `authMiddleware` | Onboarding checklists |
| POST | `/checklists/:id/complete` | `authMiddleware` | Complete checklist item |
| POST | `/documents` | `authMiddleware` | Upload onboarding document |
| GET | `/checklists/:id/documents` | `authMiddleware` | Get checklist documents |
| POST | `/feedback/schedule` | `authMiddleware` | Schedule feedback session |
| GET | `/feedback/pending` | `authMiddleware` | Pending feedback |
| POST | `/feedback/:id/submit` | `authMiddleware` | Submit feedback |
| GET | `/feedback/analytics` | `authMiddleware` | Feedback analytics |
| POST | `/assistant/chat` | `authMiddleware` | Onboarding AI assistant |
| GET | `/assistant/history/:session_id` | `authMiddleware` | Chat history |
| GET | `/recruiter/documents` | `authMiddleware` | Recruiter view: all docs |
| GET | `/recruiter/candidate/:candidate_id/documents` | `authMiddleware` | Candidate's docs |
| GET | `/recruiter/summary` | `authMiddleware` | Onboarding summary |
| GET | `/wizard/progress` | `authMiddleware` | Onboarding wizard progress |
| POST | `/wizard/save-step` | `authMiddleware` | Save wizard step |
| POST | `/wizard/generate-documents` | `authMiddleware` | AI generate onboarding docs |
| POST | `/wizard/sign-document` | `authMiddleware` | Sign document |
| POST | `/wizard/sign-all` | `authMiddleware` | Sign all documents |
| GET | `/wizard/documents/:checklist_id` | `authMiddleware` | Wizard documents |
| GET | `/recruiter/document/:document_id/download` | `authMiddleware` | Download document |

**Key Imports:** `express`, `pool`, `authMiddleware`, `polsia-ai`, `countryConfig`

**Notable Patterns:**
- **Full offer lifecycle:** Create → Generate Letter → Send → View → Accept/Decline/Withdraw.
- **AI-generated offer letters:** Uses `polsia-ai` to generate personalized offer letters.
- **Onboarding wizard:** Multi-step wizard with progress tracking and document generation.
- **Digital signatures:** Document signing workflow for offer letters and contracts.
- **Checklist system:** Structured onboarding tasks with completion tracking.
- **AI assistant:** Chatbot for onboarding Q&A and guidance.
- **Country-specific:** Uses `countryConfig` for locale-specific onboarding requirements.

---

### `payroll.js` — Global Payroll Management

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| GET | `/countries` | `authMiddleware` | Supported payroll countries |
| GET | `/employees` | `authMiddleware` + `requireRole(...)` | List employees |
| POST | `/employees` | `authMiddleware` + `requireRole(...)` | Add employee |
| POST | `/employees/:employeeId/onboard` | `authMiddleware` + `requireRole(...)` | Onboard employee |
| GET | `/dashboard` | `authMiddleware` + `requireRole(...)` | Payroll dashboard |
| POST | `/runs` | `authMiddleware` + `requireRole(...)` | Create payroll run |
| GET | `/runs` | `authMiddleware` + `requireRole(...)` | List payroll runs |
| GET | `/runs/:runId` | `authMiddleware` + `requireRole(...)` | Run details |
| POST | `/runs/:runId/process` | `authMiddleware` + `requireRole(...)` | Process payroll |
| GET | `/runs/:runId/payslip/:paycheckId` | `authMiddleware` | View payslip |
| GET | `/pay-periods` | `authMiddleware` + `requireRole(...)` | List pay periods |
| POST | `/pay-periods/generate` | `authMiddleware` + `requireRole(...)` | Generate pay periods |
| GET | `/employee/profile` | `authMiddleware` | Employee self-view |
| GET | `/employee/paychecks` | `authMiddleware` | Employee paychecks |
| GET | `/employee/paychecks/:paycheckId` | `authMiddleware` | Paycheck details |
| POST | `/employee/bank-account` | `authMiddleware` | Add bank account |

**Key Imports:** `express`, `pool`, `authMiddleware`, `requireRole`, `payroll-calculator`

**Notable Patterns:**
- **Role-restricted:** Employer/recruiter/hiring_manager/admin roles for management; employee endpoints for self-service.
- **Payroll runs:** Full payroll processing cycle (create → process → generate payslips).
- **Country-specific:** Tax calculations, compliance, and payslip formatting vary by country.
- **Employee self-service:** Employees can view their own payslips and manage bank accounts.
- **Payslip generation:** PDF payslip generation with country-specific formatting.

---

### `quick-practice.js` — Interview Practice (Isolated Module)

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| GET | `/practice/library` | `authMiddleware` | Practice question library |
| POST | `/practice/submit` | `authMiddleware` | Submit practice answer |
| POST | `/practice/submit-video` | `authMiddleware` | Submit video practice answer |
| GET | `/practice/stats` | `authMiddleware` | Practice statistics |
| GET | `/practice/progress` | `authMiddleware` | Practice progress |
| GET | `/practice/sessions` | `authMiddleware` | Practice session history |
| GET | `/practice/sessions/:id` | `authMiddleware` | Session details |

**Key Imports:** `express`, `pool`, `authMiddleware`, `qp-ai`

**Notable Patterns:**
- **Isolated module:** Mounted separately from main interview routes to avoid path conflicts.
- **Self-paced practice:** No recruiter involvement; candidates practice independently.
- **Video practice:** Supports video responses with AI analysis.
- **Progress tracking:** Tracks improvement over time.
- **Separate AI module:** Uses `qp-ai` (quick-practice AI) instead of `polsia-ai`.

---

### `recruiter.js` — Recruiter Dashboard & Operations

**Endpoints (25+):**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| GET | `/dashboard` | `authMiddleware` + `requireRecruiter` | Recruiter dashboard |
| GET | `/jobs` | `authMiddleware` + `requireRecruiter` | List recruiter's jobs |
| POST | `/jobs` | `authMiddleware` + `requireRecruiter` | Create job |
| POST | `/jobs/analyze` | `authMiddleware` + `requireRecruiter` | AI analyze job description |
| POST | `/jobs/optimize` | `authMiddleware` + `requireRecruiter` | AI optimize job description |
| GET | `/salary-insights` | `authMiddleware` + `requireRecruiter` | AI salary insights |
| POST | `/jobs/generate` | `authMiddleware` + `requireRecruiter` | AI generate job description |
| POST | `/jobs/suggest-skills` | `authMiddleware` + `requireRecruiter` | AI suggest required skills |
| POST | `/jobs/suggest-title` | `authMiddleware` + `requireRecruiter` | AI suggest job title |
| PUT | `/jobs/:id` | `authMiddleware` + `requireRecruiter` | Update job |
| GET | `/applications` | `authMiddleware` + `requireRecruiter` | List applications |
| PUT | `/applications/:id/status` | `authMiddleware` + `requireRecruiter` | Update application status |
| POST | `/interviews` | `authMiddleware` + `requireRecruiter` | Create interview |
| DELETE | `/interviews/:id` | `authMiddleware` + `requireRecruiter` | Cancel interview |
| GET | `/candidates` | `authMiddleware` + `requireRecruiter` | List candidates |
| GET | `/jobs/:id/applications` | `authMiddleware` + `requireRecruiter` | Job applications |
| PUT | `/applications/:id` | `authMiddleware` + `requireRecruiter` | Full application update |
| POST | `/interviews/schedule` | `authMiddleware` + `requireRecruiter` | Schedule interview |
| GET | `/interviews` | `authMiddleware` + `requireRecruiter` | List interviews |
| PUT | `/interviews/:id` | `authMiddleware` + `requireRecruiter` | Update interview |
| POST | `/jobs/:id/questions` | `authMiddleware` + `requireRecruiter` | Add screening questions |
| POST | `/jobs/:id/analyze-candidate` | `authMiddleware` + `requireRecruiter` | AI analyze candidate for job |
| GET | `/candidates/:id/coaching` | `authMiddleware` + `requireRecruiter` | View candidate coaching notes |
| GET | `/pipeline-stages` | `authMiddleware` + `requireRecruiter` | Pipeline stages config |
| PUT | `/applications/batch-status` | `authMiddleware` + `requireRecruiter` | Bulk status update |
| GET | `/pipeline/:jobId` | `authMiddleware` + `requireRecruiter` | Job pipeline view |
| GET | `/jobs/:id/ranked-candidates` | `authMiddleware` + `requireRecruiter` | AI-ranked candidates |
| POST | `/ai/candidate-summary` | `authMiddleware` + `requireRecruiter` | AI candidate summary |
| POST | `/ai/suggest-questions` | `authMiddleware` + `requireRecruiter` | AI suggest interview questions |
| POST | `/question-bank` | `authMiddleware` + `requireRecruiter` | Recruiter question bank |

**Key Imports:** `express`, `pool`, `authMiddleware`, `trustscoreService`, `jobOptimizer`, `AuditLogger`, `chat` (polsia-ai), `omniscoreService`, `memoryService`

**Notable Patterns:**
- **Recruiter-only:** All endpoints protected by `requireRecruiter` (defined inline in this file).
- **Heavy AI integration:** Job analysis, optimization, generation, candidate analysis, and question suggestion all use AI.
- **Pipeline management:** Full ATS-style pipeline with custom stages and bulk operations.
- **AI ranking:** Candidates are AI-ranked for each job based on match score + omniscore.
- **Audit logging:** All recruiter actions are logged via `AuditLogger`.
- **Deferred imports:** Some AI imports are done inside route handlers.

---

### `screening.js` — Resume Screening & Question Generation

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| POST | `/analyze` | `authMiddleware` | AI analyze candidate against job |
| POST | `/batch` | `authMiddleware` | Batch screening |
| GET | `/:job_id` | `authMiddleware` | Get screening data for job |
| POST | `/questions` | `authMiddleware` | Generate screening questions |
| POST | `/compare` | `authMiddleware` | Compare candidates |

**Key Imports:** `express`, `authMiddleware`, `recruiter-screener`, `pool`

**Notable Patterns:**
- **AI screening:** Uses `recruiter-screener` service for resume-to-job matching analysis.
- **Batch processing:** Supports screening multiple candidates at once.
- **Question generation:** AI generates tailored screening questions based on job requirements.
- **Candidate comparison:** Side-by-side comparison of multiple candidates.

---

### `trustscore.js` — Company Trust & Reputation

**Endpoints:**
| Method | Path | Middleware | Description |
|--------|------|------------|-------------|
| GET | `/` | `authMiddleware` + `requireRecruiter` | Company trustscore |
| GET | `/breakdown` | `authMiddleware` + `requireRecruiter` | Trustscore breakdown |
| GET | `/history` | `authMiddleware` + `requireRecruiter` | Score history |
| GET | `/recommendations` | `authMiddleware` + `requireRecruiter` | Improvement recommendations |
| GET | `/analytics` | `authMiddleware` + `requireRecruiter` | Trustscore analytics |
| GET | `/public/:companySlug` | — | Public company trustscore |

**Key Imports:** `express`, `authMiddleware`, `requireRecruiter`, `trustscoreService`, `pool`

**Notable Patterns:**
- **Recruiter-only internal:** Company-facing scores are recruiter-only.
- **Public score:** Anyone can view a company's public trustscore via slug.
- **Trust factors:** Company verification, response rate, candidate reviews, offer acceptance rate, etc.

---

## 3. Middleware Summary

### Auth Middleware (from `lib/auth.js`)

| Middleware | Description | Used In |
|------------|-------------|---------|
| `authMiddleware` | JWT verification, sets `req.user` | All routes except a few public ones |
| `optionalAuth` | Same as authMiddleware but doesn't fail if no token | `analytics`, `billing`, `jobs`, `company` (public), `countries` |
| `requireRole(...)` | Check if `req.user.role` is in allowed list | `jobs`, `matching`, `payroll`, `communications` |

### Role-Specific Middleware (defined inline in route files)

| Middleware | Defined In | Description |
|------------|-----------|-------------|
| `requireAdmin` | `admin.js` | Session-based admin OR JWT bridge with `role === 'admin'` |
| `requireRecruiter` | `recruiter.js`, `communications.js`, `notifications.js`, `trustscore.js` | Checks if user has company association (recruiter/employer/hiring_manager/admin) |

### Rate Limiting (from `lib/distributed-rate-limiter.js`)

| Middleware | Description | Used On |
|------------|-------------|---------|
| `rateLimits.strict` | Strict rate limit (5 attempts / 15 min) | `auth/register`, `auth/login`, `auth/forgot-password`, `auth/reset-password` |
| `rateLimits.ai` | AI endpoint rate limit | `assessments/start`, `assessments/generate`, `assessments/converse`, `interviews/start`, `interviews/upload-video`, `interviews/mock/start`, `interviews/mock/respond`, `interviews/mock/analyze-frame` |
| `distributedRateLimiter` | PostgreSQL-backed distributed limiter | `admin/login` (custom inline implementation) |

### Upload Middleware (from `multer`)

| Route | Upload Type | Description |
|-------|-------------|-------------|
| `candidate/profile/photo` | `upload.single('photo')` | Profile photo |
| `candidate/resume/upload` | `upload.single('resume')` | Resume file |
| `documents/upload` | `upload.single('document')` | Document |
| `interviews/upload-video` | `upload.single('video')` | Video interview response |
| `interviews/mock/:sessionId/voice-respond` | `upload.single('audio')` | Audio interview response |

---

## 4. Cross-Cutting Concerns & Patterns

### 4.1 AI Integration (`lib/polsia-ai.js`)

Nearly every route file uses the AI service (`chat`, `generate...`, `analyze...` functions). The most AI-heavy routes are:
- **assessments.js** — Question generation, answer evaluation, conversational follow-ups
- **interviews.js** — Mock interview, video analysis, voice processing, question bank
- **candidate.js** — Resume parsing, coaching, job recommendations
- **recruiter.js** — Job analysis, candidate analysis, question generation, AI ranking
- **onboarding.js** — Offer letter generation, document generation, AI assistant
- **communications.js** — Message generation
- **screening.js** — Resume screening, comparison

### 4.2 Database (`lib/db.js` / `pool`)

Every route file uses `pool` from `../lib/db` for PostgreSQL queries. Common patterns:
- **Direct queries:** `pool.query()` for simple reads
- **Transactions:** `pool.connect()` + `BEGIN/COMMIT/ROLLBACK` for multi-step writes
- **JSONB columns:** Heavy use of JSONB for flexible schema (questions, answers, metadata, events)

### 4.3 Services Layer

| Service | Used By | Purpose |
|---------|---------|---------|
| `omniscoreService` | `assessments`, `candidate`, `interviews`, `recruiter`, `memory`, `omniscore` | Candidate scoring |
| `trustscoreService` | `company`, `omniscore`, `recruiter`, `trustscore` | Company reputation |
| `matching-engine` | `candidate`, `matching` | Vector-based job matching |
| `memory-service` | `memory`, `recruiter` | AI memory/context |
| `payroll-calculator` | `payroll` | Payroll calculations |
| `jobOptimizer` | `recruiter` | Job description optimization |
| `communication-generator` | `communications` | Message generation |
| `recruiter-screener` | `screening` | Resume screening |
| `document-verification` | `documents` | Document verification |
| `country-config` | `jobs`, `onboarding`, `payroll`, `countries` | Localization |
| `auditLogger` | `compliance`, `omniscore`, `recruiter` | Compliance audit trail |
| `biasDetection` | `compliance` | Bias analysis |
| `scoreExplainer` | `compliance` | XAI explanations |
| `interviewAI` | `interviews` | Interview-specific AI |
| `autofill-service` | `memory` | Form autofill |
| `qp-ai` | `quick-practice` | Practice-specific AI |

### 4.4 Omniscore Integration

Omniscore is the most cross-cutting feature. It is updated and read from:
- `candidate.js` — Profile changes, resume upload, applications, assessments
- `assessments.js` — Assessment completion
- `interviews.js` — Interview completion
- `recruiter.js` — Recruiter actions (viewed via `candidate/:id`)
- `omniscore.js` — Direct score access
- `memory.js` — Score trends
- `matching.js` — Match explanations

---

## 5. Issues & Notable Concerns

### 5.1 Critical Bugs

1. **admin.js — `loginAttempts` undefined:** Line ~249 references `loginAttempts.delete(ip)` but `loginAttempts` is never declared. Should be `distributedRateLimiter.reset(key)` or similar.

### 5.2 Design Concerns

2. **Duplicate route mounts:** `omniscore.js` is mounted at 3 paths. While this works, it makes the router's path logic dependent on the mount point, which can be confusing.

3. **Route overlap:** `quick-practice.js` and `interviews.js` are both mounted at `/api/interviews`. This works because their paths don't overlap (practice uses `/practice/*`, interviews use `/mock/*`, `/start`, etc.), but it's fragile and the order of `app.use()` matters.

4. **Deferred imports:** Multiple files (`candidate.js`, `recruiter.js`) import `chat` inside route handlers rather than at the top. This is likely a circular dependency workaround but makes code harder to follow and could cause performance issues.

5. **Inline `requireRecruiter` definitions:** The same `requireRecruiter` function is defined in 4 different files (`recruiter.js`, `communications.js`, `notifications.js`, `trustscore.js`). It should be centralized in `lib/auth.js` or `lib/middleware.js`.

6. **Hardcoded data:** Several files contain hardcoded constants:
   - `assessments.js` — `SKILL_CATALOG` (16 skills)
   - `billing.js` — Pricing plans
   - `interviews.js` — Question bank categories
   - `onboarding.js` — Checklist templates

7. **Large file sizes:** Several files are very large:
   - `interviews.js` — ~2,300+ lines
   - `assessments.js` — ~1,900+ lines
   - `candidate.js` — ~2,200+ lines
   - `onboarding.js` — ~1,700+ lines
   - `recruiter.js` — ~1,400+ lines

   These could benefit from splitting into sub-routers or service layers.

8. **No input validation library:** All routes manually validate inputs. No use of Joi, Zod, or express-validator. This is error-prone and inconsistent.

9. **No centralized error handling:** Each route has its own try/catch with `console.error` + 500 response. No error middleware or structured error responses.

10. **SQL injection risk:** Most queries use parameterized queries (`$1`, `$2`), which is good. However, some dynamic queries (especially in analytics with `LIKE` patterns) should be reviewed for edge cases.

11. **Missing 404 handlers:** No explicit `router.all('*')` catch-all for undefined routes within routers.

12. **Inconsistent auth for update/delete:** Some routes like `jobs.js` `PUT /:id` and `DELETE /:id` only check `authMiddleware` but don't verify ownership. Any authenticated user could potentially update/delete any job if they know the ID.

13. **File upload security:** No file type validation or size limits are visible in the upload configurations (multer setup is minimal).

14. **No API versioning:** All routes are under `/api` with no version prefix. Breaking changes will be difficult to manage.

---

## 6. Architectural Overview Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         server.js                           │
│              ┌──────────────┐                             │
│              │   /api/...     │                             │
│              └──────┬───────┘                             │
└─────────────────────┼───────────────────────────────────────┘
                      │
    ┌─────────────────┼─────────────────┐
    │                 │                 │
┌───┴───┐    ┌───────┴───────┐  ┌──────┴───────┐
│Public │    │ Auth Required │  │ Admin Only   │
│Routes │    │               │  │              │
│       │    │               │  │              │
│jobs.js│    │ candidate.js  │  │ admin.js     │
│(GET /)│    │ recruiter.js  │  │ (revenue)    │
│       │    │ onboarding.js │  │              │
│       │    │ interviews.js │  │              │
│       │    │ assessments.js│  │              │
│       │    │ omniscore.js  │  │              │
│       │    │ matching.js   │  │              │
│       │    │ ...           │  │              │
└───────┘    └───────────────┘  └──────────────┘
```

---

## 7. Statistics

| Metric | Count |
|--------|-------|
| Total route files | 21 |
| Total endpoints (approx) | 200+ |
| Files using `authMiddleware` | 20/21 |
| Files using AI (`polsia-ai` or `qp-ai`) | 8+ |
| Files using `rateLimits` | 5 |
| Files with file upload (`multer`) | 4 |
| Files with `requireRecruiter` | 4 |
| Files with `requireRole` | 4 |
| Average lines per route file | ~1,100 |

---

*End of analysis.*
