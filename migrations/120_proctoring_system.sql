-- Migration: Proctoring Foundation (#120)
-- Tables: proctoring_sessions, proctoring_events, proctoring_flags

-- Sessions track the lifecycle of a proctored assessment
CREATE TABLE IF NOT EXISTS proctoring_sessions (
    id SERIAL PRIMARY KEY,
    application_id INTEGER REFERENCES job_applications(id) ON DELETE SET NULL,
    candidate_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'consent_requested', 'in_progress', 'completed', 'flagged', 'reviewed')),
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    consent_given BOOLEAN NOT NULL DEFAULT false,
    consent_timestamp TIMESTAMP WITH TIME ZONE,
    consent_ip INET,
    reviewer_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Events capture individual proctoring observations
CREATE TABLE IF NOT EXISTS proctoring_events (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES proctoring_sessions(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL
        CHECK (event_type IN ('tab_switch', 'copy_paste', 'no_face', 'multiple_faces', 'audio_anomaly', 'timing_anomaly', 'fullscreen_exit', 'right_click', 'window_blur', 'suspicious_keypress')),
    severity VARCHAR(20) NOT NULL
        CHECK (severity IN ('low', 'medium', 'high')),
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Flags surface sessions that need human review
CREATE TABLE IF NOT EXISTS proctoring_flags (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES proctoring_sessions(id) ON DELETE CASCADE,
    flag_type VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    severity VARCHAR(20) NOT NULL
        CHECK (severity IN ('low', 'medium', 'high')),
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    review_decision VARCHAR(20) DEFAULT 'pending'
        CHECK (review_decision IN ('pending', 'approved', 'rejected')),
    review_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_proctoring_sessions_candidate_id ON proctoring_sessions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_proctoring_sessions_application_id ON proctoring_sessions(application_id);
CREATE INDEX IF NOT EXISTS idx_proctoring_sessions_status ON proctoring_sessions(status);
CREATE INDEX IF NOT EXISTS idx_proctoring_sessions_created_at ON proctoring_sessions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_proctoring_events_session_id ON proctoring_events(session_id);
CREATE INDEX IF NOT EXISTS idx_proctoring_events_session_created ON proctoring_events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proctoring_events_severity ON proctoring_events(severity);
CREATE INDEX IF NOT EXISTS idx_proctoring_events_type ON proctoring_events(event_type);

CREATE INDEX IF NOT EXISTS idx_proctoring_flags_session_id ON proctoring_flags(session_id);
CREATE INDEX IF NOT EXISTS idx_proctoring_flags_review_decision ON proctoring_flags(review_decision, severity);
CREATE INDEX IF NOT EXISTS idx_proctoring_flags_created_at ON proctoring_flags(created_at DESC);
