/**
 * #807 (S-090): threat-intel chassis — dark-by-default flag.
 *
 * STOP 1 §3g suite 5 + security C2: lib/threatIntelFlag.js is the ONLY
 * reader of THREAT_INTEL_ENABLED (exact 'true', read fresh). With the
 * flag OFF, recordCheck refuses with zero writes AND before any secret
 * access — a dark deployment without THREAT_INTEL_HMAC_SECRET set must
 * refuse on the flag, not crash on config.
 */
const fs = require('node:fs');
const path = require('node:path');

const { recordCheck } = require('../../../lib/threatIntelChecks');
const flag = require('../../../lib/threatIntelFlag');

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

function codeFiles() {
	const files = [];
	for (const d of CODE_DIRS) walkJs(path.join(REPO_ROOT, d), files);
	const serverJs = path.join(REPO_ROOT, 'server.js');
	if (fs.existsSync(serverJs)) files.push(serverJs);
	return files;
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

describe('#807 threatIntelFlag — single reader, exact true, fresh reads', () => {
	test("only the exact string 'true' is ON", () => {
		expect(flag.isThreatIntelEnabled({})).toBe(false);
		expect(flag.isThreatIntelEnabled({ THREAT_INTEL_ENABLED: 'TRUE' })).toBe(false);
		expect(flag.isThreatIntelEnabled({ THREAT_INTEL_ENABLED: '1' })).toBe(false);
		expect(flag.isThreatIntelEnabled({ THREAT_INTEL_ENABLED: ' true' })).toBe(false);
		expect(flag.isThreatIntelEnabled({ THREAT_INTEL_ENABLED: 'true ' })).toBe(false);
		expect(flag.isThreatIntelEnabled({ THREAT_INTEL_ENABLED: 'yes' })).toBe(false);
		expect(flag.isThreatIntelEnabled({ THREAT_INTEL_ENABLED: 'true' })).toBe(true);
	});

	test('reads are fresh — a flip takes effect at the very next read', () => {
		const env = { THREAT_INTEL_ENABLED: 'true' };
		expect(flag.isThreatIntelEnabled(env)).toBe(true);
		env.THREAT_INTEL_ENABLED = 'false';
		expect(flag.isThreatIntelEnabled(env)).toBe(false);
	});
});

describe('#807 recordCheck — flag OFF refusal', () => {
	const savedEnv = { ...process.env };
	afterEach(() => {
		process.env = { ...savedEnv };
	});

	test.each([
		['unset', undefined],
		['false', 'false'],
		['TRUE', 'TRUE'],
		['1', '1'],
	])('flag %s (%p) → refusal, zero writes, zero queries', async (_label, value) => {
		if (value === undefined) delete process.env.THREAT_INTEL_ENABLED;
		else process.env.THREAT_INTEL_ENABLED = value;
		process.env.THREAT_INTEL_HMAC_SECRET = 'test-only-threat-intel-secret-807-32ch';
		const client = makeClient();
		await expect(
			recordCheck(
				{ applicationId: 11, source: 'internal_test', subject: { kind: 'ip', value: '203.0.113.7' } },
				{ client, providers: { internal_test: internalTestProvider } },
			),
		).rejects.toMatchObject({ code: 'THREAT_INTEL_DISABLED' });
		expect(client.inserts).toHaveLength(0);
		expect(client.query).not.toHaveBeenCalled();
	});

	test('security C2 ordering: flag OFF + secret UNSET → flag refusal, not CONFIG_ERROR (secret never accessed)', async () => {
		delete process.env.THREAT_INTEL_ENABLED;
		delete process.env.THREAT_INTEL_HMAC_SECRET;
		const client = makeClient();
		await expect(
			recordCheck(
				{ applicationId: 11, source: 'internal_test', subject: { kind: 'ip', value: '203.0.113.7' } },
				{ client, providers: { internal_test: internalTestProvider } },
			),
		).rejects.toMatchObject({ code: 'THREAT_INTEL_DISABLED' });
		expect(client.inserts).toHaveLength(0);
	});

	test('security C2 ordering: flag OFF + secret too short → still the flag refusal', async () => {
		process.env.THREAT_INTEL_ENABLED = 'false';
		process.env.THREAT_INTEL_HMAC_SECRET = 'short';
		const client = makeClient();
		await expect(
			recordCheck(
				{ applicationId: 11, source: 'internal_test', subject: { kind: 'ip', value: '203.0.113.7' } },
				{ client, providers: { internal_test: internalTestProvider } },
			),
		).rejects.toMatchObject({ code: 'THREAT_INTEL_DISABLED' });
	});

	test('sole-reader census: THREAT_INTEL_ENABLED is read only in lib/threatIntelFlag.js', () => {
		const offenders = codeFiles().filter((f) => {
			if (f === path.join(REPO_ROOT, 'lib/threatIntelFlag.js')) return false;
			return fs.readFileSync(f, 'utf8').includes('THREAT_INTEL_ENABLED');
		});
		expect(offenders.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
	});
});
