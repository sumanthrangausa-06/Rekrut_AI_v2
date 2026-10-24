/**
 * #1725 — GET /candidates/full (routes/recruiter.js) manufactures an
 * OmniScore for every candidate: the SELECT carries
 * `COALESCE(os.total_score, latest_ja.match_score, 0) as omniscore`
 * (a job-fit match score on a 0–100 scale relabelled as the 300–850
 * OmniScore, else a literal 0) and the JS map carries a second
 * fabrication layer, `omniscore: row.omniscore || 0`. The min/maxScore
 * filters reuse the same COALESCE, so no-data candidates are filtered
 * as if they held their match score / 0.
 *
 * Ruled honest semantics (#1725, mirroring the shipped #1717 pattern):
 * - No `omni_scores` row, or a row with `total_score IS NULL` (the
 *   #1192 writer contract), means NO score: the payload carries
 *   `omniscore: null` plus `omniscore_status: 'insufficient_data'`.
 * - A measured score flows through with `omniscore_status: 'measured'`.
 * - A candidate's match score stays in its own `matchScore` field and
 *   must never leak into `omniscore`.
 * - minScore set → no-data candidates are EXCLUDED (a NULL score cannot
 *   satisfy a minimum). maxScore-only → no-data candidates are INCLUDED
 *   (no measured score exceeds the maximum).
 *
 * Real-DB integration suite (#1717 precedent): the route runs against a
 * throwaway Postgres behind RECRUITER1725_INTEGRATION_DB_URL; payloads
 * are read back from real HTTP responses. Only auth / rbac / notify and
 * unrelated side-effect services are mocked (the repo's standard
 * route-test pattern).
 *
 * Example:
 *   RECRUITER1725_INTEGRATION_DB_URL='postgresql://root@/rekrut_1725_test?host=/var/run/postgresql' \
 *     npx jest server/__tests__/routes/recruiter-candidates-full-1725.test.js --forceExit
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

const DB_URL = process.env.RECRUITER1725_INTEGRATION_DB_URL;
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

describeIfDb('#1725 — GET /candidates/full honest OmniScore NULL (real DB)', () => {
	let pool;
	let app;

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

	async function getFull(query = '') {
		const res = await request(app).get(`/api/recruiter/candidates/full${query}`);
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
		await pool.query(`DELETE FROM candidate_skills`);
		await pool.query(`DELETE FROM job_applications`);
		await pool.query(`DELETE FROM omni_scores`);
		await pool.query(`DELETE FROM candidate_profiles`);
		await pool.query(`DELETE FROM users`);
	});

	test('no omni_scores row → omniscore null + insufficient_data', async () => {
		await seedCandidate(501, 'no-row', null);
		const body = await getFull();
		const c = byId(body, 501);
		expect(c).toBeDefined();
		expect(c.omniscore).toBeNull();
		expect(c.omniscore_status).toBe('insufficient_data');
	});

	test('omni_scores row with NULL total_score → omniscore null + insufficient_data', async () => {
		await seedCandidate(502, 'row-null', null);
		const body = await getFull();
		const c = byId(body, 502);
		expect(c).toBeDefined();
		expect(c.omniscore).toBeNull();
		expect(c.omniscore_status).toBe('insufficient_data');
	});

	test('measured 600 → omniscore 600 + measured', async () => {
		await seedCandidate(503, 600, null);
		const body = await getFull();
		const c = byId(body, 503);
		expect(c).toBeDefined();
		expect(c.omniscore).toBe(600);
		expect(c.omniscore_status).toBe('measured');
	});

	test('match-score-only candidate → omniscore null (match score must NOT leak), matchScore still carries it', async () => {
		await seedCandidate(504, 'no-row', 72);
		const body = await getFull();
		const c = byId(body, 504);
		expect(c).toBeDefined();
		expect(c.omniscore).toBeNull();
		expect(c.omniscore_status).toBe('insufficient_data');
		expect(c.matchScore).toBe(72);
	});

	test('minScore set → no-data candidates excluded, measured kept', async () => {
		await seedCandidate(501, 'no-row', null);
		await seedCandidate(504, 'no-row', 72);
		await seedCandidate(503, 600, null);
		const body = await getFull('?minScore=50');
		expect(byId(body, 501)).toBeUndefined();
		expect(byId(body, 504)).toBeUndefined();
		expect(byId(body, 503)).toBeDefined();
		expect(body.pagination.total).toBe(1);
	});

	test('maxScore-only → no-data candidates included, measured above max excluded', async () => {
		await seedCandidate(501, 'no-row', null);
		await seedCandidate(502, 'row-null', null);
		await seedCandidate(504, 'no-row', 72);
		await seedCandidate(503, 600, null);
		const body = await getFull('?maxScore=50');
		expect(byId(body, 501)).toBeDefined();
		expect(byId(body, 502)).toBeDefined();
		expect(byId(body, 504)).toBeDefined();
		expect(byId(body, 503)).toBeUndefined();
		expect(body.pagination.total).toBe(3);
	});
});
