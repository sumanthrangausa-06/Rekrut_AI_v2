/**
 * #815 (S-095): application-time IP capture + consent gate.
 *
 * lib/applicationIpCapture.js — fail-closed capture of a company-siloed
 * pseudonymised IP fingerprint at manual application time, ONLY when:
 *   (a) the dark chassis flag is ON (via lib/threatIntelFlag.js — the
 *       flag's sole reader; this module never reads the flag env var
 *       or the fingerprint secret directly),
 *   (b) the candidate explicitly consented (consentGiven === true),
 *   (c) a usable request IP exists,
 *   (d) a current 'application_ip' consent text exists (version
 *       resolved server-side, MAX(effective_from) — consentService
 *       pattern),
 *   (e) the subject can be siloed (companyId present).
 * The raw IP is never stored, logged, or returned; the fingerprint is
 * never returned. Errors are coded with static messages.
 *
 * Mocked evidence only here (SQL-routing fake client, house pattern
 * from threat-intel-checks.test.js); synthetic env values only.
 */
const crypto = require('node:crypto');

const TEST_SECRET = 'synthetic-test-secret-for-815-fingerprint-0123456789';

const { captureApplicationIp } = require('../../../lib/applicationIpCapture');
const { fingerprintFor } = require('../../../lib/threatIntelChecks');

// SQL-routing fake. Knobs:
//   consentTextRows — rows for the consent_texts version lookup
//                     (default: one row, version '1')
//   insertRows      — rows returned by the captures INSERT
//                     (default: [{ id: 42 }]; [] simulates the
//                     ON CONFLICT DO NOTHING duplicate path)
function makeClient(scenario = {}) {
	const s = {
		consentTextRows: [{ version: '1' }],
		insertRows: [{ id: 42 }],
		...scenario,
	};
	const client = { query: jest.fn(), inserts: [], selects: [] };
	client.query.mockImplementation(async (sql, params = []) => {
		if (/FROM consent_texts/i.test(sql)) {
			client.selects.push({ sql, params });
			return { rows: s.consentTextRows, rowCount: s.consentTextRows.length };
		}
		if (/INSERT INTO application_ip_captures/i.test(sql)) {
			client.inserts.push({ sql, params });
			return { rows: s.insertRows, rowCount: s.insertRows.length };
		}
		return { rows: [], rowCount: 0 };
	});
	return client;
}

const BASE = {
	applicationId: 11,
	candidateId: 7,
	companyId: 3,
	reqIp: '192.0.2.10',
	consentGiven: true,
};

describe('#815 captureApplicationIp', () => {
	const savedEnv = { ...process.env };
	beforeEach(() => {
		process.env.THREAT_INTEL_ENABLED = 'true';
		process.env.THREAT_INTEL_HMAC_SECRET = TEST_SECRET;
	});
	afterEach(() => {
		process.env = { ...savedEnv };
	});

	test('fingerprintFor is exported from threatIntelChecks (additive export)', () => {
		expect(typeof fingerprintFor).toBe('function');
	});

	test('flag OFF → {captured:false, reason:disabled} and ZERO queries', async () => {
		process.env.THREAT_INTEL_ENABLED = 'false';
		const client = makeClient();
		const result = await captureApplicationIp({ ...BASE }, { client });
		expect(result).toEqual({ captured: false, reason: 'disabled' });
		expect(client.query).not.toHaveBeenCalled();
	});

	test('flag unset → disabled, zero queries (dark by default)', async () => {
		delete process.env.THREAT_INTEL_ENABLED;
		const client = makeClient();
		const result = await captureApplicationIp({ ...BASE }, { client });
		expect(result).toEqual({ captured: false, reason: 'disabled' });
		expect(client.query).not.toHaveBeenCalled();
	});

	test('consent false → no_consent, no queries, no fingerprint work', async () => {
		const client = makeClient();
		const result = await captureApplicationIp({ ...BASE, consentGiven: false }, { client });
		expect(result).toEqual({ captured: false, reason: 'no_consent' });
		expect(client.query).not.toHaveBeenCalled();
	});

	test('consent absent (undefined) → no_consent, no queries', async () => {
		const client = makeClient();
		const input = { ...BASE };
		delete input.consentGiven;
		const result = await captureApplicationIp(input, { client });
		expect(result).toEqual({ captured: false, reason: 'no_consent' });
		expect(client.query).not.toHaveBeenCalled();
	});

	test('consent truthy-but-not-true ("true" string) → no_consent', async () => {
		const client = makeClient();
		const result = await captureApplicationIp({ ...BASE, consentGiven: 'true' }, { client });
		expect(result).toEqual({ captured: false, reason: 'no_consent' });
		expect(client.query).not.toHaveBeenCalled();
	});

	test.each([[undefined], [null], [''], ['   '], ['unknown'], ['UNKNOWN']])(
		'no usable IP (%p) → no_ip, no queries',
		async (reqIp) => {
			const client = makeClient();
			const result = await captureApplicationIp({ ...BASE, reqIp }, { client });
			expect(result).toEqual({ captured: false, reason: 'no_ip' });
			expect(client.query).not.toHaveBeenCalled();
		},
	);

	test('happy path: one INSERT, siloed fingerprint, receipt binds the grant, raw IP nowhere', async () => {
		const client = makeClient();
		const result = await captureApplicationIp({ ...BASE, reqIp: ' 192.0.2.10 ' }, { client });
		expect(result).toEqual({ captured: true, id: 42 });

		expect(client.inserts).toHaveLength(1);
		const { sql, params } = client.inserts[0];
		expect(sql).toMatch(/ON CONFLICT \(job_application_id\) DO NOTHING/i);
		expect(sql).toMatch(/retention_expires_at/i);
		expect(sql).toMatch(/now\(\) \+ interval '12 months'/i);

		// INSERT param order (lib/applicationIpCapture.js):
		// applicationId, candidateId, companyId, fingerprint,
		// consentTextVersion, consentGrantedAtISO, receiptHash
		expect(params[0]).toBe(11);
		expect(params[1]).toBe(7);
		expect(params[2]).toBe(3);
		const expectedFingerprint = fingerprintFor(3, 'application_ip', '192.0.2.10');
		expect(params[3]).toBe(expectedFingerprint);
		expect(params[3]).toMatch(/^[0-9a-f]{64}$/);
		expect(params[3]).not.toBe('192.0.2.10');
		expect(params[4]).toBe(1); // version resolved server-side, seeded v1
		const expectedReceipt = crypto
			.createHash('sha256')
			.update(`application_ip:7:11:${params[5]}:true`)
			.digest('hex');
		expect(params[6]).toBe(expectedReceipt);

		// The raw IP appears NOWHERE: not in any param of any query,
		// not in the SQL text, not in the result.
		for (const call of client.query.mock.calls) {
			expect(JSON.stringify(call)).not.toContain('192.0.2.10');
		}
		expect(JSON.stringify(result)).not.toContain('192.0.2.10');
		expect(JSON.stringify(result)).not.toContain(expectedFingerprint);
	});

	test('version resolution is server-side against consent_texts (MAX effective_from)', async () => {
		const client = makeClient();
		await captureApplicationIp({ ...BASE }, { client });
		expect(client.selects).toHaveLength(1);
		expect(client.selects[0].sql).toMatch(/MAX\(effective_from\)/i);
		expect(client.selects[0].params).toEqual(['application_ip']);
	});

	test('company silo: same IP under two companies → different fingerprints', async () => {
		const c1 = makeClient();
		const c2 = makeClient();
		await captureApplicationIp({ ...BASE, companyId: 3 }, { client: c1 });
		await captureApplicationIp({ ...BASE, companyId: 4 }, { client: c2 });
		expect(c1.inserts[0].params[3]).not.toBe(c2.inserts[0].params[3]);
		expect(c1.inserts[0].params[3]).toBe(fingerprintFor(3, 'application_ip', '192.0.2.10'));
		expect(c2.inserts[0].params[3]).toBe(fingerprintFor(4, 'application_ip', '192.0.2.10'));
	});

	test('::ffff:-prefixed IPv4 canonicalises to the same fingerprint', async () => {
		const c1 = makeClient();
		const c2 = makeClient();
		await captureApplicationIp({ ...BASE, reqIp: '::ffff:192.0.2.10' }, { client: c1 });
		await captureApplicationIp({ ...BASE, reqIp: '192.0.2.10' }, { client: c2 });
		expect(c1.inserts[0].params[3]).toBe(c2.inserts[0].params[3]);
	});

	test('uppercase / whitespace IP canonicalises (trim + lowercase)', async () => {
		const client = makeClient();
		await captureApplicationIp({ ...BASE, reqIp: ' ::FFFF:192.0.2.10 ' }, { client });
		expect(client.inserts[0].params[3]).toBe(fingerprintFor(3, 'application_ip', '192.0.2.10'));
	});

	test('missing fingerprint secret → coded CONFIG_ERROR propagates, no INSERT', async () => {
		delete process.env.THREAT_INTEL_HMAC_SECRET;
		const client = makeClient();
		await expect(captureApplicationIp({ ...BASE }, { client })).rejects.toMatchObject({
			code: 'CONFIG_ERROR',
		});
		expect(client.inserts).toHaveLength(0);
	});

	test('null company → coded UNSILOED_SUBJECT, no INSERT (fingerprint never minted unsiloed)', async () => {
		const client = makeClient();
		await expect(
			captureApplicationIp({ ...BASE, companyId: null }, { client }),
		).rejects.toMatchObject({ code: 'UNSILOED_SUBJECT' });
		expect(client.inserts).toHaveLength(0);
	});

	test('no consent text row → coded NO_CONSENT_TEXT, no INSERT (fail-closed)', async () => {
		const client = makeClient({ consentTextRows: [] });
		await expect(captureApplicationIp({ ...BASE }, { client })).rejects.toMatchObject({
			code: 'NO_CONSENT_TEXT',
		});
		expect(client.inserts).toHaveLength(0);
	});

	test('duplicate application (ON CONFLICT DO NOTHING, no RETURNING row) → {captured:false, reason:duplicate}', async () => {
		const client = makeClient({ insertRows: [] });
		const result = await captureApplicationIp({ ...BASE }, { client });
		expect(result).toEqual({ captured: false, reason: 'duplicate' });
		expect(client.inserts).toHaveLength(1);
	});

	test('module source discipline: no direct env reads, no logging', () => {
		const fs = require('node:fs');
		const path = require('node:path');
		const src = fs.readFileSync(
			path.join(__dirname, '../../../lib/applicationIpCapture.js'),
			'utf8',
		);
		// Flag + secret are read ONLY by their owner modules (censuses in
		// the #807 suites scan for the literal names — this module must
		// not contain them even in comments).
		expect(src).not.toContain('THREAT_INTEL_ENABLED');
		expect(src).not.toContain('THREAT_INTEL_HMAC_SECRET');
		expect(src).not.toMatch(/console\./);
		expect(src).not.toMatch(/anonymis/i);
	});
});
