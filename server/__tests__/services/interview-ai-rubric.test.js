/**
 * I1 (#323) — generateScreeningReport accepts additive rubric-weight options.
 *
 * The recruiter's rubric_weights must be USED in scoring, not just recorded.
 * Additive contract: no options → byte-identical prompt to before (no
 * regression for the screening/AI flows); options.rubricWeights →
 * a RUBRIC WEIGHTS block in the prompt.
 */

const mockChat = jest.fn();
jest.mock('../../../lib/ai-provider', () => ({
	chat: (...args) => mockChat(...args),
}));

const { generateScreeningReport } = require('../../../services/interview-ai');

const CANNED_REPORT = JSON.stringify({
	overall_score: 78,
	recommendation: 'consider',
	recommendation_reasoning: 'Decent depth, thin on logistics.',
	strengths: ['concrete examples'],
	red_flags: [],
	dimension_scores: {},
	key_moments: [],
	question_scores: [],
});

const SESSION = {
	conversation: [
		{ role: 'interviewer', text: 'Tell me about yourself.' },
		{ role: 'candidate', text: 'I am a data analyst with 6 years at Uber India.' },
	],
	questions: [{ question_text: 'Tell me about yourself.' }],
	responses: [{ response_text: 'I am a data analyst with 6 years at Uber India.' }],
};

beforeEach(() => {
	mockChat.mockReset();
	mockChat.mockResolvedValue(CANNED_REPORT);
});

describe('generateScreeningReport rubric options', () => {
	test('recruiter weights are injected into the scoring prompt', async () => {
		const weights = { can_do_the_work: 60, communication_quality: 40 };
		const report = await generateScreeningReport(SESSION, {
			rubricWeights: weights,
			rubricSource: 'recruiter',
		});

		expect(report.overall_score).toBe(78);
		expect(mockChat).toHaveBeenCalledTimes(1);
		const prompt = mockChat.mock.calls[0][0];
		expect(prompt).toContain('RUBRIC WEIGHTS');
		expect(prompt).toContain('"can_do_the_work":60');
		expect(prompt).toContain('recruiter');
	});

	test('no options → no weights block (existing callers unaffected)', async () => {
		await generateScreeningReport(SESSION);

		expect(mockChat).toHaveBeenCalledTimes(1);
		const prompt = mockChat.mock.calls[0][0];
		expect(prompt).not.toContain('RUBRIC WEIGHTS');
	});

	test('empty weights object → no weights block', async () => {
		await generateScreeningReport(SESSION, { rubricWeights: {} });

		const prompt = mockChat.mock.calls[0][0];
		expect(prompt).not.toContain('RUBRIC WEIGHTS');
	});
});
