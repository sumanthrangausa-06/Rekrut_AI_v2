/**
 * #1584 item 2 — routes/assessments.js completeAssessment audit entry.
 *
 * Defect: the `assessment_graded` AuditLogger entry carries a hard-coded
 * confidence (`passed ? 0.85 : 0.6`) — a fabricated confidence in the
 * compliance audit trail, same class as #1572/#1505. No confidence was
 * ever measured for the grading; the honest entry omits the field
 * entirely (the #1572 pattern in the same file: no ai_score/confidence
 * when none was recorded).
 *
 * Drives the REAL POST /answer route through the 10th answer so the real
 * completeAssessment runs; only db / auth / AI / audit boundaries are
 * mocked (per the #1572 test pattern). Regression pin only — NOT the
 * HL-003 E2E-on-dev gate (Quinn's AFTER capture).
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

const MCQ = {
	id: 5,
	question_type: 'multiple_choice',
	question_text: 'What is a promise?',
	options: '["a","b"]',
	correct_answer: 'a',
	explanation: 'A promise represents an async value.',
	difficulty_level: 2,
	time_limit_seconds: 120,
};

// #1627: this suite predates two route changes and its mock session
// drifted from the real row shape — (1) PR #1620's integrity guard only
// lets a session answer its OUTSTANDING question (the last asked, not
// yet answered), and (2) #1654 grades a completion as earned/max points
// over the recorded answers, re-reading the bank rows. The mock below
// therefore models a real 10th-question state: 9 recorded answers, Q5
// outstanding as the 10th asked, and the session write/claim cycle
// carrying answers forward exactly like the real DB.
// The score the session row carries when the 10th answer arrives; the
// completion re-read sees the score written by the answers UPDATE,
// exactly like the real DB.
let storedScore = 40;
// The 9 answers recorded before the 10th arrives (set per test).
let priorAnswers = [];
// The answers the session row carries now — the answers UPDATE moves
// the recorded 10th answer in, and later reads see it.
let storedAnswers = [];

function sessionRow() {
	return {
		id: 900,
		user_id: 7,
		status: 'in_progress',
		skill_id: 3,
		score: storedScore,
		questions_asked: [...priorAnswers.map((a) => ({ questionId: a.questionId })), { questionId: MCQ.id }],
		answers_given: storedAnswers,
		current_question_index: 9,
		current_difficulty: 2,
		max_difficulty_reached: 2,
		tab_switches: 0,
		copy_paste_attempts: 0,
		time_anomalies: 0,
		started_at: new Date(),
	};
}

const db = require('../../../lib/db');
db.query.mockImplementation(async (sql, params = []) => {
	const normalized = String(sql).toLowerCase().replace(/\s+/g, ' ');

	if (['begin', 'commit', 'rollback'].includes(normalized.trim())) {
		return { rows: [], rowCount: 0 };
	}
	// Answer flow — session load (user-scoped; also the FOR UPDATE
	// locked re-read inside the record transaction).
	if (normalized.includes('from assessment_sessions') && normalized.includes('user_id = $2')) {
		return { rows: [sessionRow()], rowCount: 1 };
	}
	// Completion re-read — session by id only (sees the updated score
	// and the recorded answers).
	if (normalized.includes('select * from assessment_sessions where id = $1')) {
		return { rows: [sessionRow()], rowCount: 1 };
	}
	// Completion claim — the graded session row, answers included.
	if (
		normalized.includes('update assessment_sessions') &&
		normalized.includes("status = 'completed'")
	) {
		return { rows: [sessionRow()], rowCount: 1 };
	}
	// The answered question.
	if (normalized.includes('from assessment_questions') && normalized.includes('where id = $1')) {
		return { rows: [MCQ], rowCount: 1 };
	}
	// Grading re-read — the bank rows behind the recorded answers.
	if (normalized.includes('from assessment_questions') && normalized.includes('any($1)')) {
		const rows = params[0].map((id) => ({
			id,
			difficulty_level: 2,
			question_type: 'multiple_choice',
		}));
		return { rows, rowCount: rows.length };
	}
	// Session write — the new total is what completion re-reads.
	if (normalized.includes('update assessment_sessions set answers_given')) {
		storedAnswers = JSON.parse(params[0]);
		storedScore = params[1];
		return { rows: [], rowCount: 1 };
	}
	if (normalized.includes('select skill_name from candidate_skills')) {
		return { rows: [{ skill_name: 'JavaScript' }], rowCount: 1 };
	}
	if (normalized.includes('insert into skill_assessments')) {
		return { rows: [{ id: 555 }], rowCount: 1 };
	}
	return { rows: [], rowCount: 0 };
});

const { AuditLogger } = require('../../../services/auditLogService');
const assessmentsRouter = require('../../../routes/assessments');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/assessments', assessmentsRouter);
	return app;
}

function submitTenthAnswer() {
	return request(buildApp())
		.post('/api/assessments/answer')
		.set('x-test-user-id', '7')
		.send({ sessionId: 900, questionId: 5, answer: 'a', timeTaken: 60 });
}

function gradedEntries() {
	return AuditLogger.log.mock.calls
		.map(([arg]) => arg)
		.filter((arg) => arg.actionType === 'assessment_graded');
}

beforeEach(() => {
	AuditLogger.log.mockClear();
	priorAnswers = [];
	storedAnswers = [];
	jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'log').mockImplementation(() => {});
});

// Nine recorded answers (questions 101–109, difficulty 2 → 20 points
// each at stake); `correct` of them were answered correctly. The
// session row carries them as its answers_given from the start.
function seedPriorAnswers(correct) {
	priorAnswers = Array.from({ length: 9 }, (_, i) => ({
		questionId: 101 + i,
		answer: i < correct ? 'a' : 'b',
		isCorrect: i < correct,
		scorePoints: i < correct ? 20 : 0,
	}));
	storedAnswers = priorAnswers;
}
afterEach(() => jest.restoreAllMocks());

describe('POST /answer completion — assessment_graded audit entry (#1584 item 2)', () => {
	it('passed assessment: audit entry records score/passed but NO confidence (none was measured)', async () => {
		seedPriorAnswers(9); // 9/9 correct + the correct 10th = 200/200 → score 100, passed
		storedScore = 180;
		const res = await submitTenthAnswer();
		expect(res.status).toBe(200);
		expect(res.body.completed).toBe(true);

		const graded = gradedEntries();
		expect(graded).toHaveLength(1);
		expect(graded[0].metadata.passed).toBe(true);
		expect(graded[0].metadata.score).toBe(100);
		expect(graded[0].metadata).not.toHaveProperty('confidence');
	});

	it('failed assessment: audit entry likewise carries NO confidence (not the invented 0.6)', async () => {
		seedPriorAnswers(0); // 0/9 correct + the correct 10th = 20/200 → score 10 < 60, failed
		storedScore = 0;
		const res = await submitTenthAnswer();
		expect(res.status).toBe(200);
		expect(res.body.completed).toBe(true);

		const graded = gradedEntries();
		expect(graded).toHaveLength(1);
		expect(graded[0].metadata.passed).toBe(false);
		expect(graded[0].metadata).not.toHaveProperty('confidence');
	});
});
