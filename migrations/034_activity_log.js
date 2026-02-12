module.exports = {
  name: '034_activity_log',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(100) NOT NULL,
        category VARCHAR(50) NOT NULL,
        severity VARCHAR(20) DEFAULT 'info',
        user_id INTEGER,
        user_email VARCHAR(255),
        details JSONB DEFAULT '{}',
        ip_address VARCHAR(45),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Indexes for fast queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log (created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_activity_log_category ON activity_log (category)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_activity_log_event_type ON activity_log (event_type)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log (user_id)
    `);
  },
};
