# HireLoop — AI Integration Audit
**Date:** February 12, 2026
**Purpose:** Complete audit of AI integration across all modules. Roadmap for future work.

---

## Summary

| Category | Count | Modules |
|----------|-------|---------|
| **Heavy AI** (LLM/Embeddings) | 5 | Interviews, Assessments, Onboarding, Matching, Candidate |
| **Moderate AI** (Scoring/Analysis) | 5 | Recruiter, OmniScore, TrustScore, Documents, Compliance |
| **No AI** (CRUD only) | 6 | Jobs, Analytics, Auth, Admin, Payroll, Company |

---

## Module-by-Module Status

### 1. Interviews (`routes/interviews.js`) — ✅ HEAVY AI
- **AI Provider:** `polsia-ai` (chat, TTS, ASR, video analysis)
- **AI Features:**
  - AI question generation (`generateInterviewQuestions`)
  - Interview response analysis (`analyzeInterviewResponse`)
  - Overall feedback generation (`generateOverallFeedback`)
  - AI coaching tips (`generateInterviewCoaching`)
  - Video analysis (body language, voice quality)
  - Text-to-speech for mock interviews
  - Audio transcription (Whisper/Parakeet)
- **Status:** Complete, production-ready

### 2. Assessments (`routes/assessments.js`) — ✅ HEAVY AI
- **AI Provider:** `polsia-ai` (chat)
- **AI Features:**
  - Dynamic question generation (adaptive difficulty)
  - Short answer evaluation with AI scoring
  - Skill-specific assessment creation
- **Status:** Complete, production-ready

### 3. Onboarding (`routes/onboarding.js`) — ✅ HEAVY AI
- **AI Provider:** `polsia-ai` (chat)
- **AI Features:**
  - Offer letter generation
  - Employee handbook generation
  - Policy generation
  - Benefits configuration with AI suggestions
  - Compensation analysis
  - Work assessment generation
  - Onboarding content creation
- **Status:** Complete, largest route (2364 lines, 97K+ frontend)

### 4. Matching (`routes/matching.js`) — ✅ HEAVY AI
- **AI Provider:** `matching-engine` service (embeddings via `ai-provider`)
- **AI Features:**
  - Semantic job recommendations (`findMatchingJobs`)
  - Candidate ranking by skill embeddings (`findMatchingCandidates`)
  - Match explanation (`explainMatch`)
  - Profile/job embedding updates
- **Status:** Complete, embedding-based matching

### 5. Candidate (`routes/candidate.js`) — ✅ HEAVY AI
- **AI Provider:** `polsia-ai`
- **AI Features:**
  - Resume parsing and data extraction (`parseResume`)
  - Skill assessment generation (`generateSkillAssessment`)
  - Job match scoring (`generateJobMatchScore`)
  - Interview coaching (`generateInterviewCoaching`)
- **Status:** Complete

### 6. Recruiter (`routes/recruiter.js`) — ✅ MODERATE AI
- **AI Services:** `job-optimizer`, `trustscore`
- **AI Features:**
  - Job posting analysis (`POST /jobs/analyze`)
  - Job description optimization (`POST /jobs/optimize`)
  - Salary market insights (`GET /salary-insights`)
  - Interview question generation (`POST /jobs/:id/questions`)
  - Candidate fit analysis (`POST /jobs/:id/candidate-fit`)
  - TrustScore calculation
- **Gaps:**
  - ❌ No "Generate from scratch" endpoint (generate full JD from just a title)
  - ❌ No skill/requirement suggestion endpoint
  - ❌ No title optimization endpoint (separate from full optimize)
  - ❌ No inclusivity/bias review endpoint

### 7. OmniScore (`routes/omniscore.js`) — ✅ MODERATE AI
- **AI Service:** `omniscore` (algorithmic, multi-factor scoring)
- **AI Features:**
  - Multi-factor candidate scoring with decay
  - Score breakdown and recommendations
  - Behavioral check-in tracking
- **Status:** Complete, algorithmic (not LLM-based)

### 8. TrustScore (`routes/trustscore.js`) — ✅ MODERATE AI
- **AI Service:** `trustscore` (weighted scoring algorithm)
- **AI Features:**
  - Employer trust scoring
  - Trust breakdown by component
  - Trust recommendations
  - Hiring analytics
- **Status:** Complete, algorithmic

### 9. Documents (`routes/documents.js`) — ✅ MODERATE AI
- **AI Service:** `document-verification` (OpenAI GPT-4o)
- **AI Features:**
  - Document OCR extraction
  - Fraud detection
  - Authenticity scoring
- **Status:** Complete

### 10. Compliance (`routes/compliance.js`) — ✅ LIGHT AI
- **AI Services:** `scoreExplainer`, `biasDetection`
- **AI Features:**
  - OmniScore explainability
  - Bias detection analytics (defined, partially used)
- **Gaps:**
  - ⚠️ biasDetection service exists but not actively called from routes
  - ❌ No EU AI Act audit trail
  - ❌ No bias audit reports

### 11. Jobs (`routes/jobs.js`) — ❌ NO AI
- Pure CRUD (list, get, create, update, delete)
- Note: AI features are in `routes/recruiter.js` instead — this is the public-facing job API

### 12. Analytics (`routes/analytics.js`) — ❌ NO AI
- Event logging and dashboard aggregation only
- **Opportunity:** AI-powered hiring insights, predictive analytics

### 13. Auth (`routes/auth.js`) — ❌ NO AI
- Authentication only. No AI needed.

### 14. Admin (`routes/admin.js`) — ❌ NO AI
- Admin management. No AI needed.

### 15. Payroll (`routes/payroll.js`) — ❌ NO AI
- Uses `payroll-calculator` service (algorithmic, no AI)
- **Opportunity:** AI salary benchmarking, compensation optimization

### 16. Company (`routes/company.js`) — ✅ LIGHT AI
- Integrates with `trustscore` for company verification
- Mostly CRUD with trust scoring overlay

---

## AI Services Inventory

| Service | Used By | Type | Status |
|---------|---------|------|--------|
| `lib/polsia-ai.js` | interviews, assessments, onboarding, candidate | LLM (Anthropic/OpenAI/NIM fallback) | ✅ Active |
| `lib/ai-provider.js` | matching-engine, polsia-ai | Multi-provider fallback | ✅ Active |
| `services/job-optimizer.js` | recruiter.js | LLM for job posting AI | ✅ Active |
| `services/matching-engine.js` | matching.js | Embeddings | ✅ Active |
| `services/omniscore.js` | omniscore.js, interviews.js | Algorithmic scoring | ✅ Active |
| `services/trustscore.js` | trustscore.js, recruiter.js, company.js | Algorithmic scoring | ✅ Active |
| `services/document-verification.js` | documents.js | GPT-4o OCR | ✅ Active |
| `services/biasDetection.js` | compliance.js (partial) | Analytics | ⚠️ Underused |
| `services/scoreExplainer.js` | compliance.js | Explainability | ✅ Active |

---

## Priority Roadmap: AI Gaps to Fill

### 🔴 HIGH — Job Posting AI Enhancement (THIS TASK)
- Add "Generate full JD" endpoint (title → complete description)
- Add "Suggest skills/requirements" endpoint
- Add "Suggest better title" endpoint
- Frontend: "Generate with AI" button, "Suggest" buttons

### 🟡 MEDIUM — Future Tasks
1. **Payroll AI** — Salary benchmarking, compensation optimization
2. **Analytics AI** — Predictive hiring insights, pipeline forecasting
3. **Compliance AI** — Bias audit reports, EU AI Act dashboard
4. **biasDetection service** — Wire into active use

### 🟢 LOW — Nice to Have
1. **Admin AI** — Anomaly detection, platform health scoring
2. **Auth AI** — Fraud detection on login patterns

---

*This audit serves as the roadmap for AI integration across all HireLoop modules.*
