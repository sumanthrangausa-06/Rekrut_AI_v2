/**
 * TrustScore Standalone Metrics — Offer Decline Analysis, Posting Efficiency, Stage Fluidity
 *
 * TDD: these tests were written before the implementation.
 */

const mockQuery = jest.fn();
jest.mock('../../../lib/db', () => ({
	query: (...args) => mockQuery(...args),
	pool: { query: (...args) => mockQuery(...args) },
}));

const {
	calculateOfferDeclineAnalysis,
	calculatePostingEfficiency,
	calculateStageFluidity,
	MIN_DATA_POINTS,
} = require('../../../services/trustscore-standalone');

describe('calculateOfferDeclineAnalysis', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('returns insufficient when fewer than 3 declines', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ decline_reason: 'too slow' }] });
		const result = await calculateOfferDeclineAnalysis(1);
		expect(result.sufficient).toBe(false);
		expect(result.total_declines).toBe(1);
	});

	test('categorizes reasons and scores company-fault rate', async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [
				{ decline_reason: 'Salary too low' }, // company-fault: salary
				{ decline_reason: 'Got a competing offer' }, // external
				{ decline_reason: 'The process was too slow' }, // company-fault: slow
				{ decline_reason: 'Personal reasons' }, // external
			],
		});
		const result = await calculateOfferDeclineAnalysis(1);
		expect(result.sufficient).toBe(true);
		expect(result.total_declines).toBe(4);
		expect(result.company_fault_count).toBe(2);
		expect(result.company_fault_rate).toBeCloseTo(0.5, 2);
		expect(result.score).toBe(50);
	});

	test('unclear reasons count in denominator but not as company-fault', async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [
				{ decline_reason: 'Rude interviewer' }, // company-fault: rude
				{ decline_reason: 'Just changed my mind' }, // unclear
				{ decline_reason: 'Family relocation' }, // external
			],
		});
		const result = await calculateOfferDeclineAnalysis(1);
		expect(result.company_fault_count).toBe(1);
		expect(result.total_declines).toBe(3);
		expect(result.company_fault_rate).toBeCloseTo(1 / 3, 2);
		expect(result.score).toBe(67); // (1 - 1/3) * 100 = 66.67 → 67
	});

	test('all company-fault gives score 0', async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [
				{ decline_reason: 'Compensation too low' },
				{ decline_reason: 'Bad culture fit' },
				{ decline_reason: 'Unprofessional behavior' },
			],
		});
		const result = await calculateOfferDeclineAnalysis(1);
		expect(result.score).toBe(0);
		expect(result.company_fault_rate).toBe(1);
	});
});

describe('calculatePostingEfficiency', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('returns insufficient when fewer than 3 postings', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ postings: '2', hires: '5' }] });
		const result = await calculatePostingEfficiency(1);
		expect(result.sufficient).toBe(false);
		expect(result.postings).toBe(2);
	});

	test('sweet spot 0.3-2.0 gives score 100', async () => {
		// 10 postings, 5 hires → ratio 0.5
		mockQuery.mockResolvedValueOnce({ rows: [{ postings: '10', hires: '5' }] });
		const result = await calculatePostingEfficiency(1);
		expect(result.sufficient).toBe(true);
		expect(result.hires_per_posting).toBeCloseTo(0.5, 2);
		expect(result.score).toBe(100);
	});

	test('low ratio scales down linearly', async () => {
		// 10 postings, 1 hire → ratio 0.1 → 0.1/0.3*100 = 33.33 → 33
		mockQuery.mockResolvedValueOnce({ rows: [{ postings: '10', hires: '1' }] });
		const result = await calculatePostingEfficiency(1);
		expect(result.score).toBe(33);
	});

	test('ratio above 2.0 caps at 70', async () => {
		// 3 postings, 10 hires → ratio 3.33 → suspicious → 70
		mockQuery.mockResolvedValueOnce({ rows: [{ postings: '3', hires: '10' }] });
		const result = await calculatePostingEfficiency(1);
		expect(result.hires_per_posting).toBeCloseTo(3.33, 1);
		expect(result.score).toBe(70);
	});

	test('zero hires gives score 0', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ postings: '5', hires: '0' }] });
		const result = await calculatePostingEfficiency(1);
		expect(result.hires_per_posting).toBe(0);
		expect(result.score).toBe(0);
	});
});

describe('calculateStageFluidity', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	const d = (iso) => new Date(iso);

	test('returns insufficient when fewer than 5 transitions', async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [
				{ application_id: 1, status: 'screening', created_at: d('2026-01-01'), applied_at: d('2026-01-01') },
				{ application_id: 1, status: 'interview', created_at: d('2026-01-05'), applied_at: d('2026-01-01') },
			],
		});
		const result = await calculateStageFluidity(1);
		expect(result.sufficient).toBe(false);
	});

	test('computes median days per stage and flags violations', async () => {
		// App 1: applied(Jan 1) → screening(Jan 2) → interview(Jan 20) → hired(Jan 25)
		//   applied: 1d, screening: 18d (VIOLATION >14), interview: 5d
		// App 2: applied(Jan 1) → screening(Jan 3) → interview(Jan 10) → offer(Jan 12) → hired(Jan 13)
		//   applied: 2d, screening: 7d, interview: 2d, offer: 1d
		// Medians: applied 1.5d, screening 12.5d, interview 3.5d, offer 1d → no violations
		mockQuery.mockResolvedValueOnce({
			rows: [
				{ application_id: 1, status: 'screening', created_at: d('2026-01-02'), applied_at: d('2026-01-01') },
				{ application_id: 1, status: 'interview', created_at: d('2026-01-20'), applied_at: d('2026-01-01') },
				{ application_id: 1, status: 'hired', created_at: d('2026-01-25'), applied_at: d('2026-01-01') },
				{ application_id: 2, status: 'screening', created_at: d('2026-01-03'), applied_at: d('2026-01-01') },
				{ application_id: 2, status: 'interview', created_at: d('2026-01-10'), applied_at: d('2026-01-01') },
				{ application_id: 2, status: 'offer', created_at: d('2026-01-12'), applied_at: d('2026-01-01') },
				{ application_id: 2, status: 'hired', created_at: d('2026-01-13'), applied_at: d('2026-01-01') },
			],
		});
		const result = await calculateStageFluidity(1);
		expect(result.sufficient).toBe(true);
		expect(result.median_days_per_stage.screening).toBe(12.5);
		expect(result.median_days_per_stage.interview).toBe(3.5);
		expect(result.violations).toEqual([]);
		expect(result.score).toBe(100);
	});

	test('subtracts 25 per stage exceeding threshold', async () => {
		// Both apps stuck in screening for 20 days → median 20d > 14 → 1 violation → score 75
		mockQuery.mockResolvedValueOnce({
			rows: [
				{ application_id: 1, status: 'screening', created_at: d('2026-01-02'), applied_at: d('2026-01-01') },
				{ application_id: 1, status: 'interview', created_at: d('2026-01-22'), applied_at: d('2026-01-01') },
				{ application_id: 1, status: 'hired', created_at: d('2026-01-23'), applied_at: d('2026-01-01') },
				{ application_id: 2, status: 'screening', created_at: d('2026-01-03'), applied_at: d('2026-01-01') },
				{ application_id: 2, status: 'interview', created_at: d('2026-01-23'), applied_at: d('2026-01-01') },
				{ application_id: 2, status: 'hired', created_at: d('2026-01-24'), applied_at: d('2026-01-01') },
			],
		});
		const result = await calculateStageFluidity(1);
		expect(result.median_days_per_stage.screening).toBe(20);
		expect(result.violations).toContain('screening');
		expect(result.score).toBe(75);
	});

	test('score floors at 0 with multiple violations', async () => {
		// screening 20d (>14), interview 25d (>21), offer 10d (>7) → 3 violations → 100-75 = 25
		mockQuery.mockResolvedValueOnce({
			rows: [
				{ application_id: 1, status: 'screening', created_at: d('2026-01-02'), applied_at: d('2026-01-01') },
				{ application_id: 1, status: 'interview', created_at: d('2026-01-22'), applied_at: d('2026-01-01') },
				{ application_id: 1, status: 'offer', created_at: d('2026-02-16'), applied_at: d('2026-01-01') },
				{ application_id: 1, status: 'hired', created_at: d('2026-02-26'), applied_at: d('2026-01-01') },
				{ application_id: 2, status: 'screening', created_at: d('2026-01-03'), applied_at: d('2026-01-01') },
				{ application_id: 2, status: 'interview', created_at: d('2026-01-23'), applied_at: d('2026-01-01') },
				{ application_id: 2, status: 'offer', created_at: d('2026-02-17'), applied_at: d('2026-01-01') },
				{ application_id: 2, status: 'hired', created_at: d('2026-02-27'), applied_at: d('2026-01-01') },
			],
		});
		const result = await calculateStageFluidity(1);
		expect(result.violations).toEqual(
			expect.arrayContaining(['screening', 'interview', 'offer']),
		);
		expect(result.score).toBe(25);
	});
});

describe('MIN_DATA_POINTS', () => {
	test('has thresholds for the three new metrics', () => {
		expect(MIN_DATA_POINTS.OFFER_DECLINE).toBe(3);
		expect(MIN_DATA_POINTS.POSTING_EFFICIENCY).toBe(3);
		expect(MIN_DATA_POINTS.STAGE_FLUIDITY).toBe(5);
	});
});
