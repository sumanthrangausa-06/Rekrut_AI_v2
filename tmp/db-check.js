const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_IC0wumYoWbe4@ep-calm-field-aipg6g97-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const jobs = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'jobs' ORDER BY ordinal_position");
    console.log('jobs columns:', jobs.rows.map(c => c.column_name));

    const saved = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'saved_jobs' ORDER BY ordinal_position");
    console.log('saved_jobs columns:', saved.rows.map(c => c.column_name));

    const apps = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'applications' ORDER BY ordinal_position");
    console.log('applications columns:', apps.rows.map(c => c.column_name));

    const sample = await pool.query("SELECT * FROM jobs WHERE status = 'active' LIMIT 1");
    console.log('sample job keys:', Object.keys(sample.rows[0]));
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}

main();
