/**
 * #1271: mutual-matches fabricated '50' match fallback (honest-null).
 *
 * routes/omniscore.js GET /mutual-matches used
 *   const matchStrength = (row.match_score || 50) / 100;
 * row.match_score is mr.weighted_score from a LEFT JOIN match_results —
 * NULL for a candidate who applied but has no match row (and a real 0 was
 * also masked to 50). The fabricated 0.5 fed the geometric-mean
 * mutual_fit_score rendered as "% Mutual Fit". Sibling lie:
 * signals.skill_match rendered "0% match" for a NULL match_score.
 *
 * Honest contract (in-function #1192 precedent): a NULL match contributes
 * 0 strength (same as NULL candidate/company scores in this function, and
 * the SQL ORDER BY already ranks NULL match as 0); skill_match renders
 * "Insufficient data". Real values — including a real 0 — pass through.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((req, _res, next) => {
		req.user = { id: 7, role: 'candidate' };
		return next();
	}),
}));

jest.mock('../../../lib/db', () => ({ query: jest.fn() }));

jest.mock('../../../services/omniscore', () => ({
	getOrCreateScore: jest.fn(async () => ({})),
	calculateScore: jest.fn(async () => ({ total_score: 630, tier_label: 'Good' })),
	SCORE_RANGES: {},
}));

jest.mock('../../../services/trustscore', () => ({
	getOrCreateTrustScore: jest.fn(async () => ({})),
	calculateTrustScore: jest.fn(async () => ({})),
	TRUST_SCORE_RANGES: { TIERS: {} },
	generateTrustRecommendations: jest.fn(() => []),
	addFeedbackComponent: jest.fn(async () => {}),
}));

jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: { log: jest.fn(async () => {}) },
}));

const pool = require('../../../lib/db');
const omniscoreRouter = require('../../../routes/omniscore');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/omniscore', omniscoreRouter);
	return app;
}

const matchRow = (overrides = {}) => ({
	job_id: 11,
	title: 'Engineer',
	location: 'Remote',
	salary_range: null,
	job_type: 'Full-time',
	company_id: 42,
	company_name: 'Acme Inc',
	logo_url: null,
	industry: 'Technology',
	is_verified: true,
	company_trust_score: 800,
	company_tier: 'trusted',
	application_status: 'applied',
	match_score: null,
	match_level: null,
	avg_company_rating: '0',
	rating_count: '0',
	...overrides,
});

// Fixture arithmetic: candidateStrength = (630 - 300) / 550 = 0.6,
// companyStrength = 800 / 1000 = 0.8.
// Fabricated 50 → matchStrength 0.5 → fit = round((0.6*0.8*0.5)^(1/3)*100) = 62.
// Real 90 → 0.9 → fit = round((0.6*0.8*0.9)^(1/3)*100) = 76.

describe('mutual-matches honest match_score (#1271)', () => {
	beforeEach(() => jest.clearAllMocks());

	it('applied but never matched (match_score NULL) → no fabricated fit, honest skill_match', async () => {
		pool.query.mockResolvedValue({ rows: [matchRow()] });
		const res = await request(buildApp()).get('/api/omniscore/mutual-matches');
		expect(res.status).toBe(200);
		const [match] = res.body.mutual_matches;
		expect(match.mutual_fit_score).toBe(0);
		expect(match.mutual_fit_score).not.toBe(62);
		expect(match.mutual_level).toBe('low');
		expect(match.signals.skill_match).toBe('Insufficient data');
		expect(match.signals.skill_match).not.toContain('0%');
	});

	it('a real match_score of 0 is not masked to 50', async () => {
		pool.query.mockResolvedValue({ rows: [matchRow({ match_score: 0 })] });
		const res = await request(buildApp()).get('/api/omniscore/mutual-matches');
		expect(res.status).toBe(200);
		const [match] = res.body.mutual_matches;
		expect(match.mutual_fit_score).toBe(0);
		expect(match.signals.skill_match).toBe('0% match');
	});

	it('a real match_score passes through unchanged (90 → fit 76, "90% match")', async () => {
		pool.query.mockResolvedValue({ rows: [matchRow({ match_score: '90.00' })] });
		const res = await request(buildApp()).get('/api/omniscore/mutual-matches');
		expect(res.status).toBe(200);
		const [match] = res.body.mutual_matches;
		expect(match.mutual_fit_score).toBe(76);
		expect(match.signals.skill_match).toBe('90% match');
	});
});
