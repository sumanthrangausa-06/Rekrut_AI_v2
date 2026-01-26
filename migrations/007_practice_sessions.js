// Practice Sessions Migration - AI Interview Coaching & Practice Mode
module.exports = {
  name: 'add_practice_sessions',
  up: async (client) => {
    // Practice sessions table - stores interview practice attempts with AI coaching
    await client.query(`
      CREATE TABLE IF NOT EXISTS practice_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        question_id VARCHAR(50) NOT NULL,
        question TEXT NOT NULL,
        category VARCHAR(50) NOT NULL,
        response_text TEXT NOT NULL,
        score INTEGER NOT NULL,
        coaching_data JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes for performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_practice_sessions_user ON practice_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_practice_sessions_category ON practice_sessions(category);
      CREATE INDEX IF NOT EXISTS idx_practice_sessions_created ON practice_sessions(created_at DESC);
    `);

    console.log('Practice sessions table created successfully');
  }
};
