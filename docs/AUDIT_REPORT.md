# HireLoop Audit Report — Feb 12, 2026

## Summary
Backend is ~90% functional. Core candidate and recruiter workflows work end-to-end. Two gaps: **job search/filter** and **offer management API**.

---

## Candidate Workflows

| Feature | Status | Notes |
|---------|--------|-------|
| Register | ✅ WORKS | Email/password + role selection |
| Login | ✅ WORKS | JWT tokens + refresh tokens |
| Profile CRUD | ✅ WORKS | Headline, bio, location, phone, salary, etc |
| Skills CRUD | ✅ WORKS | Name, category, level, years_experience |
| Experience CRUD | ✅ WORKS | Company, title, dates, description |
| Education CRUD | ✅ WORKS | Institution, degree, field, dates |
| Resume upload + AI parse | ✅ WORKS | PDF/DOCX extraction, auto-fills profile |
| Job board | ✅ WORKS | Lists active jobs |
| Job detail | ✅ WORKS | Full job info + screening questions |
| Job search/filter | ❌ MISSING | No text search, location, type, or salary filter |
| Apply to job | ✅ WORKS | Cover letter + screening answers stored |
| Track applications | ✅ WORKS | Status visible to candidate |
| Withdraw application | ✅ WORKS | Status validation |
| Dashboard stats | ✅ WORKS | Profile completeness, counts, omniscore |
| Saved jobs | ✅ WORKS | Save/unsave with notes |
| Recommended jobs | ✅ WORKS | AI match scoring |
| AI resume optimizer | ✅ WORKS | Job-tailored suggestions |
| AI cover letter | ✅ WORKS | Generated from profile + job |
| AI screening suggestions | ✅ WORKS | Auto-fill from profile + past answers |
| Auto-fill for applications | ✅ WORKS | Reuses past data |

## Recruiter Workflows

| Feature | Status | Notes |
|---------|--------|-------|
| Register | ✅ WORKS | Auto-creates company |
| Login | ✅ WORKS | JWT + company_id in token |
| Create job posting | ✅ WORKS | Full fields + screening questions |
| AI job generation | ✅ WORKS | One-click from title |
| AI skill suggestions | ✅ WORKS | Must-have/nice-to-have |
| AI title suggestions | ✅ WORKS | SEO-optimized alternatives |
| View posted jobs | ✅ WORKS | With analytics (views, applications) |
| View applications | ✅ WORKS | Per job or all, with candidate details |
| Pipeline management | ✅ WORKS | 9 stages, kanban view, batch actions |
| Schedule interviews | ✅ WORKS | Auto Jitsi link for video |
| Ranked candidates | ✅ WORKS | By match score |
| AI candidate summary | ✅ WORKS | Strengths/concerns/fit |
| AI question suggestions | ✅ WORKS | From question bank + job |
| Question bank | ✅ WORKS | Save/reuse screening questions |
| Dashboard metrics | ✅ WORKS | Job stats, app stats, upcoming interviews |
| Send offers | 🚫 MISSING | `offers` table exists (30 cols) but NO API routes |

## Data Persistence

| Table | Status | Notes |
|-------|--------|-------|
| users | ✅ | 18 columns, auth + subscription |
| candidate_profiles | ✅ | Full profile with salary, preferences |
| candidate_skills | ✅ | With verification support |
| work_experience | ✅ | With achievements, skills_used |
| education | ✅ | With GPA, achievements |
| jobs | ✅ | With screening_questions JSONB |
| job_applications | ✅ | 13 cols: cover_letter, screening_answers, match_score |
| offers | ⚠️ | Table exists (30 cols) but no API routes |
| scheduled_interviews | ✅ | Full scheduling with meeting links |
| 75 tables total | ✅ | Comprehensive schema |

## What Needs Fixing

1. **Job search/filter API** — `GET /api/jobs` only filters by status. Need: text search, location, job_type, salary range
2. **Offer management API** — Need CRUD endpoints: create offer, list offers, update status, candidate accept/decline
