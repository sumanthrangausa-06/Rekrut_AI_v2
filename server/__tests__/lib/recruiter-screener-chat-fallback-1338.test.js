/**
 * #1338: screenCandidate() called chat() with no try/catch, so a thrown
 * provider error (e.g. "No available providers for llm...") bypassed the
 * existing calculateBasicFitScore fallback and single-screen routes 500'd.
 *
 * Fixed behaviour: a thrown chat() error is logged loudly (console.error,
 * message only — no prompt/candidate PII) and screenCandidate returns the
 * module's own basic-fit fallback, exactly as the unparseable-output path
 * already did. Batch screening consequently returns basic-fit results
 * instead of the {recommendation:'error', fit_score:0} sentinel (named,
 * intentional behaviour change — pinned by the batch test below; the batch
 * per-candidate .catch() is retained as defence-in-depth).
 *
 * Mocking note: recruiter-screener destructures { chat, safeParseJSON }
 * from ./polsia-ai at load time, so the mock is registered before require.
 * safeParseJSON is reproduced faithfully for the inputs used here (valid
 * JSON parses; anything else returns null — its real contract), NOT stubbed
 * to null, so the throw path stays distinguishable from the parse path.
 */
jest.mock('../../../lib/db', () => ({ query: jest.fn() }));
jest.mock('../../../lib/polsia-ai', () => ({
	chat: jest.fn(),
	safeParseJSON: (text) => {
		if (!text || typeof text !== 'string') return null;
		try {
			return JSON.parse(text);
		} catch {
			return null;
		}
	},
}));

const pool = require('../../../lib/db');
const { chat } = require('../../../lib/polsia-ai');
const {
	screenCandidate,
	screenCandidatesBatch,
	calculateBasicFitScore,
} = require('../../../lib/recruiter-screener');

const CANDIDATE = {
	id: 3,
	name: 'Fixture Person',
	omni_score: 720,
	skills: [
		{ name: 'React', level: 'advanced' },
		{ name: 'Node.js', level: 'intermediate' },
	],
	years_experience: 5,
	experience: [{ title: 'Engineer', company: 'ExampleCo' }],
	education: [{ degree: 'BS', field: 'CS' }],
};
const JOB = {
	id: 1,
	title: 'Frontend Engineer',
	required_skills: ['React', 'GraphQL'],
	preferred_skills: [],
	min_years: 2,
};

const PROVIDER_ERROR = new Error(
	'No available providers for llm. anthropic: not configured, openai: not configured',
);

let errorSpy;
beforeEach(() => {
	jest.clearAllMocks();
	pool.query.mockResolvedValue({ rows: [], rowCount: 1 });
	errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe('#1338 screenCandidate thrown chat() error', () => {
	test('resolves to the basic-fit fallback instead of throwing', async () => {
		chat.mockRejectedValue(PROVIDER_ERROR);

		const result = await screenCandidate(CANDIDATE, JOB);

		const expected = calculateBasicFitScore(CANDIDATE, JOB);
		expect(result.fit_score).toBe(expected.fit_score);
		// Hard-coded oracle for this fixture: 50 base + 10 skills (1/2 * 20)
		// + 15 experience (min(5/2, 1.5) * 10) + 7.64 OmniScore -> 83.
		expect(result.fit_score).toBe(83);
		expect(result.recommendation_reason).toMatch(/Basic automated screening/);
		expect(['interview', 'more_info', 'reject']).toContain(result.recommendation);
		expect(result.recommendation).not.toBe('error');
		expect(result.fit_score).toBeGreaterThanOrEqual(0);
		expect(result.fit_score).toBeLessThanOrEqual(100);
	});

	test('logs the fallback loudly, message only, with no candidate PII', async () => {
		chat.mockRejectedValue(PROVIDER_ERROR);

		await screenCandidate(CANDIDATE, JOB);

		expect(errorSpy).toHaveBeenCalledTimes(1);
		const logged = errorSpy.mock.calls[0].join(' ');
		expect(logged).toContain('[screener]');
		expect(logged).toContain('falling back to basic fit score');
		expect(logged).toContain('No available providers for llm');
		expect(logged).not.toContain(CANDIDATE.name);
		expect(logged).not.toContain('CANDIDATE PROFILE');
	});

	test('batch: every candidate gets a basic-fit result, none the error sentinel', async () => {
		chat.mockRejectedValue(PROVIDER_ERROR);

		const results = await screenCandidatesBatch([CANDIDATE, { ...CANDIDATE, id: 4 }], JOB);

		expect(results).toHaveLength(2);
		for (const r of results) {
			expect(r.recommendation).not.toBe('error');
			expect(typeof r.fit_score).toBe('number');
			expect(r.fit_score).toBeGreaterThan(0);
		}
	});
});

describe('#1338 regression guards (pre-existing paths unchanged)', () => {
	test('valid AI JSON is returned as parsed, no fallback, no error log', async () => {
		chat.mockResolvedValue(
			JSON.stringify({ fit_score: 91, recommendation: 'interview', strengths: ['x'] }),
		);

		const result = await screenCandidate(CANDIDATE, JOB);

		expect(result.fit_score).toBe(91);
		expect(result.recommendation).toBe('interview');
		expect(errorSpy).not.toHaveBeenCalled();
		// Screening-log insert is attempted on the AI path.
		expect(pool.query).toHaveBeenCalled();
	});

	test('unparseable AI output still reaches the parse-failure fallback (silently)', async () => {
		chat.mockResolvedValue('not json at all');

		const result = await screenCandidate(CANDIDATE, JOB);

		expect(result.fit_score).toBe(calculateBasicFitScore(CANDIDATE, JOB).fit_score);
		expect(errorSpy).not.toHaveBeenCalled();
	});
});
