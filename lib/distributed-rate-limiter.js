const pool = require('./db');

/**
 * Distributed Rate Limiting Middleware using PostgreSQL
 *
 * Replaces in-memory Maps with database-backed buckets for
 * multi-instance deployments (Render, etc.).
 *
 * Features:
 * - Per-endpoint + per-IP rate limiting
 * - Automatic cleanup of expired buckets (no manual GC needed)
 * - Configurable window and max requests
 * - Returns 429 with Retry-After header
 */

class DistributedRateLimiter {
	constructor(options = {}) {
		this.tableName = options.tableName || 'rate_limit_buckets';
		this.cleanupInterval = options.cleanupInterval || 60 * 1000; // 1 minute
		this._initialized = false;
		this._initPromise = null;
	}

	async _initTable() {
		if (this._initialized) return;
		if (this._initPromise) return this._initPromise;

		this._initPromise = (async () => {
			try {
				await pool.query(`
          CREATE TABLE IF NOT EXISTS ${this.tableName} (
            key TEXT PRIMARY KEY,
            count INTEGER NOT NULL DEFAULT 0,
            reset_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          )
        `);

				// Create index for fast cleanup queries
				await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_rate_limit_reset 
          ON ${this.tableName} (reset_at)
        `);

				this._initialized = true;
				console.log(`[rate-limiter] Distributed rate limit table '${this.tableName}' ready`);
			} catch (err) {
				console.error('[rate-limiter] Failed to init table:', err.message);
				// Don't throw - fall back to memory if DB fails
				this._initialized = false;
			}
		})();

		return this._initPromise;
	}

	async checkLimit(key, windowMs, max) {
		await this._initTable();

		const now = new Date();
		const resetAt = new Date(now.getTime() + windowMs);

		try {
			// Upsert: increment count if bucket exists and not expired, otherwise create new
			const result = await pool.query(
				`
        INSERT INTO ${this.tableName} (key, count, reset_at)
        VALUES ($1, 1, $2)
        ON CONFLICT (key) DO UPDATE SET
          count = CASE 
            WHEN ${this.tableName}.reset_at < NOW() THEN 1
            ELSE ${this.tableName}.count + 1
          END,
          reset_at = CASE 
            WHEN ${this.tableName}.reset_at < NOW() THEN $2
            ELSE ${this.tableName}.reset_at
          END
        RETURNING count, reset_at
      `,
				[key, resetAt],
			);

			const { count, reset_at } = result.rows[0];
			const isAllowed = count <= max;
			const retryAfter = Math.ceil((new Date(reset_at) - now) / 1000);

			return { allowed: isAllowed, count, retryAfter, resetAt: reset_at };
		} catch (err) {
			console.error('[rate-limiter] DB error:', err.message);
			// Fail open if DB is down - don't block requests
			return { allowed: true, count: 0, retryAfter: 0, resetAt: now };
		}
	}

	async cleanup() {
		if (!this._initialized) return;

		try {
			const result = await pool.query(`
        DELETE FROM ${this.tableName} 
        WHERE reset_at < NOW() - INTERVAL '5 minutes'
      `);
			if (result.rowCount > 0) {
				console.log(`[rate-limiter] Cleaned up ${result.rowCount} expired buckets`);
			}
		} catch (err) {
			console.error('[rate-limiter] Cleanup error:', err.message);
		}
	}

	startCleanup(intervalMs = this.cleanupInterval) {
		// Run cleanup periodically
		setInterval(() => this.cleanup(), intervalMs);
		console.log(`[rate-limiter] Cleanup scheduled every ${intervalMs}ms`);
	}
}

// Singleton instance
const distributedRateLimiter = new DistributedRateLimiter();

// Middleware factory
function createRateLimit({ windowMs = 15 * 60 * 1000, max = 100, keyPrefix = 'rl' }) {
	return async (req, res, next) => {
		// Skip rate limiting in test/e2e environments
		if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'e2e') {
			return next();
		}
		const ip =
			req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
			req.ip ||
			req.socket?.remoteAddress ||
			'unknown';
		const path = req.route?.path || req.path;
		const key = `${keyPrefix}:${req.method}:${path}:${ip}`;

		const result = await distributedRateLimiter.checkLimit(key, windowMs, max);

		res.setHeader('X-RateLimit-Limit', max);
		res.setHeader('X-RateLimit-Remaining', Math.max(0, max - result.count));
		res.setHeader('X-RateLimit-Reset', Math.ceil(new Date(result.resetAt).getTime() / 1000));

		if (!result.allowed) {
			res.setHeader('Retry-After', result.retryAfter);
			return res.status(429).json({
				error: 'Too many requests',
				retryAfter: result.retryAfter,
				message: `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
			});
		}

		next();
	};
}

// Specific rate limit presets
const rateLimits = {
	// Strict: login, password reset, etc.
	strict: createRateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'strict' }),
	// Standard: general API endpoints
	standard: createRateLimit({ windowMs: 60 * 1000, max: 60, keyPrefix: 'standard' }),
	// Relaxed: AI endpoints (expensive)
	ai: createRateLimit({ windowMs: 60 * 1000, max: 10, keyPrefix: 'ai' }),
	// Very strict: admin endpoints
	admin: createRateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'admin' }),
	// Generous: public/read endpoints
	public: createRateLimit({ windowMs: 60 * 1000, max: 120, keyPrefix: 'public' }),
};

module.exports = {
	DistributedRateLimiter,
	distributedRateLimiter,
	createRateLimit,
	rateLimits,
};
