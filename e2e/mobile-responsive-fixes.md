# Mobile Responsive Fixes Summary

**Date:** 2026-06-08  
**Status:** ✅ Build passes (`npm run build --prefix client`)  
**Viewport Target:** 375px mobile width

---

## Changes Made

### 1. Recruiter Job Applicants (`recruiter/job-applicants.tsx`)

**Problem:** Dialogs (candidate detail, AI comparison, pipeline automation) had fixed `max-w-*` widths that did not adapt to mobile viewport, causing horizontal overflow and poor usability on 375px screens.

**Fixes:**
- All three dialogs now use `w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)]` so they are nearly full-width on mobile while keeping their max-width on larger screens.
- The **Compare** button (`size="sm"`) now has `min-h-[44px]` for proper touch target.
- The **Automation** action buttons now have `min-h-[44px]`.
- The **Good Fit / Not a Fit** quick feedback buttons (previously `h-7`) now use `min-h-[44px]`.

### 2. Recruiter Jobs (`recruiter/jobs.tsx`)

**Problem:** The mobile job detail Sheet had its width class `className="w-full sm:w-[480px] md:w-[520px]"` on the `<Sheet>` component instead of `<SheetContent>`, which meant the width was not actually applied to the drawer panel.

**Fix:** Moved the width class to `<SheetContent className="overflow-x-hidden w-full sm:w-[480px] md:w-[520px]">` so the drawer opens at the correct width on mobile.

### 3. Candidate Jobs (`candidate/jobs.tsx`)

**Problem:** The job detail panel was `hidden lg:block` (desktop only). On mobile, clicking a job card set `showDetailPanel=true` but nothing appeared because there was no mobile detail panel. This was a critical UX bug.

**Fix:** Added a new **mobile detail Sheet** (`lg:hidden`) that wraps the existing `JobDetailPanel` component. When a job is clicked on mobile, the Sheet opens with full width, showing the job description, requirements, and apply options. The `JobDetailPanel` already had a mobile close button (`lg:hidden`), so it works seamlessly.

### 4. Candidate Profile (`candidate/profile.tsx`)

**Problem:** Several action buttons in the skills tab and overview tab were too small for mobile tap targets.

**Fixes:**
- **Skills tab:** The delete button (`h-7 w-7`) → `min-h-[44px] min-w-[44px]`.
- **Skills tab:** The **Endorse** button (`h-7`) → `min-h-[44px]`.
- **Overview tab:** The **Connect** button in suggested connections (`h-7`) → `min-h-[44px]`.

### 5. Recruiter Analytics (`recruiter/analytics.tsx`)

**Problem:** The **Export** button (`size="sm"`) was too small for mobile tap targets.

**Fix:** Added `min-h-[44px]` to the Export button.

---

## Notes

- **Settings page (`recruiter/settings.tsx`)** was listed for audit but does not exist at the expected path. No changes were needed.
- All fixes are **additive** (only adding responsive classes or wrapping existing components) — no desktop layouts were changed, no features were removed, and no backend code was touched.
- The build completes cleanly with no errors or warnings related to these changes.
