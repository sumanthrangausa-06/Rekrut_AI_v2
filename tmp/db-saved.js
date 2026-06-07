const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_IC0wumYoWbe4@ep-calm-field-aipg6g97-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});
async function main() {
  try {
    const r = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'saved%'");
    console.log('saved tables:', r.rows.map(t => t.table_name));
    const r2 = await pool.query("SELECT * FROM saved_jobs LIMIT 1");
    console.log('saved_jobs:', r2.rows.length, 'rows');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}
main();
