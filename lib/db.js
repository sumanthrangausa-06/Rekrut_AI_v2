const { Pool } = require('pg');
const { parse } = require('pg-connection-string');

// SSL configuration: enforce certificate verification in production or when explicitly requested.
// FORCE_SSL_VERIFY=false overrides everything (for Render PostgreSQL self-signed certs).
const sslConfig =
	process.env.FORCE_SSL_VERIFY === 'false'
		? { rejectUnauthorized: false }
		: process.env.NODE_ENV === 'production' ||
		    process.env.DATABASE_URL?.includes('sslmode=require') ||
		    process.env.FORCE_SSL_VERIFY === 'true'
		  ? { rejectUnauthorized: true }
		  : { rejectUnauthorized: false };

// Parse connection string to avoid sslmode conflicts with manual SSL config
let poolConfig = {
	connectionString: process.env.DATABASE_URL,
	ssl: sslConfig,
	max: 25,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 10000,
	// Stagger acquisitions to avoid thundering herd on startup
	allowExitOnIdle: false,
};

if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=')) {
	try {
		const parsed = parse(process.env.DATABASE_URL);
		// Remove ssl-related properties from parsed object to prevent driver conflicts
		const query = { ...parsed };
		delete query.sslmode;
		delete query.ssl;
		// Use parsed object directly (no string rebuild needed)
		poolConfig = {
			...query,
			ssl: sslConfig,
			max: 25,
			idleTimeoutMillis: 30000,
			connectionTimeoutMillis: 10000,
			allowExitOnIdle: false,
		};
	} catch (err) {
		console.warn('[db] Failed to parse DATABASE_URL, using raw string:', err.message);
	}
}

const pool = new Pool(poolConfig);

// Handle pool errors (critical for Render and other PaaS)
pool.on('error', (err, client) => {
	console.error('[db] Unexpected pool error:', err.message, err.code || 'NO_CODE');
});

// Log connection config (without sensitive data) on startup
const logSafeConfig = { ...poolConfig };
delete logSafeConfig.password;
if (logSafeConfig.connectionString) {
	try {
		const parsed = parse(logSafeConfig.connectionString);
		logSafeConfig.connectionString = `${parsed.protocol || 'postgresql'}://${parsed.user || '***'}@***:${parsed.port || '***'}/${parsed.database || '***'}`;
	} catch (_e) {
		logSafeConfig.connectionString = '***masked***';
	}
}
console.log('[db] Pool config:', JSON.stringify(logSafeConfig, null, 2));

let totalQueries = 0;
let slowQueries = 0;
const SLOW_THRESHOLD_MS = 200;
const recentTimestamps = [];

const _origQuery = pool.query.bind(pool);
pool.query = async (...args) => {
	const MAX_RETRIES = 3;
	const RETRY_DELAY_MS = 2000;
	let lastError;

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			const start = Date.now();
			totalQueries++;
			recentTimestamps.push(start);
			if (recentTimestamps.length > 3000) {
				const cutoff = Date.now() - 300000;
				const idx = recentTimestamps.findIndex((t) => t >= cutoff);
				if (idx > 0) recentTimestamps.splice(0, idx);
			}
			const result = await _origQuery(...args);
			if (Date.now() - start > SLOW_THRESHOLD_MS) slowQueries++;
			return result;
		} catch (err) {
			lastError = err;
			const isConnectionError = err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === '08000' || err.code === '08006' || err.message?.includes('Connection terminated unexpectedly');
			if (isConnectionError && attempt < MAX_RETRIES) {
				console.warn(`[db] Connection error on attempt ${attempt}/${MAX_RETRIES}: ${err.message} (${err.code || 'NO_CODE'}). Retrying in ${RETRY_DELAY_MS}ms...`);
				await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
				continue;
			}
			throw err;
		}
	}
	throw lastError;
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
