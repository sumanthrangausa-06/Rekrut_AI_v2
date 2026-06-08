const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_IC0wumYoWbe4@ep-calm-field-aipg6g97-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false }
});

async function checkPasswords() {
  try {
    const result = await pool.query(`
      SELECT id, email, name, role, password_hash IS NOT NULL as has_password, 
             LENGTH(password_hash) as password_length,
             created_at 
      FROM users 
      WHERE email LIKE '%test%' 
         OR email LIKE '%demo%' 
         OR email LIKE '%qa%'
         OR email LIKE '%example%'
         OR email LIKE '%authtest%'
      ORDER BY created_at DESC
      LIMIT 20
    `);
    console.log('Test accounts:', result.rows.length);
    console.log(JSON.stringify(result.rows, null, 2));
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

checkPasswords();
