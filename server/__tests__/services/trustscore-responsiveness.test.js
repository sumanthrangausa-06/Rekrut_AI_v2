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

	test('returns insufficient when fewer than 5 assessments', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{}, {}, {}] }); // 3 attempts
		const result = await calculateAssessmentResponsiveness(1);
		expect(result.sufficient).toBe(false);
		expect(result.total_assessments).toBe(3);
	});

	test('computes review rate, ghost rate, and median days', async () => {
		const now = new Date();
		const scoredAt = new Date(now - 5 * 24 * 60 * 60 * 1000); // 5 days ago

		// 5 completed attempts
		mockQuery.mockImplementation((sql) => {
			if (sql.includes('job_assessment_attempts')) {
				return Promise.resolve({
					rows: [1, 2, 3, 4, 5].map((i) => ({
						attempt_id: i,
						candidate_id: i * 10,
						scored_at: scoredAt,
						job_id: 100,
						assessment_id: 200 + i,
					})),
				});
			}
			if (sql.includes("action_type = 'assessment_result.viewed'")) {
				// 3 of 5 viewed
				return Promise.resolve({
					rows: [{ assessment_id: 201 }, { assessment_id: 202 }, { assessment_id: 203 }],
				});
			}
			if (sql.includes('FROM job_applications')) {
				return Promise.resolve({ rows: [{ id: 999 }] });
			}
			if (sql.includes("action_type = 'application_status_changed'")) {
				// Action 2 days after scoring for 4 of 5; 1 ghost (null)
				const callCount = mockQuery.mock.calls.filter((c) =>
					c[0].includes('application_status_changed'),
				).length;
				if (callCount <= 4) {
					return Promise.resolve({
						rows: [{ first_action: new Date(scoredAt.getTime() + 2 * 24 * 60 * 60 * 1000) }],
					});
				}
				return Promise.resolve({ rows: [{ first_action: null }] });
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
	});

	test('min data points constant is 5', () => {
		expect(ASSESSMENT_RESPONSIVENESS_MIN_DATA_POINTS).toBe(5);
	});
});
