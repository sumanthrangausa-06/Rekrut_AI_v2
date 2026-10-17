/**
 * NOVA — #1222: TrustScore page unusable for company owner.
 *
 * routes/trustscore.js had a private requireRecruiter allowing
 * ['recruiter','hiring_manager','admin'] only, so a company owner
 * (role 'employer', with company_id) got 403 "Recruiter access required"
 * on all four calls the TrustScore page makes:
 *   GET /api/trustscore, /breakdown, /assessment-responsiveness, /standalone
 *
 * Every sibling guard already includes 'employer': lib/auth.js
 * requireApprovedRecruiter, routes/communications.js, routes/notifications.js,
 * routes/panels.js, routes/aptitude.js (RECRUITER_ROLES), middleware/rbac.js.
 *
 * The fix must NOT widen access beyond that pattern: a candidate, and an
 * employer with no company_id, must still be denied.
 */

const request = require('supertest');
const express = require('express');

// Mutable holder so each test can act as a different user.
// (jest.mock factories may only reference `mock`-prefixed variables.)
const mockState = { user: { id: 7, role: 'employer', company_id: 42 } };

jest.mock('../../../lib/auth', () => ({
	// Mirrors the real guards for the users under test: an authenticated
	// user is attached; requireApprovedRecruiter already allows 'employer'
	// (lib/auth.js) and only blocks recruiter-tier users with no company
	// who are not platform admins — not the case exercised here.
	authMiddleware: jest.fn((req, _res, next) => {
		req.user = mockState.user;
		return next();
	}),
	requireApprovedRecruiter: jest.fn((_req, _res, next) => next()),
}));

jest.mock('../../../lib/db', () => ({ query: jest.fn(async () => ({ rows: [] })) }));

jest.mock('../../../services/trustscore', () => ({
	TRUST_SCORE_RANGES: { TIERS: {} },
	getOrCreateTrustScore: jest.fn(async () => ({})),
	calculateTrustScore: jest.fn(async () => ({ total_score: 500, tier: 'silver' })),
	getTrustScoreBreakdown: jest.fn(async () => ({ breakdown: {} })),
	calculateTrustScoreV2: jest.fn(async () => ({})),
	generateTrustRecommendations: jest.fn(() => []),
	generateV2ImprovementGuidance: jest.fn(() => []),
	calculateAssessmentResponsiveness: jest.fn(async () => ({ sufficient: true, score: 80 })),
	getLeaderboard: jest.fn(async () => ({})),
	compareCompanies: jest.fn(async () => ({})),
	generateAISummary: jest.fn(async () => 'summary'),
	detectReviewBrigading: jest.fn(async () => ({})),
	getMethodology: jest.fn(async () => ({})),
	buildBadges: jest.fn(() => []),
}));

jest.mock('../../../services/trustscore-standalone', () => {
	const metric = jest.fn(async () => ({ sufficient: false }));
	return {
		calculateWorkplaceCulture: metric,
		calculateCandidateNPS: metric,
		calculateReapplicationRate: metric,
		calculateCommunicationResponsiveness: metric,
		calculateOfferDeclineAnalysis: metric,
		calculatePostingEfficiency: metric,
		calculateStageFluidity: metric,
		getRecentReviews: metric,
	};
});

const trustscoreRouter = require('../../../routes/trustscore');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/trustscore', trustscoreRouter);
	return app;
}

const PAGE_CALLS = [
	'/api/trustscore',
	'/api/trustscore/breakdown',
	'/api/trustscore/assessment-responsiveness',
	'/api/trustscore/standalone',
];

describe('#1222 TrustScore employer (company owner) access', () => {
	beforeEach(() => jest.clearAllMocks());

	describe('company owner — role employer WITH company_id', () => {
		beforeEach(() => {
			mockState.user = { id: 7, role: 'employer', company_id: 42 };
		});

		it.each(PAGE_CALLS)('GET %s does not 403', async (path) => {
			const res = await request(buildApp()).get(path);
			expect(res.status).not.toBe(403);
			expect(res.status).toBe(200);
		});
	});

	describe('existing allowed roles keep working', () => {
		it.each([
			'recruiter',
			'hiring_manager',
			'admin',
		])('role %s still passes GET /api/trustscore', async (role) => {
			mockState.user = { id: 8, role, company_id: 42 };
			const res = await request(buildApp()).get('/api/trustscore');
			expect(res.status).toBe(200);
		});
	});

	describe('access must NOT widen', () => {
		it.each(PAGE_CALLS)('candidate (even with a company_id) still 403s on GET %s', async (path) => {
			mockState.user = { id: 9, role: 'candidate', company_id: 42 };
			const res = await request(buildApp()).get(path);
			expect(res.status).toBe(403);
			expect(res.body.error).toBe('Recruiter access required');
		});

		it.each(PAGE_CALLS)('employer WITHOUT company_id still 403s on GET %s', async (path) => {
			mockState.user = { id: 10, role: 'employer', company_id: null };
			const res = await request(buildApp()).get(path);
			expect(res.status).toBe(403);
			expect(res.body.error).toBe('Recruiter access required');
		});
	});
});
