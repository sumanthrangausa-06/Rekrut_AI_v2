/**
 * #1512 — analyzeObserverSession must not stamp rubric weights onto an
 * unavailable report. The established contract is that rubric weights are
 * USED in scoring, not just recorded; on the honest unavailable report
 * (analysis_unavailable: true) nothing was scored, so claiming the weights
 * were used is a false claim. Scored reports keep the stamp.
 */

const mockChat = jest.fn();
jest.mock('../../../lib/ai-provider', () => ({
	chat: (...args) => mockChat(...args),
}));

const mockGenerateScreeningReport = jest.fn();
const mockRunMultiEvaluation = jest.fn();
jest.mock('../../../services/interview-ai', () => ({
	generateScreeningReport: (...args) => mockGenerateScreeningReport(...args),
	runMultiEvaluation: (...args) => mockRunMultiEvaluation(...args),
}));

const { analyzeObserverSession } = require('../../../services/qa-extraction');

const SESSION = { id: 7, candidate_id: 4, job_id: 11, company_id: 2 };
const QA_PAIRS = [{ question: 'Tell me about yourself.', answer: 'Data analyst, 6 years.' }];

beforeEach(() => {
	mockChat.mockReset();
	mockGenerateScreeningReport.mockReset();
	mockRunMultiEvaluation.mockReset();
	mockRunMultiEvaluation.mockResolvedValue(null);
});

describe('analyzeObserverSession rubric stamping (#1512)', () => {
	test('unavailable report → rubric_weights_used is null, not the weights', async () => {
		mockGenerateScreeningReport.mockResolvedValue({
			overall_score: null,
			recommendation: null,
			analysis_unavailable: true,
			note: 'AI analysis unavailable — no score or recommendation assigned.',
		});

		const report = await analyzeObserverSession({
			session: SESSION,
			qaPairs: QA_PAIRS,
			rubricWeights: { can_do_the_work: 100 },
			job: { title: 'Data Analyst' },
		});

		expect(report.analysis_unavailable).toBe(true);
		expect(report.rubric_weights_used).toBeNull();
	});

	test('scored report → rubric weights still stamped as used', async () => {
		const weights = { can_do_the_work: 50, communication_quality: 50 };
		mockGenerateScreeningReport.mockResolvedValue({ overall_score: 82, recommendation: 'advance' });

		const report = await analyzeObserverSession({
			session: SESSION,
			qaPairs: QA_PAIRS,
			rubricWeights: weights,
			job: { title: 'Data Analyst' },
		});

		expect(report.rubric_weights_used).toEqual(weights);
		expect(report.rubric_source).toBe('recruiter');
	});
});
