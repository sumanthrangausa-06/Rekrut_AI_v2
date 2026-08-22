/**
 * Analytics Cache — In-memory TTL cache for query result optimization
 * Issue #143 — PostgreSQL Analytics Optimization
 *
 * Features:
 *  - TTL-based eviction (default 5 minutes for analytics)
 *  - Key generation from endpoint + query params
 *  - Manual invalidation by pattern
 *  - Hit/miss counters for /health/analytics
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

class AnalyticsCache {
	constructor() {
		this._store = new Map();
		this._timers = new Map();
		this._hits = 0;
		this._misses = 0;
		this._invalidations = 0;
	}

	/**
	 * Generate a cache key from endpoint path and query parameters.
	 * Normalises query object to ensure stable keys regardless of param order.
	 */
	static key(endpoint, query = {}) {
		const sorted = Object.keys(query)
			.sort()
			.map((k) => `${k}=${query[k]}`)
			.join('&');
		return sorted ? `${endpoint}?${sorted}` : endpoint;
	}

	/** Instance wrapper — callers use analyticsCache.key(...) not AnalyticsCache.key(...) */
	key(endpoint, query = {}) {
		return AnalyticsCache.key(endpoint, query);
	}

	/**
	 * Get a cached value. Returns undefined if miss or expired.
	 */
	get(key) {
		const entry = this._store.get(key);
		if (!entry) {
			this._misses++;
			return undefined;
		}
		if (Date.now() > entry.expiresAt) {
			this.del(key);
			this._misses++;
			return undefined;
		}
		this._hits++;
		return entry.value;
	}

	/**
	 * Store a value with optional TTL (ms).
	 */
	set(key, value, ttlMs = DEFAULT_TTL_MS) {
		// Clear existing timer if any
		if (this._timers.has(key)) {
			clearTimeout(this._timers.get(key));
		}

		const expiresAt = Date.now() + ttlMs;
		this._store.set(key, { value, expiresAt });

		const timer = setTimeout(() => {
			this.del(key);
		}, ttlMs);
		this._timers.set(key, timer);
	}

	/**
	 * Delete a specific key.
	 */
	del(key) {
		if (this._timers.has(key)) {
			clearTimeout(this._timers.get(key));
			this._timers.delete(key);
		}
		return this._store.delete(key);
	}

	/**
	 * Invalidate all keys matching a substring pattern.
	 * Used after mutations (e.g., new job application, status change).
	 */
	invalidate(pattern) {
		let count = 0;
		for (const key of this._store.keys()) {
			if (key.includes(pattern)) {
				this.del(key);
				count++;
			}
		}
		this._invalidations += count;
		return count;
	}

	/**
	 * Bulk invalidate by multiple patterns.
	 */
	invalidatePatterns(patterns) {
		let total = 0;
		for (const p of patterns) {
			total += this.invalidate(p);
		}
		return total;
	}

	/**
	 * Get stats for /health/analytics endpoint.
	 */
	stats() {
		const total = this._hits + this._misses;
		return {
			hits: this._hits,
			misses: this._misses,
			cacheHitRate: total > 0 ? +(this._hits / total).toFixed(4) : 0,
			keys: this._store.size,
			invalidations: this._invalidations,
		};
	}

	/**
	 * Clear entire cache.
	 */
	clear() {
		for (const timer of this._timers.values()) {
			clearTimeout(timer);
		}
		this._timers.clear();
		this._store.clear();
		this._hits = 0;
		this._misses = 0;
		this._invalidations = 0;
	}
}

// Singleton instance shared across the app
const analyticsCache = new AnalyticsCache();
module.exports = { AnalyticsCache, analyticsCache };
