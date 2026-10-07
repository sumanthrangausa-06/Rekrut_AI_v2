/**
 * Issue #247: POST /api/candidate/ai/one-click-apply
 *
 * The frontend (job-detail.tsx:507) calls this endpoint to generate tailored
 * resume, cover letter, and match analysis. It was never implemented.
 * This endpoint does NOT submit the application — frontend submits separately.
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

// ─── AI mock ────────────────────────────────────────────────────────────────
const mockChat = jest.fn();
jest.mock('../../../lib/polsia-ai', () => ({
	chat: (...args) => mockChat(...args),
}));

// ─── DB mock ────────────────────────────────────────────────────────────────
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

const TAILORED_JSON = JSON.stringify({
	resume: 'Tailored resume text',
	cover_letter: 'Tailored cover letter',
	match_summary: 'Great match',
	key_strengths: ['Python', 'SQL', 'Leadership'],
	why_fit: 'Perfect fit because...',
});

describe('POST /api/candidate/ai/one-click-apply', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		// Default: profile, skills, experience, education, job all return rows
		mockQuery.mockImplementation((sql) => {
			if (sql.includes('FROM jobs WHERE id')) {
				return Promise.resolve({
					rows: [{ title: 'Data Analyst', company: 'Acme', description: 'desc', requirements: 'req' }],
				});
			}
			if (sql.includes('candidate_profiles')) {
				return Promise.resolve({ rows: [{ name: 'Test User', email: 'test@example.com' }] });
			}
			return Promise.resolve({ rows: [] });
		});
		mockChat.mockResolvedValue(TAILORED_JSON);
	});

	test('returns 400 when job_id is missing', async () => {
		const res = await request(makeApp())
			.post('/api/candidate/ai/one-click-apply')
			.send({});
		expect(res.status).toBe(400);
		expect(res.body.error).toMatch(/job_id/i);
	});

	test('returns 404 when job not found', async () => {
		mockQuery.mockImplementation((sql) => {
			if (sql.includes('FROM jobs WHERE id')) {
				return Promise.resolve({ rows: [] });
			}
			return Promise.resolve({ rows: [{ name: 'Test' }] });
		});
		const res = await request(makeApp())
			.post('/api/candidate/ai/one-click-apply')
			.send({ job_id: 999 });
		expect(res.status).toBe(404);
	});

	test('returns tailored documents on success', async () => {
		const res = await request(makeApp())
			.post('/api/candidate/ai/one-click-apply')
			.send({ job_id: 1 });
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.tailored.resume).toBe('Tailored resume text');
		expect(res.body.tailored.cover_letter).toBe('Tailored cover letter');
		expect(res.body.tailored.match_summary).toBe('Great match');
		expect(res.body.tailored.key_strengths).toEqual(['Python', 'SQL', 'Leadership']);
		expect(res.body.tailored.why_fit).toBe('Perfect fit because...');
	});

	test('handles malformed AI JSON gracefully', async () => {
		mockChat.mockResolvedValue('not json at all');
		const res = await request(makeApp())
			.post('/api/candidate/ai/one-click-apply')
			.send({ job_id: 1 });
		expect(res.status).toBe(500);
	});
});
