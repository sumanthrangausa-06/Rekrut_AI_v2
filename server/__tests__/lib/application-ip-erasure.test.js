/**
 * #815 (S-095): application_ip_captures — erasure wiring.
 *
 * Mirrors the #807 threat_intel_checks erasure pattern EXACTLY
 * (database-gate ruling): erasePersonalData() deletes
 * application_ip_captures rows keyed ONLY by the #780 UNHELD
 * application set (explicit, counted DELETE — migration 261's FK
 * carries no cascade), and counts the HELD applications' surviving
 * rows in applicationIpRowsHeld (COUNT issued only when the held set
 * is non-empty). NO candidate-keyed delete: erasing by candidate_id
 * would destroy legally-held rows and break the hold invariant.
 *
 * Modelled on threat-intel-erasure.test.js (SQL-routing fake).
 * Mocked evidence only here.
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/biometricAudit', () => ({
	logAccess: jest.fn(),
}));
jest.mock('../../../lib/file-storage', () => ({
	deleteFile: jest.fn(),
	deleteStorageObject: jest.fn(),
	getProviders: jest.fn(() => []),
}));
jest.mock('../../../services/encryption', () => ({
	deleteEncryptedFile: jest.fn(),
	decrypt: jest.fn((buf) => Buffer.from(buf)),
}));
jest.mock('@aws-sdk/client-s3', () => ({
	S3Client: jest.fn(),
	PutObjectCommand: jest.fn(),
	GetObjectCommand: jest.fn(),
	DeleteObjectCommand: jest.fn(),
}));

process.env.BIOMETRIC_ENCRYPTION_KEY =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const erasureService = require('../../../lib/erasureService');

// Scenario knobs mirror threat-intel-erasure.test.js, plus:
//   captureRows — [{application_id}] rows in application_ip_captures.
function makeClient(scenario = {}) {
	const s = {
		appRows: [],
		heldCompanies: new Set(),
		captureRows: [],
		...scenario,
	};
	const client = { query: jest.fn(), _s: s };
	client.query.mockImplementation(async (sql, params = []) => {
		if (/FROM legal_holds/i.test(sql)) {
			const companyId = params[1];
			if (companyId != null && s.heldCompanies.has(companyId)) {
				return { rows: [{ id: 99, user_id: null, company_id: companyId }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		}
		if (/FROM job_applications/i.test(sql) && /job_id = \$1/i.test(sql)) {
			return { rows: [], rowCount: 0 };
		}
		if (/FROM job_applications/i.test(sql) && /^\s*SELECT/i.test(sql)) {
			return { rows: s.appRows, rowCount: s.appRows.length };
		}
		if (/UPDATE job_applications/i.test(sql)) {
			return { rows: [], rowCount: params[1] ? params[1].length : 0 };
		}
		if (/DELETE FROM application_ip_captures/i.test(sql)) {
			// Hold invariant: the DELETE must be keyed by the application
			// set ONLY — a candidate-keyed clause would erase held rows.
			if (/candidate_id/i.test(sql)) {
				throw new Error('application_ip_captures DELETE must not key on candidate_id');
			}
			const ids = Array.isArray(params[0]) ? params[0] : [];
			const before = s.captureRows.length;
			s.captureRows = s.captureRows.filter((r) => !ids.includes(r.application_id));
			return { rows: [], rowCount: before - s.captureRows.length };
		}
		if (/COUNT\(\*\)/i.test(sql) && /FROM application_ip_captures/i.test(sql)) {
			const ids = Array.isArray(params[0]) ? params[0] : [];
			const n = s.captureRows.filter((r) => ids.includes(r.application_id)).length;
			return { rows: [{ n }], rowCount: 1 };
		}
		// Everything else in the pre-existing sequence: generic success.
		return { rows: [], rowCount: 1 };
	});
	return client;
}

function callsMatching(client, re) {
	return client.query.mock.calls.filter(([sql]) => re.test(sql));
}

const APPS = [
	{ id: 11, company_id: 3 },
	{ id: 12, company_id: 4 },
];

describe('#815 erasePersonalData — application_ip_captures', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('(a) unheld applications rows are deleted + counted; no held set → no COUNT issued', async () => {
		const client = makeClient({
			appRows: APPS,
			captureRows: [{ application_id: 11 }, { application_id: 12 }],
		});
		const result = await erasureService.erasePersonalData(7, { client });

		const deletes = callsMatching(client, /DELETE FROM application_ip_captures/i);
		expect(deletes).toHaveLength(1);
		expect(deletes[0][0]).toMatch(/job_application_id = ANY\(\$1\)/);
		expect(deletes[0][1]).toEqual([[11, 12]]);
		expect(result.applicationIpCapturesDeleted).toBe(2);
		expect(result.applicationIpRowsHeld).toBe(0);
		expect(
			callsMatching(client, /FROM application_ip_captures/i).filter(([sql]) => /COUNT/i.test(sql)),
		).toHaveLength(0);
		expect(client._s.captureRows).toHaveLength(0);
	});

	test('(b) held applications rows survive whole + are counted; unheld rows deleted', async () => {
		const client = makeClient({
			appRows: APPS,
			heldCompanies: new Set([4]), // application 12 held
			captureRows: [{ application_id: 11 }, { application_id: 12 }],
		});
		const result = await erasureService.erasePersonalData(7, { client });

		const deletes = callsMatching(client, /DELETE FROM application_ip_captures/i);
		expect(deletes).toHaveLength(1);
		expect(deletes[0][1]).toEqual([[11]]);
		expect(result.applicationIpCapturesDeleted).toBe(1);
		expect(result.applicationIpRowsHeld).toBe(1);
		expect(client._s.captureRows).toEqual([{ application_id: 12 }]);
	});

	test('(c) no applications → no DELETE, no COUNT, both counters zero', async () => {
		const client = makeClient({ appRows: [], captureRows: [] });
		const result = await erasureService.erasePersonalData(7, { client });
		expect(callsMatching(client, /application_ip_captures/i)).toHaveLength(0);
		expect(result.applicationIpCapturesDeleted).toBe(0);
		expect(result.applicationIpRowsHeld).toBe(0);
	});

	test('(d) all applications held → no DELETE issued, held rows counted', async () => {
		const client = makeClient({
			appRows: APPS,
			heldCompanies: new Set([3, 4]),
			captureRows: [{ application_id: 11 }, { application_id: 12 }],
		});
		const result = await erasureService.erasePersonalData(7, { client });
		expect(callsMatching(client, /DELETE FROM application_ip_captures/i)).toHaveLength(0);
		expect(result.applicationIpCapturesDeleted).toBe(0);
		expect(result.applicationIpRowsHeld).toBe(2);
		expect(client._s.captureRows).toHaveLength(2);
	});
});
