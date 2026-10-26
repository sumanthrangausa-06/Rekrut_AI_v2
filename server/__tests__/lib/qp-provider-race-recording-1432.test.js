/**
 * #1432 — lib/qp-provider.js race-phase circuit recording gate (parity
 * with #1430's fix in lib/ai-provider.js, PR #1433).
 *
 * Defect pinned (verified on origin/dev 75225cda):
 *  - qp's _raceProviders catch calls recordFailure() + _checkGeoBlock()
 *    unconditionally on every rejection except err.notApplicable —
 *    isRetryable() is never consulted in the race phase. A raced leg
 *    rejecting with a request-determined error (413 payload too large /
 *    422 unprocessable) therefore records a circuit failure, and one
 *    recorded failure opens the circuit for 5 min (30 min if geo words
 *    match) — one user's request-specific error sidelines a healthy
 *    qp provider:modality for all users. Same poisoning mechanism
 *    #1430 fixed in lib/ai-provider.js.
 *
 * Fix pinned here (lib/qp-provider.js ONLY):
 *  - NON_RETRYABLE_STATUS = {413, 422} (mirrors ai-provider exactly).
 *  - _shouldRecordFailure(err): false for 413/422 (via err.status ||
 *    err.statusCode || err.response?.status) and err.notApplicable,
 *    true otherwise; recordFailure/_checkGeoBlock in the _raceProviders
 *    catch gated on it.
 *  - qp's isRetryable() tail and its sequential classification/call
 *    site are UNCHANGED: qp's sequential caller is already fail-closed
 *    (isRetryable returns false for 413/422 there, so the sequential
 *    recordFailure site is unreachable for this class) — a separate
 *    policy question, deliberately out of scope for #1432.
 *
 * Only lib/db is stubbed (1414/1424 family pattern). execute() pins stub
 * the provider function at the module's own seam (executeFn argument +
 * getAvailableChain) — the same seam the #1430 suite uses. These unit
 * tests do NOT satisfy the E2E-on-dev gate; a real upstream 422/413
 * cannot be staged without mocking the provider, so fix proof = these
 * red/green pins and Quinn's AFTER fresh-install run owns the
 * no-regression sanity check.
 *
 * Pins marked † are regression pins: they pass on pristine dev and must
 * keep passing. All other pins are RED on pristine dev.
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

describe('#1432 _shouldRecordFailure predicate (mirrors #1430 ai-provider)', () => {
	test('false for 413 and 422, true for provider-health errors', () => {
		const svc = loadProvider({});
		expect(typeof svc._shouldRecordFailure).toBe('function');
		expect(svc._shouldRecordFailure(statusErr(413))).toBe(false);
		expect(svc._shouldRecordFailure(statusErr(422))).toBe(false);
		expect(svc._shouldRecordFailure(statusErr(503))).toBe(true);
		expect(svc._shouldRecordFailure(statusErr(400))).toBe(true);
		const to = new Error('socket timeout');
		to.code = 'ETIMEDOUT';
		expect(svc._shouldRecordFailure(to)).toBe(true);
		expect(svc._shouldRecordFailure(new Error('mystery failure'))).toBe(true);
	});
	test('413/422 detected via err.statusCode and err.response.status', () => {
		const svc = loadProvider({});
		const byCode = new Error('unprocessable');
		byCode.statusCode = 422;
		expect(svc._shouldRecordFailure(byCode)).toBe(false);
		const byResponse = new Error('payload too large');
		byResponse.response = { status: 413 };
		expect(svc._shouldRecordFailure(byResponse)).toBe(false);
	});
	test('false for notApplicable', () => {
		const svc = loadProvider({});
		const err = new Error('wrong modality');
		err.notApplicable = true;
		expect(typeof svc._shouldRecordFailure).toBe('function');
		expect(svc._shouldRecordFailure(err)).toBe(false);
	});
	test('source pin: NON_RETRYABLE_STATUS is exactly {413, 422}', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../../lib/qp-provider.js'), 'utf8');
		const m = src.match(/NON_RETRYABLE_STATUS = new Set\(\[([^\]]*)\]\)/);
		expect(m).not.toBeNull();
		const statuses = m[1].split(',').map((s) => Number(s.trim()));
		expect(statuses).toEqual([413, 422]);
	});
});

// 'llm' has PARALLEL_RACE_COUNT 3 in qp-provider → first 3 legs race, 4th is sequential.
describe('#1432 race phase (_raceProviders): recording is gated', () => {
	test('raced legs rejecting 422 record NO circuit for any raced provider; sequential leg still serves', async () => {
		const svc = svcWithChain(['raceA', 'raceB', 'raceC', 'seqD']);
		const result = await svc.execute('llm', async (pk) => {
			if (pk === 'seqD') return 'from-seqD';
			throw statusErr(422, 'request invalid');
		});
		expect(result).toBe('from-seqD');
		for (const pk of ['raceA', 'raceB', 'raceC']) {
			expect(svc.isCircuitOpen(pk, 'llm')).toBe(false);
			expect(svc.failures[`${pk}:llm`]).toBeUndefined();
		}
	});
	test('raced legs rejecting 413 record NO circuit for any raced provider', async () => {
		const svc = svcWithChain(['raceA', 'raceB', 'raceC', 'seqD']);
		const result = await svc.execute('llm', async (pk) => {
			if (pk === 'seqD') return 'from-seqD';
			throw statusErr(413, 'payload too large');
		});
		expect(result).toBe('from-seqD');
		for (const pk of ['raceA', 'raceB', 'raceC']) {
			expect(svc.isCircuitOpen(pk, 'llm')).toBe(false);
			expect(svc.failures[`${pk}:llm`]).toBeUndefined();
		}
	});
	test('raced legs rejecting 422 via err.response.status record NO circuit', async () => {
		const svc = svcWithChain(['raceA', 'raceB', 'raceC', 'seqD']);
		const result = await svc.execute('llm', async (pk) => {
			if (pk === 'seqD') return 'from-seqD';
			const err = new Error('unprocessable');
			err.response = { status: 422 };
			throw err;
		});
		expect(result).toBe('from-seqD');
		for (const pk of ['raceA', 'raceB', 'raceC']) {
			expect(svc.isCircuitOpen(pk, 'llm')).toBe(false);
			expect(svc.failures[`${pk}:llm`]).toBeUndefined();
		}
	});
	test('raced 422 carrying geo words records NO geo-block either (_checkGeoBlock gated)', async () => {
		const svc = svcWithChain(['raceA', 'raceB', 'raceC', 'seqD']);
		const result = await svc.execute('llm', async (pk) => {
			if (pk === 'seqD') return 'from-seqD';
			throw statusErr(422, 'location not supported for this request shape');
		});
		expect(result).toBe('from-seqD');
		for (const pk of ['raceA', 'raceB', 'raceC']) {
			expect(svc.failures[`${pk}:llm`]).toBeUndefined();
		}
	});
	test('† raced legs rejecting 503 DO record circuit', async () => {
		const svc = svcWithChain(['raceA', 'raceB', 'raceC', 'seqD']);
		const result = await svc.execute('llm', async (pk) => {
			if (pk === 'seqD') return 'from-seqD';
			throw statusErr(503);
		});
		expect(result).toBe('from-seqD');
		for (const pk of ['raceA', 'raceB', 'raceC']) {
			expect(svc.isCircuitOpen(pk, 'llm')).toBe(true);
		}
	});
	test('† raced legs rejecting ETIMEDOUT DO record circuit', async () => {
		const svc = svcWithChain(['raceA', 'raceB', 'raceC', 'seqD']);
		const result = await svc.execute('llm', async (pk) => {
			if (pk === 'seqD') return 'from-seqD';
			const err = new Error('socket timeout');
			err.code = 'ETIMEDOUT';
			throw err;
		});
		expect(result).toBe('from-seqD');
		for (const pk of ['raceA', 'raceB', 'raceC']) {
			expect(svc.isCircuitOpen(pk, 'llm')).toBe(true);
		}
	});
	test('† raced notApplicable rejections record no circuit', async () => {
		const svc = svcWithChain(['raceA', 'raceB', 'raceC', 'seqD']);
		const result = await svc.execute('llm', async (pk) => {
			if (pk === 'seqD') return 'from-seqD';
			const err = new Error('wrong modality');
			err.notApplicable = true;
			throw err;
		});
		expect(result).toBe('from-seqD');
		for (const pk of ['raceA', 'raceB', 'raceC']) {
			expect(svc.isCircuitOpen(pk, 'llm')).toBe(false);
			expect(svc.failures[`${pk}:llm`]).toBeUndefined();
		}
	});
});
