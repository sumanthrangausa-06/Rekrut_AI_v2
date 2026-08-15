-- Migration: Real-time collaboration for hiring teams (Issue #128)
-- Tables: comments, comment_mentions, shared_notes, hiring_activity

-- ─── comments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('candidate', 'application')),
  entity_id INTEGER NOT NULL,
  parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── comment_mentions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comment_mentions (
  id SERIAL PRIMARY KEY,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  mentioned_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(comment_id, mentioned_user_id)
);

-- ─── shared_notes ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shared_notes (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── hiring_activity ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hiring_activity (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comment_mentions_user ON comment_mentions(mentioned_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shared_notes_candidate ON shared_notes(candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hiring_activity_job ON hiring_activity(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hiring_activity_user ON hiring_activity(user_id, created_at DESC);
