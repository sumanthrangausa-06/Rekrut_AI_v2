const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_IC0wumYoWbe4@ep-calm-field-aipg6g97-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const r = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%applic%'");
    console.log('applicant tables:', r.rows.map(t => t.table_name));
    const r2 = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%job%'");
    console.log('job tables:', r2.rows.map(t => t.table_name));
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}
main();
