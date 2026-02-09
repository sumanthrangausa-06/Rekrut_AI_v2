module.exports = {
  name: '028_video_practice',
  async up(client) {
    // Extend practice_sessions for video responses
    await client.query(`
      ALTER TABLE practice_sessions ADD COLUMN IF NOT EXISTS response_type VARCHAR(20) DEFAULT 'text';
      ALTER TABLE practice_sessions ADD COLUMN IF NOT EXISTS video_url TEXT;
      ALTER TABLE practice_sessions ADD COLUMN IF NOT EXISTS transcription TEXT;
      ALTER TABLE practice_sessions ADD COLUMN IF NOT EXISTS audio_analysis JSONB;
      ALTER TABLE practice_sessions ADD COLUMN IF NOT EXISTS video_analysis JSONB;
      ALTER TABLE practice_sessions ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
    `);

    console.log('Extended practice_sessions for video practice');
  }
};
