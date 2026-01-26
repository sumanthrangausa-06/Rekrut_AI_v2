// Matching & Ranking Engine Migration
// Adds vector embeddings and matching infrastructure for intelligent job-candidate matching

module.exports = {
  name: '008_matching_engine',
  up: async (client) => {
    // Enable pgvector extension for vector similarity search
    await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    // Candidate embeddings - semantic representation of candidate profiles
    await client.query(`
      CREATE TABLE IF NOT EXISTS candidate_embeddings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        embedding vector(1536),
        profile_text TEXT,
        skills_summary TEXT,
        experience_summary TEXT,
        last_updated TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Job embeddings - semantic representation of job postings
    await client.query(`
      CREATE TABLE IF NOT EXISTS job_embeddings (
        id SERIAL PRIMARY KEY,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE UNIQUE,
        embedding vector(1536),
        job_text TEXT,
        requirements_summary TEXT,
        last_updated TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Match results - cached matching scores with explanations
    await client.query(`
      CREATE TABLE IF NOT EXISTS match_results (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        similarity_score DECIMAL(5,4),
        weighted_score DECIMAL(5,2),
        omniscore_at_match INTEGER,
        trustscore_at_match INTEGER,
        matching_skills JSONB DEFAULT '[]',
        missing_skills JSONB DEFAULT '[]',
        match_explanation JSONB,
        match_level VARCHAR(50),
        calculated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(candidate_id, job_id)
      )
    `);

    // Job recommendations - personalized job feed for candidates
    await client.query(`
      CREATE TABLE IF NOT EXISTS job_recommendations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        match_score DECIMAL(5,2),
        recommendation_reason TEXT,
        shown_at TIMESTAMP,
        clicked_at TIMESTAMP,
        applied_at TIMESTAMP,
        dismissed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, job_id)
      )
    `);

    // Create indexes for performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_candidate_embeddings_user ON candidate_embeddings(user_id);
      CREATE INDEX IF NOT EXISTS idx_job_embeddings_job ON job_embeddings(job_id);
      CREATE INDEX IF NOT EXISTS idx_match_results_candidate ON match_results(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_match_results_job ON match_results(job_id);
      CREATE INDEX IF NOT EXISTS idx_match_results_score ON match_results(weighted_score DESC);
      CREATE INDEX IF NOT EXISTS idx_job_recommendations_user ON job_recommendations(user_id);
      CREATE INDEX IF NOT EXISTS idx_job_recommendations_score ON job_recommendations(match_score DESC);
    `);

    // Create vector similarity index (IVFFlat for faster similarity search)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_candidate_embeddings_vector
      ON candidate_embeddings USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_job_embeddings_vector
      ON job_embeddings USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `);

    console.log('Matching engine tables created successfully');
  }
};
