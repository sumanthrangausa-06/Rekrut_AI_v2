# Frontend Migration: Legacy HTML to React

**Status:** In Progress  
**Last Updated:** May 2026

---

## Overview

Migrating legacy HTML pages in `/public/` folder to React components with Tailwind CSS. The server now serves **only the React SPA** from `client/dist/` as the main frontend.

### Tech Stack
- React 19
- Vite
- Tailwind CSS
- Shadcn UI components
- React Router v6
- Lucide React icons

---

## Migration Status

### ✅ Completed

| Page | Legacy HTML | React Component | Notes |
|------|-------------|-----------------|-------|
| Login | `login.html` | `src/pages/login.tsx` | Full migration with auth context |
| Register | `register.html` | `src/pages/register.tsx` | Full migration with role selection |
| Forgot Password | - | `src/pages/forgot-password.tsx` | Full migration |
| Reset Password | - | `src/pages/reset-password.tsx` | Full migration |
| **Recruiter** | | | |
| Recruiter Dashboard | `recruiter-dashboard.html` | `src/pages/recruiter/dashboard.tsx` | Full migration with stats, quick actions |
| Recruiter Analytics | `recruiter-analytics.html` | `src/pages/recruiter/analytics.tsx` | Migrated 2025-05-01 |
| Recruiter Jobs | `recruiter-jobs.html` | `src/pages/recruiter/jobs.tsx` | Full migration |
| Recruiter Applications | `recruiter-applications.html` | `src/pages/recruiter/applications.tsx` | Full migration |
| Recruiter Interviews | `recruiter-interviews.html` | `src/pages/recruiter/interviews.tsx` | Full migration |
| Recruiter Offers | `offer-management.html` | `src/pages/recruiter/offers.tsx` | Full migration |
| Recruiter Company Profile | `company-profile.html` | `src/pages/recruiter/company.tsx` | Full migration |
| Recruiter Onboarding | `recruiter-onboarding-ai.html` | `src/pages/recruiter/onboarding.tsx` | Full migration |
| Recruiter Payroll | `payroll-dashboard.html` | `src/pages/recruiter/payroll.tsx` | Full migration |
| Recruiter OmniScore | `recruiter-trustscore.html` | `src/pages/recruiter/omniscore.tsx` | Full migration |
| **Candidate** | | | |
| Candidate Dashboard | `candidate-dashboard.html` | `src/pages/candidate/dashboard.tsx` | Full migration |
| Candidate Jobs | `jobs.html` | `src/pages/candidate/jobs.tsx` | Full migration |
| Candidate Applications | - | `src/pages/candidate/applications.tsx` | Full migration |
| Candidate Profile | `candidate-profile.html` | `src/pages/candidate/profile.tsx` | Full migration |
| Candidate Interviews | `interview.html` | `src/pages/candidate/interviews.tsx` | Full migration |
| Candidate Offers | - | `src/pages/candidate/offers.tsx` | Full migration |
| Candidate Onboarding | - | `src/pages/candidate/onboarding.tsx` | Full migration |
| Candidate Payroll | `employee-payroll.html` | `src/pages/candidate/payroll.tsx` | Full migration |
| Candidate OmniScore | - | `src/pages/candidate/omniscore.tsx` | Full migration |
| Candidate AI Coaching | - | `src/pages/candidate/ai-coaching.tsx` | Full migration |
| **Admin** | | | |
| Admin Login | - | `src/pages/admin/login.tsx` | Full migration |
| Admin AI Health | - | `src/pages/admin/ai-health.tsx` | Full migration |

### 🔄 Placeholder (Needs Migration)

| Page | Legacy HTML | Current Status |
|------|-------------|----------------|
| Recruiter Candidates | - | `src/pages/placeholder.tsx` |
| Candidate Documents | `documents.html` | `src/pages/placeholder.tsx` |
| Settings | - | `src/pages/placeholder.tsx` |

### 📋 Legacy Only (Not Yet Migrated)

| Page | Legacy HTML | Priority |
|------|-------------|----------|
| Job Board | `job-board.html` | Medium |
| Interview Practice | `interview-practice.html` | Medium |
| Video Interview | `video-interview.html` | Medium |
| Assessment Results | `assessment-results.html` | Medium |
| Recruiter Profile | `recruiter-profile.html` | Low |
| Recruiter Communications | `recruiter-communications.html` | Medium |
| Recruiter TrustScore | `recruiter-trustscore.html` | Low (omniscore covers) |
| History | `history.html` | Low |
| Job Create | `job-create.html` | Merged into job-form.tsx |
| Payroll Run | `payroll-run.html` | Low |
| Admin Analytics | `admin-analytics.html` | Low |
| Compliance Dashboard | `compliance-dashboard.html` | Medium |
| Post-Hire Feedback | `post-hire-feedback.html` | Low |

---

## What's NOT Deprecated

**Static assets that can remain in `/public/`:**
- `favicon.ico`, `favicon.png`
- `robots.txt`
- `sitemap.xml`
- Any other truly static files (images, fonts, etc.)

---

## Breaking Changes

⚠️ **Direct access to legacy URLs like `/recruiter-dashboard.html` will NOT work anymore.**

**Use the React router path instead:**
```
Old: http://localhost:3000/recruiter-dashboard.html
New: http://localhost:3000/recruiter/dashboard
```

---

## How to Migrate a Page

1. Create `.tsx` component in `client/src/pages/`
2. Port HTML → React components
3. Port inline CSS → Tailwind classes
4. Port inline JavaScript → React hooks/functions
5. Hook up to React Router in `App.tsx`
6. Connect to `/api/` routes (already exist)
7. Test in React app
8. Delete legacy HTML file
9. Update this tracking document

---

## Environment Setup

### Production Build

```bash
# Install dependencies
npm install
cd client && npm install && cd ..

# Build React frontend
npm run build

# Start server
npm start
```

### Development (with Vite live reload)

```bash
# Terminal 1: Backend
npm run dev

# Terminal 2: Frontend (React live reload)
cd client && npm run dev
```

---

## References

- **React Router setup:** `client/src/App.tsx`
- **API endpoints:** `routes/` folder
- **Tailwind CSS config:** `client/tailwind.config.ts`
- **Component patterns:** `client/src/pages/`
