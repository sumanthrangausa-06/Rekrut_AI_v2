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
	calculateReapplicationRate,
	calculateCommunicationResponsiveness,
	getRecentReviews,
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

describe('calculateReapplicationRate', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('returns insufficient when fewer than 5 rejected candidates', async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [{ total_rejected: '3', reapplied_count: '1' }],
		});
		const result = await calculateReapplicationRate(7);
		expect(result.sufficient).toBe(false);
		expect(result.score).toBe(0);
		expect(result.total_rejected).toBe(3);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining('job_applications'),
			[7],
		);
	});

	test('computes reapplication rate as reapplied / total_rejected', async () => {
		// 4 of 10 rejected candidates reapplied → 40%
		mockQuery.mockResolvedValueOnce({
			rows: [{ total_rejected: '10', reapplied_count: '4' }],
		});
		const result = await calculateReapplicationRate(7);
		expect(result.sufficient).toBe(true);
		expect(result.total_rejected).toBe(10);
		expect(result.reapplied_count).toBe(4);
		expect(result.reapplication_rate).toBe(40);
		expect(result.score).toBe(40);
	});

	test('all rejected candidates reapply gives score 100', async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [{ total_rejected: '5', reapplied_count: '5' }],
		});
		const result = await calculateReapplicationRate(7);
		expect(result.sufficient).toBe(true);
		expect(result.reapplication_rate).toBe(100);
		expect(result.score).toBe(100);
	});

	test('zero reapplications gives score 0 but sufficient', async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [{ total_rejected: '8', reapplied_count: '0' }],
		});
		const result = await calculateReapplicationRate(7);
		expect(result.sufficient).toBe(true);
		expect(result.reapplication_rate).toBe(0);
		expect(result.score).toBe(0);
	});

	test('min data points constant is 5', () => {
		expect(MIN_DATA_POINTS.REAPPLICATION_RATE).toBe(5);
	});
});

describe('calculateCommunicationResponsiveness', () => {
	const BASE = new Date('2026-01-01T00:00:00Z').getTime();
	const mkMsg = (conversation_id, sender_id, hoursAfter, candidate_id, recruiter_id) => ({
		conversation_id,
		sender_id: String(sender_id),
		created_at: new Date(BASE + hoursAfter * 3600000).toISOString(),
		candidate_id: String(candidate_id),
		recruiter_id: String(recruiter_id),
	});

	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('returns insufficient when fewer than 10 candidate messages', async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [
				mkMsg(1, 10, 0, 10, 20),
				mkMsg(1, 20, 1, 10, 20),
				mkMsg(1, 10, 2, 10, 20),
				mkMsg(1, 10, 3, 10, 20),
				mkMsg(1, 10, 4, 10, 20),
			],
		});
		const result = await calculateCommunicationResponsiveness(7);
		expect(result.sufficient).toBe(false);
		expect(result.score).toBe(0);
		expect(result.total_messages).toBe(4);
	});

	test('computes median reply hours, coverage, and combined score', async () => {
		// 12 candidate messages, 10 replied, 2 ghosted
		// reply times (h): 3, 2, 25, 50, 1, 4, 5, 6, 7, 8 → median 5.5 → speed 75
		// coverage: 10/12 = 83.3 → score = 75*0.5 + 83.3*0.5 = 79.15 → 79
		mockQuery.mockResolvedValueOnce({
			rows: [
				// conv 1: candidate 10, recruiter 20
				mkMsg(1, 10, 0, 10, 20),
				mkMsg(1, 10, 1, 10, 20),
				mkMsg(1, 20, 3, 10, 20), // replies: 3h, 2h
				mkMsg(1, 10, 4, 10, 20),
				mkMsg(1, 20, 29, 10, 20), // reply: 25h
				mkMsg(1, 10, 30, 10, 20),
				mkMsg(1, 20, 80, 10, 20), // reply: 50h
				mkMsg(1, 10, 81, 10, 20), // ghosted
				// conv 2: candidate 11, recruiter 20
				mkMsg(2, 11, 0, 11, 20),
				mkMsg(2, 20, 1, 11, 20), // reply: 1h
				mkMsg(2, 11, 2, 11, 20),
				mkMsg(2, 20, 6, 11, 20), // reply: 4h
				mkMsg(2, 11, 7, 11, 20),
				mkMsg(2, 20, 12, 11, 20), // reply: 5h
				mkMsg(2, 11, 13, 11, 20),
				mkMsg(2, 20, 19, 11, 20), // reply: 6h
				mkMsg(2, 11, 20, 11, 20),
				mkMsg(2, 20, 27, 11, 20), // reply: 7h
				mkMsg(2, 11, 28, 11, 20),
				mkMsg(2, 20, 36, 11, 20), // reply: 8h
				mkMsg(2, 11, 37, 11, 20), // ghosted
			],
		});
		const result = await calculateCommunicationResponsiveness(7);
		expect(result.sufficient).toBe(true);
		expect(result.total_messages).toBe(12);
		expect(result.median_reply_hours).toBe(5.5);
		expect(result.reply_coverage_pct).toBe(83.3);
		expect(result.score).toBe(79);
	});

	test('one recruiter reply resolves all pending candidate messages', async () => {
		// 10 candidate messages then a single recruiter reply 2h after the last one
		const rows = [];
		for (let i = 0; i < 10; i++) {
			rows.push(mkMsg(1, 10, i, 10, 20));
		}
		rows.push(mkMsg(1, 20, 11, 10, 20));
		mockQuery.mockResolvedValueOnce({ rows });
		const result = await calculateCommunicationResponsiveness(7);
		expect(result.sufficient).toBe(true);
		expect(result.reply_coverage_pct).toBe(100);
		// reply times: 11,10,9,...,2 → median (7+6)/2 = 6.5 → speed 75
		expect(result.median_reply_hours).toBe(6.5);
		expect(result.score).toBe(88); // 75*0.5 + 100*0.5 = 87.5 → 88
	});

	test('ignores messages from unknown senders', async () => {
		const rows = [];
		for (let i = 0; i < 10; i++) {
			rows.push(mkMsg(1, 10, i * 2, 10, 20));
			rows.push(mkMsg(1, 20, i * 2 + 1, 10, 20)); // 1h replies
		}
		rows.push(mkMsg(1, 999, 21, 10, 20)); // unknown sender — ignored
		mockQuery.mockResolvedValueOnce({ rows });
		const result = await calculateCommunicationResponsiveness(7);
		expect(result.total_messages).toBe(10);
		expect(result.reply_coverage_pct).toBe(100);
		expect(result.median_reply_hours).toBe(1);
		expect(result.score).toBe(100); // speed 100 (≤4h), coverage 100
	});

	test('min data points constant is 10', () => {
		expect(MIN_DATA_POINTS.COMMUNICATION).toBe(10);
	});
});

describe('getRecentReviews', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('returns insufficient when fewer than 3 published reviews', async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					total_count: '2',
					overall_rating: 4,
					pros: 'Great team',
					cons: 'Slow promo',
					review_text: 'Good place',
					created_at: new Date('2026-01-01'),
				},
			],
		});
		const result = await getRecentReviews(1);
		expect(result.sufficient).toBe(false);
		expect(result.data_points).toBe(2);
		expect(result.reviews).toEqual([]);
	});

	test('returns latest 3 published reviews with pros/cons/review_text when sufficient', async () => {
		const mk = (rating, text) => ({
			total_count: '5',
			overall_rating: rating,
			pros: 'pros text',
			cons: 'cons text',
			review_text: text,
			created_at: new Date('2026-02-01'),
		});
		mockQuery.mockResolvedValueOnce({ rows: [mk(5, 'Loved it'), mk(4, 'Good'), mk(3, 'Okay')] });
		const result = await getRecentReviews(1);
		expect(result.sufficient).toBe(true);
		expect(result.data_points).toBe(5);
		expect(result.reviews).toHaveLength(3);
		expect(result.reviews[0]).toEqual({
			overall_rating: 5,
			pros: 'pros text',
			cons: 'cons text',
			review_text: 'Loved it',
			created_at: expect.any(Date),
		});
		// Only published rows come from the query — verify the filter
		expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("status = 'published'"), [1]);
	});

	test('nulls out empty pros/cons/review_text', async () => {
		const mk = () => ({
			total_count: '3',
			overall_rating: 4,
			pros: '',
			cons: null,
			review_text: '',
			created_at: new Date('2026-03-01'),
		});
		mockQuery.mockResolvedValueOnce({ rows: [mk(), mk(), mk()] });
		const result = await getRecentReviews(1);
		expect(result.sufficient).toBe(true);
		expect(result.reviews[0].pros).toBeNull();
		expect(result.reviews[0].cons).toBeNull();
		expect(result.reviews[0].review_text).toBeNull();
	});

	test('min data points constant is 3', () => {
		expect(MIN_DATA_POINTS.REVIEWS).toBe(3);
	});
});
