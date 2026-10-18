/**
 * #1328: Unauthenticated POSTs return 403 CSRF_INVALID instead of 401.
 *
 * Global CSRF middleware (server.js) runs before route auth, so a
 * credential-less POST to a protected route was rejected as a CSRF
 * failure before authMiddleware could return its 401. These tests run
 * against the REAL server app (same harness as auth.test.js) — the real
 * middleware stack, not a mocked layer.
 *
 * Convention after the fix (global layer only):
 *  - no credential of any kind + CSRF failure + protected route -> 401
 *  - credentialed (session token / admin session / API key / webhook
 *    signature) + CSRF failure -> 403 CSRF_INVALID (unchanged)
 *  - credentialed + valid CSRF -> passes (unchanged)
 *  - preserved public entry points keep today's 403 on CSRF failure
 *  - CSRF-exempt public endpoints (login/register/exchange) unchanged
 */
const request = require('supertest');

// The shared test DB mock (server/test/setup.js) returns empty results for
// the express-session store table (user_sessions), so sessions cannot
// persist between requests in ANY real-server test — which is why the
// existing suites authenticate with Bearer tokens only. Session-cookie
// auth is one of the credential forms this issue is about, so this file
// gives ONLY the user_sessions queries an in-memory store and delegates
// every other query to the shared mock unchanged. The session, CSRF and
// auth middleware under test are the real ones.
const pool = require('../../../lib/db');
const sharedImpl = pool.query.getMockImplementation();
const sessionRows = new Map();
pool.query.mockImplementation(async (sql, params = []) => {
	const normalized = String(sql).toLowerCase().replace(/\s+/g, ' ');
	if (normalized.includes('user_sessions')) {
		if (normalized.startsWith('select sess')) {
			const sess = sessionRows.get(params[0]);
			return sess ? { rows: [{ sess }], rowCount: 1 } : { rows: [], rowCount: 0 };
		}
		if (normalized.startsWith('insert into')) {
			sessionRows.set(params[2], params[0]);
			return { rows: [{ sid: params[2] }], rowCount: 1 };
		}
		if (normalized.startsWith('delete from')) {
			sessionRows.delete(params[0]);
			return { rows: [], rowCount: 0 };
		}
		// UPDATE (touch) and anything else: succeed without state change.
		return { rows: [{ sid: params[1] }], rowCount: 1 };
	}
	return sharedImpl(sql, params);
});

const app = require('../../../server');

const PW = 'Password123!';

function csrfFromCookies(res) {
	const cookies = res.headers['set-cookie'] || [];
	const joined = Array.isArray(cookies) ? cookies.join(';') : cookies;
	const m = /_csrf=([^;]+)/.exec(joined);
	return m ? decodeURIComponent(m[1]) : null;
}

async function registerAndLoginAgent(email) {
	const agent = request.agent(app);
	await agent.post('/api/auth/register').send({
		email,
		password: PW,
		name: 'CSRF 1328 Test',
		role: 'candidate',
	});
	const login = await agent.post('/api/auth/login').send({ email, password: PW });
	expect(login.status).toBe(200);
	return { agent, login };
}

describe('#1328 unauthenticated POST -> 401, not 403 CSRF_INVALID', () => {
	it('POST /api/compliance/bias/analyze/:jobId with no credentials and no CSRF -> 401 AUTH_REQUIRED', async () => {
		const res = await request(app)
			.post('/api/compliance/bias/analyze/123')
			.send({ jobDescription: 'x' });
		expect(res.status).toBe(401);
		expect(res.body.code).toBe('AUTH_REQUIRED');
	});

	it('POST /api/auth/password with no credentials and no CSRF -> 401 (was 403)', async () => {
		const res = await request(app)
			.post('/api/auth/password')
			.send({ currentPassword: PW, newPassword: 'NewPass123!' });
		expect(res.status).toBe(401);
		expect(res.body.code).toBe('AUTH_REQUIRED');
	});

	it('session-authenticated POST with missing CSRF header -> still 403 CSRF_INVALID', async () => {
		const { agent } = await registerAndLoginAgent('csrf1328-badcsrf@example.com');
		// Agent carries the session cookie and the _csrf cookie, but no
		// X-CSRF-Token header is sent: CSRF validation must still fail 403.
		const res = await agent
			.post('/api/auth/password')
			.send({ currentPassword: PW, newPassword: 'NewPass123!' });
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('CSRF_INVALID');
	});

	it('session-authenticated POST with valid CSRF -> passes CSRF and reaches the route', async () => {
		const { agent } = await registerAndLoginAgent('csrf1328-goodcsrf@example.com');
		// Same flow the frontend uses: GET /csrf-token returns the cookie token.
		const tokenRes = await agent.get('/csrf-token');
		const token = tokenRes.body.csrfToken || csrfFromCookies(tokenRes);
		expect(token).toBeTruthy();
		const res = await agent
			.post('/api/auth/password')
			.set('X-CSRF-Token', token)
			.send({ currentPassword: PW, newPassword: 'NewPass123!' });
		expect(res.status).toBe(200);
	});

	it('API-key credentialed POST with no CSRF -> still 403 CSRF_INVALID (not reclassified as unauthenticated)', async () => {
		const res = await request(app)
			.post('/api/compliance/bias/analyze/123')
			.set('X-API-Key', 'some-api-key')
			.send({});
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('CSRF_INVALID');
	});

	it('POST /api/billing/cancel-subscription with no credentials and no CSRF -> 401 (protected route: its handler 401-gates on req.user; reviewer finding on #1328)', async () => {
		const res = await request(app).post('/api/billing/cancel-subscription').send({});
		expect(res.status).toBe(401);
		expect(res.body.code).toBe('AUTH_REQUIRED');
	});

	it('preserved public entry point: POST /api/auth/forgot-password with no CSRF -> still 403 CSRF_INVALID', async () => {
		const res = await request(app)
			.post('/api/auth/forgot-password')
			.send({ email: 'nobody@example.com' });
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('CSRF_INVALID');
	});

	it('preserved public entry point: POST /api/billing/webhook with Stripe signature and no CSRF -> still 403 CSRF_INVALID', async () => {
		const res = await request(app)
			.post('/api/billing/webhook')
			.set('stripe-signature', 't=1,v1=abc')
			.send({ id: 'evt_1' });
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('CSRF_INVALID');
	});

	it('CSRF-exempt login is unchanged: POST /api/auth/login with no CSRF reaches the handler (401 for bad password)', async () => {
		await request(app).post('/api/auth/register').send({
			email: 'csrf1328-login@example.com',
			password: PW,
			name: 'CSRF Login',
			role: 'candidate',
		});
		const res = await request(app)
			.post('/api/auth/login')
			.send({ email: 'csrf1328-login@example.com', password: 'WrongPass123!' });
		expect(res.status).toBe(401);
		expect(res.body.code).not.toBe('CSRF_INVALID');
	});
});
