/**
 * #2042 — Flow-A pin for Lex ruling 6544214902 (null `linkedin_data`,
 * including nested `userinfo.sub` / `me.id`, at the completion strip;
 * retention-until-gap-closure rejected).
 *
 * The GAP-G strip inside erasePersonalData already nulls
 * `linkedin_id` + `linkedin_data` together (pinned by
 * server/__tests__/lib/gap-g-erasure.test.js). The self-serve route's
 * OWN tombstone UPDATE in routes/auth.js historically nulled
 * `linkedin_id` but NOT `linkedin_data` — it was complete only because
 * erasePersonalData runs later in the same transaction. This suite
 * pins the route's tombstone UPDATE itself: the pair must be nulled
 * in the same statement, so the self-serve strip is self-complete and
 * the coupling is not a single point of failure (Scout scoping
 * 6544924753, adopted in the reconciliation on #2042).
 *
 * Mocked at the module boundary (same posture as
 * auth-delete-account-legal-hold.test.js): erasePersonalData is a
 * double here — the REAL coupling is proven by the companion real-DB
 * journey (auth-delete-account-linkedin-pair-realdb-2042.test.js).
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
	connect: jest.fn(),
}));
jest.mock('../../../lib/crypto-utils', () => ({
	encrypt: jest.fn((x) => x),
	decrypt: jest.fn((x) => x),
}));
jest.mock('../../../lib/erasureService', () => ({
	erasePersonalData: jest.fn(),
	deleteErasedStorageFiles: jest.fn().mockResolvedValue({ deleted: 0, failed: 0, failures: [] }),
}));
jest.mock('../../../lib/auth', () => {
	const bcryptInner = require('bcryptjs');
	return {
		generateToken: jest.fn(() => 'tok'),
		generateRefreshToken: jest.fn(async () => ({ token: 'rtok' })),
		rotateRefreshToken: jest.fn(),
		revokeAllTokens: jest.fn(async () => {}),
		authMiddleware: jest.fn((req, _res, next) => {
			req.user = {
				id: 7,
				role: 'candidate',
				company_id: null,
				password_hash: bcryptInner.hashSync('DeleteMe123!', 4),
			};
			next();
		}),
	};
});
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: { log: jest.fn(async () => {}) },
	logEvent: jest.fn(async () => ({ id: 'audit-1' })),
	EVENT_TYPES: { STATUS_CHANGE: 'status_change' },
	ENTITY_TYPES: { CANDIDATE: 'candidate', COMPANY: 'company', USER: 'user', RETENTION_PURGE: 'retention_purge' },
}));
jest.mock('../../../lib/distributed-rate-limiter', () => {
	const passthrough = jest.fn((_req, _res, next) => next());
	return { rateLimits: { strict: passthrough, admin: passthrough } };
});
jest.mock('../../../lib/email-service', () => ({}));
jest.mock('../../../lib/legalHold', () => {
	class LegalHoldError extends Error {
		constructor(message, details) {
			super(message);
			this.name = 'LegalHoldError';
			this.code = 'LEGAL_HOLD';
			this.status = 409;
			this.details = details;
		}
	}
	return {
		LegalHoldError,
		isHeld: jest.fn(async () => false),
		findActiveHold: jest.fn(async () => null),
		recordLegalHoldConflict: jest.fn(async () => ({})),
	};
});

const pool = require('../../../lib/db');
const { erasePersonalData } = require('../../../lib/erasureService');
const authRoutes = require('../../../routes/auth');

let client;

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/auth', authRoutes);
	return app;
}

beforeEach(() => {
	jest.clearAllMocks();
	client = { query: jest.fn(async () => ({ rows: [], rowCount: 1 })), release: jest.fn() };
	pool.connect.mockResolvedValue(client);
	erasePersonalData.mockResolvedValue({
		shredded: true,
		storageKeys: [],
		gapC: { nonPatternStorageUrls: [] },
		gapD: { nonPatternStorageUrls: [] },
	});
});

describe('#2042 DELETE /delete-account — tombstone UPDATE nulls the LinkedIn pair itself', () => {
	test('200 and the tombstone UPDATE sets linkedin_data = NULL alongside linkedin_id = NULL', async () => {
		const res = await request(makeApp())
			.delete('/api/auth/delete-account')
			.send({ password: 'DeleteMe123!' });

		expect(res.status).toBe(200);
		const tombstone = client.query.mock.calls
			.map((c) => c[0])
			.find((sql) => typeof sql === 'string' && /UPDATE users SET/i.test(sql) && /deleted_at/i.test(sql));
		expect(tombstone).toBeDefined();
		expect(tombstone).toMatch(/linkedin_id\s*=\s*NULL/i);
		expect(tombstone).toMatch(/linkedin_data\s*=\s*NULL/i);
		// The pair is nulled by the route itself, in the same statement
		// that tombstones the row — not left to a later coupling.
		expect(erasePersonalData).toHaveBeenCalledTimes(1);
	});
});
