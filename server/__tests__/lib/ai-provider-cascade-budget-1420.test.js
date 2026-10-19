/**
 * #1420 — lib/ai-provider.js cascade budget + verification demotion
 * (Lead STOP 1 decision, hidden_files/1420-run/stop1-lead-decision.md).
 *
 * Defect pinned (filed from #1406 E2E evidence): in execute(), the race
 * phase raced the top-3 legs with the FULL 8s per-provider timeout and
 * the sequential phase shrank greedily (min(perProvider, remaining)),
 * so one hanging sequential leg consumed ALL remaining budget. With a
 * 12s llm budget: race burns 8s, one hanging NIM leg burns the last 4s,
 * and groq_gpt_oss (position 10 of 12) is never attempted. Also,
 * getAvailableChain() never read _lastVerification — the ordering
 * signal was collected and persisted but display-only.
 *
 * Fix pinned here (lib/ai-provider.js ONLY):
 *  - Rule A demotion: in getAvailableChain(), after the existing
 *    filters, stable-partition on in-memory _lastVerification when its
 *    timestamp is ≤30 min old — providers whose result for this
 *    modality has status !== 'working' move to the tail (relative
 *    order preserved in each partition); providers with no result stay
 *    in the front partition; stale / absent / all-non-working →
 *    order exactly as before (fail-open, demotion never removes).
 *  - Race cap: raced legs get min(perProviderTimeoutMs,
 *    floor(totalTimeoutMs/3)).
 *  - Sequential fair-share: per leg, effectiveTimeout = last leg ?
 *    remainingMs : min(perProviderTimeoutMs, remainingMs,
 *    max(750, floor(remainingMs/legsLeft))), recomputed per leg from
 *    actual elapsed; the loop-top total-budget break stays.
 *
 * MECHANISM CHANGE (Quinn AFTER FAIL fix, PR #1436 second commit —
 * Lead synthesis in hidden_files/1420-fix-design/): the sequential
 * fair-share slice above is REPLACED by a reserve-based slice.
 * Quinn Pass A showed fair-share cutting the only working provider
 * (groq_gpt_oss, mid-tail at index 9 of 11) at 3,750ms — exactly its
 * remaining/legsLeft share — while a verified-dead leg sat behind it.
 * New rule (RESERVE_MS = 750, callMeta.reserveMs test seam):
 *  - Last leg: effectiveTimeout = remainingMs (unchanged).
 *  - Funded regime (remainingMs > RESERVE_MS × legsLeft):
 *    effectiveTimeout = min(perProviderTimeoutMs,
 *    remainingMs − RESERVE_MS × legsAfter), legsAfter = legsLeft − 1.
 *  - Exhaustion regime (remainingMs ≤ RESERVE_MS × legsLeft): the
 *    fair-share formula above (protects the final-leg attempt when
 *    the budget can no longer fund the reserves).
 * Pins R1–R4 below pin the new rule. R1/R2 are RED on the first
 * PR #1436 head (51d3f10d4, fair-share). R3 is a † regression pin
 * (green under both formulas, labelled as such). R4 is the
 * exhaustion guard: green on the shipped fair-share head and on the
 * reserve+fallback formula; its red state is against the LITERAL
 * floored reserve candidate (max(750, remaining − 750×legsAfter)
 * with no fallback), where a 750ms floor against 600ms remaining
 * swallows the whole budget and the loop-top break skips the last
 * leg — the #1428-style honesty label for a non-standard red state.
 *  - Testability (ai-engineer §3 requirement, Lead STOP 1): execute()
 *    accepts a budget override via callMeta.totalTimeoutMs /
 *    callMeta.perProviderTimeoutMs; production defaults are unchanged
 *    when the override is absent, so timing pins run in ~1-3s instead
 *    of real 12s waits.
 *
 * Pin map: Rex T-1420-1 (demotion order), T-1420-2 (identity when
 * healthy/absent/stale), T-1420-3 (all dead → unchanged + still
 * attempted), T-1420-7 (honest failure); ai-engineer pins 10 (hanging
 * legs + fast final leg attempted and returns), 11 (race releases with
 * ≥2/3 budget remaining), 12 († last-leg rule), 13 († all-reachable
 * regression), 14 (all hang → triedProviders contains EVERY leg),
 * 15 (demotion fresh vs stale), 16 († cross-call circuit regression).
 * Rex's old T-1420-6 slow-winner pin (winner at 5.5s under a total/2
 * race cap) is SUPERSEDED by the decided total/3 cap (STOP 1) and is
 * replaced here by a winner-under-the-cap pin plus an over-cap-loses
 * pin.
 *
 * Only lib/db is stubbed (1415/1418/1428/1430 family pattern).
 * execute() pins stub the provider function at the module's own seam
 * (executeFn argument + getAvailableChain / getChain stubs) — the same
 * seam the 1430 suite and the ai-engineer probe used. Demotion pins
 * keep the REAL getAvailableChain() and stub only getChain /
 * isProviderAvailable / isCircuitOpen beneath it. These unit tests do
 * NOT satisfy the E2E-on-dev gate; Quinn re-runs that independently.
 *
 * Pins marked † are regression pins: they pass on pristine dev
 * (75225cda) and must keep passing. All other pins are RED on
 * pristine dev (see hidden_files/1420-run/red.log).
 */
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
// execute() timing pins: chain stubbed at the 1430 seam.
function svcWithChain(chain) {
	const svc = loadProvider({});
	svc.getAvailableChain = () => chain.slice();
	return svc;
}
// Demotion pins: REAL getAvailableChain(); only the seams beneath it stubbed.
function svcWithStaticChain(chain, { realCircuit = false } = {}) {
	const svc = loadProvider({});
	svc.getChain = () => chain.slice();
	svc.isProviderAvailable = () => true;
	if (!realCircuit) svc.isCircuitOpen = () => false;
	return svc;
}
function statusErr(status, message) {
	const err = new Error(message || `HTTP ${status}`);
	err.status = status;
	return err;
}
const hang = () => new Promise(() => {});
const delayed = (ms, val) => new Promise((r) => setTimeout(() => r(val), ms));
function verification(ageMs, results) {
	return {
		timestamp: new Date(Date.now() - ageMs).toISOString(),
		totalTested: results.length,
		totalWorking: results.filter((r) => r.status === 'working').length,
		totalDead: results.filter((r) => r.status !== 'working').length,
		results,
	};
}
const LLM_CHAIN = [
	'anthropic', 'kimi', 'openai', 'nim_llama_70b', 'nim_step_flash',
	'nim_gpt_oss', 'nim_ultra', 'nim_gemma', 'nim_nemotron_super',
	'groq_gpt_oss', 'cerebras_gpt_oss', 'cerebras_llama_8b',
];
const FRESH = 5 * 60 * 1000;
const STALE = 31 * 60 * 1000;

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

describe('#1420 Rule A — verification demotion in getAvailableChain()', () => {
	test('T-1420-1: fresh dead first-three demoted to tail; groq (working) ahead of all three; relative order preserved', () => {
		const svc = svcWithStaticChain(LLM_CHAIN);
		svc._lastVerification = verification(FRESH, [
			{ key: 'anthropic', modality: 'llm', status: 'dead' },
			{ key: 'kimi', modality: 'llm', status: 'dead' },
			{ key: 'openai', modality: 'llm', status: 'dead' },
			{ key: 'groq_gpt_oss', modality: 'llm', status: 'working' },
		]);
		const chain = svc.getAvailableChain('llm');
		// Providers with no result stay in the front partition, static order.
		expect(chain.slice(0, 9)).toEqual([
			'nim_llama_70b', 'nim_step_flash', 'nim_gpt_oss', 'nim_ultra',
			'nim_gemma', 'nim_nemotron_super', 'groq_gpt_oss',
			'cerebras_gpt_oss', 'cerebras_llama_8b',
		]);
		// Demoted tail preserves relative order; nothing is removed.
		expect(chain.slice(9)).toEqual(['anthropic', 'kimi', 'openai']);
		expect(chain).toHaveLength(LLM_CHAIN.length);
		expect(chain.indexOf('groq_gpt_oss')).toBeLessThan(chain.indexOf('anthropic'));
	});

	test('† T-1420-2a: all providers working → order byte-identical to static order', () => {
		const svc = svcWithStaticChain(LLM_CHAIN);
		svc._lastVerification = verification(
			FRESH,
			LLM_CHAIN.map((key) => ({ key, modality: 'llm', status: 'working' })),
		);
		expect(svc.getAvailableChain('llm')).toEqual(LLM_CHAIN);
	});

	test('† T-1420-2b: verification absent → order byte-identical to static order', () => {
		const svc = svcWithStaticChain(LLM_CHAIN);
		svc._lastVerification = null;
		expect(svc.getAvailableChain('llm')).toEqual(LLM_CHAIN);
	});

	test('† T-1420-2c: verification 31 min old (stale) → order byte-identical (fail-open)', () => {
		const svc = svcWithStaticChain(LLM_CHAIN);
		svc._lastVerification = verification(STALE, [
			{ key: 'anthropic', modality: 'llm', status: 'dead' },
			{ key: 'kimi', modality: 'llm', status: 'dead' },
			{ key: 'openai', modality: 'llm', status: 'dead' },
		]);
		expect(svc.getAvailableChain('llm')).toEqual(LLM_CHAIN);
	});

	test('† T-1420-3: ALL providers dead in fresh verification → order unchanged AND execute() still attempts every leg', async () => {
		const svc = svcWithStaticChain(LLM_CHAIN);
		svc._lastVerification = verification(
			FRESH,
			LLM_CHAIN.map((key) => ({ key, modality: 'llm', status: 'dead' })),
		);
		expect(svc.getAvailableChain('llm')).toEqual(LLM_CHAIN);
		const calls = [];
		await expect(
			svc.execute(
				'llm',
				async (pk) => {
					calls.push(pk);
					throw statusErr(503);
				},
				'default',
				{ totalTimeoutMs: 3000, perProviderTimeoutMs: 1000 },
			),
		).rejects.toMatchObject({ allProvidersFailed: true });
		expect(calls).toEqual(LLM_CHAIN);
	});

	test('pin 15-fresh: fresh dead early legs are ATTEMPTED after healthy legs in execute() (demoted order is the tried order)', async () => {
		const svc = svcWithStaticChain(LLM_CHAIN);
		svc._lastVerification = verification(FRESH, [
			{ key: 'anthropic', modality: 'llm', status: 'dead' },
			{ key: 'kimi', modality: 'llm', status: 'dead' },
			{ key: 'openai', modality: 'llm', status: 'dead' },
			{ key: 'groq_gpt_oss', modality: 'llm', status: 'working' },
		]);
		let caught;
		try {
			await svc.execute(
				'llm',
				async () => {
					throw statusErr(503);
				},
				'default',
				{ totalTimeoutMs: 3000, perProviderTimeoutMs: 1000 },
			);
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeDefined();
		expect(caught.allProvidersFailed).toBe(true);
		expect(caught.triedProviders.slice(-3)).toEqual(['anthropic', 'kimi', 'openai']);
		expect(caught.triedProviders.indexOf('groq_gpt_oss')).toBeLessThan(
			caught.triedProviders.indexOf('anthropic'),
		);
	});

	test('† pin 15-stale: stale verification → execute() tried order is the static order', async () => {
		const svc = svcWithStaticChain(LLM_CHAIN);
		svc._lastVerification = verification(STALE, [
			{ key: 'anthropic', modality: 'llm', status: 'dead' },
			{ key: 'kimi', modality: 'llm', status: 'dead' },
			{ key: 'openai', modality: 'llm', status: 'dead' },
		]);
		let caught;
		try {
			await svc.execute(
				'llm',
				async () => {
					throw statusErr(503);
				},
				'default',
				{ totalTimeoutMs: 3000, perProviderTimeoutMs: 1000 },
			);
		} catch (err) {
			caught = err;
		}
		expect(caught.triedProviders).toEqual(LLM_CHAIN);
	});

	test('† demotion only reads results for THIS modality (vision results do not reorder llm)', () => {
		const svc = svcWithStaticChain(LLM_CHAIN);
		svc._lastVerification = verification(FRESH, [
			{ key: 'anthropic', modality: 'vision', status: 'dead' },
			{ key: 'kimi', modality: 'vision', status: 'dead' },
			{ key: 'openai', modality: 'vision', status: 'dead' },
		]);
		expect(svc.getAvailableChain('llm')).toEqual(LLM_CHAIN);
	});
});

describe('#1420 budget — race cap + sequential slice (fair-share, then reserve-based per mechanism change in header)', () => {
	test('pin 10: hanging raced + hanging sequential legs; fast groq-position final leg IS attempted and returns within budget', async () => {
		const svc = svcWithChain(['raceA', 'raceB', 'raceC', 'hangD', 'groqFinal']);
		const start = Date.now();
		const result = await svc.execute(
			'llm',
			async (pk) => {
				if (pk === 'groqFinal') return delayed(20, 'from-groqFinal');
				return hang();
			},
			'default',
			{ totalTimeoutMs: 1800, perProviderTimeoutMs: 1200 },
		);
		const elapsed = Date.now() - start;
		expect(result).toBe('from-groqFinal');
		expect(elapsed).toBeLessThanOrEqual(1800 + 400);
	}, 15000);

	test('pin 11: race phase releases with ≥2/3 of the total budget remaining', async () => {
		const svc = svcWithChain(['raceA', 'raceB', 'raceC', 'seqD']);
		const start = Date.now();
		let seqStart = null;
		const result = await svc.execute(
			'llm',
			async (pk) => {
				if (pk === 'seqD') {
					seqStart = Date.now() - start;
					return 'from-seqD';
				}
				return hang();
			},
			'default',
			{ totalTimeoutMs: 1500, perProviderTimeoutMs: 1200 },
		);
		expect(result).toBe('from-seqD');
		// Race cap is floor(1500/3) = 500 → sequential starts at ~500ms,
		// leaving ~1000ms = 2/3 of the budget.
		expect(seqStart).not.toBeNull();
		expect(seqStart).toBeLessThanOrEqual(500 + 250);
		expect(1500 - seqStart).toBeGreaterThanOrEqual(1000 - 250);
	}, 15000);

	test('pin 14: all legs hang → honest failure and triedProviders contains EVERY leg', async () => {
		const svc = svcWithChain(['raceA', 'raceB', 'raceC', 'hangD', 'hangE']);
		let caught;
		try {
			await svc.execute('llm', async () => hang(), 'default', {
				totalTimeoutMs: 1500,
				perProviderTimeoutMs: 1000,
			});
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeDefined();
		expect(caught.allProvidersFailed).toBe(true);
		expect(caught.triedProviders).toEqual(['raceA', 'raceB', 'raceC', 'hangD', 'hangE']);
	}, 15000);

	test('† pin 12: last leg inherits ALL remaining budget — resolving after a fair-share slice but within remaining succeeds', async () => {
		// 'safety' raceCount is 1 → purely sequential.
		const svc = svcWithChain(['fastA', 'fastB', 'slowLast']);
		const result = await svc.execute(
			'safety',
			async (pk) => {
				if (pk === 'slowLast') return delayed(1200, 'from-slowLast');
				throw statusErr(503);
			},
			'default',
			{ totalTimeoutMs: 2400, perProviderTimeoutMs: 2000 },
		);
		// A fair-share cap for the last leg (2400/3 = 800) would have cut
		// slowLast at 800ms; the last-leg rule gives it the remaining
		// ~2400ms, so its 1200ms answer succeeds.
		expect(result).toBe('from-slowLast');
	}, 15000);

	test('T-1420-6′ (supersedes Rex T-1420-6): raced leg answering AFTER the total/3 cap loses the race; sequential leg serves', async () => {
		const svc = svcWithChain(['slowRace', 'hangB', 'hangC', 'seqD']);
		const result = await svc.execute(
			'llm',
			async (pk) => {
				if (pk === 'slowRace') return delayed(900, 'from-slowRace');
				if (pk === 'seqD') return 'from-seqD';
				return hang();
			},
			'default',
			{ totalTimeoutMs: 1500, perProviderTimeoutMs: 1200 },
		);
		// Race cap = floor(1500/3) = 500 < 900 → slowRace cannot win.
		expect(result).toBe('from-seqD');
	}, 15000);

	test('† T-1420-6′-under-cap: raced leg answering UNDER the total/3 cap still wins the race', async () => {
		const svc = svcWithChain(['fastRace', 'hangB', 'hangC', 'seqD']);
		const calls = [];
		const result = await svc.execute(
			'llm',
			async (pk) => {
				calls.push(pk);
				if (pk === 'fastRace') return delayed(250, 'from-fastRace');
				if (pk === 'seqD') return 'from-seqD';
				return hang();
			},
			'default',
			{ totalTimeoutMs: 1500, perProviderTimeoutMs: 1200 },
		);
		expect(result).toBe('from-fastRace');
		expect(calls).not.toContain('seqD');
	}, 15000);

	test('† pin 13: all-reachable — first provider answers fast, result returned, no sequential leg called', async () => {
		const svc = svcWithChain(['raceA', 'raceB', 'raceC', 'seqD']);
		const calls = [];
		const start = Date.now();
		const result = await svc.execute(
			'llm',
			async (pk) => {
				calls.push(pk);
				if (pk === 'raceA') return delayed(30, 'from-raceA');
				return hang();
			},
			'default',
			{ totalTimeoutMs: 2000, perProviderTimeoutMs: 1000 },
		);
		expect(result).toBe('from-raceA');
		expect(calls).not.toContain('seqD');
		expect(Date.now() - start).toBeLessThan(1000);
	}, 15000);

	test('† T-1420-7: all legs fail fast → honest failure, allProvidersFailed + full triedProviders, nothing fabricated', async () => {
		const svc = svcWithChain(['legA', 'legB', 'legC', 'legD']);
		let caught;
		try {
			await svc.execute(
				'llm',
				async () => {
					throw statusErr(503);
				},
				'default',
				{ totalTimeoutMs: 3000, perProviderTimeoutMs: 1000 },
			);
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeDefined();
		expect(caught.allProvidersFailed).toBe(true);
		expect(caught.triedProviders).toEqual(['legA', 'legB', 'legC', 'legD']);
		expect(typeof caught.totalElapsedMs).toBe('number');
	}, 15000);

	test('R1 (anchor, Quinn Pass A reconstruction): 11-leg chain, groq-position leg (index 9, NOT last) resolving at 4,000ms MUST serve', async () => {
		// Predecessors fail FAST (the Pass A regime: 401/402/404/410).
		// On fair-share (51d3f10d4) groqPosition's slice is
		// floor(~6000/2) = ~3,000ms < 4,000ms → cut, result lost → RED.
		// On reserve its slice is min(5000, ~6000 − 750) = 5,000ms → serves.
		const chain = [
			'raceA', 'raceB', 'raceC', 'seqD', 'seqE', 'seqF', 'seqG',
			'seqH', 'seqI', 'groqPosition', 'lastLeg',
		];
		const svc = svcWithChain(chain);
		const calls = [];
		const start = Date.now();
		const result = await svc.execute(
			'llm',
			async (pk) => {
				calls.push(pk);
				if (pk === 'groqPosition') return delayed(4000, 'from-groqPosition');
				if (pk === 'lastLeg') throw statusErr(404);
				throw statusErr(503);
			},
			'default',
			{ totalTimeoutMs: 6000, perProviderTimeoutMs: 5000 },
		);
		expect(result).toBe('from-groqPosition');
		expect(calls).not.toContain('lastLeg');
		expect(Date.now() - start).toBeLessThan(6000);
	}, 15000);

	test('R2: reserve bound — a hanging leg is cut at remaining − reserveMs × legsAfter, not at its fair share', async () => {
		// 'safety' raceCount is 1 → purely sequential. reserveMs seam 250:
		// hangFirst (legsLeft 3, legsAfter 2) funded slice =
		// min(2000, 1800 − 250×2) = 1,300ms. Fair-share would cut it at
		// max(750, floor(1800/3)) = 750ms → nextLeg would start ~750ms.
		const svc = svcWithChain(['hangFirst', 'nextLeg', 'tailLeg']);
		const start = Date.now();
		let nextStart = null;
		const calls = [];
		const result = await svc.execute(
			'safety',
			async (pk) => {
				calls.push(pk);
				if (pk === 'nextLeg') {
					nextStart = Date.now() - start;
					return 'from-nextLeg';
				}
				return hang();
			},
			'default',
			{ totalTimeoutMs: 1800, perProviderTimeoutMs: 2000, reserveMs: 250 },
		);
		expect(result).toBe('from-nextLeg');
		expect(calls).not.toContain('tailLeg');
		expect(nextStart).not.toBeNull();
		expect(nextStart).toBeGreaterThanOrEqual(1100);
		expect(nextStart).toBeLessThanOrEqual(1650);
	}, 15000);

	test('† R3: all-hang 11-leg chain → EVERY leg attempted, honest failure, within budget (regression — green under both formulas)', async () => {
		const chain = [
			'raceA', 'raceB', 'raceC', 'seqD', 'seqE', 'seqF', 'seqG',
			'seqH', 'seqI', 'groqPosition', 'lastLeg',
		];
		const svc = svcWithChain(chain);
		const start = Date.now();
		let caught;
		try {
			await svc.execute('llm', async () => hang(), 'default', {
				totalTimeoutMs: 3000,
				perProviderTimeoutMs: 350,
				reserveMs: 100,
			});
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeDefined();
		expect(caught.allProvidersFailed).toBe(true);
		expect(caught.triedProviders).toEqual(chain);
		expect(Date.now() - start).toBeLessThanOrEqual(3000 + 500);
	}, 15000);

	test('R4: exhaustion guard — non-last leg reached with remaining 600, legsLeft 2 → last leg still attempted', async () => {
		// 'safety' → sequential only. At penult: remaining ≈600 ≤
		// 750 × legsLeft (2) → exhaustion regime. The slice is capped
		// (perProvider seam 300) below the remaining budget, so a
		// hanging penult is cut and the last leg gets a real attempt
		// instead of the loop-top break skipping it. Green on shipped
		// fair-share and on reserve+fallback; red against the literal
		// floored reserve (see suite header).
		const svc = svcWithChain(['penult', 'lastLeg']);
		const start = Date.now();
		let lastStart = null;
		let caught;
		try {
			await svc.execute(
				'safety',
				async (pk) => {
					if (pk === 'lastLeg') lastStart = Date.now() - start;
					return hang();
				},
				'default',
				{ totalTimeoutMs: 600, perProviderTimeoutMs: 300 },
			);
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeDefined();
		expect(caught.allProvidersFailed).toBe(true);
		expect(caught.triedProviders).toEqual(['penult', 'lastLeg']);
		expect(lastStart).not.toBeNull();
		expect(lastStart).toBeLessThan(600);
		expect(Date.now() - start).toBeLessThanOrEqual(600 + 400);
	}, 15000);

	test('† pin 16: a leg that timed out in call 1 is circuit-open and absent from call 2 chain (cross-call regression)', async () => {
		const svc = svcWithStaticChain(['legA', 'legB'], { realCircuit: true });
		const result = await svc.execute(
			'safety',
			async (pk) => {
				if (pk === 'legA') return hang();
				return 'from-legB';
			},
			'default',
			{ totalTimeoutMs: 1200, perProviderTimeoutMs: 800 },
		);
		expect(result).toBe('from-legB');
		expect(svc.isCircuitOpen('legA', 'safety')).toBe(true);
		expect(svc.getAvailableChain('safety')).toEqual(['legB']);
	}, 15000);
});
