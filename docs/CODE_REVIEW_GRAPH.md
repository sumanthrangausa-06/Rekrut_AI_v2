# Code Review Graph - Rekrut AI

> **Purpose:** Visual guide to understanding the codebase structure and relationships.
> **For Agents:** Use this to quickly locate code and understand dependencies.

**Last Updated:** 2026-08-06

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              REKRUT AI PLATFORM                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         FRONTEND (client/)                           │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │    │
│  │  │   Pages     │  │ Components  │  │  Contexts   │  │    Lib     │  │    │
│  │  │  /admin     │  │  /domain    │  │  AuthCtx    │  │  api.ts    │  │    │
│  │  │  /candidate │  │  /layout    │  │             │  │  utils.ts  │  │    │
│  │  │  /recruiter │  │  /ui        │  │             │  │            │  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘  │    │
│  │                        React 19 + Vite + Tailwind                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                     │                                        │
│                                     │ HTTP/REST                              │
│                                     ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         BACKEND (Node.js/Express)                    │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │    │
│  │  │   Routes    │─▶│  Services   │─▶│    Lib      │─▶│  Database  │  │    │
│  │  │  /routes/*  │  │ /services/* │  │   /lib/*    │  │ PostgreSQL │  │    │
│  │  │  29 files   │  │  17 files   │  │  18 files   │  │  pgvector  │  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘  │    │
│  │                                                                      │    │
│  │  ┌─────────────────────────────────────────────────────────────┐    │    │
│  │  │                    AI PROVIDERS (lib/)                       │    │    │
│  │  │   OpenAI  │  Anthropic  │  NVIDIA NIM  │  Groq  │  Cartesia  │    │    │
│  │  └─────────────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Backend Architecture

### Route → Service → Lib Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              REQUEST FLOW                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│   HTTP Request                                                                │
│        │                                                                      │
│        ▼                                                                      │
│   ┌─────────────┐                                                            │
│   │  server.js  │  Entry point, mounts all routes                            │
│   └──────┬──────┘                                                            │
│          │                                                                    │
│          ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐    │
│   │                         ROUTES (/routes/)                            │    │
│   │                                                                      │    │
│   │  Auth & Users        Business Logic        Admin & Monitoring        │    │
│   │  ├── auth.js         ├── candidate.js     ├── admin.js              │    │
│   │  ├── settings.js     ├── recruiter.js     ├── analytics.js          │    │
│   │  └── countries.js    ├── jobs.js          ├── compliance.js         │    │
│   │                      ├── interviews.js    └── billing.js            │    │
│   │  Communication       ├── assessments.js                              │    │
│   │  ├── communications  ├── matching.js      Scoring                   │    │
│   │  ├── notifications   ├── screening.js     ├── omniscore.js          │    │
│   │  ├── email-tracking  ├── onboarding.js    └── trustscore.js         │    │
│   │  └── calendar.js     ├── payroll.js                                  │    │
│   │                      └── documents.js     Voice/AI                   │    │
│   │                                           ├── voice.js               │    │
│   │                                           ├── tts.js                 │    │
│   │                                           ├── quick-practice.js      │    │
│   │                                           └── memory.js              │    │
│   └─────────────────────────────────────────────────────────────────────┘    │
│          │                                                                    │
│          ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐    │
│   │                        SERVICES (/services/)                         │    │
│   │                                                                      │    │
│   │  AI Services              Scoring               Business Logic       │    │
│   │  ├── interview-ai.js      ├── omniscore.js      ├── matching-engine  │    │
│   │  ├── cartesia-voice.js    ├── trustscore.js     ├── job-optimizer    │    │
│   │  ├── tts-service.js       └── scoreExplainer    ├── payroll-calc     │    │
│   │  └── biasDetection.js                           └── country-config   │    │
│   │                                                                      │    │
│   │  Document Services        Communication         Memory               │    │
│   │  ├── document-verify      ├── communication-gen ├── memory-service   │    │
│   │  └── autofill-service     └── auditLogger       └── agent-memory     │    │
│   └─────────────────────────────────────────────────────────────────────┘    │
│          │                                                                    │
│          ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐    │
│   │                           LIB (/lib/)                                │    │
│   │                                                                      │    │
│   │  Core                     AI Providers          Utilities            │    │
│   │  ├── db.js (PostgreSQL)   ├── ai-provider.js    ├── auth.js          │    │
│   │  ├── db-health.js         ├── polsia-ai.js      ├── null-guard.js    │    │
│   │  └── email-service.js     ├── qp-ai.js          ├── token-budget.js  │    │
│   │                           └── qp-provider.js    └── metrics-collect  │    │
│   │  Monitoring                                                          │    │
│   │  ├── activity-logger.js   Rate Limiting         Audio                │    │
│   │  ├── ai-call-logger.js    └── distributed-      └── self-hosted-     │    │
│   │  └── recruiter-screener      rate-limiter          audio.js          │    │
│   └─────────────────────────────────────────────────────────────────────┘    │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### API Routes Quick Reference

| Route File | Mount Path | Purpose | Key Endpoints |
|------------|------------|---------|---------------|
| `auth.js` | `/api/auth` | Authentication | `/login`, `/register`, `/logout` |
| `candidate.js` | `/api/candidate` | Candidate operations | `/profile`, `/applications`, `/dashboard` |
| `recruiter.js` | `/api/recruiter` | Recruiter operations | `/jobs`, `/candidates`, `/dashboard` |
| `jobs.js` | `/api/jobs` | Job management | CRUD operations |
| `interviews.js` | `/api/interviews` | Interview management | `/schedule`, `/feedback`, `/analysis` |
| `assessments.js` | `/api/assessments` | Skill assessments | `/take`, `/results`, `/generate` |
| `omniscore.js` | `/api/omniscore` | OmniScore calculations | `/calculate`, `/history` |
| `trustscore.js` | `/api/trustscore` | TrustScore calculations | `/calculate`, `/company` |
| `matching.js` | `/api/matching` | AI job matching | `/candidates`, `/jobs` |
| `onboarding.js` | `/api/onboarding` | Employee onboarding | `/tasks`, `/documents`, `/progress` |
| `payroll.js` | `/api/payroll` | Payroll management | `/run`, `/employees`, `/reports` |
| `admin.js` | `/api/admin` | Admin dashboard | `/users`, `/analytics`, `/ai-health` |
| `communications.js` | `/api/communications` | Messaging | `/send`, `/templates` |
| `notifications.js` | `/api/notifications` | Notifications | `/send`, `/preferences` |
| `voice.js` | `/api/voice` | Voice features | `/synthesize`, `/transcribe` |
| `tts.js` | `/api/tts` | Text-to-speech | `/generate`, `/cache` |

---

## Frontend Architecture

### Page Structure

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            FRONTEND PAGES                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│   /pages/                                                                     │
│   │                                                                           │
│   ├── Public Pages (No Auth)                                                 │
│   │   ├── landing.tsx        Homepage with hero, features, pricing           │
│   │   ├── login.tsx          User login                                      │
│   │   ├── register.tsx       User registration                               │
│   │   ├── pricing.tsx        Pricing plans                                   │
│   │   ├── about.tsx          About page                                      │
│   │   ├── contact.tsx        Contact form                                    │
│   │   ├── privacy.tsx        Privacy policy                                  │
│   │   └── terms.tsx          Terms of service                                │
│   │                                                                           │
│   ├── /candidate/ (Candidate Dashboard)                                      │
│   │   ├── dashboard.tsx      Main dashboard with stats                       │
│   │   ├── profile.tsx        Profile management (87KB - largest)             │
│   │   ├── jobs.tsx           Job search and browsing                         │
│   │   ├── applications.tsx   Application tracking                            │
│   │   ├── interviews.tsx     Interview schedule                              │
│   │   ├── mock-interview.tsx AI mock interviews (82KB)                       │
│   │   ├── quick-practice.tsx Quick interview practice                        │
│   │   ├── assessments.tsx    Skill assessments                               │
│   │   ├── omniscore.tsx      OmniScore dashboard                             │
│   │   ├── onboarding.tsx     New hire onboarding (103KB - largest)           │
│   │   ├── offers.tsx         Job offers                                      │
│   │   ├── payroll.tsx        Payroll/earnings                                │
│   │   ├── documents.tsx      Document management                             │
│   │   └── ai-coaching.tsx    AI career coaching                              │
│   │                                                                           │
│   ├── /recruiter/ (Recruiter Dashboard)                                      │
│   │   ├── dashboard.tsx      Main dashboard                                  │
│   │   ├── jobs.tsx           Job postings management                         │
│   │   ├── job-form.tsx       Create/edit jobs (58KB)                         │
│   │   ├── candidates.tsx     Candidate pool                                  │
│   │   ├── applications.tsx   Application review                              │
│   │   ├── interviews.tsx     Interview management                            │
│   │   ├── screening.tsx      Candidate screening                             │
│   │   ├── assessments.tsx    Assessment management                           │
│   │   ├── offers.tsx         Offer management                                │
│   │   ├── onboarding.tsx     Onboarding management                           │
│   │   ├── payroll.tsx        Payroll management                              │
│   │   ├── analytics.tsx      Hiring analytics                                │
│   │   ├── company.tsx        Company profile                                 │
│   │   ├── compliance.tsx     Compliance dashboard                            │
│   │   └── omniscore.tsx      Candidate OmniScores                            │
│   │                                                                           │
│   └── /admin/ (Admin Dashboard)                                              │
│       ├── login.tsx          Admin login                                     │
│       ├── dashboard.tsx      Admin overview                                  │
│       ├── ai-health.tsx      AI monitoring (124KB - largest admin)           │
│       ├── compliance.tsx     Platform compliance (124KB)                     │
│       ├── analytics.tsx      Platform analytics                              │
│       ├── agents.tsx         AI agent management                             │
│       ├── revenue.tsx        Revenue tracking                                │
│       └── email-queue.tsx    Email queue management                          │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component Structure

```
/components/
├── /ui/                    Shadcn UI components (buttons, inputs, dialogs)
├── /layout/                Layout components (header, footer, sidebar)
├── /domain/                Domain-specific components
├── admin-auth-guard.tsx    Admin route protection
├── ai-onboarding-*.tsx     AI-powered onboarding flows
├── error-boundary.tsx      Error handling
└── voice-features.tsx      Voice interaction components
```

### Frontend → Backend API Mapping

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PAGE → API MAPPING                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  CANDIDATE PAGES                        API ROUTES                          │
│  ──────────────                         ──────────                          │
│  dashboard.tsx            ────────▶     /api/candidate/dashboard            │
│  profile.tsx              ────────▶     /api/candidate/profile              │
│  jobs.tsx                 ────────▶     /api/jobs                           │
│  applications.tsx         ────────▶     /api/candidate/applications         │
│  interviews.tsx           ────────▶     /api/interviews                     │
│  mock-interview.tsx       ────────▶     /api/quick-practice                 │
│  assessments.tsx          ────────▶     /api/assessments                    │
│  omniscore.tsx            ────────▶     /api/omniscore                      │
│  onboarding.tsx           ────────▶     /api/onboarding                     │
│  payroll.tsx              ────────▶     /api/payroll                        │
│                                                                              │
│  RECRUITER PAGES                        API ROUTES                          │
│  ───────────────                        ──────────                          │
│  dashboard.tsx            ────────▶     /api/recruiter/dashboard            │
│  jobs.tsx                 ────────▶     /api/recruiter/jobs                 │
│  candidates.tsx           ────────▶     /api/recruiter/candidates           │
│  interviews.tsx           ────────▶     /api/recruiter/interviews           │
│  screening.tsx            ────────▶     /api/screening                      │
│  analytics.tsx            ────────▶     /api/analytics                      │
│  company.tsx              ────────▶     /api/company                        │
│                                                                              │
│  ADMIN PAGES                            API ROUTES                          │
│  ───────────                            ──────────                          │
│  ai-health.tsx            ────────▶     /api/admin/ai-health                │
│  compliance.tsx           ────────▶     /api/compliance                     │
│  analytics.tsx            ────────▶     /api/admin/analytics                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema Overview

### Core Tables (from migrations)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATABASE SCHEMA                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   USERS & AUTH                         COMPANIES                            │
│   ────────────                         ─────────                            │
│   ┌─────────────┐                      ┌─────────────┐                      │
│   │   users     │                      │  companies  │                      │
│   ├─────────────┤                      ├─────────────┤                      │
│   │ id          │──────────────────────│ id          │                      │
│   │ email       │                      │ name        │                      │
│   │ password    │                      │ profile     │                      │
│   │ role        │                      │ trustscore  │                      │
│   │ created_at  │                      └─────────────┘                      │
│   └─────────────┘                            │                              │
│         │                                    │                              │
│         │                                    ▼                              │
│         ▼                              ┌─────────────┐                      │
│   ┌─────────────┐                      │    jobs     │                      │
│   │ candidates  │                      ├─────────────┤                      │
│   ├─────────────┤                      │ id          │                      │
│   │ user_id     │                      │ company_id  │                      │
│   │ profile     │                      │ title       │                      │
│   │ omniscore   │                      │ description │                      │
│   │ skills[]    │                      │ embedding   │◀── pgvector          │
│   │ embedding   │◀── pgvector          │ status      │                      │
│   └─────────────┘                      └─────────────┘                      │
│         │                                    │                              │
│         │                                    │                              │
│         └────────────────┬───────────────────┘                              │
│                          ▼                                                  │
│                    ┌─────────────┐                                          │
│                    │applications │                                          │
│                    ├─────────────┤                                          │
│                    │ id          │                                          │
│                    │ candidate_id│                                          │
│                    │ job_id      │                                          │
│                    │ status      │                                          │
│                    │ match_score │                                          │
│                    └─────────────┘                                          │
│                          │                                                  │
│         ┌────────────────┼────────────────┐                                 │
│         ▼                ▼                ▼                                 │
│   ┌───────────┐   ┌───────────┐   ┌───────────────┐                        │
│   │interviews │   │assessments│   │screening_resp │                        │
│   └───────────┘   └───────────┘   └───────────────┘                        │
│                                                                              │
│   SCORING                              ONBOARDING & PAYROLL                 │
│   ───────                              ────────────────────                 │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐    │
│   │omniscore_   │   │trustscore_  │   │onboarding_  │   │payroll_     │    │
│   │history      │   │history      │   │tasks        │   │entries      │    │
│   └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘    │
│                                                                              │
│   COMMUNICATION                        AI & MONITORING                      │
│   ─────────────                        ───────────────                      │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐    │
│   │notifications│   │email_       │   │ai_call_     │   │activity_    │    │
│   │             │   │templates    │   │logs         │   │logs         │    │
│   └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Migration Files

| Migration | Tables Created | Purpose |
|-----------|---------------|---------|
| `001_add_omniscore.js` | omniscore_* | Candidate scoring system |
| `002_add_trustscore.js` | trustscore_* | Company reputation |
| `004_candidate_profiles.js` | candidates, skills | Candidate data |
| `006_dynamic_assessments.js` | assessments, questions | Skill testing |
| `008_matching_engine.js` | embeddings, matches | AI matching |
| `011_payroll_system.js` | payroll_* | Payroll processing |
| `014_onboarding_system.js` | onboarding_* | Employee onboarding |
| `035_email_notifications.js` | email_*, notifications | Communication |
| `039_ai_health_monitoring.js` | ai_* | AI usage tracking |
| `047_p2_schema_hardening.js` | Various | Schema improvements |

---

## AI Provider Integration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          AI PROVIDERS (lib/)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                      ai-provider.js (107KB)                          │   │
│   │                    Primary AI routing layer                          │   │
│   └───────────────────────────┬─────────────────────────────────────────┘   │
│                               │                                              │
│         ┌─────────────────────┼─────────────────────┐                       │
│         ▼                     ▼                     ▼                       │
│   ┌───────────┐        ┌───────────┐        ┌───────────┐                  │
│   │  OpenAI   │        │ Anthropic │        │NVIDIA NIM │                  │
│   │  GPT-4    │        │  Claude   │        │  Various  │                  │
│   └───────────┘        └───────────┘        └───────────┘                  │
│         │                     │                     │                       │
│         └─────────────────────┴─────────────────────┘                       │
│                               │                                              │
│                               ▼                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                      polsia-ai.js (73KB)                             │   │
│   │              Custom AI orchestration layer                           │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   Voice/Audio                                                               │
│   ───────────                                                               │
│   ┌─────────────────────┐     ┌─────────────────────┐                      │
│   │ cartesia-voice.js   │     │ self-hosted-audio   │                      │
│   │ (services/)         │     │ (lib/)              │                      │
│   │ Cartesia TTS        │     │ Audio processing    │                      │
│   └─────────────────────┘     └─────────────────────┘                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Code-to-Documentation Mapping

| Code Area | Related Documentation |
|-----------|----------------------|
| **Architecture** | `docs/architecture/ARCHITECTURE_CURRENT.md` |
| **API Routes** | `docs/guides/FEATURE_MAP.md` |
| **Frontend Migration** | `docs/guides/FRONTEND_MIGRATION.md` |
| **Database Schema** | `docs/analysis/database-analysis.md`, `docs/analysis/SCHEMA_IMPROVEMENTS.md` |
| **AI Integration** | `docs/analysis/ai-services-analysis.md`, `docs/analysis/AI_INTEGRATION_AUDIT.md` |
| **Security** | `docs/security/SECURITY_AUDIT_REPORT.md` |
| **Deployment** | `docs/deployment/prod-deploy-runbook.md` |
| **Testing** | `docs/qa/QA_TEST_PLAN.md`, `e2e/README.md` |

---

## File Size Reference (Largest Files)

Understanding which files are most complex:

### Backend (largest route files)
| File | Size | Purpose |
|------|------|---------|
| `routes/onboarding.js` | 124KB | Employee onboarding |
| `routes/recruiter.js` | 122KB | Recruiter operations |
| `routes/interviews.js` | 114KB | Interview management |
| `routes/candidate.js` | 103KB | Candidate operations |
| `routes/assessments.js` | 72KB | Skill assessments |

### Frontend (largest page files)
| File | Size | Purpose |
|------|------|---------|
| `pages/admin/ai-health.tsx` | 124KB | AI monitoring dashboard |
| `pages/admin/compliance.tsx` | 124KB | Compliance dashboard |
| `pages/candidate/onboarding.tsx` | 103KB | Onboarding wizard |
| `pages/candidate/profile.tsx` | 87KB | Profile management |
| `pages/candidate/mock-interview.tsx` | 82KB | Mock interviews |

### Lib (largest library files)
| File | Size | Purpose |
|------|------|---------|
| `lib/ai-provider.js` | 107KB | AI provider abstraction |
| `lib/qp-provider.js` | 100KB | Quick practice AI |
| `lib/polsia-ai.js` | 73KB | Custom AI layer |

---

## Quick Navigation for Agents

### "Where do I find...?"

| Need to... | Go to... |
|------------|----------|
| Add a new API endpoint | `routes/` - find relevant domain file |
| Add business logic | `services/` - create or update service |
| Add database functionality | `lib/db.js` + `migrations/` |
| Add AI capability | `lib/ai-provider.js` or `services/interview-ai.js` |
| Add frontend page | `client/src/pages/[role]/` |
| Add UI component | `client/src/components/` |
| Add authentication | `lib/auth.js` + `routes/auth.js` |
| Add email feature | `lib/email-service.js` |
| Add scoring logic | `services/omniscore.js` or `services/trustscore.js` |
| Add compliance feature | `routes/compliance.js` |

### Common Patterns

```javascript
// Route pattern
router.get('/endpoint', authMiddleware, async (req, res) => {
  const result = await someService.method(req.params);
  res.json(result);
});

// Service pattern
async function businessLogic(params) {
  const db = require('../lib/db');
  // Business logic here
  return result;
}

// Frontend API call pattern
const response = await fetch('/api/endpoint', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data)
});
```

---

## Version History

| Date | Change | Author |
|------|--------|--------|
| 2026-08-06 | Initial code review graph | Agent |
