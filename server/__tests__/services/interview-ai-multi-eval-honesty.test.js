/**
 * #1505 — runMultiEvaluation must never persist a fabricated score.
 *
 * On origin/dev @ cd85dd09c, any failed evaluator lens (provider rejection or
 * unparseable JSON) was persisted as score:50 with reasoning
 * 'AI evaluation unavailable — using neutral score', and the composite
 * synthesis baked fallback 50s in via `evaluations.technical.score || 50`
 * (which also silently replaced a genuine score of 0 with 50).
 *
 * Honest contract (STOP 1 design decision on #1505):
 *  - a failed lens writes NO interview_evaluations row (score column is
 *    NOT NULL in migration 041 — a NULL-score row would need a migration,
 *    and the display subqueries in routes/interviews.js pick the latest
 *    row, so a NULL row could mask real scores);
 *  - the composite is synthesised from successful lenses only, with the
 *    0.4/0.3/0.3 weights renormalised over the lenses present, and NULL
 *    persisted for a missing lens;
 *  - all lenses failing => no composite row, no OmniScore feed,
 *    composite: null — unavailability is a state, not a score.
 *
 * The DB and AI provider are mocked at the module boundary: the behaviour
 * under test lives in runMultiEvaluation's own persistence/synthesis logic,
 * and the failure condition IS the provider failing — no live provider is
 * needed (or wanted) to prove it. The HL-003 fresh-install E2E is Quinn's
 * AFTER capture (see PR body).
 */

const mockQuery = jest.fn();
jest.mock('../../../lib/db', () => ({
	query: (...args) => mockQuery(...args),
}));

const mockChat = jest.fn();
jest.mock('../../../lib/ai-provider', () => ({
	chat: (...args) => mockChat(...args),
}));

const mockAddInterviewComponent = jest.fn();
jest.mock('../../../services/omniscore', () => ({
	addInterviewComponent: (...args) => mockAddInterviewComponent(...args),
}));

const { runMultiEvaluation } = require('../../../services/interview-ai');

const CONTEXT = {
	screeningSessionId: 42,
	conversation: [
		{ role: 'interviewer', text: 'Tell me about a hard technical problem you solved.' },
		{
			role: 'candidate',
			text: 'I rebuilt a reporting pipeline at Uber India, cutting runtime from hours to minutes by partitioning the warehouse queries.',
		},
	],
	jobTitle: 'Data Analyst',
	jobDescription: 'Analyse product data and build dashboards.',
};

function lensJson(score) {
	return JSON.stringify({
		score,
		breakdown: {},
		reasoning: `Lens reasoning for ${score}`,
		key_observations: ['observed'],
	});
}

/** Per-lens behaviour keyed by the `task` option runMultiEvaluation passes. */
function setLensBehaviour({ technical, culture, experience }) {
	const byType = { technical, culture, experience };
	mockChat.mockImplementation((_prompt, opts) => {
		const type = String(opts.task).replace('multi-eval-', '');
		const b = byType[type];
		if (b instanceof Error) return Promise.reject(b);
		return Promise.resolve(b);
	});
}

function insertsInto(table) {
	return mockQuery.mock.calls
		.filter(([sql]) => sql.includes(`INSERT INTO ${table}`))
		.map(([, params]) => params);
}

beforeEach(() => {
	mockQuery.mockReset();
	mockQuery.mockResolvedValue({ rows: [] });
	mockChat.mockReset();
	mockAddInterviewComponent.mockReset();
	mockAddInterviewComponent.mockResolvedValue(undefined);
	jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
	jest.restoreAllMocks();
});

describe('runMultiEvaluation honesty (#1505)', () => {
	test('partial failure: only successful lenses persist; no fabricated 50 anywhere', async () => {
		setLensBehaviour({
			technical: lensJson(80),
			culture: new Error('provider down'),
			experience: lensJson(60),
		});

		const result = await runMultiEvaluation(7, 11, 3, CONTEXT);

		const evalRows = insertsInto('interview_evaluations');
		expect(evalRows).toHaveLength(2);
		expect(evalRows.map((p) => p[5]).sort()).toEqual(['experience', 'technical']);
		// No persisted row carries the fabricated neutral score / marker.
		for (const params of evalRows) {
			expect(params[6]).not.toBe(50);
			expect(params[8]).not.toContain('using neutral score');
		}
		expect(result.evaluations.culture).toBeUndefined();
	});

	test('partial failure: composite renormalises over successful lenses, missing lens is NULL', async () => {
		setLensBehaviour({
			technical: lensJson(80),
			culture: new Error('provider down'),
			experience: lensJson(60),
		});

		const result = await runMultiEvaluation(7, 11, 3, CONTEXT);

		const compositeRows = insertsInto('interview_composite_scores');
		expect(compositeRows).toHaveLength(1);
		const [, , , , , tech, culture, exp, composite, , reasoning] = compositeRows[0];
		expect(tech).toBe(80);
		expect(culture).toBeNull();
		expect(exp).toBe(60);
		// (80*0.4 + 60*0.3) / (0.4+0.3) = 71.43 -> 71
		expect(composite).toBe(71);
		expect(reasoning).toMatch(/unavailable/i);
		expect(result.composite.culture_score).toBeNull();
		expect(result.composite.composite_score).toBe(71);
		// Real (partial) evidence still feeds OmniScore, at the honest value.
		expect(mockAddInterviewComponent).toHaveBeenCalledWith(7, 'screening-42', 7.1);
	});

	test('all lenses fail: nothing persisted, no composite, no OmniScore feed', async () => {
		setLensBehaviour({
			technical: new Error('provider down'),
			culture: new Error('provider down'),
			experience: new Error('provider down'),
		});

		const result = await runMultiEvaluation(7, 11, 3, CONTEXT);

		expect(insertsInto('interview_evaluations')).toHaveLength(0);
		expect(insertsInto('interview_composite_scores')).toHaveLength(0);
		expect(mockAddInterviewComponent).not.toHaveBeenCalled();
		expect(result.composite).toBeNull();
		expect(Object.values(result.evaluations)).toEqual([]);
	});

	test('unparseable lens output counts as failed, not as a neutral score', async () => {
		setLensBehaviour({
			technical: 'not json at all',
			culture: lensJson(70),
			experience: lensJson(90),
		});

		const result = await runMultiEvaluation(7, 11, 3, CONTEXT);

		const evalRows = insertsInto('interview_evaluations');
		expect(evalRows.map((p) => p[5]).sort()).toEqual(['culture', 'experience']);
		expect(result.composite.technical_score).toBeNull();
		// (70*0.3 + 90*0.3) / 0.6 = 80
		expect(result.composite.composite_score).toBe(80);
	});

	test('a genuine score of 0 is persisted and counted as 0, never replaced by 50', async () => {
		setLensBehaviour({
			technical: lensJson(0),
			culture: lensJson(90),
			experience: lensJson(90),
		});

		const result = await runMultiEvaluation(7, 11, 3, CONTEXT);

		const evalRows = insertsInto('interview_evaluations');
		expect(evalRows).toHaveLength(3);
		const techRow = evalRows.find((p) => p[5] === 'technical');
		expect(techRow[6]).toBe(0);
		// 0*0.4 + 90*0.3 + 90*0.3 = 54 (old `|| 50` code produced 74)
		expect(result.composite.composite_score).toBe(54);
	});

	test('full success regression: three rows, weighted composite, OmniScore fed', async () => {
		setLensBehaviour({
			technical: lensJson(80),
			culture: lensJson(70),
			experience: lensJson(90),
		});

		const result = await runMultiEvaluation(7, 11, 3, CONTEXT);

		expect(insertsInto('interview_evaluations')).toHaveLength(3);
		const compositeRows = insertsInto('interview_composite_scores');
		expect(compositeRows).toHaveLength(1);
		// 80*0.4 + 70*0.3 + 90*0.3 = 80
		expect(compositeRows[0][8]).toBe(80);
		expect(result.composite.composite_score).toBe(80);
		expect(mockAddInterviewComponent).toHaveBeenCalledWith(7, 'screening-42', 8);
	});
});
