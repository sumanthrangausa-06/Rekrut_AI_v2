/**
 * #807 (S-090): threat-intel chassis — erasure wiring.
 *
 * STOP 1 §3g suite 2 + §3d: erasePersonalData() deletes
 * threat_intel_checks rows for the #780 UNHELD application set
 * (explicit, counted DELETE in the #813 C2 position — no new hold
 * consult, inheriting the contained set) and counts the held
 * applications' surviving rows in threatIntelRowsHeld (COUNT issued
 * only when the held set is non-empty). Retention default (Lex,
 * #807): the whole row follows the application lifecycle — no
 * separate period, no purge.
 *
 * Modelled on application-keyed-erasure.test.js (SQL-routing fake).
 * Mocked evidence only here; the mandatory real-DB dry run is recorded
 * in the PR / build log.
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

// Scenario knobs:
//   appRows       — SELECT id, company_id FROM job_applications
//   heldCompanies — company_ids whose hold consult returns a hold
//   threatRows    — [{application_id}] rows present in threat_intel_checks;
//                   the fake DELETE/COUNT operate on this set faithfully.
function makeClient(scenario = {}) {
	const s = {
		appRows: [],
		heldCompanies: new Set(),
		threatRows: [],
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
		if (/DELETE FROM threat_intel_checks/i.test(sql)) {
			const ids = Array.isArray(params[0]) ? params[0] : [];
			const before = s.threatRows.length;
			s.threatRows = s.threatRows.filter((r) => !ids.includes(r.application_id));
			return { rows: [], rowCount: before - s.threatRows.length };
		}
		if (/COUNT\(\*\)/i.test(sql) && /FROM threat_intel_checks/i.test(sql)) {
			const ids = Array.isArray(params[0]) ? params[0] : [];
			const n = s.threatRows.filter((r) => ids.includes(r.application_id)).length;
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

describe('#807 erasePersonalData — threat_intel_checks', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('(a) unheld applications rows are deleted + counted; no held set → no COUNT issued', async () => {
		const client = makeClient({
			appRows: APPS,
			threatRows: [
				{ application_id: 11 },
				{ application_id: 11 },
				{ application_id: 12 },
			],
		});
		const result = await erasureService.erasePersonalData(7, { client });

		const deletes = callsMatching(client, /DELETE FROM threat_intel_checks/i);
		expect(deletes).toHaveLength(1);
		expect(deletes[0][1]).toEqual([[11, 12]]);
		expect(result.threatIntelChecksDeleted).toBe(3);
		expect(result.threatIntelRowsHeld).toBe(0);
		expect(callsMatching(client, /FROM threat_intel_checks/i).filter(([sql]) => /COUNT/i.test(sql))).toHaveLength(0);
		expect(client._s.threatRows).toHaveLength(0);
	});

	test('(b) held applications rows survive whole + are counted; unheld rows deleted', async () => {
		const client = makeClient({
			appRows: APPS,
			heldCompanies: new Set([4]), // application 12 held
			threatRows: [
				{ application_id: 11 },
				{ application_id: 12 },
				{ application_id: 12 },
			],
		});
		const result = await erasureService.erasePersonalData(7, { client });

		const deletes = callsMatching(client, /DELETE FROM threat_intel_checks/i);
		expect(deletes).toHaveLength(1);
		expect(deletes[0][1]).toEqual([[11]]);
		expect(result.threatIntelChecksDeleted).toBe(1);
		expect(result.threatIntelRowsHeld).toBe(2);
		// Held rows survive whole in the table.
		expect(client._s.threatRows).toEqual([{ application_id: 12 }, { application_id: 12 }]);
	});

	test('(c) no applications → no DELETE, no COUNT, both counters zero', async () => {
		const client = makeClient({ appRows: [], threatRows: [] });
		const result = await erasureService.erasePersonalData(7, { client });
		expect(callsMatching(client, /threat_intel_checks/i)).toHaveLength(0);
		expect(result.threatIntelChecksDeleted).toBe(0);
		expect(result.threatIntelRowsHeld).toBe(0);
	});

	test('(d) all applications held → no DELETE issued, held rows counted', async () => {
		const client = makeClient({
			appRows: APPS,
			heldCompanies: new Set([3, 4]),
			threatRows: [{ application_id: 11 }, { application_id: 12 }],
		});
		const result = await erasureService.erasePersonalData(7, { client });
		expect(callsMatching(client, /DELETE FROM threat_intel_checks/i)).toHaveLength(0);
		expect(result.threatIntelChecksDeleted).toBe(0);
		expect(result.threatIntelRowsHeld).toBe(2);
		expect(client._s.threatRows).toHaveLength(2);
	});

	test('(e) no new hold consult for threat rows: legal_holds is consulted only via the pre-existing paths', async () => {
		// The DELETE inherits the #780 unheld set — the threat block must
		// not add its own per-row hold consults. We assert the threat
		// DELETE is keyed by application ids (ANY($1)) and that the erasure
		// completes; the exact pre-existing consult count is owned by the
		// #780/#813 suites.
		const client = makeClient({
			appRows: APPS,
			threatRows: [{ application_id: 11 }],
		});
		await erasureService.erasePersonalData(7, { client });
		const deletes = callsMatching(client, /DELETE FROM threat_intel_checks/i);
		expect(deletes[0][0]).toMatch(/job_application_id = ANY\(\$1\)/);
	});
});
