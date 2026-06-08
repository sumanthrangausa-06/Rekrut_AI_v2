# Rekrut AI — UI Action Plan: From Reference Designs to Production

**Date:** 2026-06-05
**Purpose:** Map 20 Visily reference screens to the competitive priorities, existing codebase gaps, and a concrete build sequence.

---

## The Strategy: UI → Competitive Moat

Your 20 screens aren't just "make it look pretty." Each screen directly addresses a competitive gap or reinforces your moat:

| Screen | Competitive Gap | Moat Reinforcement |
|--------|----------------|-------------------|
| **Dashboard Analytics** | Analytics & Insights (missing) | Recruiter retention, enterprise sales |
| **AI Interview** | Interview Coaching (built but UI weak) | HireVue competitor, both-sides coaching |
| **OmniScore + Profile Matching** | OmniScore depth (160 lines → needs explainability) | ZERO competitors have two-sided scoring |
| **Recruiter AI Screener** | Missing entirely | AI-native differentiator |
| **Chat with Recruiter** | Real-time Collaboration (partial) | Team hiring, faster decisions |
| **Skill Upgrade** | Candidate AI Career Coach (missing) | Upsell revenue, candidate retention |
| **EU AI Act Compliance** | Compliance dashboard (missing) | Enterprise sales enabler, Aug 2026 deadline |
| **Pricing Page** | Pricing is empty shell (577 bytes) | Revenue unblocker |

---

## Build Sequence: 4 Waves

### Wave 1: Revenue & Trust (Week 1-2)
**Goal:** Unblock money + make first impression credible

| Screen | Code Status | Action |
|--------|-------------|--------|
| **Sign Up** | `register.tsx` exists | Polish to match Visily reference (split layout, role selector) |
| **Sign In** | `login.tsx` exists | Polish to match Visily reference (split layout, social auth) |
| **Pricing Page** | `pricing.tsx` exists but EMPTY | Full redesign: 3 tiers, feature comparison, Stripe checkout CTA |
| **Candidate Profile** | `candidate/profile.tsx` exists | Upgrade to Visily reference (analytics sidebar, skill badges, experience timeline) |
| **Edit Profile** | `candidate/profile.tsx` (edit mode) | Upgrade to Visily reference (multi-section accordion, progress indicators) |

**Backend needed:**
- Stripe webhook validation (already deployed, needs testing)
- OmniScore v2 API (expanded from 160 lines to multi-factor)

**Deliverables:**
- [ ] `pricing.tsx` — full page with tiers, comparisons, FAQ
- [ ] `register.tsx` + `login.tsx` — polished, responsive, branded
- [ ] `candidate/profile.tsx` — upgraded to reference design
- [ ] OmniScore v2 API endpoint (multi-factor scoring)

---

### Wave 2: Core Differentiators (Week 3-4)
**Goal:** Make the AI features feel real and premium

| Screen | Code Status | Action |
|--------|-------------|--------|
| **AI Interview** | `candidate/interviews.tsx` exists | Upgrade to Visily reference (video + chat side panel, participant tiles) |
| **Dashboard Analytics** | `recruiter/dashboard.tsx` exists | Upgrade to Visily reference (KPI cards, charts, world map, date filters) |
| **Create Job Listing** | `recruiter/jobs.tsx` exists | Upgrade to Visily reference (3-step wizard, preview, skills tags) |
| **Profile Matching** | `candidate/matching.tsx` exists | Upgrade to Visily reference (match score visualization, job comparison) |
| **OmniScore Explainability** | `omniscore.tsx` exists | New UI: "Why this score?" breakdown, historical trends, peer comparison |

**Backend needed:**
- Recruiter AI Screener API (`routes/screening.js` has 7 endpoints, needs UI)
- OmniScore explainability (`scoreExplainer.js` exists, needs frontend)
- Interview video analysis (`interview-ai.js` exists, needs polished UI)

**Deliverables:**
- [ ] `recruiter/dashboard.tsx` — full analytics dashboard
- [ ] `candidate/interviews.tsx` — AI interview with video + chat
- [ ] `recruiter/jobs/create.tsx` — 3-step job creation wizard
- [ ] `candidate/omniscore.tsx` — explainable score breakdown
- [ ] `recruiter/screening.tsx` — AI screener UI (NEW)

---

### Wave 3: Enterprise & Compliance (Week 5-6)
**Goal:** Enterprise sales readiness + EU AI Act deadline

| Screen | Code Status | Action |
|--------|-------------|--------|
| **Company Profile** | `recruiter/company.tsx` exists | Upgrade to Visily reference (ratings, reviews, job cards, TrustScore) |
| **Career Page** | `recruiter/career-page.tsx` — CHECK | Public-facing careers page (team photos, benefits, open positions) |
| **Chat with Recruiter** | `communications.tsx` exists | Upgrade to Visily reference (full chat UI, file sharing, profile sidebar) |
| **EU AI Act Compliance** | `compliance.tsx` exists | New UI: Audit trail, risk classification, transparency reports |
| **Onboarding** | `candidate/onboarding.tsx` exists (97K tsx!) | Already built, but verify it matches reference design |

**Backend needed:**
- EU AI Act compliance dashboard (risk classification, audit trails)
- Calendar integration (Google + Outlook OAuth)
- Email notifications (Postmark templates)

**Deliverables:**
- [ ] `recruiter/company.tsx` — public company profile with TrustScore
- [ ] `recruiter/career-page.tsx` — public careers page (NEW or verify)
- [ ] `communications.tsx` — full chat interface
- [ ] `admin/compliance.tsx` — EU AI Act compliance dashboard
- [ ] Email templates: application received, interview scheduled, offer sent

---

### Wave 4: Advanced Features (Week 7-8)
**Goal:** Secondary features that differentiate and monetize

| Screen | Code Status | Action |
|--------|-------------|--------|
| **Skill Upgrade** | `candidate/skills.tsx` — CHECK | Course catalog, video player, progress tracking, certification badges |
| **WorkWave Contract** | NOT FOUND | Contract creation wizard (stepper: Employee → Job → Compensation → Extras → Quote) |
| **PayMaven KYC** | NOT FOUND | Business verification flow (owner info, ID upload, stepper) |
| **Candidate Search** | `recruiter/candidates.tsx` exists | Upgrade to Visily reference (filters, cards, CTA buttons, pagination) |
| **Aadhar Verification** | `candidate/verification.tsx` — CHECK | India-specific ID verification UI |

**Backend needed:**
- Contract generation API (templates, e-sign)
- KYC verification API (document upload, OCR, fraud detection)
- Skill certification API (course content, progress, certificates)

**Deliverables:**
- [ ] `candidate/skills.tsx` — skill upgrade catalog
- [ ] `recruiter/contract/create.tsx` — contract creation (NEW)
- [ ] `candidate/verification.tsx` — KYC + Aadhar verification (NEW)
- [ ] `recruiter/candidates.tsx` — candidate search with filters

---

## Screen-to-Code Mapping

### Existing Pages (Check & Upgrade)

| Visily Screen | Likely File | Status |
|---------------|-------------|--------|
| Sign In | `client/src/pages/login.tsx` | ✅ Exists, needs polish |
| Sign Up | `client/src/pages/register.tsx` | ✅ Exists, needs polish |
| Homepage | `client/src/pages/landing.tsx` | ✅ Exists, needs polish |
| Candidate Profile | `client/src/pages/candidate/profile.tsx` | ✅ Exists, needs polish |
| Edit Profile | `client/src/pages/candidate/profile.tsx` (edit) | ✅ Exists, needs polish |
| Dashboard | `client/src/pages/recruiter/dashboard.tsx` | ✅ Exists, needs polish |
| Create Job | `client/src/pages/recruiter/jobs.tsx` | ✅ Exists, needs polish |
| AI Interview | `client/src/pages/candidate/interviews.tsx` | ✅ Exists, needs polish |
| Chat | `client/src/pages/communications.tsx` | ✅ Exists, needs polish |
| Company Profile | `client/src/pages/recruiter/company.tsx` | ✅ Exists, needs polish |
| Onboarding | `client/src/pages/candidate/onboarding.tsx` | ✅ Exists (97K tsx!), verify design |
| Job Search | `client/src/pages/candidate/jobs.tsx` | ✅ Exists, needs polish |
| Profile Matching | `client/src/pages/candidate/matching.tsx` | ✅ Exists, needs polish |
| Skill Upgrade | `client/src/pages/candidate/skills.tsx` | ⚠️ CHECK — may exist |
| Candidate Search | `client/src/pages/recruiter/candidates.tsx` | ✅ Exists, needs polish |

### Missing Pages (New Code)

| Visily Screen | New File | Priority |
|---------------|----------|----------|
| Career Page | `client/src/pages/recruiter/career-page.tsx` | Medium |
| WorkWave Contract | `client/src/pages/recruiter/contract/create.tsx` | Low |
| PayMaven KYC | `client/src/pages/candidate/verification.tsx` | Medium |
| Aadhar Verification | `client/src/pages/candidate/verification.tsx` (mode) | Medium |
| OmniScore Explainability | `client/src/pages/candidate/omniscore.tsx` | High |
| Recruiter AI Screener | `client/src/pages/recruiter/screening.tsx` | High |
| EU AI Act Compliance | `client/src/pages/admin/compliance.tsx` | High |

---

## Component Library Build Order

Before building screens, extract shared components. This prevents duplication and ensures consistency.

### Phase 1: Primitives (2-3 days)
- [ ] `Button` — all variants (primary, secondary, ghost, danger, icon, loading)
- [ ] `Input` — text, password, number, with icons, with validation
- [ ] `Select` — dropdown, multi-select, with search
- [ ] `Card` — job card, candidate card, company card, stat card
- [ ] `Avatar` — user avatar with online/verified status badge
- [ ] `Badge` — status tags (Open, Remote, Full-time, Verified, New)

### Phase 2: Layout (2-3 days)
- [ ] `Sidebar` — collapsible, responsive, role-based items
- [ ] `BottomNav` — mobile-only navigation
- [ ] `DashboardLayout` — sidebar + header + content area
- [ ] `SplitView` — left panel + right panel (job search, chat)
- [ ] `Modal` — full-screen mobile, centered desktop
- [ ] `Stepper` — horizontal (wizard) and vertical (onboarding)

### Phase 3: Domain Components (3-4 days)
- [ ] `JobCard` — title, company, salary, location, tags, CTA
- [ ] `CandidateCard` — avatar, name, role, skills, match score, CTA
- [ ] `CompanyCard` — logo, name, rating, size, location, tags
- [ ] `ChatBubble` — message + file attachment + timestamp
- [ ] `VideoCall` — video tile + controls + participant list + chat panel
- [ ] `ChartCard` — stat number + sparkline + trend indicator
- [ ] `EmptyState` — illustration + message + CTA
- [ ] `Skeleton` — loading placeholders for all card types
- [ ] `OmniScoreRing` — circular score visualization with breakdown

### Phase 4: Advanced Components (3-4 days)
- [ ] `FilterBar` — search + dropdown filters + clear + saved filters
- [ ] `DataTable` — sortable, paginated, with actions
- [ ] `RichTextEditor` — job description editor with formatting
- [ ] `FileUpload` — drag-drop + preview + progress
- [ ] `CalendarPicker` — date/time selection with availability
- [ ] `NotificationCenter` — dropdown with unread count + list
- [ ] `ProfileCompletion` — progress bar + checklist + suggestions

---

## Responsive Rules for Hybrid App

### Mobile (< 768px)
- **Bottom navigation** — 4-5 icons: Home, Jobs, Messages, Profile, [Recruiter: Dashboard]
- **Full-screen pages** — No sidebars, no split views
- **Stacked cards** — Job cards full width, single column
- **Sheet modals** — Bottom sheet for filters, details, actions
- **Floating action button** — Primary action (Apply, Post Job, Send Message)
- **Compact header** — Logo + search icon + notification bell + avatar

### Tablet (768-1023px)
- **Collapsible sidebar** — Icons only when collapsed, text on expand
- **Split views** — 40/60 or 50/50 splits (job list + detail, chat list + thread)
- **2-column grids** — Job cards, candidate cards in 2 columns
- **Modals** — Centered, max-width 600px

### Desktop (1024px+)
- **Fixed sidebar** — Full text + icons, 240px width
- **Multi-column layouts** — Dashboard: 3-4 KPI cards + charts + tables
- **Split views** — 35/65 (list/detail), 30/70 (chat/contact)
- **Hover states** — Card hover, button hover, row hover
- **Sticky headers** — Table headers, section headers stick on scroll

---

## Brand Fix Checklist

Replace ALL placeholders in the codebase:

- [ ] Replace "Logo" placeholder with "Rekrut AI" logo (SVG)
- [ ] Replace "Brand, Inc." with "Rekrut AI, Inc." in footers
- [ ] Replace "© 2022" with "© 2026" in footers
- [ ] Replace "English" dropdown with actual language selector (or remove if single language)
- [ ] Remove "Made with Visily" watermarks
- [ ] Replace generic illustrations with Rekrut AI branded illustrations
- [ ] Replace placeholder images (lorem picsum, random people) with actual content or better placeholders
- [ ] Replace "Lorem ipsum" text in all screens with real copy or meaningful placeholders
- [ ] Ensure all social links in footer point to actual Rekrut AI accounts (or remove)

---

## Version Control Tags

```bash
# Wave 1: Revenue & Trust
git tag -a v1.0.0 -m "Rekrut AI MVP — Foundation UI + OmniScore v2 + Pricing"

# Wave 2: Core Differentiators
git tag -a v1.1.0 -m "AI Interview + Dashboard + Recruiter Screener + Job Creation"

# Wave 3: Enterprise & Compliance
git tag -a v1.2.0 -m "Company Profiles + Chat + EU AI Act Compliance + Email"

# Wave 4: Advanced Features
git tag -a v1.3.0 -m "Skill Upgrade + Contracts + KYC + Candidate Search"

# Design Refresh (Future)
git tag -a v2.0.0 -m "Dark mode + motion + new tokens + mobile-native shell"
```

---

## Success Metrics per Wave

| Wave | Metric | Target |
|------|--------|--------|
| **1** | Sign-up conversion rate | > 20% |
| **1** | Pricing page → Stripe checkout | > 5% |
| **2** | AI interview completion rate | > 70% |
| **2** | Recruiter dashboard DAU | > 50% of registered recruiters |
| **3** | EU AI Act audit coverage | 100% of AI decisions |
| **3** | Email open rate | > 30% |
| **4** | Skill course enrollment | > 10% of candidates |
| **4** | Contract generation time | < 5 minutes |

---

## Risk Mitigation

| Risk | Probability | Mitigation |
|------|-------------|------------|
| Reference designs too complex for 8-week timeline | Medium | Prioritize: Wave 1 & 2 are MUST, Wave 3 & 4 are SHOULD |
| Backend APIs not ready for new UI | Medium | Build UI with mock data first, wire to API later |
| Mobile responsiveness breaks on legacy pages | High | Audit legacy pages first, migrate critical ones to React |
| Brand assets (logo, illustrations) not ready | Medium | Use placeholder logo with correct text, replace later |
| shadcn/ui components don't match reference | Low | Custom CSS overrides on top of shadcn base |

---

## Immediate Next Steps (Today)

1. **Audit existing pages** — Check which of the 20 screens already have code vs. just designs
2. **Build component library** — Start with `client/src/components/primitives/` — Button, Card, Input, Badge
3. **Fix brand** — Replace all "Logo" placeholders with "Rekrut AI"
4. **Pick one screen** — Implement `Job Search` or `Dashboard` as the template for all others
5. **Set up design tokens** — `client/src/lib/tokens.ts` — colors, typography, spacing

---

*Action plan created from 20 Visily reference screens, competitive analysis, and gap analysis.*
*Priority: Revenue first, then differentiators, then enterprise, then advanced features.*
