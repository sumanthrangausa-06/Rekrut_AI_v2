# Rekrut AI Architecture Merge Guide
## Merging Rekrut_AI (Full-Stack) into rekrutai (Frontend)

**Date:** February 20, 2026  
**Source:** `Rekrut_AI` (Node.js/Express) → **Target:** `rekrutai` (Vite/React/Supabase)

---

## 📋 Executive Summary

This guide documents the strategy for porting the Rekrut_AI full-stack architecture (Express.js backend + React frontend) into the rekrutai Vite/React/Supabase project. The goal is to preserve Rekrut_AI's AI-powered hiring platform features while leveraging rekrutai's modern frontend stack (TypeScript, Tailwind, shadcn/ui).

### Key Differences
| Aspect | Rekrut_AI | rekrutai |
|--------|-----------|----------|
| **Stack** | Node.js + Express + React SPA | Vite + React + TypeScript |
| **Database** | PostgreSQL (direct) | Supabase (PostgreSQL wrapper) |
| **Backend** | Express REST API | Supabase Edge Functions + Client |
| **Auth** | Session-based (PostgreSQL) | Supabase Auth |
| **Frontend** | React SPA (in `/client`) | Vite React (entire repo) |
| **AI** | Multi-provider (Anthropic, OpenAI, NVIDIA NIM) | Not implemented |
| **Build** | Manual deployment | Ready for Vercel/Netlify |

---

## 🏗️ Architecture Overview

### Rekrut_AI Backend Structure
```
Rekrut_AI/
├── server.js                 # Express entry point (500+ lines)
├── lib/                      # Core services (12 modules)
│   ├── ai-provider.js        # Multi-provider AI fallback (1500+ lines)
│   ├── db.js                 # PostgreSQL pool management
│   ├── auth.js               # Session auth middleware
│   ├── token-budget.js       # AI cost tracking
│   ├── activity-logger.js    # Audit logging
│   └── ...
├── routes/                   # REST API endpoints (20 files)
│   ├── interviews.js         # Mock interview (37 endpoints)
│   ├── quick-practice.js     # Quick practice (7 endpoints)
│   ├── assessments.js        # Assessments (22 endpoints)
│   ├── jobs.js               # Job management
│   ├── matching.js           # Job matching engine
│   ├── payroll.js            # Payroll system
│   ├── onboarding.js         # Onboarding (43 endpoints!)
│   └── ...
├── migrations/               # Database migrations (24 files)
│   ├── 001_add_omniscore.js
│   ├── 024_offer_letter_generation.js
│   └── ...
└── client/                   # React SPA (Vite + React)
    ├── src/
    │   ├── components/
    │   ├── pages/
    │   └── ...
    └── dist/                 # Build output
```

### rekrutai Structure
```
rekrutai/
├── src/                      # React source (all frontend)
│   ├── components/           # UI components
│   │   ├── ui/               # shadcn/ui components (43 files)
│   │   ├── Hero.tsx
│   │   ├── WaitlistForm.tsx
│   │   └── ...
│   ├── pages/
│   │   ├── Index.tsx         # Landing page
│   │   ├── Login.tsx
│   │   └── SignUp.tsx
│   ├── hooks/
│   ├── integrations/supabase/
│   └── lib/utils.ts
├── supabase/
│   └── functions/            # Edge Functions (basic)
│       ├── waitlist/
│       ├── companies/
│       └── ...
└── package.json
```

---

## 🔀 Merge Strategy: Three Approaches

### Option 1: Backend-as-a-Service (Recommended)

**Concept:** Keep Rekrut_AI running as backend API, rekrutai becomes new frontend

**Implementation:**
1. Deploy Rekrut_AI as API service (e.g., `api.example.com`)
2. Keep rekrutai as-is but add API client layer
3. Replace Supabase calls with Rekrut_AI API calls
4. Migrate UI components from Rekrut_AI/client → rekrutai

**Pros:**
- Fastest path to production
- Preserves battle-tested backend
- No database migration needed

**Cons:**
- Two separate codebases to maintain
- CORS/auth complexity

**File Changes:**
```
rekrutai/
├── src/
│   ├── api/                  # NEW: API client service
│   │   ├── client.ts         # Axios/fetch wrapper
│   │   ├── interviews.ts     # Interview API calls
│   │   ├── auth.ts           # Auth API calls
│   │   └── ...
│   └── ...
```

---

### Option 2: Supabase Edge Functions Migration

**Concept:** Port Express routes to Supabase Edge Functions (Deno runtime)

**Implementation:**
1. Convert each Express route to Supabase Edge Function
2. Port PostgreSQL queries to work with Supabase
3. Migrate AI provider logic to Edge Functions
4. Keep rekrutai frontend, swap database layer

**Edge Function Mapping:**

| Express Route (Rekrut_AI) | Supabase Function (rekrutai) |
|---------------------------|------------------------------|
| `routes/interviews.js` | `supabase/functions/interviews/index.ts` |
| `routes/assessments.js` | `supabase/functions/assessments/index.ts` |
| `routes/quick-practice.js` | `supabase/functions/quick-practice/index.ts` |
| `lib/ai-provider.js` | `supabase/functions/ai-proxy/index.ts` |
| `lib/db.js` | Use Supabase client directly |

**Pros:**
- Unified TypeScript codebase
- Edge deployment (low latency)
- Uses rekrutai architecture fully

**Cons:**
- Massive rewrites (20+ route files)
- Edge function limitations (timeout, memory)
- AI provider compatibility (no Node.js modules)

**Challenge:** `lib/ai-provider.js` (1500+ lines) uses Node.js specific modules (OpenAI SDK, Anthropic SDK, fs, FormData). Requires either:
- Using Deno-compatible HTTP clients
- Or proxying to external AI service

---

### Option 3: Monorepo Hybrid (Most Ambitious)

**Concept:** Merge into single codebase with clear frontend/backend separation

**Structure:**
```
rekrutai-v2/
├── apps/
│   ├── frontend/             # rekrutai current code
│   │   ├── src/
│   │   └── package.json
│   └── backend/              # Rekrut_AI server code
│       ├── src/
│       │   ├── server.ts     # Convert to TypeScript
│       │   ├── routes/
│       │   ├── lib/
│       │   └── migrations/
│       └── package.json
├── packages/
│   └── shared-types/         # Shared TypeScript definitions
└── package.json              # Workspace root
```

**Migration Steps:**
1. Set up monorepo (Turborepo/Nx/pnpm workspaces)
2. Move rekrutai to `apps/frontend/`
3. Port Rekrut_AI to TypeScript in `apps/backend/`
4. Create shared types package
5. Update frontend to use backend API

**Pros:**
- Clean separation of concerns
- Shared types between frontend/backend
- Scalable architecture

**Cons:**
- Most time-consuming
- Complex build/deployment setup

---

## 🔧 Detailed Implementation: Option 1 (Recommended)

### Phase 1: API Client Layer

**Create:** `src/api/client.ts`
```typescript
// API configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://api.example.com';

// Interceptor pattern matching Rekrut_AI auth
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('session');
  if (token) config.headers['Cookie'] = `connect.sid=${token}`;
  return config;
});
```

**Create:** `src/api/interviews.ts`
```typescript
// Ported from routes/interviews.js
export const startMockInterview = (data: InterviewStartData) => 
  apiClient.post('/api/interviews/start', data);

export const getInterview = (id: string) => 
  apiClient.get(`/api/interviews/${id}`);

export const submitVideoAnalysis = (data: VideoData) =>
  apiClient.post('/api/interviews/video-analysis', data);
```

### Phase 2: Component Migration

**Rekrut_AI Client → rekrutai:**

| Source (Rekrut_AI/client) | Target (rekrutai) |
|---------------------------|-------------------|
| `client/src/pages/Interview.tsx` | `src/pages/Interview.tsx` |
| `client/src/pages/QuickPractice.tsx` | `src/pages/Practice.tsx` |
| `client/src/components/CameraFeed.tsx` | `src/components/CameraFeed.tsx` |
| `client/src/components/VoiceRecorder.tsx` | `src/components/VoiceRecorder.tsx` |
| `client/src/hooks/useInterview.tsx` | `src/hooks/useInterview.ts` |

### Phase 3: UI Modernization

**Replace legacy components with shadcn/ui:**

```typescript
// Before (Rekrut_AI/client)
<div className="btn btn-primary">Start Interview</div>

// After (rekrutai with shadcn)
import { Button } from "@/components/ui/button";
<Button variant="default">Start Interview</Button>
```

**Add Radix-based animations from rekrutai:**
```
src/components/
├── ui/                       # shadcn (already exists)
├── animation/                # NEW from rekrutai
│   ├── ScrollReveal.tsx
│   ├── MagneticButton.tsx
│   └── KineticText.tsx
└── ...
```

### Phase 4: Feature Integration

**Migrate core features:**

1. **Auth System**
   - Replace Supabase Auth with Rekrut_AI session auth
   - Update Login.tsx and SignUp.tsx to call `/api/auth/*`

2. **Mock Interviews**
   - Create new route: `src/pages/Interview.tsx`
   - Port camera + audio handling from Rekrut_AI/client
   - Integrate AI provider fallback logic via API

3. **Assessments**
   - Create: `src/pages/Assessment.tsx`
   - Port question rendering from Rekrut_AI
   - Connect to `/api/assessments/*`

4. **Quick Practice**
   - Create: `src/pages/Practice.tsx`
   - Port from `routes/quick-practice.js` frontend
   - Call API instead of direct AI

5. **Admin Dashboard**
   - Port analytics components
   - Replace with shadcn/ui components (tables, charts)

---

## 🗄️ Database Migration Guide

### For Option 2 (Supabase Migration):

**Schema Mapping:**

Rekrut_AI uses raw PostgreSQL. Migration to Supabase:

```sql
-- In Supabase SQL Editor, run Rekrut_AI migrations:
\i 001_add_omniscore.sql
\i 002_add_trustscore.sql
-- ... all 24 migrations
```

**Supabase-ify tables:**

```sql
-- Add RLS policies (Rekrut_AI uses middleware auth)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own data" 
ON users FOR SELECT 
USING (id = auth.uid());
```

**Edge Function Structure:**

```typescript
// supabase/functions/interviews/index.ts
import { serve } from 'https://deno.land/std@0.204.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  // Port from routes/interviews.js
  const { data, error } = await supabase
    .from('interviews')
    .select('*')
    .eq('candidate_id', userId)
  
  return new Response(JSON.stringify({ data }))
})
```

---

## 🤖 AI Provider Integration

### Challenge: 1500-line `lib/ai-provider.js`

**Key Features to Preserve:**
1. Multi-provider failover (Polsia → OpenAI → NVIDIA NIM)
2. Timeout cascade (12-20s max per modality)
3. Circuit breaker pattern
4. Token budget tracking
5. Module-specific routing

### Integration Options:

**Option A: Keep in Backend**
- Keep original ai-provider.js in running backend
- Frontend makes API calls, backend handles AI
- No changes to AI logic

**Option B: Extract to Service**
- Create standalone AI service
- Deploy as separate container/function
- Both apps call this service
- Easier to scale/manage AI costs

**Option C: Port to Supabase (Option 2 only)**
- Use Deno-compatible HTTP clients
- Replace Node.js SDK with raw fetch
- Challenge: SDKs use Node-specific crypto/streams

**Recommended:** Option A for Option 1 migration, Option B for long-term

---

## 🚀 Deployment Strategy

### Option 1 Deployment:
```
                  ┌─────────────────┐
     User ───────►│   rekrutai      │  (Vercel/Netlify)
                  │   (Frontend)    │
                  └────────┬────────┘
                           │
                     ┌─────▼─────┐
                     │Rekrut_AI  │  (Render/DigitalOcean)
                     │(Backend)  │
                     └─────┬─────┘
                           │
                    ┌──────▼──────┐
                    │PostgreSQL   │
                    └─────────────┘
```

**CORS Setup in Rekrut_AI:**
```javascript
// Already exists in server.js
cors({
  origin: true,  // Allow rekrutai domain
  credentials: true,
})
```

### Environment Variables:

**rekrutai (.env):**
```
VITE_API_URL=https://api.rekrutai.com
VITE_SUPABASE_URL=... (can remove if fully migrated)
```

**Rekrut_AI (.env - existing):**
```
DATABASE_URL=postgresql://...
POLSIA_API_KEY=...
NIM_API_KEY=...
SESSION_SECRET=...
```

---

## ⏱️ Estimated Effort

| Task | Hours (Option 1) | Hours (Option 2) | Hours (Option 3) |
|------|------------------|------------------|------------------|
| Setup API client layer | 8 | N/A | 8 |
| Port Express routes | N/A | 160 (20 routes × 8h) | 80 |
| Port AI provider | N/A | 40 | 20 |
| Database migration | N/A | 24 | 16 |
| Component migration | 40 | 40 | 40 |
| UI modernization | 20 | 20 | 20 |
| Auth system | 16 | 16 | 16 |
| Testing | 24 | 40 | 32 |
| **Total** | **108** | **300** | **232** |

---

## 🔒 Security Considerations

1. **API Key Exposure**
   - Rekrut_AI stores AI keys server-side ✅
   - Don't move keys to frontend
   - Keep AI provider in backend

2. **Session Management**
   - Option 1: Keep existing session-based auth
   - Option 2: Migrate to Supabase Auth (major change)
   - Option 3: Can keep either

3. **CORS Origins**
   - Add explicit whitelist for rekrutai domain
   - Don't use `origin: true` in production

4. **Rate Limiting**
   - Add rate limiter to all API endpoints
   - Implement in Rekrut_AI middleware or API gateway

---

## 🎯 Recommended Next Steps

### Immediate (Week 1):
1. ✅ **Choose Option 1** (Backend-as-a-Service)
2. Deploy Rekrut_AI to staging environment
3. Create API client layer in rekrutai
4. Test `/api/health` endpoint

### Short-term (Weeks 2-4):
1. Port auth flow (Login/Signup)
2. Migrate interview start page
3. Copy camera/audio components
4. Test end-to-end interview flow

### Medium-term (Months 2-3):
1. Migrate remaining features:
   - Quick practice
   - Assessments
   - Job matching
   - Admin dashboard
2. UI modernization with shadcn/ui
3. Animation integration
4. Performance optimization

### Long-term (Month 4+):
1. Consider Option 2 or 3 for better scalability
2. Extract AI service independently
3. Add real-time features (WebSocket)
4. Mobile app integration

---

## 📚 Appendix: File Mapping

### Critical Files to Port

**Backend (stay in Rekrut_AI):**
- ✅ Keep `lib/ai-provider.js` (1500 lines, critical)
- ✅ Keep `lib/db.js` (PostgreSQL pool)
- ✅ Keep `routes/interviews.js` (37 endpoints)
- ✅ Keep `routes/quick-practice.js` (isolated practice)
- ✅ Keep all migrations

**Frontend (migrate to rekrutai):**
- 📦 Port `client/src/pages/` → `src/pages/`
- 📦 Port `client/src/components/` → `src/components/`
- 📦 Port `client/src/hooks/` → `src/hooks/`
- 📦 Port `client/src/utils/` → `src/lib/`

**Assets to migrate:**
- 📷 Public images from `client/public/`
- 🎨 Logo and branding assets
- 🔊 Default TTS audio files (if any)

---

## 🧪 Testing Strategy

1. **Unit Tests**
   - Port from Rekrut_AI (if any) to Vitest/Jest
   - Test API client layer

2. **Integration Tests**
   - Test API connectivity
   - Test auth flow
   - Test interview creation → completion

3. **E2E Tests**
   - Playwright/Cypress for critical paths:
     - Login → Start Interview → Complete
     - Quick Practice flow
     - Assessment flow

---

**Document Version:** 1.0  
**Last Updated:** February 20, 2026

---

## 💡 Author's Recommendation

After analyzing both the existing architecture (from `ARCHITECTURE_CURRENT.md` and `ARCHITECTURE_TARGET.md`) and the merge options, here is my specific recommendation:

### ✅ Go with Option 1: Backend-as-a-Service

**Why this is the right choice for your situation:**

1. **You've Already Done the Hard Work**
   - Rekrut_AI has a mature, battle-tested backend with 351 API endpoints
   - Schema hardening (P0–P3) is complete with 105 tables, 386 indexes, and 56 CHECK constraints
   - The AI provider architecture (`lib/ai-provider.js`) with multi-provider failover is production-ready
   - Quick Practice and Mock Interview are already isolated (#32717)

2. **Frontend Migration is Already Underway**
   - Per `FRONTEND_MIGRATION.md`, you're already deprecating 42 legacy HTML pages
   - The React SPA in `client/` is the new frontend direction
   - You just need to port these React pages to the rekrutai codebase

3. **Avoid Massive Rewrites**
   - Option 2 requires rewriting 1500+ lines of AI provider code for Deno
   - Option 3 requires TypeScript conversion and monorepo setup
   - Option 1 lets you keep working code and focus on UI

4. **Aligns with Target Architecture Goals**
   - `ARCHITECTURE_TARGET.md` emphasizes splitting monolithic files
   - Keeping backend separate lets you split `routes/interviews.js` (2691 lines) and `routes/onboarding.js` (3119 lines) independently
   - Frontend can proceed with component extraction (quick-practice, mock-interview, ai-coaching-progress)

5. **Risk-Mitigation**
   - Rekrut_AI is already deployed and serving users
   - API-first approach lets you incrementally migrate features
   - If something breaks, you can roll back just the frontend

### 🎯 Specific Action Plan

**Week 1: Setup**
```bash
# 1. Deploy Rekrut_AI to a stable URL
npm run build
git push origin main  # Already done

# 2. In rekrutai project, create API client
mkdir -p src/api
touch src/api/client.ts
```

**Week 2: Authentication Bridge**
- Port Login.tsx from `Rekrut_AI/client/src/pages/login.tsx` → `rekrutai/src/pages/Login.tsx`
- Update to call `/api/auth/login` instead of Supabase
- Test session persistence with cookies

**Week 3: Interview Feature (MVP)**
- Port `client/src/pages/candidate/mock-interview.tsx` → `rekrutai/src/pages/Interview.tsx`
- Copy camera/audio hooks
- Test end-to-end with backend

**Week 4: Quick Practice**
- Port `client/src/pages/candidate/quick-practice.tsx` → `rekrutai/src/pages/Practice.tsx`
- Note: Quick Practice has its own isolated API path (per ARCHITECTURE_CURRENT.md)

**Month 2+:**
- Port remaining pages using the file mappings in this guide
- Modernize UI with shadcn/ui components (both projects use them)
- Add animations from rekrutai's animation library

### ⚠️ What NOT To Do

1. **Don't migrate to Supabase Edge Functions yet** — The AI provider code depends on Node.js-specific modules (OpenAI SDK, file system operations). Porting this to Deno is a 40-hour project that adds risk without benefit.

2. **Don't combine the codebases into a monorepo yet** — Wait until you've proven the API integration works and the UI is stable. Monorepo adds complexity that slows you down.

3. **Don't skip the legacy HTML cleanup** — Finish deprecating the 42 HTML files in `public/` (per `FRONTEND_MIGRATION.md`) before adding new rekrutai pages. You want one clear frontend path.

### 🚦 Decision Gates

Before proceeding past each phase, verify:

| Phase | Gate | Verification |
|-------|------|--------------|
| Week 1 | API connectivity | `curl https://your-api.com/api/health` returns 200 |
| Week 2 | Auth working | Login persists across page reloads |
| Week 3 | Interview MVP | Can start and complete one interview |
| Week 4 | Feature parity | Quick Practice and Mock Interview both work |

### 📊 Success Metrics

- API response time < 500ms (p95)
- Interview completion rate maintained
- Zero AI provider errors (circuit breaker working)
- Mobile responsive (already done per #32856)

### 🔮 Future Considerations

Once Option 1 is stable and serving users, consider:
- **Extract AI Service** (Option B) for better cost tracking and scaling
- **Real-time features** using WebSocket (currently polling in Rekrut_AI)
- **Mobile app** using the same API layer

---

**Summary:** Use Rekrut_AI as your backend API, port the React pages to rekrutai, and get to production fast. You've already built a solid foundation — don't rebuild it, reuse it.

*— Analysis based on ARCHITECTURE_CURRENT.md, ARCHITECTURE_TARGET.md, and FRONTEND_MIGRATION.md as of February 20, 2026*