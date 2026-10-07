/**
 * Task 2, issue #343 — "Enforce assignment".
 *
 * POST /job-assessment/:id/start created a brand-new attempt for ANY
 * authenticated user when the assessment was published — no assignment check,
 * no application check, no role check. POST /assessments/assign had zero
 * role checks (company scoping only). These tests pin the two fixes:
 *
 *  2a. Start requires an assignment: candidates may start ONLY with an
 *      existing 'assigned' (adopt) or 'in_progress' (resume) attempt;
 *      anyone else gets 403 ASSIGNMENT_REQUIRED. Recruiters keep the
 *      current preview behavior.
 *  2b. POST /assessments/assign requires a hiring-team role; a candidate
 *      calling it gets 403 RECRUITER_ONLY.
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

const db = require('../../../lib/db');
db.query.mockImplementation(async (sql, params = []) => {
	const normalized = String(sql).toLowerCase().replace(/\s+/g, ' ');

	// Start — published assessment check.
	if (normalized.includes('from job_assessments') && normalized.includes("status = 'published'")) {
		return { rows: [{ id: 55, status: 'published', title: 'Tech Screen' }], rowCount: 1 };
	}

	// Start — existing in_progress attempt (candidate-scoped).
	if (
		normalized.includes('from job_assessment_attempts') &&
		normalized.includes("status = 'in_progress'") &&
		normalized.includes('assessment_id = $1')
	) {
		return { rows: [], rowCount: 0 };
	}

	// Start — adopt a recruiter-assigned attempt (only user 7 has one).
	if (normalized.includes("status = 'assigned'") && normalized.includes('order by created_at')) {
		const candidateId = params[1];
		if (candidateId === 7) {
			return {
				rows: [{ id: 200, assessment_id: 55, candidate_id: 7, status: 'assigned' }],
				rowCount: 1,
			};
		}
		return { rows: [], rowCount: 0 };
	}

	// Start — adopt UPDATE.
	if (normalized.includes('update job_assessment_attempts set status =')) {
		return { rows: [], rowCount: 1 };
	}

	// Start — resume re-select by attempt id.
	if (normalized.includes('from job_assessment_attempts') && normalized.includes('where id = $1')) {
		return {
			rows: [
				{
					id: 200,
					assessment_id: 55,
					candidate_id: 7,
					status: 'in_progress',
					answers: [],
				},
			],
			rowCount: 1,
		};
	}

	// Start — questions for the assessment.
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

	// Start — create new attempt (recruiter preview path).
	if (normalized.includes('insert into job_assessment_attempts')) {
		const candidateId = params[1];
		return {
			rows: [{ id: 300, assessment_id: 55, candidate_id: candidateId, status: 'in_progress' }],
			rowCount: 1,
		};
	}

	// Assign — application lookup (company-scoped).
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

	// Assign — assessment lookup (company-scoped via job).
	if (normalized.includes('from job_assessments ja') && normalized.includes('join jobs j')) {
		return { rows: [{ id: 55, title: 'Tech Screen' }], rowCount: 1 };
	}

	// Assign — dedup check.
	if (normalized.includes("status in ('assigned','in_progress')")) {
		return { rows: [], rowCount: 0 };
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

describe('Task 2a — start requires an assignment', () => {
	it('returns 403 ASSIGNMENT_REQUIRED for an unassigned candidate', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/start')
			.set('x-test-user-id', '9')
			.send({});

		expect(res.status).toBe(403);
		expect(res.body.code).toBe('ASSIGNMENT_REQUIRED');
	});

	it('adopts the assigned attempt for an assigned candidate (200)', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/start')
			.set('x-test-user-id', '7')
			.send({});

		expect(res.status).toBe(200);
		expect(res.body.attemptId).toBe(200);
		expect(res.body.resumed).toBe(true);
	});

	it('lets a recruiter start a preview attempt (200)', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/start')
			.set('x-test-user-id', '2')
			.send({});

		expect(res.status).toBe(200);
		expect(res.body.attemptId).toBe(300);
		expect(res.body.resumed).toBe(false);
	});

	it('requires authentication', async () => {
		const app = buildApp();
		const res = await request(app).post('/api/assessments/job-assessment/55/start').send({});
		expect(res.status).toBe(401);
	});
});

describe('Task 2b — assign requires a hiring-team role', () => {
	it('returns 403 RECRUITER_ONLY for a candidate', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/assign')
			.set('x-test-user-id', '7')
			.send({ assessment_id: 55, application_id: 100 });

		expect(res.status).toBe(403);
		expect(res.body.code).toBe('RECRUITER_ONLY');
	});

	it('still allows a recruiter to assign', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/assign')
			.set('x-test-user-id', '2')
			.send({ assessment_id: 55, application_id: 100 });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});
});
