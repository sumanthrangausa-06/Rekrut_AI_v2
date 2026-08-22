/**
 * Query Profiler — Slow query logging and execution timing
 * Issue #143 — PostgreSQL Analytics Optimization
 *
 * Wraps db.query to log queries exceeding a configurable threshold (default 2s).
 * Tracks slow query count for /health/analytics.
 */

const pool = require('./db');

const SLOW_QUERY_THRESHOLD_MS = 2000;

class QueryProfiler {
	constructor(thresholdMs = SLOW_QUERY_THRESHOLD_MS) {
		this._slowQueries = [];
		this._thresholdMs = thresholdMs;
		this._totalQueries = 0;
		this._slowQueryCount = 0;
		this._originalQuery = null;
	}

	/**
	 * Install the profiler by monkey-patching pool.query.
	 * Call once during server startup.
	 */
	install() {
		if (this._originalQuery) {
			return; // Already installed
		}

		this._originalQuery = pool.query.bind(pool);
		const profiler = this;

		pool.query = async function (text, values) {
			const start = Date.now();
			profiler._totalQueries++;
			try {
				const result = await profiler._originalQuery(text, values);
				const elapsed = Date.now() - start;
				if (elapsed > profiler._thresholdMs) {
					profiler._recordSlow(text, elapsed);
				}
				return result;
			} catch (err) {
				const elapsed = Date.now() - start;
				if (elapsed > profiler._thresholdMs) {
					profiler._recordSlow(text, elapsed, err.message);
				}
				throw err;
			}
		};
	}

	/**
	 * Uninstall the profiler and restore original pool.query.
	 */
	uninstall() {
		if (this._originalQuery) {
			pool.query = this._originalQuery;
			this._originalQuery = null;
		}
	}

	_recordSlow(text, elapsedMs, errorMessage) {
		this._slowQueryCount++;
		const entry = {
			timestamp: new Date().toISOString(),
			query: typeof text === 'string' ? text : text.text || String(text),
			elapsedMs,
			...(errorMessage ? { error: errorMessage } : {}),
		};

		// Keep a rolling window of last 100 slow queries
		this._slowQueries.push(entry);
		if (this._slowQueries.length > 100) {
			this._slowQueries.shift();
		}

		console.warn(
			`[SLOW QUERY] ${elapsedMs}ms — ${entry.query.slice(0, 200)}${entry.query.length > 200 ? '...' : ''}`,
		);
	}

	/**
	 * Get stats for /health/analytics endpoint.
	 */
	stats() {
		return {
			totalQueries: this._totalQueries,
			slowQueryCount: this._slowQueryCount,
			slowQueryThresholdMs: this._thresholdMs,
			recentSlowQueries: this._slowQueries.slice(-10),
		};
	}

	reset() {
		this._slowQueries = [];
		this._totalQueries = 0;
		this._slowQueryCount = 0;
	}
}

const queryProfiler = new QueryProfiler();
module.exports = { QueryProfiler, queryProfiler };
