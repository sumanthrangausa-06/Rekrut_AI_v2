/**
 * #1152 (residual) — GET /api/admin/modules `matching.mutualMatches` fake 0.
 *
 * The handler counted `mutual_matches`, a table with ZERO writers anywhere
 * in the repo: mutual fit is computed live per-candidate in
 * routes/omniscore.js (/mutual-matches), so there is no stored total and
 * the count was permanently 0 — displayed by the admin UI
 * (client/src/pages/admin/ai-health.tsx, Matching card) as a real
 * "Mutual" count.
 *
 * Honest contract (same pattern as avgMatchScore in the same payload):
 * `mutualMatches` is null (UI renders 'N/A'), the dead table is never
 * queried, and the sibling matching fields — backed by the real
 * `match_results` table — still return real numbers.
 *
 * Harness: the REAL server app (same pattern as csrf-401-1328.test.js).
 * The shared test DB mock (server/test/setup.js) returns empty results
 * for the express-session store table (user_sessions), so sessions
 * cannot persist between requests; this file gives ONLY the
 * user_sessions queries an in-memory store, routes match_results /
 * mutual_matches to canned pg-shaped rows, and delegates every other
 * query to the shared mock unchanged. Admin auth is the real env-admin
 * login (POST /api/admin/login) with a test-only ADMIN_PASSWORD set
 * before the server module loads.
 */
const request = require('supertest');

process.env.ADMIN_PASSWORD = 'Nova1152-Test!Pass';
process.env.ADMIN_USERNAME = 'admin';

const pool = require('../../../lib/db');
const sharedImpl = pool.query.getMockImplementation();

const queries = [];
const sessionRows = new Map();

pool.query.mockImplementation(async (sql, params = []) => {
	const text = String(sql);
	queries.push(text);
	const normalized = text.toLowerCase().replace(/\s+/g, ' ');

	// express-session store (connect-pg-simple, table user_sessions) —
	// in-memory, exactly as csrf-401-1328.test.js.
	if (normalized.includes('user_sessions')) {
		if (normalized.startsWith('select sess')) {
			const sess = sessionRows.get(params[0]);
			return sess ? { rows: [{ sess }], rowCount: 1 } : { rows: [], rowCount: 0 };
		}
		if (normalized.startsWith('insert into')) {
			// INSERT (sess, expire, sid) SELECT $1, ..., $3
			sessionRows.set(params[2], params[0]);
			return { rows: [{ sid: params[2] }], rowCount: 1 };
		}
		if (normalized.startsWith('delete from')) {
			sessionRows.delete(params[0]);
			return { rows: [], rowCount: 0 };
		}
		return { rows: [{ sid: params[1] }], rowCount: 1 };
	}

	// Matching domain: match_results has real rows; mutual_matches is the
	// dead table (zero writers) whose count was always 0.
	if (/from match_results/i.test(text)) {
		return { rows: [{ total: '7', avg_score: '82.5', this_week: '3' }], rowCount: 1 };
	}
	if (/from mutual_matches/i.test(text)) {
		return { rows: [{ total: '0' }], rowCount: 1 };
	}

	return sharedImpl(sql, params);
});

const app = require('../../../server');

function csrfFromCookies(res) {
	const cookies = res.headers['set-cookie'] || [];
	const joined = Array.isArray(cookies) ? cookies.join(';') : cookies;
	const m = /_csrf=([^;]+)/.exec(joined);
	return m ? decodeURIComponent(m[1]) : null;
}

async function adminAgent() {
	const agent = request.agent(app);
	// Admin credentials hash is built asynchronously at module load;
	// retry the login until it is ready (503) instead of racing it.
	for (let attempt = 0; attempt < 20; attempt++) {
		const tokenRes = await agent.get('/csrf-token');
		const token = tokenRes.body.csrfToken || csrfFromCookies(tokenRes);
		expect(token).toBeTruthy();
		const login = await agent
			.post('/api/admin/login')
			.set('X-CSRF-Token', token)
			.send({ username: 'admin', password: 'Nova1152-Test!Pass' });
		if (login.status === 200) return agent;
		if (login.status !== 503) {
			throw new Error(`admin login failed: ${login.status} ${JSON.stringify(login.body)}`);
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error('admin login never became ready (503)');
}

describe('#1152 GET /api/admin/modules — matching.mutualMatches honesty', () => {
	test('mutualMatches is null (not 0), siblings return real numbers, dead table not queried', async () => {
		const agent = await adminAgent();
		queries.length = 0;
		const res = await agent.get('/api/admin/modules');
		expect(res.status).toBe(200);
		expect(res.body.matching).toBeDefined();
		expect(res.body.matching.mutualMatches).toBeNull();
		expect(res.body.matching.totalMatches).toBe(7);
		expect(res.body.matching.avgMatchScore).toBe(82.5);
		expect(res.body.matching.matchesThisWeek).toBe(3);
		expect(queries.some((q) => /from mutual_matches/i.test(q))).toBe(false);
	});

	test('unauthenticated request is rejected (negative control)', async () => {
		const res = await request(app).get('/api/admin/modules');
		expect(res.status).toBe(401);
	});
});
