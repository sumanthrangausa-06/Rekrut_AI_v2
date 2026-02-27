require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

(async () => {
  try {
    const email = 'sumanthrangausa@gmail.com';

    // Get current password hash
    const user = await pool.query(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [email]
    );

    if (user.rows.length === 0) {
      console.log('User not found');
      return;
    }

    const userRecord = user.rows[0];
    console.log('=== USER RECORD ===');
    console.log('ID:', userRecord.id);
    console.log('Email:', userRecord.email);
    console.log('Name:', userRecord.name);
    console.log('Password hash (first 30 chars):', userRecord.password_hash.substring(0, 30) + '...');
    console.log('Password hash length:', userRecord.password_hash.length);

    // Check if a specific password matches
    const testPassword = 'Test@1234'; // Common test password
    const isMatch = await bcrypt.compare(testPassword, userRecord.password_hash);
    console.log(`\nDoes password "${testPassword}" match?`, isMatch ? 'YES' : 'NO');

    // Check all tokens for this user
    const tokens = await pool.query(
      'SELECT token, expires_at, used_at, created_at FROM password_reset_tokens WHERE user_id = $1 ORDER BY created_at DESC',
      [userRecord.id]
    );
    console.log('\n=== ALL PASSWORD RESET TOKENS ===');
    tokens.rows.forEach((t, idx) => {
      console.log(`Token ${idx + 1}:`);
      console.log('  Token:', t.token.substring(0, 20) + '...');
      console.log('  Created:', t.created_at);
      console.log('  Expires:', t.expires_at);
      console.log('  Used:', t.used_at);
      console.log('');
    });

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
})();
