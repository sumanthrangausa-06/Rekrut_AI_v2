/**
 * #807 (S-090): threat-intel chassis — payload contract.
 *
 * STOP 1 §3g suite 7 + security C4 + privacy C1: signal_payload is the
 * one free-form field, so it is guarded, not trusted. recordCheck
 * refuses (coded error, zero writes) when the payload is not a plain
 * object, exceeds 16 KiB serialised, carries a raw-identifier key
 * (denylist, erring wide, at any depth), or carries any value equal to
 * the raw subject supplied for fingerprinting.
 */
const TEST_SECRET = 'test-only-threat-intel-secret-807-32ch';
const { recordCheck } = require('../../../lib/threatIntelChecks');

function makeClient() {
	const client = { query: jest.fn(), inserts: [] };
	client.query.mockImplementation(async (sql, params = []) => {
		if (/FROM job_applications/i.test(sql)) {
			return params[0] === 11
				? { rows: [{ id: 11, company_id: 3 }], rowCount: 1 }
				: { rows: [], rowCount: 0 };
		}
		if (/INSERT INTO threat_intel_checks/i.test(sql)) {
			client.inserts.push({ sql, params });
			return { rows: [{ id: 42, checked_at: '2026-10-15T00:00:00.000Z' }], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	});
	return client;
}

function providerReturning(payload) {
	return {
		key: 'internal_test',
		run: async () => ({ payload, sources_checked: ['internal_test'], sources_failed: [] }),
	};
}

async function expectRefusal(payload, subject) {
	const client = makeClient();
	await expect(
		recordCheck(
			{ applicationId: 11, source: 'internal_test', subject },
			{ client, providers: { internal_test: providerReturning(payload) } },
		),
	).rejects.toMatchObject({ code: 'PAYLOAD_REJECTED' });
	expect(client.inserts).toHaveLength(0);
}

describe('#807 payload contract (security C4 / privacy C1)', () => {
	const savedEnv = { ...process.env };
	beforeEach(() => {
		process.env.THREAT_INTEL_ENABLED = 'true';
		process.env.THREAT_INTEL_HMAC_SECRET = TEST_SECRET;
	});
	afterEach(() => {
		process.env = { ...savedEnv };
	});

	test('non-object payloads are refused: array, string, null, number', async () => {
		await expectRefusal(['signal']);
		await expectRefusal('a string');
		await expectRefusal(null);
		await expectRefusal(42);
	});

	test('caller-supplied payload (no provider payload) is validated the same way', async () => {
		const client = makeClient();
		await expect(
			recordCheck(
				{ applicationId: 11, source: 'internal_test', payload: { email: 'x@example.com' } },
				{
					client,
					providers: {
						internal_test: {
							key: 'internal_test',
							run: async () => ({ sources_checked: ['internal_test'], sources_failed: [] }),
						},
					},
				},
			),
		).rejects.toMatchObject({ code: 'PAYLOAD_REJECTED' });
		expect(client.inserts).toHaveLength(0);
	});

	test.each([
		['email key', { email: 'someone@example.com' }],
		['ip key', { ip: '203.0.113.7' }],
		['ip_address key', { ip_address: '203.0.113.7' }],
		['phone key', { phone: '+1-555-0100' }],
		['name key', { name: 'Test Person' }],
		['ssn key', { ssn: '000-00-0000' }],
		['address key', { address: '1 Main St' }],
		['dob key', { dob: '1990-01-01' }],
		['subject key', { subject: '203.0.113.7' }],
		['nested raw-identifier key', { observation: { contact_email: 'someone@example.com' } }],
		['camelCase raw-identifier key', { emailAddress: 'someone@example.com' }],
	])('denylist refusal: %s', async (_label, payload) => {
		await expectRefusal(payload);
	});

	test('a value equal to the raw subject is refused (even under an innocuous key)', async () => {
		await expectRefusal({ note: '203.0.113.7' }, { kind: 'ip', value: '203.0.113.7' });
		await expectRefusal({ nested: { note: '203.0.113.7' } }, { kind: 'ip', value: '203.0.113.7' });
	});

	test('payload over 16 KiB serialised is refused', async () => {
		await expectRefusal({ blob: 'x'.repeat(17 * 1024) });
	});

	test('a payload at/under the bound with innocuous keys is stored verbatim', async () => {
		const payload = { outcome: 'no_signal', signals_seen: 0, detail: { region: 'test', flags: ['a', 'b'] } };
		const client = makeClient();
		await recordCheck(
			{ applicationId: 11, source: 'internal_test', subject: { kind: 'ip', value: '203.0.113.7' } },
			{ client, providers: { internal_test: providerReturning(payload) } },
		);
		expect(client.inserts).toHaveLength(1);
		expect(JSON.parse(client.inserts[0].params[5])).toEqual(payload);
	});
});
