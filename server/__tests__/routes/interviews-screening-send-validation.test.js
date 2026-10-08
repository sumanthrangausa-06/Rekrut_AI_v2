/**
 * Bug fix: POST /screening/send must validate that candidate_id matches the
 * application when application_id is provided.
 *
 * Currently the endpoint accepts any candidate_id — a recruiter could send a
 * screening invite to the wrong candidate for an application, or a candidate_id
 * that doesn't own the application.
 *
 * Desired behavior: if application_id is provided, verify
 * job_applications.candidate_id matches the request's candidate_id.
 * Return 400 on mismatch.
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

jest.mock('../../../lib/notify', () => ({
	notifyUser: jest.fn(),
}));

const db = require('../../../lib/db');

const templates = new Map();
const jobs = new Map();
const applications = new Map();
const sessions = new Map();
let nextSessionId = 1;

function maybeParse(v) {
	if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
		try {
			return JSON.parse(v);
		} catch {
			return v;
		}
	}
	return v;
}

db.query.mockImplementation(async (sql, params = []) => {
	const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();

	// Application lookup for candidate validation
	if (normalized.includes('from job_applications where id =')) {
		const row = applications.get(Number(params[0]));
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from screening_templates where id =')) {
		const row = templates.get(Number(params[0]));
		const ok = row && Number(row.company_id) === Number(params[1]);
		return { rows: ok ? [{ ...row }] : [], rowCount: ok ? 1 : 0 };
	}
	if (normalized.includes('from jobs where id =')) {
		const row = jobs.get(Number(params[0]));
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from interview_sessions where application_id =')) {
		return { rows: [], rowCount: 0 };
	}
	if (normalized.includes('from interview_sessions') && normalized.includes('candidate_id =')) {
		return { rows: [], rowCount: 0 };
	}
	if (normalized.startsWith('insert into interview_sessions')) {
		const row = {
			id: nextSessionId++,
			type: params[0],
			job_id: params[1],
			application_id: params[2],
			candidate_id: params[3],
			company_id: params[4],
			config: maybeParse(params[7]),
		};
		sessions.set(row.id, row);
		return { rows: [{ ...row }], rowCount: 1 };
	}
	if (normalized.startsWith('update job_applications set')) {
		return { rows: [], rowCount: 1 };
	}
	if (normalized.startsWith('insert into audit_logs')) {
		return { rows: [], rowCount: 1 };
	}
	if (normalized.startsWith('insert into notifications')) {
		return { rows: [], rowCount: 1 };
	}
	throw new Error(`unexpected SQL in candidate-validation test mock: ${sql}`);
});

const interviewsRoutes = require('../../../routes/interviews');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/interviews', interviewsRoutes);
	return app;
}

beforeEach(() => {
	sessions.clear();
	nextSessionId = 1;
	templates.clear();
	jobs.clear();
	applications.clear();
	global.__testUsers = {
		1: { id: 1, company_id: 10, role: 'recruiter', email: 'rec@test.com' },
	};
	templates.set(1, { id: 1, company_id: 10, title: 'Template', job_id: 10, topics: [], questions: [] });
	jobs.set(10, { id: 10, title: 'Data Analyst', company_name: 'TestCo' });
	// Application 20 belongs to candidate 300
	applications.set(20, { id: 20, candidate_id: 300, job_id: 10 });
});

describe('POST /api/interviews/screening/send candidate validation', () => {
	test('returns 400 when candidate_id does not match the application', async () => {
		const res = await request(buildApp())
			.post('/api/interviews/screening/send')
			.set('x-test-user-id', '1')
			.send({ template_id: 1, candidate_id: 999, application_id: 20, job_id: 10 });

		expect(res.status).toBe(400);
		expect(res.body.error).toMatch(/candidate/i);
	});

	test('succeeds when candidate_id matches the application', async () => {
		const res = await request(buildApp())
			.post('/api/interviews/screening/send')
			.set('x-test-user-id', '1')
			.send({ template_id: 1, candidate_id: 300, application_id: 20, job_id: 10 });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	test('succeeds without application_id (no validation needed)', async () => {
		const res = await request(buildApp())
			.post('/api/interviews/screening/send')
			.set('x-test-user-id', '1')
			.send({ template_id: 1, candidate_id: 300, job_id: 10 });

		expect(res.status).toBe(200);
	});
});
