module.exports = {
  name: '010_video_analysis',
  async up(client) {
    // Interview video analysis table
    await client.query(`
      CREATE TABLE IF NOT EXISTS interview_analysis (
        id SERIAL PRIMARY KEY,
        interview_id INTEGER REFERENCES interviews(id) ON DELETE CASCADE,
        question_index INTEGER NOT NULL,
        analysis_data JSONB NOT NULL,
        eye_contact_score DECIMAL(5,2),
        expression_score DECIMAL(5,2),
        body_language_score DECIMAL(5,2),
        voice_score DECIMAL(5,2),
        presentation_score DECIMAL(5,2),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(interview_id, question_index)
      )
    `);

    // Index for fast lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_analysis_interview_id
      ON interview_analysis(interview_id)
    `);

    console.log('Created interview_analysis table');
  }
};
