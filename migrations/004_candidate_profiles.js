// Migration: Candidate Profiles Module
// Adds tables for full candidate profiles, skills, assessments, and job matching

module.exports = {
  name: '004_candidate_profiles',
  up: async (client) => {
    // Candidate profiles - extended user info
    await client.query(`
      CREATE TABLE IF NOT EXISTS candidate_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        headline VARCHAR(200),
        bio TEXT,
        location VARCHAR(255),
        phone VARCHAR(50),
        linkedin_url VARCHAR(500),
        github_url VARCHAR(500),
        portfolio_url VARCHAR(500),
        resume_url VARCHAR(500),
        photo_url VARCHAR(500),
        availability VARCHAR(50) DEFAULT 'immediately',
        salary_min INTEGER,
        salary_max INTEGER,
        preferred_job_types JSONB DEFAULT '["full-time"]',
        preferred_locations JSONB DEFAULT '[]',
        remote_preference VARCHAR(50) DEFAULT 'hybrid',
        years_experience INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Work experience entries
    await client.query(`
      CREATE TABLE IF NOT EXISTS work_experience (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        company_name VARCHAR(255) NOT NULL,
        title VARCHAR(255) NOT NULL,
        location VARCHAR(255),
        start_date DATE,
        end_date DATE,
        is_current BOOLEAN DEFAULT false,
        description TEXT,
        achievements JSONB DEFAULT '[]',
        skills_used JSONB DEFAULT '[]',
        order_index INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Education entries
    await client.query(`
      CREATE TABLE IF NOT EXISTS education (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        institution VARCHAR(255) NOT NULL,
        degree VARCHAR(255),
        field_of_study VARCHAR(255),
        start_date DATE,
        end_date DATE,
        is_current BOOLEAN DEFAULT false,
        gpa DECIMAL(3,2),
        achievements JSONB DEFAULT '[]',
        order_index INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Skills with categories and levels
    await client.query(`
      CREATE TABLE IF NOT EXISTS candidate_skills (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        skill_name VARCHAR(100) NOT NULL,
        category VARCHAR(50) DEFAULT 'technical',
        level INTEGER DEFAULT 1 CHECK (level >= 1 AND level <= 5),
        years_experience DECIMAL(3,1) DEFAULT 0,
        is_verified BOOLEAN DEFAULT false,
        verified_at TIMESTAMP,
        verified_score INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, skill_name)
      )
    `);

    // Skill assessments
    await client.query(`
      CREATE TABLE IF NOT EXISTS skill_assessments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        skill_id INTEGER REFERENCES candidate_skills(id) ON DELETE SET NULL,
        assessment_type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        questions JSONB DEFAULT '[]',
        responses JSONB DEFAULT '[]',
        score INTEGER,
        max_score INTEGER DEFAULT 100,
        passed BOOLEAN DEFAULT false,
        ai_feedback JSONB,
        duration_seconds INTEGER,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Portfolio projects
    await client.query(`
      CREATE TABLE IF NOT EXISTS portfolio_projects (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        project_url VARCHAR(500),
        github_url VARCHAR(500),
        image_url VARCHAR(500),
        technologies JSONB DEFAULT '[]',
        role VARCHAR(100),
        start_date DATE,
        end_date DATE,
        highlights JSONB DEFAULT '[]',
        order_index INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Saved jobs for candidates
    await client.query(`
      CREATE TABLE IF NOT EXISTS saved_jobs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        saved_at TIMESTAMP DEFAULT NOW(),
        notes TEXT,
        UNIQUE(user_id, job_id)
      )
    `);

    // Job applications
    await client.query(`
      CREATE TABLE IF NOT EXISTS job_applications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        status VARCHAR(50) DEFAULT 'applied',
        cover_letter TEXT,
        match_score INTEGER,
        applied_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        recruiter_notes TEXT,
        UNIQUE(user_id, job_id)
      )
    `);

    // Parsed resume data (from AI parsing)
    await client.query(`
      CREATE TABLE IF NOT EXISTS parsed_resumes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        original_filename VARCHAR(255),
        file_url VARCHAR(500),
        parsed_data JSONB,
        parsing_status VARCHAR(50) DEFAULT 'pending',
        parsed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes for performance
    await client.query(`CREATE INDEX IF NOT EXISTS idx_candidate_skills_user ON candidate_skills(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_work_experience_user ON work_experience(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_education_user ON education(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_saved_jobs_user ON saved_jobs(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_job_applications_user ON job_applications(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_job_applications_job ON job_applications(job_id)`);

    console.log('Candidate profiles tables created');
  }
};
