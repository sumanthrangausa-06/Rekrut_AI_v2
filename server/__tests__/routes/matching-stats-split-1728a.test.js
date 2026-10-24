/**
 * #1728a-R — GET /api/matching/stats recruiter branch must not blend
 * renormalised match scores into the headline average.
 *
 * The recruiter per-job query averaged match_results.weighted_score
 * over ALL rows, blending renormalised scores (either
 * omniscore_at_match or trustscore_at_match NULL, per #1717/#1724
 * semantics — the score was renormalised over measured components
 * only) with fully-measured ones. A job's headline average could
 * therefore rest on partial evidence without saying so.
 *
 * Panel-ruled split (STOP 1, issue #1728), per job row:
 *  - avg_match_score is the fully-measured average ONLY:
 *    AVG(weighted_score) FILTER (WHERE both at-match columns NOT NULL).
 *  - fully_measured_matches: count of fully-measured rows.
 *  - insufficient_data_matches: count of rows where either at-match
 *    column IS NULL.
 *  - avg_insufficient_data_score: AVG over the renormalised bucket.
 *  - Empty bucket → NULL average, never 0 (counts are honest 0).
 *  - excellent_matches and everything else unchanged; the candidate
 *    branch of /stats is untouched.
 *
 * #1768 pinning: bucket counts classify rows by the at-match column
 * pair alone, so a row with NULL weighted_score still counts in its
 * bucket; each bucket's AVG ignores NULL weighted_score (Postgres
 * AVG semantics), so the average is over non-NULL rows only and a
 * bucket whose only row has NULL weighted_score reports count > 0
 * with a NULL average.
 *
 * Legacy caveat: rows calculated before the #1717/#1724 honesty fixes
 * can carry at-match values from the fabricated-score era and are
 * indistinguishable; the split is truthful for rows calculated
 * at/after those fixes.
 *
 * Real-DB integration suite (1728b pattern): the route runs against a
 * throwaway Postgres behind MATCHING1728A_INTEGRATION_DB_URL. Only
 * auth and the matching-engine / audit-log services are mocked; the
 * SQL under test lives in the route + real DB.
 *
 * Example:
 *   MATCHING1728A_INTEGRATION_DB_URL='postgresql://postgres:postgres@127.0.0.1:5432/rekrut_1728a_test' \
 *     npx jest server/__tests__/routes/matching-stats-split-1728a.test.js --forceExit
 */
jest.unmock('../../../lib/db');

jest.mock('../../../lib/auth', () => {
	const passthrough = (_req, _res, next) => next();
	const authMiddleware = jest.fn((req, _res, next) => {
		req.user = {
			id: parseInt(req.headers['x-test-user-id'] || '21', 10),
			role: req.headers['x-test-role'] || 'recruiter',
			company_id: null,
		};
		return next();
	});
	return {
		authMiddleware,
		requireRole: () => passthrough,
	};
});
jest.mock('../../../services/matching-engine', () => ({
	findMatchingJobs: jest.fn(async () => []),
	findMatchingCandidates: jest.fn(async () => []),
	explainMatch: jest.fn(async () => null),
	updateCandidateEmbedding: jest.fn(async () => {}),
	updateJobEmbedding: jest.fn(async () => {}),
}));
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: { log: jest.fn(async () => {}) },
}));

const request = require('supertest');
const express = require('express');

const DB_URL = process.env.MATCHING1728A_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

// users / jobs / match_results mirror the columns the /stats recruiter
// branch touches; match_results mirrors migration 008 (id SERIAL PK,
// weighted_score DECIMAL(5,2), at-match columns INTEGER nullable).
const SCHEMA_SQL = `
DROP TABLE IF EXISTS match_results, jobs, users CASCADE;
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, role TEXT, company_id INTEGER);
CREATE TABLE jobs (id INTEGER PRIMARY KEY, title TEXT, user_id INTEGER, company_id INTEGER,
  status TEXT);
CREATE TABLE match_results (id SERIAL PRIMARY KEY, candidate_id INTEGER, job_id INTEGER,
  weighted_score DECIMAL(5,2), omniscore_at_match INTEGER, trustscore_at_match INTEGER,
  match_level TEXT);
`;

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/matching', require('../../../routes/matching'));
	return app;
}

describeIfDb('#1728a-R — /stats recruiter branch splits fully-measured vs renormalised', () => {
	let pool;
	let app;

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		jest.resetModules();
		pool = require('../../../lib/db');
		await pool.query(SCHEMA_SQL);
		app = buildApp();
	});

	afterAll(async () => {
		if (pool) await pool.end();
	});

	beforeEach(async () => {
		await pool.query('TRUNCATE match_results, jobs, users RESTART IDENTITY CASCADE');
		await pool.query(
			`INSERT INTO users (id, name, email, role, company_id) VALUES
       (21, 'Rec One', 'r1@example.com', 'recruiter', 5),
       (11, 'Cand One', 'c1@example.com', 'candidate', NULL),
       (12, 'Cand Two', 'c2@example.com', 'candidate', NULL),
       (13, 'Cand Three', 'c3@example.com', 'candidate', NULL)`,
		);
		await pool.query(
			`INSERT INTO jobs (id, title, user_id, company_id, status) VALUES
       (31, 'Mixed Job', 21, 5, 'active'),
       (32, 'Renormalised Only Job', 21, 5, 'active'),
       (33, 'Fully Measured Only Job', 21, 5, 'active'),
       (34, 'No Matches Job', 21, 5, 'active'),
       (35, 'Fully Measured NULL Score Job', 21, 5, 'active'),
       (36, 'Renormalised NULL Score Job', 21, 5, 'active'),
       (37, 'Only NULL Fully Measured Job', 21, 5, 'active'),
       (38, 'Only NULL Renormalised Job', 21, 5, 'active')`,
		);
		// Job 31: fully-measured 80 + 90, renormalised 60.
		// Job 32: renormalised only 50 (omni NULL) + 70 (trust NULL).
		// Job 33: fully-measured only 88 + 92.
		// Job 34: no rows (LEFT JOIN).
		// Job 35 (#1768): fully-measured 80 + NULL weighted_score
		// (both at-match columns non-NULL).
		// Job 36 (#1768): renormalised 60 (omni NULL) + NULL
		// weighted_score (trust NULL).
		// Job 37 (#1768): only row is NULL weighted_score, fully-measured.
		// Job 38 (#1768): only row is NULL weighted_score, renormalised.
		await pool.query(
			`INSERT INTO match_results (candidate_id, job_id, weighted_score, omniscore_at_match, trustscore_at_match, match_level) VALUES
       (11, 31, 80, 600, 700, 'good'),
       (12, 31, 90, 650, 720, 'excellent'),
       (13, 31, 60, NULL, 700, 'good'),
       (11, 32, 50, NULL, 700, 'good'),
       (12, 32, 70, 600, NULL, 'good'),
       (11, 33, 88, 600, 700, 'excellent'),
       (12, 33, 92, 610, 710, 'excellent'),
       (11, 35, 80, 600, 700, 'good'),
       (12, 35, NULL, 650, 720, 'good'),
       (11, 36, 60, NULL, 700, 'good'),
       (12, 36, NULL, 600, NULL, 'good'),
       (11, 37, NULL, 600, 700, 'good'),
       (11, 38, NULL, NULL, 700, 'good')`,
		);
	});

	async function getStats() {
		const res = await request(app)
			.get('/api/matching/stats')
			.set('x-test-user-id', '21')
			.set('x-test-role', 'recruiter');
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		const byJob = {};
		for (const row of res.body.job_stats) byJob[row.job_id] = row;
		return byJob;
	}

	// pg returns COUNT as a string and AVG(numeric) as a string; counts
	// are asserted in the same shape as candidate_matches, averages by
	// numeric value or NULL.
	test('(1) mixed job: avg_match_score is fully-measured only (85), split fields populated', async () => {
		const byJob = await getStats();
		const row = byJob[31];
		expect(row).toBeDefined();
		expect(Number(row.avg_match_score)).toBe(85);
		expect(row.fully_measured_matches).toBe('2');
		expect(typeof row.fully_measured_matches).toBe(typeof row.candidate_matches);
		expect(row.insufficient_data_matches).toBe('1');
		expect(Number(row.avg_insufficient_data_score)).toBe(60);
		// Unchanged fields.
		expect(row.candidate_matches).toBe('3');
		expect(row.excellent_matches).toBe('1');
	});

	test('(2) renormalised-only job: avg_match_score NULL, renormalised average reported separately', async () => {
		const byJob = await getStats();
		const row = byJob[32];
		expect(row).toBeDefined();
		expect(row.avg_match_score).toBeNull();
		expect(Number(row.avg_insufficient_data_score)).toBe(60);
		expect(row.fully_measured_matches).toBe('0');
		expect(row.insufficient_data_matches).toBe('2');
	});

	test('(3) fully-measured-only job: avg_insufficient_data_score NULL, insufficient count 0', async () => {
		const byJob = await getStats();
		const row = byJob[33];
		expect(row).toBeDefined();
		expect(Number(row.avg_match_score)).toBe(90);
		expect(row.avg_insufficient_data_score).toBeNull();
		expect(row.insufficient_data_matches).toBe('0');
		expect(row.fully_measured_matches).toBe('2');
	});

	test('(4) job with no matches: all averages NULL, counts 0 (LEFT JOIN preserved)', async () => {
		const byJob = await getStats();
		const row = byJob[34];
		expect(row).toBeDefined();
		expect(row.avg_match_score).toBeNull();
		expect(row.avg_insufficient_data_score).toBeNull();
		expect(row.candidate_matches).toBe('0');
		expect(row.fully_measured_matches).toBe('0');
		expect(row.insufficient_data_matches).toBe('0');
	});

	test('(5) #1768 NULL weighted_score row in each bucket: count includes it, average excludes it', async () => {
		const byJob = await getStats();
		const fully = byJob[35];
		expect(fully).toBeDefined();
		// The NULL row classifies as fully-measured (both at-match
		// columns non-NULL), so the count is 2, but the average is
		// over the non-NULL row only (80, not 40).
		expect(fully.candidate_matches).toBe('2');
		expect(fully.fully_measured_matches).toBe('2');
		expect(Number(fully.avg_match_score)).toBe(80);
		expect(fully.insufficient_data_matches).toBe('0');
		expect(fully.avg_insufficient_data_score).toBeNull();
		const insufficient = byJob[36];
		expect(insufficient).toBeDefined();
		// The NULL row classifies as insufficient-data (either
		// at-match column NULL), so the count is 2, but the average
		// is over the non-NULL row only (60, not 30).
		expect(insufficient.candidate_matches).toBe('2');
		expect(insufficient.insufficient_data_matches).toBe('2');
		expect(Number(insufficient.avg_insufficient_data_score)).toBe(60);
		expect(insufficient.fully_measured_matches).toBe('0');
		expect(insufficient.avg_match_score).toBeNull();
	});

	test('(6) #1768 bucket whose only row has NULL weighted_score: count > 0 with NULL average', async () => {
		const byJob = await getStats();
		const fully = byJob[37];
		expect(fully).toBeDefined();
		expect(fully.candidate_matches).toBe('1');
		expect(fully.fully_measured_matches).toBe('1');
		expect(fully.avg_match_score).toBeNull();
		expect(fully.insufficient_data_matches).toBe('0');
		expect(fully.avg_insufficient_data_score).toBeNull();
		const insufficient = byJob[38];
		expect(insufficient).toBeDefined();
		expect(insufficient.candidate_matches).toBe('1');
		expect(insufficient.insufficient_data_matches).toBe('1');
		expect(insufficient.avg_insufficient_data_score).toBeNull();
		expect(insufficient.fully_measured_matches).toBe('0');
		expect(insufficient.avg_match_score).toBeNull();
	});
});
