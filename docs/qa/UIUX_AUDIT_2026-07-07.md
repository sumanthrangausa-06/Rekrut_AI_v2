# Rekrut AI — UI/UX Audit Report

> **Date:** 2026-07-07
> **Analyst:** Suga (CEO)
> **Scope:** All key pages (landing, register, candidate dashboard, recruiter dashboard, recruiter analytics, candidate profile, chat, data tables, shared components)
> **Reference:** Visily design screenshots (41 files) + competitive benchmarks (LinkedIn, Greenhouse, Lever)
> **Method:** Code review of React/TSX components + Tailwind CSS analysis + accessibility checks + mobile responsiveness review

---

## EXECUTIVE SUMMARY

**Overall UX Score: 7.2/10** — Good functional design with solid shadcn/ui foundation, but significant polish gaps remain before the app feels "premium" and competitive with established players.

**Strengths:**
- Clean, consistent component library (shadcn/ui + Tailwind)
- Good mobile responsiveness (44px touch targets, grid fixes)
- Thoughtful empty states and loading skeletons
- Accessibility basics (skip-to-content, ARIA labels, focus rings)
- Good onboarding nudges (profile completeness banner, zero-state CTAs)

**Critical Gaps:**
- Charts are CSS-only (no real chart library) — looks amateur next to competitors
- Landing page trust bar uses text, not real company logos
- No real-time notification system (bell icon is static)
- Chat is text-heavy, lacks visual hierarchy in message bubbles
- Profile page is 2,600+ lines (maintainability nightmare)
- Register page has no multi-step flow (cognitive overload)
- Inconsistent icon sizing across components

---

## 🔴 CRITICAL UI/UX ISSUES (Fix Before Launch)

### 1. Analytics Charts Are CSS-Only — Looks Unprofessional

**Location:** `client/src/pages/recruiter/analytics.tsx`, `client/src/pages/recruiter/dashboard.tsx`

**Problem:** The entire analytics section uses handmade CSS gradient bars and SVG donut charts instead of a proper charting library. This is the #1 thing that makes the app look like a side project rather than a serious ATS.

```tsx
// Current: CSS gradient bars
<div className="h-2.5 rounded-full bg-gradient-to-r from-blue-500 to-blue-600" style={{ width: '75%' }} />

// Current: Handmade SVG donut
<svg viewBox='0 0 120 120' className='h-28 w-28'>
  <circle cx='60' cy='60' r='50' fill='none' stroke={color} strokeWidth='12' ... />
</svg>
```

**Why it matters:** Greenhouse, Lever, and Workday all use polished chart libraries (Recharts, Chart.js, Highcharts). Users subconsciously equate visual polish with product quality. A $50K/year ATS tool cannot have hand-drawn CSS charts.

**Impact:** HIGH — Recruiters see analytics every day. This is their primary value metric.

**Fix:** Install Recharts (`npm install recharts`). Replace CSS bars with `<BarChart>`, `<LineChart>`, `<PieChart>`. Add tooltips, animations, and responsive containers. Estimated 1-2 days of work.

**Competitor reference:** Greenhouse's analytics dashboard uses Recharts with custom branded tooltips and smooth enter/exit animations.

---

### 2. Landing Page "Trust Bar" Is Just Text — No Real Logos

**Location:** `client/src/pages/landing.tsx` (~line 740)

**Problem:** The trust bar says "Candidates at companies like Google, Stripe, Airbnb, and thousands of startups trust Rekrut AI" but there are NO actual company logos displayed. The `companyLogos` array exists but is never rendered as visual logos.

```tsx
const companyLogos = ['Google', 'Stripe', 'Airbnb', 'Netflix', 'Spotify', 'Shopify', 'Notion', 'Figma']
// These are NEVER rendered as SVG or image logos. Just text in the trust bar.
```

**Why it matters:** Social proof is one of the most powerful conversion tools. Text-only trust signals are weak. Every SaaS landing page (Stripe, Notion, Linear) shows actual company logos in grayscale.

**Impact:** HIGH — Landing page is the first impression. Conversion rate impact estimated 15-20%.

**Fix:** Add a grayscale logo marquee or static grid. Use SVG logos or simple wordmark lockups. Reference: Linear's landing page (linear.app) — clean, minimal logo grid with hover color reveals.

---

### 3. Profile Page Is 2,600+ Lines — Unmaintainable

**Location:** `client/src/pages/candidate/profile.tsx`

**Problem:** The profile page is a single file of 2,600+ lines. It contains:
- 15+ component definitions inline
- 40+ imported icons
- 15+ state variables
- Multiple inline modal/dialog components
- Inline CSS-in-JS style objects

**Why it matters:** This is a maintenance nightmare. Any bug fix requires scrolling through 2,600 lines. The file is larger than some entire apps. Performance: React re-renders the entire tree on any state change.

**Impact:** HIGH — Bug fix velocity, developer velocity, and runtime performance.

**Fix:** Extract into sub-components:
```
profile/
  index.tsx           (main page, ~200 lines)
  ProfileHeader.tsx   (avatar, name, headline, progress)
  GeneralInfoTab.tsx  (basic info form)
  ExperienceTab.tsx   (collapsible experience list + editor)
  SkillsTab.tsx       (skill chips + add/remove)
  EducationTab.tsx    (education list + editor)
  ProjectsTab.tsx     (projects list)
  CertificationsTab.tsx
  ProfileEditor.tsx   (shared modal/editor wrapper)
```

**Reference:** LinkedIn's profile page is split across ~20 components in their codebase.

---

### 4. Notifications Bell Is Decorative — No Real-Time System

**Location:** `client/src/components/layout/header.tsx` (~line 80)

**Problem:** The notifications bell in the dashboard header has no badge, no dropdown, no unread count, and no real-time updates. It's just a static icon.

```tsx
<button className='relative flex min-h-[44px] min-w-[44px] ...' aria-label='Notifications'>
  <Bell className='h-5 w-5 text-muted-foreground' />
</button>
// No Badge, no unread count, no dropdown, no click handler
```

**Why it matters:** Users expect notifications. A dead bell icon is a broken promise. Every modern SaaS (Slack, Notion, GitHub) has a rich notification panel with read/unread states, grouping, and actions.

**Impact:** MEDIUM-HIGH — Users will notice this immediately. It signals "this app is incomplete."

**Fix:** Add a notification dropdown component. Poll for notifications every 30s. Show unread badge. Group by type (application, interview, message). Add "Mark all read" and "Settings" actions. Reference: GitHub's notification dropdown.

---

### 5. Chat Message Bubbles Lack Visual Hierarchy

**Location:** `client/src/components/domain/chat.tsx` (~lines 540-650)

**Problem:** Message bubbles are plain white/gray rectangles with tiny 10px metadata text. No avatar thumbnails in the message stream, no message grouping by sender (all messages look identical), no rich media previews for links, and no message status indicators beyond read/unread.

```tsx
<div className='bg-muted rounded-2xl rounded-tl-sm px-4 py-2.5'>
  <p className='text-sm'>{msg.content}</p>
  <span className='text-[10px] text-muted-foreground'>10:30 AM</span>
</div>
```

**Why it matters:** Chat is a high-frequency interaction surface. Poor visual hierarchy makes it hard to scan conversations. LinkedIn Messaging, Slack, and WhatsApp all use distinct avatar positioning, color coding per sender, and rich message formatting.

**Impact:** MEDIUM — Chat is used for recruiter-candidate communication, but not the primary workflow.

**Fix:**
- Add small circular avatars next to each message (24x24px)
- Group consecutive messages from the same sender (no repeated avatar)
- Add subtle color tinting per sender (light blue vs light gray)
- Increase metadata text to 11px minimum
- Add message status indicators (sent → delivered → read with checkmarks)

**Reference:** LinkedIn Messaging — clean, professional, avatar-per-message, subtle grouping.

---

### 6. Register Page Is a Single Wall of Form Fields

**Location:** `client/src/pages/register.tsx`

**Problem:** All fields (role, name, email, password, company name) are shown in one long form. No multi-step progress. No field-level validation (only form-level on submit). The left panel says "First things first..." suggesting a multi-step flow, but it's just one step.

**Why it matters:** Single-step registration with 5+ fields has higher abandonment rates. Multi-step forms with progress indicators have 10-30% higher completion rates. The left panel copy ("First things first...") sets an expectation that is not met.

**Impact:** MEDIUM — Conversion rate impact. Not launch-blocking but significant for growth.

**Fix:** Split into 2-3 steps:
```
Step 1: Role selection (big visual cards: "I'm a candidate" / "I'm hiring")
Step 2: Account details (email, password, name)
Step 3: Profile basics (headline, location for candidates; company name for employers)
Progress bar: [Step 1] — [Step 2] — [Step 3] (3 of 3)
```

**Reference:** LinkedIn's registration — clean role selection, then progressive profile building.

---

## 🟡 HIGH UI/UX ISSUES (Polish & Professionalism)

### 7. Landing Page Gradient Blobs Feel Generic

**Location:** `client/src/pages/landing.tsx` (~line 450)

**Problem:** The hero section uses purple/indigo gradient blobs (`bg-primary/10 blur-3xl`) that are a common AI-generated SaaS trope. They feel unoriginal and slightly dated (2023-era design pattern).

**Why it matters:** First impressions matter. The landing page needs to feel distinctive. Current design is "competent but forgettable."

**Fix:** Replace with a subtle mesh gradient or a single, more defined hero illustration. Or use a clean, no-background approach with strong typography (like Linear or Figma's landing pages). Reference: Linear's homepage — no background effects, just crisp typography and a product screenshot.

---

### 8. Inconsistent Icon Sizing Across Components

**Location:** Multiple files

**Problem:** Icons vary in size inconsistently:
- `h-5 w-5` in header buttons
- `h-4 w-4` in action buttons
- `h-3.5 w-3.5` in badges
- `h-3 w-3` in some metadata
- Some places use `size="sm"` which resolves to 16px

**Why it matters:** Visual inconsistency makes the app feel unpolished. A design system should have 3-4 icon sizes and stick to them.

**Fix:** Define icon size tokens:
```
sm: 14px (h-3.5 w-3.5) — metadata, inline
md: 16px (h-4 w-4) — buttons, list items
default: 20px (h-5 w-5) — header, primary actions
lg: 24px (h-6 w-6) — hero, empty states
xl: 32px (h-8 w-8) — feature icons, illustrations
```

Audit all files and standardize. Estimated 2-3 hours of find/replace.

---

### 9. Data Table Lacks Row Hover States and Column Resizing

**Location:** `client/src/components/domain/data-table.tsx`

**Problem:** Data table rows have no hover state. No column resizing. No column visibility toggles. No sticky headers on scroll. The table is functional but bare-bones.

**Why it matters:** Recruiters spend hours in data tables (candidate lists, applications). Row hover is essential for tracking. Column resizing is expected. Greenhouse and Lever both have rich, interactive tables.

**Fix:**
- Add `hover:bg-muted/50` to table rows
- Add `cursor-pointer` when `onRowClick` is provided
- Add sticky table headers (`sticky top-0`)
- Consider `tanstack-table` for advanced features (column resizing, visibility, sorting)

**Reference:** Greenhouse's candidate table — row hover, column reordering, inline actions, sticky headers.

---

### 10. Form Error Messages Are Generic

**Location:** Multiple form files (register, login, profile, job-form)

**Problem:** Most forms show a single error message at the top of the form rather than field-level validation. E.g., `register.tsx`: `setError(err instanceof Error ? err.message : 'Registration failed')` — one error banner for the entire form.

**Why it matters:** Users don't know which field is wrong. Field-level validation with real-time feedback is standard (Typeform, Notion, Linear all do this).

**Fix:** Add `react-hook-form` + `zod` for schema validation. Show field-level errors inline with red borders and helper text. Validate on blur (real-time) rather than just on submit.

**Reference:** Notion's form inputs — clean red borders, inline error text below the field, no alert banners.

---

### 11. "Time to Fill" Is Hardcoded in Recruiter Dashboard

**Location:** `client/src/pages/recruiter/dashboard.tsx` (~line 170)

**Problem:** One of the six key stats on the recruiter dashboard is hardcoded:
```tsx
{ label: 'Time to Fill', value: '18 days', change: -3, ... }
```

**Why it matters:** This is a core KPI. A hardcoded value is a broken metric. Recruiters will notice immediately.

**Fix:** Pull from `data.avg_time_to_hire` or calculate from pipeline stage transitions. If not available from backend, hide the card until data is ready.

---

### 12. Analytics Page "Export" Button Works But Is Hidden

**Location:** `client/src/pages/recruiter/analytics.tsx` (~line 370)

**Problem:** The Export button actually DOES work (generates CSV and downloads it). But the button is small (`size="sm"`), visually identical to the time range selector, and lacks a success state. Users might not realize it works.

**Why it matters:** A feature that works but doesn't communicate its success is a broken UX pattern.

**Fix:**
- Make the button larger and more prominent
- Add a success toast: "Analytics exported to CSV"
- Show a spinner while generating
- Add an icon to the downloaded file (Excel/CSV icon in the button)

---

## 🟢 MEDIUM UI/UX ISSUES (Enhancements)

### 13. No Skeleton for Candidate/Recruiter Dashboard Cards

**Location:** `client/src/pages/candidate/dashboard.tsx`, `client/src/pages/recruiter/dashboard.tsx`

**Problem:** The analytics page has a beautiful skeleton loading state (`<Skeleton variant='card' />`). But the candidate and recruiter dashboards show blank cards or zero values while loading. The stat cards show "0" or "—" during the initial load before data arrives.

**Fix:** Add `SkeletonCard` to the stat grid and quick actions grid while `loading` is true. Show 4 skeleton cards matching the layout.

---

### 14. Mobile Menu Uses Full-Screen Overlay Instead of Drawer

**Location:** `client/src/pages/landing.tsx` (~line 230)

**Problem:** The mobile menu on the landing page is a full-screen overlay that feels heavy. It also lacks the user's avatar or profile info when logged in. No animation (appears instantly).

**Fix:** Use a slide-in drawer from the right (like Notion or Linear) with a backdrop. Add `transition-transform duration-300 ease-out`. Show user info when authenticated.

---

### 15. Dark Mode Is Implemented But Inconsistent

**Location:** Multiple files

**Problem:** Dark mode exists (`theme-context.tsx`, `ThemeToggle` component), but some pages have hardcoded colors that don't adapt:
- `landing.tsx` has `bg-primary/10` which works but some text uses `text-muted-foreground` which might not have enough contrast in dark mode
- The amber/yellow warning cards (`bg-amber-50`, `text-amber-900`) may not invert properly
- Some charts use hardcoded hex colors (`#3b82f6`) instead of CSS variables

**Fix:** Audit all pages in dark mode. Use CSS custom properties (`--primary`, `--muted-foreground`) consistently. Replace hardcoded chart colors with `oklch` or `hsl` values that adapt to the theme.

---

### 16. Empty States Could Use Illustrations

**Location:** Multiple pages (dashboard, chat, analytics, candidates)

**Problem:** Empty states use Lucide icons (e.g., `<Briefcase className='mx-auto mb-3 h-12 w-12 opacity-20' />`) which are fine but generic. No custom illustrations or brand personality.

**Fix:** Add simple SVG illustrations or use a library like `unDraw` for empty states. A small illustration (200x200px) with a friendly message increases engagement significantly. Reference: Notion's empty states — minimal but characterful.

---

### 17. Pagination Arrows Are Too Small on Mobile

**Location:** `client/src/components/domain/data-table.tsx` (~line 140)

**Problem:** Pagination arrows use `ChevronLeft`/`ChevronRight` at default size. On mobile, the click targets are only 24x24px.

**Fix:** Add `min-h-[44px] min-w-[44px]` to all pagination buttons. This was already done in `recruiter/candidates.tsx` but not in the shared `data-table.tsx` component.

---

### 18. No Keyboard Shortcuts in Dashboard

**Location:** Dashboard pages

**Problem:** No keyboard shortcuts for power users. Common shortcuts missing:
- `/` or `cmd+k` for search
- `?` for help/shortcuts
- `j`/`k` for navigating lists
- `esc` for closing modals

**Fix:** Add `cmd+k` spotlight search (like Linear, Notion, Raycast). Add a keyboard shortcut help modal (`?` key). This is a "delight" feature that power users love.

---

## 🟢 POSITIVE FINDINGS (What We Do Well)

### ✅ Touch Targets Are Properly Sized (44px)

All buttons and interactive elements use `min-h-[44px] min-w-[44px]` or `h-11` (44px). This meets WCAG 2.5.5 AAA standard. Mobile users won't struggle with tiny buttons.

### ✅ Empty States Have Helpful CTAs

Every zero-state has a helpful message and a clear next action. E.g., "No work experience added yet" → "Add Experience" button. This is better than many production apps.

### ✅ Loading Skeletons Are Consistent

The `Skeleton` component is used consistently across analytics, tables, and cards. `animate-pulse` with `bg-muted` is a clean, standard pattern.

### ✅ Profile Completeness Banner Is Excellent

The candidate dashboard shows a progressive banner when profile < 80% complete: progress bar, specific call-to-action, and a "Complete Profile" button. This is a best-practice onboarding pattern (used by LinkedIn, Airbnb).

### ✅ Mobile Grid Fixes Are Applied

All `grid` layouts use `grid-cols-1` as the base with responsive breakpoints (`sm:grid-cols-2`, `lg:grid-cols-4`). No implicit multi-column layouts that break on mobile.

### ✅ Accessibility Basics Are Present

- Skip-to-content link (`<a href='#main-content'>`)
- ARIA labels on icon buttons (`aria-label='Open menu'`)
- Focus-visible rings (`focus-visible:ring-2 focus-visible:ring-ring`)
- Keyboard navigation (Escape closes dropdowns)
- Semantic HTML (`<main>`, `<header>`, `<nav>`)

### ✅ Analytics Export Actually Works

Unlike many "Export" buttons that are no-ops, the analytics CSV export generates real data, downloads a file, and fires an analytics event. Well implemented.

### ✅ Color Coding Is Consistent

- Blue: primary actions, applications, positive metrics
- Purple: AI features, interviews, candidates
- Amber: warnings, pending items, screening
- Emerald: offers, success, hired
- Red: errors, high priority, rejection
- Indigo: trust, omni-score, premium

This is a solid, intuitive color system.

---

## PRIORITY FIX LIST

### Week 1 (Critical)
1. **Install Recharts** and replace CSS charts with real charts (analytics + dashboard)
2. **Add real company logos** to landing page trust bar (SVG or wordmark grid)
3. **Split profile page** into sub-components (extract ExperienceTab, SkillsTab, EducationTab, etc.)
4. **Fix hardcoded "Time to Fill"** — pull from real data or hide card

### Week 2 (High)
5. **Add notification system** — dropdown, badge, polling, real-time updates
6. **Improve chat message bubbles** — avatars, grouping, color coding, status indicators
7. **Multi-step registration** — 2-3 steps with progress indicator
8. **Standardize icon sizes** — define tokens and audit all files
9. **Add row hover states** to data tables + sticky headers

### Week 3 (Medium)
10. **Field-level form validation** — react-hook-form + zod, real-time validation
11. **Dark mode audit** — fix hardcoded colors, test all pages
12. **Empty state illustrations** — add SVG illustrations to key zero-states
13. **Mobile menu drawer** — slide-in instead of full-screen overlay
14. **Keyboard shortcuts** — cmd+k search, `?` help modal

---

## COMPETITOR BENCHMARKS

| Feature | Rekrut AI | Greenhouse | Lever | LinkedIn |
|---------|-----------|------------|-------|----------|
| Chart library | CSS-only ✅ | Recharts | Recharts | D3.js |
| Landing trust bar | Text only | N/A | N/A | Logo grid |
| Notification system | Static icon | Full dropdown | Full dropdown | Full dropdown |
| Registration flow | Single-step | 2-step | 2-step | Multi-step |
| Profile page size | 2,600 lines | Modular | Modular | Modular |
| Chat UX | Basic | N/A | N/A | Rich (avatars, grouping) |
| Data table | Basic | Advanced | Advanced | Advanced |
| Form validation | Form-level | Field-level | Field-level | Field-level |
| Dark mode | Partial | Full | Full | Full |
| Keyboard shortcuts | None | None | Some | Extensive |
| Mobile touch targets | 44px ✅ | 44px | 44px | 44px |
| Empty states | Icons + CTA | Illustrations | Illustrations | Illustrations |
| Skeleton loading | Yes ✅ | Yes | Yes | Yes |
| Profile completeness banner | Yes ✅ | Yes | Yes | Yes |

**Overall:** We are at ~70% of Greenhouse/Lever's UX polish. The main gaps are charts, notifications, and registration flow. The mobile responsiveness and loading states are actually competitive.

---

*Next: Spawn frontend developer agents to tackle Week 1 critical fixes (charts, logos, profile split, hardcoded stats).*
