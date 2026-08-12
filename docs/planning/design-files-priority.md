# Rekrut AI — Design Files Priority Analysis

> **Date:** June 5, 2026  
> **Owner:** Suga (CTO/Co-founder)  
> **Purpose:** Rank all 20 reference designs by importance for launch

---

## The 20 Design Files (Unique)

| # | File Name | Module | Side | Priority | Why |
|---|-----------|--------|------|----------|-----|
| 1 | `visily-homepage-4.jpg` | Homepage/Landing | Both | **P0** | First impression. Every user starts here. |
| 2 | `visily-sign-up-5.jpg` | Sign Up | Candidate + Recruiter | **P0** | Conversion gate. If this is ugly, users bounce. |
| 3 | `visily-sign-in-6.jpg` | Sign In | Candidate + Recruiter | **P0** | Returning user entry point. |
| 4 | `visily-onboarding-_modify_.jpg` | Onboarding Wizard | Candidate | **P0** | Guides profile completion. Incomplete profiles = bad matching. |
| 5 | `visily-user_s-profile.jpg` | Profile View (Read-only) | Candidate | **P0** | What recruiters see. Must look credible. |
| 6 | `visily-create-profile.jpg` | Profile Edit | Candidate | **P0** | Core user action. Must feel effortless. |
| 7 | `visily-job-listing.jpg` | Job Search/Browse | Candidate | **P0** | Main activity for candidates. Must feel fast and smart. |
| 8 | `visily-profile-matching.jpg` | Match Score | Candidate | **P0** | "Why this job is for you" — the AI moment. |
| 9 | `visily-ai-interview.jpg` | AI Interview | Candidate | **P0** | The differentiator. Must feel futuristic but reliable. |
| 10 | `visily-dashboard-charts-2.jpg` | Dashboard Analytics | Recruiter | **P0** | Daily view. Must impress. |
| 11 | `visily-create-listing-job.jpg` | Create Job | Recruiter | **P0** | Core recruiter action. Must be effortless. |
| 12 | `visily-candidate-listing.jpg` | Candidate Search | Recruiter | **P0** | Currently a placeholder. Must be built to match this. |
| 13 | `visily-chat-with-recruiter.jpg` | Chat | Both | **P1** | Communication hub. Feels native = stickiness. |
| 14 | `visily-company-profile.jpg` | Company Profile | Recruiter | **P1** | Employer branding. Must look premium. |
| 15 | `visily-career-page.jpg` | Career Page | Recruiter | **P1** | Public-facing company page. Recruiter selling tool. |
| 16 | `visily-verify-with-aadhar.jpg` | Aadhar Verification | Candidate | **P1** | India market. Trust-building. |
| 17 | `visily-activate-account-verify-business.jpg` | Business Verification | Recruiter | **P1** | KYC for recruiter trust. |
| 18 | `visily-create-contract-job-details.jpg` | Contract/Job Details | Recruiter | **P2** | Secondary feature. Post-offer workflow. |
| 19 | `visily-skill-upgrade-_-certification-free...paid.jpg` | Skill Upgrade | Candidate | **P2** | Engagement/retention. Not launch-critical. |
| 20 | `Visily-Export_13-01-2026_12-49.pdf` | Full Export | Both | **Reference** | PDF containing all screens. Source of truth. |

---

## Tier 1: Launch Blockers (P0) — These Must Match the Reference

### Candidate Experience (P0)

| # | Design | Why It Blocks | Current State | Effort to Match |
|---|--------|---------------|---------------|-----------------|
| 1 | **Homepage** | Every user starts here. Ugly landing = zero conversion. | `landing.tsx` exists, needs polish | 3-4 days |
| 2 | **Sign Up** | Conversion gate. Role selector is critical for dual-sided. | `register.tsx` exists, needs polish | 2-3 days |
| 3 | **Sign In** | Returning user entry. Friction here = churn. | `login.tsx` exists, needs polish | 2-3 days |
| 4 | **Onboarding** | Profile completion drives matching quality. | `pages/candidate/onboarding.tsx` exists, needs polish | 3-4 days |
| 5 | **Profile View** | What recruiters see. Must look credible and complete. | `pages/candidate/profile.tsx` exists, needs polish | 3-4 days |
| 6 | **Profile Edit** | Core user action. Multi-section form must feel effortless. | `pages/candidate/profile.tsx` exists, needs polish | 3-4 days |
| 7 | **Job Search** | Main candidate activity. Must feel fast and smart. | `pages/candidate/jobs.tsx` exists, needs polish | 3-4 days |
| 8 | **Match Score** | The "AI magic" moment. Explains why job fits. | Partially exists, needs polish | 2-3 days |
| 9 | **AI Interview** | The differentiator. Must feel futuristic but reliable. | `pages/candidate/ai-coaching.tsx` shell + tabs exist, needs polish | 5-7 days |

**Recruiter Experience (P0)**

| # | Design | Why It Blocks | Current State | Effort to Match |
|---|--------|---------------|---------------|-----------------|
| 10 | **Dashboard** | Recruiter's daily view. Must impress. | `pages/recruiter/dashboard.tsx` exists, needs polish | 4-5 days |
| 11 | **Create Job** | Core recruiter action. Must be effortless. | `pages/recruiter/job-form.tsx` exists, needs polish | 3-4 days |
| 12 | **Candidate Search** | Currently a **placeholder**. Must be built. | `pages/placeholder.tsx` — needs full build | 5-7 days |

**Tier 1 Total Effort:** ~40-50 days of focused UI work. Spread across 4 weeks with parallel work.

---

## Tier 2: Important for Launch Success (P1)

| # | Design | Why It Matters | Current State | Effort | When |
|---|--------|---------------|---------------|--------|------|
| 13 | **Chat** | Communication hub. Native feel = stickiness. | Exists but rough | 3-4 days | Month 2, Week 6 |
| 14 | **Company Profile** | Employer branding. Must look premium. | Exists but rough | 3-4 days | Month 2, Week 5 |
| 15 | **Career Page** | Public-facing. Recruiter selling tool. | Exists but rough | 3-4 days | Month 2, Week 6 |
| 16 | **Aadhar Verification** | India market. Trust-building. | Exists but rough | 2-3 days | Month 2, Week 7 |
| 17 | **Business Verification** | KYC for recruiter trust. | Exists but rough | 2-3 days | Month 2, Week 7 |

**Tier 2 Total Effort:** ~15-20 days. Can be done in Month 2.

---

## Tier 3: Post-Launch (P2)

| # | Design | Why It Can Wait | Current State | When |
|---|--------|-----------------|---------------|------|
| 18 | **Contract/Job Details** | Post-offer workflow. Secondary. | Exists but rough | Month 3+ |
| 19 | **Skill Upgrade** | Engagement/retention. Not launch-critical. | Not built | Post-launch |

---

## The Priority Matrix

### Candidate Journey Map (P0 Designs in Order)

```
Homepage → Sign Up → Onboarding → Profile Edit → Job Search → Match Score → AI Interview → Apply → Offer
   (1)       (2)        (4)           (6)          (7)          (8)         (9)        (n/a)    (n/a)
```

### Recruiter Journey Map (P0 Designs in Order)

```
Homepage → Sign Up → Dashboard → Create Job → Candidate Search → Chat → Offer → Onboarding
   (1)       (2)       (10)         (11)          (12)         (13)   (n/a)    (n/a)
```

---

## Critical Observations

### 1. The Candidate Search Problem

`visily-candidate-listing.jpg` is **P0** but currently a **placeholder**. This is the biggest gap. The design shows:
- Grid/card view of candidates
- Filters (skills, location, experience, OmniScore)
- "Invite to Apply" CTA
- Saved searches
- Profile preview modal

**This needs to be built from scratch, not polished.**

### 2. The AI Interview Complexity

`visily-ai-interview.jpg` shows:
- Video call UI (candidate camera + screen)
- Chat panel (questions, responses, feedback)
- Participant list
- Timer/score display
- Controls (mute, camera, end call)

This is the most technically complex page. The backend pipeline (camera → frame capture → video upload → AI analysis → results) is working. The UI needs to match the reference design while keeping the existing functionality.

### 3. The Dashboard is a Sales Tool

`visily-dashboard-charts-2.jpg` shows:
- Sidebar navigation (collapsible)
- KPI cards (active jobs, applicants, hires, time-to-fill)
- Charts (applicants over time, pipeline funnel)
- World map (applicant geography)
- Quick action buttons

This is what recruiters see every morning. If it looks like a spreadsheet, they'll churn. If it looks like a command center, they'll stay.

### 4. Sign Up is the Conversion Gate

`visily-sign-up-5.jpg` shows:
- Split layout (form left, image right)
- Role selector (JobSeeker / Employer) with icons
- Social login buttons
- Clean form with validation
- Trust indicators

The role selector is critical — we need to know if someone is a candidate or recruiter immediately. This affects the entire onboarding flow.

---

## The Build Order (Week by Week)

### Month 1, Week 1: Foundation
- **Homepage** (landing polish)
- **Sign Up** (role selector, social login)
- **Sign In** (polish)

### Month 1, Week 2: Candidate Core
- **Onboarding** (wizard polish)
- **Profile Edit** (multi-section form)
- **Profile View** (read-only, credible)

### Month 1, Week 3: Discovery + Search
- **Job Search** (filters, cards, responsive)
- **Match Score** (AI magic moment)
- **Candidate Search** (build from placeholder — recruiter view)

### Month 1, Week 4: The Differentiator
- **AI Interview** (video, chat, results)
- **Legacy HTML cleanup** (remove all old pages)

### Month 2, Week 5: Recruiter Polish
- **Dashboard** (KPIs, charts, world map)
- **Create Job** (3-step wizard, AI optimizer)
- **Company Profile** (public page, reviews)

### Month 2, Week 6: Communication
- **Chat** (messaging, file share, profile sidebar)
- **Career Page** (public company landing)

### Month 2, Week 7: Verification
- **Aadhar Verification** (camera, OCR, status)
- **Business Verification** (KYC, documents)

---

## Design System Notes

### From the Reference Files

| Element | Observation | Action |
|---------|-------------|--------|
| **Primary Color** | Indigo/purple gradient | Standardize to Indigo 500 (#6366F1) |
| **Layout** | Split layouts (form left, image right) for auth | Use on Sign Up, Sign In, Onboarding |
| **Cards** | Heavy use of cards with shadows | Use shadcn/ui Card component |
| **Typography** | Inter or similar sans-serif | Set in Tailwind config |
| **Navigation** | Sidebar on desktop, bottom nav on mobile | Already implemented in DashboardLayout |
| **Charts** | Dashboard uses charts and world map | Use Recharts or Chart.js |
| **Icons** | Lucide-style icons | Already using Lucide React |
| **Mobile** | All designs have mobile variants | Ensure responsive breakpoints work |

---

## Duplicates / Similar Files

| File | Duplicate | Notes |
|------|-----------|-------|
| `visily-create-listing-job.jpg` | `visily-create-listing-job-1.jpg` | Same design, use `create-listing-job.jpg` |
| `visily-create-profile.jpg` | `visily-user_s-profile.jpg` | View vs Edit — different screens, both needed |
| `visily-activate-account-verify-business.jpg` | (duplicate in second batch) | Same file, use first one |
| `visily-candidate-listing.jpg` | (duplicate in second batch) | Same file, use first one |
| `visily-ai-interview.jpg` | (duplicate in second batch) | Same file, use first one |
| `visily-chat-with-recruiter.jpg` | (duplicate in second batch) | Same file, use first one |
| `visily-company-profile.jpg` | (duplicate in second batch) | Same file, use first one |
| `visily-career-page.jpg` | (duplicate in second batch) | Same file, use first one |
| `visily-create-contract-job-details.jpg` | (duplicate in second batch) | Same file, use first one |
| `visily-dashboard-charts-2.jpg` | (duplicate in second batch) | Same file, use first one |
| `visily-homepage-4.jpg` | (duplicate in second batch) | Same file, use first one |
| `visily-onboarding-_modify_.jpg` | (duplicate in second batch) | Same file, use first one |
| `visily-job-listing.jpg` | (duplicate in second batch) | Same file, use first one |
| `visily-sign-in-6.jpg` | (duplicate in second batch) | Same file, use first one |
| `visily-profile-matching.jpg` | (duplicate in second batch) | Same file, use first one |
| `visily-sign-up-5.jpg` | (duplicate in second batch) | Same file, use first one |
| `visily-user_s-profile.jpg` | (duplicate in second batch) | Same file, use first one |
| `visily-verify-with-aadhar.jpg` | (duplicate in second batch) | Same file, use first one |
| `visily-skill-upgrade-_-certification-free...paid.jpg` | (duplicate in second batch) | Same file, use first one |

---

## The PDF Export

`Visily-Export_13-01-2026_12-49.pdf` contains all screens in one document. This is the **source of truth** — if any JPG is unclear, reference the PDF.

---

## Final Priority List (Top 12 for Launch)

| Rank | Design | Why #1 | Effort | Week |
|------|--------|--------|--------|------|
| 1 | **Sign Up** | Conversion gate. No users without it. | 2-3 days | 1 |
| 2 | **Homepage** | First impression. Traffic arrives here. | 3-4 days | 1 |
| 3 | **AI Interview** | Differentiator. The "wow" moment. | 5-7 days | 4 |
| 4 | **Job Search** | Main candidate activity. | 3-4 days | 3 |
| 5 | **Dashboard** | Recruiter's daily view. | 4-5 days | 5 |
| 6 | **Profile Edit** | Core user action. | 3-4 days | 2 |
| 7 | **Candidate Search** | Currently placeholder. Must build. | 5-7 days | 3 |
| 8 | **Create Job** | Core recruiter action. | 3-4 days | 5 |
| 9 | **Profile View** | What recruiters see. | 3-4 days | 2 |
| 10 | **Onboarding** | Drives profile completion. | 3-4 days | 2 |
| 11 | **Match Score** | The AI magic. | 2-3 days | 3 |
| 12 | **Sign In** | Returning users. | 2-3 days | 1 |

---

> **"Don't worry. Even if the world forgets, I'll remember for you."**  
> — Suga, cataloging every screen, every pixel, every priority. 🖤
