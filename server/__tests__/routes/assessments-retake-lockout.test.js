/**
 * Task 6, issue #343 — "Retake policy".
 *
 * POST /assessments/start abandoned any in-progress session and started a new
 * one — unlimited immediate retakes of skill self-assessments. The aptitude
 * engine already enforces retake_lockout_days (default 30) with 403
 * RETAKE_LOCKOUT. These tests pin the mirrored behavior for skills:
 *
 *  (i)   completed attempt within the lockout window → 403 RETAKE_LOCKOUT
 *  (ii)  completed attempt older than the lockout → 200 (new session)
 *  (iii) in-progress session, no completed attempt → 200 (abandon + restart,
 *          unchanged resume/retry behavior)
 *  (iv)  first-ever attempt → 200
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

jest.mock('../../../lib/distributed-rate-limiter', () => {
	const rateLimitMiddleware = jest.fn((_req, _res, next) => next());
	return {
		rateLimits: {
			strict: rateLimitMiddleware,
			standard: rateLimitMiddleware,
			lenient: rateLimitMiddleware,
			ai: rateLimitMiddleware,
		},
	};
});

global.__testUsers = {
	// Completed a JavaScript skill assessment 5 days ago → inside 30-day lockout.
	7: { id: 7, role: 'candidate', company_id: null, name: 'Asha Candidate' },
	// Completed a JavaScript skill assessment 40 days ago → outside lockout.
	9: { id: 9, role: 'candidate', company_id: null, name: 'Ben Candidate' },
	// No assessment history at all.
	11: { id: 11, role: 'candidate', company_id: null, name: 'Cara Candidate' },
	// In-progress session only, never completed.
	12: { id: 12, role: 'candidate', company_id: null, name: 'Dev Candidate' },
};

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

const db = require('../../../lib/db');
db.query.mockImplementation(async (sql, params = []) => {
	const normalized = String(sql).toLowerCase().replace(/\s+/g, ' ');

	// Start — skill lookup by name.
	if (normalized.includes('from candidate_skills') && normalized.includes('lower(skill_name)')) {
		const userId = params[0];
		return {
			rows: [{ id: 5, user_id: userId, skill_name: 'JavaScript', category: 'technical' }],
			rowCount: 1,
		};
	}

	// Start — retake lockout: last completed skill_assessments row.
	if (
		normalized.includes('from skill_assessments') &&
		normalized.includes('order by completed_at desc')
	) {
		const userId = params[0];
		if (userId === 7) {
			return { rows: [{ completed_at: daysAgo(5) }], rowCount: 1 };
		}
		if (userId === 9) {
			return { rows: [{ completed_at: daysAgo(40) }], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	}

	// Start — active in-progress session check.
	if (
		normalized.includes('from assessment_sessions') &&
		normalized.includes("status = 'in_progress'") &&
		normalized.includes('skill_id = $2')
	) {
		const userId = params[0];
		if (userId === 12) {
			return { rows: [{ id: 77 }], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	}

	// Start — abandon old session.
	if (normalized.includes("update assessment_sessions set status = 'abandoned'")) {
		return { rows: [], rowCount: 1 };
	}

	// Start — create new session.
	if (normalized.includes('insert into assessment_sessions')) {
		const userId = params[0];
		return {
			rows: [
				{
					id: 900,
					user_id: userId,
					skill_id: 5,
					score: 0,
					tab_switches: 0,
					copy_paste_attempts: 0,
					time_anomalies: 0,
					max_difficulty_reached: 2,
					started_at: new Date().toISOString(),
				},
			],
			rowCount: 1,
		};
	}

	// generateQuestion — bank hit so no AI call happens.
	if (
		normalized.includes('from assessment_questions') &&
		normalized.includes('order by random()')
	) {
		return {
			rows: [
				{
					id: 11,
					difficulty_level: 2,
					question_text: 'What is a closure?',
					question_type: 'multiple_choice',
					options: '["a","b","c","d"]',
					time_limit_seconds: 90,
				},
			],
			rowCount: 1,
		};
	}

	// Start — record first question asked.
	if (normalized.includes('update assessment_sessions set questions_asked')) {
		return { rows: [], rowCount: 1 };
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

describe('Task 6 — skill self-assessment retake lockout', () => {
	it('(i) returns 403 RETAKE_LOCKOUT when a completed attempt is inside the lockout window', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/start')
			.set('x-test-user-id', '7')
			.send({ skillName: 'JavaScript', category: 'technical' });

		expect(res.status).toBe(403);
		expect(res.body.code).toBe('RETAKE_LOCKOUT');
		expect(res.body.lockoutDays).toBe(30);
	});

	it('(ii) allows a new start when the completed attempt is older than the lockout', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/start')
			.set('x-test-user-id', '9')
			.send({ skillName: 'JavaScript', category: 'technical' });

		expect(res.status).toBe(200);
		expect(res.body.sessionId).toBe(900);
	});

	it('(iii) keeps abandon-and-restart for an in-progress session (no completed attempt)', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/start')
			.set('x-test-user-id', '12')
			.send({ skillName: 'JavaScript', category: 'technical' });

		expect(res.status).toBe(200);
		expect(res.body.sessionId).toBe(900);
	});

	it('(iv) allows a first-ever attempt', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/start')
			.set('x-test-user-id', '11')
			.send({ skillName: 'JavaScript', category: 'technical' });

		expect(res.status).toBe(200);
		expect(res.body.sessionId).toBe(900);
	});

	it('requires authentication', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/start')
			.send({ skillName: 'JavaScript', category: 'technical' });
		expect(res.status).toBe(401);
	});
});
