const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Core tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        name VARCHAR(255),
        role VARCHAR(50) DEFAULT 'candidate',
        company_name VARCHAR(255),
        github_username VARCHAR(255),
        avatar_url TEXT,
        is_paid BOOLEAN DEFAULT false,
        stripe_subscription_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        company VARCHAR(255),
        description TEXT,
        requirements TEXT,
        location VARCHAR(255),
        salary_range VARCHAR(100),
        job_type VARCHAR(50) DEFAULT 'full-time',
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS interviews (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        interview_type VARCHAR(50) DEFAULT 'mock',
        status VARCHAR(50) DEFAULT 'pending',
        questions JSONB DEFAULT '[]',
        responses JSONB DEFAULT '[]',
        ai_feedback JSONB,
        overall_score INTEGER,
        duration_seconds INTEGER,
        video_urls JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS interview_questions (
        id SERIAL PRIMARY KEY,
        category VARCHAR(100),
        difficulty VARCHAR(50) DEFAULT 'medium',
        question_text TEXT NOT NULL,
        ideal_answer_points JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_data (
        id SERIAL PRIMARY KEY,
        type VARCHAR(100) NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Run migration files from migrations folder
    const migrationsDir = path.join(__dirname, 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.js'))
        .sort();

      for (const file of files) {
        const migration = require(path.join(migrationsDir, file));
        // Derive name from module export or fallback to filename
        const migrationName = migration.name || file.replace('.js', '');
        if (!migrationName) {
          console.warn(`Skipping migration file with no name: ${file}`);
          continue;
        }
        const existing = await client.query(
          'SELECT id FROM _migrations WHERE name = $1',
          [migrationName]
        );

        if (existing.rows.length === 0) {
          console.log(`Running migration: ${migrationName}`);
          await client.query('BEGIN');
          try {
            await migration.up(client);
            await client.query(
              'INSERT INTO _migrations (name) VALUES ($1)',
              [migrationName]
            );
            await client.query('COMMIT');
            console.log(`Migration ${migrationName} completed`);
          } catch (err) {
            await client.query('ROLLBACK');
            throw err;
          }
        }
      }
    }

    console.log('All migrations completed successfully');
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();