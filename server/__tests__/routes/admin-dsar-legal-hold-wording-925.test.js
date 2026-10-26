/**
 * #925 — DSAR fulfil hold wording: when the hold LOOKUP itself failed
 * (LegalHoldError with holdId null), the response must NOT claim a
 * verified "legal hold active". Lex-confirmed precaution wording
 * (STOP 1 on #925). Verified-hold (holdId != null) wording is pinned
 * unchanged.
 *
 * Harness shape mirrors admin-dsar-fulfillment.test.js; erasePersonalData
 * is mocked at the module boundary to throw the typed error exactly as
 * the real erasure gate does (lib/erasureService.js: holdLookupFailed →
 * LegalHoldError { holdId: null }).
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => ({
	verifyToken: jest.fn(() => null),
	authMiddleware: jest.fn((_req, _res, next) => next()),
	requireRole: () => (_req, _res, next) => next(),
	hashPassword: jest.fn(async () => 'hash'),
}));
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
	connect: jest.fn(),
}));
jest.mock('../../../lib/erasureService', () => ({
	erasePersonalData: jest.fn(),
	deleteErasedStorageFiles: jest.fn().mockResolvedValue({ deleted: 0, failed: 0, failures: [] }),
}));
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: { log: jest.fn() },
}));
jest.mock('../../../lib/distributed-rate-limiter', () => {
	const passthrough = jest.fn((_req, _res, next) => next());
	return {
		rateLimits: { strict: passthrough, admin: passthrough },
		distributedRateLimiter: { checkLimit: jest.fn() },
	};
});
jest.mock('../../../lib/activity-logger', () => ({ logAuthEvent: jest.fn() }));
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
		recordLegalHoldConflict: jest.fn(async () => ({})),
		listHolds: jest.fn(async () => []),
		placeHold: jest.fn(async () => ({})),
		releaseHold: jest.fn(async () => ({})),
	};
});

const pool = require('../../../lib/db');
const { erasePersonalData } = require('../../../lib/erasureService');
const legalHold = require('../../../lib/legalHold');
const adminRoutes = require('../../../routes/admin');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.session = {
			isAdmin: true,
			lastAdminActivity: new Date().toISOString(),
			adminLoginAt: new Date().toISOString(),
		};
		req.user = { id: 99, role: 'admin' };
		next();
	});
	app.use('/api/admin', adminRoutes);
	return app;
}

const PENDING_DELETION = {
	id: 10,
	user_id: 7,
	request_type: 'deletion',
	status: 'pending',
	requested_at: new Date('2026-10-01T10:00:00Z'),
	processed_at: null,
	processed_by: null,
	export_url: null,
	notes: 'Awaiting compliance review',
	metadata: {},
	company_id: 3,
};

function setup(holdId) {
	jest.clearAllMocks();
	legalHold.recordLegalHoldConflict.mockResolvedValue({});
	pool.query.mockResolvedValue({ rows: [], rowCount: 1 });
	pool.query.mockResolvedValueOnce({ rows: [PENDING_DELETION] });
	const client = { query: jest.fn().mockResolvedValue({ rowCount: 1 }), release: jest.fn() };
	pool.connect.mockResolvedValueOnce(client);
	erasePersonalData.mockRejectedValueOnce(
		new legalHold.LegalHoldError('erasure blocked', { userId: 7, holdId }),
	);
	return client;
}

function conflictNote() {
	const call = pool.query.mock.calls.find(
		([sql, params]) => /UPDATE data_requests SET notes/.test(sql) && params,
	);
	return call ? call[1][0] : null;
}

describe('#925 DSAR fulfil: verified hold vs lookup failure wording', () => {
	test('VERIFIED hold: 409 wording + conflict note are the original "legal hold active" text (pinned, unchanged)', async () => {
		setup(5);
		const res = await request(makeApp())
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.expect(409);

		expect(res.body.error).toBe(
			'Legal hold active: this erasure cannot proceed while the subject is under a legal hold ' +
				'(GDPR Art. 17(3)(e)). The conflict has been recorded; release the hold and re-fulfil.',
		);
		expect(legalHold.recordLegalHoldConflict).toHaveBeenCalledWith(
			expect.objectContaining({ holdId: 5, source: 'dsar_fulfillment' }),
		);
		expect(conflictNote()).toMatch(/active legal hold on the subject/);
	});

	test('VERIFIED hold + audit write fails: 500 wording is the original text (pinned, unchanged)', async () => {
		setup(5);
		legalHold.recordLegalHoldConflict.mockRejectedValue(new Error('audit trail down'));
		const res = await request(makeApp())
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.expect(500);

		expect(res.body.error).toBe(
			'Legal hold active: erasure was NOT performed, but the conflict could not be recorded ' +
				'in the compliance audit trail. Retry the fulfilment so the conflict can be recorded.',
		);
	});

	test('LOOKUP FAILURE (holdId null): 409 answers the precaution wording — no hold asserted, no Art. 17(3)(e)', async () => {
		const client = setup(null);
		const res = await request(makeApp())
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.expect(409);

		expect(res.body.error).toBe(
			'Erasure refused as a precaution: legal hold status could not be verified. ' +
				'Erasure was NOT performed. The conflict has been recorded; verify hold status and re-fulfil.',
		);
		expect(res.body.error).not.toMatch(/Legal hold active/i);
		expect(res.body.error).not.toMatch(/17\(3\)\(e\)/);
		expect(legalHold.recordLegalHoldConflict).toHaveBeenCalledWith(
			expect.objectContaining({ holdId: null, source: 'dsar_fulfillment' }),
		);
		const statements = client.query.mock.calls.map(([sql]) => sql);
		expect(statements).toContain('ROLLBACK');
		const note = conflictNote();
		expect(note).toMatch(/legal hold status could not be verified/);
		expect(note).toMatch(/erasure NOT performed as a precaution/);
		expect(note).not.toMatch(/active legal hold/i);
	});

	test('LOOKUP FAILURE (holdId null) + audit write fails: 500 answers the precaution wording', async () => {
		setup(null);
		legalHold.recordLegalHoldConflict.mockRejectedValue(new Error('audit trail down'));
		const res = await request(makeApp())
			.post('/api/admin/compliance/data-requests/10/fulfill')
			.expect(500);

		expect(res.body.error).toBe(
			'Erasure refused as a precaution: legal hold status could not be verified, and the conflict ' +
				'could not be recorded in the compliance audit trail. Erasure was NOT performed. ' +
				'Retry the fulfilment so the conflict can be recorded.',
		);
		expect(res.body.error).not.toMatch(/Legal hold active/i);
	});
});
