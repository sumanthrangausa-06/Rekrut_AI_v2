/**
 * #1550: Admin POST /gdpr/consent for a non-existent user must return a
 * clean 404 — not a 500 from the consent_records FK violation.
 *
 * Same defect class #1548 fixed for POST /gdpr/export (PR #1549): the
 * handler never checks that the target exists. canAccessUserRecord
 * authorises an admin for ANY id, and the handler INSERTs into
 * consent_records (user_id REFERENCES users(id), migration 013) — for
 * a non-existent userId Postgres throws 23503 and the catch returns
 * 500 {"error":"Failed to record consent"}. Worse than export: this is
 * a consent surface — a consent record for a non-existent subject must
 * never even be attempted.
 *
 * Team contract (Lead/Rex/Lex, mirrors #1548): 404
 * {error: 'User not found'} when the target user does not exist,
 * checked after canAccessUserRecord and the existing field validation,
 * BEFORE the consent_records insert and AuditLogger.log — no consent
 * or audit rows are attempted for absent targets. No existence oracle:
 * non-admins get 403 from canAccessUserRecord before any DB lookup, so
 * a cross-user absent id stays 403, not 404.
 *
 * Harness follows the #1548 suite: the REAL route runs; only the pool
 * boundary is mocked. The mock models the real FK: an INSERT into
 * consent_records for a user with no users row throws PG 23503 exactly
 * as Postgres does — so on pre-fix code this suite sees the production
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

const seenCalls = [];
let consentInserts = [];

function installPoolMock() {
	pool.query.mockImplementation(async (sql, params) => {
		seenCalls.push({ sql, params });
		const s = sql.toLowerCase();
		if (s.includes('from users')) {
			// Only EXISTING_ID (and the admin's own row) exist.
			return { rows: params[0] === EXISTING_ID ? [USER_ROW] : [] };
		}
		if (s.includes('insert into consent_records')) {
			// Model the real FK (consent_records.user_id REFERENCES
			// users(id), migration 013): Postgres throws 23503 when
			// user_id has no users row.
			if (params[0] !== EXISTING_ID && params[0] !== ADMIN_ID) {
				const err = new Error(
					'insert or update on table "consent_records" violates foreign key constraint "consent_records_user_id_fkey"',
				);
				err.code = '23503';
				throw err;
			}
			consentInserts.push(params[0]);
			return { rows: [{ id: 42 }] };
		}
		return { rows: [] };
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	mockCaller = 'admin';
	seenCalls.length = 0;
	consentInserts = [];
	installPoolMock();
});

const CONSENT_BODY = { consentType: 'data_processing', consented: true };

describe('#1550 POST /gdpr/consent — absent target user', () => {
	test('admin consent for a non-existent user returns 404 User not found (not 500)', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/consent')
			.send({ userId: ABSENT_ID, ...CONSENT_BODY });
		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: 'User not found' });
	});

	test('absent target: no consent insert and no audit log are attempted', async () => {
		await request(makeApp())
			.post('/api/compliance/gdpr/consent')
			.send({ userId: ABSENT_ID, ...CONSENT_BODY });
		expect(mockAuditLog).not.toHaveBeenCalled();
		expect(seenCalls.some((c) => /insert into consent_records/i.test(c.sql))).toBe(false);
		expect(consentInserts).toEqual([]);
	});

	test('existing user: admin consent still 200 with consentId and both writes', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/consent')
			.send({ userId: EXISTING_ID, ...CONSENT_BODY });
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ success: true, consentId: 42 });
		expect(mockAuditLog).toHaveBeenCalledTimes(1);
		expect(consentInserts).toEqual([EXISTING_ID]);
	});

	test('existing user: self consent still 200 (success path unchanged)', async () => {
		mockCaller = 'candidate';
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/consent')
			.send({ userId: EXISTING_ID, ...CONSENT_BODY });
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ success: true, consentId: 42 });
	});

	test('unauthenticated consent is still 401', async () => {
		mockCaller = 'none';
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/consent')
			.send({ userId: EXISTING_ID, ...CONSENT_BODY });
		expect(res.status).toBe(401);
	});

	test('cross-user consent is still 403 — and no users lookup happens', async () => {
		mockCaller = 'candidate';
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/consent')
			.send({ userId: ADMIN_ID, ...CONSENT_BODY });
		expect(res.status).toBe(403);
		expect(seenCalls.some((c) => /from users/i.test(c.sql))).toBe(false);
	});

	test('cross-user absent id is still 403 (not 404) — the 404 check is not an existence oracle for non-admins', async () => {
		mockCaller = 'candidate';
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/consent')
			.send({ userId: ABSENT_ID, ...CONSENT_BODY });
		expect(res.status).toBe(403);
		// canAccessUserRecord rejects before any users lookup happens.
		expect(seenCalls.some((c) => /from users/i.test(c.sql))).toBe(false);
	});
});
