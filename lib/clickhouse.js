const { createClient } = require('@clickhouse/client');

/**
 * ClickHouse Analytics Client
 *
 * Provides a lazy-initialized ClickHouse client for analytics queries.
 * Gracefully degrades when CLICKHOUSE_URL is not configured.
 *
 * Design: singleton pattern with on-demand creation. If the URL is missing
 * or the client fails to connect, all operations return safe fallbacks so
 * the application continues to work with PostgreSQL only.
 */

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL;

let _client = null;
let _clientReady = false;
let _lastHealthCheck = null;

/**
 * Create and return the ClickHouse client.
 * Returns null if CLICKHOUSE_URL is not configured.
 */
function getClient() {
	if (!CLICKHOUSE_URL) {
		return null;
	}

	if (_client) {
		return _client;
	}

	try {
		_client = createClient({
			url: CLICKHOUSE_URL,
			request_timeout: 30000,
			max_open_connections: 10,
		});

		console.log('[clickhouse] Client initialized');
		return _client;
	} catch (err) {
		console.error('[clickhouse] Failed to initialize client:', err.message);
		_client = null;
		return null;
	}
}

/**
 * Check if ClickHouse is configured and reachable.
 * Caches the result for 30 seconds to avoid hammering the health endpoint.
 */
async function isHealthy() {
	if (!CLICKHOUSE_URL) {
		return false;
	}

	// Cache health check for 30s
	if (_lastHealthCheck && Date.now() - _lastHealthCheck.time < 30000) {
		return _lastHealthCheck.healthy;
	}

	const client = getClient();
	if (!client) {
		_lastHealthCheck = { healthy: false, time: Date.now() };
		return false;
	}

	try {
		const result = await client.query({
			query: 'SELECT 1',
			format: 'JSONEachRow',
		});
		const rows = await result.json();
		const healthy = rows.length > 0 && rows[0]['1'] === 1;
		_lastHealthCheck = { healthy, time: Date.now() };

		if (healthy && !_clientReady) {
			_clientReady = true;
			console.log('[clickhouse] Health check passed — analytics store online');
		}

		return healthy;
	} catch (err) {
		console.warn('[clickhouse] Health check failed:', err.message);
		_lastHealthCheck = { healthy: false, time: Date.now() };
		return false;
	}
}

/**
 * Run a query against ClickHouse with automatic fallback.
 * If ClickHouse is unavailable, returns null (caller should fall back to PostgreSQL).
 */
async function query(options) {
	const client = getClient();
	if (!client) {
		return null;
	}

	try {
		const result = await client.query(options);
		return result;
	} catch (err) {
		console.error('[clickhouse] Query failed:', err.message);
		// Reset client on connection errors so next call re-initializes
		if (err.message?.includes('ECONNREFUSED') || err.message?.includes('socket hang up')) {
			_client = null;
			_lastHealthCheck = null;
		}
		return null;
	}
}

/**
 * Run an insert against ClickHouse.
 * Returns { success: boolean, error?: string }
 */
async function insert(table, values, format = 'JSONEachRow') {
	const client = getClient();
	if (!client) {
		return { success: false, error: 'ClickHouse not configured' };
	}

	try {
		await client.insert({
			table,
			values,
			format,
		});
		return { success: true };
	} catch (err) {
		console.error(`[clickhouse] Insert into ${table} failed:`, err.message);
		if (err.message?.includes('ECONNREFUSED') || err.message?.includes('socket hang up')) {
			_client = null;
			_lastHealthCheck = null;
		}
		return { success: false, error: err.message };
	}
}

/**
 * Execute a DDL/command query (CREATE, etc.)
 */
async function exec(queryString) {
	const client = getClient();
	if (!client) {
		return { success: false, error: 'ClickHouse not configured' };
	}

	try {
		await client.command({ query: queryString });
		return { success: true };
	} catch (err) {
		console.error('[clickhouse] Command failed:', err.message);
		if (err.message?.includes('ECONNREFUSED') || err.message?.includes('socket hang up')) {
			_client = null;
			_lastHealthCheck = null;
		}
		return { success: false, error: err.message };
	}
}

/**
 * Close the ClickHouse client connection.
 */
async function close() {
	if (_client) {
		try {
			await _client.close();
		} catch (_err) {
			// ignore
		}
		_client = null;
		_clientReady = false;
		_lastHealthCheck = null;
	}
}

/**
 * Get ClickHouse diagnostic info for health checks.
 */
function getDiagnosticInfo() {
	return {
		configured: !!CLICKHOUSE_URL,
		ready: _clientReady,
		lastHealthCheck: _lastHealthCheck,
	};
}

module.exports = {
	getClient,
	isHealthy,
	query,
	insert,
	exec,
	close,
	getDiagnosticInfo,
};
