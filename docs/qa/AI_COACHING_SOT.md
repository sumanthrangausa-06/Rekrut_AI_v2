# AI Interview Coach — Source of Truth

> **Feature:** AI Interview Coaching (`/candidate/ai-coaching`)  
> **Type:** Candidate-facing feature  
> **Status:** Production-ready  
> **Last Updated:** 2026-08-08  
> **Related Issues:** [#74](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/74)

---

## Overview

The AI Interview Coach helps candidates practice interview responses with AI-powered feedback. It includes:
- **Quick Practice** — Practice answering individual questions
- **Mock Interview** — Full mock interview with video recording
- **Progress Tracking** — Stats and improvement over time
- **Session History** — Past practice sessions and scores

---

## Page Structure

### URL
`/candidate/ai-coaching`

### Route Definition
```typescript
// client/src/App.tsx (or router config)
{ path: '/candidate/ai-coaching', element: <AiCoachingPage /> }
```

### Component Architecture

```
AiCoachingPage (ai-coaching.tsx)
├── Header
│   ├── Icon (Video)
│   ├── Title: "AI Interview Coach"  ← <h1>
│   └── Subtitle: "Record video responses..."
├── Feature Highlights (3 cards)
│   ├── Video Recording
│   ├── Body Language AI
│   └── Speech Analysis
├── Tabs
│   ├── Quick Practice  → QuickPractice component
│   ├── Mock Interview  → MockInterview component
│   ├── Progress        → ProgressTab component
│   └── History         → HistoryTab component
```

### File Breakdown

| File | Purpose | Lines |
|------|---------|-------|
| `client/src/pages/candidate/ai-coaching.tsx` | Main page shell, tab router, data loading | ~250 |
| `client/src/pages/candidate/quick-practice.tsx` | Quick Practice tab content | ~200 |
| `client/src/pages/candidate/mock-interview.tsx` | Mock Interview tab content | ~300 |
| `client/src/pages/candidate/ai-coaching-progress.tsx` | Progress & History tabs | ~150 |
| `client/src/pages/candidate/coaching-types.ts` | TypeScript types | ~80 |
| `client/src/pages/candidate/coaching-utils.tsx` | Shared utilities | ~50 |

---

## Data Loading Behavior

### Loading Sequence

```
1. Page mounts → loading = true
2. Fire parallel requests:
   ├── GET /interviews/practice/stats
   ├── GET /interviews/practice/library
   ├── GET /interviews/practice/progress
   ├── GET /interviews/practice/recent
   └── GET /interviews/practice/history
3. All requests complete → loading = false
4. Content renders
```

### Loading State

```tsx
if (loading) {
  return (
    <div className='flex items-center justify-center py-20'>
      <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-primary' />
    </div>
  )
}
```

**Critical for E2E tests:** The heading `<h1>AI Interview Coach</h1>` is ONLY visible after `loading` becomes `false`. Tests must wait for `.animate-spin` to disappear.

### API Endpoints

| Endpoint | Method | Returns | Used By |
|----------|--------|---------|---------|
| `/interviews/practice/stats` | GET | PracticeStats | Header stats |
| `/interviews/practice/library` | GET | PracticeQuestion[] | Quick Practice |
| `/interviews/practice/progress` | GET | CategoryProgress[] | Progress tab |
| `/interviews/practice/recent` | GET | RecentSession[] | Progress tab |
| `/interviews/practice/history` | GET | HistorySession[] | History tab |

---

## E2E Test Reference

### Test File
`e2e/ai-coaching-flow.spec.ts`

### Key Test Pattern

```typescript
// Wait for loading spinner BEFORE checking content
await page.locator('.animate-spin').waitFor({ state: 'detached', timeout: 10000 })

// Then assert on page content
await expect(page.getByRole('heading', { name: /AI Interview Coach/i })).toBeVisible()
```

### Common Failures

| Failure | Cause | Fix |
|---------|-------|-----|
| Heading not found | Test checked before loading finished | Add `.animate-spin` wait |
| Timeout 5000ms | API slow, loading took >10s | Increase timeout or mock API |
| Tabs not clickable | Auth setup failed (401) | Check auth.setup.ts logs |

---

## Related Features

| Feature | Route | Relation |
|---------|-------|----------|
| Candidate Dashboard | `/candidate` | Links to AI Coaching |
| Interview History | `/candidate/history` | Links to AI Coaching |
| OmniScore | `/candidate/omniscore` | Links to AI Coaching |
| Job Interviews | `/candidate/interviews` | Links to AI Coaching |
