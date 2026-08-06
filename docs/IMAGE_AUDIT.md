# Image Asset Audit — Rekrut AI v2

> **Status:** In Progress | **Date:** 2026-06-08
> **Issue:** App uses only Lucide icons and text — no photographs, illustrations, or branded imagery.

## Where Images Are Missing

### 1. Landing Page (`client/src/pages/landing.tsx`)
- **Hero section:** No hero image behind the gradient — should be a candidate/job-seeker photo or illustration
- **Features section:** Each feature card has only a Lucide icon — needs illustrative image or screenshot
- **Social proof section:** No company logos, no candidate photos
- **How it works section:** Step cards are text-only — needs illustrations
- **Testimonials section:** No avatars, no headshots
- **Blog/insights section:** No thumbnail images
- **CTA section:** No background image or visual element

### 2. Auth Pages (Sign In / Sign Up)
- **Left panel:** No brand image, illustration, or context photo — just a gradient
- **Social proof:** No company logos or trust badges

### 3. Candidate Pages
- **Profile page:** No avatar photo upload area (just a generic icon)
- **Dashboard:** No empty-state illustrations (just icons)
- **Job listing:** No company logos in job cards
- **Matching results:** No visual representation of match quality

### 4. Recruiter Pages
- **Dashboard:** No chart screenshots or data visualizations
- **Candidate cards:** No avatar photos
- **Company profile:** No company logo upload
- **Job posting:** No cover image for job listing

### 5. Shared Components
- **Empty states:** All text + icon, no illustration
- **404 / error pages:** No illustration
- **Loading states:** No branded spinner or animation
- **Notifications:** No avatar thumbnails

## Recommended Image Assets

### Immediate (High Impact, Low Effort)

| Asset | Location | Type | Source |
|-------|----------|------|--------|
| Hero background | Landing hero | Photo | Unsplash — office/candidate |
| Feature illustrations | Landing features | Illustration | Undraw / Custom SVG |
| Avatar placeholders | Profiles, cards | Generated | DiceBear / UI Avatars |
| Company logos | Job cards, trust section | Logos | Placeholder logos |
| Empty state illustrations | Dashboard, lists | Illustration | Undraw |

### Short-Term (Medium Effort)

| Asset | Location | Type | Notes |
|-------|----------|------|-------|
| Candidate photos | Profile pages | Photo | User-uploaded |
| Company logos | Company profiles | Logo | User-uploaded |
| Blog thumbnails | Blog/insights | Photo | Unsplash |
| App screenshots | Features section | Screenshot | Capture from staging |
| Testimonial headshots | Social proof | Photo | User-provided |

### Long-Term (High Effort)

| Asset | Location | Type | Notes |
|-------|----------|------|-------|
| Custom hero illustration | Landing page | Custom | Hire designer |
| Brand mascot / character | Empty states, loading | Custom | Brand identity |
| Animated illustrations | Loading, transitions | Lottie / SVG | Motion design |
| Video background | Hero section | Video | Production |

## Quick Wins — Add Today

1. **Unsplash hero image** — Add to landing page hero background
2. **DiceBear avatars** — Integrate API for all profile cards
3. **Undraw illustrations** — Add to empty states and feature sections
4. **Placeholder company logos** — Add to job cards and trust section
5. **Screenshot carousel** — Capture staging app screenshots for features

## Implementation Plan

### Step 1: Add Unsplash Images to Landing Page (15 min)
- Hero: `https://images.unsplash.com/photo-1522202176988-66273c2fd55f`
- Features: Use relevant Unsplash images for each feature card
- Social proof: Add company logo placeholders

### Step 2: Add Avatar System (30 min)
- Use DiceBear API for generated avatars
- Add avatar upload to profile page
- Display avatars in candidate cards, recruiter dashboard, comments

### Step 3: Add Empty State Illustrations (30 min)
- Use Undraw SVGs for empty states
- Add to dashboard, job lists, search results, notifications

### Step 4: Company Logo Upload (1 hour)
- Add logo upload to company profile page
- Display logos in job cards, company directory, trust section

### Step 5: App Screenshots (30 min)
- Capture staging screenshots
- Add to landing page features section
- Add to marketing materials

## Image Sources (Free, No Attribution Required)

- **Unsplash:** `https://unsplash.com` — high-quality photos
- **Undraw:** `https://undraw.co` — customizable illustrations
- **DiceBear:** `https://dicebear.com` — generated avatars
- **Heroicons:** Already using, but these are icons not images
- **UI Avatars:** `https://ui-avatars.com` — text-based avatars

## Next Steps

1. Suga will delegate to FE agent to add Unsplash images to landing page
2. Suga will delegate to FE agent to add avatar system
3. Suga will delegate to FE agent to add empty state illustrations
4. Ranga to approve image style direction (photos vs illustrations vs mixed)

---
*Waiting for Ranga's direction on image style before proceeding.*
