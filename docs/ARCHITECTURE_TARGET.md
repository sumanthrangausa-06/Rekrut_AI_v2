# HireLoop — Target Architecture

**Last Audited:** Feb 14, 2026

## Goals
1. **One file per feature** — no 3000-line monoliths
2. **Null-safe AI pipeline** — graceful degradation when providers fail ✅ (completed Feb 14)
3. **Clean separation** — Quick Practice, Mock Interview, and Progress are independent modules
4. **Independently testable** — each feature can be tested without loading the entire app

---

## Frontend Target Structure

```
client/src/
├── pages/
│   ├── candidate/
│   │   ├── ai-coaching.tsx          # Tab router only — imports sub-pages
│   │   ├── quick-practice.tsx       # Quick Practice (isolated)
│   │   ├── mock-interview.tsx       # Mock Interview (isolated)
│   │   ├── ai-coaching-progress.tsx # Progress + History tracking
│   │   ├── dashboard.tsx
│   │   ├── profile.tsx
│   │   ├── jobs.tsx
│   │   ├── job-detail.tsx
│   │   ├── assessments.tsx
│   │   ├── assessment-take.tsx
│   │   ├── job-assessment-take.tsx  # Job-specific assessment taking
│   │   ├── interviews.tsx
│   │   ├── applications.tsx
│   │   ├── offers.tsx
│   │   ├── omniscore.tsx
│   │   ├── onboarding.tsx
│   │   ├── payroll.tsx
│   │   └── screening.tsx           # External screening (routed at /screening/:token)
│   ├── recruiter/
│   │   ├── dashboard.tsx
│   │   ├── jobs.tsx
│   │   ├── job-form.tsx            # Create + Edit job (reused for both routes)
│   │   ├── job-applicants.tsx      # View applicants (reused for /jobs/:id and /jobs/:id/applicants)
│   │   ├── job-assessment.tsx      # Job-level assessment management
│   │   ├── applications.tsx
│   │   ├── assessments.tsx
│   │   ├── interviews.tsx
│   │   ├── offers.tsx
│   │   ├── onboarding.tsx
│   │   ├── payroll.tsx
│   │   ├── company.tsx
│   │   ├── omniscore.tsx
│   │   ├── candidates.tsx          # Replace placeholder with real candidate search
│   │   └── analytics.tsx           # Replace placeholder with real analytics
│   ├── admin/
│   │   ├── login.tsx
│   │   └── ai-health.tsx
│   ├── debug/
│   │   └── mock-interview.tsx      # Debug tool (keep for development)
│   ├── landing.tsx
│   ├── login.tsx
│   ├── register.tsx
│   ├── test-camera.tsx
│   └── placeholder.tsx             # Generic placeholder (remove when all pages implemented)
├── components/
│   ├── ui/           # shadcn/ui primitives
│   ├── layout/       # dashboard-layout, header, sidebar
│   ├── coaching/     # Shared coaching UI components
│   │   ├── score-bar.tsx
│   │   ├── feedback-section.tsx
│   │   ├── video-recorder.tsx
│   │   └── camera-preview.tsx
│   └── shared/       # Error boundary, loading states
├── hooks/
│   ├── use-camera.ts        # Camera stream management
│   ├── use-recording.ts     # Media recording + frame capture
│   ├── use-speech.ts        # Speech recognition
│   ├── use-voice-mode.ts    # Voice interview mode
│   └── use-coaching-api.ts  # API calls for coaching features
├── contexts/
│   └── auth-context.tsx
├── lib/
│   ├── api.ts
│   └── utils.ts
├── App.tsx
└── main.tsx
```

### Key Changes from Current State
- **ai-coaching.tsx** (currently 4044 lines) becomes a thin tab router (< 100 lines)
- **quick-practice.tsx** owns all Quick Practice state, recording, and submission
- **mock-interview.tsx** owns all Mock Interview state, voice mode, and session management
- **ai-coaching-progress.tsx** owns progress stats and session history
- **coaching-types.ts** and **coaching-utils.tsx** already extracted (Feb 14) — continue using
- **Shared hooks** extracted for camera, recording, speech recognition
- **Shared components** for score display, feedback sections, video recorder
- **3 placeholder routes replaced** with real implementations (candidates, analytics, documents)

---

## Backend Target Structure

### AI Pipeline (✅ Null-safety completed Feb 14)
```
lib/
├── polsia-ai.js          # Null-safe wrappers — ALL AI function returns validated ✅
├── ai-provider.js         # Provider abstraction (needs splitting — 2287 lines)
├── ai-call-logger.js      # Logging (unchanged)
├── self-hosted-audio.js   # Piper TTS audio (unchanged)
└── ai-response-validator.js  # FUTURE: Centralized AI JSON response validation
```

**Null-safety pattern — COMPLETED Feb 14:**
```javascript
// allSettled checks now validate value != null
const coaching = (settled[1].status === 'fulfilled' && settled[1].value != null)
  ? settled[1].value
  : fallback;
```

### Route Organization (Future — Priority: High)

Current monolith route files that need splitting:

| Current File | Lines | Target Split |
|-------------|-------|-------------|
| `routes/interviews.js` | 3190 | → `interviews/practice.js`, `interviews/mock.js`, `interviews/scheduling.js` |
| `routes/onboarding.js` | 3119 | → `onboarding/documents.js`, `onboarding/plans.js`, `onboarding/forms.js` |
| `routes/candidate.js` | 2230 | → `candidate/profile.js`, `candidate/applications.js`, `candidate/skills.js` |
| `routes/assessments.js` | 1898 | → `assessments/management.js`, `assessments/grading.js` |
| `routes/recruiter.js` | 1850 | → `recruiter/dashboard.js`, `recruiter/jobs.js`, `recruiter/analytics.js` |

### ai-provider.js Split (Future — Priority: Medium)
Currently 2287 lines. Target:
```
lib/
├── ai-provider.js          # Core provider abstraction + circuit breaker (~500 lines)
├── ai-providers/
│   ├── openai.js           # OpenAI/Polsia proxy provider
│   ├── nim.js              # NVIDIA NIM models
│   ├── groq.js             # Groq provider
│   ├── cerebras.js         # Cerebras provider
│   └── vision.js           # Vision-specific providers
└── ai-circuit-breaker.js   # Circuit breaker logic (extracted)
```

### Database Schema Organization (Future)
- Fix 5 tables with incorrect company_id FK
- Clean up 43% zombie mock_interview_sessions
- Add indexes for common query patterns
- Standardize `role` values (employer → recruiter)

---

## Migration Strategy

### Phase 1: Split ai-coaching.tsx (Next Priority)
1. ~~Fix null-safety in `lib/polsia-ai.js`~~ ✅ Completed Feb 14
2. ~~Extract types to `coaching-types.ts`~~ ✅ Completed Feb 14
3. ~~Extract utils to `coaching-utils.tsx`~~ ✅ Completed Feb 14
4. Extract Quick Practice into `quick-practice.tsx`
5. Extract Mock Interview into `mock-interview.tsx`
6. Extract Progress/History into `ai-coaching-progress.tsx`
7. Keep `ai-coaching.tsx` as thin tab router

### Phase 2: Extract Shared Hooks
- Camera management → `use-camera.ts`
- Recording → `use-recording.ts`
- Speech recognition → `use-speech.ts`

### Phase 3: Backend Route Splitting
- Split `routes/interviews.js` (3190 lines) into practice/mock/scheduling
- Split `routes/onboarding.js` (3119 lines) into documents/plans/forms
- Split `routes/candidate.js` (2230 lines) by domain
- Split `routes/assessments.js` (1898 lines) into management/grading
- Split `routes/recruiter.js` (1850 lines) by domain

### Phase 4: ai-provider.js Split
- Extract each provider into its own file
- Separate circuit breaker logic
- Target: core abstraction under 500 lines

### Phase 5: Legacy Cleanup
- Remove 42 legacy HTML pages as React SPA covers all routes
- Remove legacy JS/CSS files
- Replace 3 placeholder pages with real implementations

---

## Changelog

| Date | Change |
|------|--------|
| Feb 14, 2026 | **Audit & corrections:** Updated null-safety status to completed. Added missing files (job-assessment-take.tsx, job-assessment.tsx, screening.tsx, debug/, test-camera, placeholder). Fixed all line counts to match reality. Added ai-provider.js split plan (was undocumented despite being largest backend file at 2287 lines). Added backend route splitting priorities with actual line counts. Updated Phase 1 with completion status for steps 1-3. Added Phase 4 for ai-provider.js split. Updated legacy page count (39→42). Added target for replacing placeholder routes. |
