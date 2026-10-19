/**
 * #1437 — lib/qp-provider.js sequential recording gate (parity with
 * lib/ai-provider.js sequential site, post-#1430; follows #1432 which
 * gated qp's race phase).
 *
 * Defect pinned (verified on origin/dev 5ab54d37c):
 *  - qp's sequential execute() branch calls recordFailure() +
 *    _checkGeoBlock() UNCONDITIONALLY inside
 *    `if (this.isRetryable(err))`. isRetryable() runs its positive
 *    rules (code ETIMEDOUT / "timeout" in message / proxy_error /
 *    insufficient_quota) BEFORE any status check, so a hybrid error —
 *    non-retryable status 413/422 PLUS a retryable signal — returns
 *    true from isRetryable() and records a circuit failure against a
 *    healthy provider. ai-provider's sequential site gates the same
 *    calls on _shouldRecordFailure(err); qp's race site does too
 *    (#1432). This sequential site was the last ungated one.
 *
 * Fix pinned here (lib/qp-provider.js ONLY):
 *  - Inside the sequential `if (this.isRetryable(err))` branch, gate
 *    recordFailure() AND _checkGeoBlock() on
 *    `this._shouldRecordFailure(err)`, exactly mirroring
 *    ai-provider.js. Chain continuation / classification unchanged:
 *    hybrids still `continue` to the next leg; they just must not
 *    record a circuit failure.
 *
 * Sequential isolation: modality 'tts' has PARALLEL_RACE_COUNT 1 in
 * qp-provider, so execute() skips the race phase entirely and every
 * leg runs through the sequential branch under test.
 *
 * Only lib/db is stubbed (1414/1424/1432 family pattern). execute()
 * pins stub the provider function at the module's own seam
 * (executeFn argument + getAvailableChain). These unit tests do NOT
 * satisfy the E2E-on-dev gate (Quinn AFTER still pending); no known
 * provider emits such a hybrid today — this is parity hygiene.
 *
 * Pins marked † are regression pins: they pass on pristine dev and
 * must keep passing. All other pins are RED on pristine dev.
 *
 * #1441 — the source pin below no longer anchors on the first
 * indexOf('if (this.isRetryable(err))') (fragile: a second site
 * added above the sequential one would silently re-anchor it).
 * It anchors on the unique sequential marker
 * `failedProvider = providerKey` and asserts uniqueness of both
 * the marker and the branch, so duplication fails loudly.
 */
const fs = require('node:fs');
const path = require('node:path');

jest.mock('../../../lib/db', () => ({
	query: jest.fn(async () => ({ rows: [] })),
}));

const ENV_KEYS = [
	'HTTPS_PROXY',
	'https_proxy',
	'HTTP_PROXY',
	'http_proxy',
	'POLSIA_API_KEY',
	'POLSIA_API_URL',
	'OPENAI_BASE_URL',
	'OPENAI_API_KEY',
	'NVIDIA_NIM_API_KEY',
	'NIM_API_KEY',
	'AI_KEYS_JSON',
	'NIM_BASE_URL',
	'GROQ_API_KEY',
	'CEREBRAS_API_KEY',
	'DEEPGRAM_API_KEY',
];
let savedEnv;
function loadProvider(env) {
	jest.resetModules();
	for (const k of ENV_KEYS) delete process.env[k];
	Object.assign(process.env, env);
	return require('../../../lib/qp-provider');
}
function svcWithChain(chain) {
	const svc = loadProvider({});
	svc.getAvailableChain = () => chain.slice();
	return svc;
}
function hybridErr(status, message) {
	const err = new Error(message || `HTTP ${status} request timed out`);
	err.status = status;
	err.code = 'ETIMEDOUT';
	return err;
}
function statusErr(status, message) {
	const err = new Error(message || `HTTP ${status}`);
	err.status = status;
	return err;
}
beforeEach(() => {
	savedEnv = { ...process.env };
	jest.spyOn(console, 'log').mockImplementation(() => {});
	jest.spyOn(console, 'warn').mockImplementation(() => {});
	jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	for (const k of ENV_KEYS) delete process.env[k];
	for (const k of ENV_KEYS) if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
	jest.restoreAllMocks();
	jest.resetModules();
});

// 'tts' has PARALLEL_RACE_COUNT 1 → execute() is purely sequential.
describe('#1437 sequential phase (execute): recording is gated on _shouldRecordFailure', () => {
	test('hybrid 422 + ETIMEDOUT via sequential execute() → second leg succeeds, NO circuit recorded for first leg', async () => {
		const svc = svcWithChain(['seqA', 'seqB']);
		const calls = [];
		const result = await svc.execute('tts', async (pk) => {
			calls.push(pk);
			if (pk === 'seqB') return 'from-seqB';
			throw hybridErr(422);
		});
		expect(result).toBe('from-seqB');
		expect(calls).toEqual(['seqA', 'seqB']);
		expect(svc.failures['seqA:tts']).toBeUndefined();
		expect(svc.isCircuitOpen('seqA', 'tts')).toBe(false);
	});

	test('hybrid 413 + ETIMEDOUT via sequential execute() → second leg succeeds, NO circuit recorded for first leg', async () => {
		const svc = svcWithChain(['seqA', 'seqB']);
		const result = await svc.execute('tts', async (pk) => {
			if (pk === 'seqB') return 'from-seqB';
			throw hybridErr(413);
		});
		expect(result).toBe('from-seqB');
		expect(svc.failures['seqA:tts']).toBeUndefined();
		expect(svc.isCircuitOpen('seqA', 'tts')).toBe(false);
	});

	test('hybrid 422 + ETIMEDOUT carrying geo words records NO geo-block either (_checkGeoBlock gated)', async () => {
		const svc = svcWithChain(['seqA', 'seqB']);
		const result = await svc.execute('tts', async (pk) => {
			if (pk === 'seqB') return 'from-seqB';
			throw hybridErr(422, 'location not supported for this request shape — socket timeout');
		});
		expect(result).toBe('from-seqB');
		expect(svc.failures['seqA:tts']).toBeUndefined();
		expect(svc.isCircuitOpen('seqA', 'tts')).toBe(false);
	});

	test('† plain retryable 500 + ETIMEDOUT via sequential execute() STILL records a circuit failure', async () => {
		const svc = svcWithChain(['seqA', 'seqB']);
		const calls = [];
		const result = await svc.execute('tts', async (pk) => {
			calls.push(pk);
			if (pk === 'seqB') return 'from-seqB';
			const err = statusErr(500, 'upstream request timed out');
			err.code = 'ETIMEDOUT';
			throw err;
		});
		expect(result).toBe('from-seqB');
		expect(calls).toEqual(['seqA', 'seqB']);
		expect(svc.failures['seqA:tts']).toBeDefined();
		expect(svc.isCircuitOpen('seqA', 'tts')).toBe(true);
	});

	test('† plain ETIMEDOUT (no status) via sequential execute() STILL records a circuit failure', async () => {
		const svc = svcWithChain(['seqA', 'seqB']);
		const result = await svc.execute('tts', async (pk) => {
			if (pk === 'seqB') return 'from-seqB';
			const err = new Error('socket timeout');
			err.code = 'ETIMEDOUT';
			throw err;
		});
		expect(result).toBe('from-seqB');
		expect(svc.failures['seqA:tts']).toBeDefined();
		expect(svc.isCircuitOpen('seqA', 'tts')).toBe(true);
	});

	test('source pin: sequential branch gates recordFailure on _shouldRecordFailure', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../../lib/qp-provider.js'), 'utf8');
		// #1441: anchor on the sequential-only marker, NOT on the
		// first indexOf('if (this.isRetryable(err))'). The marker
		// `failedProvider = providerKey` is the first statement
		// inside the sequential branch and occurs nowhere else (the
		// race fallthrough assigns `failedProvider =
		// raceProviders[...]`). The uniqueness assertions make a
		// future second site fail loudly here instead of silently
		// re-anchoring this pin to the wrong site.
		const marker = 'failedProvider = providerKey';
		expect(src.split(marker).length - 1).toBe(1);
		const branchNeedle = 'if (this.isRetryable(err))';
		expect(src.split(branchNeedle).length - 1).toBe(1);
		const markerIdx = src.indexOf(marker);
		expect(markerIdx).toBeGreaterThan(-1);
		// The enclosing branch is the isRetryable if immediately
		// before the marker (the marker is its first statement).
		const seqIdx = src.lastIndexOf(branchNeedle, markerIdx);
		expect(seqIdx).toBeGreaterThan(-1);
		expect(markerIdx - seqIdx).toBeLessThan(100);
		const seqBlock = src.slice(seqIdx, seqIdx + 600);
		expect(seqBlock).toContain('if (this._shouldRecordFailure(err))');
		expect(seqBlock).toContain('this.recordFailure(providerKey, modality, err)');
		expect(seqBlock).toContain('this._checkGeoBlock(providerKey, modality, err)');
	});
});
