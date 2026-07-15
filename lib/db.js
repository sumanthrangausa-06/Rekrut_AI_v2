const { Pool } = require('pg');
const { parse } = require('pg-connection-string');

// SSL configuration: enforce certificate verification in production or when explicitly requested.
// FORCE_SSL_VERIFY=false overrides everything (for Render PostgreSQL self-signed certs).
// In test environments (CI), disable SSL entirely since local PostgreSQL containers don't support it.
const sslConfig =
	process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'e2e'
		? false
		: process.env.FORCE_SSL_VERIFY === 'false'
		  ? { rejectUnauthorized: false }
		  : { rejectUnauthorized: true };

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

// Export poolConfig for diagnostic use in other modules
pool.poolConfig = poolConfig;

let totalQueries = 0;
let slowQueries = 0;
const SLOW_THRESHOLD_MS = 200;
const recentTimestamps = [];

const _origQuery = pool.query.bind(pool);
// Diagnostic info for troubleshooting
let lastConnectionError = null;
let lastConnectionSuccess = null;
let dbHost = 'unknown';
let dbName = 'unknown';
try {
	if (process.env.DATABASE_URL) {
		const parsed = parse(process.env.DATABASE_URL);
		dbHost = parsed.host || 'unknown';
		dbName = parsed.database || 'unknown';
	}
} catch (_e) {
	// ignore parse errors
}

// Render starter DBs suspend after 15min inactivity. First connection wakes them up
// but may be dropped. Use longer retry delay for Render environments.
const RENDER_RETRY_DELAY = process.env.RENDER ? 8000 : 2000;
const MAX_RETRIES = 3;

pool.query = async (...args) => {
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
			lastConnectionSuccess = Date.now();
			lastConnectionError = null;
			return result;
		} catch (err) {
			lastError = err;
			lastConnectionError = { message: err.message, code: err.code, time: Date.now() };
			const isConnectionError = err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === '08000' || err.code === '08006' || err.message?.includes('Connection terminated unexpectedly');
			if (isConnectionError && attempt < MAX_RETRIES) {
				console.warn(`[db] Connection error on attempt ${attempt}/${MAX_RETRIES}: ${err.message} (${err.code || 'NO_CODE'}). Retrying in ${RENDER_RETRY_DELAY}ms...`);
				await new Promise(resolve => setTimeout(resolve, RENDER_RETRY_DELAY));
				continue;
			}
			throw err;
		}
	}
	throw lastError;
};

pool.getDiagnosticInfo = () => ({
	host: dbHost,
	database: dbName,
	lastConnectionError,
	lastConnectionSuccess,
	poolStatus: {
		totalCount: pool.totalCount,
		idleCount: pool.idleCount,
		waitingCount: pool.waitingCount,
	},
	config: {
		max: pool.options.max,
		connectionTimeoutMillis: pool.options.connectionTimeoutMillis,
		idleTimeoutMillis: pool.options.idleTimeoutMillis,
	},
});

/**
 * Explicitly wake up a suspended Render starter DB.
 * Creates a dedicated client with longer timeout to allow DB to resume.
 */
pool.wake = async function wakeDB() {
	console.log('[db:wake] Attempting to wake DB...');
	const { Client } = require('pg');
	const wakeConfig = {
		...poolConfig,
		connectionTimeoutMillis: 45000, // 45s for Render starter DB wake
	};
	const client = new Client(wakeConfig);
	try {
		await client.connect();
		const result = await client.query('SELECT 1 as wake');
		await client.end();
		console.log('[db:wake] DB is awake:', result.rows[0]);
		lastConnectionSuccess = Date.now();
		lastConnectionError = null;
		return { success: true, latencyMs: Date.now() - (lastConnectionSuccess || Date.now()) };
	} catch (err) {
		console.error('[db:wake] Failed to wake DB:', err.message, err.code);
		try { await client.end(); } catch (_e) {}
		lastConnectionError = { message: err.message, code: err.code, time: Date.now() };
		return { success: false, error: 'Database wake failed', code: err.code };
	}
};

/**
 * Keepalive: ping DB every 5 minutes to prevent suspension on Render starter.
 * Only runs in production/staging environments.
 */
if (process.env.RENDER || process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
	const KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
	setInterval(async () => {
		try {
			await pool.query('SELECT 1 as keepalive');
			console.log('[db:keepalive] Ping successful');
		} catch (err) {
			console.warn('[db:keepalive] Ping failed:', err.message, err.code);
			// Try to wake the DB
			await pool.wake();
		}
	}, KEEPALIVE_INTERVAL_MS);
	console.log('[db] Keepalive enabled: pinging DB every', KEEPALIVE_INTERVAL_MS / 1000, 'seconds');
}

module.exports = pool;
