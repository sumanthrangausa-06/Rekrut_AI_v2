/**
 * #1219 — OmniScore explainer 500: `function percent_rank(integer) does not exist`.
 *
 * Root cause (reproduced against real Postgres, see lane run log): the peer
 * query in getScoreExplainer called `PERCENT_RANK() WITHIN GROUP (ORDER BY
 * total_score)` — a hypothetical-set aggregate with ZERO direct arguments
 * against ONE ordering column, which Postgres can never resolve. The column's
 * result was also never used (peerComparison.percentile comes from
 * calculateScore's COUNT FILTER / NULLIF computation).
 *
 * This mock simulates Postgres for that one query: while the SQL still
 * contains the zero-argument PERCENT_RANK() form it throws the exact PG
 * error (42883); otherwise it returns the configured aggregate row — the
 * same way PG returns one row of NULLs for AVG/MAX/PERCENTILE_CONT over an
 * empty omni_scores table.
 */

const mockState = { omniRow: null, snapshots: [], skills: [], peerStats: null };
const mockClientQuery = jest.fn(async (sql) => {
	if (sql.includes('candidate_skills')) return { rows: mockState.skills };
	return { rows: [] };
});

function mockQuery(sql, params = []) {
	if (sql.includes('PERCENTILE_CONT')) {
		// The explainer peer-stats query — simulate Postgres resolution.
		if (sql.includes('PERCENT_RANK()')) {
			const err = new Error('function percent_rank(integer) does not exist');
			err.code = '42883';
			throw err;
		}
		return { rows: [mockState.peerStats || { avg_score: null, top_score: null, median_score: null }] };
	}
	if (sql.includes('FROM omni_scores os')) return { rows: [] };
	if (sql.includes('INSERT INTO omni_scores')) {
		const total = sql.includes('$2') ? params[1] : null;
		mockState.omniRow = { user_id: params[0], total_score: total, score_tier: 'new' };
		return { rows: [mockState.omniRow] };
	}
	if (sql.includes('SELECT * FROM omni_scores') || sql.includes('SELECT last_checkin_at')) {
		return { rows: mockState.omniRow ? [mockState.omniRow] : [] };
	}
	if (sql.includes('UPDATE omni_scores') && sql.includes('total_score = $1')) {
		if (mockState.omniRow) {
			mockState.omniRow = {
				...mockState.omniRow,
				total_score: params[0],
				score_tier: params[5],
				peer_percentile: params[7],
			};
		}
		return { rows: [] };
	}
	if (sql.includes('INSERT INTO score_snapshots')) {
		mockState.snapshots.push({ total_score: params[1] });
		return { rows: [] };
	}
	if (sql.includes('COUNT(*) FILTER')) return { rows: [{ percentile: '50' }] };
	return { rows: [] };
}

jest.mock('../../lib/db', () => ({
	connect: jest.fn(async () => ({ query: (...a) => mockClientQuery(...a), release: jest.fn() })),
	query: jest.fn(async (sql, params) => mockQuery(sql, params)),
}));

const pool = require('../../lib/db');
const { getScoreExplainer } = require('../../services/omniscore');

const USER = 999019;

beforeEach(() => {
	mockState.omniRow = null;
	mockState.snapshots = [];
	mockState.skills = [];
	mockState.peerStats = null;
	jest.clearAllMocks();
	pool.query.mockImplementation(async (sql, params = []) => mockQuery(sql, params));
	pool.connect.mockImplementation(async () => ({
		query: (...a) => mockClientQuery(...a),
		release: jest.fn(),
	}));
	mockClientQuery.mockImplementation(async (sql) => {
		if (sql.includes('candidate_skills')) return { rows: mockState.skills };
		return { rows: [] };
	});
});

describe('#1219 getScoreExplainer — no-data candidate, empty peer table', () => {
	test('resolves instead of 500ing, with honest null peer stats (never fabricated 500/1000/500)', async () => {
		mockState.peerStats = { avg_score: null, top_score: null, median_score: null };
		const out = await getScoreExplainer(USER);
		expect(out.peerComparison.percentile).toBeNull();
		expect(out.peerComparison.avgScore).toBeNull();
		expect(out.peerComparison.topScore).toBeNull();
		expect(out.peerComparison.medianScore).toBeNull();
		expect(Array.isArray(out.factors)).toBe(true);
	});
});

describe('#1219 getScoreExplainer — with peers (regression)', () => {
	test('avg/top/median pass through from the aggregates, rounded', async () => {
		mockState.skills = [
			{
				skill_name: 'JavaScript',
				category: 'software engineering',
				level: 'expert',
				is_verified: true,
				years_experience: 3,
				created_at: new Date(),
			},
		];
		mockState.peerStats = { avg_score: '612.4', top_score: 800, median_score: '600' };
		const out = await getScoreExplainer(USER);
		expect(out.peerComparison.avgScore).toBe(612);
		expect(out.peerComparison.topScore).toBe(800);
		expect(out.peerComparison.medianScore).toBe(600);
		expect(typeof out.peerComparison.percentile).toBe('number');
	});

	test('a legitimate 0 aggregate stays 0 (the old truthiness fallbacks fabricated 500/1000)', async () => {
		mockState.peerStats = { avg_score: '0', top_score: 0, median_score: '0' };
		const out = await getScoreExplainer(USER);
		expect(out.peerComparison.avgScore).toBe(0);
		expect(out.peerComparison.topScore).toBe(0);
		expect(out.peerComparison.medianScore).toBe(0);
	});
});
