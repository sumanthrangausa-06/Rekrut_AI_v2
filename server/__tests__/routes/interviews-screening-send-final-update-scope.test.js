/**
 * #923 — Screening-send final UPDATE must be self-defending.
 *
 * Origin: security review of PR #922 (observation 1, LOW). The final
 * `UPDATE job_applications ... WHERE id = $1` in POST /screening/send
 * carried no company predicate; it was safe only because the
 * company-scoped application lookup earlier in the handler guards it.
 * If a future edit reorders or removes that guard, the write would
 * mutate a foreign company's application.
 *
 * Contract under test:
 *  - The final UPDATE carries `AND company_id = $2`, bound to the
 *    caller's company (captured-call assertion).
 *  - Reorder simulation: the guarding application SELECT is mocked
 *    UNSCOPED (as if the guard had been removed/reordered away) while
 *    every other scope check still passes for the caller's own
 *    template/job — the handler reaches the final UPDATE against a
 *    foreign application, and the foreign row must stay unmutated.
 *  - Same-company send unchanged: own application still advances.
 *
 * Mocked tier: in-memory store behind the repo's mocked lib/db
 * (server/test/setup.js), same pattern as the #822/#929 suites.
 * Crucially the mock honours the UPDATE's company predicate exactly
 * as Postgres would: if the SQL carries the predicate and the stored
 * row's company differs from $2, the UPDATE affects 0 rows; without
 * the predicate it overwrites unconditionally (the pre-fix behaviour,
 * hence RED on unmodified code). The real end-to-end proof against
 * Postgres is Quinn's E2E-on-dev gate — this file is the regression
 * pin, not that proof.
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
const updateCalls = [];

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
		// REORDER SIMULATION: the guarding lookup is deliberately
		// UNSCOPED here — it returns the row regardless of company,
		// as if a future handler edit removed the guard. Only the
		// final UPDATE's own predicate can protect the write now.
		const row = applications.get(Number(params[0]));
		if (!row) return { rows: [], rowCount: 0 };
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
		updateCalls.push({ sql, params: [...params] });
		const row = applications.get(Number(params[0]));
		if (!row) return { rows: [], rowCount: 0 };
		// Honour the company predicate exactly as Postgres would.
		if (scoped && Number(row.company_id) !== Number(params[1])) {
			return { rows: [], rowCount: 0 };
		}
		row.screening_status = 'invited';
		if (row.status === 'applied') row.status = 'screening';
		return { rows: [], rowCount: 1 };
	}
	if (normalized.startsWith('insert into audit_logs')) {
		return { rows: [], rowCount: 1 };
	}
	if (normalized.startsWith('insert into notifications')) {
		return { rows: [], rowCount: 1 };
	}
	throw new Error(`unexpected SQL in screening-send final-update test mock: ${sql}`);
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

beforeEach(() => {
	templates.clear();
	jobs.clear();
	applications.clear();
	sessions.clear();
	updateCalls.length = 0;
	nextSessionId = 1;
	global.__testUsers = { 10: RECRUITER_A, 11: RECRUITER_B };

	templates.set(1, {
		id: 1, company_id: COMPANY_A, job_id: 10, title: 'A screening', topics: [], questions: [],
	});
	templates.set(2, {
		id: 2, company_id: COMPANY_B, job_id: 20, title: 'B screening', topics: [], questions: [],
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

describe('#923: screening-send final UPDATE is self-defending', () => {
	test('reordered/bypassed guard: cross-company final UPDATE cannot mutate the foreign application', async () => {
		// Company B recruiter, B's own template + job (those scope
		// checks pass), but A's application. The mocked guard lookup
		// no longer protects the write — only the UPDATE predicate can.
		const res = await sendAs(11, {
			template_id: 2, candidate_id: 1, application_id: 100, job_id: 20,
		});

		expect(res.status).toBe(200);
		const appRow = applications.get(100);
		expect(appRow.status).toBe('applied');
		expect(appRow.screening_status).toBe('pending');
	});

	test('the final UPDATE carries the company predicate bound to the caller company', async () => {
		const res = await sendAs(10, {
			template_id: 1, candidate_id: 1, application_id: 100, job_id: 10,
		});

		expect(res.status).toBe(200);
		expect(updateCalls).toHaveLength(1);
		const normalized = updateCalls[0].sql.toLowerCase().replace(/\s+/g, ' ');
		expect(normalized).toContain('company_id = $2');
		expect(updateCalls[0].params).toEqual([100, COMPANY_A]);
	});

	test('same-company send unchanged: own application still advanced by the scoped UPDATE', async () => {
		const res = await sendAs(10, {
			template_id: 1, candidate_id: 1, application_id: 100, job_id: 10,
		});

		expect(res.status).toBe(200);
		expect(sessions.size).toBe(1);
		const appRow = applications.get(100);
		expect(appRow.status).toBe('screening');
		expect(appRow.screening_status).toBe('invited');
	});
});
