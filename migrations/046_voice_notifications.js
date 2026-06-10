// Migration: Add voice notification support
// - Add audio fields to notification_logs
// - Add voice_enabled preference to notification_preferences
// - Create notification_audio_cache table for voice alerts

module.exports = {
	name: '046_voice_notifications',
	async up(client) {
		// Add audio fields to notification_logs
		await client.query(`
      ALTER TABLE notification_logs 
      ADD COLUMN IF NOT EXISTS audio_path VARCHAR(255),
      ADD COLUMN IF NOT EXISTS voice_enabled BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS emotion VARCHAR(20) DEFAULT 'neutral',
      ADD COLUMN IF NOT EXISTS audio_generated_at TIMESTAMP WITH TIME ZONE
    `);

		// Add voice preference to notification_preferences
		await client.query(`
      ALTER TABLE notification_preferences 
      ADD COLUMN IF NOT EXISTS voice_enabled BOOLEAN DEFAULT false
    `);

		// Create dedicated cache table for notification audio (Cartesia Phase 2)
		await client.query(`
      CREATE TABLE IF NOT EXISTS notification_audio_cache (
        id SERIAL PRIMARY KEY,
        notification_log_id INTEGER REFERENCES notification_logs(id) ON DELETE CASCADE,
        text_hash VARCHAR(64) NOT NULL,
        voice_id VARCHAR(64) NOT NULL DEFAULT 'f786b574-daa5-4673-aa0c-cbe3e8534c02',
        emotion VARCHAR(20) DEFAULT 'neutral',
        audio_data BYTEA,
        audio_path VARCHAR(255),
        duration_seconds INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(text_hash, voice_id, emotion)
      )
    `);

		// Index for fast lookup
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_audio_cache_hash 
      ON notification_audio_cache(text_hash, voice_id, emotion)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_audio_cache_log_id 
      ON notification_audio_cache(notification_log_id)
    `);

		// Index for voice-enabled notifications
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_logs_voice 
      ON notification_logs(voice_enabled, status) WHERE voice_enabled = true
    `);

		console.log('✅ Voice notification migration applied');
	},

	async down(client) {
		await client.query('DROP TABLE IF EXISTS notification_audio_cache');
		await client.query(`
      ALTER TABLE notification_logs 
      DROP COLUMN IF EXISTS audio_path,
      DROP COLUMN IF EXISTS voice_enabled,
      DROP COLUMN IF EXISTS emotion,
      DROP COLUMN IF EXISTS audio_generated_at
    `);
		await client.query(`
      ALTER TABLE notification_preferences 
      DROP COLUMN IF EXISTS voice_enabled
    `);
	},
};
