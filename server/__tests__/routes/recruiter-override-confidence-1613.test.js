/**
 * #1613 — routes/recruiter.js human_override audit entries fabricate
 * ai_confidence 0.85 when no confidence was recorded (3 sites):
 *   PUT /applications/:id            (status change)
 *   PUT /applications/batch-status   (batch status change)
 *   PUT /offers/:id/send             (offer send)
 *
 * Same fabrication class as #1584 item 4. Honest behaviour (merged #1584
 * pattern, `?? null`): an unrecorded confidence is written as null; a
 * measured 0 survives as 0; a recorded value passes through unchanged.
 *
 * The tests drive the real route handlers with a mocked pool and capture
 * the AuditLogger.log payloads — the fabrication lives in the metadata
 * object handed to AuditLogger, so that is the layer asserted here.
 * Red on pristine dev: unrecorded confidence arrives as 0.85, and a
 * recorded 0 is also destroyed to 0.85 by `||`.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => {
	const passthrough = (_req, _res, next) => next();
	const authMiddleware = jest.fn((req, _res, next) => {
		req.user = { id: 99, role: 'recruiter', company_id: 5 };
		return next();
	});
	return {
		authMiddleware,
		requireRole: () => passthrough,
		requireApprovedRecruiter: passthrough,
		requireNotSuspended: passthrough,
		requireEmployer: passthrough,
		optionalAuth: passthrough,
	};
});
jest.mock('../../../middleware/rbac', () => ({
	requirePermission: () => (_req, _res, next) => next(),
}));
jest.mock('../../../services/trustscore', () => ({
	updateHiringRatioScore: jest.fn().mockResolvedValue(true),
	calculateTrustScore: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../../lib/notify', () => ({
	notifyUser: jest.fn().mockResolvedValue(1),
}));
jest.mock('../../../lib/email-service', () => ({
	sendTemplatedEmail: jest.fn().mockResolvedValue({}),
	sendCustomEmail: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../services/auditLogService', () => ({
	EVENT_TYPES: {
		AI_DECISION: 'ai_decision',
		HUMAN_OVERRIDE: 'human_override',
		DATA_ACCESS: 'data_access',
		VERIFICATION: 'verification',
		SIGNATURE: 'signature',
		STATUS_CHANGE: 'status_change',
	},
	ENTITY_TYPES: { CANDIDATE: 'candidate', JOB: 'job', COMPANY: 'company', USER: 'user' },
	logEvent: jest.fn().mockResolvedValue(undefined),
	AuditLogger: { log: jest.fn().mockResolvedValue(undefined) },
}));

const pool = require('../../../lib/db');
const { AuditLogger } = require('../../../services/auditLogService');
const recruiterRouter = require('../../../routes/recruiter');

// The AI decision metadata the audit_logs lookup returns; each test sets it.
let aiMetadata = {};

function installDbMock() {
	pool.query.mockImplementation(async (sql) => {
		const s = sql.replace(/\s+/g, ' ');
		if (s.includes('FROM audit_logs')) {
			return { rows: [{ action_type: 'ai_screening', metadata: aiMetadata }], rowCount: 1 };
		}
		if (s.includes('status as old_status FROM job_applications')) {
			return {
				rows: [{ id: 1, job_id: 10, candidate_id: 42, old_status: 'applied' }],
				rowCount: 1,
			};
		}
		if (s.includes('SELECT id FROM job_applications WHERE company_id')) {
			return { rows: [{ id: 1 }], rowCount: 1 };
		}
		if (s.includes('FROM offers WHERE id')) {
			return { rows: [{ id: 7, status: 'draft', candidate_id: 42, job_id: 10 }], rowCount: 1 };
		}
		if (s.includes('UPDATE offers SET status')) {
			return { rows: [{ id: 7, status: 'sent', candidate_id: 42, job_id: 10 }], rowCount: 1 };
		}
		if (s.includes('UPDATE job_applications')) {
			return { rows: [{ id: 1, candidate_id: 42, job_id: 10, status: 'shortlisted' }], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	});
}

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/recruiter', recruiterRouter);
	return app;
}

function overrideCalls() {
	return AuditLogger.log.mock.calls
		.map((c) => c[0])
		.filter((entry) => entry && entry.actionType === 'human_override');
}

const CASES = [
	['unrecorded confidence (no key)', {}, null],
	['unrecorded confidence (explicit undefined)', { confidence: undefined }, null],
	['recorded confidence of 0', { confidence: 0 }, 0],
	['recorded confidence of 0.62', { confidence: 0.62 }, 0.62],
];

describe('#1613 human_override ai_confidence honesty', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		installDbMock();
	});

	describe.each(CASES)('%s', (_label, metadata, expected) => {
		beforeEach(() => {
			aiMetadata = { decision: 'reject', model: 'test-model', ...metadata };
		});

		test('PUT /applications/:id writes the honest ai_confidence', async () => {
			const res = await request(makeApp())
				.put('/api/recruiter/applications/1')
				.send({ status: 'shortlisted' });
			expect(res.status).toBe(200);
			const calls = overrideCalls();
			expect(calls).toHaveLength(1);
			expect(calls[0].metadata).toHaveProperty('ai_confidence');
			expect(calls[0].metadata.ai_confidence).toBe(expected);
		});

		test('PUT /applications/batch-status writes the honest ai_confidence', async () => {
			const res = await request(makeApp())
				.put('/api/recruiter/applications/batch-status')
				.send({ application_ids: [1], status: 'shortlisted' });
			expect(res.status).toBe(200);
			const calls = overrideCalls();
			expect(calls).toHaveLength(1);
			expect(calls[0].metadata).toHaveProperty('ai_confidence');
			expect(calls[0].metadata.ai_confidence).toBe(expected);
		});

		test('PUT /offers/:id/send writes the honest ai_confidence', async () => {
			const res = await request(makeApp()).put('/api/recruiter/offers/7/send').send({});
			expect(res.status).toBe(200);
			const calls = overrideCalls();
			expect(calls).toHaveLength(1);
			expect(calls[0].metadata).toHaveProperty('ai_confidence');
			expect(calls[0].metadata.ai_confidence).toBe(expected);
		});
	});
});
