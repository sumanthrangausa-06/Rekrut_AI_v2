require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

(async () => {
  try {
    // Check user sumanthrangausa@gmail.com
    const user = await pool.query(
      'SELECT id, email, name, LENGTH(password_hash) as hash_len, created_at FROM users WHERE email = $1',
      ['sumanthrangausa@gmail.com']
    );
    console.log('=== USER: sumanthrangausa@gmail.com ===');
    if (user.rows.length > 0) {
      console.log('ID:', user.rows[0].id);
      console.log('Name:', user.rows[0].name);
      console.log('Password hash length:', user.rows[0].hash_len);
      console.log('Created:', user.rows[0].created_at);
    } else {
      console.log('User NOT FOUND');
    }

    // Get user ID
    const userIdResult = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      ['sumanthrangausa@gmail.com']
    );

    if (userIdResult.rows.length > 0) {
      const userId = userIdResult.rows[0].id;

      // Check recent tokens for this user
      const tokens = await pool.query(
        'SELECT token, expires_at, used_at, created_at FROM password_reset_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 3',
        [userId]
      );
      console.log('\n=== PASSWORD RESET TOKENS ===');
      tokens.rows.forEach((t, idx) => {
        console.log(`Token ${idx + 1}:`);
        console.log('  Token:', t.token.substring(0, 20) + '...');
        console.log('  Created:', t.created_at);
        console.log('  Expires:', t.expires_at);
        console.log('  Used:', t.used_at);
        console.log('');
      });
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
})();
