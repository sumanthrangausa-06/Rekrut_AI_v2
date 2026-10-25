/**
 * #1237 — getLeaderboard count-query parameter contract.
 * The count query must use its own renumbered clause ($1 = minScore, $2 = tier)
 * with its own params — reusing the main query's $3/$4 clause with sliced
 * params caused Postgres 42P18 on a real DB (see real-DB proof in PR).
 * This mocked test pins the contract; it cannot by itself catch 42P18.
 */
const mockQuery = jest.fn();
jest.mock('../../../lib/db', () => ({
	query: (...args) => mockQuery(...args),
}));

const { getLeaderboard } = require('../../../services/trustscore');

describe('getLeaderboard count query (#1237)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockQuery
			.mockResolvedValueOnce({ rows: [] }) // main query
			.mockResolvedValueOnce({ rows: [{ total: '3' }] }); // count query
	});

	test('no tier: count query is renumbered to $1 with params [minScore]', async () => {
		const r = await getLeaderboard({ limit: 50, offset: 0, minScore: 100 });
		expect(r.pagination.total).toBe(3);
		const [mainSql, mainParams] = mockQuery.mock.calls[0];
		expect(mainSql).toContain('ts.total_score >= $3');
		expect(mainParams).toEqual([50, 0, 100]);
		const [countSql, countParams] = mockQuery.mock.calls[1];
		expect(countSql).toContain('ts.total_score >= $1');
		expect(countSql).not.toContain('$3');
		expect(countSql).not.toContain('$4');
		expect(countParams).toEqual([100]);
	});

	test('tier: count query uses $1/$2 with params [minScore, tier]', async () => {
		await getLeaderboard({ limit: 10, offset: 5, minScore: 0, tier: 'trusted' });
		const [countSql, countParams] = mockQuery.mock.calls[1];
		expect(countSql).toContain('ts.total_score >= $1');
		expect(countSql).toContain('ts.score_tier = $2');
		expect(countParams).toEqual([0, 'trusted']);
	});
});
