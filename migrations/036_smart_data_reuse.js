// Smart data reuse: extend question_bank for recruiter ownership + add screening_answer_profiles
module.exports = {
  name: '036_smart_data_reuse',
  up: async (pool) => {
    // Add recruiter_id, category, options to question_bank
    await pool.query(`
      ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS recruiter_id INTEGER REFERENCES users(id);
      ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'general';
      ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS options JSONB DEFAULT '[]';
      ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0;
    `);

    // Create unique constraint for recruiter question dedup
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_question_bank_recruiter_text
      ON question_bank (recruiter_id, question_text) WHERE recruiter_id IS NOT NULL;
    `);

    // Extend candidate_profiles with availability field if missing
    await pool.query(`
      ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS availability VARCHAR(100);
      ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS work_authorization VARCHAR(50);
      ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS certifications JSONB DEFAULT '[]';
      ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS preferred_industries JSONB DEFAULT '[]';
    `);

    console.log('[migration] 036_smart_data_reuse complete');
  }
};
