/**
 * #1572 — routes/assessments.js evaluateShortAnswer failure fallback.
 *
 * Defect: when AI evaluation of a short answer fails (chat throws or the
 * reply cannot be parsed), evaluateShortAnswer returned { score: 50 }.
 * The POST /answer flow credited that fabricated 50 into the session
 * total and wrote an AuditLogger entry `ai_explanation_generated` with
 * ai_score: 50 and confidence: 0.5 — a fabricated score AND fabricated
 * confidence in the compliance audit trail.
 *
 * Honest behaviour: on evaluation failure the answer is recorded as
 * UNEVALUATED — score null, 0 points, session total and adaptive
 * difficulty unchanged, NO ai_explanation_generated entry (an explicit
 * assessment_evaluation_failed event instead), and the candidate sees
 * "Pending manual review", never "Incorrect". A genuine evaluated 0
 * stays 0.
 *
 * Drives the REAL POST /answer route; only db / auth / AI / audit
 * boundaries are mocked (per existing assessments test patterns).
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

const SESSION = {
	id: 900,
	user_id: 7,
	status: 'in_progress',
	skill_id: 3,
	score: 40,
	// #1807: the answered question (id 5) must be the session's OUTSTANDING
	// question or the #1620 integrity guard correctly rejects the answer
	// with 400 QUESTION_NOT_CURRENT. Modelled in the exact shape
	// serveNextQuestion pushes: { questionId, difficulty, timestamp }.
	questions_asked: [{ questionId: 5, difficulty: 2, timestamp: new Date() }],
	answers_given: [],
	current_question_index: 0,
	current_difficulty: 2,
	max_difficulty_reached: 2,
	time_anomalies: 0,
	tab_switches: 0,
	copy_paste_attempts: 0,
	started_at: new Date(),
};

const SHORT_ANSWER_Q = {
	id: 5,
	question_type: 'short_answer',
	question_text: 'Explain closures in JavaScript.',
	explanation: 'A closure captures variables from its lexical scope.',
	correct_answer: null,
	difficulty_level: 2,
	time_limit_seconds: 180,
};

const NEXT_Q = {
	id: 6,
	question_type: 'multiple_choice',
	question_text: 'What is a promise?',
	options: '["a","b"]',
	correct_answer: 'a',
	difficulty_level: 2,
	time_limit_seconds: 120,
};

let sessionUpdates = [];
// #1807: the recorded answers are carried forward so the post-record
// read-back (respondAfterRecord) sees the state the UPDATE wrote — the
// pattern the #1627 graded-confidence restore established.
let storedAnswers = [];

const db = require('../../../lib/db');
db.query.mockImplementation(async (sql, params = []) => {
	const normalized = String(sql).toLowerCase().replace(/\s+/g, ' ');

	if (['begin', 'commit', 'rollback'].includes(normalized)) {
		return { rows: [], rowCount: 0 };
	}
	// Answer flow — session load (initial load + locked FOR UPDATE re-read;
	// both are keyed by id + user_id).
	if (normalized.includes('from assessment_sessions') && normalized.includes('user_id = $2')) {
		return {
			rows: [{ ...SESSION, answers_given: [...storedAnswers] }],
			rowCount: 1,
		};
	}
	// Post-record read-back — respondAfterRecord loads by id only.
	if (
		normalized.includes('from assessment_sessions') &&
		normalized.includes('where id = $1') &&
		!normalized.includes('user_id')
	) {
		return {
			rows: [{ ...SESSION, answers_given: [...storedAnswers] }],
			rowCount: 1,
		};
	}
	// Answer flow — the answered question.
	if (
		normalized.includes('from assessment_questions') &&
		normalized.includes('where id = $1') &&
		!normalized.includes('lower(skill_category)')
	) {
		return { rows: [SHORT_ANSWER_Q], rowCount: 1 };
	}
	// Session write — capture [answersGiven, newScore, idx, difficulty, maxDiff, anomalies, sessionId].
	if (normalized.includes('update assessment_sessions set answers_given')) {
		sessionUpdates.push(params);
		storedAnswers = JSON.parse(params[0]);
		return { rows: [], rowCount: 1 };
	}
	// Next-question skill lookup.
	if (normalized.includes('from candidate_skills cs join assessment_sessions')) {
		return { rows: [{ id: 3, skill_name: 'JavaScript', category: 'technical' }], rowCount: 1 };
	}
	// generateQuestion — bank hit, no AI needed.
	if (normalized.includes('from assessment_questions') && normalized.includes('lower(skill_category)')) {
		return { rows: [NEXT_Q], rowCount: 1 };
	}
	if (normalized.includes('update assessment_sessions set questions_asked')) {
		return { rows: [], rowCount: 1 };
	}
	return { rows: [], rowCount: 0 };
});

const { chat } = require('../../../lib/polsia-ai');
const { AuditLogger } = require('../../../services/auditLogService');
const assessmentsRouter = require('../../../routes/assessments');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/assessments', assessmentsRouter);
	return app;
}

function submitAnswer() {
	return request(buildApp())
		.post('/api/assessments/answer')
		.set('x-test-user-id', '7')
		.send({ sessionId: 900, questionId: 5, answer: 'A closure captures outer variables.', timeTaken: 60 });
}

function lastAnswerEntry() {
	expect(sessionUpdates).toHaveLength(1);
	const answers = JSON.parse(sessionUpdates[0][0]);
	expect(answers).toHaveLength(1);
	return answers[0];
}

beforeEach(() => {
	sessionUpdates = [];
	storedAnswers = [];
	chat.mockReset();
	AuditLogger.log.mockClear();
	jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('POST /answer — short-answer evaluation failure (#1572)', () => {
	it('chat throws: answer recorded UNEVALUATED — null score, 0 points, total + difficulty unchanged, no fabricated audit entry', async () => {
		chat.mockRejectedValue(new Error('provider down'));

		const res = await submitAnswer();
		expect(res.status).toBe(200);
		expect(res.body.completed).toBe(false);
		// Candidate is told the truth — pending review, not "Incorrect".
		expect(res.body.feedback).toBe('Pending manual review');
		expect(res.body.aiFeedback).toMatch(/manual review/i);

		const entry = lastAnswerEntry();
		expect(entry.score).toBeNull();
		expect(entry.evaluationStatus).toBe('pending_manual_review');
		expect(entry.isCorrect).toBeNull();
		expect(entry.scorePoints).toBe(0);
		// Session total unchanged (was 40) and difficulty NOT dropped (was 2).
		expect(sessionUpdates[0][1]).toBe(40);
		expect(sessionUpdates[0][3]).toBe(2);

		// No fabricated AI score/confidence in the compliance audit trail.
		const generated = AuditLogger.log.mock.calls.filter(
			([arg]) => arg.actionType === 'ai_explanation_generated',
		);
		expect(generated).toHaveLength(0);
		// The failure itself is auditable — explicitly, without an ai_score.
		const failed = AuditLogger.log.mock.calls.filter(
			([arg]) => arg.actionType === 'assessment_evaluation_failed',
		);
		expect(failed).toHaveLength(1);
		expect(failed[0][0].metadata).not.toHaveProperty('ai_score');
		expect(failed[0][0].metadata).not.toHaveProperty('confidence');
	});

	it('unparseable AI reply: same unevaluated outcome (no score minted from garbage)', async () => {
		chat.mockResolvedValue('Sorry, I cannot format that as JSON.');

		const res = await submitAnswer();
		expect(res.status).toBe(200);
		expect(res.body.feedback).toBe('Pending manual review');

		const entry = lastAnswerEntry();
		expect(entry.score).toBeNull();
		expect(entry.scorePoints).toBe(0);
		expect(sessionUpdates[0][1]).toBe(40);

		const generated = AuditLogger.log.mock.calls.filter(
			([arg]) => arg.actionType === 'ai_explanation_generated',
		);
		expect(generated).toHaveLength(0);
	});

	it('AI reply with no numeric score: treated as unevaluated, not NaN points', async () => {
		chat.mockResolvedValue(JSON.stringify({ feedback: 'Looks fine.' }));

		const res = await submitAnswer();
		expect(res.status).toBe(200);
		const entry = lastAnswerEntry();
		expect(entry.score).toBeNull();
		expect(entry.scorePoints).toBe(0);
		expect(sessionUpdates[0][1]).toBe(40);
	});

	it('out-of-range score 150: rejected as unevaluated — never credited, never audit-logged with confidence 1.5', async () => {
		chat.mockResolvedValue(JSON.stringify({ score: 150, feedback: 'Amazing!' }));

		const res = await submitAnswer();
		expect(res.status).toBe(200);
		const entry = lastAnswerEntry();
		expect(entry.score).toBeNull();
		expect(entry.evaluationStatus).toBe('pending_manual_review');
		expect(entry.scorePoints).toBe(0);
		expect(sessionUpdates[0][1]).toBe(40);
		const generated = AuditLogger.log.mock.calls.filter(
			([arg]) => arg.actionType === 'ai_explanation_generated',
		);
		expect(generated).toHaveLength(0);
	});

	it('negative score -20: rejected as unevaluated — session total must not decrease', async () => {
		chat.mockResolvedValue(JSON.stringify({ score: -20, feedback: 'Bad.' }));

		const res = await submitAnswer();
		expect(res.status).toBe(200);
		const entry = lastAnswerEntry();
		expect(entry.score).toBeNull();
		expect(entry.scorePoints).toBe(0);
		expect(sessionUpdates[0][1]).toBe(40);
	});

	it('string score "80": rejected as unevaluated — only a real numeric score counts', async () => {
		chat.mockResolvedValue(JSON.stringify({ score: '80', feedback: 'Good.' }));

		const res = await submitAnswer();
		expect(res.status).toBe(200);
		const entry = lastAnswerEntry();
		expect(entry.score).toBeNull();
		expect(entry.scorePoints).toBe(0);
		expect(sessionUpdates[0][1]).toBe(40);
	});
});

describe('POST /answer — genuine evaluations still score normally (#1572 controls)', () => {
	it('real score 80: credited, marked correct, difficulty rises, audit entry carries the real score', async () => {
		chat.mockResolvedValue(JSON.stringify({ score: 80, feedback: 'Good, complete answer.' }));

		const res = await submitAnswer();
		expect(res.status).toBe(200);
		expect(res.body.feedback).toBe('Correct!');

		const entry = lastAnswerEntry();
		expect(entry.score).toBe(80);
		expect(entry.evaluationStatus).toBe('evaluated');
		expect(entry.isCorrect).toBe(true);
		// round(80/100 * 2 * 15) = 24 points on top of the existing 40.
		expect(entry.scorePoints).toBe(24);
		expect(sessionUpdates[0][1]).toBe(64);
		expect(sessionUpdates[0][3]).toBe(3);

		const generated = AuditLogger.log.mock.calls.filter(
			([arg]) => arg.actionType === 'ai_explanation_generated',
		);
		expect(generated).toHaveLength(1);
		expect(generated[0][0].metadata.ai_score).toBe(80);
		expect(generated[0][0].metadata.confidence).toBe(0.8);
	});

	it('genuine evaluated 0 stays 0 — a real zero is not rewritten as unevaluated', async () => {
		chat.mockResolvedValue(JSON.stringify({ score: 0, feedback: 'Misses the concept entirely.' }));

		const res = await submitAnswer();
		expect(res.status).toBe(200);
		expect(res.body.feedback).toBe('Incorrect');

		const entry = lastAnswerEntry();
		expect(entry.score).toBe(0);
		expect(entry.evaluationStatus).toBe('evaluated');
		expect(entry.isCorrect).toBe(false);
		expect(entry.scorePoints).toBe(0);
		expect(sessionUpdates[0][1]).toBe(40);

		const generated = AuditLogger.log.mock.calls.filter(
			([arg]) => arg.actionType === 'ai_explanation_generated',
		);
		expect(generated).toHaveLength(1);
		expect(generated[0][0].metadata.ai_score).toBe(0);
	});
});
