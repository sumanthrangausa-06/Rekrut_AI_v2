/**
 * #1512 — generateScreeningReport must never fabricate a score.
 *
 * When AI analysis is unavailable (provider error, unparseable output, or a
 * parsed object with no numeric overall_score), the fallback report must be
 * the honest unavailable state: every score null, recommendation null, an
 * explicit analysis_unavailable marker + note, and NO evaluative claims
 * (strengths / red_flags / confidence indicators are emptied — the answered
 * count behind them is not reliable for conversation-sourced callers, which
 * pass responses: [] structurally).
 *
 * Precedents: #1505 (failed lenses write nothing, composite null) and the
 * human-no-observer report { overall_score: null, recommendation: null, note }.
 */

const mockChat = jest.fn();
jest.mock('../../../lib/ai-provider', () => ({
	chat: (...args) => mockChat(...args),
}));

const { generateScreeningReport } = require('../../../services/interview-ai');

const SESSION = {
	conversation: [
		{ role: 'interviewer', text: 'Tell me about a hard technical problem you solved.' },
		{
			role: 'candidate',
			text: 'I rebuilt a reporting pipeline at my previous company, cutting runtime from hours to minutes by partitioning the warehouse queries and adding incremental loads, then verified the output against the finance totals.',
		},
	],
	questions: [{ question_text: 'Tell me about a hard technical problem you solved.' }],
	responses: [
		{
			response_text:
				'I rebuilt a reporting pipeline at my previous company, cutting runtime from hours to minutes by partitioning the warehouse queries and adding incremental loads, then verified the output against the finance totals.',
		},
	],
};

// Quinn Gate B shape (#1504 drive): conversation present, no Q&A arrays.
const GATE_B_SESSION = {
	conversation: [
		{ role: 'interviewer', text: 'Tell me about a hard technical problem you solved.' },
		{ role: 'candidate', text: 'I rebuilt a reporting pipeline, cutting runtime from hours to minutes.' },
	],
	questions: [],
	responses: [],
};

function expectHonestUnavailable(report) {
	expect(report.overall_score).toBeNull();
	expect(report.recommendation).toBeNull();
	expect(report.analysis_unavailable).toBe(true);
	expect(report.note).toMatch(/AI analysis unavailable/);
	expect(report.recommendation_reasoning).toMatch(/no score or recommendation/i);
	expect(report.recommendation_reasoning).not.toMatch(/answered \d+\/\d+/);
	expect(report.communication_clarity.score).toBeNull();
	expect(report.technical_depth.score).toBeNull();
	expect(report.confidence_enthusiasm.score).toBeNull();
	expect(report.confidence_enthusiasm.indicators).toEqual([]);
	expect(report.strengths).toEqual([]);
	expect(report.red_flags).toEqual([]);
	for (const qs of report.question_scores) {
		expect(qs.score).toBeNull();
	}
	// The fabricated-score copy must be gone.
	expect(JSON.stringify(report)).not.toMatch(/basic scoring applied/);
}

beforeEach(() => {
	mockChat.mockReset();
	jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	console.error.mockRestore();
});

describe('generateScreeningReport fallback honesty (#1512)', () => {
	test('provider error → honest unavailable report, no fabricated scores', async () => {
		mockChat.mockRejectedValue(new Error('no provider available'));

		const report = await generateScreeningReport(SESSION);

		expectHonestUnavailable(report);
		expect(report.question_scores).toHaveLength(1);
		expect(report.question_scores[0].feedback).toMatch(/AI analysis unavailable/);
	});

	test('Gate B shape (empty questions/responses) → nulls, never 0 / decline', async () => {
		mockChat.mockRejectedValue(new Error('no provider available'));

		const report = await generateScreeningReport(GATE_B_SESSION);

		expectHonestUnavailable(report);
		expect(report.question_scores).toEqual([]);
	});

	test('unparseable AI output → honest unavailable report', async () => {
		mockChat.mockResolvedValue('the model rambled with no json at all');

		const report = await generateScreeningReport(SESSION);

		expectHonestUnavailable(report);
	});

	test('parsed AI output without a numeric overall_score → honest unavailable report', async () => {
		mockChat.mockResolvedValue(JSON.stringify({ recommendation: 'advance', strengths: ['x'] }));

		const report = await generateScreeningReport(SESSION);

		expectHonestUnavailable(report);
	});

	test('valid AI report is returned untouched (no unavailable marker)', async () => {
		mockChat.mockResolvedValue(
			JSON.stringify({
				overall_score: 78,
				recommendation: 'consider',
				recommendation_reasoning: 'Decent depth.',
				strengths: ['concrete examples'],
				red_flags: [],
				dimension_scores: {},
				key_moments: [],
				question_scores: [],
			}),
		);

		const report = await generateScreeningReport(SESSION);

		expect(report.overall_score).toBe(78);
		expect(report.recommendation).toBe('consider');
		expect(report.analysis_unavailable).toBeUndefined();
	});
});
