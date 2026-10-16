/**
 * #1192 — honest-null contract on candidate-facing payload routes:
 * dashboard-stats (routes/candidate.js), memory match-breakdown + trend
 * (routes/memory.js). No stored score → null, never 300/'new'.
 */
const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();
jest.mock('../../lib/db', () => ({
	query: (...args) => mockQuery(...args),
	connect: jest.fn(async () => ({ query: jest.fn(async () => ({ rows: [] })), release: jest.fn() })),
}));

jest.mock('../../lib/auth', () => {
	const actual = jest.requireActual('../../lib/auth');
	const authMiddleware = jest.fn((req, _res, next) => {
		req.user = { id: 7, role: 'candidate', company_id: null };
		return next();
	});
	return { ...actual, authMiddleware };
});

jest.mock('../../lib/distributed-rate-limiter', () => {
	const passthrough = (_req, _res, next) => next();
	return {
		rateLimits: { ai: passthrough, standard: passthrough, strict: passthrough, lenient: passthrough },
		distributedRateLimiter: { check: jest.fn(async () => ({ allowed: true })) },
	};
});

jest.mock('../../lib/polsia-ai', () => ({
	chat: jest.fn(async () => ''),
	parseResume: jest.fn(),
	generateSkillAssessment: jest.fn(),
	evaluateSkillAssessment: jest.fn(),
	generateJobMatchScore: jest.fn(),
	generateInterviewCoaching: jest.fn(),
}));

jest.mock('../../services/memory-service', () => ({}));
jest.mock('../../services/autofill-service', () => ({}));

const candidateRouter = require('../../routes/candidate');
const memoryRouter = require('../../routes/memory');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/candidate', candidateRouter);
	app.use('/api/memory', memoryRouter);
	return app;
}

beforeEach(() => {
	jest.clearAllMocks();
	mockQuery.mockImplementation(async (sql) => {
		if (sql.includes('v_candidate_full_profile')) {
			return {
				rows: [
					{
						id: 7,
						name: 'Fresh Candidate',
						omni_score: null,
						score_tier: null,
						skill_count: '0',
						skill_verified_count: '0',
						experience_count: '0',
						education_count: '0',
					},
				],
			};
		}
		if (sql.includes('interview_total')) {
			return {
				rows: [
					{
						interview_total: 0,
						interview_avg: null,
						application_count: 0,
						saved_job_count: 0,
						assessment_total: 0,
						assessment_passed: 0,
					},
				],
			};
		}
		if (sql.includes('SELECT total_score, score_tier, last_updated FROM omni_scores')) {
			return { rows: [] }; // no stored row at all
		}
		if (sql.includes('FROM omni_scores')) {
			return {
				rows: [
					{
						total_score: null,
						score_tier: null,
						interview_score: null,
						technical_score: null,
						resume_score: null,
						behavior_score: null,
					},
				],
			};
		}
		if (sql.includes('FROM match_results')) {
			return { rows: [{ weighted_score: 50, match_level: 'fair', matching_skills: '[]', missing_skills: '[]' }] };
		}
		return { rows: [] };
	});
});

describe('#1192 candidate dashboard-stats', () => {
	test('fresh candidate → omniscore { total_score: null, score_tier: null }, never 300/new', async () => {
		const res = await request(buildApp()).get('/api/candidate/dashboard/stats');
		expect(res.status).toBe(200);
		expect(res.body.stats.omniscore).toEqual({ total_score: null, score_tier: null });
	});
});

describe('#1192 memory routes', () => {
	test('match-breakdown → omniscore.total null (no || 300), tier null', async () => {
		const res = await request(buildApp()).get('/api/memory/match-breakdown/7/9');
		expect(res.status).toBe(200);
		expect(res.body.breakdown.omniscore.total).toBeNull();
		expect(res.body.breakdown.omniscore.tier).toBeNull();
	});

	test('omniscore-trend with no stored row → current { total_score: null, score_tier: null }', async () => {
		const res = await request(buildApp()).get('/api/memory/omniscore-trend');
		expect(res.status).toBe(200);
		expect(res.body.current).toEqual({ total_score: null, score_tier: null });
	});
});

describe('#1192 legacy stats view row — heal, then dashboard-stats first read', () => {
	test('view omni_score 352 pre-heal → live heal → stats payload total_score null', async () => {
		jest.resetModules(); // fresh router + fresh analyticsCache for a true first read
		const legacy = { total: 352, tier: 'new' };
		const baseImpl = mockQuery.getMockImplementation();
		mockQuery.mockImplementation(async (sql, params = []) => {
			if (sql.includes('v_candidate_full_profile')) {
				return {
					rows: [
						{
							id: 7,
							name: 'Legacy Candidate',
							omni_score: legacy.total,
							score_tier: legacy.tier,
							skill_count: '0',
							skill_verified_count: '0',
							experience_count: '0',
							education_count: '0',
						},
					],
				};
			}
			if (sql.includes('FROM omni_scores os')) return { rows: [{ id: 7, deleted_at: null }] };
			if (sql.includes('UPDATE omni_scores')) {
				legacy.total = params[0];
				legacy.tier = params[5];
				return { rows: [] };
			}
			if (sql.includes('FROM trust_scores')) return { rows: [] };
			return baseImpl(sql, params);
		});

		// The stored value the stats ternary passes through, pre-heal:
		const viewRow = (await mockQuery('SELECT * FROM v_candidate_full_profile WHERE id = $1', [7])).rows[0];
		expect(viewRow.omni_score).toBe(352);

		const { recomputeHonestNullScores } = require('../../scripts/recompute-honest-null-scores');
		const report = await recomputeHonestNullScores({ live: true });
		expect(report.omni.would_null).toBe(1);
		expect(legacy.total).toBeNull();

		const freshCandidateRouter = require('../../routes/candidate');
		const app = express();
		app.use(express.json());
		app.use('/api/candidate', freshCandidateRouter);
		const res = await request(app).get('/api/candidate/dashboard/stats');
		expect(res.status).toBe(200);
		expect(res.body.stats.omniscore).toEqual({ total_score: null, score_tier: null });
	});
});
