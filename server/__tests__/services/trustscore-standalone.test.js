/**
 * TrustScore Standalone Metrics — Workplace Culture + Candidate NPS
 *
 * TDD: these tests were written before the implementation.
 */

const mockQuery = jest.fn();
jest.mock('../../../lib/db', () => ({
	query: (...args) => mockQuery(...args),
	pool: { query: (...args) => mockQuery(...args) },
}));

const {
	calculateWorkplaceCulture,
	calculateCandidateNPS,
	MIN_DATA_POINTS,
} = require('../../../services/trustscore-standalone');

describe('calculateWorkplaceCulture', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('returns insufficient when fewer than 3 ratings', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ data_points: '2' }] });
		const result = await calculateWorkplaceCulture(1);
		expect(result.sufficient).toBe(false);
		expect(result.data_points).toBe(2);
	});

	test('averages the 4 dimensions and scores out of 100', async () => {
		// culture=4, wlb=5, communication=3, transparency=4 → avg 4.0 → score 80
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					culture: '4.0',
					work_life_balance: '5.0',
					communication: '3.0',
					transparency: '4.0',
					data_points: '10',
				},
			],
		});
		const result = await calculateWorkplaceCulture(1);
		expect(result.sufficient).toBe(true);
		expect(result.data_points).toBe(10);
		expect(result.avg_rating).toBe(4.0);
		expect(result.score).toBe(80);
		expect(result.dimensions).toEqual({
			culture: 4.0,
			work_life_balance: 5.0,
			communication: 3.0,
			transparency: 4.0,
		});
	});

	test('handles null dimensions (averages only non-null)', async () => {
		// culture=5, wlb=NULL, communication=5, transparency=NULL → avg of 2 = 5.0 → score 100
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					culture: '5.0',
					work_life_balance: null,
					communication: '5.0',
					transparency: null,
					data_points: '4',
				},
			],
		});
		const result = await calculateWorkplaceCulture(1);
		expect(result.sufficient).toBe(true);
		expect(result.avg_rating).toBe(5.0);
		expect(result.score).toBe(100);
	});

	test('returns insufficient when all dimensions are null', async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					culture: null,
					work_life_balance: null,
					communication: null,
					transparency: null,
					data_points: '5',
				},
			],
		});
		const result = await calculateWorkplaceCulture(1);
		expect(result.sufficient).toBe(false);
		expect(result.score).toBe(0);
	});

	test('min data points constant is 3', () => {
		expect(MIN_DATA_POINTS.WORKPLACE_CULTURE).toBe(3);
	});
});

describe('calculateCandidateNPS', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('returns insufficient when fewer than 3 responses', async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [{ promoters: '1', detractors: '1', total: '2' }],
		});
		const result = await calculateCandidateNPS(1);
		expect(result.sufficient).toBe(false);
		expect(result.total).toBe(2);
	});

	test('computes NPS and scales to 0-100', async () => {
		// 7 promoters, 2 detractors, 1 null ignored → total 9
		// NPS = (7-2)/9*100 = 55.56 → score = (55.56+100)/200*100 = 77.78 → 78
		mockQuery.mockResolvedValueOnce({
			rows: [{ promoters: '7', detractors: '2', total: '9' }],
		});
		const result = await calculateCandidateNPS(1);
		expect(result.sufficient).toBe(true);
		expect(result.promoters).toBe(7);
		expect(result.detractors).toBe(2);
		expect(result.total).toBe(9);
		expect(result.nps).toBeCloseTo(55.56, 1);
		expect(result.score).toBe(78);
	});

	test('all detractors gives score 0', async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [{ promoters: '0', detractors: '5', total: '5' }],
		});
		const result = await calculateCandidateNPS(1);
		expect(result.nps).toBe(-100);
		expect(result.score).toBe(0);
	});

	test('all promoters gives score 100', async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [{ promoters: '5', detractors: '0', total: '5' }],
		});
		const result = await calculateCandidateNPS(1);
		expect(result.nps).toBe(100);
		expect(result.score).toBe(100);
	});

	test('min data points constant is 3', () => {
		expect(MIN_DATA_POINTS.CANDIDATE_NPS).toBe(3);
	});
});
