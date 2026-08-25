const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres@localhost/rekrut_e2e_phased' });

(async () => {
  const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'jobs' AND table_schema = 'public' ORDER BY ordinal_position");
  console.log('jobs columns:', cols.rows.map(r => r.column_name).join(', '));
  pool.end();
})();
