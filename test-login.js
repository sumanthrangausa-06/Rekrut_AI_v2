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
    const user = await pool.query('SELECT password_hash FROM users WHERE email = $1', [email]);

    if (user.rows.length > 0) {
      const testPassword = 'Sumanth$#@1106';
      const isMatch = await bcrypt.compare(testPassword, user.rows[0].password_hash);
      console.log('Password match:', isMatch);
    } else {
      console.log('User not found');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
})();
