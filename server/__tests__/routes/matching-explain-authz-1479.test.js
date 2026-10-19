/**
 * Issue #1479 — GET /api/matching/explain/:candidateId/:jobId must not serve
 * a candidate's full match record to any authenticated non-self caller.
 *
 * Before this fix the handler was guarded by authMiddleware only: any
 * recruiter/hiring_manager/employer account — including one with no
 * relationship to the candidate or the job — received the full record.
 *
 * Gate (STOP 1 on #1479, following the object-authorisation convention of
 * this module's /stats recruiter branch: a job is the caller's when
 * j.user_id = caller OR j.company_id IN (SELECT company_id FROM users
 * WHERE id = caller)):
 *  - candidate role: foreign 403, self proceeds (pre-existing).
 *  - self by identity (id == candidateId, any role, #1468/#927): proceeds.
 *  - admin: proceeds, full record.
 *  - hiring-side roles (recruiter / hiring_manager / employer): proceed
 *    ONLY when the job is the caller's (or their company's) AND a
 *    job_applications row ties this candidate to this job.
 *  - any other role: 403. Denied callers never reach explainMatch.
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

const mockDbQuery = jest.fn();
jest.mock('../../../lib/db', () => ({
	query: (...args) => mockDbQuery(...args),
}));

const matchingRoutes = require('../../../routes/matching');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/matching', matchingRoutes);
	return app;
}
const as = (id) => ({ 'x-test-user-id': String(id) });

const FULL_ROW = {
	id: 999,
	candidate_id: 21,
	job_id: 42,
	weighted_score: 82,
	similarity_score: 0.77,
	match_level: 'good',
	matching_skills: ['Node.js'],
	missing_skills: ['Go'],
	trustscore_at_match: 9872,
	match_explanation: { company_trustscore: 'FULL_RECORD_MARKER' },
};

describe('GET /api/matching/explain/:candidateId/:jobId (#1479 object authorization)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		global.__testUsers = {
			21: { id: 21, role: 'candidate', email: 'cand@example.com' },
			22: { id: 22, role: 'candidate', email: 'other@example.com' },
			24: { id: 24, role: 'employer', email: 'self-role-changed@example.com' },
			10: { id: 10, role: 'recruiter', email: 'related-recruiter@example.com' },
			11: { id: 11, role: 'recruiter', email: 'unrelated-recruiter@example.com' },
			12: { id: 12, role: 'employer', email: 'related-employer@example.com' },
			13: { id: 13, role: 'hiring_manager', email: 'unrelated-hm@example.com' },
			31: { id: 31, role: 'partner', email: 'other-role@example.com' },
			1: { id: 1, role: 'admin', email: 'admin@example.com' },
		};
		mockExplainMatch.mockResolvedValue(FULL_ROW);
		// Default: no relationship. Related-caller tests opt in explicitly.
		mockDbQuery.mockResolvedValue({ rows: [] });
	});

	test('(a) unrelated recruiter: 403, explainMatch and its data never reached', async () => {
		const res = await request(makeApp()).get('/api/matching/explain/21/42').set(as(11));
		expect(res.status).toBe(403);
		expect(mockExplainMatch).not.toHaveBeenCalled();
		expect(JSON.stringify(res.body)).not.toContain('FULL_RECORD_MARKER');
	});

	test('(b) related recruiter (own job + candidate applied): 200 full record', async () => {
		mockDbQuery.mockResolvedValue({ rows: [{ ok: 1 }] });
		const res = await request(makeApp()).get('/api/matching/explain/21/42').set(as(10));
		expect(res.status).toBe(200);
		expect(res.body.match_result).toEqual(FULL_ROW);
		// Relationship proven via one query parameterised (jobId, callerId, candidateId)
		expect(mockDbQuery).toHaveBeenCalledTimes(1);
		expect(mockDbQuery.mock.calls[0][1]).toEqual([42, 10, 21]);
	});

	test('(c) job owner without an application from this candidate: 403', async () => {
		// mockDbQuery default (no rows) models: ownership+pipeline EXISTS check fails
		const res = await request(makeApp()).get('/api/matching/explain/21/42').set(as(10));
		expect(res.status).toBe(403);
		expect(mockExplainMatch).not.toHaveBeenCalled();
	});

	test('(d) unrelated hiring_manager: 403', async () => {
		const res = await request(makeApp()).get('/api/matching/explain/21/42').set(as(13));
		expect(res.status).toBe(403);
		expect(mockExplainMatch).not.toHaveBeenCalled();
	});

	test('(e) related employer: 200 full record', async () => {
		mockDbQuery.mockResolvedValue({ rows: [{ ok: 1 }] });
		const res = await request(makeApp()).get('/api/matching/explain/21/42').set(as(12));
		expect(res.status).toBe(200);
		expect(res.body.match_result).toEqual(FULL_ROW);
	});

	test('(f) non-hiring, non-candidate role: 403 without any relationship query', async () => {
		const res = await request(makeApp()).get('/api/matching/explain/21/42').set(as(31));
		expect(res.status).toBe(403);
		expect(mockExplainMatch).not.toHaveBeenCalled();
		expect(mockDbQuery).not.toHaveBeenCalled();
	});

	test('(g) admin: 200 full record, no relationship query needed', async () => {
		const res = await request(makeApp()).get('/api/matching/explain/21/42').set(as(1));
		expect(res.status).toBe(200);
		expect(res.body.match_result).toEqual(FULL_ROW);
		expect(mockDbQuery).not.toHaveBeenCalled();
	});

	test('(h) candidate-foreign still 403, no relationship query, service unreached', async () => {
		const res = await request(makeApp()).get('/api/matching/explain/21/42').set(as(22));
		expect(res.status).toBe(403);
		expect(mockExplainMatch).not.toHaveBeenCalled();
		expect(mockDbQuery).not.toHaveBeenCalled();
	});

	test('(i) self by identity with a hiring role (#927 case): proceeds, no relationship query', async () => {
		mockExplainMatch.mockResolvedValue({ ...FULL_ROW, candidate_id: 24 });
		const res = await request(makeApp()).get('/api/matching/explain/24/42').set(as(24));
		expect(res.status).toBe(200);
		expect(mockDbQuery).not.toHaveBeenCalled();
		// #1468 shaping still applies to the self audience
		expect(res.body.match_result.trustscore_at_match).toBeUndefined();
		expect(JSON.stringify(res.body)).not.toContain('FULL_RECORD_MARKER');
	});

	test('(j) candidate-self still 200 with the #1468 allowlist, no relationship query', async () => {
		const res = await request(makeApp()).get('/api/matching/explain/21/42').set(as(21));
		expect(res.status).toBe(200);
		expect(Object.keys(res.body.match_result).sort()).toEqual([
			'match_level',
			'matching_skills',
			'missing_skills',
			'similarity_score',
			'weighted_score',
		]);
		expect(mockDbQuery).not.toHaveBeenCalled();
	});

	test('(k) unauthenticated: 401', async () => {
		const res = await request(makeApp()).get('/api/matching/explain/21/42');
		expect(res.status).toBe(401);
		expect(mockExplainMatch).not.toHaveBeenCalled();
	});
});
