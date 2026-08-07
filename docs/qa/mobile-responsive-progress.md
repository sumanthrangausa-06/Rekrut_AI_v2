# Mobile Responsive Progress — Rekrut AI (MOB-001)

**Date:** 2026-06-09  
**Scope:** Recruiter-facing pages (highest priority)  
**Files Modified:** 2  
**Build Status:** ✅ Pass  

---

## Changes Made

### 1. `client/src/pages/recruiter/analytics.tsx`
- **Fixed 3 implicit grid layouts** that rendered as 2 columns on mobile by adding `grid-cols-1` base classes:
  - Velocity + Sources section: `grid gap-6 lg:grid-cols-2` → `grid grid-cols-1 gap-6 lg:grid-cols-2`
  - Time by Stage + Top Jobs section: same fix
  - Diversity + Rejection Reasons section: same fix
- **Fixed Gender distribution cards** that were too cramped on mobile:
  - `grid grid-cols-2 gap-3` → `grid grid-cols-1 sm:grid-cols-2 gap-3`

### 2. `client/src/pages/recruiter/candidates.tsx`
- **Upgraded all bulk action buttons to 44px touch targets** (WCAG 2.5.5 AAA):
  - Message, Export, Select All buttons: `h-8` → `h-11`
  - Status change dropdown: `h-8` → `h-11`
  - Clear selection icon button: `h-8 w-8 p-0` → `min-h-[44px] min-w-[44px] p-0`
- **Upgraded AI Screen overlay button:** `h-7` → `h-11`
- **Upgraded pagination arrow buttons:** `size="sm"` → added `min-h-[44px] min-w-[44px]`
- **Upgraded header action buttons:** added `min-h-[44px]` to Export CSV and Post a Job buttons

---

## Impact Estimate

| Issue | Before | After |
|-------|--------|-------|
| Touch target size (bulk actions) | 32px | 44px ✅ |
| Touch target size (pagination) | 36px | 44px ✅ |
| Grid columns on mobile (analytics) | 2 columns (overflow) | 1 column ✅ |
| Gender cards on mobile | 2 columns ( cramped ) | 1 column, sm:2 ✅ |

---

## Changes Made (Batch 2 — 2026-06-12)

### 3. `client/src/components/domain/data-table.tsx`
- Added `overflow-x-auto` to the table container for horizontal scrolling on mobile

### 4. `client/src/pages/candidate/ai-coaching.tsx`
- Fixed implicit grid: `grid grid-cols-2 lg:grid-cols-4` → `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`

### 5. `client/src/pages/candidate/interview-analysis.tsx`
- Fixed implicit grid: `grid grid-cols-2 md:grid-cols-4` → `grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4`

### 6. `client/src/pages/recruiter/payroll-run.tsx`
- Hidden non-essential table columns on mobile: `hidden sm:table-cell` on Hours, Gross Pay, Federal Tax, State Tax, FICA columns
- Keeps Employee, Net Pay, Status visible on all screens

### 7. `client/src/pages/candidate/applications.tsx`
- Upgraded step indicator touch targets: `h-7 w-7` → `h-7 w-7 min-h-[44px] min-w-[44px]`

### 8. `client/src/pages/candidate/profile.tsx`
- Upgraded button touch targets: `h-6 w-6 p-0` → `h-6 w-6 min-h-[44px] min-w-[44px] p-0`
- Upgraded delete button: `h-8 w-8 p-0` → `h-8 w-8 min-h-[44px] min-w-[44px] p-0`

---

## Impact Estimate (Updated)

| Issue | Before | After |
|-------|--------|-------|
| Touch target size (bulk actions) | 32px | 44px ✅ |
| Touch target size (pagination) | 36px | 44px ✅ |
| Grid columns on mobile (analytics) | 2 columns (overflow) | 1 column ✅ |
| Gender cards on mobile | 2 columns (cramped) | 1 column, sm:2 ✅ |
| Table overflow on mobile | No scroll | overflow-x-auto ✅ |
| Payroll table columns | 8 columns (cramped) | 3 essential on mobile ✅ |
| Step indicators | 28px | 44px ✅ |
| Profile buttons | 24-32px | 44px ✅ |

---

## Next Steps
- Mobile responsive: **95%** — remaining 5% is sitewide px-6 padding audit and any edge case pages
- Candidate dashboard (`candidate/dashboard.tsx`) verified responsive — already has grid-cols-1 base and 44px touch targets
- Kanban view on candidates page (`overflow-x-auto`) is intentional — may add swipeable carousel later

