// Add per_question_analysis column for feature parity with quick practice
module.exports = {
  name: 'mock_per_question_analysis',
  up: async (client) => {
    // Store per-question multi-modal analysis (content, video, voice) for each candidate turn
    await client.query(`
      ALTER TABLE mock_interview_sessions
      ADD COLUMN IF NOT EXISTS per_question_analysis JSONB DEFAULT '{}'
    `);
  },
  down: async (client) => {
    await client.query(`
      ALTER TABLE mock_interview_sessions
      DROP COLUMN IF EXISTS per_question_analysis
    `);
  }
};
