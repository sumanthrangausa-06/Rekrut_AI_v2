/**
 * S-098 (#822): POST /screening/send must company-scope the application
 * (and the resolved job) before creating a session or mutating anything.
 *
 * Root cause: the handler scoped only the template to the caller's company;
 * `application_id` was checked solely for candidate-match, never company
 * ownership — then the handler created a session under the caller's company
 * pointing at the foreign application and mutated that application
 * (screening_status / pipeline status). A non-existent application_id also
 * silently passed (rows.length > 0 guard) and produced a session with a
 * dangling reference, and the body `job_id` fallback was never checked.
 *
 * Desired behavior (STOP 1 plan on #822):
 * - Role gate: requireRole('admin','employer','recruiter','hiring_manager').
 * - Foreign application_id → 404, no session, foreign application untouched.
 * - Non-existent application_id → 404, no session.
 * - Foreign resolved job (body job_id fallback) → 404, no session.
 * - Same-company send unchanged: 200, session created, own application
 *   advanced, duplicate send still 409, candidate mismatch still 400.
 *
 * Mock note: the DB mock honours a `company_id` predicate when the SQL
 * carries one and ignores company when it does not — so against the
 * pre-fix (unscoped) handler these tests fail for the right reason
 * (200 + session + mutation), not for a mock artefact.
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
	// requireRole stays the REAL implementation — the gate under test.
	return { ...actual, authMiddleware };
});

jest.mock('../../../lib/notify', () => ({
	notifyUser: jest.fn(),
}));

const db = require('../../../lib/db');

const COMPANY_A = 5;
const COMPANY_B = 6;

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
	const scoped = normalized.includes('company_id');

	if (normalized.includes('from screening_templates where id =')) {
		const row = templates.get(Number(params[0]));
		const ok = row && Number(row.company_id) === Number(params[1]);
		return { rows: ok ? [{ ...row }] : [], rowCount: ok ? 1 : 0 };
	}
	if (normalized.includes('from job_applications where id =')) {
		const row = applications.get(Number(params[0]));
		if (!row) return { rows: [], rowCount: 0 };
		// Honour the company predicate only when the query carries one.
		if (scoped && Number(row.company_id) !== Number(params[1])) {
			return { rows: [], rowCount: 0 };
		}
		return { rows: [{ ...row }], rowCount: 1 };
	}
	if (normalized.includes('from jobs where id =')) {
		const row = jobs.get(Number(params[0]));
		if (!row) return { rows: [], rowCount: 0 };
		if (scoped && Number(row.company_id) !== Number(params[1])) {
			return { rows: [], rowCount: 0 };
		}
		return { rows: [{ ...row }], rowCount: 1 };
	}
	if (normalized.includes('from interview_sessions where application_id =')) {
		const rows = [...sessions.values()].filter(
			(s) => Number(s.application_id) === Number(params[0]) && s.type === 'screening',
		);
		return { rows: rows.map((r) => ({ ...r })), rowCount: rows.length };
	}
	if (normalized.includes('from interview_sessions') && normalized.includes('candidate_id =')) {
		const rows = [...sessions.values()].filter(
			(s) =>
				Number(s.candidate_id) === Number(params[0]) &&
				(params[1] == null
					? s.job_id == null
					: Number(s.job_id) === Number(params[1])) &&
				s.type === 'screening' &&
				s.status !== 'expired',
		);
		return { rows: rows.map((r) => ({ ...r })), rowCount: rows.length };
	}
	if (normalized.startsWith('insert into interview_sessions')) {
		const row = {
			id: nextSessionId++,
			type: params[0],
			job_id: params[1],
			application_id: params[2],
			candidate_id: params[3],
			company_id: params[4],
			triggered_by: params[5],
			invite_token: params[6],
			status: 'invited',
			config: maybeParse(params[7]),
		};
		sessions.set(row.id, row);
		return { rows: [{ ...row }], rowCount: 1 };
	}
	if (normalized.startsWith('update job_applications set')) {
		const row = applications.get(Number(params[0]));
		if (row) {
			row.screening_status = 'invited';
			if (row.status === 'applied') row.status = 'screening';
		}
		return { rows: [], rowCount: row ? 1 : 0 };
	}
	if (normalized.startsWith('insert into audit_logs')) {
		return { rows: [], rowCount: 1 };
	}
	if (normalized.startsWith('insert into notifications')) {
		return { rows: [], rowCount: 1 };
	}
	throw new Error(`unexpected SQL in screening-send company-scope test mock: ${sql}`);
});

const interviewsRoutes = require('../../../routes/interviews');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/interviews', interviewsRoutes);
	return app;
}

const RECRUITER_A = { id: 10, email: 'a@test.com', role: 'recruiter', company_id: COMPANY_A };
const RECRUITER_B = { id: 11, email: 'b@test.com', role: 'recruiter', company_id: COMPANY_B };
const CANDIDATE = { id: 12, email: 'c@test.com', role: 'candidate', company_id: COMPANY_A };

beforeEach(() => {
	templates.clear();
	jobs.clear();
	applications.clear();
	sessions.clear();
	nextSessionId = 1;
	global.__testUsers = { 10: RECRUITER_A, 11: RECRUITER_B, 12: CANDIDATE };

	templates.set(1, {
		id: 1, company_id: COMPANY_A, job_id: 10, title: 'A screening', topics: [], questions: [],
	});
	templates.set(2, {
		id: 2, company_id: COMPANY_B, job_id: 20, title: 'B screening', topics: [], questions: [],
	});
	templates.set(4, {
		id: 4, company_id: COMPANY_B, job_id: null, title: 'B no-job screening', topics: [], questions: [],
	});
	jobs.set(10, { id: 10, company_id: COMPANY_A, title: 'A Job', company_name: 'A Co' });
	jobs.set(20, { id: 20, company_id: COMPANY_B, title: 'B Job', company_name: 'B Co' });
	// Company A's application, candidate 1, still at 'applied'.
	applications.set(100, {
		id: 100,
		candidate_id: 1,
		job_id: 10,
		company_id: COMPANY_A,
		status: 'applied',
		screening_status: 'pending',
	});
});

function sendAs(userId, body) {
	return request(buildApp())
		.post('/api/interviews/screening/send')
		.set('x-test-user-id', String(userId))
		.send(body);
}

describe('S-098 (#822): POST /screening/send company scoping', () => {
	test('cross-company application_id → 404, no session, foreign application unchanged', async () => {
		const res = await sendAs(11, {
			template_id: 2, candidate_id: 1, application_id: 100, job_id: 20,
		});

		expect(res.status).toBe(404);
		expect(sessions.size).toBe(0);
		const appRow = applications.get(100);
		expect(appRow.status).toBe('applied');
		expect(appRow.screening_status).toBe('pending');
	});

	test('non-existent application_id → 404, no session created', async () => {
		const res = await sendAs(10, {
			template_id: 1, candidate_id: 1, application_id: 999, job_id: 10,
		});

		expect(res.status).toBe(404);
		expect(sessions.size).toBe(0);
	});

	test('candidate-role caller → 403 at the role gate, no session', async () => {
		const res = await sendAs(12, {
			template_id: 1, candidate_id: 1, application_id: 100, job_id: 10,
		});

		expect(res.status).toBe(403);
		expect(sessions.size).toBe(0);
		expect(applications.get(100).status).toBe('applied');
	});

	test('foreign job_id fallback (template without job_id) → 404, no session', async () => {
		const res = await sendAs(11, {
			template_id: 4, candidate_id: 1, job_id: 10,
		});

		expect(res.status).toBe(404);
		expect(sessions.size).toBe(0);
	});

	test('same-company send unchanged: 200, session created, own application advanced, duplicate 409', async () => {
		const res = await sendAs(10, {
			template_id: 1, candidate_id: 1, application_id: 100, job_id: 10,
		});

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(sessions.size).toBe(1);
		const session = [...sessions.values()][0];
		expect(session.company_id).toBe(COMPANY_A);
		expect(session.application_id).toBe(100);
		const appRow = applications.get(100);
		expect(appRow.status).toBe('screening');
		expect(appRow.screening_status).toBe('invited');

		const dup = await sendAs(10, {
			template_id: 1, candidate_id: 1, application_id: 100, job_id: 10,
		});
		expect(dup.status).toBe(409);
		expect(sessions.size).toBe(1);
	});

	test('candidate mismatch on own-company application still 400', async () => {
		const res = await sendAs(10, {
			template_id: 1, candidate_id: 999, application_id: 100, job_id: 10,
		});

		expect(res.status).toBe(400);
		expect(sessions.size).toBe(0);
	});
});
