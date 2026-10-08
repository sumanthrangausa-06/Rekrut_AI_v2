/**
 * I1 (issue #343 review) — "GET /assessments/job/:jobId leaks answers".
 *
 * GET /assessments/job/:jobId returned `SELECT * FROM job_assessment_questions`
 * to ANY authenticated user — full rows including correct_answer, rubric and
 * explanation. The candidate job-detail page calls this endpoint on every job
 * view, so any candidate could read the entire question bank with answers.
 * That undermines the task-2 hardening: blocking self-start is pointless when
 * the answers are readable.
 *
 * These tests pin the fix:
 *  - candidate GET → 200, questions present, but NO correct_answer / rubric /
 *    explanation on any question row (question_text, options, points,
 *    order_index, time_limit_seconds still present).
 *  - recruiter GET → 200 with the FULL rows (the recruiter review UI needs
 *    correct_answer/rubric/explanation).
 *  - unauthenticated GET → 401.
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

global.__testUsers = {
	2: { id: 2, role: 'recruiter', company_id: 5, name: 'Rita Recruiter' },
	7: { id: 7, role: 'candidate', company_id: null, name: 'Asha Candidate' },
};

const FULL_QUESTION = {
	id: 101,
	assessment_id: 55,
	category: 'technical',
	question_type: 'multiple_choice',
	question_text: 'What does Array.prototype.map return?',
	options: JSON.stringify(['A new array', 'The same array', 'undefined', 'A boolean']),
	correct_answer: 'A new array',
	rubric: 'Award full points for the exact option.',
	explanation: 'map() creates a new array with the results of calling the callback.',
	difficulty_level: 2,
	points: 10,
	time_limit_seconds: 120,
	order_index: 0,
	metadata: {},
	created_at: '2026-10-06T00:00:00.000Z',
};

const db = require('../../../lib/db');
db.query.mockImplementation(async (sql) => {
	const normalized = String(sql).toLowerCase().replace(/\s+/g, ' ');

	// GET /job/:jobId — latest non-archived assessment for the job.
	if (normalized.includes('from job_assessments') && normalized.includes("status != 'archived'")) {
		return {
			rows: [{ id: 55, job_id: 10, title: 'Tech Screen', status: 'published', question_count: 2 }],
			rowCount: 1,
		};
	}

	// GET /job/:jobId — question rows (vulnerable version returns SELECT *).
	if (
		normalized.includes('from job_assessment_questions') &&
		normalized.includes('order by order_index')
	) {
		return {
			rows: [{ ...FULL_QUESTION }, { ...FULL_QUESTION, id: 102, order_index: 1 }],
			rowCount: 2,
		};
	}

	// GET /job/:jobId — attempt stats.
	if (
		normalized.includes('from job_assessment_attempts') &&
		normalized.includes('total_attempts')
	) {
		return { rows: [{ total_attempts: '3', completed: '2', avg_score: '75.5' }], rowCount: 1 };
	}

	return { rows: [], rowCount: 0 };
});

const assessmentsRouter = require('../../../routes/assessments');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/assessments', assessmentsRouter);
	return app;
}

const SENSITIVE = ['correct_answer', 'rubric', 'explanation'];
const NEEDED = ['question_text', 'options', 'points', 'order_index', 'time_limit_seconds'];

describe('I1 — GET /assessments/job/:jobId question sanitization', () => {
	it('strips correct_answer/rubric/explanation for a candidate (200)', async () => {
		const app = buildApp();
		const res = await request(app).get('/api/assessments/job/10').set('x-test-user-id', '7');

		expect(res.status).toBe(200);
		expect(res.body.assessment).toBeTruthy();
		expect(res.body.assessment.questions).toHaveLength(2);
		for (const q of res.body.assessment.questions) {
			for (const field of SENSITIVE) {
				expect(q).not.toHaveProperty(field);
			}
			for (const field of NEEDED) {
				expect(q).toHaveProperty(field);
			}
		}
	});

	it('keeps the full question rows for a recruiter (200)', async () => {
		const app = buildApp();
		const res = await request(app).get('/api/assessments/job/10').set('x-test-user-id', '2');

		expect(res.status).toBe(200);
		expect(res.body.assessment.questions).toHaveLength(2);
		for (const q of res.body.assessment.questions) {
			for (const field of [...SENSITIVE, ...NEEDED]) {
				expect(q).toHaveProperty(field);
			}
		}
		expect(res.body.assessment.questions[0].correct_answer).toBe('A new array');
	});

	it('requires authentication', async () => {
		const app = buildApp();
		const res = await request(app).get('/api/assessments/job/10');
		expect(res.status).toBe(401);
	});
});
