/**
 * #1271: company-matches fabricated '50' AI-match fallback (honest-null).
 *
 * routes/candidate-company-matches.js GET / used
 *   match_score: typeof aiMatch.match_score === 'number' ? aiMatch.match_score : 50
 * Whenever the AI batch omitted a company, returned a non-number, or
 * returned unparseable output, that company (or every company) got a
 * fabricated 50, was sorted on it, and rendered it as a real "% Match
 * Score". Honest contract: no AI score → match_score null (never 0 — the
 * AI's silence says nothing about merit), scored companies sort first.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((req, _res, next) => {
		req.user = { id: req.headers['x-test-user'] ? Number(req.headers['x-test-user']) : 7, role: 'candidate' };
		return next();
	}),
}));

jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
	connect: jest.fn(),
}));

jest.mock('../../../lib/ai-provider', () => ({
	chatCompletion: jest.fn(),
}));

jest.mock('../../../services/matching-engine', () => ({
	buildCandidateProfileText: jest.fn(() => 'Candidate profile text'),
}));

const pool = require('../../../lib/db');
const aiProvider = require('../../../lib/ai-provider');
const matchesRouter = require('../../../routes/candidate-company-matches');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/candidate/company-matches', matchesRouter);
	return app;
}

const companies = [
	{ id: 1, name: 'Alpha', description: 'a', industry: 'Tech', company_size: '11-50', headquarters: 'Remote', logo_url: null },
	{ id: 2, name: 'Beta', description: 'b', industry: 'Tech', company_size: '51-200', headquarters: 'Remote', logo_url: null },
	{ id: 3, name: 'Gamma', description: 'g', industry: 'Tech', company_size: '1-10', headquarters: 'Remote', logo_url: null },
];

function mockDb() {
	const client = {
		query: jest.fn(async (sql) => {
			if (sql.includes('FROM users')) {
				return { rows: [{ id: 7, name: 'Test Candidate', email: 't@example.com', headline: 'Engineer' }] };
			}
			return { rows: [] };
		}),
		release: jest.fn(),
	};
	pool.connect.mockResolvedValue(client);
	pool.query.mockImplementation(async (sql) => {
		if (sql.includes('COUNT(*) as total')) return { rows: [{ total: String(companies.length) }] };
		if (sql.includes('FROM companies')) return { rows: companies };
		return { rows: [] };
	});
}

describe('company-matches honest match_score (#1271)', () => {
	beforeEach(() => jest.clearAllMocks());

	it('AI omits a company → its match_score is null, never the fabricated 50; scored sort first', async () => {
		mockDb();
		aiProvider.chatCompletion.mockResolvedValue(
			JSON.stringify([
				{ company_id: 2, match_score: 88, value_hook: 'h', match_reason: 'r', outreach_difficulty: 'easy' },
				{ company_id: 3, match_score: 40, value_hook: 'h', match_reason: 'r', outreach_difficulty: 'hard' },
			]),
		);
		const res = await request(buildApp()).get('/api/candidate/company-matches').set('x-test-user', '101');
		expect(res.status).toBe(200);
		expect(res.body.matches.map((m) => m.id)).toEqual([2, 3, 1]);
		const alpha = res.body.matches.find((m) => m.id === 1);
		expect(alpha.match_score).toBeNull();
		expect(JSON.stringify(res.body)).not.toContain('"match_score":50');
		const beta = res.body.matches.find((m) => m.id === 2);
		expect(beta.match_score).toBe(88);
	});

	it('AI returns unparseable output → every match_score is null, none fabricated', async () => {
		mockDb();
		aiProvider.chatCompletion.mockResolvedValue('not json at all');
		const res = await request(buildApp()).get('/api/candidate/company-matches').set('x-test-user', '102');
		expect(res.status).toBe(200);
		expect(res.body.matches).toHaveLength(3);
		for (const m of res.body.matches) expect(m.match_score).toBeNull();
	});

	it('a real AI score of 0 stays 0 (not a missing score)', async () => {
		mockDb();
		aiProvider.chatCompletion.mockResolvedValue(
			JSON.stringify([
				{ company_id: 1, match_score: 0, value_hook: 'h', match_reason: 'r', outreach_difficulty: 'easy' },
			]),
		);
		const res = await request(buildApp()).get('/api/candidate/company-matches').set('x-test-user', '103');
		expect(res.status).toBe(200);
		const alpha = res.body.matches.find((m) => m.id === 1);
		expect(alpha.match_score).toBe(0);
		// A real 0 sorts ahead of the unscored (null) companies, not with them.
		expect(res.body.matches[0].id).toBe(1);
		expect(res.body.matches.slice(1).every((m) => m.match_score === null)).toBe(true);
	});
});
