/**
 * #1345: generateTailoredInterviewQuestions() and compareCandidates() in
 * lib/recruiter-screener.js both awaited chat() with no try/catch (sibling
 * of #1338, which fixed the same defect in screenCandidate).
 *
 * Unlike screenCandidate, neither function has a designed non-fabricated
 * fallback, so #1338's return-a-fallback shape does not apply:
 *  - compareCandidates' parse-failure fallback was a FABRICATED
 *    {recommended:'tie'} — a fake tie is fabricated data on ANY failure
 *    path (Sumanth's no-fabricated-data rule; silent-failure-hunter STOP 1).
 *  - generateTailoredInterviewQuestions' parse-failure fallback [] is
 *    rendered by its only caller (routes/screening.js POST /questions) as
 *    200 {success:true, questions:[]} — a fake success, indistinguishable
 *    from a genuine empty result.
 *
 * Fixed behaviour (Lead team position, shaped by the ecc
 * silent-failure-hunter STOP 1 review on #1345):
 *  - On a thrown chat() error: log loudly (console.error, message only —
 *    no prompt/candidate PII) and rethrow the ORIGINAL error mutated with
 *    code 'AI_PROVIDER_UNAVAILABLE' + statusCode 503 (set only if absent;
 *    preserves the provider error's type/stack/identity).
 *  - On parse failure (questions: unparseable / non-array / empty array;
 *    compare: unparseable, or `recommended` not in candidate1|candidate2|tie):
 *    log the failure mode and throw a new Error with the SAME code +
 *    statusCode. A genuine AI-returned tie still resolves normally.
 *  - The only callers (routes/screening.js /questions and /compare) already
 *    wrap these calls in try/catch -> honest 500 with non-leaking bodies.
 *
 * Mocking note: recruiter-screener destructures { chat, safeParseJSON }
 * from ./polsia-ai at load time, so the mock is registered before require.
 * safeParseJSON is reproduced faithfully (valid JSON parses; anything
 * else returns null — its real contract).
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

const { chat } = require('../../../lib/polsia-ai');
const {
	generateTailoredInterviewQuestions,
	compareCandidates,
} = require('../../../lib/recruiter-screener');

const CANDIDATE = {
	id: 3,
	name: 'Fixture Person',
	omni_score: 720,
	skills: [{ name: 'React' }, { name: 'Node.js' }],
	years_experience: 5,
};
const CANDIDATE2 = {
	id: 4,
	name: 'Second Person',
	omni_score: 640,
	skills: [{ name: 'Python' }],
	years_experience: 3,
};
const JOB = {
	id: 1,
	title: 'Frontend Engineer',
	required_skills: ['React', 'GraphQL'],
	min_years: 2,
};

const makeProviderError = () =>
	new Error('No available providers for llm. anthropic: not configured, openai: not configured');

let errorSpy;
let warnSpy;
beforeEach(() => {
	jest.clearAllMocks();
	errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
	warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	errorSpy.mockRestore();
	warnSpy.mockRestore();
});

describe('#1345 generateTailoredInterviewQuestions failures are honest', () => {
	test('thrown chat() error: rethrown (same object) with code + statusCode, never []', async () => {
		const providerError = makeProviderError();
		chat.mockRejectedValue(providerError);

		const err = await generateTailoredInterviewQuestions(CANDIDATE, JOB).catch((e) => e);

		expect(err).toBe(providerError);
		expect(err.code).toBe('AI_PROVIDER_UNAVAILABLE');
		expect(err.statusCode).toBe(503);
	});

	test('thrown chat() error: logged loudly, message only, no candidate PII or prompt', async () => {
		chat.mockRejectedValue(makeProviderError());

		await generateTailoredInterviewQuestions(CANDIDATE, JOB).catch(() => {});

		expect(errorSpy).toHaveBeenCalledTimes(1);
		const logged = errorSpy.mock.calls[0].join(' ');
		expect(logged).toContain('[screener]');
		expect(logged).toContain('generateTailoredInterviewQuestions');
		expect(logged).toContain('ai_call_failed');
		expect(logged).toContain('No available providers for llm');
		expect(logged).not.toContain(CANDIDATE.name);
		expect(logged).not.toContain('CANDIDATE GAPS');
	});

	test('unparseable AI output: rejects with the same code — never resolves to []', async () => {
		chat.mockResolvedValue('not json at all');

		const err = await generateTailoredInterviewQuestions(CANDIDATE, JOB).catch((e) => e);

		expect(err).toBeInstanceOf(Error);
		expect(err.code).toBe('AI_PROVIDER_UNAVAILABLE');
		expect(err.statusCode).toBe(503);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0].join(' ')).toContain('ai_unparseable');
		expect(warnSpy.mock.calls[0].join(' ')).not.toContain(CANDIDATE.name);
	});

	test('AI returns an empty array: rejects (model non-performance, not a genuine result)', async () => {
		chat.mockResolvedValue('[]');

		const err = await generateTailoredInterviewQuestions(CANDIDATE, JOB).catch((e) => e);

		expect(err).toBeInstanceOf(Error);
		expect(err.code).toBe('AI_PROVIDER_UNAVAILABLE');
	});

	test('valid AI JSON array is returned as parsed, no error/warn log', async () => {
		const questions = [{ question: 'How have you used React?', category: 'technical' }];
		chat.mockResolvedValue(JSON.stringify(questions));

		await expect(generateTailoredInterviewQuestions(CANDIDATE, JOB)).resolves.toEqual(questions);
		expect(errorSpy).not.toHaveBeenCalled();
		expect(warnSpy).not.toHaveBeenCalled();
	});
});

describe('#1345 compareCandidates failures are honest', () => {
	test('thrown chat() error: rethrown (same object) with code + statusCode, never the fabricated tie', async () => {
		const providerError = makeProviderError();
		chat.mockRejectedValue(providerError);

		const settled = await compareCandidates(CANDIDATE, CANDIDATE2, JOB).catch((e) => e);

		expect(settled).toBe(providerError);
		expect(settled.code).toBe('AI_PROVIDER_UNAVAILABLE');
		expect(settled.statusCode).toBe(503);
		expect(settled.recommended).toBeUndefined();
	});

	test('thrown chat() error: logged loudly, message only, no candidate PII or prompt', async () => {
		chat.mockRejectedValue(makeProviderError());

		await compareCandidates(CANDIDATE, CANDIDATE2, JOB).catch(() => {});

		expect(errorSpy).toHaveBeenCalledTimes(1);
		const logged = errorSpy.mock.calls[0].join(' ');
		expect(logged).toContain('[screener]');
		expect(logged).toContain('compareCandidates');
		expect(logged).toContain('ai_call_failed');
		expect(logged).toContain('No available providers for llm');
		expect(logged).not.toContain(CANDIDATE.name);
		expect(logged).not.toContain(CANDIDATE2.name);
		expect(logged).not.toContain('CANDIDATE 1');
	});

	test('unparseable AI output: rejects with the same code — never the fabricated tie', async () => {
		chat.mockResolvedValue('not json at all');

		const settled = await compareCandidates(CANDIDATE, CANDIDATE2, JOB).catch((e) => e);

		expect(settled).toBeInstanceOf(Error);
		expect(settled.code).toBe('AI_PROVIDER_UNAVAILABLE');
		expect(settled.statusCode).toBe(503);
		expect(settled.recommended).toBeUndefined();
		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy.mock.calls[0].join(' ')).toContain('ai_parse_failed');
	});

	test('parsed JSON with an invalid recommended value: rejects with the same code', async () => {
		chat.mockResolvedValue(JSON.stringify({ recommended: 'banana', summary: 'x' }));

		const settled = await compareCandidates(CANDIDATE, CANDIDATE2, JOB).catch((e) => e);

		expect(settled).toBeInstanceOf(Error);
		expect(settled.code).toBe('AI_PROVIDER_UNAVAILABLE');
	});

	test('valid AI JSON — including a genuine tie — is returned as parsed, no error log', async () => {
		const comparison = { recommended: 'candidate1', summary: 'Stronger React depth.' };
		chat.mockResolvedValue(JSON.stringify(comparison));
		await expect(compareCandidates(CANDIDATE, CANDIDATE2, JOB)).resolves.toEqual(comparison);

		const tie = { recommended: 'tie', summary: 'Genuinely even on the evidence provided.' };
		chat.mockResolvedValue(JSON.stringify(tie));
		await expect(compareCandidates(CANDIDATE, CANDIDATE2, JOB)).resolves.toEqual(tie);

		expect(errorSpy).not.toHaveBeenCalled();
	});
});
