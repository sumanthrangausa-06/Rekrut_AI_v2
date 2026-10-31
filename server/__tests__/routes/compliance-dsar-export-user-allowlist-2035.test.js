/**
 * #2035 [SECURITY]: POST /gdpr/export must never include credential
 * material from the users row. On pre-fix code the handler runs
 * `SELECT * FROM users` and places the raw row in the bundle as
 * `user`, so `password_hash` (and the OAuth link keys / Stripe key)
 * serialise into every export — to the subject and to any admin
 * exporting another user.
 *
 * Fix contract (STOP 1 on #2035): the `user` section is projected
 * through an explicit 17-column allowlist at BOTH layers — an
 * explicit SQL column list (credential material never leaves the DB)
 * and a key-by-key JS projection `toExportSafeUser` beside the #927
 * precedent (a future column must not export by default; never a
 * spread, never delete-keys).
 *
 *   INCLUDE (17): id, email, name, role, title, company_name,
 *     company_id, github_username, avatar_url, linkedin_data,
 *     is_paid, subscription_plan, subscription_status, suspended_at,
 *     deleted_at, created_at, updated_at
 *   EXCLUDE (5): password_hash, google_id, linkedin_id,
 *     oauth_provider, stripe_subscription_id
 * (22 live users columns, enumerated from migrate.js + migrations
 * 002/005b/227/228/231 + the suspended_at SQL, and verified against
 * information_schema on a fresh migrated DB.)
 *
 * Harness follows the #1548/#2028 suites: the REAL route runs; only
 * the pool boundary (and auth) is mocked. The HL-003 real-DB journey
 * is the post-review gate; it is not replaced here.
 */
const express = require('express');
const request = require('supertest');

// Configurable caller: 'subject' | 'admin' | 'none'.
let mockCaller = 'subject';
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

jest.mock('../../../lib/biometricCrypto', () => ({
	encryptWithDEK: jest.fn(async () => ({})),
	decryptWithDEK: jest.fn(async () => Buffer.from('{}', 'utf8')),
	decryptWithExistingDEK: jest.fn(async () => Buffer.alloc(0)),
}));

const pool = require('../../../lib/db');
const complianceRoutes = require('../../../routes/compliance');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/compliance', complianceRoutes);
	return app;
}

const SUBJECT_ID = 7;
const ABSENT_ID = 999999;
const FOREIGN_ID = 8;

// Distinctive sentinels in every EXCLUDED column. If any of these
// strings appears anywhere in the serialised bundle, credential /
// link-key material leaked.
const SENTINELS = {
	password_hash: 'SENTINEL2035_PASSWORD_HASH_x1',
	google_id: 'SENTINEL2035_GOOGLE_ID_x2',
	linkedin_id: 'SENTINEL2035_LINKEDIN_ID_x3',
	oauth_provider: 'SENTINEL2035_OAUTH_PROVIDER_x4',
	stripe_subscription_id: 'SENTINEL2035_STRIPE_SUB_x5',
};
const EXCLUDED_KEYS = Object.keys(SENTINELS);

// The full 22-column users row, as SELECT * would return it.
const FULL_USER_ROW = {
	id: SUBJECT_ID,
	email: 'subject2035@example.com',
	password_hash: SENTINELS.password_hash,
	name: 'Subject Two Zero Three Five',
	role: 'candidate',
	company_name: 'Subject Co',
	github_username: 'subject-2035',
	avatar_url: 'https://example.com/avatar-2035.png',
	is_paid: true,
	stripe_subscription_id: SENTINELS.stripe_subscription_id,
	created_at: '2026-10-01T00:00:00.000Z',
	updated_at: '2026-10-20T00:00:00.000Z',
	company_id: 42,
	google_id: SENTINELS.google_id,
	linkedin_id: SENTINELS.linkedin_id,
	oauth_provider: SENTINELS.oauth_provider,
	suspended_at: null,
	linkedin_data: { headline: 'Data Analyst 2035', source: 'linkedin-import' },
	title: 'Data Analyst',
	subscription_plan: 'pro',
	subscription_status: 'active',
	deleted_at: null,
};

// Exactly the 17-key allowlist, with the seeded values.
const EXPECTED_USER = {
	id: SUBJECT_ID,
	email: 'subject2035@example.com',
	name: 'Subject Two Zero Three Five',
	role: 'candidate',
	title: 'Data Analyst',
	company_name: 'Subject Co',
	company_id: 42,
	github_username: 'subject-2035',
	avatar_url: 'https://example.com/avatar-2035.png',
	linkedin_data: { headline: 'Data Analyst 2035', source: 'linkedin-import' },
	is_paid: true,
	subscription_plan: 'pro',
	subscription_status: 'active',
	suspended_at: null,
	deleted_at: null,
	created_at: '2026-10-01T00:00:00.000Z',
	updated_at: '2026-10-20T00:00:00.000Z',
};

const PROFILE_ROW = { id: 31, user_id: SUBJECT_ID, headline: 'Data Analyst' };

const seenCalls = [];
function installPoolMock() {
	pool.query.mockImplementation(async (sql, params) => {
		seenCalls.push({ sql, params });
		const s = sql.toLowerCase();
		if (s.includes('from users')) {
			return { rows: params[0] === SUBJECT_ID ? [FULL_USER_ROW] : [] };
		}
		if (s.includes('from candidate_profiles')) {
			return { rows: params[0] === SUBJECT_ID ? [PROFILE_ROW] : [] };
		}
		return { rows: [] };
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	mockCaller = 'subject';
	seenCalls.length = 0;
	installPoolMock();
});

describe('#2035 POST /gdpr/export — user section allowlist', () => {
	test('sentinel: no excluded value appears anywhere in the serialised bundle (self export)', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const serialised = JSON.stringify(res.body);
		for (const value of Object.values(SENTINELS)) {
			expect(serialised).not.toContain(value);
		}
		for (const key of EXCLUDED_KEYS) {
			expect(res.body.data.user).not.toHaveProperty(key);
			expect(serialised).not.toContain(`"${key}"`);
		}
	});

	test('sentinel: admin export of another user is projected identically', async () => {
		mockCaller = 'admin';
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const serialised = JSON.stringify(res.body);
		for (const value of Object.values(SENTINELS)) {
			expect(serialised).not.toContain(value);
		}
		expect(res.body.data.user).toEqual(EXPECTED_USER);
	});

	test('legitimate fields: user section equals the 17-key allowlist with seeded values', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		expect(res.body.data.user).toEqual(EXPECTED_USER);
		expect(Object.keys(res.body.data.user).sort()).toEqual(
			Object.keys(EXPECTED_USER).sort(),
		);
	});

	test('SQL pin: the users query is an explicit column list — no SELECT *, no excluded columns', async () => {
		await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: SUBJECT_ID });
		const usersCall = seenCalls.find((c) => /from users/i.test(c.sql));
		expect(usersCall).toBeDefined();
		expect(usersCall.sql).not.toMatch(/select\s+\*/i);
		for (const key of EXCLUDED_KEYS) {
			expect(usersCall.sql.toLowerCase()).not.toContain(key);
		}
		expect(usersCall.sql.toLowerCase()).toContain('email');
		expect(usersCall.params).toEqual([SUBJECT_ID]);
	});

	test('non-existent user (admin) still returns 404', async () => {
		mockCaller = 'admin';
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: ABSENT_ID });
		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: 'User not found' });
	});

	test('foreign non-admin export still returns 403 before any users lookup', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: FOREIGN_ID });
		expect(res.status).toBe(403);
		expect(seenCalls.some((c) => /from users/i.test(c.sql))).toBe(false);
	});

	test('unauthenticated export is still 401', async () => {
		mockCaller = 'none';
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(401);
	});
});
