/**
 * #1731 Lane 1 (S-1/S-2/S-3) — routes/recruiter.js score honesty:
 *  S-1: GET /candidates/full `matchScore: row.match_score || 0` fabricates
 *       a 0% match for candidates with no measured match. Honest: null +
 *       matchScore_status 'insufficient_data'; measured 0 stays 0/measured.
 *  S-2: `isTopCandidate: row.omniscore >= 85` — 85 is a 0-100-scale number
 *       on the 300-850 OmniScore, so every measured candidate was "top".
 *       Founder-ruled threshold (2026-10-22): 740 (excellent-tier floor,
 *       services/omniscore.js SCORE_RANGES.TIERS.excellent.min), explicit
 *       NULL guard.
 *  S-3: GET /pipeline-stats topCandidates used
 *       `COALESCE(os.total_score, ja.match_score, 0) >= 85`, substituting a
 *       0-100 match score for a missing OmniScore. Honest: OmniScore alone
 *       at 740; NULL never counts.
 *
 * Real-DB integration suite (#1725 pattern): routes run against a
 * throwaway Postgres behind RECRUITER1731_INTEGRATION_DB_URL; payloads are
 * read back from real HTTP responses. Only auth / rbac / notify and
 * unrelated side-effect services are mocked.
 *
 * Example:
 *   RECRUITER1731_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/rekrut_1731_test' \
 *     npx jest server/__tests__/routes/recruiter-1731-lane1.test.js --forceExit
 */
jest.unmock('../../../lib/db');

jest.mock('../../../lib/auth', () => {
	const passthrough = (_req, _res, next) => next();
	const authMiddleware = jest.fn((req, _res, next) => {
		req.user = { id: 99, role: 'recruiter', company_id: 5 };
		return next();
	});
	return {
		authMiddleware,
		requireRole: () => passthrough,
		requireApprovedRecruiter: passthrough,
		requireNotSuspended: passthrough,
		requireEmployer: passthrough,
		optionalAuth: passthrough,
	};
});
jest.mock('../../../middleware/rbac', () => ({
	requirePermission: () => (_req, _res, next) => next(),
}));
jest.mock('../../../services/trustscore', () => ({
	updateHiringRatioScore: jest.fn().mockResolvedValue(true),
	calculateTrustScore: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../../lib/notify', () => ({
	notifyUser: jest.fn().mockResolvedValue(1),
}));
jest.mock('../../../lib/email-service', () => ({
	sendTemplatedEmail: jest.fn().mockResolvedValue({}),
	sendCustomEmail: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../services/auditLogService', () => ({
	EVENT_TYPES: {
		AI_DECISION: 'ai_decision',
		HUMAN_OVERRIDE: 'human_override',
		DATA_ACCESS: 'data_access',
		VERIFICATION: 'verification',
		SIGNATURE: 'signature',
		STATUS_CHANGE: 'status_change',
	},
	ENTITY_TYPES: { CANDIDATE: 'candidate', JOB: 'job', COMPANY: 'company', USER: 'user' },
	logEvent: jest.fn().mockResolvedValue(undefined),
	AuditLogger: { log: jest.fn().mockResolvedValue(undefined) },
}));

const request = require('supertest');
const express = require('express');

const DB_URL = process.env.RECRUITER1731_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const SCHEMA_SQL = `
DROP TABLE IF EXISTS candidate_skills, job_applications, omni_scores, candidate_profiles, users CASCADE;
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, avatar_url TEXT, role TEXT, company_id INTEGER);
CREATE TABLE candidate_profiles (
  user_id INTEGER PRIMARY KEY, headline TEXT, location TEXT, years_experience INTEGER,
  phone TEXT, salary_min INTEGER, salary_max INTEGER, remote_preference TEXT);
CREATE TABLE omni_scores (user_id INTEGER PRIMARY KEY, total_score INTEGER, score_tier TEXT);
CREATE TABLE job_applications (
  id INTEGER PRIMARY KEY, job_id INTEGER, candidate_id INTEGER, company_id INTEGER,
  status TEXT, match_score INTEGER,
  applied_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());
CREATE TABLE candidate_skills (user_id INTEGER, skill_name TEXT, level TEXT, category TEXT);
`;

describeIfDb('#1731 Lane 1 — top-candidate / matchScore honesty (real DB)', () => {
	let pool;
	let app;
	let analyticsCache;

	// omni: 'no-row' | 'row-null' | measured integer total_score
	async function seedCandidate(id, omni, matchScore) {
		await pool.query(
			`INSERT INTO users (id, name, email, role, company_id) VALUES ($1, $2, $3, 'candidate', 5)`,
			[id, `Candidate ${id}`, `candidate${id}@example.test`],
		);
		await pool.query(
			`INSERT INTO job_applications (id, job_id, candidate_id, company_id, status, match_score)
			 VALUES ($1, 10, $2, 5, 'applied', $3)`,
			[id, id, matchScore],
		);
		if (omni === 'row-null') {
			await pool.query(
				`INSERT INTO omni_scores (user_id, total_score, score_tier) VALUES ($1, NULL, NULL)`,
				[id],
			);
		} else if (typeof omni === 'number') {
			await pool.query(
				`INSERT INTO omni_scores (user_id, total_score, score_tier) VALUES ($1, $2, 'some_tier')`,
				[id, omni],
			);
		}
	}

	async function getFull() {
		const res = await request(app).get(`/api/recruiter/candidates/full`);
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		return res.body;
	}

	function byId(body, id) {
		return body.candidates.find((c) => c.id === String(id));
	}

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		jest.resetModules();
		pool = require('../../../lib/db');
		// Required after jest.resetModules() so this is the same singleton
		// instance the freshly loaded recruiter router uses.
		analyticsCache = require('../../../lib/analytics-cache').analyticsCache;
		const recruiterRouter = require('../../../routes/recruiter');
		app = express();
		app.use(express.json());
		app.use('/api/recruiter', recruiterRouter);
		await pool.query(SCHEMA_SQL);
	}, 30000);

	afterAll(async () => {
		await pool.end();
	});

	beforeEach(async () => {
		jest.clearAllMocks();
		analyticsCache.clear();
		await pool.query(`DELETE FROM candidate_skills`);
		await pool.query(`DELETE FROM job_applications`);
		await pool.query(`DELETE FROM omni_scores`);
		await pool.query(`DELETE FROM candidate_profiles`);
		await pool.query(`DELETE FROM users`);
	});

	// ── S-1 ──────────────────────────────────────────────────────
	test('S-1: match_score NULL → matchScore null + insufficient_data', async () => {
		await seedCandidate(601, 'no-row', null);
		const c = byId(await getFull(), 601);
		expect(c).toBeDefined();
		expect(c.matchScore).toBeNull();
		expect(c.matchScore_status).toBe('insufficient_data');
	});

	test('S-1: match_score 0 (measured) → matchScore 0 + measured', async () => {
		await seedCandidate(602, 'no-row', 0);
		const c = byId(await getFull(), 602);
		expect(c).toBeDefined();
		expect(c.matchScore).toBe(0);
		expect(c.matchScore_status).toBe('measured');
	});

	test('S-1: match_score 72 (measured) → matchScore 72 + measured', async () => {
		await seedCandidate(603, 'no-row', 72);
		const c = byId(await getFull(), 603);
		expect(c).toBeDefined();
		expect(c.matchScore).toBe(72);
		expect(c.matchScore_status).toBe('measured');
	});

	// ── S-2 ──────────────────────────────────────────────────────
	test('S-2: omni 739 → isTopCandidate false', async () => {
		await seedCandidate(611, 739, null);
		const c = byId(await getFull(), 611);
		expect(c.isTopCandidate).toBe(false);
	});

	test('S-2: omni 740 → isTopCandidate true', async () => {
		await seedCandidate(612, 740, null);
		const c = byId(await getFull(), 612);
		expect(c.isTopCandidate).toBe(true);
	});

	test('S-2: omni NULL (no row) → isTopCandidate false', async () => {
		await seedCandidate(613, 'no-row', 90);
		const c = byId(await getFull(), 613);
		expect(c.isTopCandidate).toBe(false);
	});

	test('S-2: omni NULL (row, NULL total) → isTopCandidate false', async () => {
		await seedCandidate(614, 'row-null', 90);
		const c = byId(await getFull(), 614);
		expect(c.isTopCandidate).toBe(false);
	});

	test('S-2: omni 400 → isTopCandidate false (proves the old >=85 is gone)', async () => {
		await seedCandidate(615, 400, null);
		const c = byId(await getFull(), 615);
		expect(c.isTopCandidate).toBe(false);
	});

	// ── S-3 ──────────────────────────────────────────────────────
	// Single scenario under one company: pipeline-stats caches by
	// companyId, so all pipeline seeds live in ONE test with ONE request
	// and the exact topCandidates count is asserted.
	test('S-3: /pipeline-stats counts only measured OmniScore >= 740', async () => {
		await seedCandidate(621, 'no-row', 90); // match-only 90: old COALESCE counted it
		await seedCandidate(622, 'row-null', 90); // NULL omni + match 90: old counted it
		await seedCandidate(623, 740, null); // counted
		await seedCandidate(624, 739, null); // not counted
		await seedCandidate(625, 400, null); // old >=85 counted it; 740 must not
		await seedCandidate(626, 800, 10); // counted
		const res = await request(app).get(`/api/recruiter/pipeline-stats`);
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.stats.topCandidates).toBe(2);
	});
});
