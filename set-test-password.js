const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function setPassword(email, password) {
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [hash, email]);
    console.log('Password set for', email);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

async function main() {
  const password = process.env.TEST_USER_PASSWORD;
  if (!password) {
    console.error('TEST_USER_PASSWORD environment variable is required');
    process.exit(1);
  }

  const emails = [
    'test_candidate@rekrutai.co',
    'test_recruiter@rekrutai.co',
    'qa_test@rekrutai.co',
    'test_candidate_qa@rekrutai.co',
    'test_recruiter_qa@rekrutai.co',
  ];

  for (const email of emails) {
    await setPassword(email, password);
  }

  await pool.end();
  console.log('Done');
}

main();
