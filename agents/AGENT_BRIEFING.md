# Rekrut AI — Codebase Agent Briefing

> **Purpose:** Pre-summarized codebase state for agents. Never read raw files >500 lines. Query this briefing first.
> **Last updated:** 2026-06-06 15:30 UTC
> **CTO:** Suga (senior-developer + backend-architect + frontend-developer)

---

## 1. Project Overview

**Rekrut AI (HireLoop)** — AI-native recruitment platform. Dual-sided marketplace (candidates + recruiters).
- **Live prod:** https://hireloop-vzvw.polsia.app
- **Dev:** https://rekrutai-dev.onrender.com (auto-deploy from `dev` branch)
- **Repo:** https://github.com/sumanthrangausa-06/Rekrut_AI_v2
- **DB:** Neon PostgreSQL + pgvector

## 2. Tech Stack

| Layer | Tech | Notes |
|-------|------|-------|
| Backend | Node.js + Express (JS) | 351 API endpoints, 23 route files |
| Frontend | React 19 + Vite + Tailwind + shadcn/ui | TS SPA, 42 routes, 53 pages |
| Database | Neon PostgreSQL + pgvector | 105 tables, 50 migrations |
| AI | Polsia proxy → OpenAI/Anthropic/Gemini → NIM → Groq → Cerebras | 5-provider fallback, circuit breaker |
| Auth | JWT + refresh tokens + PostgreSQL sessions | |
| Rate Limit | PostgreSQL-backed distributed | Fixed June 5, 2026 |
| Hosting | Render (backend), Cloudflare CDN | |
| Payments | Stripe Checkout (test mode) | Needs live key validation |

## 3. Directory Structure

```
Rekrut_AI_v2/
├── server.js              # Entry point — 351 endpoints, Express
├── lib/                   # 14 core libraries
│   ├── ai-provider.js     # 2287 lines — multi-provider LLM, circuit breaker
│   ├── polsia-ai.js      # 1304 lines — AI function wrappers
│   ├── db.js             # PostgreSQL pool (Neon), 25 max connections
│   ├── auth.js           # JWT, authorization, refresh token rotation
│   ├── distributed-rate-limiter.js  # PostgreSQL-backed rate limiting
│   └── ... (10 more)
├── routes/                # 23 route files, 351 endpoints
│   ├── interviews.js     # 37 endpoints, 2691 lines (very large)
│   ├── onboarding.js     # 43 endpoints, 3119 lines (monolith)
│   ├── candidate.js      # 46 endpoints
│   ├── recruiter.js      # 43 endpoints
│   └── ... (19 more)
├── services/             # 14 business logic services
│   ├── matching-engine.js     # Semantic job/candidate matching
│   ├── interview-ai.js       # Video analysis, speech metrics
│   ├── omniscore.js         # Multi-factor candidate scoring
│   └── ... (11 more)
├── client/
│   ├── src/
│   │   ├── main.tsx        # Entry point (React 19 StrictMode)
│   │   ├── App.tsx         # 42 routes, React Router 7
│   │   ├── contexts/
│   │   │   └── auth-context.tsx   # Auth state + user context
│   │   ├── lib/
│   │   │   ├── api.ts      # HTTP client + token management
│   │   │   ├── utils.ts    # cn() helper (clsx + tailwind-merge)
│   │   │   └── analytics.ts # Event tracking
│   │   ├── components/
│   │   │   ├── ui/         # 10 primitive UI components (shadcn)
│   │   │   ├── layout/     # DashboardLayout, Sidebar, Header
│   │   │   └── ... (specialized components)
│   │   └── pages/
│   │       ├── landing.tsx     # 981 lines — NEW redesign
│   │       ├── about.tsx       # 363 lines — NEW
│   │       ├── contact.tsx     # 344 lines — NEW
│   │       ├── privacy.tsx     # 228 lines — NEW
│   │       ├── terms.tsx       # 234 lines — NEW
│   │       ├── login.tsx       # Updated
│   │       ├── register.tsx    # Updated
│   │       ├── candidate/
│   │       │   ├── jobs.tsx         # 1101 lines — NEW redesign
│   │       │   ├── profile.tsx      # 1740 lines — NEW redesign
│   │       │   ├── job-detail.tsx   # 671 lines — NEW redesign
│   │       │   ├── applications.tsx # Updated (match scores)
│   │       │   └── ... (14 more pages)
│   │       ├── recruiter/
│   │       │   ├── dashboard.tsx    # 788 lines — NEW redesign
│   │       │   ├── candidates.tsx   # 862 lines — NEW redesign
│   │       │   ├── jobs.tsx         # 438 lines — NEW redesign
│   │       │   ├── job-form.tsx     # 1335 lines — NEW redesign
│   │       │   ├── screening.tsx    # 1134 lines — NEW redesign
│   │       │   ├── analytics.tsx    # 520 lines — NEW redesign
│   │       │   └── ... (9 more pages)
│   │       └── admin/
│   │           ├── login.tsx
│   │           ├── ai-health.tsx
│   │           └── revenue.tsx
│   └── dist/               # Build output (Vite)
├── public/                 # 42 legacy HTML pages (migration in progress)
└── docs/                   # Documentation
    ├── AGENT_COMPANY.md    # This agent company structure
    ├── ORG_STRUCTURE.md    # 210-agent org (reference)
    ├── LAUNCH_PLAN.md      # 90-day launch plan
    └── DAILY_OPS.md        # Daily operations protocol

```

## 4. Key API Patterns

### Auth
- JWT access token (short-lived) + refresh token (rotated)
- PostgreSQL session store (connect-pg-simple)
- Role-based: candidate, recruiter, admin

### AI Provider Chain
```
Polsia AI Proxy → OpenAI/Anthropic/Gemini → NIM → Groq → Cerebras
```
- Circuit breaker: 3 failures → open, 60s → half-open
- Token budgeting: daily limits per module, priority throttling
- Video frames: uploaded to R2 first (base64 not supported)

### Database
- PostgreSQL pool: 25 max connections, 200ms slow query threshold
- pgvector: semantic search for job/candidate matching
- 105 tables, 16 domain groups

### Rate Limiting
- PostgreSQL-backed (NOT in-memory) — fixed June 5, 2026
- Distributed, survives restarts

## 5. Route Mount Order (Critical)

```javascript
// server.js — mount order matters
app.use('/api/interviews', quickPracticeRoutes)  // MUST be first
app.use('/api/interviews', interviewRoutes)      // Then main interviews
app.use('/api/omniscore', omniscoreRoutes)       // Canonical path
app.use('/api/candidate/omniscore', omniscoreRoutes)  // Compatibility shim
app.use('/api/recruiter/omniscore', omniscoreRoutes)  // Compatibility shim
```

**⚠️ quick-practice.js MUST mount before interviews.js at same path**

## 6. Frontend Routing

```
/                    → landing.tsx (public)
/login               → login.tsx (public)
/register            → register.tsx (public)
/pricing             → pricing.tsx (public)
/about               → about.tsx (public) — NEW
/contact             → contact.tsx (public) — NEW
/privacy             → privacy.tsx (public) — NEW
/terms               → terms.tsx (public) — NEW

/candidate/*         → DashboardLayout + 15 nested routes
  /dashboard         → candidate/dashboard.tsx
  /jobs              → candidate/jobs.tsx — NEW redesign
  /jobs/:id          → candidate/job-detail.tsx — NEW redesign
  /profile           → candidate/profile.tsx — NEW redesign
  /applications      → candidate/applications.tsx — updated
  /assessments       → candidate/assessments.tsx
  /interviews        → candidate/interviews.tsx
  /omniscore         → candidate/omniscore.tsx
  /screening         → candidate/screening.tsx
  /quick-practice    → candidate/quick-practice.tsx
  /mock-interview    → candidate/mock-interview.tsx
  /onboarding        → candidate/onboarding.tsx
  /payroll           → candidate/payroll.tsx
  /documents         → candidate/documents.tsx — PLACEHOLDER
  /settings          → candidate/settings.tsx

/recruiter/*         → DashboardLayout + 17 nested routes
  /dashboard         → recruiter/dashboard.tsx — NEW redesign
  /jobs              → recruiter/jobs.tsx — NEW redesign
  /jobs/new          → recruiter/job-form.tsx — NEW redesign
  /jobs/:id          → recruiter/job-form.tsx (edit mode)
  /candidates        → recruiter/candidates.tsx — NEW redesign
  /candidates/:id    → recruiter/candidate-detail.tsx
  /applicants        → recruiter/applicants.tsx
  /applicants/:id    → recruiter/applicant-detail.tsx
  /interviews        → recruiter/interviews.tsx
  /assessments       → recruiter/assessments.tsx
  /screening         → recruiter/screening.tsx — NEW redesign
  /offers            → recruiter/offers.tsx
  /onboarding        → recruiter/onboarding.tsx
  /analytics         → recruiter/analytics.tsx — NEW redesign
  /company           → recruiter/company.tsx
  /payroll           → recruiter/payroll.tsx
  /omniscore         → recruiter/omniscore.tsx
  /settings          → recruiter/settings.tsx

/admin/*             → 3 routes
  /login             → admin/login.tsx (public)
  /ai-health         → admin/ai-health.tsx (protected)
  /revenue           → admin/revenue.tsx (protected)
  /compliance        → admin/compliance.tsx — NEW
```

## 7. Component Library (shadcn/ui)

Available primitives:
- Button, Card, CardContent, CardHeader, CardTitle
- Input, Label, Textarea, Select
- Badge, Avatar, Progress
- Tabs, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
- **NEW:** Checkbox, Separator, Sheet, Slider, Switch, Tooltip
- **Custom:** cn() utility (clsx + tailwind-merge)

## 8. Known Issues (Pre-Existing)

| File | Line | Issue | Priority |
|------|------|-------|----------|
| recruiter/candidates.tsx | 206 | `success` property type mismatch | P1 |
| recruiter/candidates.tsx | 215 | `success` property type mismatch | P1 |
| settings.tsx | 612 | `Download` not imported | P1 |
| 11 legacy HTML pages | public/ | Need React migration | P2 |
| 3 placeholder pages | various | Need building | P0 |

## 9. Environment Variables (Render)

```
DATABASE_URL=postgresql://...neon.tech/neondb
JWT_SECRET=...
POLSIA_API_KEY=...
POLSIA_API_URL=...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
SMTP_HOST=...
SMTP_PORT=...
SMTP_USER=...
SMTP_PASS=...
```

**Missing for production:**
- Stripe LIVE keys (`STRIPE_SECRET_KEY=sk_live_...`)
- SMTP credentials (Postmark/SendGrid)
- Neon staging DB branch

## 10. Quick Commands

```bash
# Build
npm run build --prefix client

# Test
npm test

# Lint
npm run lint

# TypeScript check
npx tsc --noEmit -p client/tsconfig.json

# Deploy dev
npm run build --prefix client && git push origin dev

# Deploy staging
# (Render auto-deploys from staging branch)
```

## 11. Agent Work Rules

1. **Always checkout `dev` branch before work**
2. **Never push to `staging` or `main` directly**
3. **Branch flow:** dev → staging (review) → main (production)
4. **One agent, one file, one task** — never send 500+ line files to agents
5. **Pre-read context** — Suga (CTO) reads files, summarizes, sends snippet + context
6. **Build must pass** — `npm run build --prefix client` before any commit
7. **TypeScript errors ≤ 3** — pre-existing only, never introduce new ones

---

*For questions, escalate to Suga (CTO) or Ranga (CEO).*
*Update this file after any major architectural change.*
