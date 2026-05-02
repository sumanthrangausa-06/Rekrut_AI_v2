/**
 * Migration: Screening tables for recruiter AI screener
 */

exports.up = async (pool) => {
  console.log('[migration] Creating screening tables...');
  
  // Screening logs - tracks all screenings performed
  await pool.query(`
    CREATE TABLE IF NOT EXISTS screening_logs (
      id SERIAL PRIMARY KEY,
      candidate_id INTEGER REFERENCES users(id),
      job_id INTEGER REFERENCES jobs(id),
      fit_score INTEGER CHECK (fit_score >= 0 AND fit_score <= 100),
      recommendation VARCHAR(20) CHECK (recommendation IN ('interview', 'reject', 'more_info', 'hold', 'error')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  
  // Job application screenings - stores detailed screening results
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_application_screenings (
      id SERIAL PRIMARY KEY,
      application_id INTEGER REFERENCES job_applications(id) UNIQUE,
      candidate_id INTEGER REFERENCES users(id),
      job_id INTEGER REFERENCES jobs(id),
      fit_score INTEGER CHECK (fit_score >= 0 AND fit_score <= 100),
      recommendation VARCHAR(20),
      screening_data JSONB,
      screened_by INTEGER REFERENCES users(id),
      screened_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  
  // Create indexes separately
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_screening_job ON job_application_screenings(job_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_screening_candidate ON job_application_screenings(candidate_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_screening_score ON job_application_screenings(fit_score DESC)`);
  
  console.log('[migration] Screening tables created');
};

exports.down = async (pool) => {
  await pool.query('DROP INDEX IF EXISTS idx_screening_score');
  await pool.query('DROP INDEX IF EXISTS idx_screening_candidate');
  await pool.query('DROP INDEX IF EXISTS idx_screening_job');
  await pool.query('DROP TABLE IF EXISTS job_application_screenings');
  await pool.query('DROP TABLE IF EXISTS screening_logs');
};
