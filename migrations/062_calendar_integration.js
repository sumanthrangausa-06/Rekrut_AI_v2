// Migration 062: Calendar Integration — Google Calendar + Microsoft Outlook OAuth
module.exports = {
	up: async (client) => {
		// Calendar connections table — stores OAuth tokens for each user/provider
		await client.query(`
      CREATE TABLE IF NOT EXISTS calendar_connections (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        provider VARCHAR(50) NOT NULL CHECK (provider IN ('google', 'outlook')),
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        expires_at TIMESTAMP,
        calendar_id VARCHAR(255) DEFAULT 'primary',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, provider)
      )
    `);

		// Add calendar sync tracking columns to scheduled_interviews
		await client.query(`
      ALTER TABLE scheduled_interviews
      ADD COLUMN IF NOT EXISTS calendar_event_id VARCHAR(255) DEFAULT NULL
    `);
		await client.query(`
      ALTER TABLE scheduled_interviews
      ADD COLUMN IF NOT EXISTS calendar_provider VARCHAR(50) DEFAULT NULL
    `);

		// Indexes for fast lookups
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_calendar_connections_user ON calendar_connections(user_id);
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_calendar_connections_active ON calendar_connections(user_id, provider) WHERE is_active = true;
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_calendar ON scheduled_interviews(calendar_event_id);
    `);

		console.log('Migration 062: Calendar integration tables created');
	},
};
