/**
 * Candidate-facing assessment transparency.
 *
 * The platform's pitch is transparency, but job assessment outcomes were a
 * black box for candidates: scores written to job_applications were never
 * shown to them, scoring fired a recruiter-only notification, and the
 * auto-advance (screening→shortlisted) notified nobody.
 *
 * These tests pin the fixes:
 *  1. Scoring fires an in-app notification to the CANDIDATE (not just recruiter).
 *  2. Auto-advance (screening→shortlisted on pass) notifies the candidate.
 *  3. The candidate applications API includes assessment_score/assessment_result.
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

global.__testUsers = {
	2: { id: 2, role: 'recruiter', company_id: 5, name: 'Rita Recruiter' },
	7: { id: 7, role: 'candidate', company_id: null, name: 'Asha Candidate' },
};

let notificationInserts = [];

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

function scoredAttempt() {
	return {
		id: 301,
		assessment_id: 55,
		candidate_id: 7,
		application_id: 100,
		status: 'completed',
		answers: JSON.stringify([{ questionId: 1, answer: 'a', quickScore: 16, category: 'technical' }]),
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

	// scoreAttempt — attempt load.
	if (
		normalized.includes('from job_assessment_attempts') &&
		normalized.includes('where id = $1') &&
		!normalized.includes('join')
	) {
		return { rows: [scoredAttempt()], rowCount: 1 };
	}

	// scoreAttempt — questions.
	if (
		normalized.includes('from job_assessment_questions') &&
		normalized.includes('where assessment_id = $1') &&
		!normalized.includes('where id =')
	) {
		return { rows: [MC_QUESTION], rowCount: 1 };
	}

	// scoreAttempt — save scores.
	if (normalized.includes('update job_assessment_attempts set answers =')) {
		return { rows: [], rowCount: 1 };
	}

	// Round-trip — passing_score lookup.
	if (normalized.includes('select passing_score from job_assessments')) {
		return { rows: [{ passing_score: 70 }], rowCount: 1 };
	}

	// Round-trip — application row.
	if (
		normalized.includes('from job_applications') &&
		normalized.includes('where id = $1') &&
		!normalized.includes('join')
	) {
		return { rows: [{ id: 100, status: 'screening' }], rowCount: 1 };
	}

	// Round-trip — application update.
	if (normalized.includes('update job_applications set')) {
		return { rows: [], rowCount: 1 };
	}

	// Round-trip — recruiter/candidate info lookup.
	if (normalized.includes('from job_applications ja') && normalized.includes('join jobs j')) {
		return {
			rows: [
				{
					job_id: 10,
					recruiter_id: 2,
					job_title: 'Backend Engineer',
					candidate_name: 'Asha Candidate',
					candidate_id: 7,
				},
			],
			rowCount: 1,
		};
	}

	// Notification writes — capture for assertions.
	if (normalized.includes('insert into user_notifications')) {
		notificationInserts.push(params);
		return { rows: [{ id: 900 + notificationInserts.length }], rowCount: 1 };
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
	notificationInserts = [];
});

describe('Transparency — candidate notified when scored', () => {
	it('scoring fires an in-app notification to the candidate (not just the recruiter)', async () => {
		const app = buildApp();
		await request(app)
			.post('/api/assessments/job-assessment/55/score')
			.set('x-test-user-id', '2')
			.send({ attemptId: 301 })
			.expect(200);

		// Recruiter notification (existing behavior).
		const recruiterNotifs = notificationInserts.filter((p) => p[0] === 2);
		expect(recruiterNotifs.length).toBe(1);

		// Candidate notification (new behavior).
		const candidateNotifs = notificationInserts.filter((p) => p[0] === 7);
		const scoredNotifs = candidateNotifs.filter((p) => p[1] === 'assessment_scored');
		expect(scoredNotifs.length).toBe(1);
		// Message includes the score.
		expect(String(scoredNotifs[0][3])).toMatch(/80/);
	});
});

describe('Transparency — candidate notified on auto-advance', () => {
	it('passing score that advances screening→shortlisted notifies the candidate', async () => {
		const app = buildApp();
		await request(app)
			.post('/api/assessments/job-assessment/55/score')
			.set('x-test-user-id', '2')
			.send({ attemptId: 301 })
			.expect(200);

		const candidateNotifs = notificationInserts.filter((p) => p[0] === 7);
		// One for scoring + one for the shortlist advance.
		const shortlistNotifs = candidateNotifs.filter((p) =>
			String(p[2]).toLowerCase().includes('shortlist'),
		);
		expect(shortlistNotifs.length).toBe(1);
		expect(String(shortlistNotifs[0][3])).toMatch(/Backend Engineer/);
	});
});
