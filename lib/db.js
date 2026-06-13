const { Pool } = require('pg');

// SSL configuration: enforce certificate verification in production or when explicitly requested.
// For local/dev without SSL, allow unverified connections only when DATABASE_URL lacks sslmode=require.
const sslConfig =
	process.env.NODE_ENV === 'production' ||
	process.env.DATABASE_URL?.includes('sslmode=require') ||
	process.env.FORCE_SSL_VERIFY === 'true'
		? { rejectUnauthorized: true }
		: { rejectUnauthorized: false };

const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: sslConfig,
	max: 25,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 10000,
	// Stagger acquisitions to avoid thundering herd on startup
	allowExitOnIdle: false,
});

let totalQueries = 0;
let slowQueries = 0;
const SLOW_THRESHOLD_MS = 200;
const recentTimestamps = [];

const _origQuery = pool.query.bind(pool);
pool.query = (...args) => {
	const start = Date.now();
	totalQueries++;
	recentTimestamps.push(start);
	if (recentTimestamps.length > 3000) {
		const cutoff = Date.now() - 300000;
		const idx = recentTimestamps.findIndex((t) => t >= cutoff);
		if (idx > 0) recentTimestamps.splice(0, idx);
	}
	const result = _origQuery(...args);
	if (result && typeof result.then === 'function') {
		result
			.then(() => {
				if (Date.now() - start > SLOW_THRESHOLD_MS) slowQueries++;
			})
			.catch(() => {});
	}
	return result;
};

pool.getQueryStats = () => {
	const cutoff = Date.now() - 60000;
	return {
		totalQueries,
		slowQueries,
		queriesPerMinute: recentTimestamps.filter((t) => t >= cutoff).length,
	};
};

module.exports = pool;
