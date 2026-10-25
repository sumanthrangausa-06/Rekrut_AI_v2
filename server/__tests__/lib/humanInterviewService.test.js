/**
 * S-012 (#651): Consent-decline → human interview path tests.
 *
 * Flow:
 *   1. Candidate declines biometric consent (S-010 AC-4 offer, S-011 receipt)
 *   2. Candidate confirms → POST request-human-interview
 *      → recruiter notified "Candidate declined biometric consent — human interview requested." (AC-1)
 *   3. Recruiter approves → human-mode session created (AC-2)
 *      Recruiter declines → candidate notified (AC-2)
 *   4. Approved human session runs with biometric_collection: false (AC-3)
 *
 * S-010 owns the UI. S-012 owns the backend (STOP 1 decision).
 */
const humanInterviewService = require('../../../lib/humanInterviewService');

// Mock all external dependencies
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
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

const db = require('../../../lib/db');
const consentService = require('../../../lib/consentService');
const { notifyUser } = require('../../../lib/notify');
const SessionService = require('../../../lib/sessionService');

const DECLINED_STATUS = {
	biometric: { granted: false, withdrawn: true, version: 1 },
	recording: { granted: true, withdrawn: false, version: 1 },
	id_verification: { granted: false, withdrawn: false, version: null },
};

const SESSION_ROW = {
	id: 10,
	type: 'ai_interview',
	status: 'invited',
	candidate_id: 42,
	triggered_by: 7,
	company_id: 3,
	job_id: 5,
	application_id: 9,
};

describe('humanInterviewService', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('requestHumanInterview', () => {
		test('AC-1: creates request and notifies recruiter when biometric declined', async () => {
			consentService.assertSessionOwnership.mockResolvedValueOnce();
			consentService.getConsentStatus.mockResolvedValueOnce(DECLINED_STATUS);
			db.query
				.mockResolvedValueOnce({ rows: [SESSION_ROW] }) // load session
				.mockResolvedValueOnce({ rows: [] }) // no existing request
				.mockResolvedValueOnce({ rows: [{ id: 1, status: 'pending' }] }); // insert
			notifyUser.mockResolvedValueOnce(99);

			const result = await humanInterviewService.requestHumanInterview({
				sessionId: 10,
				candidateId: 42,
			});

			expect(result.status).toBe('pending');
			// AC-1: recruiter notified (copy reviewed by UX architect 2026-10-10:
			// accommodation request leads, opt-out is neutral context)
			expect(notifyUser).toHaveBeenCalledWith(
				7, // session.triggered_by (the recruiter)
				'human_interview_requested',
				'Human interview requested',
				'A candidate has requested a human interview as an alternative to the biometric screening. Please review the request in your dashboard.',
				expect.objectContaining({ session_id: 10, candidate_id: 42 }),
			);
		});

		test('AC-1: recruiter message includes job title when available', async () => {
			consentService.assertSessionOwnership.mockResolvedValueOnce();
			consentService.getConsentStatus.mockResolvedValueOnce(DECLINED_STATUS);
			db.query
				.mockResolvedValueOnce({
					rows: [{ ...SESSION_ROW, job_title: 'Senior Analyst' }],
				})
				.mockResolvedValueOnce({ rows: [] })
				.mockResolvedValueOnce({ rows: [{ id: 2, status: 'pending' }] });
			notifyUser.mockResolvedValueOnce(99);

			await humanInterviewService.requestHumanInterview({ sessionId: 10, candidateId: 42 });

			expect(notifyUser).toHaveBeenCalledWith(
				7,
				'human_interview_requested',
				'Human interview requested',
				'A candidate has requested a human interview as an alternative to the biometric screening for Senior Analyst. Please review the request in your dashboard.',
				expect.any(Object),
			);
		});

		test('rejects when biometric consent was NOT declined (409)', async () => {
			consentService.assertSessionOwnership.mockResolvedValueOnce();
			consentService.getConsentStatus.mockResolvedValueOnce({
				...DECLINED_STATUS,
				biometric: { granted: true, withdrawn: false, version: 1 },
			});
			db.query.mockResolvedValueOnce({ rows: [SESSION_ROW] });

			await expect(
				humanInterviewService.requestHumanInterview({ sessionId: 10, candidateId: 42 }),
			).rejects.toMatchObject({ code: 'BIOMETRIC_CONSENT_NOT_DECLINED' });
			expect(notifyUser).not.toHaveBeenCalled();
		});

		test('rejects duplicate request for the same session (409)', async () => {
			consentService.assertSessionOwnership.mockResolvedValueOnce();
			consentService.getConsentStatus.mockResolvedValueOnce(DECLINED_STATUS);
			db.query
				.mockResolvedValueOnce({ rows: [SESSION_ROW] })
				.mockResolvedValueOnce({ rows: [{ id: 1, status: 'pending' }] }); // existing

			await expect(
				humanInterviewService.requestHumanInterview({ sessionId: 10, candidateId: 42 }),
			).rejects.toMatchObject({ code: 'REQUEST_ALREADY_EXISTS' });
		});

		test('rejects when session not found', async () => {
			consentService.assertSessionOwnership.mockResolvedValueOnce();
			db.query.mockResolvedValueOnce({ rows: [] });

			await expect(
				humanInterviewService.requestHumanInterview({ sessionId: 999, candidateId: 42 }),
			).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
		});

		test('rejects when candidate does not own the session (FORBIDDEN)', async () => {
			const err = new Error('not your session');
			err.code = 'FORBIDDEN';
			consentService.assertSessionOwnership.mockRejectedValueOnce(err);

			await expect(
				humanInterviewService.requestHumanInterview({ sessionId: 10, candidateId: 43 }),
			).rejects.toMatchObject({ code: 'FORBIDDEN' });
		});
	});

	describe('respondToRequest', () => {
		const REQUEST_ROW = {
			id: 1,
			session_id: 10,
			candidate_id: 42,
			recruiter_id: 7,
			status: 'pending',
			company_id: 3,
			job_id: 5,
			application_id: 9,
		};

		test('AC-2 approve: creates human session with biometric_collection:false, notifies candidate', async () => {
			db.query
				.mockResolvedValueOnce({ rows: [REQUEST_ROW] }) // load request
				.mockResolvedValueOnce({ rows: [{ id: 1, status: 'approved' }] }); // update
			SessionService.create.mockResolvedValueOnce({ id: 20, type: 'human' });
			notifyUser.mockResolvedValueOnce(100);

			const result = await humanInterviewService.respondToRequest({
				requestId: 1,
				recruiterId: 7,
				recruiterRole: 'recruiter',
				approved: true,
			});

			expect(result.status).toBe('approved');
			// AC-2: human-mode session created
			expect(SessionService.create).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'human',
					candidateId: 42,
					callerRole: 'recruiter',
				}),
			);
			// AC-3: biometric collection disabled in config
			const createArg = SessionService.create.mock.calls[0][0];
			expect(createArg.config.biometric_collection).toBe(false);
			// Candidate notified
			expect(notifyUser).toHaveBeenCalledWith(
				42,
				'human_interview_approved',
				expect.any(String),
				expect.any(String),
				expect.objectContaining({ session_id: expect.any(Number) }),
			);
		});

		test('AC-2 approve: approval message confirms no biometric collection (UX review)', async () => {
			const requestRow = {
				id: 1,
				session_id: 10,
				candidate_id: 42,
				recruiter_id: 7,
				company_id: 3,
				company_name: 'Acme Corp',
				status: 'pending',
			};
			db.query
				.mockResolvedValueOnce({ rows: [requestRow] })
				.mockResolvedValueOnce({ rows: [{ id: 1, status: 'approved' }] });
			SessionService.create.mockResolvedValueOnce({ id: 20, type: 'human' });
			notifyUser.mockResolvedValueOnce(100);

			await humanInterviewService.respondToRequest({
				requestId: 1,
				recruiterId: 7,
				recruiterRole: 'recruiter',
				approved: true,
			});

			expect(notifyUser).toHaveBeenCalledWith(
				42,
				'human_interview_approved',
				'Human interview approved',
				"Good news — the team at Acme Corp approved your human interview request. No biometric data will be collected for this interview. You'll find the schedule on your Sessions page.",
				expect.any(Object),
			);
		});

		test('AC-2 decline: decline message is honest without overpromising (UX review)', async () => {
			const requestRow = {
				id: 1,
				session_id: 10,
				candidate_id: 42,
				recruiter_id: 7,
				company_id: 3,
				company_name: null, // falls back to generic phrasing
				status: 'pending',
			};
			db.query
				.mockResolvedValueOnce({ rows: [requestRow] })
				.mockResolvedValueOnce({ rows: [{ id: 1, status: 'declined' }] });
			notifyUser.mockResolvedValueOnce(101);

			const result = await humanInterviewService.respondToRequest({
				requestId: 1,
				recruiterId: 7,
				recruiterRole: 'recruiter',
				approved: false,
			});

			expect(result.status).toBe('declined');
			expect(SessionService.create).not.toHaveBeenCalled();
			expect(notifyUser).toHaveBeenCalledWith(
				42,
				'human_interview_declined',
				'Human interview request update',
				"The recruiter isn't able to offer a human interview for this role. Your application remains on file, and we'll reach out if another opportunity fits.",
				expect.any(Object),
			);
		});

		test('rejects when request not found', async () => {
			db.query.mockResolvedValueOnce({ rows: [] });

			await expect(
				humanInterviewService.respondToRequest({
					requestId: 999,
					recruiterId: 7,
					recruiterRole: 'recruiter',
					approved: true,
				}),
			).rejects.toMatchObject({ code: 'REQUEST_NOT_FOUND' });
		});

		test('rejects when recruiter is not authorized (FORBIDDEN)', async () => {
			db.query.mockResolvedValueOnce({
				rows: [{ ...REQUEST_ROW, recruiter_id: 8, company_id: 99 }],
			});

			await expect(
				humanInterviewService.respondToRequest({
					requestId: 1,
					recruiterId: 7, // not the request's recruiter, wrong company
					recruiterRole: 'recruiter',
					recruiterCompanyId: 3,
					approved: true,
				}),
			).rejects.toMatchObject({ code: 'FORBIDDEN' });
		});

		test('rejects when request already decided (409)', async () => {
			db.query.mockResolvedValueOnce({
				rows: [{ ...REQUEST_ROW, status: 'approved' }],
			});

			await expect(
				humanInterviewService.respondToRequest({
					requestId: 1,
					recruiterId: 7,
					recruiterRole: 'recruiter',
					approved: false,
				}),
			).rejects.toMatchObject({ code: 'REQUEST_ALREADY_DECIDED' });
		});

		test('approve is idempotent-safe: second approve on pending works once', async () => {
			// First call approves
			db.query
				.mockResolvedValueOnce({ rows: [REQUEST_ROW] })
				.mockResolvedValueOnce({ rows: [{ id: 1, status: 'approved' }] });
			SessionService.create.mockResolvedValueOnce({ id: 21, type: 'human' });
			notifyUser.mockResolvedValueOnce(102);

			await humanInterviewService.respondToRequest({
				requestId: 1,
				recruiterId: 7,
				recruiterRole: 'recruiter',
				approved: true,
			});

			// Second call sees already-decided
			db.query.mockResolvedValueOnce({
				rows: [{ ...REQUEST_ROW, status: 'approved' }],
			});
			await expect(
				humanInterviewService.respondToRequest({
					requestId: 1,
					recruiterId: 7,
					recruiterRole: 'recruiter',
					approved: true,
				}),
			).rejects.toMatchObject({ code: 'REQUEST_ALREADY_DECIDED' });
			expect(SessionService.create).toHaveBeenCalledTimes(1);
		});
	});
});
