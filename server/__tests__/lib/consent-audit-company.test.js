/**
 * #748: consentService audit writes route through biometricAudit.logAccess
 * with company attribution (interview_sessions.company_id).
 *
 * - recordConsent/withdrawConsent audit rows carry the session's company_id
 * - logAccess accepts the consent action strings (consent_granted,
 *   consent_declined, consent_withdrawn)
 * - audit remains best-effort: failures never break consent recording
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));

const db = require('../../../lib/db');
const consentService = require('../../../lib/consentService');
const { logAccess, VALID_ACTIONS } = require('../../../lib/biometricAudit');

describe('#748 consent audit company attribution', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('recordConsent audit row carries the session company_id', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // receipt INSERT
		db.query.mockResolvedValueOnce({ rows: [{ company_id: 55 }] }); // company lookup
		db.query.mockResolvedValueOnce({ rows: [{ id: 9 }] }); // audit INSERT

		await consentService.recordConsent({
			sessionId: 10,
			candidateId: 7,
			type: 'recording',
			accepted: true,
			locale: 'en',
			ipAddress: '1.2.3.4',
		});

		// Call 2: company lookup on the session
		const companySql = db.query.mock.calls[1][0];
		expect(companySql).toMatch(/SELECT company_id FROM interview_sessions/);
		expect(db.query.mock.calls[1][1]).toEqual([10]);

		// Call 3: audit INSERT via logAccess with company_id
		const auditSql = db.query.mock.calls[2][0];
		expect(auditSql).toMatch(/INSERT INTO biometric_audit_log/);
		const params = db.query.mock.calls[2][1];
		expect(params[2]).toBe('consent_granted');
		expect(params[3]).toBe('consent_recording');
		expect(params[6]).toBe(55); // company_id param
	});

	test('recordConsent decline logs consent_declined', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ id: 2 }] });
		db.query.mockResolvedValueOnce({ rows: [{ company_id: 55 }] });
		db.query.mockResolvedValueOnce({ rows: [{ id: 9 }] });

		await consentService.recordConsent({
			sessionId: 10,
			candidateId: 7,
			type: 'biometric',
			accepted: false,
			locale: 'en',
		});

		// +1 query for the observer flag propagation on biometric
		const auditCall = db.query.mock.calls.find(
			(c) => /INSERT INTO biometric_audit_log/i.test(c[0]),
		);
		expect(auditCall).toBeDefined();
		expect(auditCall[1][2]).toBe('consent_declined');
		expect(auditCall[1][6]).toBe(55);
	});

	test('recordConsent with NULL company session → NULL company_id (no regression)', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
		db.query.mockResolvedValueOnce({ rows: [{ company_id: null }] }); // practice session
		db.query.mockResolvedValueOnce({ rows: [{ id: 9 }] });

		await consentService.recordConsent({
			sessionId: 10,
			candidateId: 7,
			type: 'biometric_practice',
			accepted: true,
			locale: 'en',
		});

		const auditCall = db.query.mock.calls.find(
			(c) => /INSERT INTO biometric_audit_log/i.test(c[0]),
		);
		expect(auditCall).toBeDefined();
		expect(auditCall[1][6]).toBeNull();
	});

	test('recordConsent still succeeds when the audit write fails (best-effort)', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // receipt INSERT
		db.query.mockResolvedValueOnce({ rows: [{ company_id: 55 }] }); // company lookup
		db.query.mockRejectedValueOnce(new Error('audit db down')); // audit INSERT fails

		const result = await consentService.recordConsent({
			sessionId: 10,
			candidateId: 7,
			type: 'recording',
			accepted: true,
			locale: 'en',
		});

		expect(result).toEqual({ id: 1 });
	});

	test('withdrawConsent audit row carries company_id with consent_withdrawn', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }); // withdraw UPDATE
		db.query.mockResolvedValueOnce({ rows: [{ company_id: 77 }] }); // company lookup
		db.query.mockResolvedValueOnce({ rows: [{ id: 9 }] }); // audit INSERT

		await consentService.withdrawConsent({
			sessionId: 10,
			candidateId: 7,
			type: 'recording',
			reason: 'candidate request',
		});

		const auditCall = db.query.mock.calls.find(
			(c) => /INSERT INTO biometric_audit_log/i.test(c[0]),
		);
		expect(auditCall).toBeDefined();
		expect(auditCall[1][2]).toBe('consent_withdrawn');
		expect(auditCall[1][3]).toBe('consent_recording');
		expect(auditCall[1][6]).toBe(77);
	});

	test('logAccess accepts the consent action strings', async () => {
		for (const action of ['consent_granted', 'consent_declined', 'consent_withdrawn']) {
			expect(VALID_ACTIONS).toContain(action);
			db.query.mockResolvedValueOnce({ rows: [{ id: 1, action }] });
			const row = await logAccess({
				userId: 7,
				userRole: 'candidate',
				action,
				dataType: 'consent_recording',
				candidateId: 7,
				companyId: 55,
			});
			expect(row.action).toBe(action);
		}
	});
});
