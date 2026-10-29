/**
 * interview-events bridge routes — #1925 (ADR-D06 §4.1/§4.4)
 *
 * POST /api/interviews: event + governing session + slots land in ONE
 * transaction (client BEGIN…COMMIT; the governing session is created
 * through the transaction client).
 * POST /api/interviews/:id/biometric-consent: the candidate's decision
 * for THIS interview is recorded via consentService.recordConsent
 * against the event's governing session only.
 */
const request = require('supertest');
const express = require('express');

const mockUser = { current: { id: 7, role: 'recruiter', company_id: 400 } };
const mockEventRow = { current: null };
const mockClientQueries = [];

jest.mock('../../../lib/auth', () => ({
	authMiddleware: (req, _res, next) => {
		req.user = mockUser.current;
		return next();
	},
	requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../../../lib/distributed-rate-limiter', () => ({
	rateLimits: { ai: (_req, _res, next) => next() },
}));
jest.mock('../../../server/services/calendar-service', () => ({}));
jest.mock('../../../server/services/livekit', () => ({ autoCreateRoomForInterview: jest.fn(async () => {}) }));

const mockEnsure = jest.fn(async () => 88);
jest.mock('../../../lib/governingSession', () => ({
	ensureGoverningSession: (...a) => mockEnsure(...a),
}));

const mockRecordConsent = jest.fn(async () => ({ id: 4242 }));
const mockAssertOwnership = jest.fn(async () => {});
jest.mock('../../../lib/consentService', () => ({
	recordConsent: (...a) => mockRecordConsent(...a),
	assertSessionOwnership: (...a) => mockAssertOwnership(...a),
}));

jest.mock('../../../lib/db', () => {
	const client = {
		query: jest.fn(async (sql) => {
			mockClientQueries.push(sql.replace(/\s+/g, ' ').trim());
			if (sql.includes('INSERT INTO interview_events')) {
				return {
					rows: [{
						id: 55, recruiter_id: 7, candidate_id: 1001,
						job_application_id: 900, status: 'proposed',
					}],
				};
			}
			return { rows: [] };
		}),
		release: jest.fn(),
	};
	return {
		query: jest.fn(async (sql) => {
			if (sql.includes('FROM job_applications')) {
				return { rows: [{ id: 900, candidate_id: 1001, job_id: 300, job_company_id: 400 }] };
			}
			if (sql.includes('SELECT * FROM interview_events WHERE id =')) {
				return { rows: mockEventRow.current ? [mockEventRow.current] : [] };
			}
			return { rows: [] };
		}),
		connect: jest.fn(async () => client),
		__client: client,
	};
});

const router = require('../../../routes/interview-events');
const app = express();
app.use(express.json());
app.use('/api/interviews', router);

describe('POST /api/interviews — governing session in the creation transaction (#1925)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockClientQueries.length = 0;
		mockUser.current = { id: 7, role: 'recruiter', company_id: 400 };
		mockEnsure.mockResolvedValue(88);
	});

	it('creates event + governing session + slots between BEGIN and COMMIT and returns the link', async () => {
		const res = await request(app)
			.post('/api/interviews')
			.send({
				job_application_id: 900,
				candidate_id: 1001,
				proposed_slots: [{ slot_start: '2026-11-02T10:00:00Z', slot_end: '2026-11-02T11:00:00Z' }],
			});

		expect(res.status).toBe(201);
		expect(res.body.event.interview_session_id).toBe(88);
		expect(mockClientQueries[0]).toBe('BEGIN');
		expect(mockClientQueries[mockClientQueries.length - 1]).toBe('COMMIT');
		expect(mockEnsure).toHaveBeenCalledWith(
			expect.objectContaining({ id: 55, candidate_id: 1001 }),
			expect.objectContaining({ callerRole: 'recruiter', executor: expect.anything() }),
		);
	});
});

describe('POST /api/interviews/:id/biometric-consent — capture against the governing session (#1925 §4.4)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockUser.current = { id: 1001, role: 'candidate' };
		mockRecordConsent.mockResolvedValue({ id: 4242 });
	});

	it('records the grant against the governing session only (S-070 propagation rides recordConsent)', async () => {
		mockEventRow.current = { id: 55, candidate_id: 1001, interview_session_id: 88 };

		const res = await request(app).post('/api/interviews/55/biometric-consent').send({ accepted: true });

		expect(res.status).toBe(201);
		expect(res.body).toMatchObject({ governing_session_id: 88, accepted: true, receipt_id: 4242 });
		expect(mockAssertOwnership).toHaveBeenCalledWith(88, 1001);
		expect(mockRecordConsent).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId: 88, candidateId: 1001, type: 'biometric', accepted: true }),
		);
	});

	it('another user cannot record consent for this event (403, nothing recorded)', async () => {
		mockEventRow.current = { id: 55, candidate_id: 1001, interview_session_id: 88 };
		mockUser.current = { id: 2002, role: 'candidate' };

		const res = await request(app).post('/api/interviews/55/biometric-consent').send({ accepted: true });

		expect(res.status).toBe(403);
		expect(mockRecordConsent).not.toHaveBeenCalled();
	});

	it('unbridged event → 409 NO_GOVERNING_SESSION, nothing recorded', async () => {
		mockEventRow.current = { id: 55, candidate_id: 1001, interview_session_id: null };

		const res = await request(app).post('/api/interviews/55/biometric-consent').send({ accepted: false });

		expect(res.status).toBe(409);
		expect(res.body.code).toBe('NO_GOVERNING_SESSION');
		expect(mockRecordConsent).not.toHaveBeenCalled();
	});
});
