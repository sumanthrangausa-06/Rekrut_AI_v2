module.exports = {
  name: '017_fix_missing_schema',
  async up(client) {
    // Add avatar_url column to users table (for OAuth profile pictures)
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT
    `);

    // Create omniscore_results table (used by biasDetection, scoreExplainer, compliance)
    // This is separate from omni_scores - stores AI assessment results
    await client.query(`
      CREATE TABLE IF NOT EXISTS omniscore_results (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        overall_score DECIMAL(5,2),
        technical_score DECIMAL(5,2),
        behavioral_score DECIMAL(5,2),
        experience_score DECIMAL(5,2),
        assessment_date TIMESTAMP DEFAULT NOW(),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_omniscore_results_user_id ON omniscore_results(user_id);
      CREATE INDEX IF NOT EXISTS idx_omniscore_results_overall_score ON omniscore_results(overall_score);
    `);

    console.log('Fixed missing schema: avatar_url column and omniscore_results table');
  }
};
