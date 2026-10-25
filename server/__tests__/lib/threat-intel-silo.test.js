/**
 * #807 (S-090): threat-intel chassis — per-company silo proof.
 *
 * STOP 1 §3g suite 3 + security C8 + privacy C3.
 *
 * Honest limit (security C7, repeated so the claim travels with the
 * code): the fingerprint is PSEUDONYMISATION, not a removal of
 * identifiability — a holder of THREAT_INTEL_HMAC_SECRET can recompute
 * fingerprints for guessed low-entropy values, per company. The silo
 * claim is only this: without the secret, fingerprints of the same
 * value under different companies are unrelated HMAC outputs, and no
 * exported function compares or looks up fingerprints.
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
	run: async () => ({ payload: { outcome: 'no_signal' }, sources_checked: ['internal_test'], sources_failed: [] }),
};

describe('#807 silo — company-keyed fingerprints', () => {
	const savedEnv = { ...process.env };
	beforeEach(() => {
		process.env.THREAT_INTEL_ENABLED = 'true';
		process.env.THREAT_INTEL_HMAC_SECRET = TEST_SECRET;
	});
	afterEach(() => {
		process.env = { ...savedEnv };
	});

	test('same value under company A and company B yields unrelated fingerprints', async () => {
		const client = makeClient(
			new Map([
				[11, { id: 11, company_id: 3 }],
				[12, { id: 12, company_id: 4 }],
			]),
		);
		const subject = { kind: 'ip', value: '203.0.113.7' };
		await recordCheck(
			{ applicationId: 11, source: 'internal_test', subject },
			{ client, providers: { internal_test: internalTestProvider } },
		);
		await recordCheck(
			{ applicationId: 12, source: 'internal_test', subject },
			{ client, providers: { internal_test: internalTestProvider } },
		);
		const fpA = client.inserts[0].params[4];
		const fpB = client.inserts[1].params[4];
		expect(fpA).toBe(expectedFingerprint(3, 'ip', '203.0.113.7'));
		expect(fpB).toBe(expectedFingerprint(4, 'ip', '203.0.113.7'));
		expect(fpA).not.toBe(fpB);
	});

	test('C8: stored company_id equals the application row company_id — a caller-asserted company cannot change the silo', async () => {
		const client = makeClient(new Map([[11, { id: 11, company_id: 3 }]]));
		await recordCheck(
			{
				applicationId: 11,
				source: 'internal_test',
				companyId: 999, // caller assertion — must be ignored
				company_id: 999,
				subject: { kind: 'ip', value: '203.0.113.7' },
			},
			{ client, providers: { internal_test: internalTestProvider } },
		);
		expect(client.inserts[0].params[1]).toBe(3);
		expect(client.inserts[0].params[4]).toBe(expectedFingerprint(3, 'ip', '203.0.113.7'));
	});

	test('kind grammar (security C5): invalid kinds refuse with zero writes', async () => {
		const client = makeClient(new Map([[11, { id: 11, company_id: 3 }]]));
		for (const kind of ['IP', 'ip:addr', 'ip addr', '9ip', '', 'e-mail!']) {
			await expect(
				recordCheck(
					{ applicationId: 11, source: 'internal_test', subject: { kind, value: '203.0.113.7' } },
					{ client, providers: { internal_test: internalTestProvider } },
				),
			).rejects.toMatchObject({ code: 'INVALID_SUBJECT_KIND' });
		}
		expect(client.inserts).toHaveLength(0);
	});

	test('privacy C3: subject supplied but application company_id is NULL → refuse, zero writes', async () => {
		const client = makeClient(new Map([[13, { id: 13, company_id: null }]]));
		await expect(
			recordCheck(
				{ applicationId: 13, source: 'internal_test', subject: { kind: 'ip', value: '203.0.113.7' } },
				{ client, providers: { internal_test: internalTestProvider } },
			),
		).rejects.toMatchObject({ code: 'UNSILOED_SUBJECT' });
		expect(client.inserts).toHaveLength(0);
	});

	test('C8 NULL-company path: subject-less row on a NULL-company application records with NULL fingerprint + NULL company, surfaced in the result', async () => {
		const client = makeClient(new Map([[13, { id: 13, company_id: null }]]));
		const result = await recordCheck(
			{ applicationId: 13, source: 'internal_test' },
			{ client, providers: { internal_test: internalTestProvider } },
		);
		expect(client.inserts).toHaveLength(1);
		expect(client.inserts[0].params[1]).toBeNull();
		expect(client.inserts[0].params[4]).toBeNull();
		expect(result.companyId).toBeNull();
		expect(result.siloed).toBe(false);
	});

	test('no cross-company read exists: the module exports no lookup/verify/compare function', () => {
		// #815 (S-095) amendment: fingerprintFor (pure HMAC compute, no
		// stored-data access) joins recordCheck as an export; the
		// no-read-oracle assertion below is unchanged and still binds.
		const mod = require('../../../lib/threatIntelChecks');
		expect(Object.keys(mod).sort()).toEqual(['fingerprintFor', 'recordCheck']);
		for (const name of Object.keys(mod)) {
			expect(name).not.toMatch(/lookup|verify|compare|find|get|read|search/i);
		}
	});
});
