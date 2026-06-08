const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_IC0wumYoWbe4@ep-calm-field-aipg6g97-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false }
});

async function findTestAccounts() {
  try {
    const result = await pool.query(`
      SELECT id, email, name, role, created_at 
      FROM users 
      WHERE email LIKE '%test%' 
         OR email LIKE '%demo%' 
         OR email LIKE '%qa%'
         OR email LIKE '%example%'
         OR name LIKE '%test%'
         OR name LIKE '%demo%'
      ORDER BY created_at DESC
      LIMIT 20
    `);
    console.log('Test accounts found:', result.rows.length);
    console.log(JSON.stringify(result.rows, null, 2));
    
    const all = await pool.query('SELECT COUNT(*) as total FROM users');
    console.log('\nTotal users:', all.rows[0].total);
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

findTestAccounts();
