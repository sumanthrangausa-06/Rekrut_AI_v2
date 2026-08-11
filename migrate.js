const { Pool } = require('pg');
const { parse } = require('pg-connection-string');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
require('dotenv').config();

// SSL configuration: enforce certificate verification in production or when explicitly requested.
// FORCE_SSL_VERIFY=false overrides everything (for Render PostgreSQL self-signed certs).
// In test environments (CI), disable SSL entirely since local PostgreSQL containers don't support it.
const sslConfig =
	process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'e2e'
		? false
		: process.env.FORCE_SSL_VERIFY === 'false'
		  ? { rejectUnauthorized: false }
		  : process.env.NODE_ENV === 'production' ||
		      process.env.DATABASE_URL?.includes('sslmode=require') ||
		      process.env.FORCE_SSL_VERIFY === 'true'
		    ? { rejectUnauthorized: true }
		    : { rejectUnauthorized: false };

// Parse connection string to avoid sslmode conflicts with manual SSL config
let poolConfig = {
	connectionString: process.env.DATABASE_URL,
	ssl: sslConfig,
};

if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=')) {
	try {
		const parsed = parse(process.env.DATABASE_URL);
		// Remove ssl-related properties from parsed object to prevent driver conflicts
		const query = { ...parsed };
		delete query.sslmode;
		delete query.ssl;
		poolConfig = {
			...query,
			ssl: sslConfig,
		};
	} catch {
		// Fallback to raw connection string if parsing fails
	}
}

const pool = new Pool(poolConfig);

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
      const allFiles = fs.readdirSync(migrationsDir).filter(f => !f.startsWith('.'));

      // Fail loudly on unrecognized migration file extensions
      for (const f of allFiles) {
        if (!f.endsWith('.js') && !f.endsWith('.sql')) {
          throw new Error(
            `Unrecognized migration file: ${f}. Only .js and .sql files are supported.`
          );
        }
      }

      const files = allFiles.sort();

      for (const file of files) {
        let migrationName;
        let upFn;

        if (file.endsWith('.js')) {
          const migration = require(path.join(migrationsDir, file));
          migrationName = migration.name || file.replace('.js', '');
          if (!migrationName) {
            console.warn(`Skipping migration file with no name: ${file}`);
            continue;
          }
          if (typeof migration.up !== 'function') {
            throw new Error(`Migration ${file} does not export an 'up' function`);
          }
          upFn = () => migration.up(client);
        } else {
          // .sql file
          migrationName = file;
          const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
          upFn = () => client.query(sql);
        }

        const existing = await client.query(
          'SELECT id FROM _migrations WHERE name = $1',
          [migrationName]
        );

        if (existing.rows.length === 0) {
          console.log(`Running migration: ${migrationName}`);
          await client.query('BEGIN');
          try {
            await upFn();
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
