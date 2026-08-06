# Mobile Responsive Audit Report — Rekrut AI
**Pages audited:** `candidate/job-detail.tsx`, `recruiter/dashboard.tsx`, `recruiter/analytics.tsx`
**Date:** 2026-06-08
**Auditor:** FE-004

---

## 1. candidate/job-detail.tsx

**Status: ✅ PROPERLY MOBILE-RESPONSIVE**

This page demonstrates strong mobile-first practices throughout. Here's the breakdown:

### Responsive Breakpoints
- `sm:flex-row` used correctly on job header, assessment card, apply form buttons, and modal actions — stacks vertically below 640px, side-by-side above.
- `sm:text-2xl` on the job title scales up from `text-xl` on mobile.
- `sm:p-6` on the modal gives tighter `p-4` padding on mobile.
- `sm:items-center` and `sm:justify-between` patterns used appropriately.

### Fixed Widths
- **No problematic fixed widths.** The outer container uses `max-w-3xl mx-auto` (max-width, not fixed), which is appropriate for readability.
- Avatar uses `h-14 w-14` (56px) — a reasonable fixed size for a profile image.
- Modal uses `w-full max-w-2xl` — full width on mobile, capped on desktop. Good.

### Overflow Handling
- `overflow-x-hidden` on job description and requirements prose blocks — prevents long URLs or code snippets from breaking layout.
- Modal uses `max-h-[90vh] overflow-y-auto` — ensures scrollability on short screens.
- `break-words` and `whitespace-pre-wrap` on text content — prevents overflow.

### Touch Targets
- **Excellent.** `min-h-[44px] min-w-[44px]` explicitly set on:
  - Save/unsave button
  - Modal close button
  - "Complete Profile" button
  - "Take Assessment" button
  - Document preview toggle button
  - "Review Later" button
  - "Cancel" button
- Screening question yes/no buttons use `flex-1` and `size="sm"` but still have reasonable tap area due to padding.

### Grid / Flex Layouts
- `flex-wrap` on job metadata, skills badges, and matching skills — prevents horizontal overflow.
- `flex flex-col sm:flex-row` on the action button group in the modal.
- The modal itself uses `items-end sm:items-center` with `rounded-t-2xl sm:rounded-lg` — a proper bottom-sheet pattern on mobile, centered dialog on desktop. This is **best-practice mobile UX**.

### Minor Notes
- The apply form uses `flex-col sm:flex-row` on the cover letter header and screening question header. Good.
- The `text-[10px]` on skill badges is very small but acceptable for non-interactive labels.
- No `grid` classes used, but the flex-based layout adapts well to narrow screens.

---

## 2. recruiter/dashboard.tsx

**Status: ⚠️ MOSTLY RESPONSIVE — 3 minor issues found**

This page has a solid responsive grid structure but a few areas need attention for polished mobile UX.

### Responsive Breakpoints
- `sm:grid-cols-2`, `lg:grid-cols-5`, `lg:grid-cols-4`, `lg:grid-cols-3`, `lg:grid-cols-2` — good grid coverage across sections.
- `sm:flex-row` on the welcome header and trust score card — stacks correctly below 640px.
- `lg:grid-cols-3` on the main content area (pipeline + sidebar) works well.

### Fixed Widths
- `w-24` (96px) on the "Improve Score" button area? No, the button uses `shrink-0` but no explicit width.
- `min-w-[72px] sm:min-w-[100px]` on pipeline stage cards — this is the minimum width per stage, which contributes to the horizontal scroll issue below.

### Overflow Handling
- **⚠️ ISSUE 1: Pipeline bar uses `overflow-x-auto`** (line ~355). The 6 pipeline stages with `min-w-[72px]` each, plus gaps (`gap-1`) and chevron separators, create a total minimum width of roughly **520px**. On screens narrower than that (e.g., iPhone SE at 375px), the user must horizontally scroll to see all stages. This is a functional workaround but not ideal mobile UX. A vertical stacked layout below `sm` would be preferable.

### Touch Targets
- **⚠️ ISSUE 2: Pipeline stage cards may not meet 44px minimum touch target.** The cards use `px-2 py-2 sm:px-4 sm:py-3` with `text-xl font-bold` text. On mobile (`py-2` = 8px vertical padding, text-xl ≈ 24px line-height), the total height is roughly **40px**, which falls short of the 44px minimum recommended by WCAG / Apple HIG. The cards are clickable (`cursor-pointer`) but are slightly too small for comfortable tapping.
- `min-h-[44px]` is used on some buttons (View Pipeline, View all activity, Full Analytics, Post a Job, Upgrade) but **not consistently** on all interactive elements. For example, the trust score "Improve Score" button and the X dismiss button on the upgrade banner both have `min-h-[44px]`, which is good.
- Action item cards use `p-3` padding and `h-8 w-8` icon containers. The overall card height is likely >44px due to padding, so this is acceptable.
- Quick action cards (Post a Job, Search Candidates, etc.) use `p-4` and have `h-full`, so they likely exceed 44px.

### Grid / Flex Layouts
- The `lg:grid-cols-3` split between pipeline (2 cols) and sidebar (1 col) works well on desktop. On mobile, everything stacks vertically as expected.
- The quick stats grid `sm:grid-cols-2 lg:grid-cols-5` correctly shows 2 columns on mobile.
- The action items grid `sm:grid-cols-2 lg:grid-cols-4` shows 2 columns on mobile.
- The upcoming interviews grid `sm:grid-cols-2 lg:grid-cols-3` shows 2 columns on mobile.
- The quick actions bar `sm:grid-cols-2 lg:grid-cols-4` shows 2 columns on mobile.

### Content Clipping / Hidden Content
- **Good use of `truncate`** on activity descriptions, action item titles, pipeline candidate names, and upcoming interview details. This prevents text overflow on narrow screens.
- **Good use of `min-w-0`** on flex children in activity items and pipeline cards. This prevents flex items from refusing to shrink.

### Text Sizing
- **⚠️ ISSUE 3: Welcome header uses `text-3xl` (30px) without responsive scaling.** On mobile screens, this is quite large. Consider `text-2xl sm:text-3xl` for better proportion on small devices.

---

## 3. recruiter/analytics.tsx

**Status: ⚠️ MOSTLY RESPONSIVE — 3 minor issues found**

This page is data-dense and generally adapts well, but has some small touch target and sizing concerns.

### Responsive Breakpoints
- `sm:grid-cols-2`, `lg:grid-cols-4`, `lg:grid-cols-2`, `sm:grid-cols-3` — good grid coverage.
- `sm:flex-row` on the header — stacks correctly below 640px.
- Two-column layouts (Velocity + Sources, Time by Stage + Top Jobs) correctly collapse to single column below `lg`.

### Fixed Widths
- `w-24` (96px) on funnel labels ("Job Views", "Applied", etc.) with `shrink-0`. On mobile, this is acceptable — the labels are short and 96px is reasonable.
- `w-12` (48px) on conversion percentage text with `shrink-0`. Fine for mobile.
- `w-10` (40px) on velocity month labels, `w-16` (64px) on interview counts. Total fixed width in velocity row is ~104px, which fits comfortably on any mobile screen.
- `w-20` (80px) on OmniScore distribution labels, `w-12` (48px) on count. Fine for mobile.

### Overflow Handling
- No explicit `overflow-x-auto` or `overflow-x-hidden` on the funnel or chart sections. However, the layout uses `flex-1` for the main bars and `shrink-0` for fixed-width labels, so overflow should not occur in practice.
- **No overflow issues detected.**

### Touch Targets
- **⚠️ ISSUE 1: The "Export" button uses `size="sm"`** without `min-h-[44px]`. In shadcn/ui, `sm` buttons typically render at ~32px height, which is below the 44px minimum touch target. Should add `min-h-[44px]` or use `size="default"`.
- **⚠️ ISSUE 2: The time range `<select>` uses `h-10`** (40px). This is close to but still below the 44px minimum. On iOS, native select elements are rendered by the system and usually meet touch target requirements, but the custom-styled select might not.
- **⚠️ ISSUE 3: The funnel bars use `h-8` (32px), velocity bars use `h-6` (24px), and time-to-hire bars use `h-2` (8px).** These are all display-only (not interactive), so they don't strictly need to be 44px. However, the `h-2` bars are very thin and may be hard to see on mobile. The velocity bars at `h-6` are acceptable but could be slightly larger.
- The top performing jobs cards have `p-3` padding and are clickable. The overall card height should exceed 44px.
- The advanced metrics cards use `p-4` and are not interactive, so no touch target concern.

### Grid / Flex Layouts
- The key metrics row `sm:grid-cols-2 lg:grid-cols-4` correctly shows 2 columns on mobile.
- The advanced metrics `sm:grid-cols-3` correctly shows 3 columns on mobile (which is a bit dense but acceptable at ~120px per card on a 375px screen). Consider `grid-cols-1 sm:grid-cols-3` for single-column stacking on very small screens.
- Two-column layouts correctly collapse below `lg`.

### Content Clipping / Hidden Content
- `truncate` used on top job titles. Good.
- `min-w-0` used on top job cards. Good.
- Funnel bars use `overflow-hidden` on the container. Good.
- The funnel label `w-24` might cause text truncation if a label were longer, but current labels are short.

### Text Sizing
- `text-2xl` (24px) on the "Hiring Analytics" header and stat cards. This is acceptable on mobile but slightly large. Could consider `text-xl sm:text-2xl` for the header.
- `text-2xl` on advanced metrics ("$2,450", "4.3/5", "82%") — these are fine as they're the focal data points.
- `text-[10px]` on some badges is small but acceptable for non-interactive labels.

---

## Summary Table

| Page | Status | Critical Issues | Minor Issues |
|------|--------|-----------------|--------------|
| `candidate/job-detail.tsx` | ✅ Responsive | 0 | 0 |
| `recruiter/dashboard.tsx` | ⚠️ Mostly Responsive | 0 | 3 |
| `recruiter/analytics.tsx` | ⚠️ Mostly Responsive | 0 | 3 |

## Recommendations (Priority Order)

1. **recruiter/dashboard.tsx — Pipeline horizontal scroll**: Convert the pipeline bar to a vertical stacked layout below the `sm` breakpoint instead of `overflow-x-auto`. Six stages side-by-side is too wide for mobile.
2. **recruiter/dashboard.tsx — Pipeline stage touch targets**: Add `min-h-[44px]` to the pipeline stage cards to ensure they meet minimum touch target requirements.
3. **recruiter/dashboard.tsx — Welcome header text**: Change `text-3xl` to `text-2xl sm:text-3xl` for better mobile scaling.
4. **recruiter/analytics.tsx — Export button touch target**: Add `min-h-[44px]` to the Export button or use `size="default"`.
5. **recruiter/analytics.tsx — Time range select height**: Ensure the native select element meets 44px height on mobile, or wrap it in a container with `min-h-[44px]`.
6. **recruiter/analytics.tsx — Advanced metrics grid**: Consider `grid-cols-1 sm:grid-cols-3` instead of `sm:grid-cols-3` to stack advanced metrics vertically on very small screens.

---
*Report generated by FE-004. Do not fix without design review.*
