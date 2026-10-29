/**
 * governingSession.test.js — #1925 (ADR-D06, design §4)
 * The governing-session creation seam: an event's own session, created
 * via SessionService.create (type 'human', biometric_collection:false)
 * and linked deterministically. Creation only — an existing session is
 * NEVER adopted; an existing link is never overwritten.
 */
jest.mock('../../../lib/db', () => ({ query: jest.fn() }));
jest.mock('../../../lib/sessionService', () => ({ create: jest.fn() }));

const db = require('../../../lib/db');
const SessionService = require('../../../lib/sessionService');
const { ensureGoverningSession } = require('../../../lib/governingSession');

const EVENT = {
	id: 55,
	candidate_id: 1001,
	job_application_id: 900,
	recruiter_id: 77,
	interview_session_id: null,
};
const JOB_APP = { job_id: 300, job_company_id: 400 };

describe('ensureGoverningSession (#1925)', () => {
	beforeEach(() => jest.clearAllMocks());

	it('returns the existing link without creating anything', async () => {
		const id = await ensureGoverningSession(
			{ ...EVENT, interview_session_id: 88 },
			{ callerRole: 'recruiter' },
		);
		expect(id).toBe(88);
		expect(SessionService.create).not.toHaveBeenCalled();
		expect(db.query).not.toHaveBeenCalled();
	});

	it('creates a human session with biometric_collection:false and links it', async () => {
		SessionService.create.mockResolvedValue({ id: 88 });
		db.query.mockImplementation(async (sql) => {
			if (sql.includes('FROM job_applications')) return { rows: [JOB_APP] };
			if (sql.includes('UPDATE interview_events')) return { rows: [{ interview_session_id: 88 }], rowCount: 1 };
			return { rows: [] };
		});

		const id = await ensureGoverningSession(EVENT, { callerRole: 'recruiter' });

		expect(id).toBe(88);
		expect(SessionService.create).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'human',
				triggeredBy: 77,
				companyId: 400,
				jobId: 300,
				applicationId: 900,
				candidateId: 1001,
				config: { biometric_collection: false },
				callerRole: 'recruiter',
			}),
			expect.anything(),
		);
	});

	it('race: link UPDATE wins 0 rows — re-reads and returns the winner, never overwrites', async () => {
		SessionService.create.mockResolvedValue({ id: 88 });
		db.query.mockImplementation(async (sql) => {
			if (sql.includes('FROM job_applications')) return { rows: [JOB_APP] };
			if (sql.includes('UPDATE interview_events')) return { rows: [], rowCount: 0 };
			if (sql.includes('FROM interview_events')) return { rows: [{ interview_session_id: 91 }] };
			return { rows: [] };
		});

		const id = await ensureGoverningSession(EVENT, { callerRole: 'recruiter' });

		expect(id).toBe(91);
	});
});
