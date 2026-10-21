/**
 * #1571 — routes/questionnaire.js evaluateAnswer parse-failure fallback.
 *
 * Defect: when the AI evaluation response cannot be parsed, evaluateAnswer
 * returned { score: 50, explanation: 'AI evaluation could not be parsed.
 * Default score applied.' }. The submit flow INSERTed that fabricated 50 into
 * screening_question_evaluations, averaged it into overallScore, and flipped
 * the response to evaluated/rejected against the pass threshold.
 *
 * Honest behaviour: on parse failure mint NO score — skip that question's
 * evaluation exactly as the caller already does when chat() throws.
 * overallScore is computed only from real evaluations; if answers were
 * attempted but no real evaluation exists, the response stays in the honest
 * unevaluated state (status 'completed', overall_score NULL).
 *
 * Drives the REAL submit route; only db / auth / AI boundaries are mocked.
 * Regression pin only — NOT the HL-003 E2E-on-dev gate (Quinn's AFTER capture).
 */
jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((req, _res, next) => {
		req.user = { id: 42, email: 'candidate@test.com', role: 'candidate' };
		return next();
	}),
	requireRole: jest.fn(() => (_req, _res, next) => next()),
}));
jest.mock('../../../lib/db', () => ({ query: jest.fn() }));
jest.mock('../../../lib/polsia-ai', () => ({
	chat: jest.fn(),
	safeParseJSON: (text) => {
		if (!text || typeof text !== 'string') return null;
		const match = text.match(/\{[\s\S]*\}/);
		if (!match) return null;
		try {
			return JSON.parse(match[0]);
		} catch {
			return null;
		}
	},
}));
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: { log: jest.fn(async () => ({})) },
}));

const request = require('supertest');
const express = require('express');
const pool = require('../../../lib/db');
const { chat } = require('../../../lib/polsia-ai');
const questionnaireRouter = require('../../../routes/questionnaire');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/questionnaire', questionnaireRouter);
	return app;
}

const RESPONSE_ROW = {
	id: 501,
	candidate_id: 42,
	questionnaire_id: 77,
	status: 'in_progress',
	answers: {},
	job_id: 11,
	pass_threshold: 70,
};

const Q1 = {
	id: 1,
	questionnaire_id: 77,
	question_text: 'Why do you want this role?',
	question_type: 'short_text',
	is_knockout: false,
	knockout_answer: null,
};
const Q2 = {
	id: 2,
	questionnaire_id: 77,
	question_text: 'Describe a dashboard you built.',
	question_type: 'short_text',
	is_knockout: false,
	knockout_answer: null,
};

let questions;
let evaluationInserts;
let finalUpdates;

beforeEach(() => {
	jest.clearAllMocks();
	questions = [Q1];
	evaluationInserts = [];
	finalUpdates = [];
	jest.spyOn(console, 'error').mockImplementation(() => {});
	pool.query.mockImplementation(async (sql, params = []) => {
		const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
		if (normalized.startsWith('update screening_responses') && normalized.includes('overall_score')) {
			finalUpdates.push(params);
			return { rows: [], rowCount: 1 };
		}
		if (normalized.includes('from screening_responses')) {
			return { rows: [RESPONSE_ROW], rowCount: 1 };
		}
		if (normalized.includes('from screening_questions')) {
			return { rows: questions, rowCount: questions.length };
		}
		if (normalized.includes('from jobs')) {
			return {
				rows: [{ id: 11, title: 'Data Analyst', description: 'Analyse product data.' }],
				rowCount: 1,
			};
		}
		if (normalized.startsWith('insert into screening_question_evaluations')) {
			evaluationInserts.push(params);
			return { rows: [], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	});
});
afterEach(() => jest.restoreAllMocks());

describe('POST /submit — AI evaluation parse failure (#1571)', () => {
	test('unparseable evaluation: NO evaluation row persisted, response stays unevaluated (completed, overall_score NULL)', async () => {
		chat.mockResolvedValue('Sorry, I cannot format that as JSON.');

		const res = await request(makeApp())
			.post('/api/questionnaire/submit')
			.send({ response_id: 501, answers: { 1: 'I love data and dashboards.' } });

		expect(res.status).toBe(200);
		// No fabricated 50 may be stored.
		expect(evaluationInserts).toHaveLength(0);
		// Final UPDATE: [answers, status, overallScore, aiExplanation, response_id]
		expect(finalUpdates).toHaveLength(1);
		expect(finalUpdates[0][1]).toBe('completed');
		expect(finalUpdates[0][2]).toBeNull();
		expect(res.body.status).toBe('completed');
		expect(res.body.overall_score).toBeNull();
	});

	test('mixed real + unparseable: only the real score is persisted and averaged', async () => {
		questions = [Q1, Q2];
		chat.mockImplementation(async (prompt) => {
			if (prompt.includes(Q1.question_text)) {
				return JSON.stringify({ score: 80, explanation: 'Relevant, complete answer.' });
			}
			return 'unparseable free text with no json';
		});

		const res = await request(makeApp())
			.post('/api/questionnaire/submit')
			.send({ response_id: 501, answers: { 1: 'Strong relevant answer.', 2: 'Built a KPI dashboard.' } });

		expect(res.status).toBe(200);
		expect(evaluationInserts).toHaveLength(1);
		// INSERT params: [response_id, question_id, score, explanation]
		expect(evaluationInserts[0][1]).toBe(1);
		expect(evaluationInserts[0][2]).toBe(80);
		// Average is the real 80 alone — not (80 + fabricated 50) / 2 = 65.
		expect(finalUpdates[0][1]).toBe('evaluated');
		expect(finalUpdates[0][2]).toBe(80);
		expect(res.body.overall_score).toBe(80);
	});

	test('control: a real parsed score is preserved exactly and drives status', async () => {
		chat.mockResolvedValue(JSON.stringify({ score: 80, explanation: 'Relevant, complete answer.' }));

		const res = await request(makeApp())
			.post('/api/questionnaire/submit')
			.send({ response_id: 501, answers: { 1: 'Strong relevant answer.' } });

		expect(res.status).toBe(200);
		expect(evaluationInserts).toHaveLength(1);
		expect(evaluationInserts[0][2]).toBe(80);
		expect(finalUpdates[0][1]).toBe('evaluated');
		expect(finalUpdates[0][2]).toBe(80);
		expect(res.body.status).toBe('evaluated');
	});
});
