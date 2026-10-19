/**
 * Issue #1479 — GET /api/matching/explain/:candidateId/:jobId must enforce
 * object-level authorisation for non-self callers (BOLA).
 *
 * Before this fix the route was guarded by authMiddleware only (plus the
 * #1468 candidate-foreign 403 and candidate-self allowlist shaping): ANY
 * other authenticated role could read ANY candidate's full match record.
 *
 * Gate (STOP 1 on #1479; FS-145/#1100 convention, reference implementation
 * routes/compliance.js GET /explain/job/:jobId/candidate/:candidateId):
 * - unauthenticated → 401 (existing middleware)
 * - non-numeric candidateId/jobId → 400, before any DB query or service call
 * - candidate-role foreign → 403 'Not authorized' (#1468, unchanged)
 * - identity-self (id === candidateId, non-admin) → 200, #1468 shaping
 * - admin → 200 full record, bypassing the job/linkage checks (compliance
 *   precedent; pinned, incl. on a missing job)
 * - hiring roles (employer / recruiter / hiring_manager):
 *     1. job ownership — SELECT company_id FROM jobs; missing job, null
 *        caller company_id, null job company_id, or company mismatch
 *        → 404 'Job not found' (foreign ≡ missing, no existence oracle)
 *     2. application linkage — SELECT 1 FROM job_applications for the
 *        exact (candidate_id, job_id, company_id) triple → no row is
 *        403 'Access denied' (security-review tightening vs compliance's
 *        candidate×company linkage: this resource IS a candidate×job
 *        pair, so owning the job plus an application to a DIFFERENT job
 *        of the same company does not suffice)
 *     both checks run BEFORE explainMatch(); a denied caller never
 *     reaches the service and no record field leaks (canaries asserted)
 * - any other authenticated role → 403
 *
 * Mock note: the DB mock honours the guard queries exactly as written
 * (job anchor load + linkage SELECT 1), mirroring compliance-authz.test.js,
 * and records every call so denied paths can assert no query ran at all
 * where the gate must fire first.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../../../lib/auth', () => {
	const authMiddleware = jest.fn((req, res, next) => {
		if (req.headers['x-test-user-id']) {
			const userId = parseInt(req.headers['x-test-user-id'], 10);
			const user = global.__testUsers?.[userId];
			if (user) {
				req.user = user;
				return next();
			}
		}
		return res.status(401).json({ error: 'Unauthorized' });
	});
	const requireRole =
		(...roles) =>
		(req, res, next) =>
			roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Forbidden' });
	return { authMiddleware, requireRole };
});

const mockExplainMatch = jest.fn();
jest.mock('../../../services/matching-engine', () => ({
	explainMatch: (...args) => mockExplainMatch(...args),
	findMatchingJobs: jest.fn(async () => []),
	findMatchingCandidates: jest.fn(async () => []),
	updateCandidateEmbedding: jest.fn(async () => {}),
	updateJobEmbedding: jest.fn(async () => {}),
}));

jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: { log: jest.fn(async () => {}) },
}));

const db = require('../../../lib/db');

// ── Fixtures ─────────────────────────────────────────────────────────────
// job 42 → company 5 · job 52 → company 5 (no application from candidate 21)
// job 43 → company 6 · job 44 → company_id NULL · job 9999 does not exist
const JOBS = new Map([
	[42, { company_id: 5 }],
	[52, { company_id: 5 }],
	[43, { company_id: 6 }],
	[44, { company_id: null }],
]);
// The ONLY application row: candidate 21 applied to job 42 (company 5).
const APPLICATIONS = [{ candidate_id: 21, job_id: 42, company_id: 5 }];

const dbCalls = [];
function installDbMock() {
	db.query.mockImplementation(async (sql, params = []) => {
		const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
		dbCalls.push({ sql: normalized, params });
		if (normalized.startsWith('select company_id from jobs')) {
			const job = JOBS.get(Number(params[0]));
			return { rows: job ? [{ company_id: job.company_id }] : [], rowCount: job ? 1 : 0 };
		}
		if (normalized.startsWith('select 1 from job_applications')) {
			const linked = APPLICATIONS.some(
				(a) =>
					Number(a.candidate_id) === Number(params[0]) &&
					Number(a.job_id) === Number(params[1]) &&
					Number(a.company_id) === Number(params[2]),
			);
			return { rows: linked ? [{ '?column?': 1 }] : [], rowCount: linked ? 1 : 0 };
		}
		return { rows: [], rowCount: 0 };
	});
}

const matchingRoutes = require('../../../routes/matching');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/matching', matchingRoutes);
	return app;
}
const app = makeApp();
const as = (id) => ({ 'x-test-user-id': String(id) });

const COMPANY_A = 5;
const USERS = {
	1: { id: 1, role: 'admin', email: 'admin@example.com', company_id: null },
	10: { id: 10, role: 'recruiter', email: 'ra@example.com', company_id: COMPANY_A },
	11: { id: 11, role: 'recruiter', email: 'rb@example.com', company_id: 6 },
	12: { id: 12, role: 'employer', email: 'ea@example.com', company_id: COMPANY_A },
	13: { id: 13, role: 'employer', email: 'eb@example.com', company_id: 6 },
	14: { id: 14, role: 'hiring_manager', email: 'hma@example.com', company_id: COMPANY_A },
	15: { id: 15, role: 'hiring_manager', email: 'hmb@example.com', company_id: 6 },
	16: { id: 16, role: 'recruiter', email: 'rnc@example.com', company_id: null },
	// company_id as a STRING — JWT/session payloads do not guarantee numbers;
	// Number() coercion on both sides must still match (security-review pin).
	17: { id: 17, role: 'recruiter', email: 'rstr@example.com', company_id: '5' },
	21: { id: 21, role: 'candidate', email: 'cand@example.com', company_id: null },
	22: { id: 22, role: 'candidate', email: 'other@example.com', company_id: null },
	// Converted account: applied as candidate 24, account role is now employer.
	24: { id: 24, role: 'employer', email: 'conv@example.com', company_id: 6 },
};

const FULL_ROW = {
	id: 999,
	candidate_id: 21,
	job_id: 42,
	similarity_score: 0.77,
	weighted_score: 82,
	omniscore_at_match: 9871,
	trustscore_at_match: 9872,
	matching_skills: ['Node.js', 'PostgreSQL'],
	missing_skills: ['Go'],
	match_explanation: { company_trustscore: 'CANARY_TRUSTSCORE_TEXT' },
	match_level: 'good',
};
const CANARIES = ['CANARY_TRUSTSCORE_TEXT', '9871', '9872', 'match_explanation'];

function expectNoLeak(res) {
	const body = JSON.stringify(res.body);
	for (const canary of CANARIES) {
		expect(body).not.toContain(canary);
	}
	expect(mockExplainMatch).not.toHaveBeenCalled();
}

beforeEach(() => {
	jest.clearAllMocks();
	dbCalls.length = 0;
	installDbMock();
	global.__testUsers = USERS;
	mockExplainMatch.mockResolvedValue(FULL_ROW);
});

describe('GET /api/matching/explain/:candidateId/:jobId (#1479)', () => {
	test('unrelated recruiter (foreign job) → 404, no leak, service never reached', async () => {
		const res = await request(app).get('/api/matching/explain/21/42').set(as(11));
		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: 'Job not found' });
		expectNoLeak(res);
	});

	test('unrelated employer (foreign job) → 404, service never reached', async () => {
		const res = await request(app).get('/api/matching/explain/21/42').set(as(13));
		expect(res.status).toBe(404);
		expectNoLeak(res);
	});

	test('unrelated hiring_manager (foreign job) → 404, service never reached', async () => {
		const res = await request(app).get('/api/matching/explain/21/42').set(as(15));
		expect(res.status).toBe(404);
		expectNoLeak(res);
	});

	test('non-existent job → same 404 body as a foreign job (no existence oracle)', async () => {
		const foreign = await request(app).get('/api/matching/explain/21/42').set(as(11));
		const missing = await request(app).get('/api/matching/explain/21/9999').set(as(10));
		expect(missing.status).toBe(404);
		expect(missing.body).toEqual(foreign.body);
		expect(mockExplainMatch).not.toHaveBeenCalled();
	});

	test('gate B: owns the job, candidate applied to a DIFFERENT job of the same company → 403, no leak, service never reached', async () => {
		// Candidate 21 has an application with company 5 (job 42) — a
		// candidate×company linkage would PASS here. Job-specific linkage
		// must deny: no application ties candidate 21 to job 52.
		const res = await request(app).get('/api/matching/explain/21/52').set(as(10));
		expect(res.status).toBe(403);
		expect(res.body).toEqual({ error: 'Access denied' });
		expectNoLeak(res);
	});

	test('owns the job, candidate never applied to that company at all → 403, service never reached', async () => {
		const res = await request(app).get('/api/matching/explain/22/42').set(as(10));
		expect(res.status).toBe(403);
		expectNoLeak(res);
	});

	test('related recruiter (owns job + exact application) → 200 full record, unshaped', async () => {
		const res = await request(app).get('/api/matching/explain/21/42').set(as(10));
		expect(res.status).toBe(200);
		expect(res.body.match_result).toEqual(FULL_ROW);
		expect(mockExplainMatch).toHaveBeenCalledWith(21, 42);
	});

	test('related employer → 200 full record', async () => {
		const res = await request(app).get('/api/matching/explain/21/42').set(as(12));
		expect(res.status).toBe(200);
		expect(res.body.match_result).toEqual(FULL_ROW);
	});

	test('related hiring_manager → 200 full record', async () => {
		const res = await request(app).get('/api/matching/explain/21/42').set(as(14));
		expect(res.status).toBe(200);
		expect(res.body.match_result).toEqual(FULL_ROW);
	});

	test("string-typed company_id ('5') still matches the job's company → 200", async () => {
		const res = await request(app).get('/api/matching/explain/21/42').set(as(17));
		expect(res.status).toBe(200);
		expect(res.body.match_result).toEqual(FULL_ROW);
	});

	test('recruiter with null company_id → 404 fail-closed, service never reached', async () => {
		const res = await request(app).get('/api/matching/explain/21/42').set(as(16));
		expect(res.status).toBe(404);
		expectNoLeak(res);
	});

	test('job row with null company_id → 404 for a hiring caller, service never reached', async () => {
		const res = await request(app).get('/api/matching/explain/21/44').set(as(10));
		expect(res.status).toBe(404);
		expectNoLeak(res);
	});

	test('candidate-self → 200 with the #1468 allowlist shaping, unchanged', async () => {
		const res = await request(app).get('/api/matching/explain/21/42').set(as(21));
		expect(res.status).toBe(200);
		expect(Object.keys(res.body.match_result).sort()).toEqual([
			'match_level',
			'matching_skills',
			'missing_skills',
			'similarity_score',
			'weighted_score',
		]);
		const body = JSON.stringify(res.body);
		expect(body).not.toContain('CANARY_TRUSTSCORE_TEXT');
		// Self bypasses the ownership/linkage queries entirely.
		expect(dbCalls).toHaveLength(0);
	});

	test('identity-self whose role changed (employer, own id) → 200 shaped, no DB gate queries', async () => {
		mockExplainMatch.mockResolvedValue({ ...FULL_ROW, candidate_id: 24 });
		const res = await request(app).get('/api/matching/explain/24/42').set(as(24));
		expect(res.status).toBe(200);
		expect(Object.keys(res.body.match_result).sort()).toEqual([
			'match_level',
			'matching_skills',
			'missing_skills',
			'similarity_score',
			'weighted_score',
		]);
		expect(dbCalls).toHaveLength(0);
	});

	test("candidate-foreign → 403 with the exact pre-existing body 'Not authorized'", async () => {
		const res = await request(app).get('/api/matching/explain/21/42').set(as(22));
		expect(res.status).toBe(403);
		expect(res.body).toEqual({ error: 'Not authorized' });
		expectNoLeak(res);
	});

	test('admin → 200 full record, no DB gate queries (bypass)', async () => {
		const res = await request(app).get('/api/matching/explain/21/42').set(as(1));
		expect(res.status).toBe(200);
		expect(res.body.match_result).toEqual(FULL_ROW);
		expect(dbCalls).toHaveLength(0);
	});

	test('admin on a non-existent job → still 200 (pinned bypass behaviour, compliance precedent)', async () => {
		const res = await request(app).get('/api/matching/explain/21/9999').set(as(1));
		expect(res.status).toBe(200);
		expect(mockExplainMatch).toHaveBeenCalledWith(21, 9999);
	});

	test('unauthenticated → 401, service never reached', async () => {
		const res = await request(app).get('/api/matching/explain/21/42');
		expect(res.status).toBe(401);
		expect(mockExplainMatch).not.toHaveBeenCalled();
	});

	test('non-numeric candidateId → 400 before any DB query or service call', async () => {
		const res = await request(app).get('/api/matching/explain/abc/42').set(as(10));
		expect(res.status).toBe(400);
		expect(dbCalls).toHaveLength(0);
		expect(mockExplainMatch).not.toHaveBeenCalled();
	});

	test('non-numeric jobId → 400 before any DB query or service call', async () => {
		const res = await request(app).get('/api/matching/explain/21/xyz').set(as(10));
		expect(res.status).toBe(400);
		expect(dbCalls).toHaveLength(0);
		expect(mockExplainMatch).not.toHaveBeenCalled();
	});
});
