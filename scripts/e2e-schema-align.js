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

    console.log('Schema alignment complete');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
})();
