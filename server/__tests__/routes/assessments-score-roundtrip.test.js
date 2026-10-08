/**
 * Task 4, issue #343 — "Score round-trip".
 *
 * scoreAttempt() computed composite %, per-category scores and an AI summary,
 * writing them to job_assessment_attempts — but the application never learned
 * the result: nothing wrote to job_applications, passing_score was never
 * compared, and the 'assessment_completed' recruiter notification fired only
 * on the manual POST /job-assessment/:id/score path, never when async scoring
 * finished after the candidate's last answer. These tests pin the fixes:
 *
 *  4a. scoreAttempt writes assessment_score + assessment_result to the linked
 *      job_applications row (both async and manual paths).
 *  4b. composite >= passing_score advances a 'screening' application to
 *      'shortlisted'; composite < passing_score marks 'fail' WITHOUT moving
 *      the stage (no auto-reject); applications outside 'screening' keep
 *      their stage and only record the score.
 *  4c. The async completion path (final answer → scoreAttempt) fires the
 *      'assessment_completed' in-app notification to the recruiter.
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

// AI scoring/summary must not run in tests: MC answers skip per-question AI,
// and the recruiter summary gets a canned response.
jest.mock('../../../lib/polsia-ai', () => ({
	chat: jest.fn(async () =>
		JSON.stringify({
			recommendation: 'hire',
			summary: 'Strong candidate.',
			strengths: ['s1'],
			weaknesses: ['w1'],
			fit_notes: 'Good fit.',
			suggested_interview_focus: ['t1'],
		}),
	),
	handleAIError: jest.fn(),
	safeParseJSON: (text) => {
		try {
			return JSON.parse(text);
		} catch {
			return null;
		}
	},
}));

// OmniScore recalculation is non-blocking and DB-heavy; mock it out so
// scoreAttempt tests don't hang on pool.connect().
jest.mock('../../../services/omniscore', () => ({
	calculateScore: jest.fn(async () => ({})),
	addTechnicalComponent: jest.fn(async () => ({})),
}));

global.__testUsers = {
	2: { id: 2, role: 'recruiter', company_id: 5, name: 'Rita Recruiter' },
	7: { id: 7, role: 'candidate', company_id: null, name: 'Asha Candidate' },
};

// Scenario switches, reset per test.
let scenario = 'pass'; // 'pass' | 'fail' | 'wrong-stage' | 'async' | 'already-scored'
let appUpdates = []; // captured UPDATE job_applications params
let notificationInserts = [];
let attemptUpdates = []; // captured UPDATE job_assessment_attempts (save-scores) params

const MC_QUESTION = {
	id: 1,
	category: 'technical',
	question_type: 'multiple_choice',
	question_text: 'What is a closure?',
	options: '["a","b","c"]',
	correct_answer: 'a',
	difficulty_level: 2,
	points: 20,
	time_limit_seconds: 120,
	order_index: 1,
};

function scoredAttempt(quickScore) {
	return {
		id: 301,
		assessment_id: 55,
		candidate_id: 7,
		application_id: 100,
		status: 'completed',
		answers: JSON.stringify([{ questionId: 1, answer: 'a', quickScore, category: 'technical' }]),
		tab_switches: 0,
		copy_paste_attempts: 0,
		time_anomalies: 0,
		time_spent_seconds: 60,
	};
}

const db = require('../../../lib/db');
db.query.mockImplementation(async (sql, params = []) => {
	const normalized = String(sql).toLowerCase().replace(/\s+/g, ' ');

	if (['begin', 'commit', 'rollback'].includes(normalized)) {
		return { rows: [], rowCount: 0 };
	}

	// scoreAttempt — attempt load (also serves the manual endpoint's re-read).
	if (
		normalized.includes('from job_assessment_attempts') &&
		normalized.includes('where id = $1') &&
		!normalized.includes('join')
	) {
		const quickScore = scenario === 'fail' ? 8 : 16; // 40% vs 80% of 20 pts
		const row = scoredAttempt(quickScore);
		if (scenario === 'already-scored') row.scored_at = '2026-10-06T00:00:00.000Z';
		return { rows: [row], rowCount: 1 };
	}

	// scoreAttempt — questions for the assessment.
	if (
		normalized.includes('from job_assessment_questions') &&
		normalized.includes('where assessment_id = $1') &&
		!normalized.includes('where id =')
	) {
		return { rows: [MC_QUESTION], rowCount: 1 };
	}

	// scoreAttempt — save scores; captured for idempotency assertions (I1).
	if (normalized.includes('update job_assessment_attempts set answers =')) {
		attemptUpdates.push({ sql, params });
		return { rows: [], rowCount: 1 };
	}

	// 4a/4b — passing_score lookup.
	if (normalized.includes('select passing_score from job_assessments')) {
		return { rows: [{ passing_score: 70 }], rowCount: 1 };
	}

	// 4a/4b — application row for the round-trip.
	if (
		normalized.includes('from job_applications') &&
		normalized.includes('where id = $1') &&
		!normalized.includes('join')
	) {
		const status = scenario === 'wrong-stage' ? 'interviewed' : 'screening';
		return { rows: [{ id: 100, status }], rowCount: 1 };
	}

	// 4a/4b — the round-trip write; capture for assertions.
	if (normalized.includes('update job_applications set')) {
		appUpdates.push({ sql, params });
		return { rows: [], rowCount: 1 };
	}

	// 4c — recruiter lookup for the completion notification.
	if (normalized.includes('from job_applications ja') && normalized.includes('join jobs j')) {
		return {
			rows: [
				{
					job_id: 10,
					recruiter_id: 2,
					job_title: 'Backend Engineer',
					candidate_name: 'Asha Candidate',
				},
			],
			rowCount: 1,
		};
	}

	// 4c — notification writes; capture for assertions.
	if (normalized.includes('insert into user_notifications')) {
		notificationInserts.push(params);
		return { rows: [{ id: 900 + notificationInserts.length }], rowCount: 1 };
	}

	// Async path — answer handler attempt load (jaa join).
	if (
		normalized.includes('from job_assessment_attempts jaa') &&
		normalized.includes('join job_assessments')
	) {
		return {
			rows: [
				{
					id: 301,
					assessment_id: 55,
					candidate_id: 7,
					status: 'in_progress',
					answers: [],
					due_date: null,
					started_at: new Date().toISOString(),
					time_limit_minutes: 45,
					time_anomalies: 0,
					time_spent_seconds: 0,
				},
			],
			rowCount: 1,
		};
	}

	// Async path — single question lookup for the answer.
	if (normalized.includes('from job_assessment_questions where id =')) {
		return { rows: [MC_QUESTION], rowCount: 1 };
	}

	// Async path — answer recorded / marked complete.
	if (normalized.includes('update job_assessment_attempts set status =')) {
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

beforeEach(() => {
	scenario = 'pass';
	appUpdates = [];
	notificationInserts = [];
	attemptUpdates = [];
});

describe('Task 4a — score is written to the application', () => {
	it('manual score path writes assessment_score + assessment_result to job_applications', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/score')
			.set('x-test-user-id', '2')
			.send({ attemptId: 301 });

		expect(res.status).toBe(200);
		expect(appUpdates).toHaveLength(1);
		const params = appUpdates[0].params;
		// composite 80% recorded…
		expect(params).toContain(80);
		// …with a pass mark, targeting application 100.
		expect(params).toContain('pass');
		expect(params[params.length - 1]).toBe(100);
	});
});

describe('Task 4b — auto-advance per passing_score', () => {
	it('composite >= passing_score advances screening → shortlisted', async () => {
		scenario = 'pass';
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/score')
			.set('x-test-user-id', '2')
			.send({ attemptId: 301 });

		expect(res.status).toBe(200);
		expect(appUpdates).toHaveLength(1);
		expect(appUpdates[0].sql).toContain("'shortlisted'");
	});

	it('composite < passing_score marks fail WITHOUT moving the stage', async () => {
		scenario = 'fail';
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/score')
			.set('x-test-user-id', '2')
			.send({ attemptId: 301 });

		expect(res.status).toBe(200);
		expect(appUpdates).toHaveLength(1);
		const params = appUpdates[0].params;
		expect(params).toContain('fail');
		expect(params).toContain(40);
		// No stage move: neither shortlisted nor rejected is written.
		expect(appUpdates[0].sql).not.toContain('shortlisted');
		expect(appUpdates[0].sql).not.toContain('rejected');
	});

	it('an application outside screening keeps its stage (score still recorded)', async () => {
		scenario = 'wrong-stage';
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/score')
			.set('x-test-user-id', '2')
			.send({ attemptId: 301 });

		expect(res.status).toBe(200);
		expect(appUpdates).toHaveLength(1);
		const params = appUpdates[0].params;
		expect(params).toContain(80);
		expect(params).toContain('pass');
		expect(appUpdates[0].sql).not.toContain('shortlisted');
		expect(appUpdates[0].sql).not.toContain('rejected');
	});
});

describe('Task 4c — async completion notifies the recruiter', () => {
	it('final answer → async scoring → assessment_completed notification + score write', async () => {
		scenario = 'async';
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/answer')
			.set('x-test-user-id', '7')
			.send({ attemptId: 301, questionId: 1, answer: 'a', timeTaken: 30 });

		expect(res.status).toBe(200);
		expect(res.body.completed).toBe(true);

		// scoreAttempt is fire-and-forget on this path; wait for it.
		const deadline = Date.now() + 5000;
		while (notificationInserts.length === 0 && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 50));
		}

		const completed = notificationInserts.filter((p) => p[1] === 'assessment_completed');
		expect(completed).toHaveLength(1);
		expect(completed[0][0]).toBe(2); // recruiter Rita
		expect(appUpdates.length).toBeGreaterThan(0);
		expect(appUpdates[0].params).toContain(80);
	}, 15000);
});

describe('Task 4 — idempotency (I1)', () => {
	it('scoring an already-scored attempt is a no-op: no re-score, no second notification', async () => {
		scenario = 'already-scored';
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/score')
			.set('x-test-user-id', '2')
			.send({ attemptId: 301 });

		expect(res.status).toBe(200);
		// The scoring chain must not re-run…
		expect(attemptUpdates).toHaveLength(0);
		// …the application must not be written again…
		expect(appUpdates).toHaveLength(0);
		// …and the recruiter must not get a second assessment_completed ping.
		const completed = notificationInserts.filter((p) => p[1] === 'assessment_completed');
		expect(completed).toHaveLength(0);
	});

	it('a failed scoring run (scored_at NULL) still retries the full chain', async () => {
		scenario = 'pass'; // scoredAttempt() has no scored_at — a never-scored attempt
		const app = buildApp();
		const res = await request(app)
			.post('/api/assessments/job-assessment/55/score')
			.set('x-test-user-id', '2')
			.send({ attemptId: 301 });

		expect(res.status).toBe(200);
		// Scoring ran: scores saved, application written, recruiter notified.
		expect(attemptUpdates).toHaveLength(1);
		expect(appUpdates).toHaveLength(1);
		const completed = notificationInserts.filter((p) => p[1] === 'assessment_completed');
		expect(completed).toHaveLength(1);
	});
});
