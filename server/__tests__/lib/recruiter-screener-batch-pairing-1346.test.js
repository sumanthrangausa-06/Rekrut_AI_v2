/**
 * #1346: screenCandidatesBatch() sorts results by fit_score descending
 * (lib/recruiter-screener.js) but the results carried no candidate_id on
 * the AI-success or basic-fit paths — only the per-candidate error
 * sentinel set one. The batch routes therefore paired sorted results
 * back to candidates by array index and misattributed scores whenever
 * the sort reordered the batch.
 *
 * Fixed behaviour: every batch result carries the candidate_id of the
 * candidate that produced it, on every path, so callers can pair by id.
 *
 * Mocking note (same as #1338's test): recruiter-screener destructures
 * { chat, safeParseJSON } from ./polsia-ai at load time, so the mock is
 * registered before require, and safeParseJSON faithfully reproduces its
 * real contract for the inputs used here.
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
const { screenCandidatesBatch } = require('../../../lib/recruiter-screener');

const JOB = {
	id: 1,
	title: 'Frontend Engineer',
	required_skills: ['React', 'GraphQL'],
	preferred_skills: [],
	min_years: 2,
};

function candidate(id, name, extra = {}) {
	return {
		id,
		name,
		omni_score: 720,
		skills: [{ name: 'React', level: 'advanced' }],
		years_experience: 5,
		experience: [{ title: 'Engineer', company: 'ExampleCo' }],
		education: [{ degree: 'BS', field: 'CS' }],
		...extra,
	};
}

beforeEach(() => {
	jest.clearAllMocks();
	pool.query.mockResolvedValue({ rows: [], rowCount: 1 });
	jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	console.error.mockRestore();
	console.warn.mockRestore();
});

describe('#1346 screenCandidatesBatch candidate_id preservation', () => {
	test('AI path: out-of-order scores stay attributed to the candidate who earned them', async () => {
		// Input order is Low, High, Mid; the sort will reorder to
		// High, Mid, Low. Score is keyed off the name embedded in the prompt.
		const scoreByName = { Low: 20, High: 95, Mid: 60 };
		chat.mockImplementation(async (prompt) => {
			const name = Object.keys(scoreByName).find((n) => prompt.includes(`- Name: ${n}\n`));
			return JSON.stringify({ fit_score: scoreByName[name], recommendation: 'interview' });
		});

		const results = await screenCandidatesBatch(
			[candidate(11, 'Low'), candidate(22, 'High'), candidate(33, 'Mid')],
			JOB,
		);

		// Sorted descending by score (pre-existing behaviour, unchanged)...
		expect(results.map((r) => r.fit_score)).toEqual([95, 60, 20]);
		// ...but every result names its own candidate.
		expect(results.map((r) => r.candidate_id)).toEqual([22, 33, 11]);
		expect(results.find((r) => r.fit_score === 95).candidate_id).toBe(22);
		expect(results.find((r) => r.fit_score === 20).candidate_id).toBe(11);
	});

	test('basic-fit path: unparseable AI output still yields correctly attributed results', async () => {
		chat.mockResolvedValue('not json at all');

		// Weak: no matching skills, no experience, no OmniScore -> 50.
		const weak = candidate(44, 'Weak', { skills: [], years_experience: 0, omni_score: null });
		// Strong: both required skills, 10y vs 2y min, OmniScore 850 -> 95.
		const strong = candidate(55, 'Strong', {
			skills: [
				{ name: 'React', level: 'advanced' },
				{ name: 'GraphQL', level: 'advanced' },
			],
			years_experience: 10,
			omni_score: 850,
		});

		// Input order Weak, Strong — the sort flips them.
		const results = await screenCandidatesBatch([weak, strong], JOB);

		expect(results.map((r) => r.fit_score)).toEqual([95, 50]);
		expect(results.map((r) => r.candidate_id)).toEqual([55, 44]);
	});

	test('basic-fit path via thrown chat(): results are attributed, not the error sentinel', async () => {
		chat.mockRejectedValue(new Error('No available providers for llm'));

		const results = await screenCandidatesBatch(
			[candidate(11, 'Low'), candidate(22, 'High')],
			JOB,
		);

		expect(results).toHaveLength(2);
		for (const r of results) {
			expect([11, 22]).toContain(r.candidate_id);
			expect(r.recommendation).not.toBe('error');
		}
		// Each id appears exactly once — no duplication, no loss.
		expect(results.map((r) => r.candidate_id).sort()).toEqual([11, 22]);
	});
});
