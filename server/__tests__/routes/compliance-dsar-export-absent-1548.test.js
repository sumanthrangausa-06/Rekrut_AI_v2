/**
 * #1548: Admin DSAR export of a non-existent user must return a clean
 * 404 — not a 500 from the data_requests FK violation.
 *
 * Quinn's HL-003 evidence on #1547 (leg3): an admin exporting userId
 * 999999 got HTTP 500 {"error":"Export failed"}; the server log pins
 * PG 23503 on data_requests_user_id_fkey at the INSERT that follows
 * AuditLogger.log. The handler never checks that the target exists:
 * canAccessUserRecord authorises an admin for ANY id, the bundle is
 * built with user: null (#1544), and the first FK-keyed write throws.
 *
 * Team contract (Lead/Rex/Lex, STOP 1 on #1548): 404
 * {error: 'User not found'} when the target user does not exist,
 * checked BEFORE AuditLogger.log and the data_requests insert — no
 * audit/request rows are attempted for absent targets (audit_logs.user_id
 * carries the same FK; AuditLogger.log swallows its failure, so the
 * ordering pin below is what keeps phantom writes from being attempted
 * at all). No existence oracle: non-admins get 403 from
 * canAccessUserRecord before any DB lookup.
 *
 * Harness follows the #1533/#1537 suite: the REAL route runs; only the
 * pool boundary is mocked. The mock models the real FK: an INSERT into
 * data_requests for a user with no users row throws PG 23503 exactly as
 * Postgres does — so on pre-fix code this suite sees the production
 * 500, not an artificial 200. The HL-003 dev E2E (real DB, real HTTP)
 * is Quinn's gate after independent review; it is not replaced here.
 */
const express = require('express');
const request = require('supertest');

// Configurable caller: 'admin' | 'candidate' | 'none' (unauthenticated —
// the real authMiddleware answers 401 without calling next).
let mockCaller = 'admin';
jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((req, res, next) => {
		if (mockCaller === 'none') {
			return res.status(401).json({ error: 'Authentication required' });
		}
		req.user =
			mockCaller === 'admin' ? { id: 1, role: 'admin' } : { id: 7, role: 'candidate' };
		return next();
	}),
}));

jest.mock('../../../lib/db', () => ({ query: jest.fn() }));

const mockAuditLog = jest.fn(async () => {});
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: {
		log: (...args) => mockAuditLog(...args),
		query: jest.fn(async () => []),
		exportLogs: jest.fn(async () => []),
	},
	logEvent: jest.fn(async () => ({})),
	getAuditTrail: jest.fn(async () => ({ rows: [] })),
	getCandidateDecisions: jest.fn(async () => []),
	verifyChain: jest.fn(async () => ({})),
	exportForRegulator: jest.fn(async () => ({})),
	EVENT_TYPES: { AI_DECISION: 'ai_decision', STATUS_CHANGE: 'status_change' },
	ENTITY_TYPES: { CANDIDATE: 'candidate', JOB: 'job' },
}));

jest.mock('../../../services/euComplianceService', () => ({}));

const pool = require('../../../lib/db');
const complianceRoutes = require('../../../routes/compliance');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/compliance', complianceRoutes);
	return app;
}

const ADMIN_ID = 1;
const EXISTING_ID = 7;
const ABSENT_ID = 999999;
const USER_ROW = { id: EXISTING_ID, email: 'subject@example.com', role: 'candidate' };
const PROFILE_ROW = { id: 31, user_id: EXISTING_ID, headline: 'Data Analyst' };

const seenCalls = [];
let dataRequestsInserts = [];

function installPoolMock() {
	pool.query.mockImplementation(async (sql, params) => {
		seenCalls.push({ sql, params });
		const s = sql.toLowerCase();
		if (s.includes('from users')) {
			// Only EXISTING_ID (and the admin's own row) exist.
			return { rows: params[0] === EXISTING_ID ? [USER_ROW] : [] };
		}
		if (s.includes('from candidate_profiles')) {
			return { rows: params[0] === EXISTING_ID ? [PROFILE_ROW] : [] };
		}
		if (s.includes('insert into data_requests')) {
			// Model the real FK (data_requests_user_id_fkey): Postgres
			// throws 23503 when user_id has no users row.
			if (params[0] !== EXISTING_ID && params[0] !== ADMIN_ID) {
				const err = new Error(
					'insert or update on table "data_requests" violates foreign key constraint "data_requests_user_id_fkey"',
				);
				err.code = '23503';
				throw err;
			}
			dataRequestsInserts.push(params[0]);
			return { rows: [] };
		}
		return { rows: [] };
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	mockCaller = 'admin';
	seenCalls.length = 0;
	dataRequestsInserts = [];
	installPoolMock();
});

describe('#1548 POST /gdpr/export — absent target user', () => {
	test('admin export of a non-existent user returns 404 User not found (not 500)', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: ABSENT_ID });
		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: 'User not found' });
	});

	test('absent target: no audit log and no data_requests insert are attempted', async () => {
		await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: ABSENT_ID });
		expect(mockAuditLog).not.toHaveBeenCalled();
		expect(seenCalls.some((c) => /insert into data_requests/i.test(c.sql))).toBe(false);
		expect(dataRequestsInserts).toEqual([]);
	});

	test('existing user: admin export still 200 with the exact 9-key bundle and both writes', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: EXISTING_ID });
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(Object.keys(res.body.data).sort()).toEqual([
			'assessments',
			'audit_trail',
			// #2028 item 4: the biometric section joins the bundle
			// (STOP 1 on #2028) — the pin grows by exactly that key.
			'biometric',
			'consents',
			'exported_at',
			'interviews',
			'omniscore',
			'profile',
			'user',
		]);
		expect(res.body.data.user).toEqual(USER_ROW);
		expect(mockAuditLog).toHaveBeenCalledTimes(1);
		expect(dataRequestsInserts).toEqual([EXISTING_ID]);
	});

	test('existing user: self export still 200 (success path unchanged)', async () => {
		mockCaller = 'candidate';
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: EXISTING_ID });
		expect(res.status).toBe(200);
		expect(res.body.data.user).toEqual(USER_ROW);
	});

	test('unauthenticated export is still 401', async () => {
		mockCaller = 'none';
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: EXISTING_ID });
		expect(res.status).toBe(401);
	});

	test('cross-user export is still 403 — the 404 check is not an existence oracle for non-admins', async () => {
		mockCaller = 'candidate';
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: ABSENT_ID });
		expect(res.status).toBe(403);
		// canAccessUserRecord rejects before any users lookup happens.
		expect(seenCalls.some((c) => /from users/i.test(c.sql))).toBe(false);
	});
});
