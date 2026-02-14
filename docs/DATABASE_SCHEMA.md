# HireLoop Database Schema Reference

Last updated: 2026-02-14

## Overview

| Metric | Count |
|--------|-------|
| Tables | 105 |
| Foreign Keys | 164 |
| Indexes | 309 |
| Columns | ~1,358 |

**Schema pattern**: Normalized Relational (3NF) with JSONB extensions
**Special indexes**: 2 IVFFlat vector indexes (candidate_embeddings, job_embeddings)

---

## Domain Groups

### 1. Users & Auth
| Table | Purpose | Key FKs |
|-------|---------|--------|
| users | Core user accounts | — |
| refresh_tokens | JWT refresh tokens | users.id |
| user_sessions | Active sessions | users.id |
| oauth_connections | OAuth provider links | users.id |

### 2. Companies & Employees
| Table | Purpose | Key FKs |
|-------|---------|--------|
| companies | Company profiles | — |
| employees | Company employees | users.id, companies.id |
| company_policies | HR policies | companies.id |
| company_ratings | Company reviews | companies.id, users.id |

### 3. Jobs & Applications
| Table | Purpose | Key FKs |
|-------|---------|--------|
| jobs | Job postings | companies.id |
| job_applications | Applications | jobs.id, users.id |
| job_analytics | Job performance metrics | jobs.id |
| job_recommendations | AI job matches | users.id, jobs.id |
| saved_jobs | User bookmarks | users.id, jobs.id |
| job_embeddings | Vector embeddings | jobs.id |

### 4. Candidate Profiles
| Table | Purpose | Key FKs |
|-------|---------|--------|
| candidate_profiles | Extended profiles | users.id |
| candidate_skills | Skill tags | users.id |
| candidate_feedback | Feedback received | users.id |
| candidate_onboarding_data | Onboarding info | users.id |
| candidate_embeddings | Vector embeddings | users.id |
| education | Education history | users.id |
| work_experience | Work history | users.id |
| portfolio_projects | Portfolio items | users.id |
| parsed_resumes | Resume parsing results | users.id |

### 5. Interview Flow ⭐ (P0+P1 FIXED)
| Table | Purpose | Key FKs | Notes |
|-------|---------|--------|-------|
| interviews | Mock/video interviews | users.id, jobs.id | user_id, status, interview_type now NOT NULL; timestamptz |
| scheduled_interviews | Recruiter-scheduled | companies.id, jobs.id, users.id (candidate+recruiter) | All key columns now NOT NULL; timestamptz |
| interview_questions | Question bank | — | created_at NOT NULL; timestamptz; +updated_at |
| interview_evaluations | AI/human evaluations | interviews.id, screening_sessions.id, users.id, jobs.id, companies.id | +FK to interviews & screening_sessions; +updated_at; timestamptz |
| interview_analysis | Per-question analysis | interviews.id | interview_id NOT NULL; +updated_at; timestamptz |
| interview_composite_scores | Composite scoring | interviews.id, screening_sessions.id, users.id, jobs.id, companies.id | +FK to interviews & screening_sessions; +updated_at; timestamptz |
| interview_reminders | Reminder scheduling | scheduled_interviews.id, users.id | All FK columns NOT NULL; +updated_at; timestamptz |
| mock_interview_sessions | Conversational mock | users.id | user_id, status, started_at NOT NULL; timestamptz |

**P0 Fix (2026-02-14)**: Corrected company_id FK targets from users.id → companies.id on interview_evaluations, interview_composite_scores, scheduled_interviews

**P1 Fix (2026-02-14)**: 
- All timestamps converted from `timestamp` → `timestamptz`
- Critical columns set NOT NULL (user_id, status, interview_type, created_at, etc.)
- 4 missing FK constraints added (interview_evaluations + interview_composite_scores → interviews, screening_sessions)
- 14 missing FK indexes added across all interview tables
- 5 `updated_at` columns added (interview_evaluations, interview_analysis, interview_composite_scores, interview_questions, interview_reminders)

### 6. Screening & Assessment
| Table | Purpose | Key FKs |
|-------|---------|--------|
| screening_templates | Screening question sets | companies.id |
| screening_sessions | Active screenings | companies.id, jobs.id, users.id |
| screening_answers | Candidate responses | screening_sessions.id |
| assessment_sessions | Assessment sessions | — |
| assessment_questions | Assessment questions | — |
| assessment_conversations | Assessment chat logs | — |
| assessment_events | Assessment events | — |
| job_assessments | Job-specific assessments | jobs.id |
| job_assessment_questions | Assessment question bank | job_assessments.id |
| job_assessment_attempts | Candidate attempts | job_assessments.id, users.id |
| skill_assessments | Skill evaluations | users.id |
| practice_sessions | Practice sessions | users.id |
| question_bank | Global question bank | — |

### 7. Scoring & Trust
| Table | Purpose | Key FKs |
|-------|---------|--------|
| omni_scores | Primary scoring | users.id |
| omniscore_results | Detailed results | users.id |
| score_components | Score breakdowns | — |
| score_history | Score changes | users.id |
| score_appeals | Score appeal requests | users.id |
| role_scores | Role-specific scores | users.id |
| trust_scores | Trust metrics | users.id |
| trust_score_components | Trust breakdowns | trust_scores.id |
| trust_score_history | Trust changes | users.id |
| document_score_impacts | Doc effect on score | — |

### 8. Offers & Onboarding
| Table | Purpose | Key FKs |
|-------|---------|--------|
| offers | Job offers | users.id, jobs.id, companies.id |
| offer_templates | Offer templates | companies.id |
| onboarding_plans | Onboarding plans | users.id, companies.id |
| onboarding_tasks | Onboarding tasks | onboarding_plans.id |
| onboarding_checklists | Checklists | users.id |
| onboarding_documents | Required docs | — |
| onboarding_chats | Onboarding chat | users.id |

### 9. Communication
| Table | Purpose | Key FKs |
|-------|---------|--------|
| communications | Message log | users.id |
| communication_templates | Message templates | companies.id |
| communication_sequences | Drip sequences | companies.id |
| sequence_enrollments | Sequence tracking | users.id |

### 10. Documents & Verification
| Table | Purpose | Key FKs |
|-------|---------|--------|
| verification_documents | ID verification | users.id |
| verified_credentials | Credential verification | users.id |
| document_verifications | Verification results | users.id |
| document_access_logs | Access audit trail | users.id |

### 11. Compliance & Privacy
| Table | Purpose | Key FKs |
|-------|---------|--------|
| consent_records | GDPR consent | users.id |
| data_requests | Data export/delete | users.id |
| data_retention_policies | Retention rules | companies.id |
| country_configs | Country regulations | — |
| country_document_types | Required docs by country | — |
| bias_reports | Bias detection | — |
| fairness_audits | Fairness monitoring | — |
| audit_logs | System audit trail | — |

### 12. Payroll
| Table | Purpose | Key FKs |
|-------|---------|--------|
| payroll_configs | Payroll settings | companies.id |
| payroll_runs | Payroll cycles | companies.id |
| pay_periods | Pay periods | payroll_configs.id |
| paychecks | Individual paychecks | employees.id |
| tax_documents | Tax forms | users.id |
| employee_benefits | Benefits | employees.id |

### 13. AI Infrastructure
| Table | Purpose | Key FKs |
|-------|---------|--------|
| ai_prompts | Prompt storage | — |
| ai_prompt_versions | Prompt versioning | ai_prompts.id |
| ai_call_log | API call tracking | — |
| ai_token_budget_daily | Token budgets | — |
| ai_ab_tests | A/B test configs | — |
| ai_agent_actions | Agent action log | — |
| ai_provider_stats | Provider metrics | — |
| ai_provider_verification | Provider health | — |
| ai_verification_meta | Verification metadata | — |

### 14. Matching & Recommendations
| Table | Purpose | Key FKs |
|-------|---------|--------|
| match_results | Match scores | users.id, jobs.id |
| mutual_matches | Mutual interest | users.id, jobs.id |
| recruiter_preferences | Recruiter criteria | users.id |
| recruiter_feedback | Recruiter feedback | users.id |
| pipeline_automation_rules | Pipeline rules | companies.id |
| scheduling_preferences | Scheduling prefs | users.id |
| post_hire_feedback | Post-hire reviews | users.id |

### 15. System
| Table | Purpose |
|-------|--------|
| _migrations | Migration tracking |
| activity_log | User activity |
| events | System events |
| agent_data | Agent SDK data storage |
| tts_cache | TTS audio cache |
| user_memory | User memory/context |

---

## Recent Schema Changes

| Date | Migration | Changes |
|------|-----------|--------|
| 2026-02-14 | p1_interview_flow_schema | 20 cols → timestamptz, NOT NULL on critical cols, 4 new FKs, 14 new indexes, 5 new updated_at cols |
| 2026-02-14 | (P0 FK fix) | 5 company_id FKs corrected from users.id → companies.id |
| 2026-02-14 | mock_per_question_analysis | Added per_question_analysis JSONB to mock_interview_sessions |
| 2026-02-14 | 044_ai_onboarding_plans | AI onboarding plans |
| 2026-02-13 | 043_ai_health_persistence | AI health monitoring persistence |
| 2026-02-13 | 042_job_assessments | Job assessment system |
| 2026-02-13 | 041_interview_scheduling_screening | Interview scheduling + screening |
