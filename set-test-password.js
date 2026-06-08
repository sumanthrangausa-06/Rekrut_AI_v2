const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_IC0wumYoWbe4@ep-calm-field-aipg6g97-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false }
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
  await setPassword('test_candidate@rekrutai.co', 'Test123!');
  await setPassword('test_recruiter@rekrutai.co', 'Test123!');
  await setPassword('qa_test@rekrutai.co', 'Test123!');
  await setPassword('test_candidate_qa@rekrutai.co', 'Test123!');
  await setPassword('test_recruiter_qa@rekrutai.co', 'Test123!');
  await pool.end();
  console.log('Done');
}

main();
