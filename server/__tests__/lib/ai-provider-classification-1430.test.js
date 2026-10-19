/**
 * #1430 — lib/ai-provider.js classification policy (Lead synthesis, Rex minimal set).
 *
 * Defects pinned (verified on origin/dev 7cf915346):
 *  - isRetryable() never returns false (default-true tail), so the
 *    sequential caller's non-retryable throw branch is dead code:
 *    request-determined 413/422 errors retry every remaining leg,
 *    burn the cascade budget, and the precise error is masked by
 *    allProvidersFailed.
 *  - recordFailure()/_checkGeoBlock() run on every retryable error in
 *    the sequential caller and UNCONDITIONALLY (except notApplicable)
 *    in _raceProviders — and one recorded failure opens the circuit
 *    for 5 min. A single request-specific 422 therefore poisons a
 *    healthy provider:modality for all users.
 *
 * Fix pinned here (PR-1 scope, lib/ai-provider.js ONLY):
 *  - NON_RETRYABLE_STATUS = {413, 422} checked FIRST in isRetryable().
 *  - _shouldRecordFailure(err): false for 413/422 and err.notApplicable,
 *    true otherwise; recordFailure/_checkGeoBlock gated on it at BOTH
 *    call sites (sequential caller + _raceProviders catch).
 *  - Polsia 400/proxy_error stays retryable + recorded; the default-true
 *    tail and every other status are unchanged. No 3-class table, no
 *    415, no qp-provider change (qp race-phase parity is a filed
 *    follow-up).
 *
 * Only lib/db is stubbed (1406/1428 family pattern). execute() pins stub
 * the provider function at the module's own seam (executeFn argument +
 * getAvailableChain) — the same seam the ai-engineer probe used. These
 * unit tests do NOT satisfy the E2E-on-dev gate; per the #1428
 * precedent the #1430 Quinn E2E is a no-regression sanity run, NOT fix
 * proof (a real upstream 413/422 cannot be staged without mocking the
 * provider, which the real-flow rule forbids).
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
	'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy',
	'AI_KEYS_JSON', 'NIM_API_KEY', 'NVIDIA_NIM_API_KEY', 'NIM_BASE_URL',
	'POLSIA_API_KEY', 'POLSIA_API_URL', 'OPENAI_BASE_URL', 'OPENAI_API_KEY',
	'GROQ_API_KEY', 'CEREBRAS_API_KEY', 'DEEPGRAM_API_KEY',
];
let savedEnv;
function loadProvider(env) {
	jest.resetModules();
	for (const k of ENV_KEYS) delete process.env[k];
	Object.assign(process.env, env);
	return require('../../../lib/ai-provider');
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

describe('#1430 isRetryable: 413/422 are non-retryable (checked first)', () => {
	test('413 via err.status → false', () => {
		const svc = loadProvider({});
		expect(svc.isRetryable(statusErr(413))).toBe(false);
	});
	test('422 via err.status → false', () => {
		const svc = loadProvider({});
		expect(svc.isRetryable(statusErr(422))).toBe(false);
	});
	test('413 via err.response.status → false', () => {
		const svc = loadProvider({});
		const err = new Error('payload too large');
		err.response = { status: 413 };
		expect(svc.isRetryable(err)).toBe(false);
	});
	test('422 via err.response.status → false', () => {
		const svc = loadProvider({});
		const err = new Error('unprocessable');
		err.response = { status: 422 };
		expect(svc.isRetryable(err)).toBe(false);
	});
	test('422 via err.statusCode → false', () => {
		const svc = loadProvider({});
		const err = new Error('unprocessable');
		err.statusCode = 422;
		expect(svc.isRetryable(err)).toBe(false);
	});
	test('source pin: NON_RETRYABLE_STATUS is exactly {413, 422}', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../../lib/ai-provider.js'), 'utf8');
		const m = src.match(/NON_RETRYABLE_STATUS = new Set\(\[([^\]]*)\]\)/);
		expect(m).not.toBeNull();
		const statuses = m[1].split(',').map((s) => Number(s.trim()));
		expect(statuses).toEqual([413, 422]);
	});
});

describe('#1430 isRetryable: everything else unchanged †', () => {
	test.each([400, 401, 402, 403, 404, 410, 429, 500, 503])(
		'† status %i stays retryable',
		(status) => {
			const svc = loadProvider({});
			expect(svc.isRetryable(statusErr(status))).toBe(true);
		},
	);
	test('† 400 with code proxy_error (Polsia wrap) stays retryable', () => {
		const svc = loadProvider({});
		const err = statusErr(400);
		err.code = 'proxy_error';
		expect(svc.isRetryable(err)).toBe(true);
	});
	test('† 400 with err.error.code proxy_error stays retryable', () => {
		const svc = loadProvider({});
		const err = statusErr(400);
		err.error = { code: 'proxy_error' };
		expect(svc.isRetryable(err)).toBe(true);
	});
	test('† ETIMEDOUT code stays retryable', () => {
		const svc = loadProvider({});
		const err = new Error('socket timeout');
		err.code = 'ETIMEDOUT';
		expect(svc.isRetryable(err)).toBe(true);
	});
	test('† status-less unknown error stays retryable (tail preserved)', () => {
		const svc = loadProvider({});
		expect(svc.isRetryable(new Error('mystery failure'))).toBe(true);
	});
});

describe('#1430 _shouldRecordFailure predicate', () => {
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
	test('false for notApplicable', () => {
		const svc = loadProvider({});
		const err = new Error('wrong modality');
		err.notApplicable = true;
		expect(svc._shouldRecordFailure(err)).toBe(false);
	});
});

// 'safety' has PARALLEL_RACE_COUNT 1 → execute() is purely sequential.
describe('#1430 sequential execute(): abort on 422/413, no poisoning', () => {
	test('leg1 422 → leg2 never called, original error thrown, no allProvidersFailed', async () => {
		const svc = svcWithChain(['legA', 'legB']);
		const err422 = statusErr(422, 'request invalid for every provider');
		const calls = [];
		await expect(
			svc.execute('safety', async (pk) => {
				calls.push(pk);
				if (pk === 'legA') throw err422;
				return 'should-not-reach';
			}),
		).rejects.toBe(err422);
		expect(calls).toEqual(['legA']);
		expect(err422.allProvidersFailed).toBeFalsy();
	});
	test('after 422 abort, circuit is NOT open for legA', async () => {
		const svc = svcWithChain(['legA', 'legB']);
		await expect(
			svc.execute('safety', async (pk) => {
				if (pk === 'legA') throw statusErr(422);
				return 'should-not-reach';
			}),
		).rejects.toThrow();
		expect(svc.isCircuitOpen('legA', 'safety')).toBe(false);
	});
	test('after 413 abort, circuit is NOT open for legA and leg2 never called', async () => {
		const svc = svcWithChain(['legA', 'legB']);
		const calls = [];
		await expect(
			svc.execute('safety', async (pk) => {
				calls.push(pk);
				if (pk === 'legA') throw statusErr(413, 'payload too large');
				return 'should-not-reach';
			}),
		).rejects.toThrow('payload too large');
		expect(calls).toEqual(['legA']);
		expect(svc.isCircuitOpen('legA', 'safety')).toBe(false);
	});
	test('† leg1 503 → leg2 serves, circuit IS open for leg1', async () => {
		const svc = svcWithChain(['legA', 'legB']);
		const result = await svc.execute('safety', async (pk) => {
			if (pk === 'legA') throw statusErr(503);
			return 'from-legB';
		});
		expect(result).toBe('from-legB');
		expect(svc.isCircuitOpen('legA', 'safety')).toBe(true);
	});
	test('† leg1 ETIMEDOUT → circuit IS open for leg1', async () => {
		const svc = svcWithChain(['legA', 'legB']);
		const result = await svc.execute('safety', async (pk) => {
			if (pk === 'legA') {
				const e = new Error('socket timeout');
				e.code = 'ETIMEDOUT';
				throw e;
			}
			return 'from-legB';
		});
		expect(result).toBe('from-legB');
		expect(svc.isCircuitOpen('legA', 'safety')).toBe(true);
	});
	test('† notApplicable still skips silently with no circuit', async () => {
		const svc = svcWithChain(['legA', 'legB']);
		const result = await svc.execute('safety', async (pk) => {
			if (pk === 'legA') {
				const e = new Error('wrong modality');
				e.notApplicable = true;
				throw e;
			}
			return 'from-legB';
		});
		expect(result).toBe('from-legB');
		expect(svc.isCircuitOpen('legA', 'safety')).toBe(false);
	});
});

// 'llm' has PARALLEL_RACE_COUNT 3 → first 3 legs race, 4th is sequential.
describe('#1430 race phase (_raceProviders): recording is gated', () => {
	test('raced legs rejecting 422 record NO circuit; sequential leg still serves', async () => {
		const svc = svcWithChain(['raceA', 'raceB', 'raceC', 'seqD']);
		const result = await svc.execute('llm', async (pk) => {
			if (pk === 'seqD') return 'from-seqD';
			throw statusErr(422, 'request invalid');
		});
		expect(result).toBe('from-seqD');
		for (const pk of ['raceA', 'raceB', 'raceC']) {
			expect(svc.isCircuitOpen(pk, 'llm')).toBe(false);
		}
	});
	test('raced legs rejecting 413 record NO circuit', async () => {
		const svc = svcWithChain(['raceA', 'raceB', 'raceC', 'seqD']);
		const result = await svc.execute('llm', async (pk) => {
			if (pk === 'seqD') return 'from-seqD';
			throw statusErr(413, 'payload too large');
		});
		expect(result).toBe('from-seqD');
		for (const pk of ['raceA', 'raceB', 'raceC']) {
			expect(svc.isCircuitOpen(pk, 'llm')).toBe(false);
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
	test('† raced notApplicable rejections record no circuit', async () => {
		const svc = svcWithChain(['raceA', 'raceB', 'raceC', 'seqD']);
		const result = await svc.execute('llm', async (pk) => {
			if (pk === 'seqD') return 'from-seqD';
			const e = new Error('wrong modality');
			e.notApplicable = true;
			throw e;
		});
		expect(result).toBe('from-seqD');
		for (const pk of ['raceA', 'raceB', 'raceC']) {
			expect(svc.isCircuitOpen(pk, 'llm')).toBe(false);
		}
	});
});
