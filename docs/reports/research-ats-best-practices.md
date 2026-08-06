# ATS Best Practices Research
**Date:** 2026-02-12
**Platforms Researched:** LinkedIn Jobs, Greenhouse, Lever, Ashby, SmartRecruiters

## 1. Match Scoring UX

### How Top Platforms Display Match Scores

| Platform | Score Type | Display | Breakdown |
|---|---|---|---|
| **LinkedIn** | Percentile (Top 10/25/50%) | Badge on job listing + "Top Applicant" label | Skills comparison vs other applicants |
| **SmartRecruiters** | 0-100 weighted score | Ranked list with explanations | Skills, experience, seniority, education (separately scored, ensembled) |
| **Ashby** | 0-100 fit probability | Custom field on application | Strengths + areas to review highlighted |
| **Lever** | Panel-calibrated scorecard | Talent Fit engine ranked lists | Transparent scoring explanations |
| **Greenhouse** | Scorecard-based | Color-coded pipeline cards | Structured interview kits with rubrics |

### Best Practices for HireLoop
- Show **match %** prominently on job listings for candidates (like SmartRecruiters)
- Break down into **skills match, experience match, score match** (like SmartRecruiters' ensemble approach)
- Use **color coding**: green (80%+), amber (60-79%), red (<60%)
- Show **matching skills** and **missing skills** (gap analysis)
- For recruiters: ranked candidate list sorted by match score with explanation

## 2. Pipeline Stages

### Industry Standard Stages
Based on all platforms researched:

```
Applied → Screening → Interview → Offer → Hired
                                          ↘ Rejected (terminal)
                                          ↘ Withdrawn (terminal)
```

### Platform-Specific Stage Patterns

| Platform | Stages | Visualization |
|---|---|---|
| **Greenhouse** | Custom per-job, kanban columns | Kanban board, color-coded by next action |
| **Lever** | Custom, drag-and-drop | Visual pipeline, drag candidates between stages |
| **Ashby** | Drag-and-drop builder, auto-progression | Real-time pipeline view across all jobs |
| **SmartRecruiters** | Standard + custom | Clean social-network-like UI |

### Best Practices for HireLoop
- Use 5 core stages: **Applied → Screening → Interview → Offer → Hired**
- Add **Rejected** and **Withdrawn** as terminal states
- Kanban board view for recruiters (drag-and-drop)
- Progress bar/timeline for candidates viewing their application status
- Color coding per stage

## 3. Candidate Ranking

### How Platforms Rank Candidates

| Platform | Algorithm | Signals Used |
|---|---|---|
| **SmartRecruiters** | Ensemble ML (Winston Match) | Skills match, experience, seniority, education, career trajectory |
| **Ashby** | ML fit probability | Job requirements, culture fit, historical patterns |
| **LinkedIn** | Profile completeness + relevance | Skills, endorsements, experience keywords |
| **Lever** | Panel calibration | Structured interview scores, team feedback |

### Best Practices for HireLoop
- Primary sort: **match score** (descending)
- Secondary: **OmniScore** (verified platform score)
- Show: match %, verified skills count, interview performance
- Allow sort by: date, match score, name
- Highlight "Top Candidates" with badge (like LinkedIn's "Top Applicant")

## 4. Job Search UX

### Best Practices from Top Platforms
- **Filters:** Job type, location, salary range, remote/hybrid/onsite
- **Recommended jobs** section for logged-in candidates (personalized by match score)
- **Match %** visible on each job card in search results
- **Save/bookmark** jobs for later
- **1-click apply** for profiles with complete data
- **"Jobs like this"** recommendations on job detail page

## 5. Gap Analysis: HireLoop vs Best Practices

| Feature | Industry Best Practice | HireLoop Status | Priority |
|---|---|---|---|
| Match % on job listings | Shown prominently | **MISSING** - jobs page uses public endpoint without matching | HIGH |
| Skills gap breakdown | SmartRecruiters shows matching/missing | **MISSING** - match_results has fields but not populated/displayed | HIGH |
| Kanban pipeline board | Greenhouse/Lever/Ashby all have it | **MISSING** - backend API exists, no frontend | HIGH |
| Consistent pipeline stages | Applied→Screening→Interview→Offer→Hired | **BROKEN** - frontend/backend mismatch | MEDIUM |
| Candidate ranking by score | Sorted ranked list with explanations | **PARTIAL** - backend endpoint exists, not prominent in UI | MEDIUM |
| Recommended jobs | Personalized feed based on profile | **PARTIAL** - endpoint exists, not integrated into main job board | MEDIUM |
| Application timeline | Progress bar showing stage | **WORKING** - candidate apps page has timeline | OK |
| Status update notifications | Auto-email on status change | **MISSING** - no email triggers on status change | LOW |

## Implementation Priority (Based on Research)

### Must-Have (Phase 3-4):
1. Fix pipeline stage consistency (backend↔frontend alignment)
2. Match scoring breakdown (populate matching_skills/missing_skills in match_results)
3. Candidate ranking endpoint improvements (include score breakdown)

### Should-Have (Phase 5-6):
4. Kanban board for recruiters (drag-drop pipeline view)
5. Match % on candidate job board (use recommended endpoint)
6. Skills gap visualization (what candidate has vs. needs)
7. "Top Candidate" badge for high-match applicants

### Nice-to-Have (Future):
8. Email notifications on status changes
9. "Jobs like this" recommendations
10. Bulk actions (batch reject/advance)
