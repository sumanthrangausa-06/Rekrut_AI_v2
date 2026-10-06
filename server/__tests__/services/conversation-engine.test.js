/**
 * Task 2 — conversation engine (issue #322).
 *
 * The engine wraps the two existing turn functions without duplicating them:
 *  - screening sessions  -> conductScreeningTurn (services/interview-ai)
 *  - ai_interview sessions -> conductInterviewTurn (lib/polsia-ai)
 * Both hit external AI providers, so they are mocked at the module boundary;
 * what these tests verify is the ENGINE's own logic: source selection,
 * branching, message composition, completion detection, and the scripted
 * fallback when the provider throws or times out.
 */

const { conductScreeningTurn } = require('../../../services/interview-ai');
const { conductInterviewTurn } = require('../../../lib/polsia-ai');

jest.mock('../../../services/interview-ai', () => ({
	conductScreeningTurn: jest.fn(),
}));

jest.mock('../../../lib/polsia-ai', () => ({
	conductInterviewTurn: jest.fn(),
}));

const {
	conductTurn,
	selectQuestionSource,
	FALLBACK_ACKS,
} = require('../../../services/conversation-engine');

const screeningSession = () => ({
	id: 1,
	type: 'screening',
	conversation: [
		{ role: 'candidate', text: 'I am a backend engineer with 5 years of experience.' },
	],
	config: {
		question_source: 'template',
		job: { title: 'Backend Engineer', description: 'Node.js APIs', company_name: 'Acme' },
		template: { topics: ['experience', 'logistics'], questions: [] },
		current_phase: 'experience',
	},
});

const aiInterviewSession = () => ({
	id: 2,
	type: 'ai_interview',
	conversation: [{ role: 'candidate', text: 'I scaled our pipeline to 1M events per day.' }],
	config: {
		question_source: 'personalized',
		target_role: 'Data Engineer',
		base_questions: [{ question_text: 'Describe the hardest data problem you solved.' }],
		current_question_index: 0,
		options: {},
	},
});

beforeEach(() => {
	conductScreeningTurn.mockReset();
	conductInterviewTurn.mockReset();
});

describe('selectQuestionSource', () => {
	test("returns 'template' for screening sessions", () => {
		expect(selectQuestionSource(screeningSession())).toBe('template');
	});

	test("returns 'personalized' for ai_interview sessions", () => {
		expect(selectQuestionSource(aiInterviewSession())).toBe('personalized');
	});

	test("defaults to 'template' when config is missing", () => {
		expect(selectQuestionSource({})).toBe('template');
		expect(selectQuestionSource(null)).toBe('template');
	});
});

describe('conductTurn — screening (template source)', () => {
	test('returns the template-driven next question', async () => {
		conductScreeningTurn.mockResolvedValue({
			reaction: 'Solid backend background.',
			action: 'transition',
			question: 'What is your notice period?',
			phase: 'logistics',
			notes: '',
		});

		const result = await conductTurn(screeningSession(), 'Five years, mostly Node.', []);

		expect(conductScreeningTurn).toHaveBeenCalledTimes(1);
		expect(conductInterviewTurn).not.toHaveBeenCalled();
		expect(result.ai_message).toContain('What is your notice period?');
		expect(result.phase).toBe('logistics');
		expect(result.is_complete).toBe(false);
	});

	test('marks the turn complete on wrap_up', async () => {
		conductScreeningTurn.mockResolvedValue({
			reaction: 'Thanks for your time.',
			action: 'wrap_up',
			question: 'We will be in touch soon.',
			phase: 'close',
			notes: '',
		});

		const result = await conductTurn(screeningSession(), 'No more questions.', []);

		expect(result.is_complete).toBe(true);
		expect(result.phase).toBe('close');
	});
});

describe('conductTurn — ai_interview (personalized source)', () => {
	test('returns the JD+resume-grounded follow-up question', async () => {
		conductInterviewTurn.mockResolvedValue({
			reaction: 'That 1M events/day figure is impressive.',
			action: 'follow_up',
			question:
				'What was the bottleneck before you scaled it, and how did you measure the improvement?',
			score_hint: 8,
			notes: 'Strong depth signal',
		});

		const result = await conductTurn(
			aiInterviewSession(),
			'I scaled our pipeline to 1M events per day.',
			[],
		);

		expect(conductInterviewTurn).toHaveBeenCalledTimes(1);
		expect(conductScreeningTurn).not.toHaveBeenCalled();
		// Personalized: the question must probe the candidate's actual experience.
		expect(result.ai_message).toContain('bottleneck');
		expect(result.is_complete).toBe(false);
	});

	test('passes the frozen JD + resume snapshot through to the interview turn', async () => {
		conductInterviewTurn.mockResolvedValue({
			reaction: 'Noted.',
			action: 'follow_up',
			question: 'Tell me more about the Spark work.',
			score_hint: 5,
			notes: '',
		});

		const session = aiInterviewSession();
		session.config.resume = { text: 'Jane Doe: 5 years building Spark pipelines.' };
		session.config.job = { description: 'We need a Spark expert for real-time ingestion.' };

		await conductTurn(session, 'I built Spark pipelines.', []);

		expect(conductInterviewTurn).toHaveBeenCalledTimes(1);
		const options = conductInterviewTurn.mock.calls[0][4];
		expect(options.resumeText).toBe('Jane Doe: 5 years building Spark pipelines.');
		expect(options.jobDescription).toBe('We need a Spark expert for real-time ingestion.');
	});
});

describe('conductTurn — generic reaction override', () => {
	test('replaces generic LLM reactions with natural acknowledgments', async () => {
		conductInterviewTurn.mockResolvedValue({
			reaction: 'Thank you for your response.',
			action: 'follow_up',
			question: 'What was the hardest bug you fixed?',
			score_hint: 7,
			notes: '',
		});

		const result = await conductTurn(aiInterviewSession(), 'I fixed a race condition.', []);

		// Restored bug fix: generic reactions are replaced, the question is kept.
		expect(result.ai_message).not.toContain('Thank you for your response.');
		expect(result.ai_message).toContain('What was the hardest bug you fixed?');
		// 2 candidate turns in history → NATURAL_AI_ACKS[2 % 4]
		expect(result.ai_message).toContain(
			"That's a thoughtful response. Let me explore another angle.",
		);
	});

	test('keeps specific, non-generic reactions untouched', async () => {
		conductInterviewTurn.mockResolvedValue({
			reaction: 'That 1M events/day figure is impressive.',
			action: 'follow_up',
			question: 'How did you measure the improvement?',
			score_hint: 8,
			notes: '',
		});

		const result = await conductTurn(aiInterviewSession(), 'I scaled our pipeline.', []);

		expect(result.ai_message).toContain('That 1M events/day figure is impressive.');
		expect(result.ai_message).toContain('How did you measure the improvement?');
	});
});

describe('conductTurn — provider failure', () => {
	test('on LLM throw returns the scripted fallback shape', async () => {
		conductScreeningTurn.mockRejectedValue(new Error('provider 429'));

		const result = await conductTurn(screeningSession(), 'Five years, mostly Node.', []);

		// Exact contract the endpoints rely on: never leave the candidate hanging.
		expect(result).toEqual({
			ai_message: expect.any(String),
			phase: expect.any(String),
			is_complete: false,
		});
		expect(result.ai_message.length).toBeGreaterThan(0);
		expect(FALLBACK_ACKS.some((ack) => result.ai_message.includes(ack))).toBe(true);
	});

	test('fallback keeps the session phase and never completes the session', async () => {
		conductInterviewTurn.mockRejectedValue(new Error('timed out after 20000ms'));

		const result = await conductTurn(aiInterviewSession(), 'Hello?', []);

		expect(result.is_complete).toBe(false);
		expect(result.phase).toBe('interview');
	});
});
