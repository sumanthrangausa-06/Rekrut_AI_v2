const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ─── Query Performance Tracking ────────────────────────────────
// Wraps pool.query to count total queries, slow queries (>200ms),
// and queries-per-minute for the admin monitoring dashboard.
let totalQueries = 0;
let slowQueries = 0;
const SLOW_THRESHOLD_MS = 200;
const recentTimestamps = [];

const _origQuery = pool.query.bind(pool);
pool.query = function(...args) {
  const start = Date.now();
  totalQueries++;
  recentTimestamps.push(start);
  // Prune to keep memory bounded (keep last 5 minutes)
  if (recentTimestamps.length > 3000) {
    const cutoff = Date.now() - 300000;
    const idx = recentTimestamps.findIndex(t => t >= cutoff);
    if (idx > 0) recentTimestamps.splice(0, idx);
  }
  const result = _origQuery(...args);
  if (result && typeof result.then === 'function') {
    result.then(() => {
      if (Date.now() - start > SLOW_THRESHOLD_MS) slowQueries++;
    }).catch(() => {});
  }
  return result;
};

pool.getQueryStats = () => {
  const cutoff = Date.now() - 60000;
  return {
    totalQueries,
    slowQueries,
    queriesPerMinute: recentTimestamps.filter(t => t >= cutoff).length,
  };
};

module.exports = pool;
