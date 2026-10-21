/**
 * #1573 — routes/assessments.js generateQuestion last-resort fallbacks.
 *
 * Defect: when the question bank had no question for the requested
 * skill/difficulty AND the AI generation call failed, generateQuestion:
 *  (a) served ANY question from the bank regardless of skill/difficulty, or
 *  (b) INSERTed a boilerplate templated question
 *      ("Which of the following best describes a key concept in <skill>?",
 *      correct answer always option A) into assessment_questions and served
 *      it as a real skill question in a scored assessment.
 *
 * Honest behaviour (user journey — a candidate starting an assessment):
 * the candidate is told generation failed (explicit error, please retry)
 * and NO question is invented: nothing templated is persisted to the bank,
 * and no off-skill/off-difficulty question is served. Controls: a real
 * in-skill/in-difficulty bank question IS served, and a genuine AI-generated
 * question IS persisted and served.
 *
 * Drives the REAL POST /start route; only db / auth / AI / audit boundaries
 * are mocked (per existing assessments test patterns).
 * Regression pin only — NOT the HL-003 E2E-on-dev gate (Quinn's AFTER capture).
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

jest.mock('../../../lib/polsia-ai', () => ({
	chat: jest.fn(),
	handleAIError: jest.fn((res) => res.status(500).json({ error: 'AI unavailable' })),
	safeParseJSON: (text) => {
		try {
			return JSON.parse(text);
		} catch {
			return null;
		}
	},
}));

jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: { log: jest.fn(async () => ({})) },
}));

jest.mock('../../../services/omniscore', () => ({
	calculateScore: jest.fn(async () => ({})),
	addTechnicalComponent: jest.fn(async () => ({})),
}));

global.__testUsers = {
	7: { id: 7, role: 'candidate', company_id: null, name: 'Asha Candidate' },
};

const SKILL = { id: 3, user_id: 7, skill_name: 'JavaScript', category: 'technical' };

const IN_SKILL_Q = {
	id: 11,
	skill_category: 'JavaScript',
	difficulty_level: 2,
	question_type: 'multiple_choice',
	question_text: 'What does a closure capture?',
	options: '["a","b","c","d"]',
	correct_answer: 'a',
	explanation: 'A closure captures variables from its lexical scope.',
	time_limit_seconds: 90,
};

// A real bank question — but for a DIFFERENT skill at a DIFFERENT difficulty.
// Serving it for a JavaScript/difficulty-2 assessment would be fabrication
// by substitution: the candidate is scored on a question that does not test
// the skill they sat down to be assessed on.
const OFF_SKILL_Q = {
	id: 42,
	skill_category: 'Rust',
	difficulty_level: 5,
	question_type: 'multiple_choice',
	question_text: 'What does the borrow checker guarantee?',
	options: '["a","b","c","d"]',
	correct_answer: 'a',
	explanation: 'Memory safety without a garbage collector.',
	time_limit_seconds: 90,
};

let scenario = 'empty-bank-ai-down'; // see db mock branches
let questionInserts = [];
let anyBankFallbackQueries = 0;

const db = require('../../../lib/db');
db.query.mockImplementation(async (sql, params = []) => {
	const normalized = String(sql).toLowerCase().replace(/\s+/g, ' ');

	if (['begin', 'commit', 'rollback'].includes(normalized)) {
		return { rows: [], rowCount: 0 };
	}
	// Start flow — skill lookup by id.
	if (normalized.includes('from candidate_skills where id = $1')) {
		return { rows: [SKILL], rowCount: 1 };
	}
	// Start flow — retake lockout check.
	if (normalized.includes('from skill_assessments')) {
		return { rows: [], rowCount: 0 };
	}
	// Start flow — active session check.
	if (normalized.includes('from assessment_sessions')) {
		return { rows: [], rowCount: 0 };
	}
	// Start flow — create session.
	if (normalized.includes('insert into assessment_sessions')) {
		return {
			rows: [{ id: 900, user_id: 7, skill_id: 3, status: 'in_progress' }],
			rowCount: 1,
		};
	}
	// generateQuestion — genuine AI (or boilerplate) INSERT. Capture it.
	// Two shapes exist on current dev: the AI insert binds 8 params
	// (skill, difficulty, type, text, options, correct, explanation, time);
	// the boilerplate insert binds 6 (skill, difficulty, text, options,
	// correct, explanation) with type/time as SQL literals.
	if (normalized.includes('insert into assessment_questions')) {
		questionInserts.push(params);
		const row =
			params.length === 6
				? {
						id: 999,
						skill_category: params[0],
						difficulty_level: params[1],
						question_type: 'multiple_choice',
						question_text: params[2],
						options: params[3],
						correct_answer: params[4],
						explanation: params[5],
						time_limit_seconds: 90,
					}
				: {
						id: 999,
						skill_category: params[0],
						difficulty_level: params[1],
						question_type: params[2],
						question_text: params[3],
						options: params[4],
						correct_answer: params[5],
						explanation: params[6],
						time_limit_seconds: params[7],
					};
		return { rows: [row], rowCount: 1 };
	}
	// generateQuestion — in-skill / in-difficulty bank lookup (the honest path).
	if (
		normalized.includes('from assessment_questions') &&
		normalized.includes('lower(skill_category)')
	) {
		if (scenario === 'in-skill-bank-hit') {
			return { rows: [IN_SKILL_Q], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	}
	// generateQuestion — ANY-bank fallback (no skill/difficulty predicates).
	if (normalized.includes('from assessment_questions')) {
		anyBankFallbackQueries += 1;
		if (scenario === 'off-skill-bank-only') {
			return { rows: [OFF_SKILL_Q], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	}
	// Start flow — record question asked.
	if (normalized.includes('update assessment_sessions set questions_asked')) {
		return { rows: [], rowCount: 1 };
	}
	return { rows: [], rowCount: 0 };
});

const { chat } = require('../../../lib/polsia-ai');
const assessmentsRouter = require('../../../routes/assessments');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/assessments', assessmentsRouter);
	return app;
}

function startAssessment() {
	return request(buildApp())
		.post('/api/assessments/start')
		.set('x-test-user-id', '7')
		.send({ skillId: 3 });
}

beforeEach(() => {
	questionInserts = [];
	anyBankFallbackQueries = 0;
	chat.mockReset();
	jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('POST /start — question generation failure (#1573)', () => {
	it('bank empty + AI throws: candidate gets an honest error, NO boilerplate question is inserted or served', async () => {
		scenario = 'empty-bank-ai-down';
		chat.mockRejectedValue(new Error('provider down'));

		const res = await startAssessment();

		// The user sees an explicit failure — not a made-up question.
		expect(res.status).toBe(500);
		expect(res.body.error).toMatch(/failed to generate/i);
		expect(res.body.question).toBeUndefined();
		// Nothing was persisted to the shared question bank.
		expect(questionInserts).toHaveLength(0);
	});

	it('bank empty + AI reply unparseable: honest error, NO boilerplate insert', async () => {
		scenario = 'empty-bank-ai-down';
		chat.mockResolvedValue('Sorry, I cannot format that as JSON.');

		const res = await startAssessment();

		expect(res.status).toBe(500);
		expect(res.body.question).toBeUndefined();
		expect(questionInserts).toHaveLength(0);
	});

	it('only an OFF-skill/off-difficulty bank question exists + AI throws: it is NOT served and nothing is inserted', async () => {
		scenario = 'off-skill-bank-only';
		chat.mockRejectedValue(new Error('provider down'));

		const res = await startAssessment();

		expect(res.status).toBe(500);
		expect(res.body.error).toMatch(/failed to generate/i);
		expect(res.body.question).toBeUndefined();
		// The any-bank fallback must not even be consulted as a source of
		// substitute questions.
		expect(anyBankFallbackQueries).toBe(0);
		expect(questionInserts).toHaveLength(0);
	});
});

describe('POST /start — genuine questions still work (#1573 controls)', () => {
	it('real in-skill/in-difficulty bank question IS served, with no AI call and no insert', async () => {
		scenario = 'in-skill-bank-hit';
		chat.mockRejectedValue(new Error('chat must not be called on a bank hit'));

		const res = await startAssessment();

		expect(res.status).toBe(200);
		expect(res.body.question.id).toBe(IN_SKILL_Q.id);
		expect(res.body.question.text).toBe(IN_SKILL_Q.question_text);
		expect(chat).not.toHaveBeenCalled();
		expect(questionInserts).toHaveLength(0);
	});

	it('genuine AI-generated question IS persisted and served — the insert carries the AI content, never the boilerplate', async () => {
		scenario = 'empty-bank-ai-down';
		chat.mockResolvedValue(
			JSON.stringify({
				question_text: 'How does event delegation work in the DOM?',
				question_type: 'multiple_choice',
				options: ['A', 'B', 'C', 'D'],
				correct_answer: 'A',
				explanation: 'Events bubble up to a common ancestor.',
				time_limit_seconds: 90,
			}),
		);

		const res = await startAssessment();

		expect(res.status).toBe(200);
		expect(res.body.question.text).toBe('How does event delegation work in the DOM?');
		expect(questionInserts).toHaveLength(1);
		expect(questionInserts[0][3]).toBe('How does event delegation work in the DOM?');
		expect(questionInserts[0][3]).not.toMatch(/best describes a key concept/);
	});
});
