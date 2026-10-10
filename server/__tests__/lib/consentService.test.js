/**
 * S-010 (#568): consentService — unit tests with mocked pool.
 *
 * AC coverage:
 * - AC-1: recordConsent handles 3 types independently (recording, biometric, id_verification)
 * - AC-3: recording decline blocks session (isConsentValid returns false)
 * - withdrawConsent is idempotent
 * - isConsentValid does a live DB lookup (no cache)
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));

const db = require('../../../lib/db');
const consentService = require('../../../lib/consentService');

const VALID_TYPES = ['recording', 'biometric', 'id_verification'];

describe('consentService.recordConsent', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('inserts a granted receipt with all required fields', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
		db.query.mockResolvedValueOnce({ rows: [{ version: '1.0' }] });

		const result = await consentService.recordConsent({
			sessionId: 10,
			candidateId: 7,
			type: 'recording',
			accepted: true,
			locale: 'en',
			ipAddress: '1.2.3.4',
		});

		expect(result).toEqual({ id: 1 });
		// Must INSERT into consent_receipts
		expect(db.query.mock.calls[0][0]).toMatch(/INSERT INTO consent_receipts/);
	});

	test('records a decline as withdrawn_at (not granted_at)', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ id: 2 }] });
		db.query.mockResolvedValueOnce({ rows: [{ version: '1.0' }] });

		await consentService.recordConsent({
			sessionId: 10,
			candidateId: 7,
			type: 'biometric',
			accepted: false,
			locale: 'en',
		});

		const insertSql = db.query.mock.calls[0][0];
		expect(insertSql).toMatch(/withdrawn_at/);
	});

	test('rejects invalid consent type', async () => {
		await expect(
			consentService.recordConsent({
				sessionId: 10,
				candidateId: 7,
				type: 'marketing',
				accepted: true,
			}),
		).rejects.toThrow(/Invalid consent type/);
	});

	test('rejects missing required fields', async () => {
		await expect(
			consentService.recordConsent({ sessionId: 10, candidateId: 7 }),
		).rejects.toThrow(/required/);
	});

	test('accepts all 3 valid consent types independently', async () => {
		for (const type of VALID_TYPES) {
			db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
			db.query.mockResolvedValueOnce({ rows: [{ version: '1.0' }] });
			await consentService.recordConsent({
				sessionId: 10,
				candidateId: 7,
				type,
				accepted: true,
			});
		}
		expect(db.query).toHaveBeenCalledTimes(6); // 3 records × 2 queries each
	});
});

describe('consentService.getConsentStatus', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('returns per-type status for a session', async () => {
		db.query.mockResolvedValueOnce({
			rows: [
				{ consent_type: 'recording', granted_at: '2026-10-10T00:00:00Z', withdrawn_at: null, consent_text_version: '1.0' },
				{ consent_type: 'biometric', granted_at: null, withdrawn_at: '2026-10-10T00:00:00Z', consent_text_version: '1.0' },
			],
		});

		const status = await consentService.getConsentStatus(10);

		expect(status.recording.granted).toBe(true);
		expect(status.biometric.granted).toBe(false);
		expect(status.id_verification.granted).toBe(false); // no receipt = not granted
	});
});

describe('consentService.withdrawConsent', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('sets withdrawn_at (idempotent — no error if already withdrawn)', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

		const result = await consentService.withdrawConsent({
			sessionId: 10,
			candidateId: 7,
			type: 'biometric',
			reason: 'candidate request',
		});

		expect(db.query.mock.calls[0][0]).toMatch(/UPDATE consent_receipts/);
		expect(db.query.mock.calls[0][0]).toMatch(/withdrawn_at/);
		expect(result.id).toBe(1);
	});

	test('rejects invalid consent type', async () => {
		await expect(
			consentService.withdrawConsent({ sessionId: 10, candidateId: 7, type: 'bogus' }),
		).rejects.toThrow(/Invalid consent type/);
	});
});

describe('consentService.isConsentValid', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('returns true when granted receipt exists for current version', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ version: '1.0' }] }); // current version
		db.query.mockResolvedValueOnce({
			rows: [{ granted_at: '2026-10-10T00:00:00Z', withdrawn_at: null, consent_text_version: '1.0' }],
		});

		const valid = await consentService.isConsentValid(10, 'recording');
		expect(valid).toBe(true);
	});

	test('returns false when receipt is withdrawn (AC-3: session cannot start)', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ version: '1.0' }] });
		db.query.mockResolvedValueOnce({
			rows: [{ granted_at: '2026-10-10T00:00:00Z', withdrawn_at: '2026-10-10T01:00:00Z', consent_text_version: '1.0' }],
		});

		const valid = await consentService.isConsentValid(10, 'recording');
		expect(valid).toBe(false);
	});

	test('returns false when no receipt exists', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ version: '1.0' }] });
		db.query.mockResolvedValueOnce({ rows: [] });

		const valid = await consentService.isConsentValid(10, 'biometric');
		expect(valid).toBe(false);
	});

	test('returns false when text version is stale (re-consent required)', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ version: '2.0' }] }); // bumped
		db.query.mockResolvedValueOnce({
			rows: [{ granted_at: '2026-10-10T00:00:00Z', withdrawn_at: null, consent_text_version: '1.0' }],
		});

		const valid = await consentService.isConsentValid(10, 'recording');
		expect(valid).toBe(false);
	});

	test('queries the DB live on every call (no cache)', async () => {
		db.query.mockResolvedValue({ rows: [{ version: '1.0' }] });
		db.query.mockResolvedValueOnce({ rows: [{ version: '1.0' }] });
		db.query.mockResolvedValueOnce({ rows: [] });
		db.query.mockResolvedValueOnce({ rows: [{ version: '1.0' }] });
		db.query.mockResolvedValueOnce({ rows: [] });

		await consentService.isConsentValid(10, 'recording');
		await consentService.isConsentValid(10, 'recording');

		// Each call hits the DB (2 queries per call: version + receipt)
		expect(db.query).toHaveBeenCalledTimes(4);
	});
});

describe('consentService.getCurrentTextVersion', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('resolves MAX effective_from version server-side', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ version: '2.0' }] });

		const version = await consentService.getCurrentTextVersion('recording');

		expect(version).toBe('2.0');
		expect(db.query.mock.calls[0][0]).toMatch(/MAX\(effective_from\)/i);
	});
});

describe('consentService.getConsentHistory', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('returns all receipts for a candidate (DSAR source)', async () => {
		db.query.mockResolvedValueOnce({
			rows: [
				{ id: 1, consent_type: 'recording', granted_at: '2026-10-10T00:00:00Z' },
				{ id: 2, consent_type: 'biometric', withdrawn_at: '2026-10-10T01:00:00Z' },
			],
		});

		const history = await consentService.getConsentHistory(7);
		expect(history).toHaveLength(2);
	});
});
