// Cache TTS audio to avoid repeated API calls and survive daily token limit exhaustion
module.exports = {
  name: 'tts_audio_cache',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tts_cache (
        text_hash VARCHAR(64) PRIMARY KEY,
        voice VARCHAR(20) NOT NULL DEFAULT 'nova',
        audio_data BYTEA NOT NULL,
        text_preview VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Index for cleanup of old entries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tts_cache_created_at ON tts_cache(created_at)
    `);
  },
  down: async (client) => {
    await client.query('DROP TABLE IF EXISTS tts_cache');
  }
};
