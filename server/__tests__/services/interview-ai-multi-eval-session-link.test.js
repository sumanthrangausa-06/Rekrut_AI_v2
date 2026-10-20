/**
 * #1504 — runMultiEvaluation must populate interview_evaluations.interview_session_id.
 *
 * On origin/dev @ 60c2de507 the writer's INSERT lists
 * (interview_id, screening_session_id, candidate_id, job_id, company_id,
 *  evaluator_type, score, max_score, breakdown, reasoning) and never sets
 * interview_session_id (migration 129, plain INTEGER -> interview_sessions.id).
 * The display subqueries in routes/interviews.js read
 * WHERE interview_session_id = s.id (s = interview_sessions), so writer rows
 * can never surface there.
 *
 * Contract (STOP 1 on #1504, discussed Rex + Lead):
 *  - context.interviewSessionId, when supplied, is persisted on every
 *    successful lens row;
 *  - when not supplied, the column is written as NULL (honest absence —
 *    e.g. the scheduled_interviews caller has no unified session by design).
 *
 * Mocking pattern mirrors interview-ai-multi-eval-honesty.test.js (#1505):
 * DB + AI provider mocked at the module boundary; the behaviour under test
 * is runMultiEvaluation's own persistence. HL-003 E2E is Quinn's gate (see
 * PR body — fresh-install success inserts are blocked by #1508).
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

const BASE_CONTEXT = {
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

function allLensesSucceed() {
	mockChat.mockImplementation((_prompt, opts) => {
		const type = String(opts.task).replace('multi-eval-', '');
		return Promise.resolve(lensJson({ technical: 80, culture: 70, experience: 60 }[type]));
	});
}

function evalInserts() {
	return mockQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO interview_evaluations'));
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

describe('runMultiEvaluation session link (#1504)', () => {
	test('persists context.interviewSessionId on every evaluation row', async () => {
		allLensesSucceed();

		await runMultiEvaluation(7, 11, 3, { ...BASE_CONTEXT, interviewSessionId: 900 });

		const inserts = evalInserts();
		expect(inserts).toHaveLength(3);
		for (const [sql, params] of inserts) {
			expect(sql).toMatch(/interview_session_id/);
			// interview_session_id is appended last (STOP 1: existing param
			// positions untouched), so it is the final param.
			expect(params[params.length - 1]).toBe(900);
		}
	});

	test('writes NULL interview_session_id when the caller has no unified session', async () => {
		allLensesSucceed();

		await runMultiEvaluation(7, 11, 3, BASE_CONTEXT);

		const inserts = evalInserts();
		expect(inserts).toHaveLength(3);
		for (const [sql, params] of inserts) {
			expect(sql).toMatch(/interview_session_id/);
			expect(params[params.length - 1]).toBeNull();
		}
	});
});
