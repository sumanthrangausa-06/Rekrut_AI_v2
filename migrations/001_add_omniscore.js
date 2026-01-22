// OmniScore Migration - Candidate Credit Score System
module.exports = {
  name: 'add_omniscore_tables',
  up: async (client) => {
    // OmniScore main table - stores current score and history
    await client.query(`
      CREATE TABLE IF NOT EXISTS omni_scores (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        total_score INTEGER DEFAULT 300,
        interview_score INTEGER DEFAULT 0,
        technical_score INTEGER DEFAULT 0,
        resume_score INTEGER DEFAULT 0,
        behavior_score INTEGER DEFAULT 0,
        score_tier VARCHAR(50) DEFAULT 'new',
        last_updated TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Score components - individual score factors with time decay
    await client.query(`
      CREATE TABLE IF NOT EXISTS score_components (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        component_type VARCHAR(50) NOT NULL,
        source_type VARCHAR(50),
        source_id INTEGER,
        points INTEGER NOT NULL,
        max_points INTEGER NOT NULL,
        weight DECIMAL(3,2) DEFAULT 1.0,
        decay_rate DECIMAL(3,2) DEFAULT 0.95,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP
      )
    `);

    // Score history - track score changes over time
    await client.query(`
      CREATE TABLE IF NOT EXISTS score_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        previous_score INTEGER,
        new_score INTEGER,
        change_amount INTEGER,
        change_reason VARCHAR(255),
        component_type VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Role-specific scores
    await client.query(`
      CREATE TABLE IF NOT EXISTS role_scores (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        role_name VARCHAR(100) NOT NULL,
        score INTEGER DEFAULT 300,
        interview_count INTEGER DEFAULT 0,
        last_updated TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, role_name)
      )
    `);

    // Create indexes for performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_score_components_user ON score_components(user_id);
      CREATE INDEX IF NOT EXISTS idx_score_history_user ON score_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_role_scores_user ON role_scores(user_id);
    `);

    console.log('OmniScore tables created successfully');
  }
};
