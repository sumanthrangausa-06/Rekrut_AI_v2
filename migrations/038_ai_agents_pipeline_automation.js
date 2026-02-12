// Migration 038: Pipeline automation rules + AI agent support tables
const pool = require('../lib/db');

async function up() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Pipeline automation rules — configurable per-job auto-advance/reject thresholds
    await client.query(`
      CREATE TABLE IF NOT EXISTS pipeline_automation_rules (
        id SERIAL PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        recruiter_id INTEGER NOT NULL REFERENCES users(id),
        from_stage VARCHAR(50) NOT NULL,
        to_stage VARCHAR(50) NOT NULL,
        auto_advance BOOLEAN DEFAULT false,
        omniscore_threshold INTEGER DEFAULT 600,
        match_score_threshold INTEGER DEFAULT 70,
        auto_reject BOOLEAN DEFAULT false,
        auto_reject_threshold INTEGER DEFAULT 400,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(job_id, recruiter_id, from_stage)
      )
    `);

    // AI agent action log — tracks all AI agent actions for audit + memory
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_agent_actions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        agent_type VARCHAR(50) NOT NULL,
        action_type VARCHAR(100) NOT NULL,
        input_summary TEXT,
        output_summary TEXT,
        tokens_used INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        success BOOLEAN DEFAULT true,
        error_message TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Add index for fast queries
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pipeline_rules_job ON pipeline_automation_rules(job_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_actions_user ON ai_agent_actions(user_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_actions_type ON ai_agent_actions(agent_type, action_type)`);

    // Add resume_score column to score_components if not exists (for OmniScore feed from resume AI)
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'score_components' AND column_name = 'source_type'
        ) THEN
          ALTER TABLE score_components ADD COLUMN source_type VARCHAR(50) DEFAULT 'system';
        END IF;
      END $$;
    `);

    await client.query('COMMIT');
    console.log('[Migration 038] Pipeline automation rules + AI agent tables created');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration 038] Error:', err.message);
    // Non-fatal: tables may already exist
    if (!err.message.includes('already exists')) throw err;
  } finally {
    client.release();
  }
}

module.exports = { up };
