/**
 * Task 5 (#323) — Track B observer Q&A extraction (RED).
 *
 * Tests the pure analysis surface of services/qa-extraction.js:
 * - extractQAPairs turns a free-form speaker-labeled transcript into
 *   [{question, answer, asker, answerer}].
 * - analyzeObserverSession feeds the pairs into the mock-interview analysis
 *   stack (generateScreeningReport + background runMultiEvaluation) with
 *   recruiter rubric weights when defined, default rubric otherwise.
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

const { extractQAPairs, analyzeObserverSession } = require('../../../services/qa-extraction');

const FIXTURE_TRANSCRIPT = [
	{
		speaker: 'recruiter-9',
		text: "Hi Priya, thanks for joining. Let's start simple — tell me about yourself.",
		at: '2026-10-06T10:00:00Z',
	},
	{
		speaker: 'candidate-4',
		text: "I'm a data analyst with 6 years at Uber India, mostly on marketplace pricing dashboards.",
		at: '2026-10-06T10:00:20Z',
	},
	{
		speaker: 'recruiter-9',
		text: 'Walk me through a pricing experiment you ran end to end.',
		at: '2026-10-06T10:01:00Z',
	},
	{
		speaker: 'candidate-4',
		text: 'We tested surge multipliers in Hyderabad. I designed the diff-in-diff, and we saw a 4% lift in completed trips.',
		at: '2026-10-06T10:01:40Z',
	},
	{
		speaker: 'recruiter-9',
		text: 'Thanks, that covers everything I had.',
		at: '2026-10-06T10:02:00Z',
	},
];

const FIXTURE_QA_JSON = JSON.stringify([
	{
		question: 'Tell me about yourself.',
		answer:
			"I'm a data analyst with 6 years at Uber India, mostly on marketplace pricing dashboards.",
		asker: 'recruiter-9',
		answerer: 'candidate-4',
	},
	{
		question: 'Walk me through a pricing experiment you ran end to end.',
		answer:
			'We tested surge multipliers in Hyderabad. I designed the diff-in-diff, and we saw a 4% lift in completed trips.',
		asker: 'recruiter-9',
		answerer: 'candidate-4',
	},
]);

beforeEach(() => {
	mockChat.mockReset();
	mockGenerateScreeningReport.mockReset();
	mockRunMultiEvaluation.mockReset();
});

describe('extractQAPairs', () => {
	test('extracts Q&A pairs with asker/answerer labels from a free-form two-speaker transcript', async () => {
		mockChat.mockResolvedValue(FIXTURE_QA_JSON);

		const pairs = await extractQAPairs(FIXTURE_TRANSCRIPT);

		expect(pairs).toHaveLength(2);
		expect(pairs[0]).toEqual({
			question: 'Tell me about yourself.',
			answer:
				"I'm a data analyst with 6 years at Uber India, mostly on marketplace pricing dashboards.",
			asker: 'recruiter-9',
			answerer: 'candidate-4',
		});
		expect(pairs[1].asker).toBe('recruiter-9');
		expect(pairs[1].answerer).toBe('candidate-4');
		// The LLM saw the speaker-labeled transcript.
		expect(mockChat).toHaveBeenCalledTimes(1);
		const prompt = mockChat.mock.calls[0][0];
		expect(prompt).toContain('recruiter-9');
		expect(prompt).toContain('candidate-4');
	});

	test('returns [] for an empty transcript without calling the LLM', async () => {
		const pairs = await extractQAPairs([]);

		expect(pairs).toEqual([]);
		expect(mockChat).not.toHaveBeenCalled();
	});

	test('returns [] when the LLM returns malformed JSON', async () => {
		mockChat.mockResolvedValue('not json at all {');

		const pairs = await extractQAPairs(FIXTURE_TRANSCRIPT);

		expect(pairs).toEqual([]);
	});

	test('returns [] when the LLM call fails', async () => {
		mockChat.mockRejectedValue(new Error('LLM down'));

		const pairs = await extractQAPairs(FIXTURE_TRANSCRIPT);

		expect(pairs).toEqual([]);
	});
});

describe('analyzeObserverSession', () => {
	const session = { id: 7, candidate_id: 4, job_id: 11, company_id: 2 };
	const qaPairs = JSON.parse(FIXTURE_QA_JSON);

	test('feeds Q&A pairs into generateScreeningReport as conversation and carries recruiter weights', async () => {
		const recruiterWeights = { can_do_the_work: 50, communication_quality: 50 };
		mockGenerateScreeningReport.mockResolvedValue({ overall_score: 82, recommendation: 'advance' });

		const report = await analyzeObserverSession({
			session,
			qaPairs,
			rubricWeights: recruiterWeights,
			job: { title: 'Data Analyst' },
		});

		// Conversation built from pairs, interviewer/candidate roles.
		const arg = mockGenerateScreeningReport.mock.calls[0][0];
		expect(arg.conversation).toHaveLength(4);
		expect(arg.conversation[0]).toMatchObject({
			role: 'interviewer',
			text: 'Tell me about yourself.',
		});
		expect(arg.conversation[1].role).toBe('candidate');
		expect(report.rubric_source).toBe('recruiter');
		expect(report.rubric_weights_used).toEqual(recruiterWeights);
		expect(report.overall_score).toBe(82);
	});

	test('uses the default rubric when no recruiter weights are defined', async () => {
		mockGenerateScreeningReport.mockResolvedValue({
			overall_score: 70,
			recommendation: 'consider',
		});

		const report = await analyzeObserverSession({ session, qaPairs, rubricWeights: {}, job: {} });

		expect(report.rubric_source).toBe('default');
		expect(report.rubric_weights_used).toBeDefined();
		expect(Object.values(report.rubric_weights_used).reduce((a, b) => a + b, 0)).toBe(100);
	});

	test('kicks off runMultiEvaluation in the background without blocking the report', async () => {
		mockGenerateScreeningReport.mockResolvedValue({
			overall_score: 75,
			recommendation: 'consider',
		});
		mockRunMultiEvaluation.mockResolvedValue({ score: 75 });

		const report = await analyzeObserverSession({
			session,
			qaPairs,
			rubricWeights: null,
			job: { title: 'Data Analyst', description: 'SQL, dashboards' },
		});

		expect(report.overall_score).toBe(75);
		expect(mockRunMultiEvaluation).toHaveBeenCalledTimes(1);
		const [candidateId, jobId, companyId, ctx] = mockRunMultiEvaluation.mock.calls[0];
		expect(candidateId).toBe(4);
		expect(jobId).toBe(11);
		expect(companyId).toBe(2);
		expect(ctx.jobTitle).toBe('Data Analyst');
		expect(Array.isArray(ctx.conversation)).toBe(true);
	});
});
