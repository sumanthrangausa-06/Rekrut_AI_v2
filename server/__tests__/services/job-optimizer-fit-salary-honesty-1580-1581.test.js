/**
 * #1580 + #1581 — analyzeCandidateFit and getSalaryInsights must never
 * fabricate numbers.
 *
 * services/job-optimizer.js:
 *  - analyzeCandidateFit: on AI parse failure the fallback returned
 *    { fit_score: 50, fit_level: 'moderate' } — served as success by
 *    POST /jobs/:id/analyze-candidate (routes/recruiter.js).
 *  - getSalaryInsights: on AI parse failure the fallback returned an
 *    invented salary_range { low: 50000, median: 75000, high: 100000 },
 *    market_demand 'medium', salary_trend 'stable' — served as success
 *    by GET /salary-insights (routes/recruiter.js).
 *
 * Fixed behaviour (precedent #1570 / #1345, same file — analyzeJobPosting
 * already throws this way, and both routes already catch -> honest 500):
 *  - Parse failure throws an Error with code 'AI_PROVIDER_UNAVAILABLE'
 *    and statusCode 503. Prose-wrapped invalid JSON and empty output
 *    fall through to the same throw.
 *  - Valid JSON — bare or prose-wrapped — returns exactly as before,
 *    including a genuine fit_score of 0 staying 0.
 *
 * Mocking note: job-optimizer destructures { chat } from lib/polsia-ai at
 * load time, so the mock is registered before require.
 */

const mockChat = jest.fn();
jest.mock('../../../lib/polsia-ai', () => ({
	chat: (...args) => mockChat(...args),
}));

const { analyzeCandidateFit, getSalaryInsights } = require('../../../services/job-optimizer');

const CANDIDATE = {
	name: 'Fixture Candidate',
	omniscore: 71,
	skills: ['React', 'Node.js'],
	experience: '4 years frontend',
	interview_score: 7,
};

const JOB = {
	title: 'Frontend Engineer',
	description: 'Build user interfaces with React.',
	requirements: '3+ years React',
};

const REAL_FIT = {
	fit_score: 84,
	fit_level: 'good',
	matching_qualifications: ['React'],
	gaps: [],
	strengths: ['Strong UI experience'],
	interview_focus_areas: ['System design'],
	recommendation: 'Proceed to interview',
	comparison_notes: 'Above typical applicants',
};

const REAL_FIT_ZERO = { ...REAL_FIT, fit_score: 0, fit_level: 'low' };

const REAL_SALARY = {
	salary_range: { low: 90000, median: 120000, high: 150000, currency: 'USD' },
	market_demand: 'high',
	salary_trend: 'increasing',
	factors_affecting_salary: ['Location'],
	comparable_titles: ['UI Engineer'],
	benefits_typically_included: ['Health insurance'],
	negotiation_tips: 'Anchor on market median',
};

beforeEach(() => {
	jest.clearAllMocks();
});

describe('#1580 analyzeCandidateFit parse failure is honest', () => {
	test('unparseable AI output rejects with AI_PROVIDER_UNAVAILABLE, never resolves to fit 50/moderate', async () => {
		mockChat.mockResolvedValue('Sorry, I cannot evaluate this candidate right now.');

		await expect(analyzeCandidateFit(CANDIDATE, JOB)).rejects.toMatchObject({
			code: 'AI_PROVIDER_UNAVAILABLE',
			statusCode: 503,
		});
	});

	test('prose-wrapped invalid JSON also rejects instead of fabricating a fit score', async () => {
		mockChat.mockResolvedValue('Here is the fit: {fit_score: ,,,} hope that helps');

		await expect(analyzeCandidateFit(CANDIDATE, JOB)).rejects.toMatchObject({
			code: 'AI_PROVIDER_UNAVAILABLE',
			statusCode: 503,
		});
	});

	test('empty AI output rejects instead of fabricating a fit score', async () => {
		mockChat.mockResolvedValue('');

		await expect(analyzeCandidateFit(CANDIDATE, JOB)).rejects.toMatchObject({
			code: 'AI_PROVIDER_UNAVAILABLE',
		});
	});
});

describe('#1580 real fit analyses are unchanged', () => {
	test('valid JSON returns byte-identical analysis', async () => {
		mockChat.mockResolvedValue(JSON.stringify(REAL_FIT));

		await expect(analyzeCandidateFit(CANDIDATE, JOB)).resolves.toEqual(REAL_FIT);
	});

	test('prose-wrapped valid JSON still extracts and returns the analysis', async () => {
		mockChat.mockResolvedValue(`Fit complete:\n${JSON.stringify(REAL_FIT)}\nDone.`);

		await expect(analyzeCandidateFit(CANDIDATE, JOB)).resolves.toEqual(REAL_FIT);
	});

	test('a genuine fit_score of 0 stays 0', async () => {
		mockChat.mockResolvedValue(JSON.stringify(REAL_FIT_ZERO));

		const result = await analyzeCandidateFit(CANDIDATE, JOB);
		expect(result).toEqual(REAL_FIT_ZERO);
		expect(result.fit_score).toBe(0);
	});
});

describe('#1581 getSalaryInsights parse failure is honest', () => {
	test('unparseable AI output rejects with AI_PROVIDER_UNAVAILABLE, never resolves to invented 50000/75000/100000', async () => {
		mockChat.mockResolvedValue('Sorry, salary data is unavailable right now.');

		await expect(getSalaryInsights('Frontend Engineer', 'Remote', 'mid')).rejects.toMatchObject({
			code: 'AI_PROVIDER_UNAVAILABLE',
			statusCode: 503,
		});
	});

	test('prose-wrapped invalid JSON also rejects instead of inventing a salary range', async () => {
		mockChat.mockResolvedValue('Here are insights: {salary_range: ,,,} hope that helps');

		await expect(getSalaryInsights('Frontend Engineer', 'Remote', 'mid')).rejects.toMatchObject({
			code: 'AI_PROVIDER_UNAVAILABLE',
			statusCode: 503,
		});
	});

	test('empty AI output rejects instead of inventing a salary range', async () => {
		mockChat.mockResolvedValue('');

		await expect(getSalaryInsights('Frontend Engineer', 'Remote', 'mid')).rejects.toMatchObject({
			code: 'AI_PROVIDER_UNAVAILABLE',
		});
	});
});

describe('#1581 real salary insights are unchanged', () => {
	test('valid JSON returns byte-identical insights', async () => {
		mockChat.mockResolvedValue(JSON.stringify(REAL_SALARY));

		await expect(getSalaryInsights('Frontend Engineer', 'Remote', 'mid')).resolves.toEqual(REAL_SALARY);
	});

	test('prose-wrapped valid JSON still extracts and returns the insights', async () => {
		mockChat.mockResolvedValue(`Insights complete:\n${JSON.stringify(REAL_SALARY)}\nDone.`);

		await expect(getSalaryInsights('Frontend Engineer', 'Remote', 'mid')).resolves.toEqual(REAL_SALARY);
	});
});
