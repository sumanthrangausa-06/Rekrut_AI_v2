/**
 * S-061 (#711): Recruiter dashboard — pending human-interview requests.
 *
 * listPendingRequests powers the "Human Requests" tab (AC-1):
 * pending requests with candidate name, job title, and requested date.
 * Scoped to the recruiter's own requests + hiring-team company match (AC-5).
 * Approved/declined requests are excluded (AC-4).
 */
const humanInterviewService = require('../../../lib/humanInterviewService');

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

const RECRUITER = { recruiterId: 7, recruiterRole: 'recruiter', recruiterCompanyId: 3 };

const PENDING_ROW = {
	id: 1,
	session_id: 10,
	candidate_id: 42,
	status: 'pending',
	created_at: '2026-10-10T10:00:00.000Z',
	candidate_name: 'Jane Candidate',
	job_title: 'Backend Engineer',
	session_type: 'ai_interview',
};

describe('humanInterviewService.listPendingRequests', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('AC-1: returns pending requests with candidate name, job title, requested date', async () => {
		db.query.mockResolvedValueOnce({ rows: [PENDING_ROW] });

		const rows = await humanInterviewService.listPendingRequests(RECRUITER);

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id: 1,
			candidate_name: 'Jane Candidate',
			job_title: 'Backend Engineer',
			created_at: '2026-10-10T10:00:00.000Z',
		});
		// Only pending rows are selected
		expect(db.query.mock.calls[0][0]).toMatch(/status\s*=\s*'pending'/);
	});

	test('AC-5: scopes to the recruiter or their hiring team', async () => {
		db.query.mockResolvedValueOnce({ rows: [] });

		await humanInterviewService.listPendingRequests(RECRUITER);

		const [sql, params] = db.query.mock.calls[0];
		expect(sql).toMatch(/recruiter_id/);
		expect(params).toContain(7);
	});

	test('AC-4: excludes approved/declined requests', async () => {
		db.query.mockResolvedValueOnce({ rows: [] });

		await humanInterviewService.listPendingRequests(RECRUITER);

		// The status filter guarantees decided rows never come back
		expect(db.query.mock.calls[0][0]).not.toMatch(/approved|declined/);
		expect(db.query.mock.calls[0][0]).toMatch(/status\s*=\s*'pending'/);
	});

	test('AC-5: non-hiring role is rejected', async () => {
		await expect(
			humanInterviewService.listPendingRequests({
				recruiterId: 42,
				recruiterRole: 'candidate',
				recruiterCompanyId: null,
			}),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(db.query).not.toHaveBeenCalled();
	});
});
