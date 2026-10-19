/**
 * Issue #1468 — GET /api/matching/explain/:candidateId/:jobId must not return
 * explainMatch()'s raw match_results row to candidate-self.
 *
 * Privacy seat (STOP 1 on #1468, adopting #1458/#1463 precedent):
 * candidate-self receives ONLY the allowlist projection, constructed
 * key-by-key at the route boundary — weighted_score, similarity_score,
 * match_level, matching_skills, missing_skills. The raw match_explanation
 * JSONB (incl. company_trustscore text), trustscore_at_match and
 * omniscore_at_match must appear NOWHERE in a candidate-self response,
 * in either explainMatch shape (cached SELECT * row, or the on-demand
 * computed object whose explanation nests the same artifacts).
 *
 * Audience shaping keys on authorisation identity (self && !admin),
 * per the #927 fix-round ruling — not on role === 'candidate' alone.
 * Non-self hiring/admin callers keep the full record unchanged.
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

// #1479: the explain route now enforces object-level authorisation — a
// hiring caller must own the job and have an application linkage. Job 42
// belongs to company 5 and candidate 21 has an application for it there,
// which makes the recruiter fixture below a RELATED recruiter.
const db = require('../../../lib/db');
db.query.mockImplementation(async (sql, params = []) => {
	const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
	if (normalized.startsWith('select company_id from jobs')) {
		return Number(params[0]) === 42
			? { rows: [{ company_id: 5 }], rowCount: 1 }
			: { rows: [], rowCount: 0 };
	}
	if (normalized.startsWith('select 1 from job_applications')) {
		const linked = Number(params[0]) === 21 && Number(params[1]) === 5;
		return { rows: linked ? [{ '?column?': 1 }] : [], rowCount: linked ? 1 : 0 };
	}
	return { rows: [], rowCount: 0 };
});

const matchingRoutes = require('../../../routes/matching');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/matching', matchingRoutes);
	return app;
}
const as = (id) => ({ 'x-test-user-id': String(id) });

const CANARY_ROW = {
	id: 999,
	candidate_id: 21,
	job_id: 42,
	similarity_score: 0.77,
	weighted_score: 82,
	omniscore_at_match: 9871,
	trustscore_at_match: 9872,
	matching_skills: ['Node.js', 'PostgreSQL'],
	missing_skills: ['Go'],
	match_explanation: {
		company_trustscore: 'CANARY_TRUSTSCORE_TEXT',
		omniscore_boost: 'CANARY_OMNI_BOOST_TEXT',
		semantic_match: '77% profile alignment',
	},
	match_level: 'good',
	calculated_at: '2026-10-19T00:00:00.000Z',
	dimension_breakdown: { secret: 'CANARY_DIMENSION_TEXT' },
};

const CANARY_ON_DEMAND = {
	match_level: 'good',
	weighted_score: 82,
	similarity_score: 0.77,
	explanation: {
		company_trustscore: 'CANARY_TRUSTSCORE_TEXT',
		omniscore_boost: 'CANARY_OMNI_BOOST_TEXT',
		semantic_match: '77% profile alignment',
	},
};

const ALLOWLIST = [
	'match_level',
	'matching_skills',
	'missing_skills',
	'similarity_score',
	'weighted_score',
];

describe('GET /api/matching/explain/:candidateId/:jobId (#1468)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		global.__testUsers = {
			21: { id: 21, role: 'candidate', email: 'cand@example.com' },
			22: { id: 22, role: 'candidate', email: 'other@example.com' },
			24: { id: 24, role: 'employer', email: 'self-role-changed@example.com' },
			10: { id: 10, role: 'recruiter', email: 'recruiter@example.com', company_id: 5 },
			1: { id: 1, role: 'admin', email: 'admin@example.com' },
		};
		mockExplainMatch.mockResolvedValue(CANARY_ROW);
	});

	test('(a) candidate-self, cached row: only allowlisted fields, canaries nowhere', async () => {
		const res = await request(makeApp()).get('/api/matching/explain/21/42').set(as(21));
		expect(res.status).toBe(200);
		expect(Object.keys(res.body.match_result).sort()).toEqual(ALLOWLIST);
		expect(res.body.match_result.weighted_score).toBe(82);
		expect(res.body.match_result.similarity_score).toBe(0.77);
		expect(res.body.match_result.match_level).toBe('good');
		expect(res.body.match_result.matching_skills).toEqual(['Node.js', 'PostgreSQL']);
		expect(res.body.match_result.missing_skills).toEqual(['Go']);
		const body = JSON.stringify(res.body);
		for (const canary of [
			'CANARY_TRUSTSCORE_TEXT',
			'CANARY_OMNI_BOOST_TEXT',
			'CANARY_DIMENSION_TEXT',
			'9871',
			'9872',
			'match_explanation',
			'trustscore_at_match',
			'omniscore_at_match',
			'dimension_breakdown',
		]) {
			expect(body).not.toContain(canary);
		}
	});

	test('(b) candidate-self, on-demand shape: nested explanation never reaches candidate', async () => {
		mockExplainMatch.mockResolvedValue(CANARY_ON_DEMAND);
		const res = await request(makeApp()).get('/api/matching/explain/21/42').set(as(21));
		expect(res.status).toBe(200);
		expect(Object.keys(res.body.match_result).sort()).toEqual([
			'match_level',
			'similarity_score',
			'weighted_score',
		]);
		const body = JSON.stringify(res.body);
		expect(body).not.toContain('CANARY_TRUSTSCORE_TEXT');
		expect(body).not.toContain('CANARY_OMNI_BOOST_TEXT');
		expect(res.body.match_result.explanation).toBeUndefined();
	});

	test('(c) related recruiter caller keeps the full record unchanged (#1479 gate passes)', async () => {
		const res = await request(makeApp()).get('/api/matching/explain/21/42').set(as(10));
		expect(res.status).toBe(200);
		expect(res.body.match_result).toEqual(CANARY_ROW);
	});

	test('(d) candidate-foreign still 403 and service is never reached', async () => {
		const res = await request(makeApp()).get('/api/matching/explain/21/42').set(as(22));
		expect(res.status).toBe(403);
		expect(mockExplainMatch).not.toHaveBeenCalled();
	});

	test('(e) self caller whose role is no longer candidate is still shaped (identity, not role)', async () => {
		mockExplainMatch.mockResolvedValue({ ...CANARY_ROW, candidate_id: 24 });
		const res = await request(makeApp()).get('/api/matching/explain/24/42').set(as(24));
		expect(res.status).toBe(200);
		expect(Object.keys(res.body.match_result).sort()).toEqual(ALLOWLIST);
		expect(JSON.stringify(res.body)).not.toContain('CANARY_TRUSTSCORE_TEXT');
	});

	test('(g) candidate-self, no-match branch: explanation.reason is dropped, none/0 survive', async () => {
		mockExplainMatch.mockResolvedValue({
			match_level: 'none',
			weighted_score: 0,
			explanation: { reason: 'CANARY_REASON_TEXT' },
		});
		const res = await request(makeApp()).get('/api/matching/explain/21/42').set(as(21));
		expect(res.status).toBe(200);
		expect(Object.keys(res.body.match_result).sort()).toEqual(['match_level', 'weighted_score']);
		expect(res.body.match_result.match_level).toBe('none');
		expect(JSON.stringify(res.body)).not.toContain('CANARY_REASON_TEXT');
	});

	test('(h) candidate-self: non-string entries in skill lists are filtered out', async () => {
		mockExplainMatch.mockResolvedValue({
			...CANARY_ROW,
			matching_skills: ['Node.js', { company_trustscore: 'CANARY_TRUSTSCORE_TEXT' }],
			missing_skills: ['Go', 42],
		});
		const res = await request(makeApp()).get('/api/matching/explain/21/42').set(as(21));
		expect(res.status).toBe(200);
		expect(res.body.match_result.matching_skills).toEqual(['Node.js']);
		expect(res.body.match_result.missing_skills).toEqual(['Go']);
		expect(JSON.stringify(res.body)).not.toContain('CANARY_TRUSTSCORE_TEXT');
	});

	test('(i) candidate-self: non-array skill lists fail closed to [] (review nit, PR #1478)', async () => {
		mockExplainMatch.mockResolvedValue({
			...CANARY_ROW,
			matching_skills: 'CANARY_SKILL_STRING',
			missing_skills: { note: 'CANARY_SKILL_OBJECT' },
		});
		const res = await request(makeApp()).get('/api/matching/explain/21/42').set(as(21));
		expect(res.status).toBe(200);
		expect(res.body.match_result.matching_skills).toEqual([]);
		expect(res.body.match_result.missing_skills).toEqual([]);
		const body = JSON.stringify(res.body);
		expect(body).not.toContain('CANARY_SKILL_STRING');
		expect(body).not.toContain('CANARY_SKILL_OBJECT');
	});

	test('(f) admin caller keeps the full record', async () => {
		const res = await request(makeApp()).get('/api/matching/explain/21/42').set(as(1));
		expect(res.status).toBe(200);
		expect(res.body.match_result).toEqual(CANARY_ROW);
	});
});
