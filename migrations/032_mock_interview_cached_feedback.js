// Add cached_feedback column for background feedback generation
module.exports = {
  name: 'mock_interview_cached_feedback',
  up: async (client) => {
    // Add cached_feedback column for pre-generating feedback during interview
    await client.query(`
      ALTER TABLE mock_interview_sessions
      ADD COLUMN IF NOT EXISTS cached_feedback JSONB
    `);
  },
  down: async (client) => {
    await client.query(`
      ALTER TABLE mock_interview_sessions
      DROP COLUMN IF EXISTS cached_feedback
    `);
  }
};
