-- Migration: Recruiter Introductions — Direct hiring manager intros for Top 5 matches (Issue #38)
-- Created: 2026-08-16

CREATE TABLE IF NOT EXISTS recruiter_introductions (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  recruiter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'requested', -- requested, accepted, rejected, completed
  fit_score_at_request INTEGER,
  rank_at_request INTEGER, -- candidate's rank among matches (1-5)
  request_message TEXT,
  recruiter_notes TEXT,
  responded_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(candidate_id, job_id, status) -- prevent duplicate active requests
);

-- Track weekly intro usage per candidate
CREATE TABLE IF NOT EXISTS candidate_intro_quota (
  candidate_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL, -- Monday of the current week
  used_count INTEGER DEFAULT 0,
  max_count INTEGER DEFAULT 3,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_introductions_candidate ON recruiter_introductions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_introductions_job ON recruiter_introductions(job_id);
CREATE INDEX IF NOT EXISTS idx_introductions_recruiter ON recruiter_introductions(recruiter_id);
CREATE INDEX IF NOT EXISTS idx_introductions_status ON recruiter_introductions(status);
CREATE INDEX IF NOT EXISTS idx_intro_quota_week ON candidate_intro_quota(week_start);
