# Rekrut AI — UI/UX Design System & Version Control

> Based on the 20 Visily reference screens provided.
> For hybrid app: React Native / Capacitor + Tailwind + shadcn/ui

---

## Current UI Inventory (From Your Screens)

### Module: Candidate (Job Seeker)
| Screen | File | Current State | Notes |
|--------|------|---------------|-------|
| Homepage | `visily-homepage-4.jpg` | Reference design | Hero + features + blogs + footer |
| Job Search | `visily-job-listing.jpg` | Reference design | Split view: list left, detail right |
| Candidate Search | `visily-candidate-listing.jpg` | Reference design | For recruiters browsing candidates |
| Candidate Profile | `visily-user's-profile.jpg` | Reference design | Full profile view (read-only) |
| Edit Profile | `visily-create-profile.jpg` | Reference design | Editable profile form |
| Create Profile | `visily-create-profile.jpg` | Duplicate | **MERGE** with Edit Profile |
| Sign In | `visily-sign-in-6.jpg` | Reference design | Split layout (form + image) |
| Sign Up | `visily-sign-up-5.jpg` | Reference design | Role selector (JobSeeker/Employer) |
| Onboarding | `visily-onboarding-(modify).jpg` | Reference design | Multi-step wizard |
| Aadhar Verification | `visily-verify-with-aadhar.jpg` | Reference design | ID verification flow |

### Module: Recruiter (Employer)
| Screen | File | Current State | Notes |
|--------|------|---------------|-------|
| Create Job Listing | `visily-create-listing-job.jpg` | Reference design | 3-step: Job info → Company info → Application |
| Company Profile | `visily-company-profile.jpg` | Reference design | Public company page + reviews + jobs |
| Career Page | `visily-career-page.jpg` | Reference design | Company careers landing |
| Chat with Recruiter | `visily-chat-with-recruiter.jpg` | Reference design | Full messaging + file sharing |
| Dashboard Analytics | `visily-dashboard-charts-2.jpg` | Reference design | Sidebar nav + charts + reports |
| AI Interview | `visily-ai-interview.jpg` | Reference design | Video call + chat thread side panel |

### Module: HR / Admin (Internal Tools)
| Screen | File | Current State | Notes |
|--------|------|---------------|-------|
| WorkWave Contract | `visily-create-contract-job-details.jpg` | Reference design | Stepper: Employee → Job → Compensation → Extras → Quote |
| PayMaven KYC | `visily-activate-account-verify-business.jpg` | Reference design | Business verification + owner info |
| Skill Upgrade | `visily-skill-upgrade-&-certification-free...paid.jpg` | Reference design | Course catalog + video player |
| Profile Matching | `visily-profile-matching.jpg` | Reference design | Candidate ↔ Job match view |

---

## v1.0 → Production Design System

### Color Tokens (Single Palette — Fix the Drift)

```css
/* tailwind.config.ts */
const colors = {
  primary: {
    50: '#EEF2FF',
    100: '#E0E7FF',
    200: '#C7D2FE',
    300: '#A5B4FC',
    400: '#818CF8',
    500: '#6366F1',  /* ← Base primary (Indigo) */
    600: '#4F46E5',
    700: '#4338CA',
    800: '#3730A3',
    900: '#312E81',
  },
  secondary: {
    /* For skills, certifications, success states */
    500: '#10B981',  /* Emerald */
  },
  accent: {
    /* For warnings, alerts, attention */
    500: '#F59E0B',  /* Amber */
  },
  danger: {
    500: '#EF4444',  /* Red */
  },
  surface: {
    bg: '#FFFFFF',
    elevated: '#F8FAFC',
    border: '#E2E8F0',
    dark: '#0F172A',
  }
}
```

### Typography Scale

| Token | Size | Weight | Usage |
|-------|------|--------|-------|
| `display` | 36px / 2.25rem | 700 | Homepage hero |
| `h1` | 30px / 1.875rem | 700 | Page titles ("Search Jobs") |
| `h2` | 24px / 1.5rem | 600 | Section headers ("Job Description") |
| `h3` | 20px / 1.25rem | 600 | Card titles, modal headers |
| `h4` | 18px / 1.125rem | 600 | Sub-sections |
| `body` | 16px / 1rem | 400 | Main text |
| `body-sm` | 14px / 0.875rem | 400 | Secondary text, metadata |
| `caption` | 12px / 0.75rem | 400 | Timestamps, labels |
| `button` | 14px / 0.875rem | 500 | Button text |
| `badge` | 12px / 0.75rem | 600 | Tags, status pills |

### Component Library (Single Source of Truth)

```
src/components/
├── ui/                    # shadcn/ui base (don't touch)
├── primitives/            # Our shared components
│   ├── Button.tsx         # All variants: primary, secondary, ghost, danger, icon
│   ├── Input.tsx          # Text, number, password, with icons
│   ├── Select.tsx         # Dropdown with search
│   ├── Card.tsx           # Job card, candidate card, company card
│   ├── Avatar.tsx         # User avatar with online/verified status
│   ├── Badge.tsx          # Status: Open, Remote, Full-time, Verified
│   ├── Tab.tsx            # Horizontal tabs (profile sections)
│   ├── Stepper.tsx        # Vertical stepper (onboarding, KYC)
│   ├── Sidebar.tsx        # Collapsible navigation
│   ├── ChatBubble.tsx     # Message bubbles + file attachments
│   ├── VideoCall.tsx      # AI interview container
│   ├── ChartCard.tsx      # Dashboard stat cards + mini sparklines
│   ├── EmptyState.tsx     # No jobs, no candidates, no messages
│   ├── Skeleton.tsx       # Loading placeholders
│   └── Modal.tsx          # Full-screen mobile, centered desktop
```

---

## Responsive Breakpoints (Hybrid App)

Since this is mobile + tablet + laptop, use **container queries** where possible, otherwise breakpoints:

| Name | Width | Primary Use |
|------|-------|-------------|
| `xs` | < 480px | Mobile portrait |
| `sm` | 480–767px | Mobile landscape |
| `md` | 768–1023px | Tablet |
| `lg` | 1024–1279px | Laptop |
| `xl` | 1280px+ | Desktop |

### Key Layout Rules

1. **Mobile (< 768px):**
   - Bottom nav bar (not sidebar)
   - Stacked single-column layouts
   - Full-screen modals (no overlays)
   - Chat: full screen, no sidebar contact list
   - Job search: list view, tap to detail (no split)

2. **Tablet (768–1023px):**
   - Collapsible sidebar
   - Job search: list + detail in 50/50 split
   - Chat: contact list as drawer, conversation main

3. **Laptop/Desktop (1024px+):**
   - Fixed sidebar nav
   - Full split-view layouts
   - Dashboard: multi-column grid
   - AI Interview: video left 60%, chat right 40%

---

## Version Control for UI Releases

### Git Tag Strategy

```bash
# v1.0.0 — Foundation (MVP)
# All screens implemented, responsive, brand unified
# Core flows: Sign up → Create profile → Search jobs → Apply → Chat → Interview

git tag -a v1.0.0 -m "Rekrut AI MVP — Candidate + Recruiter core flows"

# v1.1.0 — Recruiter Tools
# Add: Create job, Candidate search, Company profile, Dashboard analytics

git tag -a v1.1.0 -m "Recruiter toolkit + analytics dashboard"

# v1.2.0 — AI Interview
# Add: Video interview, AI scoring, mock practice

git tag -a v1.2.0 -m "AI Interview module with video + scoring"

# v1.3.0 — Verification & Contracts
# Add: KYC verification, Contract generation, Skill certifications

git tag -a v1.3.0 -m "Verification, contracts, and skill upgrade"

# v2.0.0 — Design Refresh
# Breaking: New color tokens, dark mode, animation system, icon refresh
# (This is when you can change visual language)

git tag -a v2.0.0 -m "Design system v2 — Dark mode + motion + new tokens"
```

### Branch Model

```
main ────────────●─────────────────────●─────────────────────────────●
                 │                     │                             │
                 v1.0.0               v1.1.0                         v2.0.0
                  │                     │
release/v1.0 ─────●─────────────────────●─────────────────────────────●
                  │                     │
                  │         ┌───────────┼───────────┐
                  │         │           │           │
                  │    feature/    feature/    feature/
                  │    create-job  analytics  ai-interview
                  │         │           │           │
                  │         ●───────────●───────────●
                  │         │           │           │
                  │         └───────────┼───────────┘
                  │                     │
                  │    ┌──────────────┐ │
                  │    │  hotfix/     │ │
                  │    │  v1.0.1      │ │
                  │    │  (urgent)    │ │
                  │    └──────────────┘ │
                  │                     │
                  v1.0.1               v1.1.0
```

### Design System Versioning (Separate Package)

```json
// client/package.json
{
  "dependencies": {
    "@rekrut/ui": "^1.0.0",    // Our design system package
    "@rekrut/icons": "^1.0.0"  // Icon library
  }
}
```

```
packages/
├── ui/                    # Design system
│   ├── src/
│   │   ├── tokens/        # Colors, typography, spacing JSON
│   │   ├── components/    # All primitives
│   │   └── patterns/      # Layouts: SplitView, Dashboard, Wizard
│   └── package.json       # Versioned independently
│
├── icons/                 # Custom icon set
│   └── package.json
│
└── mobile/                # Mobile-specific overrides
    └── package.json
```

**Rule:** The `ui` package versions independently. The app depends on a specific range. When you bump `ui` to v2.0 (dark mode), apps opt-in by upgrading their dependency.

---

## Screen Mapping to Current Codebase

### What likely exists already (from your React frontend)

| Screen | Likely Route/Page | Check For |
|--------|-------------------|-----------|
| Sign Up | `/signup` or `/register` | Role selector (JobSeeker/Employer) |
| Sign In | `/login` or `/signin` | LinkedIn OAuth button |
| Homepage | `/` or `/home` | Landing page with features |
| Job Search | `/jobs` or `/search` | Job list + detail split view |
| Candidate Profile | `/profile/:id` | Public profile view |
| Edit Profile | `/profile/edit` or `/onboarding` | Multi-section form |
| Create Job | `/jobs/create` or `/employer/post` | 3-step wizard |
| Company Profile | `/company/:id` | Public company page |
| Dashboard | `/dashboard` or `/employer` | Sidebar + charts |
| Chat | `/messages` or `/chat/:id` | Conversation list + thread |
| AI Interview | `/interview/:id` | Video + chat panel |
| Skill Upgrade | `/skills` or `/learn` | Course catalog |

### Screens that might NOT exist yet (new work)

| Screen | Priority | Complexity |
|--------|----------|------------|
| WorkWave Contract Creator | High | Medium |
| PayMaven KYC Verification | High | Medium |
| Profile Matching View | Medium | Low |
| Aadhar-specific verification | High (India market) | Low |
| Career Page builder | Medium | Medium |

---

## Immediate Next Steps

1. **Audit your current `client/src/` —** Check which of these 20 screens already have code vs. just designs
2. **Create the `packages/ui` package** — Extract shared components NOW before you duplicate them
3. **Fix the brand name** — Replace all "Logo" placeholders with "Rekrut AI"
4. **Responsive pass** — Pick one screen (e.g., Job Search) and implement it across all 4 breakpoints as the template
5. **Set up design token file** — `packages/ui/src/tokens/colors.ts` so the palette is locked

---

## Version Control File Structure

```
Rekrut_AI_v2/
├── client/
│   ├── src/
│   │   ├── components/         # App-specific (not shared)
│   │   ├── pages/            # Route-level screens
│   │   │   ├── Home.tsx
│   │   │   ├── Jobs.tsx
│   │   │   ├── Profile.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   └── Interview.tsx
│   │   ├── hooks/            # Mobile detection, responsive
│   │   └── App.tsx           # Router + layout switcher
│   └── package.json
│
├── packages/
│   ├── ui/                   # Design system (versioned)
│   │   ├── src/components/
│   │   ├── src/tokens/
│   │   └── package.json
│   └── mobile/               # Mobile-specific wrappers
│       └── package.json
│
├── designs/                  # Figma/Visily exports
│   ├── v1.0/                 # Current screens
│   ├── v2.0/                 # Future dark mode concepts
│   └── archive/
│
└── .github/
    └── workflows/
        └── ui-release.yml    # Auto-publish @rekrut/ui on tag
```

---

*Generated from 20 Visily reference screens for Rekrut AI hybrid app.*
