/**
 * #1192 — honest-null TrustScore contract (service + payload routes).
 *
 * A company with ZERO trust_score_components rows must read score null on
 * every trust payload — never the STARTING 500, never the recomputed 0.
 * A company WITH component rows computes exactly as before (regression).
 */
const request = require('supertest');
const express = require('express');

// ─── Stateful in-memory trust_scores / components mock ──────────────────────
const mockState = { trustRow: null, components: [] };

function mockDbQuery(sql, params = []) {
	if (sql.includes('FROM omni_scores os')) {
		return Promise.resolve({ rows: [] }); // heal-script omni scan: no omni rows in this suite
	}
	if (sql.includes('FROM trust_scores') && sql.includes('AS id')) {
		// heal-script scan
		return Promise.resolve({ rows: mockState.trustRow ? [{ id: 42 }] : [] });
	}
	if (sql.includes('JOIN trust_scores') && sql.includes('c.slug')) {
		// public-by-slug direct read: companies JOIN trust_scores … WHERE c.slug
		return Promise.resolve({
			rows: [
				{
					id: 42,
					company_name: 'Fresh Co',
					name: 'Fresh Co',
					slug: 'fresh-co',
					is_verified: false,
					total_score: mockState.trustRow ? mockState.trustRow.total_score : null,
					score_tier: mockState.trustRow ? mockState.trustRow.score_tier : null,
					verification_score: 0,
					response_score: 0,
					feedback_score: 0,
				},
			],
		});
	}
	if (sql.includes('INSERT INTO trust_scores')) {
		const total = sql.includes('$2') ? params[1] : null;
		mockState.trustRow = { company_id: params[0], total_score: total, score_tier: 'new' };
		return Promise.resolve({ rows: [mockState.trustRow] });
	}
	if (sql.includes('SELECT * FROM trust_scores')) {
		return Promise.resolve({ rows: mockState.trustRow ? [mockState.trustRow] : [] });
	}
	if (sql.includes('UPDATE trust_scores')) {
		if (mockState.trustRow) mockState.trustRow = { ...mockState.trustRow, total_score: params[0] };
		return Promise.resolve({ rows: [] });
	}
	if (sql.includes('FROM trust_score_components') && sql.includes('GROUP BY component_type')) {
		const byType = {};
		for (const c of mockState.components) {
			byType[c.component_type] = byType[c.component_type] || { points: 0, max_points: 0 };
			byType[c.component_type].points += c.points;
			byType[c.component_type].max_points += c.max_points;
		}
		return Promise.resolve({
			rows: Object.entries(byType).map(([component_type, v]) => ({
				component_type,
				decayed_points: String(v.points),
				max_points: String(v.max_points),
			})),
		});
	}
	if (sql.includes('SELECT COUNT(*) as count FROM trust_score_components')) {
		return Promise.resolve({ rows: [{ count: String(mockState.components.length) }] });
	}
	if (sql.includes('FROM companies')) {
		return Promise.resolve({
			rows: [{ id: 42, name: 'Fresh Co', slug: 'fresh-co', is_verified: false }],
		});
	}
	// Generic aggregate row satisfying the v2 factor calculators.
	return Promise.resolve({
		rows: [
			{
				count: '0',
				avg_rating: null,
				accepted: '0',
				sent: '0',
				total: '0',
				responded: '0',
				distinct_locations: '0',
				total_ratings: '0',
				total_applications: '0',
			},
		],
	});
}

jest.mock('../../lib/db', () => ({
	query: jest.fn((...a) => mockDbQuery(...a)),
	connect: jest.fn(async () => ({ query: jest.fn(async () => ({ rows: [] })), release: jest.fn() })),
}));

jest.mock('../../lib/polsia-ai', () => ({ chat: jest.fn(async () => '') }));

jest.mock('../../lib/auth', () => ({
	authMiddleware: jest.fn((req, _res, next) => {
		req.user = { id: 7, role: 'recruiter', company_id: 42 };
		return next();
	}),
	requireApprovedRecruiter: jest.fn((_req, _res, next) => next()),
	requireNotSuspended: jest.fn((_req, _res, next) => next()),
}));

jest.mock('../../middleware/rbac', () => ({
	requirePermission: jest.fn(() => (_req, _res, next) => next()),
}));
jest.mock('../../middleware/dataAccessAudit', () => ({
	dataAccessAudit: jest.fn(() => (_req, _res, next) => next()),
}));

const pool = require('../../lib/db');
const trustscoreService = require('../../services/trustscore');
const trustscoreRouter = require('../../routes/trustscore');
const omniscoreRouter = require('../../routes/omniscore');
const recruiterRouter = require('../../routes/recruiter');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/trustscore', trustscoreRouter);
	app.use('/api/omniscore', omniscoreRouter);
	app.use('/api/recruiter', recruiterRouter);
	return app;
}

beforeEach(() => {
	mockState.trustRow = null;
	mockState.components = [];
	pool.query.mockImplementation((...a) => mockDbQuery(...a));
});

describe('#1192 TrustScore service — zero-component company', () => {
	test('getOrCreate + calculate → total null, and the stored row is not 500 or 0', async () => {
		await trustscoreService.getOrCreateTrustScore(42);
		const score = await trustscoreService.calculateTrustScore(42);
		expect(score.total_score).toBeNull();
		expect(score.tier).toBeNull();
		expect(score.tier_label).toBeNull();
		expect(mockState.trustRow.total_score).toBeNull();
	});

	test('calculateTrustScoreV2 → total_score and v1_score null for zero components', async () => {
		await trustscoreService.getOrCreateTrustScore(42);
		const v2 = await trustscoreService.calculateTrustScoreV2(42);
		expect(v2.total_score).toBeNull();
		expect(v2.v1_score).toBeNull();
		expect(mockState.trustRow.total_score).toBeNull();
	});

	test('getTrustScoreBreakdown → current and v2 totals null', async () => {
		const bd = await trustscoreService.getTrustScoreBreakdown(42);
		expect(bd.current.total_score).toBeNull();
		expect(bd.v2.total_score).toBeNull();
	});
});

describe('#1192 TrustScore service — with-components regression', () => {
	test('one verification component (50/50) computes exactly the pre-fix scores', async () => {
		mockState.components = [
			{ component_type: 'verification', points: 50, max_points: 50 },
		];
		const score = await trustscoreService.calculateTrustScore(42);
		expect(score.total_score).toBe(200);
		expect(score.verification).toBe(200);
		expect(score.tier).toBe('new');
		expect(score.tier_label).toBe('New Employer');
		const v2 = await trustscoreService.calculateTrustScoreV2(42);
		// Pre-fix behaviour (verified on dev): the return spreads ...v1 after
		// total_score, so the served v2 total is the v1 total, 200.
		expect(v2.total_score).toBe(200);
		expect(v2.v1_score).toBe(200);
	});
});

describe('#1192 TrustScore payload routes — fresh company', () => {
	test('GET /trustscore → trustscore.total_score null', async () => {
		const res = await request(buildApp()).get('/api/trustscore');
		expect(res.status).toBe(200);
		expect(res.body.trustscore.total_score).toBeNull();
	});

	test('GET /omniscore/company-dashboard → trust_score.score null', async () => {
		const res = await request(buildApp()).get('/api/omniscore/company-dashboard');
		expect(res.status).toBe(200);
		expect(res.body.trust_score.score).toBeNull();
	});

	test('GET /omniscore/company-score/:companyId → trust_score.score null', async () => {
		const res = await request(buildApp()).get('/api/omniscore/company-score/42');
		expect(res.status).toBe(200);
		expect(res.body.trust_score.score).toBeNull();
	});

	test('GET /recruiter/dashboard → trust_score.total_score null', async () => {
		const res = await request(buildApp()).get('/api/recruiter/dashboard');
		expect(res.status).toBe(200);
		expect(res.body.trust_score.total_score).toBeNull();
	});

	test('GET /trustscore/company/:id/public → score null AND tier_label null (no verdict label on a null), insufficient_data true', async () => {
		const res = await request(buildApp()).get('/api/trustscore/company/42/public');
		expect(res.status).toBe(200);
		expect(res.body.trustscore.score).toBeNull();
		expect(res.body.trustscore.tier).toBeNull();
		expect(res.body.trustscore.tier_label).toBeNull();
		expect(res.body.trustscore.insufficient_data).toBe(true);
	});
});

describe('#1192 legacy persisted trust rows — heal script (engine-arbitrated recompute)', () => {
	// Code-review gate delta: a STARTING-500 row written before the fix is
	// served verbatim by direct reads (public-by-slug) until healed.
	const loadHeal = () => require('../../scripts/recompute-honest-null-scores').recomputeHonestNullScores;

	test('dry-run: legacy 500 counted as would-null, nothing written', async () => {
		mockState.trustRow = { company_id: 42, total_score: 500, score_tier: 'new' };
		const report = await loadHeal()({ live: false });
		expect(report.trust).toEqual({ scanned: 1, would_null: 1, would_keep_number: 0, skipped: 0 });
		expect(mockState.trustRow.total_score).toBe(500);
	});

	test('live heal: legacy 500, zero components → public-by-slug payload score null', async () => {
		mockState.trustRow = { company_id: 42, total_score: 500, score_tier: 'new' };
		const before = await request(buildApp()).get('/api/trustscore/public/fresh-co');
		expect(before.body.trustscore.score).toBe(500); // the defect, pre-heal
		const report = await loadHeal()({ live: true });
		expect(report.trust.would_null).toBe(1);
		const after = await request(buildApp()).get('/api/trustscore/public/fresh-co');
		expect(after.body.trustscore.score).toBeNull();
	});

	test('live heal: a genuine row keeps its exact engine number (200, not erased)', async () => {
		mockState.components = [{ component_type: 'verification', points: 50, max_points: 50 }];
		mockState.trustRow = { company_id: 42, total_score: 200, score_tier: 'new' };
		const report = await loadHeal()({ live: true });
		expect(report.trust.would_keep_number).toBe(1);
		const after = await request(buildApp()).get('/api/trustscore/public/fresh-co');
		expect(after.body.trustscore.score).toBe(200);
	});
});
