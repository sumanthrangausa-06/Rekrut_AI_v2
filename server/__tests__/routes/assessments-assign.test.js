/**
 * Task 1, issue #343 — "Assignment that lands".
 *
 * Candidates assigned an assessment were notified in-app but the notification
 * carried no link, there was no "my assigned assessments" surface, and
 * attaching an aptitude test to a job notified nobody. These tests pin the
 * three fixes:
 *
 *  1a. POST /assessments/assign → the 'assessment_assigned' notification
 *      metadata contains url '/candidate/job-assessment/<assessment_id>'
 *      (the notification center deep-links on metadata.url).
 *  1b. GET /assessments/assigned → the caller's own 'assigned' attempts only.
 *  1c. POST /recruiter/jobs/:id/aptitude-test → in-app notifications for all
 *      applicants with active applications to that job.
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

// Captured user_notifications INSERT params, reset per test.
let notificationInserts = [];

const db = require('../../../lib/db');
db.query.mockImplementation(async (sql, params = []) => {
	const normalized = String(sql).toLowerCase().replace(/\s+/g, ' ');

	// Capture notification writes so tests can assert on metadata.
	if (normalized.includes('insert into user_notifications')) {
		notificationInserts.push(params);
		return { rows: [{ id: 900 + notificationInserts.length }], rowCount: 1 };
	}

	// POST /assign — application lookup (company-scoped).
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

	// POST /assign — assessment lookup (company-scoped via job).
	if (normalized.includes('from job_assessments ja') && normalized.includes('join jobs j')) {
		return { rows: [{ id: 55, title: 'Tech Screen' }], rowCount: 1 };
	}

	// POST /assign — dedup check for open attempts.
	if (
		normalized.includes('from job_assessment_attempts') &&
		normalized.includes("status in ('assigned','in_progress')")
	) {
		return { rows: [], rowCount: 0 };
	}

	// POST /assign — attempt INSERT.
	if (normalized.includes('insert into job_assessment_attempts')) {
		return {
			rows: [
				{ id: 200, assessment_id: 55, candidate_id: 7, application_id: 100, status: 'assigned' },
			],
			rowCount: 1,
		};
	}

	// GET /assigned — the candidate's own assigned attempts (keyed on the alias).
	if (normalized.includes('from job_assessment_attempts jaa')) {
		const candidateId = params[0];
		const rows =
			candidateId === 7
				? [
						{
							attempt_id: 200,
							assessment_id: 55,
							application_id: 100,
							status: 'assigned',
							created_at: '2026-10-06T10:00:00Z',
							assessment_title: 'Tech Screen',
							job_id: 10,
							job_title: 'Backend Engineer',
						},
					]
				: [];
		return { rows, rowCount: rows.length };
	}

	// Aptitude attach — assignment upsert.
	if (normalized.includes('insert into aptitude_test_assignments')) {
		return {
			rows: [{ job_id: 10, test_id: 3, is_required: true }],
			rowCount: 1,
		};
	}

	// Aptitude attach — applicants with active applications to the job.
	if (normalized.includes('from job_applications') && normalized.includes('job_id')) {
		return { rows: [{ candidate_id: 7 }, { candidate_id: 9 }], rowCount: 2 };
	}

	return { rows: [], rowCount: 0 };
});

const assessmentsRouter = require('../../../routes/assessments');
const aptitudeRouter = require('../../../routes/aptitude');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/assessments', assessmentsRouter);
	app.use('/api', aptitudeRouter);
	return app;
}

// notifyUser is fire-and-forget in the route (no await); flush the microtask
// queue so the mocked INSERT lands before assertions.
async function flushNotifications() {
	for (let i = 0; i < 5; i++) {
		await new Promise((resolve) => setImmediate(resolve));
	}
}

beforeEach(() => {
	notificationInserts = [];
});

describe('Task 1a — assign notification carries a deep link', () => {
	it("includes url '/candidate/job-assessment/<assessment_id>' in metadata", async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/assign')
			.set('x-test-user-id', '2')
			.send({ assessment_id: 55, application_id: 100 });

		expect(res.status).toBe(200);
		await flushNotifications();
		expect(notificationInserts).toHaveLength(1);
		const metadata = JSON.parse(notificationInserts[0][4]);
		expect(metadata.url).toBe('/candidate/job-assessment/55');
		expect(metadata.assessment_id).toBe(55);
		expect(notificationInserts[0][0]).toBe(7); // candidate user id
		expect(notificationInserts[0][1]).toBe('assessment_assigned');
	});
});

describe('Task 1b — GET /assessments/assigned', () => {
	it("returns only the caller's assigned attempts", async () => {
		const app = buildApp();
		const res = await request(app).get('/api/assessments/assigned').set('x-test-user-id', '7');

		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty('attempts');
		expect(res.body.attempts).toHaveLength(1);
		expect(res.body.attempts[0]).toMatchObject({
			attempt_id: 200,
			assessment_id: 55,
			status: 'assigned',
			assessment_title: 'Tech Screen',
			job_title: 'Backend Engineer',
		});
	});

	it('returns an empty list for a candidate with no assigned attempts', async () => {
		const app = buildApp();
		const res = await request(app).get('/api/assessments/assigned').set('x-test-user-id', '9');

		expect(res.status).toBe(200);
		expect(res.body.attempts).toEqual([]);
	});

	it('requires authentication', async () => {
		const app = buildApp();
		const res = await request(app).get('/api/assessments/assigned');
		expect(res.status).toBe(401);
	});
});

describe('Task 1c — aptitude attach notifies applicants', () => {
	it('creates an in-app notification per applicant with a link to the aptitude page', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/recruiter/jobs/10/aptitude-test')
			.set('x-test-user-id', '2')
			.send({ testId: 3, isRequired: true });

		expect(res.status).toBe(200);
		await flushNotifications();
		expect(notificationInserts).toHaveLength(2);
		const notifiedIds = notificationInserts.map((p) => p[0]).sort();
		expect(notifiedIds).toEqual([7, 9]);
		for (const params of notificationInserts) {
			const metadata = JSON.parse(params[4]);
			expect(metadata.url).toBe('/aptitude-tests');
			expect(params[1]).toBe('aptitude_test_assigned');
		}
	});
});
