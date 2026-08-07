# Rekrut AI Frontend Architecture Analysis

## Overview

The Rekrut AI frontend is a **React 19 + TypeScript + Vite + Tailwind CSS** single-page application (SPA) that serves as the main user interface for the recruitment platform. It replaced a legacy HTML/jQuery-based frontend and is now the sole frontend served by the Express backend.

---

## 1. Technology Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Framework | React | 19.0.0 | Latest major, uses StrictMode |
| Language | TypeScript | 5.7.0 | Full type coverage |
| Build Tool | Vite | 6.0.0 | Fast dev, proxy to backend |
| Styling | Tailwind CSS | 3.4.17 | Utility-first, dark mode ready |
| Router | React Router | 7.1.0 | Declarative routing |
| Icons | Lucide React | 0.469.0 | Consistent iconography |
| Components | CVA + Tailwind Merge | 0.7.1 / 2.6.0 | Variant-based UI components |

**Notable absence:** No state management library (Redux, Zustand, Jotai). All state is managed via React hooks and Context API.

---

## 2. Directory Structure

```
client/
├── src/
│   ├── main.tsx              # Entry point (StrictMode)
│   ├── App.tsx               # Root router + auth provider
│   ├── index.css             # Tailwind directives + custom CSS
│   ├── vite-env.d.ts         # Vite type declarations
│   │
│   ├── contexts/
│   │   └── auth-context.tsx  # Auth state + user context
│   │
│   ├── lib/
│   │   ├── api.ts            # HTTP client + token management
│   │   ├── utils.ts          # cn() helper (clsx + tailwind-merge)
│   │   └── analytics.ts      # Event tracking utility
│   │
│   ├── components/
│   │   ├── ui/               # Primitive UI components (10 files)
│   │   │   ├── button.tsx    # CVA-based variants
│   │   │   ├── card.tsx      # Card, CardHeader, CardTitle, etc.
│   │   │   ├── badge.tsx     # Status badges with variants
│   │   │   ├── input.tsx     # Form input
│   │   │   ├── textarea.tsx  # Form textarea
│   │   │   ├── select.tsx    # Native select wrapper
│   │   │   ├── label.tsx     # Form label
│   │   │   ├── tabs.tsx      # Custom Tabs (Context-based)
│   │   │   ├── dialog.tsx    # Modal overlay
│   │   │   └── avatar.tsx    # User avatar with fallback
│   │   │
│   │   ├── layout/
│   │   │   ├── dashboard-layout.tsx   # Shell: sidebar + header + main
│   │   │   ├── sidebar.tsx            # Navigation drawer
│   │   │   └── header.tsx             # Top bar + user dropdown
│   │   │
│   │   ├── error-boundary.tsx         # Global + per-route error handling
│   │   ├── admin-auth-guard.tsx       # Admin route protection
│   │   ├── ai-onboarding-dashboard.tsx
│   │   └── ai-onboarding-recruiter.tsx
│   │
│   └── pages/                # Route-level pages (66 .tsx files total)
│       ├── landing.tsx       # Marketing homepage (SEO-optimized)
│       ├── login.tsx         # Auth login
│       ├── register.tsx      # Auth registration
│       ├── forgot-password.tsx
│       ├── reset-password.tsx
│       ├── pricing.tsx       # Pricing page
│       ├── not-found.tsx     # 404 page
│       ├── placeholder.tsx   # Stub page for unimplemented routes
│       ├── test-camera.tsx   # Camera debugging
│       │
│       ├── candidate/        # 22 files - Candidate experience
│       │   ├── dashboard.tsx
│       │   ├── jobs.tsx      # Job board + AI search
│       │   ├── job-detail.tsx
│       │   ├── applications.tsx
│       │   ├── profile.tsx   # Complex multi-tab profile editor
│       │   ├── assessments.tsx
│       │   ├── assessment-take.tsx    # Anti-cheat protected
│       │   ├── job-assessment-take.tsx
│       │   ├── interviews.tsx
│       │   ├── ai-coaching.tsx        # AI interview coach (tabs)
│       │   ├── quick-practice.tsx
│       │   ├── mock-interview.tsx
│       │   ├── ai-coaching-progress.tsx
│       │   ├── coaching-types.ts
│       │   ├── coaching-utils.tsx
│       │   ├── offers.tsx
│       │   ├── onboarding.tsx
│       │   ├── payroll.tsx
│       │   ├── omniscore.tsx
│       │   └── screening.tsx # Public screening via invite link
│       │
│       ├── recruiter/        # 15 files - Recruiter/HR experience
│       │   ├── dashboard.tsx
│       │   ├── jobs.tsx       # Job management CRUD
│       │   ├── job-form.tsx   # Create/edit job
│       │   ├── job-applicants.tsx
│       │   ├── job-assessment.tsx
│       │   ├── applications.tsx
│       │   ├── assessments.tsx
│       │   ├── interviews.tsx
│       │   ├── offers.tsx
│       │   ├── onboarding.tsx
│       │   ├── analytics.tsx
│       │   ├── company.tsx
│       │   ├── payroll.tsx
│       │   └── omniscore.tsx
│       │
│       ├── admin/            # Admin pages
│       │   ├── login.tsx
│       │   ├── ai-health.tsx
│       │   └── revenue.tsx
│       │
│       └── debug/
│           └── mock-interview.tsx
│
├── tailwind.config.ts        # Custom theme (colors, fonts, radius)
├── vite.config.ts            # Build + dev proxy config
├── tsconfig.json             # TypeScript config
├── index.html                # HTML entry point
└── package.json
```

---

## 3. Component Architecture

### 3.1 UI Component Pattern (Shadcn-inspired)

All primitive UI components follow a consistent pattern:

- **Forward refs** for composability
- **CVA (class-variance-authority)** for variant management (Button, Badge)
- **cn() utility** for conditional class merging (`clsx` + `tailwind-merge`)
- **Compound components** where applicable (Card = Card + CardHeader + CardTitle + CardContent + CardFooter)

Example from `button.tsx`:
```tsx
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium...',
  {
    variants: {
      variant: { default: '...', destructive: '...', outline: '...', ghost: '...', link: '...' },
      size: { default: 'h-10 px-4', sm: 'h-9 px-3', lg: 'h-11 px-8', icon: 'h-10 w-10' },
    },
  }
)
```

### 3.2 Page Component Pattern

Pages are **function components** using:
- `useState` for local state
- `useEffect` for data loading
- `useCallback` for memoized handlers (especially in complex pages like AI Coaching)
- `useRef` for timers and DOM references

Data fetching pattern:
```tsx
const [data, setData] = useState(null)
const [loading, setLoading] = useState(true)

useEffect(() => {
  async function load() {
    try {
      const res = await apiCall<ApiResponseType>('/endpoint')
      setData(res)
    } catch { /* silent fail */ }
    finally { setLoading(false) }
  }
  load()
}, [])
```

### 3.3 Layout Architecture

```
BrowserRouter
└── AuthProvider
    └── ErrorBoundary (global)
        └── Routes
            ├── Public routes (landing, login, register, etc.)
            ├── /dashboard → RoleRedirect (candidate/recruiter)
            ├── /candidate → DashboardLayout
            │   └── Outlet → Candidate pages
            ├── /recruiter → DashboardLayout
            │   └── Outlet → Recruiter pages
            ├── /admin/* → AdminAuthGuard
            └── /debug/* → Debug pages
```

**DashboardLayout** provides:
- Sidebar (responsive drawer on mobile, fixed on desktop)
- Header (hamburger menu, role badge, notifications, user dropdown)
- Main content area with scrollable overflow
- Auth guard (redirects to /login if not authenticated)
- Accessibility: skip-to-content link, ARIA labels, keyboard navigation (Escape closes sidebar)

---

## 4. State Management

### 4.1 Auth State (Context API)

`AuthContext` manages:
- `user` object (id, email, name, role, company_name, avatar_url)
- `loading` flag
- `isAuthenticated` boolean
- `isRecruiter` derived from role
- `login()`, `register()`, `logout()` methods

**Key decision:** No initial auth check on page load. The auth context starts with `loading: false` and `user: null`. This prevents the "Session expired" flash that would occur on every page load. Auth is only validated when the user explicitly logs in.

### 4.2 Page-Level State

Each page manages its own state independently. No shared state library means:
- ✅ Simpler mental model
- ✅ No boilerplate
- ❌ No shared caching between pages
- ❌ Duplicate loading states
- ❌ Data refetching on every page visit

### 4.3 Form State

Forms use controlled inputs with local `useState`:
```tsx
const [email, setEmail] = useState('')
const [password, setPassword] = useState('')
const [error, setError] = useState('')
const [loading, setLoading] = useState(false)
```

---

## 5. API Integration

### 5.1 HTTP Client (`lib/api.ts`)

A thin wrapper around `fetch` with the following features:

- **Base URL:** Prepends `/api` to all requests
- **JWT Auth:** Automatically adds `Authorization: Bearer <token>` header
- **Token Refresh:** On 401 response, attempts to refresh via `/api/auth/refresh`
- **Automatic redirect:** If refresh fails, clears tokens and redirects to `/login`
- **Content-Type:** Auto-sets `application/json` unless `isFormData` is true
- **Type-safe:** Generic `apiCall<T>()` for typed responses

```typescript
export async function apiCall<T>(url: string, options: ApiCallOptions = {}): Promise<T>
```

### 5.2 Token Management

Tokens stored in `localStorage`:
- `rekrutai_token` — access token
- `rekrutai_refresh` — refresh token

Functions: `getToken()`, `setTokens()`, `clearTokens()`, `getRefreshToken()`

### 5.3 Role-Based Routing

```typescript
export type UserRole = 'candidate' | 'recruiter' | 'hiring_manager' | 'employer' | 'admin'

export function isRecruiterRole(role): boolean {
  return ['employer', 'recruiter', 'hiring_manager', 'admin'].includes(role)
}

export function getDashboardPath(role): string {
  return isRecruiterRole(role) ? '/recruiter' : '/candidate'
}
```

### 5.4 API Patterns by Feature Area

| Feature | Endpoint Pattern | Auth |
|---------|---------------|------|
| Auth | `/auth/login`, `/auth/register`, `/auth/refresh` | Skip auth check |
| Candidate Dashboard | `/candidate/dashboard/stats`, `/candidate/jobs/recommended` | JWT |
| Job Board | `/jobs?limit=5`, `/candidate/ai/smart-search` | JWT |
| Assessments | `/assessments/session/:id/current`, `/assessments/answer` | JWT |
| AI Coaching | `/interviews/practice/stats`, `/interviews/practice/library` | JWT |
| Recruiter | `/recruiter/dashboard`, `/recruiter/jobs` | JWT |
| Admin | `/admin/me`, `/admin/bridge` | Session cookie + bridge |
| Analytics | `/api/analytics/events` | Session ID header |

---

## 6. Routing Architecture

### 6.1 Route Structure

| Route | Component | Auth Required | Layout |
|-------|-----------|--------------|--------|
| `/` | LandingPage | No | None |
| `/login` | LoginPage | No (redirects if auth) | None |
| `/register` | RegisterPage | No | None |
| `/forgot-password` | ForgotPasswordPage | No | None |
| `/reset-password` | ResetPasswordPage | No | None |
| `/pricing` | PricingPage | No | None |
| `/screening/:token` | CandidateScreeningPage | No | None |
| `/dashboard` | RoleRedirect | Yes | Redirects |
| `/candidate/*` | Candidate pages | Yes | DashboardLayout |
| `/recruiter/*` | Recruiter pages | Yes | DashboardLayout |
| `/settings` | PlaceholderPage | Yes | DashboardLayout |
| `/admin/login` | AdminLoginPage | No | None |
| `/admin/*` | Admin pages | Yes (AdminAuthGuard) | None |
| `/debug/*` | Debug pages | No | None |
| `*` | NotFoundPage | No | None |

### 6.2 Error Boundaries

Two levels of error protection:
1. **Global `ErrorBoundary`** — Wraps entire app. Catches crashes, shows full-screen error UI with refresh button.
2. **Per-route `RouteErrorBoundary`** — Wraps each dashboard page. Catches page-level errors without crashing the whole app. Shows inline error with "Try Again" button.

```tsx
function Safe({ children }) {
  return <RouteErrorBoundary>{children}</RouteErrorBoundary>
}
// Used in every /candidate and /recruiter route
```

---

## 7. Styling Architecture

### 7.1 Tailwind Configuration

Custom theme extensions in `tailwind.config.ts`:
- **Colors:** HSL-based CSS variables (background, foreground, primary, secondary, muted, accent, card, destructive, border, input, ring)
- **Border radius:** CSS variable `--radius` (default 0.5rem)
- **Fonts:** `Inter` for body, `Space Grotesk` for headings
- **Dark mode:** `class` strategy (not actively used yet)

### 7.2 CSS Variables (`index.css`)

All colors defined as CSS custom properties in `:root`:
```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --primary: 221.2 83.2% 53.3%;
  /* ... */
  --radius: 0.5rem;
}
```

### 7.3 Mobile-First Utilities

Custom CSS utilities for mobile responsiveness:
- `.h-dvh-safe` — Dynamic viewport height (handles mobile browser chrome)
- `.touch-scroll` — iOS momentum scrolling
- `.scrollbar-hide` — Hidden scrollbars for horizontal nav
- `.pb-safe` — Safe area padding for notched devices
- Custom scrollbar styling (6px thin, rounded)
- Overscroll behavior controls (prevents iOS rubber-banding)

### 7.4 Component Styling Patterns

Consistent patterns observed:
- **Cards:** `rounded-xl border bg-card shadow-sm`
- **Stats cards:** Icon in colored circle (`bg-blue-100` + `text-blue-600`) + number + label
- **Quick actions:** Card with icon + title + description + arrow, hover shadow
- **Empty states:** Centered icon + text + optional CTA button
- **Loading:** `animate-spin` on `border-2 border-primary border-t-transparent`
- **Error:** `bg-destructive/10` + `text-destructive` + icon

---

## 8. Key Features & Complex Pages

### 8.1 AI Coaching Page (`candidate/ai-coaching.tsx`)

The most complex page. Features:
- **4 tabs:** Mock Interview, Quick Practice, Progress, History
- **Multiple data sources:** Stats, questions, progress, history, mock sessions
- **Parallel loading:** `Promise.all([...])` for initial data
- **Callback refresh:** Child components notify parent to refresh data after actions
- **Sub-components imported:** `QuickPractice`, `MockInterview`, `ProgressTab`, `HistoryTab`

### 8.2 Assessment Take Page (`candidate/assessment-take.tsx`)

Security-focused assessment UI:
- **Timer:** Countdown per question, auto-submits on expiry
- **Anti-cheat:** Tracks tab switches, copy/paste events via event listeners
- **Session storage:** Caches question data for page refresh resilience
- **Adaptive difficulty:** Shows max difficulty reached in results
- **Results:** Score, pass/fail, duration, integrity score, max difficulty

### 8.3 Candidate Jobs Page (`candidate/jobs.tsx`)

AI-powered job discovery:
- **Dual mode:** Standard search + AI smart search (natural language)
- **Match scoring:** Shows weighted score, skill match percentage, match level
- **Recommended jobs:** AI-matched top 5 jobs with match badges
- **Filtering:** Search, job type, location filters

### 8.4 Profile Page (`candidate/profile.tsx`)

Complex multi-section profile editor:
- **Tabs:** Profile, Experience, Education, Skills, Documents, Preferences
- **Inline editing:** Add/edit/delete experience, education, skills
- **File upload:** Resume upload with drag-and-drop
- **Avatar upload:** Image upload with preview
- **Form sections:** Personal info, social links, salary preferences, availability
- **Estimated 1200+ lines** — the largest page component

---

## 9. Migration Status (FRONTEND_MIGRATION.md)

### Completed ✅
- Landing page (Tailwind, fully migrated)
- React Router setup
- All candidate dashboard pages (React)
- All recruiter dashboard pages (React)
- Admin pages (React)
- Login/Register (React)
- AI Coaching, Assessments, Interviews, Onboarding, Payroll, OmniScore

### Legacy HTML Still in `/public/` (Not Served)
The server no longer serves HTML from `/public/`. These files are deprecated but still exist:
- `admin-analytics.html`, `compliance-dashboard.html`
- `candidate-*.html` (12 files)
- `recruiter-*.html` (10 files)
- `login.html`, `register.html`, `pricing.html`
- `css/` and `js/` folders

**Recommendation:** Safe to delete all `.html` files and `/css/`, `/js/` folders from `/public/`.

---

## 10. Notable Issues & Technical Debt

### 10.1 High Priority

1. **No global state management / data caching**
   - Every page refetches data on mount
   - No SWR, React Query, or Apollo for caching
   - Dashboard stats reload every time user navigates back
   - **Impact:** Unnecessary API calls, slower UX, loading flashes

2. **Silent error handling**
   - Most API calls use `catch { /* silent */ }` pattern
   - Users get no feedback when operations fail
   - Example: `deleteJob()`, `toggleJobStatus()` in recruiter/jobs.tsx
   - **Impact:** Poor UX, hard to debug production issues

3. **No form validation library**
   - All forms use manual validation (required attributes only)
   - No schema validation (Zod, Yup)
   - No field-level error messages
   - **Impact:** Inconsistent validation, brittle forms

4. **Type safety gaps**
   - Some API responses use `any` (e.g., `aiResults: any[]`)
   - `job_id` accessed via `(rj as any).job_id`
   - Mixed string/number types in API responses (e.g., `job_stats.active_jobs` is string but parsed as int)
   - **Impact:** Runtime errors, maintenance burden

### 10.2 Medium Priority

5. **Duplicate token keys**
   - `rekrutai_token` vs `hireloop_token` (legacy name still checked in `admin-auth-guard.tsx`)
   - Inconsistent naming between app token and admin session

6. **No loading skeletons**
   - Loading states use simple spinners everywhere
   - No content placeholders (skeleton UI)
   - **Impact:** Layout shift, perceived slowness

7. **Inline styles for dynamic colors**
   - `style={{ color: data.trust_score.tier_color }}` used instead of Tailwind classes
   - Breaks Tailwind's purging and dark mode consistency

8. **Analytics is fire-and-forget**
   - `trackEvent()` uses `fetch()` with `.catch(() => undefined)` — no retry, no queue
   - Events may be lost on network errors

### 10.3 Low Priority

9. **No component tests**
   - No testing framework configured (Jest, Vitest, Playwright)
   - No test files in the project

10. **No code splitting**
    - All routes bundled into single JS file
    - Vite `build.outDir` is `'dist'` with no chunking strategy
    - **Impact:** Large initial bundle, especially as app grows

11. **Missing admin pages**
    - `compliance-dashboard.html` was in legacy but no React equivalent exists
    - Admin routes only have: login, ai-health, revenue

12. **Debug routes in production**
    - `/debug/mock-interview` is accessible in production builds
    - Should be development-only or behind feature flag

13. **Legacy CSS/JS files still present**
    - `/public/css/` and `/public/js/` folders contain dead code
    - Increase build size and confusion

---

## 11. Accessibility (A11y)

### Positive
- Skip-to-content link in DashboardLayout
- ARIA labels on navigation buttons (`aria-label`, `aria-controls`, `aria-expanded`)
- Role attributes (`role="navigation"`, `role="menu"`, `role="menuitem"`)
- Focus-visible rings on interactive elements
- Keyboard navigation (Escape closes sidebar/dropdowns)
- Min touch targets (44px) on mobile buttons

### Gaps
- No `aria-live` regions for dynamic content updates
- No focus management on route changes
- Some icon-only buttons may lack visible labels (though most have `aria-label` or `title`)

---

## 12. Performance Observations

### Bundle
- Single JS bundle (`dist/assets/index-*.js`)
- Single CSS bundle (`dist/assets/index-*.css`)
- No lazy loading or code splitting
- No service worker for PWA capabilities

### Runtime
- No debouncing on search inputs (e.g., job search triggers on every keystroke, though filtering is client-side)
- API calls happen on every page mount (no caching)
- Images loaded directly (no optimization pipeline)

### Recommendations
1. Add React Query or SWR for server state caching
2. Implement `React.lazy()` + `Suspense` for route-level code splitting
3. Add `useDebounce` hook for search inputs
4. Configure Vite manual chunks for vendor libraries
5. Add image optimization (WebP, lazy loading)

---

## 13. Summary

The Rekrut AI frontend is a **modern, well-structured React SPA** that successfully replaced legacy HTML pages. It uses a clean component architecture with Shadcn-inspired UI primitives, consistent Tailwind styling, and a simple but effective auth system.

**Strengths:**
- Clean component architecture with consistent patterns
- Good TypeScript coverage (though some gaps)
- Mobile-first responsive design with thoughtful UX details
- Comprehensive error boundaries
- Good accessibility foundation
- Feature-complete: covers full recruitment lifecycle

**Weaknesses:**
- No data fetching/caching library (biggest gap)
- Silent error handling throughout
- No form validation library
- No testing infrastructure
- No code splitting
- Legacy files still present in repo

**Next architectural improvements should prioritize:**
1. Adding React Query or SWR for server state
2. Implementing proper error handling with user feedback
3. Adding Zod for form validation
4. Cleaning up legacy HTML/CSS/JS files
5. Adding route-level code splitting
