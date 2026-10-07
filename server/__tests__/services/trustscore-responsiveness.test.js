/**
 * Assessment Responsiveness — standalone metric (not a v2 factor)
 *
 * Tests the three sub-metrics:
 * - review_rate: % of assessments viewed by recruiters
 * - median_days_to_action: median days from scored_at to first recruiter action
 * - ghost_rate: % with no recruiter action ever
 */

const mockQuery = jest.fn();
jest.mock('../../../lib/db', () => ({
	query: (...args) => mockQuery(...args),
	pool: { query: (...args) => mockQuery(...args) },
}));

const {
	calculateAssessmentResponsiveness,
	ASSESSMENT_RESPONSIVENESS_MIN_DATA_POINTS,
} = require('../../../services/trustscore');

describe('calculateAssessmentResponsiveness', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('returns insufficient when fewer than 5 linked assessments', async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [{ application_id: 1 }, { application_id: 2 }, { application_id: null }],
		});
		const result = await calculateAssessmentResponsiveness(1);
		expect(result.sufficient).toBe(false);
		// null application_id excluded from count
		expect(result.total_assessments).toBe(2);
	});

	test('computes review rate, ghost rate, and median days', async () => {
		const now = new Date();
		const scoredAt = new Date(now - 5 * 24 * 60 * 60 * 1000); // 5 days ago
		const actionAt = new Date(scoredAt.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days after scoring

		mockQuery.mockImplementation((sql) => {
			if (sql.includes('job_assessment_attempts')) {
				return Promise.resolve({
					rows: [1, 2, 3, 4, 5].map((i) => ({
						attempt_id: i,
						candidate_id: i * 10,
						scored_at: scoredAt,
						job_id: 100,
						assessment_id: 200 + i,
						application_id: 900 + i,
					})),
				});
			}
			if (sql.includes("action_type = 'assessment_result.viewed'")) {
				// 3 of 5 assessments viewed
				return Promise.resolve({
					rows: [{ assessment_id: 201 }, { assessment_id: 202 }, { assessment_id: 203 }],
				});
			}
			if (sql.includes("action_type = 'application_status_changed'")) {
				// 4 of 5 have actions; app 905 is a ghost
				return Promise.resolve({
					rows: [901, 902, 903, 904].map((id) => ({
						application_id: id,
						first_action: actionAt,
					})),
				});
			}
			return Promise.resolve({ rows: [] });
		});

		const result = await calculateAssessmentResponsiveness(1);

		expect(result.sufficient).toBe(true);
		expect(result.total_assessments).toBe(5);
		expect(result.review_rate).toBe(60); // 3/5
		expect(result.ghost_rate).toBe(20); // 1/5
		expect(result.median_days_to_action).toBe(2);
		expect(result.score).toBeGreaterThan(0);
		expect(result.score).toBeLessThanOrEqual(100);
		// Only 3 queries: attempts, viewed, actions (no N+1)
		expect(mockQuery).toHaveBeenCalledTimes(3);
	});

	test('min data points constant is 5', () => {
		expect(ASSESSMENT_RESPONSIVENESS_MIN_DATA_POINTS).toBe(5);
	});
});
