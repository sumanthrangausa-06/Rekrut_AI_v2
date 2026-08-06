# Mobile Responsive Audit Report — Rekrut AI Frontend

**Audit Date:** 2026-06-08
**Target Breakpoint:** iPhone 14 (390px width)
**Scope:** Read-only code review
**Status:** 85% → targeting 100%

---

## Summary

| Page | Status | Issues | Score |
|------|--------|--------|-------|
| Recruiter Jobs Page | ✅ Mostly Responsive | 2 minor | 95% |
| Candidate Jobs Page | ⚠️ Needs Fixes | 3 issues | 80% |
| Landing Page | ⚠️ Needs Fixes | 4 issues | 82% |
| Recruiter Dashboard | ✅ Mostly Responsive | 2 minor | 92% |
| Recruiter Pipeline | ℹ️ N/A | Embedded in dashboard | — |
| Sheet Component | ✅ Responsive | 2 enhancements | 90% |
| Dashboard Layout | ✅ Responsive | 0 issues | 100% |

**Overall Assessment:** ~87% mobile responsive. Candidate jobs page and landing page have the most impactful issues preventing 100% coverage.

---

## 1. Recruiter Jobs Page (`client/src/pages/recruiter/jobs.tsx`)

### ✅ What's Working
- **Mobile job detail panel** uses `Sheet` with `w-full` on mobile, `sm:w-[480px]` on desktop — correct full-width drawer behavior
- `JobDetailPanel` component has `min-w-0` + `break-words` on job title, department, location, and time-ago text
- Action buttons have `min-h-[48px]` touch targets
- Pipeline progress bar uses `minWidth: '4%'` to prevent visual collapse
- Stats grid: `grid gap-4 sm:grid-cols-2 lg:grid-cols-4` — properly stacks on mobile
- Filter bar: `flex flex-col gap-3 sm:flex-row sm:items-center` — stacks vertically on mobile
- View mode toggle (list/grid) uses `flex rounded-md border overflow-hidden` — works at all sizes
- Grid view: `grid gap-4 sm:grid-cols-2 lg:grid-cols-3` — single column on mobile
- List view job cards: `flex flex-col gap-4 sm:flex-row sm:items-start` — stacks on mobile
- Sheet close button has `min-h-[44px] min-w-[44px]`

### ❌ Issues Found

#### Issue 1.1: Page title lacks overflow protection
- **Element:** `<h1 className="font-heading text-2xl font-bold">Job Postings</h1>`
- **Breakpoint:** < 390px
- **Problem:** Long titles or headings could overflow without `min-w-0` or `break-words`
- **Fix:** Add `min-w-0 break-words` to the h1

#### Issue 1.2: Status filter select lacks minimum width
- **Element:** `<select>` for status filter in the filter bar
- **Breakpoint:** < 390px
- **Problem:** The native select element can shrink to an unusable width on narrow screens when combined with the view toggle buttons
- **Fix:** Add `min-w-[120px]` or `className="min-w-0 flex-1"` to the select wrapper

---

## 2. Candidate Jobs Page (`client/src/pages/candidate/jobs.tsx`)

### ✅ What's Working
- **Mobile filters sheet** uses `side="left"` on `Sheet` component — correct slide-in from left
- Desktop job detail panel is `hidden lg:block` — properly hidden on mobile/tablet
- Job list cards use `flex flex-col` for mobile, `sm:flex-row` for desktop
- Right-side stats have `shrink-0` on the job type badge
- Salary display uses `min-w-0` to prevent overflow
- Recent searches row uses `overflow-x-auto` for horizontal scrolling
- Search bar action buttons hide text labels with `hidden sm:inline` on mobile
- Sheet close button has proper touch target

### ❌ Issues Found

#### Issue 2.1: Container uses `calc(100vh - 4rem)` instead of dynamic viewport units
- **Element:** Main page container `h-[calc(100vh-4rem)] flex flex-col overflow-hidden`
- **Breakpoint:** All mobile (especially iOS Safari)
- **Problem:** `100vh` doesn't account for the dynamic mobile browser chrome (address bar/toolbar). On iOS Safari, this causes the page to be taller than the visible viewport, leading to hidden content or unnecessary scrollbars. The `h-dvh-safe` utility is used in the dashboard layout but not here.
- **Fix:** Replace `h-[calc(100vh-4rem)]` with `h-[calc(100dvh-4rem)]` or `h-dvh-safe`

#### Issue 2.2: Filter sidebar radio labels lack overflow protection
- **Element:** Filter options in the mobile Sheet `<label className="flex items-center gap-2 cursor-pointer">`
- **Breakpoint:** < 390px
- **Problem:** Long job type names, skill names, or location names could overflow the filter drawer. The `<span>` inside the label has no `min-w-0` or `break-words`
- **Fix:** Add `min-w-0` to the label and `break-words` to the text span

#### Issue 2.3: Slider components in mobile filter drawer
- **Element:** Salary range sliders in the mobile filter Sheet
- **Breakpoint:** < 390px
- **Problem:** The `Slider` component (from `@/components/ui/slider`) may have small touch targets on mobile. The slider track and thumb might be difficult to grab precisely at 390px width.
- **Fix:** Add `min-h-[44px]` padding around the slider container or increase the slider thumb size on mobile via CSS/media query

---

## 3. Landing Page (`client/src/pages/landing.tsx`)

### ✅ What's Working
- **Header** has mobile hamburger menu with full-screen overlay (`MobileMenu` component)
- **Hero** uses responsive text sizes: `text-4xl sm:text-5xl md:text-6xl lg:text-7xl`
- **Stats grid:** `grid gap-4 sm:grid-cols-4` — single column on mobile
- **Features grid:** `grid gap-6 sm:grid-cols-2 lg:grid-cols-3` — single column on mobile
- **HowItWorks:** `grid gap-8 lg:grid-cols-3` — single column on mobile
- **Testimonials:** `grid gap-6 sm:grid-cols-2 lg:grid-cols-4` — single column on mobile
- **Pricing:** `grid gap-6 lg:grid-cols-3` — single column on mobile
- **FAQ:** `max-w-3xl` single column — good
- **Footer:** `grid gap-8 sm:grid-cols-2 lg:grid-cols-5` — stacks on mobile
- **CTA banner:** `flex flex-col items-center gap-3 sm:flex-row sm:justify-center` — stacks on mobile
- Trust bar uses `flex flex-wrap` — good

### ❌ Issues Found

#### Issue 3.1: Hero AI matching preview list items can overflow
- **Element:** AI matching engine preview rows in the hero section
```tsx
<div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
  <div className="flex items-center gap-3">
    <div className="flex h-8 w-8 ...">{initials}</div>
    <span className="text-sm font-medium">{job.name}</span>
  </div>
  <div className="flex items-center gap-3">
    <Badge variant="outline" className="text-xs">{job.match}</Badge>
    <span className="text-sm font-bold text-primary">{job.score}%</span>
  </div>
</div>
```
- **Breakpoint:** < 390px
- **Problem:** The job name `<span>` has no `min-w-0`, `truncate`, or `break-words`. At 390px with avatar (32px) + gap (12px) + badge (~60px) + score (~30px) + padding (24px), a job name like "Senior React Developer at Stripe" (~34 chars) will overflow or push the badge/score off-screen. The `flex items-center gap-3` parent also has no `min-w-0` or `overflow-hidden`.
- **Fix:**
  ```tsx
  <div className="flex items-center gap-3 min-w-0 overflow-hidden">
    <div className="flex h-8 w-8 ... shrink-0">{initials}</div>
    <span className="text-sm font-medium min-w-0 truncate">{job.name}</span>
  </div>
  ```

#### Issue 3.2: FAQ accordion questions can overflow
- **Element:** FAQ accordion button
```tsx
<button className="flex w-full items-center justify-between p-6 text-left">
  <span className="font-heading font-semibold pr-4">{item.question}</span>
  <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
</button>
```
- **Breakpoint:** < 390px
- **Problem:** The question `<span>` has `pr-4` but no `min-w-0` or `break-words`. Long questions (e.g., "How is your AI matching different from LinkedIn or Indeed?") will push the chevron icon off-screen or cause horizontal overflow.
- **Fix:** Add `min-w-0` to the button's inner span and `break-words` or `truncate` to the question text:
  ```tsx
  <span className="font-heading font-semibold pr-4 min-w-0 break-words">{item.question}</span>
  ```

#### Issue 3.3: "Most popular" badge on Pro pricing card could overlap
- **Element:** Pricing card "Most popular" badge
```tsx
<div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1 text-xs font-semibold text-primary-foreground">
  Most popular
</div>
```
- **Breakpoint:** < 390px
- **Problem:** The card is in a `grid gap-6 lg:grid-cols-3` which becomes single-column on mobile. At 390px with `px-4` page padding, the card is ~358px wide. The badge is centered with `px-4 py-1` and could visually overlap with the card border or content if the card padding is tight.
- **Severity:** Minor visual issue
- **Fix:** Add `z-10` to the badge and ensure the card has enough top padding (`pt-8` or more) to accommodate the badge. The card already has `p-8` so this is likely fine, but worth verifying.

#### Issue 3.4: Company logos section has large horizontal gaps
- **Element:** Company logos trust bar
```tsx
<div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
```
- **Breakpoint:** < 390px
- **Problem:** `gap-x-8` (32px) is quite large. With 8 logos and each logo being ~80px wide (icon + text + padding), at 390px this will create 2-3 logos per row with large gaps, potentially leaving uneven whitespace.
- **Severity:** Minor visual
- **Fix:** Reduce gap on mobile: `gap-x-4 gap-y-4 sm:gap-x-8`

---

## 4. Recruiter Dashboard (`client/src/pages/recruiter/dashboard.tsx`)

### ✅ What's Working
- **Quick stats:** `grid gap-4 sm:grid-cols-2 lg:grid-cols-5` — single column on mobile
- **Action items:** `grid gap-3 sm:grid-cols-2 lg:grid-cols-4` — single column on mobile
- **Pipeline overview:** `overflow-x-auto` horizontal scroll bar — good for mobile
- **Pipeline stages:** `min-w-[72px] sm:min-w-[100px]` — minimum widths prevent collapse
- **Activity + Performance:** `lg:grid-cols-3` — stacks on mobile
- **Quick Actions:** `grid gap-3 sm:grid-cols-2 lg:grid-cols-4` — stacks on mobile
- **Upcoming interviews:** `grid gap-3 sm:grid-cols-2 lg:grid-cols-3` — stacks on mobile
- **Upgrade banner:** `flex items-center gap-4` with `shrink-0` on icon/button and `min-w-0` on text — good
- **Trust score card:** `flex items-center gap-4` with `min-w-0` on text — good
- Footer touch targets have `min-h-[44px]`

### ❌ Issues Found

#### Issue 4.1: Welcome heading is too large on mobile
- **Element:** `<h1 className="font-heading text-3xl font-bold tracking-tight">`
- **Breakpoint:** < 390px
- **Problem:** `text-3xl` (30px) on a 390px screen with padding leaves ~358px. A long recruiter name like "Christopher" + "Welcome back," could overflow or cause text wrapping that looks awkward. No `break-words` or responsive text size.
- **Fix:** Add responsive text sizing: `text-2xl sm:text-3xl` and `break-words`

#### Issue 4.2: Pipeline horizontal bar stage touch targets
- **Element:** Pipeline overview horizontal bar stages
```tsx
<div className="flex items-center gap-3 min-w-[72px] ...">
```
- **Breakpoint:** < 390px
- **Problem:** While `min-w-[72px]` meets the 44px minimum, the actual clickable/interactive area of the pipeline stages is only the text label and count. The `min-w-[72px]` is on the container, but if the container is not a button or link, the touch target for interacting with the stage is smaller. However, this is a display-only overview, so it's less critical.
- **Severity:** Low
- **Fix:** If the stages are meant to be clickable, wrap them in a `<button>` or `<a>` with `min-h-[44px] min-w-[72px]`

---

## 5. Recruiter Pipeline Page

- **Status:** ❌ File does not exist at `client/src/pages/recruiter/pipeline.tsx`
- **Actual location:** The pipeline view is embedded within the Recruiter Dashboard (`recruiter/dashboard.tsx`) as the "Pipeline Overview" section and the horizontal pipeline bar in the upgrade banner.
- **Assessment:** The embedded pipeline components have been reviewed as part of the Recruiter Dashboard audit above.

---

## 6. Sheet Component (`client/src/components/ui/sheet.tsx`)

### ✅ What's Working
- Supports `side: 'left' | 'right' | 'top' | 'bottom'`
- Mobile: `w-full` for left/right, `h-full` for top/bottom — correct full-screen drawers on mobile
- Desktop: `sm:w-96` (384px) for left/right, `sm:h-auto sm:max-h-[80vh]` for top/bottom
- Backdrop overlay with `bg-black/50` and click-to-close
- Close button has `min-h-[44px] min-w-[44px]` — good touch target
- Body scroll lock when open (`document.body.style.overflow = 'hidden'`)
- Slide-in animations (`animate-in slide-in-from-*`)

### ⚠️ Enhancement Opportunities

#### Issue 6.1: No swipe-to-close gesture
- **Element:** Sheet drawer overlay
- **Breakpoint:** Mobile (touch devices)
- **Problem:** Mobile users expect to swipe down (for bottom sheets) or swipe left/right (for side sheets) to close drawers. Currently, the only way to close is tapping the backdrop or the X button.
- **Severity:** Medium — affects mobile UX
- **Fix:** Add swipe gesture detection (e.g., using `touchstart`/`touchend` handlers or a library like `framer-motion` with drag gestures)

#### Issue 6.2: Bottom sheet takes full height on mobile
- **Element:** `top` / `bottom` side sheets
```tsx
top: 'top-0 w-full h-full sm:h-auto sm:max-h-[80vh]',
bottom: 'bottom-0 w-full h-full sm:h-auto sm:max-h-[80vh]',
```
- **Breakpoint:** < 640px (mobile)
- **Problem:** `h-full` on mobile means the bottom sheet takes the entire screen. Standard mobile bottom sheets typically take 50-70% of the screen height, allowing users to see the backdrop context.
- **Severity:** Low — depends on design preference
- **Fix:** Consider `h-[85dvh]` or `max-h-[90dvh]` instead of `h-full` for bottom sheets on mobile

---

## 7. Dashboard Layout (`client/src/components/layout/dashboard-layout.tsx`)

### ✅ What's Working
- Uses `h-dvh-safe` for viewport height — correct for mobile address bars
- Main content area has responsive padding: `p-3 pb-8 sm:p-4 lg:p-6 lg:pb-6`
- Footer stacks on mobile: `flex flex-col sm:flex-row`
- Footer links have `min-h-[44px]` — good touch targets
- Skip-to-content link for accessibility
- Sidebar closes on route change (`useEffect` with `location.pathname`)
- Body scroll lock when sidebar is open
- Keyboard support (Escape key closes sidebar)

### ❌ Issues Found
- **None.** The layout is well-implemented for mobile.

---

## Recommended Priority Order for Fixes

### High Priority (blocking 100% coverage)
1. **Issue 2.1** — Candidate jobs page: Replace `h-[calc(100vh-4rem)]` with dynamic viewport units (`h-[calc(100dvh-4rem)]`)
2. **Issue 3.1** — Landing page: Add `min-w-0 truncate` to hero AI matching preview job names
3. **Issue 3.2** — Landing page: Add `min-w-0 break-words` to FAQ accordion questions

### Medium Priority
4. **Issue 2.2** — Candidate jobs page: Add `min-w-0 break-words` to filter sidebar radio labels
5. **Issue 2.3** — Candidate jobs page: Increase slider touch target size in mobile filter drawer
6. **Issue 6.1** — Sheet component: Add swipe-to-close gesture for mobile
7. **Issue 4.1** — Recruiter dashboard: Add responsive text sizing to welcome heading

### Low Priority
8. **Issue 1.1** — Recruiter jobs page: Add `min-w-0 break-words` to page title
9. **Issue 1.2** — Recruiter jobs page: Add minimum width to status filter select
10. **Issue 3.3** — Landing page: Verify "Most popular" badge positioning on mobile
11. **Issue 3.4** — Landing page: Reduce company logo gap on mobile
12. **Issue 4.2** — Recruiter dashboard: Ensure pipeline stage touch targets are adequate
13. **Issue 6.2** — Sheet component: Consider partial-height bottom sheets on mobile

---

## Quick Wins (1-2 lines each)

```tsx
// Issue 2.1: Candidate jobs page
// Change:
<div className="h-[calc(100vh-4rem)] flex flex-col overflow-hidden">
// To:
<div className="h-[calc(100dvh-4rem)] flex flex-col overflow-hidden">

// Issue 3.1: Landing page hero preview
// Change:
<span className="text-sm font-medium">{job.name}</span>
// To:
<span className="text-sm font-medium min-w-0 truncate">{job.name}</span>
// And add min-w-0 to parent:
<div className="flex items-center gap-3 min-w-0 overflow-hidden">

// Issue 3.2: Landing page FAQ
// Change:
<span className="font-heading font-semibold pr-4">{item.question}</span>
// To:
<span className="font-heading font-semibold pr-4 min-w-0 break-words">{item.question}</span>

// Issue 4.1: Recruiter dashboard
// Change:
<h1 className="font-heading text-3xl font-bold tracking-tight">
// To:
<h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight break-words">
```

---

## Conclusion

The frontend is **~87% mobile responsive**. The main blockers are:
1. **Candidate jobs page** using `100vh` instead of `100dvh` (causes iOS Safari layout issues)
2. **Landing page** hero preview and FAQ accordion lacking `min-w-0` / `truncate` / `break-words`

Fixing the 3 high-priority issues (2.1, 3.1, 3.2) would bring the coverage to approximately **95%**. The remaining medium/low priority items are polish and UX enhancements that would close the gap to 100%.

The **Sheet component** works correctly on mobile (full-width drawers, proper close button touch targets, backdrop dismiss). The main enhancement needed is swipe-to-close gesture support.

The **Dashboard Layout** is 100% mobile-ready with proper dynamic viewport units, responsive padding, and accessible touch targets.
