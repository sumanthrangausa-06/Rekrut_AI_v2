/**
 * #807 (S-090): threat-intel chassis — severity cap.
 *
 * STOP 1 §3g suite 4: severity is capped at 'info' in app validation
 * AND by the migration's equality CHECK (severity = 'info') — raising
 * the cap requires a migration, never an app/config change.
 */
const fs = require('node:fs');
const path = require('node:path');

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

const internalTestProvider = {
	key: 'internal_test',
	run: async () => ({ payload: { outcome: 'no_signal' }, sources_checked: ['internal_test'], sources_failed: [] }),
};

describe('#807 severity cap', () => {
	const savedEnv = { ...process.env };
	beforeEach(() => {
		process.env.THREAT_INTEL_ENABLED = 'true';
		process.env.THREAT_INTEL_HMAC_SECRET = TEST_SECRET;
	});
	afterEach(() => {
		process.env = { ...savedEnv };
	});

	test.each(['warning', 'critical', 'high', 'INFO', ''])(
		'recordCheck rejects severity %p at app validation with zero writes',
		async (severity) => {
			const client = makeClient();
			await expect(
				recordCheck(
					{ applicationId: 11, source: 'internal_test', severity },
					{ client, providers: { internal_test: internalTestProvider } },
				),
			).rejects.toMatchObject({ code: 'INVALID_SEVERITY' });
			expect(client.inserts).toHaveLength(0);
		},
	);

	test("explicit severity 'info' is accepted", async () => {
		const client = makeClient();
		await recordCheck(
			{ applicationId: 11, source: 'internal_test', severity: 'info' },
			{ client, providers: { internal_test: internalTestProvider } },
		);
		expect(client.inserts).toHaveLength(1);
		expect(client.inserts[0].params[3]).toBe('info');
	});

	test('migration 260 encodes the equality CHECK (severity = \'info\')', () => {
		const src = fs.readFileSync(
			path.join(__dirname, '../../../migrations/260_threat_intel_checks.js'),
			'utf8',
		);
		expect(src).toMatch(/CHECK\s*\(\s*severity\s*=\s*'info'\s*\)/);
	});

	test('migration 260 encodes the fingerprint format CHECK (security C3)', () => {
		const src = fs.readFileSync(
			path.join(__dirname, '../../../migrations/260_threat_intel_checks.js'),
			'utf8',
		);
		expect(src).toContain("subject_fingerprint ~ '^[0-9a-f]{64}$'");
	});

	test('migration 260 encodes the silo CHECK: a non-NULL fingerprint requires a company (database F1)', () => {
		const src = fs.readFileSync(
			path.join(__dirname, '../../../migrations/260_threat_intel_checks.js'),
			'utf8',
		);
		expect(src).toContain('threat_intel_checks_siloed_fingerprint');
		expect(src).toMatch(/CHECK\s*\(\s*company_id IS NOT NULL OR subject_fingerprint IS NULL\s*\)/);
	});

	test('migration 260: FK to job_applications with NO cascade action', () => {
		const src = fs.readFileSync(
			path.join(__dirname, '../../../migrations/260_threat_intel_checks.js'),
			'utf8',
		);
		expect(src).toMatch(/REFERENCES job_applications\(id\)/);
		expect(src).not.toMatch(/ON DELETE CASCADE/i);
		expect(src).toContain("name: '260_threat_intel_checks'");
	});
});
