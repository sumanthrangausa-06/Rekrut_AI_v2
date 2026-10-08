/**
 * Task 3, issue #343 — "Deadlines".
 *
 * The assessment flow had no notion of deadlines: POST /assessments/assign
 * took no due date, expired attempts were never blocked, and
 * job_assessments.time_limit_minutes (default 45) was dead config — never
 * read by any code. These tests pin the four fixes:
 *
 *  3a. Migration adds due_date TIMESTAMPTZ NULL to job_assessment_attempts
 *      (verified separately against a fresh DB; see test (i) in the report).
 *  3b. POST /assessments/assign accepts an optional due_date: stored on the
 *      attempt, returned in the response; past/invalid values → 400.
 *  3c. POST /job-assessment/:id/start and /answer reject expired attempts
 *      with 410 ASSESSMENT_EXPIRED.
 *  3d. time_limit_minutes is honored: returned by /start, enforced
 *      server-side on /answer (started_at + limit elapsed → 410
 *      TIME_LIMIT_EXCEEDED).
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
	9: { id: 9, role: 'candidate', company_id: null, name: 'Ben Candidate' },
};

// Scenario switches, reset per test.
let scenario = 'default';
let assignInserts = [];

const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const TWO_HOURS_AGO = new Date(Date.now() - 2 * 3600 * 1000).toISOString();

const db = require('../../../lib/db');
db.query.mockImplementation(async (sql, params = []) => {
	const normalized = String(sql).toLowerCase().replace(/\s+/g, ' ');

	// Transactions (answer handler).
	if (['begin', 'commit', 'rollback'].includes(normalized)) {
		return { rows: [], rowCount: 0 };
	}

	// Assign — application / assessment / dedup lookups.
	if (normalized.includes('from job_applications ja') && normalized.includes('join jobs j')) {
		return {
			rows: [
				{
					id: 100,
					candidate_id: 7,
					job_id: 10,
					company_id: 5,
					job_title: 'Backend Engineer',
					candidate_name: 'Asha Candidate',
				},
			],
			rowCount: 1,
		};
	}
	if (normalized.includes('from job_assessments ja') && normalized.includes('join jobs j')) {
		return { rows: [{ id: 55, title: 'Tech Screen' }], rowCount: 1 };
	}
	if (
		normalized.includes('from job_assessment_attempts') &&
		normalized.includes("status in ('assigned','in_progress')")
	) {
		return { rows: [], rowCount: 0 };
	}

	// Assign — attempt INSERT; capture params so tests can assert due_date.
	if (normalized.includes('insert into job_assessment_attempts')) {
		assignInserts.push(params);
		const dueDate = params[3] ?? null;
		return {
			rows: [
				{
					id: 200,
					assessment_id: 55,
					candidate_id: 7,
					application_id: 100,
					status: 'assigned',
					due_date: dueDate ? new Date(dueDate).toISOString() : null,
				},
			],
			rowCount: 1,
		};
	}

	// Start — published assessment (carries time_limit_minutes).
	if (normalized.includes('from job_assessments') && normalized.includes("status = 'published'")) {
		return {
			rows: [{ id: 55, status: 'published', title: 'Tech Screen', time_limit_minutes: 45 }],
			rowCount: 1,
		};
	}

	// Start — existing in_progress attempt.
	if (
		normalized.includes('from job_assessment_attempts') &&
		normalized.includes("status = 'in_progress'") &&
		normalized.includes('assessment_id = $1') &&
		!normalized.includes('join')
	) {
		if (scenario === 'expired-in-progress') {
			return {
				rows: [
					{
						id: 201,
						assessment_id: 55,
						candidate_id: 7,
						status: 'in_progress',
						answers: [],
						due_date: PAST,
						started_at: new Date(Date.now() - 3600 * 1000).toISOString(),
					},
				],
				rowCount: 1,
			};
		}
		return { rows: [], rowCount: 0 };
	}

	// Start — assigned attempt awaiting adoption.
	if (normalized.includes("status = 'assigned'") && normalized.includes('order by created_at')) {
		const candidateId = params[1];
		if (candidateId === 7) {
			return {
				rows: [
					{
						id: 200,
						assessment_id: 55,
						candidate_id: 7,
						status: 'assigned',
						due_date: scenario === 'expired-assigned' ? PAST : FUTURE,
						started_at: null,
					},
				],
				rowCount: 1,
			};
		}
		return { rows: [], rowCount: 0 };
	}

	// Start — adopt UPDATE + re-select.
	if (normalized.includes('update job_assessment_attempts set status =')) {
		return { rows: [], rowCount: 1 };
	}
	if (normalized.includes('from job_assessment_attempts') && normalized.includes('where id = $1')) {
		return {
			rows: [
				{
					id: 200,
					assessment_id: 55,
					candidate_id: 7,
					status: 'in_progress',
					answers: [],
					due_date: scenario === 'expired-assigned' ? PAST : FUTURE,
					started_at: new Date().toISOString(),
				},
			],
			rowCount: 1,
		};
	}

	// Answer — question lookup (empty → 404, proving the guards passed).
	// NOTE: this must precede the generic start-questions branch below.
	if (normalized.includes('from job_assessment_questions where id =')) {
		return { rows: [], rowCount: 0 };
	}

	// Start — questions.
	if (normalized.includes('from job_assessment_questions')) {
		if (normalized.includes('count(*)')) {
			return { rows: [{ total: '1' }], rowCount: 1 };
		}
		return {
			rows: [
				{
					id: 1,
					category: 'technical',
					question_type: 'multiple_choice',
					question_text: 'What is a closure?',
					options: '["a","b","c"]',
					difficulty_level: 2,
					points: 20,
					time_limit_seconds: 120,
					order_index: 1,
				},
			],
			rowCount: 1,
		};
	}

	// Answer / converse — attempt load (joins job_assessments for time_limit_minutes).
	// Ownership-scoped: the attempt-by-id lookup (jaa.id = $1) only returns rows
	// for the attempt owner's candidate_id; other users get zero rows (404).
	if (
		normalized.includes('from job_assessment_attempts jaa') &&
		normalized.includes('join job_assessments')
	) {
		if (normalized.includes('jaa.id = $1') && params[1] !== 7) {
			return { rows: [], rowCount: 0 };
		}
		if (scenario === 'answer-expired-due') {
			return {
				rows: [
					{
						id: 201,
						assessment_id: 55,
						candidate_id: 7,
						status: 'in_progress',
						answers: [],
						due_date: PAST,
						started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
						time_limit_minutes: 45,
					},
				],
				rowCount: 1,
			};
		}
		if (scenario === 'answer-time-exceeded') {
			return {
				rows: [
					{
						id: 201,
						assessment_id: 55,
						candidate_id: 7,
						status: 'in_progress',
						answers: [],
						due_date: FUTURE,
						started_at: TWO_HOURS_AGO,
						time_limit_minutes: 45,
					},
				],
				rowCount: 1,
			};
		}
		// Fresh attempt: passes both guards, then 404s on the question lookup.
		return {
			rows: [
				{
					id: 201,
					assessment_id: 55,
					candidate_id: 7,
					status: 'in_progress',
					answers: [],
					due_date: FUTURE,
					started_at: new Date().toISOString(),
					time_limit_minutes: 45,
				},
			],
			rowCount: 1,
		};
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

beforeEach(() => {
	scenario = 'default';
	assignInserts = [];
});

describe('Task 3b — assign accepts an optional due_date', () => {
	it('stores a future due_date on the attempt and returns it', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/assign')
			.set('x-test-user-id', '2')
			.send({ assessment_id: 55, application_id: 100, due_date: FUTURE });

		expect(res.status).toBe(200);
		expect(assignInserts).toHaveLength(1);
		expect(new Date(assignInserts[0][3]).toISOString()).toBe(FUTURE);
		expect(res.body.attempt.due_date).toBe(FUTURE);
	});

	it('stores NULL when no due_date is given (backward compatible)', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/assign')
			.set('x-test-user-id', '2')
			.send({ assessment_id: 55, application_id: 100 });

		expect(res.status).toBe(200);
		expect(assignInserts).toHaveLength(1);
		expect(assignInserts[0][3] ?? null).toBeNull();
	});

	it('rejects a past due_date with 400', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/assign')
			.set('x-test-user-id', '2')
			.send({ assessment_id: 55, application_id: 100, due_date: PAST });

		expect(res.status).toBe(400);
		expect(res.body.code).toBe('INVALID_DUE_DATE');
		expect(assignInserts).toHaveLength(0);
	});

	it('rejects an unparseable due_date with 400', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/assign')
			.set('x-test-user-id', '2')
			.send({ assessment_id: 55, application_id: 100, due_date: 'not-a-date' });

		expect(res.status).toBe(400);
		expect(res.body.code).toBe('INVALID_DUE_DATE');
		expect(assignInserts).toHaveLength(0);
	});
});

describe('Task 3c — expired attempts are blocked', () => {
	it('start: 410 ASSESSMENT_EXPIRED for an expired assigned attempt', async () => {
		scenario = 'expired-assigned';
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/start')
			.set('x-test-user-id', '7')
			.send({});

		expect(res.status).toBe(410);
		expect(res.body.code).toBe('ASSESSMENT_EXPIRED');
	});

	it('start: 410 ASSESSMENT_EXPIRED for an expired in_progress attempt', async () => {
		scenario = 'expired-in-progress';
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/start')
			.set('x-test-user-id', '7')
			.send({});

		expect(res.status).toBe(410);
		expect(res.body.code).toBe('ASSESSMENT_EXPIRED');
	});

	it('start: still works when the attempt is not expired', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/start')
			.set('x-test-user-id', '7')
			.send({});

		expect(res.status).toBe(200);
		expect(res.body.attemptId).toBe(200);
	});

	it('answer: 410 ASSESSMENT_EXPIRED when due_date passed mid-attempt', async () => {
		scenario = 'answer-expired-due';
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/answer')
			.set('x-test-user-id', '7')
			.send({ attemptId: 201, questionId: 1, answer: 'a', timeTaken: 30 });

		expect(res.status).toBe(410);
		expect(res.body.code).toBe('ASSESSMENT_EXPIRED');
	});
});

describe('Task 3d — time_limit_minutes is honored', () => {
	it('start: returns timeLimitMinutes from the assessment', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/start')
			.set('x-test-user-id', '7')
			.send({});

		expect(res.status).toBe(200);
		expect(res.body.timeLimitMinutes).toBe(45);
		expect(res.body.startedAt).toBeTruthy();
	});

	it('answer: 410 TIME_LIMIT_EXCEEDED after started_at + time_limit_minutes', async () => {
		scenario = 'answer-time-exceeded';
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/answer')
			.set('x-test-user-id', '7')
			.send({ attemptId: 201, questionId: 1, answer: 'a', timeTaken: 30 });

		expect(res.status).toBe(410);
		expect(res.body.code).toBe('TIME_LIMIT_EXCEEDED');
	});

	it('answer: a fresh attempt passes the time guard (404 on missing question proves it)', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/answer')
			.set('x-test-user-id', '7')
			.send({ attemptId: 201, questionId: 1, answer: 'a', timeTaken: 30 });

		// 404 = the expiry/time guards passed; the mocked question lookup is empty.
		expect(res.status).toBe(404);
		expect(res.body.error).toBe('Question not found');
	});
});

describe('Task 3 review — converse guards (I2 ownership, I1 expiry/time)', () => {
	it("non-owner converse → 404 (cannot read/inject into another candidate's attempt)", async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/converse')
			.set('x-test-user-id', '9')
			.send({ attemptId: 201, questionId: 1, message: 'tell me more' });

		expect(res.status).toBe(404);
		expect(res.body.error).toBe('Active attempt not found');
	});

	it('owner converse → passes guards (404 on missing question proves it)', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/converse')
			.set('x-test-user-id', '7')
			.send({ attemptId: 201, questionId: 1, message: 'tell me more' });

		// 404 'Question not found' = ownership + expiry + time guards all passed.
		expect(res.status).toBe(404);
		expect(res.body.error).toBe('Question not found');
	});

	it('converse: 410 ASSESSMENT_EXPIRED when due_date passed', async () => {
		scenario = 'answer-expired-due';
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/converse')
			.set('x-test-user-id', '7')
			.send({ attemptId: 201, questionId: 1, message: 'tell me more' });

		expect(res.status).toBe(410);
		expect(res.body.code).toBe('ASSESSMENT_EXPIRED');
	});

	it('converse: 410 TIME_LIMIT_EXCEEDED after started_at + time_limit_minutes', async () => {
		scenario = 'answer-time-exceeded';
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/converse')
			.set('x-test-user-id', '7')
			.send({ attemptId: 201, questionId: 1, message: 'tell me more' });

		expect(res.status).toBe(410);
		expect(res.body.code).toBe('TIME_LIMIT_EXCEEDED');
	});
});
