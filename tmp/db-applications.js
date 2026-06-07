const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_IC0wumYoWbe4@ep-calm-field-aipg6g97-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const r = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'job_applications' ORDER BY ordinal_position");
    console.log('job_applications columns:', r.rows.map(c => c.column_name));
    const r2 = await pool.query("SELECT * FROM job_applications LIMIT 1");
    console.log('sample job_applications:', r2.rows.length > 0 ? JSON.stringify(r2.rows[0], null, 2) : 'no rows');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}
main();
