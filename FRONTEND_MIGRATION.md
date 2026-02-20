# Frontend Migration: Removing Legacy HTML Files

**Date:** February 17, 2026  
**Status:** In Progress  
**Change:** Deprecating legacy HTML files in `/public/` folder - transitioning to React client app only

---

## Summary

The server has been updated to serve **only the React SPA** from `client/` as the main frontend. Legacy HTML files in the `/public/` folder are no longer served by the Express server.

### Changed in `server.js`

- ❌ Removed fallback to legacy `public/` folder HTML rendering
- ✅ Now serves only React build from `client/dist/`
- ✅ Static assets (favicon, robots.txt, etc.) can still live in `/public/`
- ✅ All routing now goes through React SPA router

---

## What's Being Deprecated

**These HTML files in `/public/` are deprecated and should be removed or migrated to React:**

### Admin Pages (7 files)
- `admin-analytics.html` → Use React component at `client/src/pages/admin/`
- `compliance-dashboard.html` → Use React component at `client/src/pages/admin/`
- `recruiter-analytics.html` → Migrate to React
- `recruiter-trustscore.html` → Migrate to React

### Candidate Pages (12 files)
- `candidate-onboarding-ai.html`
- `candidate-dashboard.html`
- `candidate-profile.html`
- `assessment-results.html`
- `assessment-take.html`
- `interview-analysis.html`
- `interview-practice.html`
- `interview.html`
- `omniscore.html`
- `post-hire-feedback.html`
- `skill-assessments.html`
- `video-interview.html`

### Recruiter Pages (10 files)
- `recruiter-onboarding-ai.html`
- `recruiter-onboarding-docs.html`
- `recruiter-interviews.html`
- `recruiter-dashboard.html`
- `recruiter-applications.html`
- `recruiter-communications.html`
- `recruiter-jobs.html`
- `recruiter-register.html`
- `recruiter-profile.html`
- `job-create.html`

### Utility Pages (5 files)
- `login.html`
- `register.html`
- `pricing.html`
- `dashboard.html`
- `payment-success.html`

### Asset Files (4 folders + 1 file)
- `css/` - All stylesheets (migrate to Tailwind CSS in React)
- `js/` - All JavaScript (migrate to React components)
- `index.html` - Will be served from React build
- `history.html`
- `documents.html`, `job-board.html`, `jobs.html`, `offer-management.html`, `onboarding.html`, `payroll-dashboard.html`, `payroll-run.html`

---

## What's NOT Deprecated

**Static assets that can remain in `/public/`:**
- `favicon.ico`, `favicon.png`
- `robots.txt`
- `sitemap.xml`
- Any other truly static files (images, fonts, etc.)

⚠️ **Important:** Server will NOT serve HTML files from `/public/` anymore. All HTML must come from React app or be served directly without `.html` extension.

---

## Migration Path

### Phase 1: Immediate (Done ✅)
- ✅ Update `server.js` to only serve React SPA
- ✅ Remove legacy public folder fallback
- ✅ Add proper error handling for missing React build

### Phase 2: React Component Migration (In Progress)
For each deprecated HTML file:
1. Create corresponding `.tsx` component in `client/src/pages/`
2. Port HTML → React components
3. Port inline CSS → Tailwind classes
4. Port inline JavaScript → React hooks/functions
5. Hook up to React Router

**Priority order for migration:**
1. **HIGH** - Login/Register (auth flow)
2. **HIGH** - Main dashboards (candidate, recruiter)
3. **MEDIUM** - Assessments, interviews, onboarding
4. **LOW** - Analytics, utilities

### Phase 3: Cleanup (Pending)
- Archive/delete migrated HTML files
- Clean up `/public/css/` and `/public/js/`
- Update build script in `package.json` if needed

---

## Current Status by Page

| Page | Status | Location | Notes |
|------|--------|----------|-------|
| Landing | ✅ React | `client/src/pages/landing.tsx` | Using Tailwind, fully migrated |
| Login | ❌ Legacy | `public/login.html` | Needs React migration |
| Register | ❌ Legacy | `public/register.html` | Needs React migration |
| Candidate Dashboard | ⚠️ Partial | `client/src/pages/candidate/` | React pages exist, may need consolidation |
| Recruiter Dashboard | ⚠️ Partial | `client/src/pages/recruiter/` | React pages exist, may need consolidation |
| Assessments | ❌ Legacy | `public/assessment-*.html` | Needs React migration |
| Interviews | ⚠️ Partial | Mixed | React + Legacy coexist |
| Onboarding | ⚠️ Partial | `client/src/components/` | Has React components, needs routing |
| Compliance | ❌ Legacy | `public/compliance-dashboard.html` | Needs React migration |
| Payroll | ⚠️ Partial | `client/src/pages/` | React exists but may be incomplete |

---

## Breaking Changes

⚠️ **If you reload the page, the server will ONLY serve the React app.**

Direct access to legacy URLs like `/recruiter-dashboard.html` will **NOT work** anymore.

**Instead, use the React router path:**
```
Old: http://localhost:3000/recruiter-dashboard.html
New: http://localhost:3000/recruiter/dashboard  (configured in React Router)
```

---

## How to Complete Migration

1. **Identify unmigrated pages** → Update this file with status
2. **For each legacy HTML file:**
   - Create `.tsx` component in React
   - Use Tailwind CSS instead of inline styles
   - Use React hooks instead of vanilla JS
   - Connect to `/api/` routes (already exist)
3. **Test in React app**
4. **Delete legacy HTML file**
5. **Update this tracking document**

---

## Environment Setup

When running locally, ensure React build is available:

```bash
# Install dependencies
npm install
cd client && npm install && cd ..

# Build React frontend
npm run build

# Start server
npm start
```

In development with Vite live reload:
```bash
# Terminal 1: Backend
npm run dev

# Terminal 2: Frontend (React live reload)
cd client && npm run dev
```

---

## Questions?

- **React Router setup:** Check `client/src/App.tsx`
- **API endpoints:** See `routes/` folder (all working)
- **Tailwind CSS:** See `client/tailwind.config.ts`
- **Component patterns:** Check existing React pages in `client/src/pages/`
