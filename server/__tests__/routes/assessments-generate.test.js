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
db.query.mockImplementation(async (sql) => {
	const normalized = String(sql).toLowerCase().replace(/\s+/g, ' ');

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
		return {
			rows: [{ id: 55, job_id: 191, title: 'QA Engineer Assessment', question_count: 1 }],
			rowCount: 1,
		};
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
	// Re-register the chat mock implementation (do NOT use clearAllMocks —
	// it would wipe the db.query mockImplementation set at module level).
	const polsia = require('../../../lib/polsia-ai');
	polsia.chat.mockImplementation(async (_prompt, _options) => {
		mockChatCalls.push({ prompt: _prompt, options: _options });
		if (mockChatScenario === 'garbage') return 'this is not json at all {{{';
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
