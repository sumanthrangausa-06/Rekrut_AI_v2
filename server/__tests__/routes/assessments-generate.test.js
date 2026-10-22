/**
 * Issue #348 — "POST /api/assessments/generate returns 500".
 *
 * The generate endpoint called chat() without response_format JSON mode,
 * with a tight 4096 token budget for 15 questions, and a prompt containing
 * invalid JSON ("or null"). Reasoning-model providers emit chain-of-thought
 * that corrupts the greedy JSON extraction in safeParseJSON, producing
 * unparseable output → 500.
 *
 * These tests pin the fixes:
 *  - chat() is called with response_format: { type: 'json_object' }
 *  - chat() is called with maxTokens: 8000
 *  - valid JSON → 200, assessment created
 *  - JSON wrapped in markdown fences → 200 (safeParseJSON handles)
 *  - garbage output → 500 (parse failure path)
 */
const express = require('express');
const request = require('supertest');

jest.mock('../../../lib/auth', () => {
	const actual = jest.requireActual('../../../lib/auth');
	const authMiddleware = jest.fn((req, res, next) => {
		if (req.headers['x-test-user-id']) {
			const userId = parseInt(req.headers['x-test-user-id'], 10);
			const user = global.__testUsers?.[userId];
			if (user) {
				req.user = user;
				return next();
			}
		}
		return res.status(401).json({ error: 'Unauthorized' });
	});
	return { ...actual, authMiddleware };
});

// Capture chat() calls so we can assert on the options passed.
// Prefixed with `mock` per jest.mock() factory scoping rules.
let mockChatCalls = [];
let mockChatScenario = 'valid'; // 'valid' | 'fenced' | 'garbage'

// #1655 (C2b): when set, chat() returns exactly this many questions.
let mockGeneratedCount = null;
function mockMakeQuestions(n) {
	return Array.from({ length: n }, (_, i) => ({
		category: 'technical',
		question_type: 'multiple_choice',
		question_text: `Question ${i + 1}?`,
		options: ['A', 'B', 'C', 'D'],
		correct_answer: 'A',
		rubric: null,
		explanation: 'Because.',
		difficulty_level: 2,
		points: 10,
		time_limit_seconds: 120,
	}));
}

// #1655: DB-call capture so tests can assert on INSERT params (difficulty,
// question_count, ai_config) and prove invalid input writes/calls nothing.
let mockDbCalls = [];
let mockAssessmentInserts = [];
let mockQuestionInserts = [];

const MOCK_VALID_JSON = JSON.stringify({
	title: 'QA Engineer Assessment',
	description: 'Test assessment',
	questions: [
		{
			category: 'technical',
			question_type: 'multiple_choice',
			question_text: 'What is Cypress?',
			options: ['A', 'B', 'C', 'D'],
			correct_answer: 'A',
			rubric: null,
			explanation: 'Because.',
			difficulty_level: 2,
			points: 10,
			time_limit_seconds: 120,
		},
	],
});

jest.mock('../../../lib/polsia-ai', () => ({
	chat: jest.fn(async (_prompt, _options) => {
		mockChatCalls.push({ prompt: _prompt, options: _options });
		if (mockChatScenario === 'garbage') return 'this is not json at all {{{';
		// biome-ignore lint/style/useTemplate: test fixture readability
		if (mockChatScenario === 'fenced') return '```json\n' + MOCK_VALID_JSON + '\n```';
		return MOCK_VALID_JSON;
	}),
	handleAIError: jest.fn(),
	safeParseJSON: jest.requireActual('../../../lib/polsia-ai').safeParseJSON,
}));

global.__testUsers = {
	2: { id: 2, role: 'recruiter', company_id: 5, name: 'Rita Recruiter' },
};

const db = require('../../../lib/db');
// Note: server/test/setup.js already mocks lib/db with query + connect.
// We override query per-test via mockImplementation below.
db.query.mockImplementation(async (sql, params) => {
	const normalized = String(sql).toLowerCase().replace(/\s+/g, ' ');
	mockDbCalls.push({ sql: normalized, params });

	if (['begin', 'commit', 'rollback'].includes(normalized)) {
		return { rows: [], rowCount: 0 };
	}

	// Job lookup
	if (normalized.includes('from jobs where id = $1')) {
		return {
			rows: [
				{
					id: 191,
					title: 'QA Engineer',
					description: 'Test automation',
					requirements: 'Cypress',
					company: 'TestCo',
					job_type: 'full-time',
				},
			],
			rowCount: 1,
		};
	}

	// Existing assessment check
	if (normalized.includes('from job_assessments where job_id')) {
		return { rows: [], rowCount: 0 };
	}

	// INSERT INTO job_assessments ... RETURNING *
	if (normalized.includes('insert into job_assessments')) {
		mockAssessmentInserts.push(params);
		return {
			rows: [
				{
					id: 55,
					job_id: params[0],
					title: params[2],
					difficulty_level: params[4],
					question_count: params[5],
					ai_config: params[7],
				},
			],
			rowCount: 1,
		};
	}

	// INSERT INTO job_assessment_questions (one per generated question)
	if (normalized.includes('insert into job_assessment_questions')) {
		mockQuestionInserts.push(params);
		return { rows: [], rowCount: 1 };
	}

	return { rows: [], rowCount: 0 };
});

const assessmentsRouter = require('../../../routes/assessments');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/assessments', assessmentsRouter);
	return app;
}

beforeEach(() => {
	mockChatCalls = [];
	mockChatScenario = 'valid';
	mockGeneratedCount = null;
	mockDbCalls = [];
	mockAssessmentInserts = [];
	mockQuestionInserts = [];
	// Re-register the chat mock implementation (do NOT use clearAllMocks —
	// it would wipe the db.query mockImplementation set at module level).
	const polsia = require('../../../lib/polsia-ai');
	polsia.chat.mockImplementation(async (_prompt, _options) => {
		mockChatCalls.push({ prompt: _prompt, options: _options });
		if (mockChatScenario === 'garbage') return 'this is not json at all {{{';
		if (mockGeneratedCount !== null) {
			return JSON.stringify({
				title: 'QA Engineer Assessment',
				description: 'Test assessment',
				questions: mockMakeQuestions(mockGeneratedCount),
			});
		}
		// biome-ignore lint/style/useTemplate: test fixture readability
		if (mockChatScenario === 'fenced') return '```json\n' + MOCK_VALID_JSON + '\n```';
		return MOCK_VALID_JSON;
	});
});

describe('POST /api/assessments/generate (#348)', () => {
	it('passes response_format JSON mode to chat()', async () => {
		const app = makeApp();
		await request(app)
			.post('/api/assessments/generate')
			.set('x-test-user-id', '2')
			.send({ jobId: 191 });

		expect(mockChatCalls.length).toBe(1);
		expect(mockChatCalls[0].options.response_format).toEqual({ type: 'json_object' });
	});

	it('requests a sufficient token budget (maxTokens 8000)', async () => {
		const app = makeApp();
		await request(app)
			.post('/api/assessments/generate')
			.set('x-test-user-id', '2')
			.send({ jobId: 191 });

		expect(mockChatCalls.length).toBe(1);
		expect(mockChatCalls[0].options.maxTokens).toBe(8000);
	});

	it('succeeds with valid JSON response', async () => {
		mockChatScenario = 'valid';
		const app = makeApp();
		const res = await request(app)
			.post('/api/assessments/generate')
			.set('x-test-user-id', '2')
			.send({ jobId: 191 });

		expect(res.status).toBe(200);
	});

	it('succeeds with JSON wrapped in markdown fences', async () => {
		mockChatScenario = 'fenced';
		const app = makeApp();
		const res = await request(app)
			.post('/api/assessments/generate')
			.set('x-test-user-id', '2')
			.send({ jobId: 191 });

		expect(res.status).toBe(200);
	});

	it('returns 500 when AI output is unparseable garbage', async () => {
		mockChatScenario = 'garbage';
		const app = makeApp();
		const res = await request(app)
			.post('/api/assessments/generate')
			.set('x-test-user-id', '2')
			.send({ jobId: 191 });

		expect(res.status).toBe(500);
		expect(res.body.error).toMatch(/failed to generate/i);
	});
});

// ─── #1655 (C2b, EPIC #1603): optional generation configuration ─────────────
// Rulings R1–R6 (STOP 1 on #1655). Absent fields must be byte-identical to
// the pre-#1655 behaviour; provided fields parameterise prompt/storage.
const EXPECTED_DEFAULT_PROMPT = `You are an expert hiring manager. Generate a comprehensive skill assessment for this job posting.

JOB TITLE: QA Engineer
COMPANY: TestCo
DESCRIPTION: Test automation
REQUIREMENTS: Cypress
JOB TYPE: full-time
LEVEL: mid

Generate exactly 15 assessment questions across these categories:
- "technical" (6 questions): Test specific technical skills mentioned in requirements
- "scenario" (4 questions): Real-world work scenarios relevant to the role
- "behavioral" (3 questions): Soft skills, teamwork, communication, problem-solving
- "code_challenge" (2 questions): Practical coding/analytical problems (if technical role) OR additional scenario questions (if non-technical)

For each question, include:
- question_type: "multiple_choice", "free_text", "scenario_response", or "code_challenge"
- difficulty_level: 2-3 (1=beginner, 5=expert)
- points: 5-20 based on difficulty and importance

Rules:
- Make questions SPECIFIC to this exact role, not generic
- Multiple choice: exactly 4 options, one correct
- Free text / scenario: provide a rubric for what a good answer includes
- Code challenges: provide a clear problem with expected approach
- Vary difficulty within the range

Return ONLY valid JSON:
{
  "title": "Assessment title",
  "description": "Brief assessment description",
  "questions": [
    {
      "category": "technical|scenario|behavioral|code_challenge",
      "question_type": "multiple_choice|free_text|scenario_response|code_challenge",
      "question_text": "The question",
      "options": ["A", "B", "C", "D"],
      "correct_answer": "A",
      "rubric": "What makes a good answer (for free text/scenario)",
      "explanation": "Why the correct answer is right",
      "difficulty_level": 1-5,
      "points": 5-20,
      "time_limit_seconds": 60-300
    }
  ]
}`;

describe('POST /api/assessments/generate — optional config (#1655 C2b)', () => {
	// (a) REGRESSION PIN: passes before AND after the fix by design — it pins
	// the byte-identical default (prompt string, response shape, ai_config).
	it('(a) absent fields → byte-identical prompt, unchanged response shape and ai_config', async () => {
		const app = makeApp();
		const res = await request(app)
			.post('/api/assessments/generate')
			.set('x-test-user-id', '2')
			.send({ jobId: 191 });

		expect(res.status).toBe(200);
		expect(mockChatCalls.length).toBe(1);
		expect(mockChatCalls[0].prompt).toBe(EXPECTED_DEFAULT_PROMPT);
		expect(Object.keys(res.body)).toEqual(['assessment']);
		expect(mockAssessmentInserts.length).toBe(1);
		expect(mockAssessmentInserts[0][4]).toBe('medium');
		expect(mockAssessmentInserts[0][5]).toBe(1);
		const aiConfig = JSON.parse(mockAssessmentInserts[0][7]);
		expect(Object.keys(aiConfig).sort()).toEqual([
			'difficultyLevel',
			'generated_at',
			'targetLevel',
		]);
		expect(aiConfig.targetLevel).toBe('mid');
		expect(aiConfig.difficultyLevel).toBe('medium');
	});

	it('(b) questionCount=25 with 25 returned → prompt/counts/response all 25', async () => {
		mockGeneratedCount = 25;
		const app = makeApp();
		const res = await request(app)
			.post('/api/assessments/generate')
			.set('x-test-user-id', '2')
			.send({ jobId: 191, questionCount: 25 });

		expect(res.status).toBe(200);
		expect(mockChatCalls[0].prompt).toContain('Generate exactly 25 assessment questions');
		expect(mockChatCalls[0].prompt).toContain('"technical" (10 questions)');
		expect(mockChatCalls[0].prompt).toContain('"scenario" (7 questions)');
		expect(mockChatCalls[0].prompt).toContain('"behavioral" (5 questions)');
		expect(mockChatCalls[0].prompt).toContain('"code_challenge" (3 questions)');
		expect(mockAssessmentInserts[0][5]).toBe(25);
		expect(mockQuestionInserts.length).toBe(25);
		expect(res.body.requestedCount).toBe(25);
		expect(res.body.storedCount).toBe(25);
		const aiConfig = JSON.parse(mockAssessmentInserts[0][7]);
		expect(aiConfig.requestedCount).toBe(25);
		expect(aiConfig.format).toBeUndefined();
		expect(aiConfig.difficultyBand).toBeUndefined();
	});

	it('(c) provider returns fewer than requested → question_count is the actual count', async () => {
		mockGeneratedCount = 3;
		const app = makeApp();
		const res = await request(app)
			.post('/api/assessments/generate')
			.set('x-test-user-id', '2')
			.send({ jobId: 191, questionCount: 10 });

		expect(res.status).toBe(200);
		expect(mockChatCalls[0].prompt).toContain('Generate exactly 10 assessment questions');
		expect(mockAssessmentInserts[0][5]).toBe(3);
		expect(mockQuestionInserts.length).toBe(3);
		expect(res.body.requestedCount).toBe(10);
		expect(res.body.storedCount).toBe(3);
	});

	it('(d) difficultyBand=hard → stored hard and prompt range 4-5', async () => {
		const app = makeApp();
		const res = await request(app)
			.post('/api/assessments/generate')
			.set('x-test-user-id', '2')
			.send({ jobId: 191, difficultyBand: 'hard' });

		expect(res.status).toBe(200);
		expect(mockAssessmentInserts[0][4]).toBe('hard');
		expect(mockChatCalls[0].prompt).toContain('difficulty_level: 4-5');
		expect(res.body.requestedCount).toBeUndefined();
		expect(res.body.storedCount).toBeUndefined();
		const aiConfig = JSON.parse(mockAssessmentInserts[0][7]);
		expect(aiConfig.difficultyBand).toBe('hard');
		expect(aiConfig.difficultyLevel).toBe('hard');
		expect(aiConfig.targetLevel).toBe('mid');
	});

	it('(e) format=free_text → prompt steers every question and ai_config records format', async () => {
		const app = makeApp();
		const res = await request(app)
			.post('/api/assessments/generate')
			.set('x-test-user-id', '2')
			.send({ jobId: 191, format: 'free_text' });

		expect(res.status).toBe(200);
		expect(mockChatCalls[0].prompt).toMatch(/every question must use question_type "free_text"/i);
		const aiConfig = JSON.parse(mockAssessmentInserts[0][7]);
		expect(aiConfig.format).toBe('free_text');
	});

	it('(e2) format=mixed → no single-type steering, prompt identical to default, format recorded', async () => {
		const app = makeApp();
		const res = await request(app)
			.post('/api/assessments/generate')
			.set('x-test-user-id', '2')
			.send({ jobId: 191, format: 'mixed' });

		expect(res.status).toBe(200);
		expect(mockChatCalls[0].prompt).toBe(EXPECTED_DEFAULT_PROMPT);
		const aiConfig = JSON.parse(mockAssessmentInserts[0][7]);
		expect(aiConfig.format).toBe('mixed');
	});

	it('(g) combined config (count + band + format in ONE request) → all three honoured together', async () => {
		mockGeneratedCount = 25;
		const app = makeApp();
		const res = await request(app)
			.post('/api/assessments/generate')
			.set('x-test-user-id', '2')
			.send({ jobId: 191, questionCount: 25, difficultyBand: 'hard', format: 'free_text' });

		expect(res.status).toBe(200);
		const prompt = mockChatCalls[0].prompt;
		expect(prompt).toContain('Generate exactly 25 assessment questions');
		expect(prompt).toContain('difficulty_level: 4-5');
		expect(prompt).toMatch(/every question must use question_type "free_text"/i);
		expect(mockAssessmentInserts[0][4]).toBe('hard');
		expect(mockAssessmentInserts[0][5]).toBe(25);
		expect(mockQuestionInserts.length).toBe(25);
		expect(res.body.requestedCount).toBe(25);
		expect(res.body.storedCount).toBe(25);
		const aiConfig = JSON.parse(mockAssessmentInserts[0][7]);
		expect(aiConfig.format).toBe('free_text');
		expect(aiConfig.requestedCount).toBe(25);
		expect(aiConfig.difficultyBand).toBe('hard');
	});

	it('(f) invalid questionCount/difficultyBand/format → 400 with no job lookup, no chat call, no insert', async () => {
		const app = makeApp();
		const invalidBodies = [
			{ jobId: 191, questionCount: 0 },
			{ jobId: 191, questionCount: -3 },
			{ jobId: 191, questionCount: 51 },
			{ jobId: 191, questionCount: 2.5 },
			{ jobId: 191, questionCount: '25' },
			{ jobId: 191, difficultyBand: 'mid' },
			{ jobId: 191, difficultyBand: 'extreme' },
			{ jobId: 191, format: 'essay' },
		];
		for (const body of invalidBodies) {
			mockChatCalls = [];
			mockDbCalls = [];
			mockAssessmentInserts = [];
			mockQuestionInserts = [];
			const res = await request(app)
				.post('/api/assessments/generate')
				.set('x-test-user-id', '2')
				.send(body);
			expect(res.status).toBe(400);
			expect(mockDbCalls.length).toBe(0);
			expect(mockChatCalls.length).toBe(0);
			expect(mockAssessmentInserts.length).toBe(0);
			expect(mockQuestionInserts.length).toBe(0);
		}
	});
});
