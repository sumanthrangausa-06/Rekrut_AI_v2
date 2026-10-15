/**
 * #105 — login latency regression tests.
 *
 * Root cause (measured, see #105): POST /api/auth/login spent ~99% of its
 * time in bcryptjs.compare because every stored hash was minted at cost 13
 * (bcryptjs is pure JS: cost 13 ≈ 1.27s vs cost 12 ≈ 0.51s on the bench VM).
 * Verify time follows the STORED hash's cost, so the fix is:
 *   (a) mint new hashes at BCRYPT_COST (12) via one shared helper, and
 *   (b) opportunistic rehash-on-login: a successful login rewrites a stored
 *       hash whose cost differs from BCRYPT_COST (security review C-2).
 *
 * The DB pool is mocked by server/test/setup.js, but bcrypt is REAL in this
 * harness — the dominant segment is genuinely exercised.
 *
 * RED on pre-fix code: register mints $2a$13$ (not $2a$12$), a cost-13 hash
 * is never rewritten at login, and no rehash failure log exists.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../../server');
const pool = require('../../../lib/db');

const PASSWORD = 'PerfTest1!x';

/** The password_hash param of the most recent INSERT/UPDATE users call. */
function lastMintedHash() {
	const calls = pool.query.mock.calls;
	for (let i = calls.length - 1; i >= 0; i--) {
		const [sql, params] = calls[i];
		const s = String(sql).toLowerCase();
		if (params && (s.includes('insert into users') || s.includes('set password_hash'))) {
			const hash = params.find((p) => typeof p === 'string' && p.startsWith('$2'));
			if (hash) return hash;
		}
	}
	return null;
}

function hashCost(hash) {
	return Number(hash.split('$')[2]);
}

async function registerUser(email) {
	const res = await request(app)
		.post('/api/auth/register')
		.send({ email, password: PASSWORD, name: 'Perf User', role: 'candidate' });
	expect(res.status).toBe(201);
	return res.body.user.id;
}

/** Replace the stored hash with a genuine legacy cost-13 hash. */
async function downgradeToCost13(userId) {
	const legacyHash = await bcrypt.hash(PASSWORD, 13);
	await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [legacyHash, userId]);
}

describe('#105 login latency', () => {
	jest.setTimeout(60000);

	beforeEach(() => {
		pool.query.mockClear();
	});

	it('register mints the password hash at cost 12, not 13', async () => {
		await registerUser('perf-mint@example.com');
		const hash = lastMintedHash();
		expect(hash).toBeTruthy();
		expect(hashCost(hash)).toBe(12);
	});

	it('login rewrites a stored cost-13 hash to cost 12 (rehash-on-login)', async () => {
		const email = 'perf-rehash@example.com';
		const userId = await registerUser(email);
		await downgradeToCost13(userId);
		pool.query.mockClear();

		const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
		expect(res.status).toBe(200);

		const rewritten = lastMintedHash();
		expect(rewritten).toBeTruthy();
		expect(hashCost(rewritten)).toBe(12);
	});

	it('two concurrent logins for a cost-13 user both succeed and converge the hash', async () => {
		const email = 'perf-concurrent@example.com';
		const userId = await registerUser(email);
		await downgradeToCost13(userId);
		pool.query.mockClear();

		const [r1, r2] = await Promise.all([
			request(app).post('/api/auth/login').send({ email, password: PASSWORD }),
			request(app).post('/api/auth/login').send({ email, password: PASSWORD }),
		]);
		expect(r1.status).toBe(200);
		expect(r2.status).toBe(200);

		// At least one converging rewrite to cost 12 was issued…
		const rewritten = lastMintedHash();
		expect(rewritten).toBeTruthy();
		expect(hashCost(rewritten)).toBe(12);
		// …and the final stored hash still verifies (no torn state).
		const r3 = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
		expect(r3.status).toBe(200);
	});

	it('a failing rehash update does not fail the login, and the failure is logged', async () => {
		const email = 'perf-rehashfail@example.com';
		const userId = await registerUser(email);
		await downgradeToCost13(userId);

		const originalImpl = pool.query.getMockImplementation();
		pool.query.mockImplementation(async (sql, params) => {
			if (String(sql).toLowerCase().includes('update users set password_hash')) {
				throw new Error('simulated rehash write failure');
			}
			return originalImpl(sql, params);
		});
		const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
			expect(res.status).toBe(200);
			expect(res.body.token).toBeTruthy();
			const logged = errSpy.mock.calls.some((args) =>
				args.some((a) => typeof a === 'string' && a.includes('[auth] rehash-on-login failed')),
			);
			expect(logged).toBe(true);
		} finally {
			pool.query.mockImplementation(originalImpl);
			errSpy.mockRestore();
		}
	});

	it('a failing rehash AND a throwing failure-logger still do not fail the login (F-1)', async () => {
		const email = 'perf-rehashlogfail@example.com';
		const userId = await registerUser(email);
		await downgradeToCost13(userId);

		const originalImpl = pool.query.getMockImplementation();
		pool.query.mockImplementation(async (sql, params) => {
			if (String(sql).toLowerCase().includes('update users set password_hash')) {
				throw new Error('simulated rehash write failure');
			}
			return originalImpl(sql, params);
		});
		const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {
			throw new Error('simulated logger failure');
		});
		try {
			const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
			expect(res.status).toBe(200);
			expect(res.body.token).toBeTruthy();
		} finally {
			pool.query.mockImplementation(originalImpl);
			errSpy.mockRestore();
		}
	});

	it('POST /api/auth/login for a converged (cost-12) user completes within the 2s budget', async () => {
		const email = 'perf-budget@example.com';
		await registerUser(email);
		// First login converges the hash if it is not already at cost 12.
		const first = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
		expect(first.status).toBe(200);

		const start = Date.now();
		const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
		const elapsed = Date.now() - start;
		expect(res.status).toBe(200);
		// AC budget: post-auth redirect < 2s at p95. The POST is the server
		// share of the redirect; bench expectation post-fix ≈ 0.55s.
		expect(elapsed).toBeLessThan(2000);
	});
});
