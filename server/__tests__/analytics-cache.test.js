/**
 * @jest-environment node
 */

/**
 * AnalyticsCache unit tests — Issue #186 fix
 * Verifies that key() works as an instance method (was incorrectly static)
 */

const { AnalyticsCache, analyticsCache } = require('../../lib/analytics-cache');

describe('AnalyticsCache', () => {
	afterEach(() => {
		analyticsCache.clear();
	});

	describe('key generation', () => {
		it('should generate consistent keys from endpoint + query params (instance method)', () => {
			// This reproduces Issue #186: analyticsCache.key is not a function
			const cache = new AnalyticsCache();
			expect(() => cache.key('/api/recruiter/dashboard', { companyId: 42, days: 30 })).not.toThrow();
			expect(typeof cache.key).toBe('function');
		});

		it('should generate the same key regardless of param order', () => {
			const cache = new AnalyticsCache();
			const key1 = cache.key('/api/test', { a: 1, b: 2 });
			const key2 = cache.key('/api/test', { b: 2, a: 1 });
			expect(key1).toBe(key2);
		});

		it('should return endpoint only when query is empty', () => {
			const cache = new AnalyticsCache();
			expect(cache.key('/api/test', {})).toBe('/api/test');
			expect(cache.key('/api/test')).toBe('/api/test');
		});

		it('should include sorted query params in key', () => {
			const cache = new AnalyticsCache();
			const key = cache.key('/api/test', { z: 9, a: 1 });
			expect(key).toBe('/api/test?a=1&z=9');
		});
	});

	describe('singleton instance (analyticsCache)', () => {
		it('should have key() available on the exported singleton (Issue #186)', () => {
			// This is the exact failure from recruiter.js:120
			expect(typeof analyticsCache.key).toBe('function');
			const cacheKey = analyticsCache.key('/api/recruiter/dashboard', { companyId: 42, days: 30 });
			expect(cacheKey).toBe('/api/recruiter/dashboard?companyId=42&days=30');
		});
	});

	describe('get/set/clear', () => {
		it('should store and retrieve values', () => {
			const cache = new AnalyticsCache();
			const key = cache.key('/api/test', { id: 1 });
			cache.set(key, { data: 'hello' });
			expect(cache.get(key)).toEqual({ data: 'hello' });
		});

		it('should return undefined for missing keys', () => {
			const cache = new AnalyticsCache();
			expect(cache.get('/missing')).toBeUndefined();
		});

		it('should expire entries after TTL', async () => {
			const cache = new AnalyticsCache();
			const key = cache.key('/api/test', {});
			cache.set(key, 'value', 50); // 50ms TTL
			expect(cache.get(key)).toBe('value');
			await new Promise((r) => setTimeout(r, 100));
			expect(cache.get(key)).toBeUndefined();
		});
	});

	describe('invalidation', () => {
		it('should invalidate by pattern', () => {
			const cache = new AnalyticsCache();
			cache.set(cache.key('/api/a', {}), 1);
			cache.set(cache.key('/api/b', {}), 2);
			cache.set(cache.key('/other', {}), 3);
			expect(cache.invalidate('/api/')).toBe(2);
			expect(cache.get(cache.key('/api/a', {}))).toBeUndefined();
			expect(cache.get(cache.key('/other', {}))).toBe(3);
		});
	});

	describe('stats', () => {
		it('should track hits and misses', () => {
			const cache = new AnalyticsCache();
			const key = cache.key('/api/test', {});
			cache.get(key); // miss
			cache.set(key, 'value');
			cache.get(key); // hit
			const stats = cache.stats();
			expect(stats.hits).toBe(1);
			expect(stats.misses).toBe(1);
			expect(stats.cacheHitRate).toBe(0.5);
		});
	});
});
