/**
 * #807 (S-090): threat-intel chassis — HMAC secret discipline.
 *
 * STOP 1 §3g suite 9 + security C1/C2: THREAT_INTEL_HMAC_SECRET is
 * dedicated, read LAZILY inside the fingerprint path (importing the
 * module without it set must not throw), has NO fallback/default
 * anywhere, and enforces a 32-char minimum with a coded CONFIG_ERROR
 * hard-fail in every environment (r2FrameStore pattern — explicitly
 * NOT biometricAudit's fallback-string pattern).
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '../../..');
const CODE_DIRS = ['lib', 'routes', 'services', 'workers', 'agents', 'middleware'];

function walkJs(dir, acc = []) {
	if (!fs.existsSync(dir)) return acc;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
			walkJs(full, acc);
		} else if (entry.name.endsWith('.js')) {
			acc.push(full);
		}
	}
	return acc;
}

function makeClient() {
	const client = { query: jest.fn(), inserts: [] };
	client.query.mockImplementation(async (sql, params = []) => {
		if (/FROM job_applications/i.test(sql)) {
			return { rows: [{ id: 11, company_id: 3 }], rowCount: 1 };
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

describe('#807 THREAT_INTEL_HMAC_SECRET discipline', () => {
	const savedEnv = { ...process.env };
	beforeEach(() => {
		process.env.THREAT_INTEL_ENABLED = 'true';
	});
	afterEach(() => {
		process.env = { ...savedEnv };
	});

	test('the module imports cleanly with the secret unset (lazy read, security C2)', () => {
		delete process.env.THREAT_INTEL_HMAC_SECRET;
		jest.resetModules();
		expect(() => require('../../../lib/threatIntelChecks')).not.toThrow();
	});

	test('secret unset → CONFIG_ERROR hard-fail, zero writes', async () => {
		delete process.env.THREAT_INTEL_HMAC_SECRET;
		const { recordCheck } = require('../../../lib/threatIntelChecks');
		const client = makeClient();
		await expect(
			recordCheck(
				{ applicationId: 11, source: 'internal_test', subject: { kind: 'ip', value: '203.0.113.7' } },
				{ client, providers: { internal_test: internalTestProvider } },
			),
		).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
		expect(client.inserts).toHaveLength(0);
	});

	test('secret shorter than 32 chars → CONFIG_ERROR hard-fail, zero writes', async () => {
		process.env.THREAT_INTEL_HMAC_SECRET = 'too-short-secret';
		const { recordCheck } = require('../../../lib/threatIntelChecks');
		const client = makeClient();
		await expect(
			recordCheck(
				{ applicationId: 11, source: 'internal_test', subject: { kind: 'ip', value: '203.0.113.7' } },
				{ client, providers: { internal_test: internalTestProvider } },
			),
		).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
		expect(client.inserts).toHaveLength(0);
	});

	test('subject-less checks never touch the secret (unset secret is fine)', async () => {
		delete process.env.THREAT_INTEL_HMAC_SECRET;
		const { recordCheck } = require('../../../lib/threatIntelChecks');
		const client = makeClient();
		await recordCheck(
			{ applicationId: 11, source: 'internal_test' },
			{ client, providers: { internal_test: internalTestProvider } },
		);
		expect(client.inserts).toHaveLength(1);
		expect(client.inserts[0].params[4]).toBeNull();
	});

	test('fallback census (security C1): no default/fallback secret string exists in the module', () => {
		const src = fs.readFileSync(path.join(REPO_ROOT, 'lib/threatIntelChecks.js'), 'utf8');
		// The biometricAudit anti-pattern: secret || 'some string'.
		expect(src).not.toMatch(/THREAT_INTEL_HMAC_SECRET\s*\|\|/);
		expect(src).not.toMatch(/\|\|\s*['"][^'"]*(secret|fallback|dev-only)[^'"]*['"]/i);
		expect(src).not.toMatch(/defaultSecret|fallbackSecret|DEV_SECRET/i);
	});

	test('sole-reader census: THREAT_INTEL_HMAC_SECRET is referenced only in lib/threatIntelChecks.js', () => {
		const files = [];
		for (const d of CODE_DIRS) walkJs(path.join(REPO_ROOT, d), files);
		const serverJs = path.join(REPO_ROOT, 'server.js');
		if (fs.existsSync(serverJs)) files.push(serverJs);
		const offenders = files.filter((f) => {
			if (f === path.join(REPO_ROOT, 'lib/threatIntelChecks.js')) return false;
			return fs.readFileSync(f, 'utf8').includes('THREAT_INTEL_HMAC_SECRET');
		});
		expect(offenders.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
	});
});
