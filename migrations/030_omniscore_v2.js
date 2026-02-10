// OmniScore v2 Migration - Two-sided scoring system
module.exports = {
  name: 'omniscore_v2_two_sided',
  up: async (client) => {
    // Company ratings from candidates (richer than candidate_feedback)
    await client.query(`
      CREATE TABLE IF NOT EXISTS company_ratings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        candidate_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        overall_rating INTEGER CHECK (overall_rating >= 1 AND overall_rating <= 5),
        interview_experience INTEGER CHECK (interview_experience >= 1 AND interview_experience <= 5),
        communication INTEGER CHECK (communication >= 1 AND communication <= 5),
        transparency INTEGER CHECK (transparency >= 1 AND transparency <= 5),
        work_life_balance INTEGER CHECK (work_life_balance >= 1 AND work_life_balance <= 5),
        culture INTEGER CHECK (culture >= 1 AND culture <= 5),
        growth_opportunity INTEGER CHECK (growth_opportunity >= 1 AND growth_opportunity <= 5),
        review_text TEXT,
        pros TEXT,
        cons TEXT,
        is_anonymous BOOLEAN DEFAULT true,
        is_verified BOOLEAN DEFAULT false,
        status VARCHAR(20) DEFAULT 'published',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(company_id, candidate_id)
      )
    `);

    // Mutual match scores (precomputed)
    await client.query(`
      CREATE TABLE IF NOT EXISTS mutual_matches (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        candidate_score INTEGER DEFAULT 300,
        company_score INTEGER DEFAULT 500,
        mutual_fit_score DECIMAL(5,2) DEFAULT 0,
        match_level VARCHAR(20) DEFAULT 'none',
        candidate_interest BOOLEAN DEFAULT false,
        company_interest BOOLEAN DEFAULT false,
        calculated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(candidate_id, company_id, job_id)
      )
    `);

    // Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_company_ratings_company ON company_ratings(company_id);
      CREATE INDEX IF NOT EXISTS idx_company_ratings_candidate ON company_ratings(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_mutual_matches_candidate ON mutual_matches(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_mutual_matches_company ON mutual_matches(company_id);
      CREATE INDEX IF NOT EXISTS idx_mutual_matches_fit ON mutual_matches(mutual_fit_score DESC);
    `);

    console.log('OmniScore v2 tables created successfully');
  }
};
