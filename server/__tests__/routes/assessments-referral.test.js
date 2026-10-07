/**
 * Issue #349, task 1 — referral assessment links.
 *
 * POST /api/assessments/:id/refer  — recruiter creates a referral link
 * POST /api/assessments/refer/claim — candidate claims it after signup/login
 * GET  /api/assessments/refer/:token/preview — public preview (no auth)
 *
 * Security properties pinned here:
 * - raw token never stored (sha256 only), returned once at creation
 * - claim requires email match (links aren't transferable)
 * - single claim enforced atomically; re-claim by same user is idempotent
 * - preview never leaks correct_answer / rubric / explanation / question text
 */
const express = require('express');
const request = require('supertest');
const crypto = require('node:crypto');

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

// Referral endpoints don't touch AI.
jest.mock('../../../lib/polsia-ai', () => ({
	chat: jest.fn(),
	handleAIError: jest.fn(),
	safeParseJSON: jest.fn(),
}));

global.__testUsers = {
	2: { id: 2, role: 'recruiter', company_id: 5, name: 'Rita Recruiter', email: 'rita@acme.test' },
	7: { id: 7, role: 'candidate', company_id: null, name: 'Asha Candidate', email: 'asha@example.test' },
	8: { id: 8, role: 'candidate', company_id: null, name: 'Bob Candidate', email: 'bob@example.test' },
};

const RAW_TOKEN = 'a'.repeat(64);
const TOKEN_HASH = crypto.createHash('sha256').update(RAW_TOKEN).digest('hex');

// Scenario switches, reset per test.
let scenario = 'ok';
let referralInserts = [];
let referralUpdates = [];
let applicationInserts = [];
let attemptInserts = [];

const PUBLISHED_ASSESSMENT = {
	id: 55,
	job_id: 11,
	title: 'Backend Engineer Assessment',
	status: 'published',
	time_limit_minutes: 45,
	passing_score: 70,
};

const db = require('../../../lib/db');
db.query.mockImplementation(async (sql, params = []) => {
	const normalized = String(sql).toLowerCase().replace(/\s+/g, ' ');

	if (['begin', 'commit', 'rollback'].includes(normalized)) {
		return { rows: [], rowCount: 0 };
	}

	// --- refer: assessment lookup (must be published, recruiter's company) ---
	if (
		normalized.includes('from job_assessments') &&
		normalized.includes('join jobs') &&
		normalized.includes('where ja.id = $1')
	) {
		if (scenario === 'draft') {
			return { rows: [], rowCount: 0 }; // WHERE status='published' filters it out
		}
		if (scenario === 'no-assessment') {
			return { rows: [], rowCount: 0 };
		}
		return { rows: [PUBLISHED_ASSESSMENT], rowCount: 1 };
	}

	// --- refer: insert referral ---
	if (normalized.includes('insert into assessment_referrals')) {
		referralInserts.push({ sql, params });
		return {
			rows: [{ id: 900, due_date: params[4] || new Date(Date.now() + 30 * 864e5).toISOString() }],
			rowCount: 1,
		};
	}

	// --- claim/preview: referral lookup by token hash ---
	if (
		normalized.includes('from assessment_referrals') &&
		normalized.includes('token_hash = $1')
	) {
		if (scenario === 'unknown-token') return { rows: [], rowCount: 0 };
		const row = {
			id: 900,
			job_assessment_id: 55,
			email: 'asha@example.test',
			token_hash: TOKEN_HASH,
			created_by: 2,
			due_date:
				scenario === 'expired'
					? new Date(Date.now() - 864e5).toISOString()
					: new Date(Date.now() + 30 * 864e5).toISOString(),
			claimed_by_user_id: scenario === 'claimed-by-other' ? 8 : scenario === 'claimed-by-self' ? 7 : null,
			claimed_at: null,
			// preview query fields
			title: 'Backend Engineer Assessment',
			description: 'Test your backend skills',
			status: 'published',
			time_limit_minutes: 45,
			job_title: 'Backend Engineer',
			company_id: 5,
			company_name: 'Acme Inc',
		};
		return { rows: [row], rowCount: 1 };
	}

	// --- claim: atomic claim update ---
	if (normalized.includes('update assessment_referrals set claimed_by_user_id')) {
		referralUpdates.push({ sql, params });
		if (scenario === 'claimed-by-other') return { rows: [], rowCount: 0 };
		return { rows: [{ id: 900 }], rowCount: 1 };
	}

	// --- claim: get job company for application creation ---
	if (normalized.includes('select company_id from jobs where id = $1')) {
		return { rows: [{ company_id: 5 }], rowCount: 1 };
	}

	// --- claim: find existing application ---
	if (
		normalized.includes('from job_applications') &&
		normalized.includes('where job_id = $1 and candidate_id = $2')
	) {
		if (scenario === 'existing-application' || scenario === 'claimed-by-self') {
			return { rows: [{ id: 100, job_id: 11, candidate_id: 7, status: 'applied' }], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	}

	// --- claim: create application ---
	if (normalized.includes('insert into job_applications')) {
		applicationInserts.push({ sql, params });
		return { rows: [{ id: 101, job_id: 11, candidate_id: 7, status: 'applied' }], rowCount: 1 };
	}

	// --- claim: find existing attempt ---
	if (
		normalized.includes('from job_assessment_attempts') &&
		normalized.includes('where assessment_id = $1 and candidate_id = $2')
	) {
		if (scenario === 'existing-in-progress') {
			return {
				rows: [{ id: 301, assessment_id: 55, candidate_id: 7, status: 'in_progress' }],
				rowCount: 1,
			};
		}
		if (scenario === 'existing-completed') {
			return {
				rows: [{ id: 302, assessment_id: 55, candidate_id: 7, status: 'completed', composite_score: 85 }],
				rowCount: 1,
			};
		}
		if (scenario === 'claimed-by-self') {
			return {
				rows: [{ id: 303, assessment_id: 55, candidate_id: 7, status: 'assigned' }],
				rowCount: 1,
			};
		}
		return { rows: [], rowCount: 0 };
	}

	// --- claim: create attempt ---
	if (normalized.includes('insert into job_assessment_attempts')) {
		attemptInserts.push({ sql, params });
		return { rows: [{ id: 303, assessment_id: 55, candidate_id: 7, status: 'assigned' }], rowCount: 1 };
	}

	// --- preview: assessment + job + company ---
	if (
		normalized.includes('from job_assessments ja') &&
		normalized.includes('join jobs j on j.id = ja.job_id')
	) {
		return {
			rows: [
				{
					id: 55,
					title: 'Backend Engineer Assessment',
					description: 'Test your backend skills',
					status: 'published',
					time_limit_minutes: 45,
					job_title: 'Backend Engineer',
					company_name: 'Acme Inc',
					company_id: 5,
				},
			],
			rowCount: 1,
		};
	}

	// --- preview: distinct categories ---
	if (
		normalized.includes('from job_assessment_questions') &&
		normalized.includes('distinct category')
	) {
		return { rows: [{ category: 'technical' }, { category: 'behavioral' }], rowCount: 2 };
	}

	// --- preview: question count ---
	if (
		normalized.includes('from job_assessment_questions') &&
		normalized.includes('count(*)')
	) {
		return { rows: [{ count: '15' }], rowCount: 1 };
	}

	// --- preview: trust score (cheap read) ---
	if (normalized.includes('from trust_scores') && normalized.includes('where company_id = $1')) {
		return { rows: [{ total_score: 82, score_tier: 'good' }], rowCount: 1 };
	}

	throw new Error(`Unhandled query in referral test mock: ${sql.slice(0, 120)}`);
});

const app = express();
app.use(express.json());
const assessmentsRouter = require('../../../routes/assessments');
app.use('/api/assessments', assessmentsRouter);

function resetState() {
	scenario = 'ok';
	referralInserts = [];
	referralUpdates = [];
	applicationInserts = [];
	attemptInserts = [];
}

beforeEach(resetState);

describe('POST /api/assessments/:id/refer', () => {
	it('creates a referral and returns the URL, storing only the hash', async () => {
		const res = await request(app)
			.post('/api/assessments/55/refer')
			.set('x-test-user-id', '2')
			.send({ email: 'asha@example.test' });

		expect(res.status).toBe(200);
		expect(res.body.referral_url).toMatch(/^\/r\/[a-f0-9]{64}$/);
		expect(res.body.expires_at).toBeTruthy();

		// Only the sha256 hash is stored — never the raw token.
		expect(referralInserts).toHaveLength(1);
		const storedHash = referralInserts[0].params[2];
		expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
		expect(storedHash).not.toBe(res.body.referral_url.split('/r/')[1]);
		expect(
			crypto.createHash('sha256').update(res.body.referral_url.split('/r/')[1]).digest('hex'),
		).toBe(storedHash);
	});

	it('rejects non-recruiters with 403', async () => {
		const res = await request(app)
			.post('/api/assessments/55/refer')
			.set('x-test-user-id', '7')
			.send({ email: 'asha@example.test' });
		expect(res.status).toBe(403);
	});

	it('rejects invalid email with 400', async () => {
		const res = await request(app)
			.post('/api/assessments/55/refer')
			.set('x-test-user-id', '2')
			.send({ email: 'not-an-email' });
		expect(res.status).toBe(400);
	});

	it('rejects unpublished assessments with 404', async () => {
		scenario = 'draft';
		const res = await request(app)
			.post('/api/assessments/55/refer')
			.set('x-test-user-id', '2')
			.send({ email: 'asha@example.test' });
		expect(res.status).toBe(404);
	});

	it('accepts a custom due_date', async () => {
		const due = new Date(Date.now() + 7 * 864e5).toISOString();
		const res = await request(app)
			.post('/api/assessments/55/refer')
			.set('x-test-user-id', '2')
			.send({ email: 'asha@example.test', due_date: due });
		expect(res.status).toBe(200);
		expect(new Date(res.body.expires_at).getTime()).toBeGreaterThan(Date.now());
	});
});

describe('POST /api/assessments/refer/claim', () => {
	it('happy path: creates application + assigned attempt for a new user', async () => {
		const res = await request(app)
			.post('/api/assessments/refer/claim')
			.set('x-test-user-id', '7')
			.send({ token: RAW_TOKEN });

		expect(res.status).toBe(200);
		expect(res.body.application_id).toBe(101);
		expect(res.body.attempt_id).toBe(303);
		expect(res.body.status).toBe('assigned');
		expect(res.body.redirect_url).toBe('/candidate/job-assessment/55');

		expect(applicationInserts).toHaveLength(1);
		expect(attemptInserts).toHaveLength(1);
		expect(referralUpdates).toHaveLength(1); // atomic claim
	});

	it('re-claim by the same user is idempotent (no duplicates)', async () => {
		scenario = 'claimed-by-self';
		const res = await request(app)
			.post('/api/assessments/refer/claim')
			.set('x-test-user-id', '7')
			.send({ token: RAW_TOKEN });

		expect(res.status).toBe(200);
		expect(applicationInserts).toHaveLength(0);
		expect(attemptInserts).toHaveLength(0);
	});

	it('reuses an existing application instead of creating a duplicate', async () => {
		scenario = 'existing-application';
		const res = await request(app)
			.post('/api/assessments/refer/claim')
			.set('x-test-user-id', '7')
			.send({ token: RAW_TOKEN });

		expect(res.status).toBe(200);
		expect(res.body.application_id).toBe(100);
		expect(applicationInserts).toHaveLength(0);
	});

	it('resumes an existing in-progress attempt', async () => {
		scenario = 'existing-in-progress';
		const res = await request(app)
			.post('/api/assessments/refer/claim')
			.set('x-test-user-id', '7')
			.send({ token: RAW_TOKEN });

		expect(res.status).toBe(200);
		expect(res.body.attempt_id).toBe(301);
		expect(res.body.status).toBe('in_progress');
		expect(attemptInserts).toHaveLength(0);
	});

	it('returns a completed attempt with its score (no new attempt)', async () => {
		scenario = 'existing-completed';
		const res = await request(app)
			.post('/api/assessments/refer/claim')
			.set('x-test-user-id', '7')
			.send({ token: RAW_TOKEN });

		expect(res.status).toBe(200);
		expect(res.body.attempt_id).toBe(302);
		expect(res.body.status).toBe('completed');
		expect(attemptInserts).toHaveLength(0);
	});

	it('rejects mismatched email with 403 (links are not transferable)', async () => {
		const res = await request(app)
			.post('/api/assessments/refer/claim')
			.set('x-test-user-id', '8') // bob, referral is for asha
			.send({ token: RAW_TOKEN });
		expect(res.status).toBe(403);
	});

	it('returns 404 for unknown token', async () => {
		scenario = 'unknown-token';
		const res = await request(app)
			.post('/api/assessments/refer/claim')
			.set('x-test-user-id', '7')
			.send({ token: RAW_TOKEN });
		expect(res.status).toBe(404);
	});

	it('returns 410 for expired referral', async () => {
		scenario = 'expired';
		const res = await request(app)
			.post('/api/assessments/refer/claim')
			.set('x-test-user-id', '7')
			.send({ token: RAW_TOKEN });
		expect(res.status).toBe(410);
	});

	it('returns 409 when claimed by a different user', async () => {
		scenario = 'claimed-by-other';
		const res = await request(app)
			.post('/api/assessments/refer/claim')
			.set('x-test-user-id', '7')
			.send({ token: RAW_TOKEN });
		expect(res.status).toBe(409);
	});

	it('requires authentication', async () => {
		const res = await request(app).post('/api/assessments/refer/claim').send({ token: RAW_TOKEN });
		expect(res.status).toBe(401);
	});
});

describe('GET /api/assessments/refer/:token/preview', () => {
	it('returns sanitized preview data without auth', async () => {
		const res = await request(app).get(`/api/assessments/refer/${RAW_TOKEN}/preview`);

		expect(res.status).toBe(200);
		expect(res.body.job_title).toBe('Backend Engineer');
		expect(res.body.company_name).toBe('Acme Inc');
		expect(res.body.dimensions).toEqual(['technical', 'behavioral']);
		expect(res.body.question_count).toBe(15);
		expect(res.body.time_limit_minutes).toBe(45);

		// Never leak answer material.
		const body = JSON.stringify(res.body);
		expect(body).not.toMatch(/correct_answer/);
		expect(body).not.toMatch(/rubric/);
		expect(body).not.toMatch(/explanation/);
		expect(body).not.toMatch(/What is a closure/);
	});

	it('returns 404 for unknown token', async () => {
		scenario = 'unknown-token';
		const res = await request(app).get(`/api/assessments/refer/${RAW_TOKEN}/preview`);
		expect(res.status).toBe(404);
	});

	it('returns 410 for expired referral', async () => {
		scenario = 'expired';
		const res = await request(app).get(`/api/assessments/refer/${RAW_TOKEN}/preview`);
		expect(res.status).toBe(410);
	});
});
