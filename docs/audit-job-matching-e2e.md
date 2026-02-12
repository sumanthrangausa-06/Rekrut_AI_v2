# Job Posting + Matching Flow: Codebase Audit
**Date:** 2026-02-12
**Status:** Phase 1 Complete

## Already Exists and Works

### Backend Routes
| Route File | Endpoints | Status |
|---|---|---|
| `routes/jobs.js` | CRUD (list, get, create, update, delete) | Working |
| `routes/recruiter.js` | Dashboard, job management, applications, interviews, pipeline, ranked candidates, coaching, job analysis/optimization | Working |
| `routes/candidate.js` | Profile CRUD, resume parsing, skills/experience/education, job apply, applications, recommendations, saved jobs, scheduled interviews | Working |
| `routes/matching.js` | Recommendations, candidate ranking, match explanation, embedding updates, stats | Working |

### Backend Services
| Service | Function | Status |
|---|---|---|
| `services/matching-engine.js` | Vector embeddings (pgvector), cosine similarity, weighted scoring (60% skill, 30% score, 10% trust), caching | Working |
| `services/job-optimizer.js` | AI job analysis, description optimization, interview Q generation, candidate fit analysis, salary insights | Working |

### Database Schema
- `candidate_embeddings` - pgvector 1536-dim embeddings
- `job_embeddings` - pgvector 1536-dim embeddings
- `match_results` - cached match scores with skills breakdown
- `job_recommendations` - personalized job feed
- `job_applications` - with match_score, screening_answers, cover_letter, status
- `scheduled_interviews` - with meeting links, outcome tracking
- `job_analytics` - views, applications, interviews, offers

### Frontend (React/TSX)
| Page | What It Does | Status |
|---|---|---|
| `recruiter/jobs.tsx` | Job listing with search/filter/stats, toggle/delete | Working |
| `recruiter/job-form.tsx` | Job creation with AI optimization | Working |
| `recruiter/job-applicants.tsx` | Per-job applicant list, status management, detail dialog | Working |
| `recruiter/applications.tsx` | Cross-job applications view with sort/filter/date range | Working |
| `recruiter/interviews.tsx` | Interview scheduling and management | Working |
| `candidate/jobs.tsx` | Job board with search/filter | Working but NO match scores |
| `candidate/job-detail.tsx` | Job detail with apply form + screening questions | Working |
| `candidate/applications.tsx` | Application tracking with timeline + withdraw | Working |

### Pipeline Stages
- **Backend defines:** `['applied', 'screening', 'reviewing', 'interviewed', 'offered', 'hired', 'rejected', 'withdrawn']`
- **Backend has:** Kanban API (`GET /recruiter/pipeline/:jobId`), batch status update, ranked candidates

## Issues Found

### 1. Frontend Stage Mismatch (Medium)
- `job-applicants.tsx` uses `['applied', 'reviewing', 'shortlisted', 'interviewed', 'offered', 'hired', 'rejected']`
- Backend pipeline uses `['applied', 'screening', 'reviewing', 'interviewed', 'offered', 'hired', 'rejected', 'withdrawn']`
- **Fix:** Align frontend to use backend's canonical pipeline stages

### 2. Candidate Job Board Missing Match Scores (High)
- `candidate/jobs.tsx` fetches from `/jobs` (public, no matching)
- `/candidate/jobs/recommended` endpoint exists with AI match scoring but is NOT used on the main job board
- **Fix:** Use recommended endpoint for logged-in candidates, show match % and breakdown

### 3. No Kanban Board UI (High)
- Backend `GET /recruiter/pipeline/:jobId` returns applications grouped by stage
- No kanban/drag-drop UI exists in React frontend
- **Fix:** Build kanban board component for recruiter pipeline view

### 4. No Skills Gap Visualization (Medium)
- `match_results` table has `matching_skills` and `missing_skills` JSONB columns
- `services/matching-engine.js` doesn't populate them (only explanation text)
- Frontend doesn't display skills breakdown
- **Fix:** Populate skills data in match results, show breakdown in both candidate and recruiter views

### 5. Activity Feed Not Wired to All Job Events (Low)
- Job creation logs to events table
- Application status changes go through AuditLogger but not activity feed
- **Fix:** Wire status transitions to activity feed

## What NOT to Rebuild
- All backend CRUD routes (working fine)
- Matching engine core (embeddings + similarity working)
- Job creation/editing flow
- Application submission flow
- Resume parsing pipeline
- Interview scheduling
