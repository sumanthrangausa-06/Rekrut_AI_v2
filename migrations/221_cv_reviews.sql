-- Migration 221: Create cv_reviews table for AI CV Review (#82)

CREATE TABLE IF NOT EXISTS cv_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES parsed_resumes(id) ON DELETE SET NULL,
  review_data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_cv_reviews_user_id ON cv_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_cv_reviews_created_at ON cv_reviews(created_at DESC);
