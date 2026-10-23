/**
 * #1728b — recruiter-introductions cached-fallback gate must not act on
 * a renormalised cached match score.
 *
 * Both cached-fallback blocks in routes/recruiter-introductions.js
 * (engine-error catch; engine-unavailable else) SELECT only
 * weighted_score from match_results and gate `fitScore >= 70`. A cached
 * weighted_score whose basis was renormalised over measured components
 * only — either at-match column NULL, per #1717/#1724 semantics
 * (omniscore_at_match / trustscore_at_match) — is indistinguishable
 * from a fully-measured score at that gate, so the fallback could
 * grant a Top-5 introduction on partial evidence.
 *
 * Honest behaviour (STOP 1, issue #1728):
 *  J1 renormalised cached row (one at-match NULL, weighted 85):
 *     fallback refuses with a distinct error — HTTP 403, code
 *     INSUFFICIENT_DATA — no introduction row, no quota consumed.
 *     Both fallback blocks are exercised (catch + else).
 *  J2 fully-measured cached row (both at-match non-NULL, weighted 85):
 *     gate passes as today, introduction created, quota consumed.
 *     Both fallback blocks are exercised.
 *  J3 fully-measured cached row weighted 50: NOT_TOP_FIVE as today.
 *  J4 NULL weighted_score: unchanged S-11 behaviour (NOT_TOP_FIVE).
 *
 * Real-DB integration suite (Lane 3 / S-11 pattern): the route runs
 * against a throwaway Postgres behind INTRO1728B_INTEGRATION_DB_URL.
 * Only auth / subscription / email and the matching-engine PRODUCER
 * (the upstream whose failure/unavailability selects the fallback)
 * are mocked; the gate logic under test lives in the route + real DB.
 *
 * Example:
 *   INTRO1728B_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55444/rekrut_1728b_test' \
 *     npx jest server/__tests__/routes/recruiter-intros-fallback-gate-1728b.test.js --forceExit
 */
jest.unmock('../../../lib/db');

jest.mock('../../../lib/auth', () => {
	const passthrough = (_req, _res, next) => next();
	const authMiddleware = jest.fn((req, _res, next) => {
		req.user = {
			id: parseInt(req.headers['x-test-user-id'] || '11', 10),
			role: req.headers['x-test-role'] || 'candidate',
			company_id: null,
		};
		return next();
	});
	return {
		authMiddleware,
		requireRole: () => passthrough,
		requireApprovedRecruiter: passthrough,
		requireNotSuspended: passthrough,
	};
});
jest.mock('../../../lib/subscription', () => ({
	requireFeature: () => (_req, _res, next) => next(),
}));
jest.mock('../../../lib/email-service', () => ({
	sendTemplatedEmail: jest.fn().mockResolvedValue({}),
	sendCustomEmail: jest.fn().mockResolvedValue({}),
}));

// Matching-engine producer — controlled per test. mode 'throw'
// exercises the engine-error catch fallback; deleting
// findMatchingCandidates from the mocked module exercises the
// engine-unavailable else fallback (the route checks
// `matchingEngine?.findMatchingCandidates` per request).
const engineState = { mode: 'ok' };
jest.mock('../../../services/matching-engine', () => ({
	findMatchingCandidates: jest.fn(async () => {
		if (engineState.mode === 'throw') throw new Error('engine down');
		return [];
	}),
}));

const request = require('supertest');
const express = require('express');

const DB_URL = process.env.INTRO1728B_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

// match_results mirrors migration 008: weighted_score DECIMAL(5,2),
// omniscore_at_match / trustscore_at_match INTEGER nullable.
const SCHEMA_SQL = `
DROP TABLE IF EXISTS user_notifications, recruiter_introductions, candidate_intro_quota,
  match_results, jobs, companies, users CASCADE;
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, role TEXT, company_id INTEGER);
CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE jobs (id INTEGER PRIMARY KEY, title TEXT, user_id INTEGER, company_id INTEGER,
  status TEXT);
CREATE TABLE match_results (candidate_id INTEGER, job_id INTEGER, weighted_score DECIMAL(5,2),
  omniscore_at_match INTEGER, trustscore_at_match INTEGER);
CREATE TABLE candidate_intro_quota (candidate_id INTEGER PRIMARY KEY, week_start DATE,
  used_count INTEGER, max_count INTEGER, updated_at TIMESTAMP DEFAULT NOW());
CREATE TABLE recruiter_introductions (id SERIAL PRIMARY KEY, candidate_id INTEGER, job_id INTEGER,
  recruiter_id INTEGER, company_id INTEGER, status TEXT, fit_score_at_request NUMERIC,
  rank_at_request INTEGER, request_message TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());
CREATE TABLE user_notifications (user_id INTEGER, type TEXT, title TEXT, message TEXT, metadata TEXT, created_at TIMESTAMP DEFAULT NOW());
`;

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/recruiter-intros', require('../../../routes/recruiter-introductions'));
	return app;
}

describeIfDb('#1728b — introductions cached-fallback gate (renormalised basis)', () => {
	let pool;
	let app;
	let engineMock;

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		jest.resetModules();
		pool = require('../../../lib/db');
		engineMock = require('../../../services/matching-engine');
		await pool.query(SCHEMA_SQL);
		app = buildApp();
	});

	afterAll(async () => {
		if (pool) await pool.end();
	});

	beforeEach(async () => {
		engineState.mode = 'throw';
		// Restore the producer in case a previous test removed it.
		if (!engineMock.findMatchingCandidates) {
			engineMock.findMatchingCandidates = jest.fn(async () => {
				if (engineState.mode === 'throw') throw new Error('engine down');
				return [];
			});
		}
		await pool.query(
			'TRUNCATE user_notifications, recruiter_introductions, candidate_intro_quota, match_results, jobs, companies, users RESTART IDENTITY CASCADE',
		);
		await pool.query(
			`INSERT INTO users (id, name, email, role, company_id) VALUES
       (11, 'Cand One', 'c1@example.com', 'candidate', NULL),
       (21, 'Rec One', 'r1@example.com', 'recruiter', 5)`,
		);
		await pool.query(`INSERT INTO companies (id, name) VALUES (5, 'Acme')`);
		await pool.query(
			`INSERT INTO jobs (id, title, user_id, company_id, status)
       VALUES (31, 'Engineer', 21, 5, 'active')`,
		);
	});

	async function seedCachedMatch(weighted, omni, trust) {
		await pool.query(
			`INSERT INTO match_results (candidate_id, job_id, weighted_score, omniscore_at_match, trustscore_at_match)
       VALUES (11, 31, $1, $2, $3)`,
			[weighted, omni, trust],
		);
	}

	async function postRequest() {
		return request(app)
			.post('/api/recruiter-intros/request')
			.set('x-test-user-id', '11')
			.set('x-test-role', 'candidate')
			.send({ job_id: 31 });
	}

	async function introRowCount() {
		const rows = await pool.query('SELECT COUNT(*)::int AS n FROM recruiter_introductions');
		return rows.rows[0].n;
	}

	async function quotaUsed() {
		const rows = await pool.query(
			'SELECT used_count FROM candidate_intro_quota WHERE candidate_id = 11',
		);
		return rows.rows.length ? rows.rows[0].used_count : null;
	}

	function useEngineUnavailable() {
		delete engineMock.findMatchingCandidates;
	}

	// ── J1: renormalised cached row is refused ────────────────────────
	test('J1a catch fallback: omniscore_at_match NULL + weighted 85 → 403 INSUFFICIENT_DATA, no intro, quota untouched', async () => {
		await seedCachedMatch(85, null, 700);
		const res = await postRequest();
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('INSUFFICIENT_DATA');
		expect(res.body.error).toMatch(/fully-measured/);
		expect(await introRowCount()).toBe(0);
		expect(await quotaUsed()).toBe(0);
	});

	test('J1b else fallback (engine unavailable): trustscore_at_match NULL + weighted 85 → 403 INSUFFICIENT_DATA, no intro, quota untouched', async () => {
		useEngineUnavailable();
		await seedCachedMatch(85, 600, null);
		const res = await postRequest();
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('INSUFFICIENT_DATA');
		expect(res.body.error).toMatch(/fully-measured/);
		expect(await introRowCount()).toBe(0);
		expect(await quotaUsed()).toBe(0);
	});

	// ── J2: fully-measured cached row keeps the >= 70 heuristic ──────
	test('J2a catch fallback: fully-measured weighted 85 → 201, intro created, quota consumed', async () => {
		await seedCachedMatch(85, 600, 700);
		const res = await postRequest();
		expect(res.status).toBe(201);
		expect(await introRowCount()).toBe(1);
		expect(await quotaUsed()).toBe(1);
		const rows = await pool.query('SELECT fit_score_at_request FROM recruiter_introductions');
		expect(Number(rows.rows[0].fit_score_at_request)).toBe(85);
	});

	test('J2b else fallback (engine unavailable): fully-measured weighted 85 → 201, intro created', async () => {
		useEngineUnavailable();
		await seedCachedMatch(85, 600, 700);
		const res = await postRequest();
		expect(res.status).toBe(201);
		expect(await introRowCount()).toBe(1);
		expect(await quotaUsed()).toBe(1);
	});

	// ── J3: fully-measured below threshold unchanged ─────────────────
	test('J3 fully-measured weighted 50 → 403 NOT_TOP_FIVE, no intro, quota untouched', async () => {
		await seedCachedMatch(50, 600, 700);
		const res = await postRequest();
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('NOT_TOP_FIVE');
		expect(await introRowCount()).toBe(0);
		expect(await quotaUsed()).toBe(0);
	});

	// ── J4: NULL weighted_score keeps S-11 behaviour ─────────────────
	test('J4 NULL weighted_score → 403 NOT_TOP_FIVE (S-11 unchanged), no intro', async () => {
		await seedCachedMatch(null, null, null);
		const res = await postRequest();
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('NOT_TOP_FIVE');
		expect(await introRowCount()).toBe(0);
	});
});
