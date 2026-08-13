// OmniScore v2 — 8-Factor Deep Scoring with Explainability
// Issue #113
module.exports = {
	name: 'omniscore_v2_eight_factor',
	up: async (client) => {
		// ─── Add new columns to omni_scores (backwards-compatible) ───
		await client.query(`
      ALTER TABLE omni_scores
      ADD COLUMN IF NOT EXISTS factor_scores JSONB DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS peer_percentile INTEGER DEFAULT 50,
      ADD COLUMN IF NOT EXISTS last_checkin_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS fraud_signals JSONB DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 2
    `);

		// Backfill factor_scores from existing columns for seamless migration
		await client.query(`
      UPDATE omni_scores
      SET factor_scores = jsonb_build_object(
        'interview', COALESCE(interview_score, 0),
        'technical', COALESCE(technical_score, 0),
        'resume', COALESCE(resume_score, 0),
        'behavior', COALESCE(behavior_score, 0)
      )
      WHERE factor_scores = '{}' OR factor_scores IS NULL
    `);

		// ─── Weekly score snapshots for historical trend ───
		await client.query(`
      CREATE TABLE IF NOT EXISTS score_snapshots (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        total_score INTEGER NOT NULL,
        factor_scores JSONB DEFAULT '{}',
        peer_percentile INTEGER,
        snapshot_week DATE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, snapshot_week)
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_score_snapshots_user ON score_snapshots(user_id);
      CREATE INDEX IF NOT EXISTS idx_score_snapshots_week ON score_snapshots(snapshot_week DESC);
    `);

		// ─── Seed initial snapshot for every existing score ───
		await client.query(`
      INSERT INTO score_snapshots (user_id, total_score, factor_scores, peer_percentile, snapshot_week, created_at)
      SELECT
        user_id,
        total_score,
        COALESCE(factor_scores, '{}'),
        COALESCE(peer_percentile, 50),
        DATE_TRUNC('week', CURRENT_DATE)::DATE,
        NOW()
      FROM omni_scores
      ON CONFLICT (user_id, snapshot_week) DO NOTHING
    `);

		console.log('OmniScore v2 (8-factor) migration completed successfully');
	},
};
