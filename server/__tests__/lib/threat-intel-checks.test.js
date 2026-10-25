/**
 * #807 (S-090): threat-intel chassis — pipeline end-to-end record.
 *
 * STOP 1 §3c/§3g suite 1: flag ON + injected `internal_test` provider
 * (performs no I/O) + mocked SQL-routing client → exactly one INSERT
 * with expected provenance, payload stored verbatim, fingerprint equal
 * to an independently recomputed company-siloed HMAC, and company_id
 * taken from the application row (never caller-asserted).
 *
 * Mocked evidence only here; the mandatory real-DB dry run is recorded
 * in the PR / build log.
 */
const crypto = require('node:crypto');

const TEST_SECRET = 'test-only-threat-intel-secret-807-32ch';

const { recordCheck } = require('../../../lib/threatIntelChecks');

function expectedFingerprint(companyId, kind, rawValue) {
	const normalised = String(rawValue).trim().toLowerCase();
	const companyKey = crypto
		.createHmac('sha256', TEST_SECRET)
		.update('threat-intel:v1:company:' + companyId)
		.digest();
	return crypto.createHmac('sha256', companyKey).update(kind + ':' + normalised).digest('hex');
}

// SQL-routing fake: appRows maps application id -> {id, company_id};
// every INSERT is captured in client.inserts.
function makeClient(appRows = new Map()) {
	const client = { query: jest.fn(), inserts: [] };
	client.query.mockImplementation(async (sql, params = []) => {
		if (/FROM job_applications/i.test(sql)) {
			const row = appRows.get(params[0]);
			return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
		}
		if (/INSERT INTO threat_intel_checks/i.test(sql)) {
			client.inserts.push({ sql, params });
			return { rows: [{ id: 42, checked_at: '2026-10-15T00:00:00.000Z' }], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	});
	return client;
}

const internalTestProvider = {
	key: 'internal_test',
	run: async () => ({
		payload: { outcome: 'no_signal', probe: 'internal_test' },
		sources_checked: ['internal_test'],
		sources_failed: [],
	}),
};

describe('#807 recordCheck — pipeline end-to-end', () => {
	const savedEnv = { ...process.env };
	beforeEach(() => {
		process.env.THREAT_INTEL_ENABLED = 'true';
		process.env.THREAT_INTEL_HMAC_SECRET = TEST_SECRET;
	});
	afterEach(() => {
		process.env = { ...savedEnv };
	});

	test('records one check end-to-end via the internal_test provider', async () => {
		const client = makeClient(new Map([[11, { id: 11, company_id: 3 }]]));
		const result = await recordCheck(
			{
				applicationId: 11,
				source: 'internal_test',
				subject: { kind: 'ip', value: '  203.0.113.7 ' },
			},
			{ client, providers: { internal_test: internalTestProvider } },
		);

		expect(result).toEqual(
			expect.objectContaining({ id: 42, checked_at: '2026-10-15T00:00:00.000Z' }),
		);
		expect(client.inserts).toHaveLength(1);
		const params = client.inserts[0].params;
		// INSERT column order (lib/threatIntelChecks.js):
		// job_application_id, company_id, source, severity,
		// subject_fingerprint, signal_payload, sources_checked, sources_failed
		expect(params[0]).toBe(11);
		expect(params[1]).toBe(3); // company_id from the application row
		expect(params[2]).toBe('internal_test');
		expect(params[3]).toBe('info');
		expect(params[4]).toBe(expectedFingerprint(3, 'ip', '203.0.113.7'));
		expect(params[4]).toMatch(/^[0-9a-f]{64}$/);
		expect(JSON.parse(params[5])).toEqual({ outcome: 'no_signal', probe: 'internal_test' });
		expect(params[6]).toEqual(['internal_test']);
		expect(params[7]).toEqual([]);
	});

	test('subject-less check records with a NULL fingerprint', async () => {
		const client = makeClient(new Map([[11, { id: 11, company_id: 3 }]]));
		await recordCheck(
			{ applicationId: 11, source: 'internal_test' },
			{ client, providers: { internal_test: internalTestProvider } },
		);
		expect(client.inserts).toHaveLength(1);
		expect(client.inserts[0].params[4]).toBeNull();
	});

	test('unknown application refuses with zero writes', async () => {
		const client = makeClient(new Map());
		await expect(
			recordCheck(
				{ applicationId: 999, source: 'internal_test' },
				{ client, providers: { internal_test: internalTestProvider } },
			),
		).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });
		expect(client.inserts).toHaveLength(0);
	});

	test('unknown source refuses with zero writes (source must be a registry key)', async () => {
		const client = makeClient(new Map([[11, { id: 11, company_id: 3 }]]));
		await expect(
			recordCheck(
				{ applicationId: 11, source: 'abuseipdb' },
				{ client, providers: { internal_test: internalTestProvider } },
			),
		).rejects.toMatchObject({ code: 'UNKNOWN_SOURCE' });
		expect(client.inserts).toHaveLength(0);
	});

	test('default registry is empty — no source can resolve without injection', async () => {
		const client = makeClient(new Map([[11, { id: 11, company_id: 3 }]]));
		await expect(
			recordCheck({ applicationId: 11, source: 'internal_test' }, { client }),
		).rejects.toMatchObject({ code: 'UNKNOWN_SOURCE' });
		expect(client.inserts).toHaveLength(0);
	});

	test('provider-reported sources outside the registry are refused', async () => {
		const rogueProvider = {
			key: 'internal_test',
			run: async () => ({
				payload: { outcome: 'no_signal' },
				sources_checked: ['internal_test', 'mystery_source'],
				sources_failed: [],
			}),
		};
		const client = makeClient(new Map([[11, { id: 11, company_id: 3 }]]));
		await expect(
			recordCheck(
				{ applicationId: 11, source: 'internal_test' },
				{ client, providers: { internal_test: rogueProvider } },
			),
		).rejects.toMatchObject({ code: 'UNKNOWN_SOURCE' });
		expect(client.inserts).toHaveLength(0);
	});

	test('module exports ONLY recordCheck + fingerprintFor — no read/lookup/compare oracle', () => {
		// #815 (S-095) amendment: fingerprintFor is additionally exported
		// for lib/applicationIpCapture.js. It is a pure compute function
		// (secret → HMAC) with no access to stored rows — the C6 oracle
		// prohibition is about reads against stored fingerprints, and no
		// lookup/verify/compare/read export exists or may be added here.
		const mod = require('../../../lib/threatIntelChecks');
		expect(Object.keys(mod).sort()).toEqual(['fingerprintFor', 'recordCheck']);
	});
});
