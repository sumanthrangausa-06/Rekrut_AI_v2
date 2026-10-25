/**
 * #1787 — stored omni_scores.score_tier is the METAL encoding of the API
 * tier label (592 → stored 'bronze', API label 'Fair'). The writer is
 * correct and must not change; the defect is reader-side: surfaces that
 * consume the stored metal as if it were the label vocabulary.
 *
 * Real-DB suite (HL-003): runs against a fresh-install Postgres built
 * ONLY by `node migrate.js`; reader surfaces are exercised over real
 * HTTP (supertest against the real routers, real lib/db). Only auth is
 * mocked (req.user injection, the recruiter-1731 lane pattern).
 *
 * Example:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55492/nova1787 node migrate.js
 *   OMNISCORE1787_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55492/nova1787' \
 *     npx jest server/__tests__/omniscore-tier-label-readers-1787-realdb.test.js --forceExit
 */
jest.unmock('../../lib/db');

const mockCurrentUser = { id: 178799, role: 'recruiter', company_id: null };
jest.mock('../../lib/auth', () => {
	const actual = jest.requireActual('../../lib/auth');
	const authMiddleware = jest.fn((req, _res, next) => {
		req.user = { ...mockCurrentUser };
		return next();
	});
	return { ...actual, authMiddleware };
});
jest.mock('../../lib/distributed-rate-limiter', () => {
	const passthrough = (_req, _res, next) => next();
	return {
		rateLimits: { ai: passthrough, standard: passthrough, strict: passthrough, lenient: passthrough },
		distributedRateLimiter: { check: jest.fn(async () => ({ allowed: true })) },
		DistributedRateLimiter: class {
			async checkLimit() {
				return { allowed: true };
			}
		},
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

const request = require('supertest');
const express = require('express');
const { Pool } = require('pg');

const DB_URL = process.env.OMNISCORE1787_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

// Band edges: [userId, total, storedMetal, expectedLabelKey]
const EDGES = [
	[178701, 850, 'platinum', 'exceptional'],
	[178702, 799, 'gold', 'excellent'],
	[178703, 739, 'silver', 'good'],
	[178704, 592, 'bronze', 'fair'],
	[178705, 579, 'new', 'needs_work'],
];
const RECRUITER = 178799;
const U_NULL = 178706; // no-data candidate: omni row with NULL total/tier

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

async function seed() {
	const q = (sql, params) => seedPool.query(sql, params);
	const ids = [...EDGES.map((e) => e[0]), RECRUITER, U_NULL];
	await q('DELETE FROM candidate_search_index WHERE user_id = ANY($1)', [ids]);
	await q('DELETE FROM omni_scores WHERE user_id = ANY($1)', [ids]);
	await q('DELETE FROM candidate_profiles WHERE user_id = ANY($1)', [ids]);
	await q('DELETE FROM users WHERE id = ANY($1)', [ids]);
	await q(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, $3, 'recruiter')`, [
		RECRUITER,
		'nova1787-recruiter@test.local',
		'Nova 1787 Recruiter',
	]);
	for (const [id, total, metal] of EDGES) {
		await q(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, $3, 'candidate')`, [
			id,
			`nova1787-${id}@test.local`,
			`Nova 1787 ${id}`,
		]);
		await q(`INSERT INTO candidate_profiles (user_id) VALUES ($1)`, [id]);
		await q(
			'INSERT INTO omni_scores (user_id, total_score, score_tier, version) VALUES ($1, $2, $3, 2)',
			[id, total, metal],
		);
		// candidate_search_index is populated by the trg_sync_csi_omni
		// trigger from the omni_scores insert above (the storage
		// propagation path) — no direct csi insert needed.
	}
	// No-data candidate: the writer's honest seed (NULL total, NULL tier).
	await q(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, $3, 'candidate')`, [
		U_NULL,
		`nova1787-${U_NULL}@test.local`,
		`Nova 1787 ${U_NULL}`,
	]);
	await q(`INSERT INTO candidate_profiles (user_id) VALUES ($1)`, [U_NULL]);
	await q(
		'INSERT INTO omni_scores (user_id, total_score, score_tier, version) VALUES ($1, NULL, NULL, 2)',
		[U_NULL],
	);
}

describeIfDb('#1787 tier-label readers — real DB', () => {
	let app;
	let svc;

	beforeAll(async () => {
		// server/test/setup.js replaces DATABASE_URL with a dummy; restore
		// the real one before lib/db (and the routers) load.
		process.env.DATABASE_URL = DB_URL;
		await seed();
		svc = require('../../services/omniscore');
		const omniscoreRouter = require('../../routes/omniscore');
		const candidateRouter = require('../../routes/candidate');
		const candidateSearchRouter = require('../../routes/candidateSearch');
		app = express();
		app.use(express.json());
		app.use('/api/omniscore', omniscoreRouter);
		app.use('/api/candidate', candidateRouter);
		app.use('/api/candidates', candidateSearchRouter);
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('helpers: metal <-> label round-trips at every band edge, storage vocabulary unchanged', () => {
		expect(typeof svc.labelFromDbTier).toBe('function');
		expect(typeof svc.dbTierFromLabel).toBe('function');
		expect(typeof svc.tierFromScore).toBe('function');
		const edges = [
			[850, 'exceptional', 'platinum'],
			[800, 'exceptional', 'platinum'],
			[799, 'excellent', 'gold'],
			[740, 'excellent', 'gold'],
			[739, 'good', 'silver'],
			[670, 'good', 'silver'],
			[669, 'fair', 'bronze'],
			[592, 'fair', 'bronze'],
			[580, 'fair', 'bronze'],
			[579, 'needs_work', 'new'],
			[300, 'needs_work', 'new'],
		];
		for (const [total, label, metal] of edges) {
			expect(svc.tierFromScore(total)).toBe(label);
			expect(svc.dbTierFromLabel(label)).toBe(metal);
			expect(svc.labelFromDbTier(metal)).toBe(label);
		}
		expect(svc.labelFromDbTier(null)).toBeNull();
		expect(svc.labelFromDbTier(undefined)).toBeNull();
	});

	test('leaderboard: candidate rows carry label tiers (592 reads fair, not bronze)', async () => {
		mockCurrentUser.id = RECRUITER;
		mockCurrentUser.role = 'recruiter';
		const res = await request(app).get('/api/omniscore/leaderboard');
		expect(res.status).toBe(200);
		const byId = new Map(res.body.candidates.map((c) => [c.user_id, c]));
		for (const [id, , , label] of EDGES) {
			expect(byId.get(id)?.score_tier).toBe(label);
		}
	});

	test('leaderboard: distribution is keyed by labels in band order', async () => {
		mockCurrentUser.id = RECRUITER;
		mockCurrentUser.role = 'recruiter';
		const res = await request(app).get('/api/omniscore/leaderboard');
		expect(res.status).toBe(200);
		const mine = res.body.distribution.filter((d) =>
			['exceptional', 'excellent', 'good', 'fair', 'needs_work'].includes(d.score_tier),
		);
		expect(mine.map((d) => d.score_tier)).toEqual([
			'exceptional',
			'excellent',
			'good',
			'fair',
			'needs_work',
		]);
		for (const d of mine) expect(parseInt(d.count, 10)).toBeGreaterThanOrEqual(1);
	});

	test('leaderboard: ?tier=fair filter (label vocabulary) matches the stored-bronze candidate', async () => {
		mockCurrentUser.id = RECRUITER;
		mockCurrentUser.role = 'recruiter';
		const res = await request(app).get('/api/omniscore/leaderboard?tier=fair');
		expect(res.status).toBe(200);
		const ids = res.body.candidates.map((c) => c.user_id);
		expect(ids).toContain(178704);
		expect(ids).not.toContain(178703);
	});

	test('candidate dashboard stats: 592 candidate sees fair, not bronze', async () => {
		mockCurrentUser.id = 178704;
		mockCurrentUser.role = 'candidate';
		const res = await request(app).get('/api/candidate/dashboard/stats');
		expect(res.status).toBe(200);
		expect(res.body.stats.omniscore.total_score).toBe(592);
		expect(res.body.stats.omniscore.score_tier).toBe('fair');
	});

	test('candidate search: ?score_tier=fair matches stored-bronze rows and returns label tiers', async () => {
		mockCurrentUser.id = RECRUITER;
		mockCurrentUser.role = 'recruiter';
		const res = await request(app).get('/api/candidates/search?score_tier=fair');
		expect(res.status).toBe(200);
		const rows = res.body.candidates || res.body.results || res.body.data || [];
		const ids = rows.map((r) => r.id || r.user_id);
		expect(ids).toContain(178704);
		expect(ids).not.toContain(178703);
		const row592 = rows.find((r) => (r.id || r.user_id) === 178704);
		expect(row592.score_tier).toBe('fair');
	});

	test('candidate preview: 592 candidate carries fair, not bronze', async () => {
		mockCurrentUser.id = RECRUITER;
		mockCurrentUser.role = 'recruiter';
		const res = await request(app).get('/api/candidates/178704/preview');
		expect(res.status).toBe(200);
		expect(res.body.candidate.score_tier).toBe('fair');
	});

	test('no-data honesty over HTTP: null total stays { total_score: null, score_tier: null }', async () => {
		mockCurrentUser.id = U_NULL;
		mockCurrentUser.role = 'candidate';
		const res = await request(app).get('/api/candidate/dashboard/stats');
		expect(res.status).toBe(200);
		expect(res.body.stats.omniscore).toEqual({ total_score: null, score_tier: null });
	});

	test('storage unchanged: reads never rewrite the stored metal encoding', async () => {
		const { rows } = await seedPool.query(
			'SELECT user_id, score_tier FROM omni_scores WHERE user_id = ANY($1) ORDER BY user_id',
			[EDGES.map((e) => e[0])],
		);
		for (const [id, , metal] of EDGES) {
			expect(rows.find((r) => r.user_id === id)?.score_tier).toBe(metal);
		}
		const csi = await seedPool.query(
			'SELECT score_tier FROM candidate_search_index WHERE user_id = $1',
			[178704],
		);
		expect(csi.rows[0].score_tier).toBe('bronze');
	});
});
