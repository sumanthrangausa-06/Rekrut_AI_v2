const pool = require('./db');

const REQUIRED_TABLES = [
	'users',
	'jobs',
	'events',
	'companies',
	'refresh_tokens',
	'user_sessions',
	'oauth_connections',
];

const REQUIRED_ENV = [
	{ key: 'DATABASE_URL', required: true },
	{ key: 'JWT_SECRET', required: true },
	{ key: 'SESSION_SECRET', required: true },
];

/**
 * Check if all required database tables exist
 */
async function checkTables() {
	const results = [];
	for (const table of REQUIRED_TABLES) {
		try {
			const result = await pool.query(
				`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
				[table],
			);
			results.push({
				table,
				exists: result.rows.length > 0,
			});
		} catch (_err) {
			results.push({
				table,
				exists: false,
				error: 'Database query failed',
			});
		}
	}
	return results;
}

/**
 * Check database connection health (fast, no retry, for health checks)
 */
async function checkConnectionFast() {
	const { Client } = require('pg');
	// Create a quick client with short timeout for health checks
	const poolConfig = pool.poolConfig || {};
	const fastConfig = {
		...poolConfig,
		connectionTimeoutMillis: 1500, // 1.5s max for health check
	};
	const client = new Client(fastConfig);
	try {
		await client.connect();
		const start = Date.now();
		const result = await client.query('SELECT 1 as test');
		await client.end();
		return {
			connected: true,
			latencyMs: Date.now() - start,
			result: result.rows[0],
		};
	} catch (err) {
		try {
			await client.end();
		} catch (_e) {}
		return {
			connected: false,
			error: 'Database connection failed',
			code: err.code,
		};
	}
}

/**
 * Check database connection health (full retry, for normal operations)
 */
async function checkConnection() {
	try {
		const start = Date.now();
		const result = await pool.query('SELECT 1 as test');
		const latency = Date.now() - start;
		return {
			connected: true,
			latencyMs: latency,
			result: result.rows[0],
		};
	} catch (err) {
		return {
			connected: false,
			error: 'Database connection failed',
			code: err.code,
		};
	}
}

/**
 * Check connection pool status
 */
function checkPool() {
	const poolStatus = {
		totalCount: pool.totalCount,
		idleCount: pool.idleCount,
		waitingCount: pool.waitingCount,
	};
	return poolStatus;
}

/**
 * Check environment variables
 */
function checkEnv() {
	return REQUIRED_ENV.map((env) => ({
		key: env.key,
		set: !!process.env[env.key],
		required: env.required,
	}));
}

/**
 * Run health checks with fast DB connection (for health endpoint — no retry, short timeout)
 */
async function runHealthCheckFast() {
	const [connection, tables, poolStatus, env] = await Promise.all([
		checkConnectionFast(),
		checkTables(),
		checkPool(),
		checkEnv(),
	]);

	const missingTables = tables.filter((t) => !t.exists);
	const missingEnv = env.filter((e) => e.required && !e.set);
	const healthy = connection.connected && missingTables.length === 0 && missingEnv.length === 0;

	return {
		healthy,
		connection,
		tables,
		pool: poolStatus,
		env,
		issues: {
			missingTables: missingTables.map((t) => t.table),
			missingEnv: missingEnv.map((e) => e.key),
			connectionError: connection.connected ? null : connection.error,
		},
	};
}

/**
 * Run all health checks (full retry, for diagnostics)
 */
async function runHealthCheck() {
	const [connection, tables, pool, env] = await Promise.all([
		checkConnection(),
		checkTables(),
		checkPool(),
		checkEnv(),
	]);

	const missingTables = tables.filter((t) => !t.exists);
	const missingEnv = env.filter((e) => e.required && !e.set);
	const healthy = connection.connected && missingTables.length === 0 && missingEnv.length === 0;

	return {
		healthy,
		connection,
		tables,
		pool,
		env,
		issues: {
			missingTables: missingTables.map((t) => t.table),
			missingEnv: missingEnv.map((e) => e.key),
			connectionError: connection.connected ? null : connection.error,
		},
	};
}

/**
 * Ensure the events table exists before inserting
 */
async function ensureEventsTable() {
	try {
		await pool.query('SELECT 1 FROM events LIMIT 1');
		return { exists: true };
	} catch (err) {
		if (err.code === '42P01') {
			console.warn('[db-health] events table does not exist. Event logging will be skipped.');
			return { exists: false, error: 'Table does not exist' };
		}
		throw err;
	}
}

module.exports = {
	checkTables,
	checkConnection,
	checkConnectionFast,
	checkPool,
	checkEnv,
	runHealthCheck,
	runHealthCheckFast,
	ensureEventsTable,
	REQUIRED_TABLES,
};
