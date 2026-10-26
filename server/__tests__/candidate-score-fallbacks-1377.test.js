/**
 * #1377 (specialist-review extension) — routes/candidate.js fabricated 50s.
 *
 * The STOP 1 grep looked for `match_score: 50` spellings and found none;
 * the independent silent-failure-hunter review found the same defect
 * class under other score names in this file:
 *  1. POST /ai/resume-score: unparseable AI output fell back to
 *     overall_score 50, and 20 points (50% of 40) were then persisted
 *     into score_components and folded into the candidate's OmniScore.
 *  2. POST /ai/application-review: unparseable AI output fell back to
 *     completeness_score 50 AND ready_to_submit: true — a fabricated
 *     score plus a fabricated "ready" verdict.
 *  3. POST /ai/smart-search: a candidate with NO skills got
 *     relevance_score 50 on every job (no data presented as mid-range).
 * Honest behaviour: null scores, no OmniScore write without a real
 * score, ready_to_submit false when the review never happened, and
 * relevance null (sorted last) when there is nothing to match against.
 *
 * Only DB + AI chat (input conditions) are mocked; real route logic runs.
 * Regression pins only — NOT the E2E-on-dev gate.
 */
const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();
const scoreComponentWrites = [];
let userSkillRows = [];
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

const polsia = require('../../lib/polsia-ai');
const candidateRouter = require('../../routes/candidate');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/candidate', candidateRouter);
	return app;
}

beforeEach(() => {
	jest.clearAllMocks();
	scoreComponentWrites.length = 0;
	userSkillRows = [];
	mockQuery.mockImplementation(async (sql, params) => {
		if (sql.includes('INSERT INTO score_components')) {
			scoreComponentWrites.push(params);
			return { rows: [] };
		}
		if (sql.includes('FROM jobs WHERE id')) {
			return {
				rows: [
					{ id: 3, title: 'Backend Engineer', description: 'Build', requirements: 'Node.js', screening_questions: [] },
				],
			};
		}
		if (sql.includes('FROM jobs j')) {
			return {
				rows: [
					{ id: 11, title: 'Node Dev', requirements: 'Node.js experience', description: '', status: 'active' },
					{ id: 12, title: 'Other Dev', requirements: 'Python', description: '', status: 'active' },
				],
			};
		}
		if (sql.includes('candidate_skills')) return { rows: userSkillRows };
		if (sql.includes('candidate_profiles')) {
			return { rows: [{ user_id: 7, name: 'Test Candidate', headline: 'Dev', resume_url: 'r.pdf' }] };
		}
		return { rows: [] };
	});
});

describe('#1377 routes/candidate.js — fabricated 50 fallbacks', () => {
	test('resume-score: unparseable AI output → overall_score null and NO OmniScore write', async () => {
		polsia.chat.mockResolvedValue('the model said something unparseable');
		const res = await request(buildApp()).post('/api/candidate/ai/resume-score').send({});
		expect(res.status).toBe(200);
		expect(res.body.score.overall_score).toBeNull();
		expect(scoreComponentWrites).toHaveLength(0);
	});

	test('resume-score (positive control): real AI score 80 → returned and 32 points written', async () => {
		polsia.chat.mockResolvedValue(
			JSON.stringify({ overall_score: 80, sections: {}, top_improvements: [], ats_friendly: true }),
		);
		const res = await request(buildApp()).post('/api/candidate/ai/resume-score').send({});
		expect(res.status).toBe(200);
		expect(res.body.score.overall_score).toBe(80);
		expect(scoreComponentWrites).toHaveLength(1);
		expect(scoreComponentWrites[0][1]).toBe(32);
	});

	test.each([
		['boolean true', { overall_score: true }],
		['out-of-range 150', { overall_score: 150 }],
		['negative -20', { overall_score: -20 }],
		['missing key', { sections: {} }],
		['array [80]', { overall_score: [80] }],
	])('resume-score guard: %s → NO OmniScore write', async (_label, payload) => {
		polsia.chat.mockResolvedValue(JSON.stringify(payload));
		const res = await request(buildApp()).post('/api/candidate/ai/resume-score').send({});
		expect(res.status).toBe(200);
		expect(scoreComponentWrites).toHaveLength(0);
	});

	test("resume-score guard: numeric string '80' → accepted as a real score, 32 points written", async () => {
		polsia.chat.mockResolvedValue(JSON.stringify({ overall_score: '80' }));
		const res = await request(buildApp()).post('/api/candidate/ai/resume-score').send({});
		expect(res.status).toBe(200);
		expect(scoreComponentWrites).toHaveLength(1);
		expect(scoreComponentWrites[0][1]).toBe(32);
	});

	test('application-review: unparseable AI output → completeness null, NOT ready to submit', async () => {
		polsia.chat.mockResolvedValue('unparseable');
		const res = await request(buildApp())
			.post('/api/candidate/ai/application-review')
			.send({ job_id: 3, cover_letter: 'Hello', screening_answers: {} });
		expect(res.status).toBe(200);
		expect(res.body.review.completeness_score).toBeNull();
		expect(res.body.review.ready_to_submit).toBe(false);
	});

	test('smart-search: candidate with no skills → relevance_score null, never 50', async () => {
		polsia.chat.mockResolvedValue(JSON.stringify({ keywords: ['dev'] }));
		const res = await request(buildApp())
			.post('/api/candidate/ai/smart-search')
			.send({ query: 'developer jobs' });
		expect(res.status).toBe(200);
		expect(res.body.jobs).toHaveLength(2);
		for (const job of res.body.jobs) expect(job.relevance_score).toBeNull();
	});

	test('smart-search (positive control): matching skill → computed relevance, not null', async () => {
		userSkillRows = [{ skill_name: 'Node.js' }];
		polsia.chat.mockResolvedValue(JSON.stringify({ keywords: ['dev'] }));
		const res = await request(buildApp())
			.post('/api/candidate/ai/smart-search')
			.send({ query: 'developer jobs' });
		expect(res.status).toBe(200);
		const nodeJob = res.body.jobs.find((j) => j.id === 11);
		expect(nodeJob.relevance_score).toBe(100);
	});
});
