require('dotenv').config();
const pool = require('./lib/db');

async function listRateLimits() {
  try {
    await new Promise(r => setTimeout(r, 2000));
    const result = await pool.query("SELECT key, count, reset_at FROM rate_limit_buckets");
    console.log(`Found ${result.rowCount} rate limit buckets:`);
    result.rows.forEach(row => {
      console.log(`  ${row.key} | count=${row.count} | reset_at=${row.reset_at}`);
    });
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    try {
      await pool.end();
    } catch (e) {}
  }
}

listRateLimits();
