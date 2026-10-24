/**
 * #1570 — analyzeJobPosting must never fabricate scores.
 *
 * services/job-optimizer.js analyzeJobPosting: when the AI response cannot
 * be parsed as JSON, the fallback returned authenticity/completeness/
 * clarity/overall scores of 50. No analysis happened, yet the job-create
 * flow (routes/recruiter.js) passed analysis.overall_score straight into
 * trustscoreService.addJobAuthenticityComponent — writing a fabricated 50
 * into a company's Trust Score.
 *
 * Fixed behaviour (shape both existing callers already handle, matching
 * the sibling functions in job-optimizer.js and the #1345 precedent):
 *  - Parse failure throws an Error with code 'AI_PROVIDER_UNAVAILABLE'
 *    and statusCode 503.
 *      * POST /recruiter/jobs/analyze already catches -> honest 500.
 *      * Job-create already catches (same try block, component call after
 *        the analyze call) -> job is created, Trust Score component is
 *        SKIPPED (absent, never 50).
 *  - Valid JSON — bare or prose-wrapped — returns exactly as before.
 *
 * Mocking note: job-optimizer destructures { chat } from lib/polsia-ai at
 * load time, so the mock is registered before require.
 */

const mockChat = jest.fn();
jest.mock('../../../lib/polsia-ai', () => ({
	chat: (...args) => mockChat(...args),
}));

const { analyzeJobPosting } = require('../../../services/job-optimizer');

const JOB = {
	title: 'Frontend Engineer',
	description: 'Build user interfaces with React.',
	requirements: '3+ years React',
	location: 'Remote',
	job_type: 'full-time',
	company: 'Fixture Co',
};

const REAL_ANALYSIS = {
	authenticity_score: 82,
	completeness_score: 74,
	clarity_score: 91,
	overall_score: 83,
	issues: [],
	strengths: ['Clear requirements'],
	missing_elements: [],
	improvement_suggestions: [],
	salary_assessment: 'appropriate',
	red_flags: [],
};

beforeEach(() => {
	jest.clearAllMocks();
});

describe('#1570 analyzeJobPosting parse failure is honest', () => {
	test('unparseable AI output rejects with AI_PROVIDER_UNAVAILABLE, never resolves to 50s', async () => {
		mockChat.mockResolvedValue('Sorry, I cannot analyze this posting right now.');

		await expect(analyzeJobPosting(JOB)).rejects.toMatchObject({
			code: 'AI_PROVIDER_UNAVAILABLE',
			statusCode: 503,
		});
	});

	test('prose-wrapped invalid JSON also rejects instead of fabricating scores', async () => {
		mockChat.mockResolvedValue('Here is the analysis: {authenticity_score: ,,,} hope that helps');

		await expect(analyzeJobPosting(JOB)).rejects.toMatchObject({
			code: 'AI_PROVIDER_UNAVAILABLE',
			statusCode: 503,
		});
	});

	test('empty AI output rejects instead of fabricating scores', async () => {
		mockChat.mockResolvedValue('');

		await expect(analyzeJobPosting(JOB)).rejects.toMatchObject({
			code: 'AI_PROVIDER_UNAVAILABLE',
		});
	});
});

describe('#1570 real analyses are unchanged', () => {
	test('valid JSON returns byte-identical analysis', async () => {
		mockChat.mockResolvedValue(JSON.stringify(REAL_ANALYSIS));

		await expect(analyzeJobPosting(JOB)).resolves.toEqual(REAL_ANALYSIS);
	});

	test('prose-wrapped valid JSON still extracts and returns the analysis', async () => {
		mockChat.mockResolvedValue(`Analysis complete:\n${JSON.stringify(REAL_ANALYSIS)}\nDone.`);

		await expect(analyzeJobPosting(JOB)).resolves.toEqual(REAL_ANALYSIS);
	});
});

describe('#1570 job-create Trust Score guard', () => {
	test('routes/recruiter.js only writes the Trust Score component for a finite overall_score', () => {
		const fs = require('fs');
		const path = require('path');
		const src = fs.readFileSync(path.join(__dirname, '../../../routes/recruiter.js'), 'utf8');
		const callIdx = src.indexOf('addJobAuthenticityComponent');
		expect(callIdx).toBeGreaterThan(-1);
		const before = src.slice(Math.max(0, callIdx - 300), callIdx);
		// The component call must be guarded so a missing/non-numeric
		// overall_score (valid JSON, no real score) can never write
		// fabricated or NaN points into the Trust Score.
		expect(before).toMatch(/Number\.isFinite\(analysis\.overall_score\)/);
	});
});
