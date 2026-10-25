/**
 * Human interview request route tests — S-012 (#651)
 *
 * POST /sessions/:id/request-human-interview  (candidate auth) → AC-1
 * POST /human-requests/:id/approve            (recruiter auth) → AC-2 (approve)
 * POST /human-requests/:id/decline            (recruiter auth) → AC-2 (decline)
 *
 * Service layer owns the business logic; routes map errors to HTTP status.
 */
const request = require('supertest');
const express = require('express');

// Mock dependencies before requiring the route
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/auth', () => ({
	authMiddleware: (req, res, next) => {
		req.user = global.__TEST_USER__ || { id: 42, role: 'candidate', company_id: null };
		next();
	},
}));
jest.mock('../../../lib/consentService', () => ({
	assertSessionOwnership: jest.fn(),
	getConsentStatus: jest.fn(),
}));
jest.mock('../../../lib/notify', () => ({
	notifyUser: jest.fn(),
}));
jest.mock('../../../lib/sessionService', () => ({
	create: jest.fn(),
	HIRING_ROLES: ['recruiter', 'hiring_manager', 'employer', 'admin'],
}));

const consentService = require('../../../lib/consentService');
const { notifyUser } = require('../../../lib/notify');
const SessionService = require('../../../lib/sessionService');
const humanRouter = require('../../../server/routes/human-interview-requests');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/interviews', humanRouter);
	// eslint-disable-next-line no-unused-vars
	app.use((err, req, res, next) => {
		res.status(500).json({ error: 'Test error handler' });
	});
	return app;
}

const DECLINED_STATUS = {
	biometric: { granted: false, withdrawn: true, version: 1 },
	recording: { granted: true, withdrawn: false, version: 1 },
	id_verification: { granted: false, withdrawn: false, version: null },
};

const db = require('../../../lib/db');

describe('human interview request routes', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		global.__TEST_USER__ = { id: 42, role: 'candidate', company_id: null };
	});

	describe('POST /sessions/:id/request-human-interview', () => {
		test('AC-1: declined consent → 201, recruiter notified', async () => {
			consentService.assertSessionOwnership.mockResolvedValueOnce();
			consentService.getConsentStatus.mockResolvedValueOnce(DECLINED_STATUS);
			db.query
				.mockResolvedValueOnce({
					rows: [{ id: 10, candidate_id: 42, triggered_by: 7, company_id: 3 }],
				})
				.mockResolvedValueOnce({ rows: [] })
				.mockResolvedValueOnce({ rows: [{ id: 1, status: 'pending' }] });
			notifyUser.mockResolvedValueOnce(99);

			const res = await request(makeApp()).post(
				'/api/interviews/sessions/10/request-human-interview',
			);

			expect(res.status).toBe(201);
			expect(res.body.request.status).toBe('pending');
			expect(notifyUser).toHaveBeenCalledWith(
				7,
				'human_interview_requested',
				'Human interview requested',
				'A candidate has requested a human interview as an alternative to the biometric screening. Please review the request in your dashboard.',
				expect.any(Object),
			);
		});

		test('biometric not declined → 409 BIOMETRIC_CONSENT_NOT_DECLINED', async () => {
			consentService.assertSessionOwnership.mockResolvedValueOnce();
			consentService.getConsentStatus.mockResolvedValueOnce({
				...DECLINED_STATUS,
				biometric: { granted: true, withdrawn: false, version: 1 },
			});
			db.query.mockResolvedValueOnce({
				rows: [{ id: 10, candidate_id: 42, triggered_by: 7, company_id: 3 }],
			});

			const res = await request(makeApp()).post(
				'/api/interviews/sessions/10/request-human-interview',
			);

			expect(res.status).toBe(409);
			expect(res.body.code).toBe('BIOMETRIC_CONSENT_NOT_DECLINED');
		});

		test('invalid session id → 400', async () => {
			const res = await request(makeApp()).post(
				'/api/interviews/sessions/abc/request-human-interview',
			);
			expect(res.status).toBe(400);
		});
	});

	describe('POST /human-requests/:id/approve', () => {
		beforeEach(() => {
			global.__TEST_USER__ = { id: 7, role: 'recruiter', company_id: 3 };
		});

		test('AC-2 approve: → 200, human session created with biometric_collection:false', async () => {
			const requestRow = {
				id: 1,
				session_id: 10,
				candidate_id: 42,
				recruiter_id: 7,
				company_id: 3,
				job_id: 5,
				application_id: 9,
				status: 'pending',
			};
			db.query
				.mockResolvedValueOnce({ rows: [requestRow] })
				.mockResolvedValueOnce({ rows: [{ ...requestRow, status: 'approved' }] });
			SessionService.create.mockResolvedValueOnce({ id: 20, type: 'human' });
			notifyUser.mockResolvedValueOnce(100);

			const res = await request(makeApp()).post('/api/interviews/human-requests/1/approve');

			expect(res.status).toBe(200);
			expect(res.body.request.status).toBe('approved');
			// AC-3: biometric collection disabled
			expect(SessionService.create.mock.calls[0][0].config.biometric_collection).toBe(false);
			expect(SessionService.create.mock.calls[0][0].type).toBe('human');
		});

		test('candidate cannot approve (403)', async () => {
			global.__TEST_USER__ = { id: 42, role: 'candidate', company_id: null };
			const res = await request(makeApp()).post('/api/interviews/human-requests/1/approve');
			expect(res.status).toBe(403);
		});

		test('already decided → 409 REQUEST_ALREADY_DECIDED', async () => {
			db.query.mockResolvedValueOnce({
				rows: [
					{
						id: 1,
						session_id: 10,
						candidate_id: 42,
						recruiter_id: 7,
						company_id: 3,
						status: 'approved',
					},
				],
			});

			const res = await request(makeApp()).post('/api/interviews/human-requests/1/approve');

			expect(res.status).toBe(409);
			expect(res.body.code).toBe('REQUEST_ALREADY_DECIDED');
		});
	});

	describe('POST /human-requests/:id/decline', () => {
		beforeEach(() => {
			global.__TEST_USER__ = { id: 7, role: 'recruiter', company_id: 3 };
		});

		test('AC-2 decline: → 200, candidate notified, no session created', async () => {
			const requestRow = {
				id: 1,
				session_id: 10,
				candidate_id: 42,
				recruiter_id: 7,
				company_id: 3,
				status: 'pending',
			};
			db.query
				.mockResolvedValueOnce({ rows: [requestRow] })
				.mockResolvedValueOnce({ rows: [{ ...requestRow, status: 'declined' }] });
			notifyUser.mockResolvedValueOnce(101);

			const res = await request(makeApp()).post('/api/interviews/human-requests/1/decline');

			expect(res.status).toBe(200);
			expect(res.body.request.status).toBe('declined');
			expect(SessionService.create).not.toHaveBeenCalled();
			expect(notifyUser).toHaveBeenCalledWith(
				42,
				'human_interview_declined',
				expect.any(String),
				expect.any(String),
				expect.any(Object),
			);
		});
	});
});
