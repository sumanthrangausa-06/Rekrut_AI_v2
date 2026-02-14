# HireLoop — Target Architecture

## Goals
1. **One file per feature** — no 3000-line monoliths
2. **Null-safe AI pipeline** — graceful degradation when providers fail
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
│   │   ├── interviews.tsx
│   │   ├── applications.tsx
│   │   ├── offers.tsx
│   │   ├── omniscore.tsx
│   │   ├── onboarding.tsx
│   │   ├── payroll.tsx
│   │   └── screening.tsx
│   ├── recruiter/
│   │   └── (same structure, 1 file per page)
│   ├── admin/
│   │   ├── login.tsx
│   │   └── ai-health.tsx
│   ├── login.tsx
│   ├── register.tsx
│   └── landing.tsx
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

### Key Changes
- **ai-coaching.tsx** becomes a thin tab router (< 100 lines)
- **quick-practice.tsx** owns all Quick Practice state, recording, and submission
- **mock-interview.tsx** owns all Mock Interview state, voice mode, and session management
- **ai-coaching-progress.tsx** owns progress stats and session history
- **Shared hooks** extracted for camera, recording, speech recognition
- **Shared components** for score display, feedback sections, video recorder

---

## Backend Target Structure

### AI Pipeline (Priority Fix)
```
lib/
├── polsia-ai.js          # Null-safe wrappers — ALL AI function returns validated
├── ai-provider.js         # Provider abstraction (unchanged)
├── ai-call-logger.js      # Logging (unchanged)
└── ai-response-validator.js  # NEW: Validate AI JSON responses before returning
```

**Null-safety pattern for all AI analysis functions:**
```javascript
// Before (current — crashes when AI returns null):
const coaching = settled[1].status === 'fulfilled' ? settled[1].value : fallback;

// After (target — null-safe):
const coaching = (settled[1].status === 'fulfilled' && settled[1].value != null)
  ? settled[1].value
  : fallback;
```

### Route Organization (Future)
```
routes/
├── interviews/
│   ├── practice.js      # Quick practice endpoints
│   ├── mock.js           # Mock interview endpoints
│   └── scheduling.js     # Interview scheduling
├── candidate/
│   ├── profile.js
│   ├── applications.js
│   └── skills.js
├── recruiter/
│   ├── dashboard.js
│   ├── jobs.js
│   └── analytics.js
├── auth.js
├── jobs.js
└── admin.js
```

### Database Schema Organization (Future)
- Fix 5 tables with incorrect company_id FK
- Clean up 43% zombie mock_interview_sessions
- Add indexes for common query patterns
- Standardize `role` values (employer → recruiter)

---

## Migration Strategy

### Phase 1 (Current Task): Split ai-coaching.tsx
1. Extract Quick Practice into `quick-practice.tsx`
2. Extract Mock Interview into `mock-interview.tsx`
3. Extract Progress/History into `ai-coaching-progress.tsx`
4. Keep `ai-coaching.tsx` as thin tab router
5. Fix null-safety in `lib/polsia-ai.js`

### Phase 2 (Future): Extract Shared Hooks
- Camera management → `use-camera.ts`
- Recording → `use-recording.ts`
- Speech recognition → `use-speech.ts`

### Phase 3 (Future): Backend Route Splitting
- Split `routes/interviews.js` (3190 lines) into practice/mock/scheduling
- Split `routes/candidate.js` (46 endpoints) by domain

### Phase 4 (Future): Legacy Cleanup
- Remove 39 legacy HTML pages as React SPA covers all routes
- Remove legacy JS/CSS files
