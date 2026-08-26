const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres@localhost/rekrut_e2e_phased' });

async function addColumnIfMissing(table, column, def) {
  const check = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 AND table_schema = 'public'`,
    [table, column]
  );
  if (check.rows.length === 0) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    console.log(`Added ${table}.${column}`);
  } else {
    console.log(`${table}.${column} already exists`);
  }
}

async function addTableIfMissing(table, ddl) {
  const check = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public'`,
    [table]
  );
  if (check.rows.length === 0) {
    await pool.query(ddl);
    console.log(`Created table ${table}`);
  } else {
    console.log(`Table ${table} already exists`);
  }
}

(async () => {
  try {
    // Missing columns on jobs table (from migration 224_department_hierarchy.js and others)
    await addColumnIfMissing('jobs', 'department_id', 'INTEGER');
    await addColumnIfMissing('jobs', 'department', 'TEXT');

    // Missing email_queue table (from 2024-06-14-add-email-queue.js)
    await addTableIfMissing('email_queue', `
      CREATE TABLE email_queue (
        id SERIAL PRIMARY KEY,
        to_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        sent_at TIMESTAMP,
        error TEXT
      )
    `);

    // Missing candidate_search_index table (from migration 130)
    await addTableIfMissing('candidate_search_index', `
      CREATE TABLE candidate_search_index (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        name TEXT,
        avatar_url TEXT,
        job_title TEXT,
        location TEXT,
        experience_years INTEGER DEFAULT 0,
        omni_score INTEGER DEFAULT 0,
        score_tier TEXT,
        availability_status TEXT,
        bio TEXT,
        skills JSONB DEFAULT '[]',
        search_vector TSVECTOR,
        embedding VECTOR(1536),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Missing saved_searches table
    await addTableIfMissing('saved_searches', `
      CREATE TABLE saved_searches (
        id SERIAL PRIMARY KEY,
        recruiter_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        filters JSONB DEFAULT '{}',
        search_query TEXT,
        alert_enabled BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Seed candidate_search_index for E2E candidate
    const e2eCandidate = await pool.query(`SELECT id FROM users WHERE email = 'e2e-candidate@rekrutai.test'`);
    if (e2eCandidate.rows.length > 0) {
      const userId = e2eCandidate.rows[0].id;
      await pool.query(`
        INSERT INTO candidate_search_index (user_id, name, job_title, location, experience_years, omni_score, score_tier, availability_status, bio, skills, updated_at)
        VALUES ($1, 'E2E Candidate', 'Senior QA Engineer', 'Remote', 5, 85, 'expert', 'open', 'Experienced QA automation engineer', '["Playwright", "TypeScript", "React"]', NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          name = EXCLUDED.name,
          job_title = EXCLUDED.job_title,
          location = EXCLUDED.location,
          experience_years = EXCLUDED.experience_years,
          omni_score = EXCLUDED.omni_score,
          score_tier = EXCLUDED.score_tier,
          availability_status = EXCLUDED.availability_status,
          bio = EXCLUDED.bio,
          skills = EXCLUDED.skills,
          updated_at = NOW()
      `, [userId]);
      console.log('Seeded candidate_search_index for E2E candidate');
    }

    console.log('Schema alignment complete');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
})();
