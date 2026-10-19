/**
 * Issue #1463 — POST /api/candidate/ai/match-explanation must not embed the
 * recruiter-side match_explanation JSONB (company TrustScore text) in the
 * candidate-facing LLM prompt.
 *
 * Privacy seat (Scout design lane, #1463): the fix is STRIP, don't filter —
 * allowlist the match_results SELECT and delete the prompt line. No output
 * denylist, no JSONB sub-field filtering (both rejected: paraphrase defeats
 * string filters; any denylist/filter reintroduces the future-key risk).
 *
 * Pattern copied from candidate-one-click-apply.test.js (route-level mocks)
 * and the #1458 SQL pin in score-explainer-match-results-1458.test.js.
 */

const request = require('supertest');
const express = require('express');

// ─── Auth bypass ────────────────────────────────────────────────────────────
jest.mock('../../../lib/auth', () => {
	const actual = jest.requireActual('../../../lib/auth');
	const authMiddleware = jest.fn((req, res, next) => {
		req.user = { id: 1, email: 'test@example.com' };
		return next();
	});
	return { ...actual, authMiddleware };
});

// ─── Rate limit bypass ──────────────────────────────────────────────────────
jest.mock('../../../lib/distributed-rate-limiter', () => {
	const passthrough = (req, res, next) => next();
	return {
		rateLimits: { ai: passthrough, standard: passthrough, strict: passthrough, lenient: passthrough },
		distributedRateLimiter: { check: jest.fn() },
	};
});

// ─── AI mock: capture the prompt ────────────────────────────────────────────
const mockChat = jest.fn();
jest.mock('../../../lib/polsia-ai', () => {
	const actual = jest.requireActual('../../../lib/polsia-ai');
	return { ...actual, chat: (...args) => mockChat(...args) };
});

// ─── DB mock: capture queries ───────────────────────────────────────────────
const mockQuery = jest.fn();
jest.mock('../../../lib/db', () => ({
	query: (...args) => mockQuery(...args),
	pool: { query: (...args) => mockQuery(...args) },
}));

const candidateRoutes = require('../../../routes/candidate');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/candidate', candidateRoutes);
	return app;
}

const EXPLANATION_JSON = JSON.stringify({
	explanation: 'Strong skills overlap for this role.',
	match_level: 'good',
	dimensions: { skills: { score: 82, detail: 'Most required skills present' } },
	skill_gaps: ['Go'],
	action_items: ['Highlight your Node.js project work'],
});

// Canary match row: match_explanation carries recruiter-side TrustScore /
// OmniScore text that must never reach the candidate-facing prompt.
const CANARY_MATCH_ROW = {
	weighted_score: 82,
	similarity_score: 0.77,
	match_level: 'good',
	matching_skills: ['Node.js', 'PostgreSQL'],
	missing_skills: ['Go'],
	match_explanation: {
		company_trustscore: 'Company TrustScore 987',
		omniscore_boost: 'OmniScore 987',
	},
	trustscore_at_match: 987,
	omniscore_at_match: 987,
	title: 'Backend Engineer',
	company: 'Acme',
	requirements: 'Node.js, PostgreSQL',
	description: 'Build APIs',
	location: 'Remote',
	salary_range: '$120k-$150k',
};

function routeMock({ matchRows = [CANARY_MATCH_ROW] } = {}) {
	mockQuery.mockImplementation((sql) => {
		if (sql.includes('FROM match_results')) {
			return Promise.resolve({ rows: matchRows });
		}
		if (sql.includes('candidate_profiles')) {
			return Promise.resolve({
				rows: [{ name: 'Test User', years_experience: 5, location: 'Remote' }],
			});
		}
		if (sql.includes('candidate_skills')) {
			return Promise.resolve({ rows: [{ skill_name: 'Node.js', level: 'advanced' }] });
		}
		return Promise.resolve({ rows: [] });
	});
}

describe('POST /api/candidate/ai/match-explanation (#1463)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		routeMock();
		mockChat.mockResolvedValue(EXPLANATION_JSON);
	});

	test('(a) prompt-capture canary: TrustScore artifact never enters the LLM prompt', async () => {
		const res = await request(makeApp())
			.post('/api/candidate/ai/match-explanation')
			.send({ job_id: 42 });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.explanation).toBe('Strong skills overlap for this role.');

		expect(mockChat).toHaveBeenCalledTimes(1);
		const prompt = mockChat.mock.calls[0][0];
		// canary / artifact must be absent
		expect(prompt).not.toContain('TrustScore');
		expect(prompt).not.toContain('987');
		expect(prompt).not.toContain('match_explanation');
		expect(prompt).not.toContain('omniscore_boost');
		// candidate-safe match data must still be present
		expect(prompt).toContain('82'); // weighted_score
		expect(prompt).toContain('Node.js'); // matching_skills
		expect(prompt).toContain('Go'); // missing_skills
	});

	test('(b) SQL pin: match_results query is allowlisted (no mr.*, no match_explanation)', async () => {
		await request(makeApp()).post('/api/candidate/ai/match-explanation').send({ job_id: 42 });

		const matchCall = mockQuery.mock.calls.find(([sql]) => sql.includes('FROM match_results'));
		expect(matchCall).toBeDefined();
		const sql = matchCall[0];
		expect(sql).not.toContain('mr.*');
		expect(sql).not.toContain('match_explanation');
		expect(sql).not.toContain('trustscore_at_match');
		expect(sql).not.toContain('omniscore_at_match');
		for (const col of [
			'mr.weighted_score',
			'mr.similarity_score',
			'mr.match_level',
			'mr.matching_skills',
			'mr.missing_skills',
		]) {
			expect(sql).toContain(col);
		}
	});

	test('(c) no-match-row regression: still returns a generated explanation', async () => {
		routeMock({ matchRows: [] });
		const res = await request(makeApp())
			.post('/api/candidate/ai/match-explanation')
			.send({ job_id: 42 });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.explanation).toBe('Strong skills overlap for this role.');
		expect(mockChat).toHaveBeenCalledTimes(1);
		const prompt = mockChat.mock.calls[0][0];
		expect(prompt).not.toContain('TrustScore');
		expect(prompt).not.toContain('match_explanation');
	});
});
