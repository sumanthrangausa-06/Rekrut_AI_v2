/**
 * #1438 — clamp callMeta budget/reserve test seams in lib/ai-provider.js
 * (follow-up filed from the two #1436 reviews of the #1420 seams).
 *
 * Defect pinned: in execute(), the three test-seam overrides are gated
 * by Number.isFinite only — perProviderTimeoutMs (~:970),
 * totalTimeoutMs (~:984), reserveMs (~:1064, read inside the
 * sequential loop). Finite-but-invalid values (0, negative,
 * absurd-huge) are accepted and distort the slice arithmetic:
 * reserveMs=0 degrades the reserve rule to greedy, a negative
 * reserveMs lets a funded-regime allowance exceed the remaining
 * budget, a 0 total budget makes the loop-top break skip every leg,
 * a 0 per-provider budget cuts every non-last leg instantly.
 *
 * Fix pinned here (lib/ai-provider.js ONLY): at each seam's single
 * read site, an out-of-range override falls back to the production
 * default (NOT clamp-to-boundary):
 *  - perProviderTimeoutMs: > 0 and ≤ 10× the modality per-provider
 *    default (8000ms for every modality today → ceiling 80,000ms),
 *    else 8000ms default behaviour.
 *  - totalTimeoutMs: > 0 and ≤ 10× the modality total default
 *    (TOTAL_CASCADE_TIMEOUT[modality] || 30000 — llm 12,000 →
 *    ceiling 120,000; safety 10,000 → ceiling 100,000), else the
 *    modality default.
 *  - reserveMs: > 0 and ≤ the EFFECTIVE perProviderTimeoutMs (after
 *    its own validation), else the 750ms production default.
 * In-range values and absent overrides behave exactly as before.
 *
 * Technique mirrors the 1420 suite exactly: only lib/db is stubbed;
 * the chain is stubbed at the module's own seam (getAvailableChain);
 * real timers; behaviour is observed via the returned result, the
 * next leg's start time, and triedProviders — never via internals.
 * These unit tests do NOT satisfy the E2E-on-dev gate; Quinn re-runs
 * that independently.
 *
 * Pins marked † are regression pins: they pass on pristine dev and
 * must keep passing. All other pins are RED on pristine dev
 * (5ab54d37c) for the reason stated in each pin.
 *
 * #1442 (follow-up from the PR #1440 ai-engineer review): the #1438
 * pins above prove out-of-range values fall back, but nothing pinned
 * the EXACT boundary values of the `<=` clamps — a refactor to `<`
 * would pass every pin above while breaking legitimate boundary
 * overrides. The final describe block pins the boundaries as
 * ACCEPTED (in-range) behaviour: perProviderTimeoutMs = 10x the
 * modality default, totalTimeoutMs = 10x the modality total default,
 * and reserveMs = the effective perProviderTimeoutMs. Each #1442 pin
 * is GREEN on current dev and goes RED if its clamp's `<=` becomes
 * `<` (mutation-verified by Nova, mutation not committed).
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
// execute() timing pins: chain stubbed at the 1430/1420 seam.
function svcWithChain(chain) {
	const svc = loadProvider({});
	svc.getAvailableChain = () => chain.slice();
	return svc;
}
const hang = () => new Promise(() => {});
const delayed = (ms, val) => new Promise((r) => setTimeout(() => r(val), ms));

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

describe('#1438 perProviderTimeoutMs seam — invalid override falls back to the 8000ms default', () => {
	// 'safety' raceCount is 1 → purely sequential. With the default
	// per-provider budget, slowFirst's funded slice is
	// min(8000, 2000 − 750) = 1,250ms, so its 300ms answer serves.
	// With an accepted 0/negative override the slice is ≤0 and
	// slowFirst is cut instantly, so lastLeg serves instead.
	test.each([0, -5000])(
		'perProviderTimeoutMs=%s → default behaviour: slow first leg (300ms) still serves',
		async (badOverride) => {
			const svc = svcWithChain(['slowFirst', 'lastLeg']);
			const calls = [];
			const result = await svc.execute(
				'safety',
				async (pk) => {
					calls.push(pk);
					if (pk === 'slowFirst') return delayed(300, 'from-slowFirst');
					return 'from-lastLeg';
				},
				'default',
				{ totalTimeoutMs: 2000, perProviderTimeoutMs: badOverride },
			);
			expect(result).toBe('from-slowFirst');
			expect(calls).not.toContain('lastLeg');
		},
		15000,
	);

	test('perProviderTimeoutMs absurd-huge (999999999) → default behaviour: first leg is cut at the 8000ms default slice, last leg serves', async () => {
		// Funded slice with total 10,000 and the 750 reserve:
		// min(effectivePerProvider, 10000 − 750). Default 8000 cuts
		// slowFirst at 8,000ms; an accepted huge override would give
		// it 9,250ms and its 8,500ms answer would serve — that is
		// the RED state on pristine dev.
		const svc = svcWithChain(['slowFirst', 'lastLeg']);
		const calls = [];
		const result = await svc.execute(
			'safety',
			async (pk) => {
				calls.push(pk);
				if (pk === 'slowFirst') return delayed(8500, 'from-slowFirst');
				return 'from-lastLeg';
			},
			'default',
			{ totalTimeoutMs: 10000, perProviderTimeoutMs: 999999999 },
		);
		expect(result).toBe('from-lastLeg');
		expect(calls).toEqual(['slowFirst', 'lastLeg']);
	}, 20000);
});

describe('#1438 totalTimeoutMs seam — invalid override falls back to the modality default', () => {
	// With an accepted 0/negative total budget, the loop-top break
	// (elapsed >= totalTimeoutMs) fires before the first leg, so NO
	// leg is attempted and execute() throws. With the safety default
	// (10,000ms) the fast first leg serves immediately.
	test.each([0, -1000])(
		'totalTimeoutMs=%s → default behaviour: fast first leg is attempted and serves',
		async (badOverride) => {
			const svc = svcWithChain(['fastFirst', 'lastLeg']);
			const calls = [];
			const result = await svc.execute(
				'safety',
				async (pk) => {
					calls.push(pk);
					return 'from-fastFirst';
				},
				'default',
				{ totalTimeoutMs: badOverride, perProviderTimeoutMs: 1000 },
			);
			expect(result).toBe('from-fastFirst');
			expect(calls).toEqual(['fastFirst']);
		},
		15000,
	);

	test('totalTimeoutMs absurd-huge (999999999) → default behaviour: race cap is floor(llm default 12000/3)=4000, so a 4500ms raced leg loses and the sequential leg serves', async () => {
		// Race cap = min(perProviderTimeoutMs, floor(total/3)).
		// Accepted-huge total → cap = min(6000, huge) = 6,000ms and
		// slowRace's 4,500ms answer wins the race (RED on pristine).
		// Default llm total 12,000 → cap = 4,000ms, slowRace is cut,
		// the race fails at ~4,000ms and seqD serves.
		const svc = svcWithChain(['slowRace', 'hangB', 'hangC', 'seqD']);
		const result = await svc.execute(
			'llm',
			async (pk) => {
				if (pk === 'slowRace') return delayed(4500, 'from-slowRace');
				if (pk === 'seqD') return 'from-seqD';
				return hang();
			},
			'default',
			{ totalTimeoutMs: 999999999, perProviderTimeoutMs: 6000 },
		);
		expect(result).toBe('from-seqD');
	}, 15000);
});

describe('#1438 reserveMs seam — invalid override falls back to the 750ms default', () => {
	// Total 1,800 / per-provider 2,000 / 3 legs: with the 750
	// default the budget is in the EXHAUSTION regime
	// (1800 ≤ 750×3), so hangFirst's slice is
	// min(2000, 1800, max(750, floor(1800/3))) = 750ms and nextLeg
	// starts at ~750ms. With reserveMs=0 accepted, hangFirst's
	// funded slice is min(2000, 1800) = 1,800ms (greedy — the whole
	// budget); with a negative reserve it is min(2000, 1800+1000)
	// = 2,000ms. Either way nextLeg is never attempted before the
	// loop-top break — the RED state on pristine dev.
	test.each([0, -500])(
		'reserveMs=%s → default behaviour: hanging first leg is cut at ~750ms and nextLeg serves',
		async (badOverride) => {
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
				{ totalTimeoutMs: 1800, perProviderTimeoutMs: 2000, reserveMs: badOverride },
			);
			expect(result).toBe('from-nextLeg');
			expect(calls).not.toContain('tailLeg');
			expect(nextStart).not.toBeNull();
			expect(nextStart).toBeGreaterThanOrEqual(550);
			expect(nextStart).toBeLessThanOrEqual(1250);
		},
		15000,
	);

	test('reserveMs absurd-huge (999999999) → default behaviour: funded-regime slice (remaining − 750×legsAfter) applies', async () => {
		// Total 3,000 / per-provider 2,000 / 3 legs. Default reserve
		// 750: 3000 > 750×3 → FUNDED, hangFirst's slice =
		// min(2000, 3000 − 750×2) = 1,500ms, nextLeg starts ~1,500ms.
		// An accepted huge reserve forces the EXHAUSTION regime:
		// slice = min(2000, 3000, max(750, floor(3000/3))) = 1,000ms,
		// nextLeg starts ~1,000ms — the RED state on pristine dev.
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
			{ totalTimeoutMs: 3000, perProviderTimeoutMs: 2000, reserveMs: 999999999 },
		);
		expect(result).toBe('from-nextLeg');
		expect(calls).not.toContain('tailLeg');
		expect(nextStart).not.toBeNull();
		expect(nextStart).toBeGreaterThanOrEqual(1300);
		expect(nextStart).toBeLessThanOrEqual(1850);
	}, 15000);

	test('† reserveMs=250 (in-range) is still honoured exactly as before — hanging first leg cut at remaining − 250×legsAfter = 1300ms', async () => {
		// Byte-identical to 1420 pin R2: an in-range override must
		// NOT be replaced by the default. Regression pin — green on
		// pristine dev and after the fix.
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
});

describe('#1442 exact-boundary pins — boundary values are ACCEPTED (<= clamps, not <)', () => {
	test('perProviderTimeoutMs = exactly 10x default (80000) is accepted: slow first leg (8500ms) still serves', async () => {
		// Safety sequential, total 10,000: funded slice with the
		// boundary per-provider value = min(80000, 10000 − 750) =
		// 9,250ms, so slowFirst's 8,500ms answer serves. If the
		// boundary were rejected (fallback 8000, or a `<` clamp), the
		// slice would be min(8000, 9250) = 8,000ms, slowFirst would
		// be cut, and lastLeg would serve.
		const svc = svcWithChain(['slowFirst', 'lastLeg']);
		const calls = [];
		const result = await svc.execute(
			'safety',
			async (pk) => {
				calls.push(pk);
				if (pk === 'slowFirst') return delayed(8500, 'from-slowFirst');
				return 'from-lastLeg';
			},
			'default',
			{ totalTimeoutMs: 10000, perProviderTimeoutMs: 80000 },
		);
		expect(result).toBe('from-slowFirst');
		expect(calls).not.toContain('lastLeg');
	}, 20000);

	test('totalTimeoutMs = exactly 10x llm default (120000) is accepted: race cap is min(6000, 40000)=6000, so a 4500ms raced leg wins the race', async () => {
		// Race cap = min(perProviderTimeoutMs, floor(total/3)).
		// Boundary total accepted → cap = min(6000, 40000) = 6,000ms
		// and slowRace's 4,500ms answer wins the race. If the
		// boundary were rejected (fallback llm total 12,000, or a
		// `<` clamp), the cap would be min(6000, 4000) = 4,000ms,
		// slowRace would be cut, and the sequential leg would serve.
		const svc = svcWithChain(['slowRace', 'hangB', 'hangC', 'seqD']);
		const result = await svc.execute(
			'llm',
			async (pk) => {
				if (pk === 'slowRace') return delayed(4500, 'from-slowRace');
				if (pk === 'seqD') return 'from-seqD';
				return hang();
			},
			'default',
			{ totalTimeoutMs: 120000, perProviderTimeoutMs: 6000 },
		);
		expect(result).toBe('from-slowRace');
	}, 15000);

	test('reserveMs = exactly the effective perProviderTimeoutMs (2000) is accepted: exhaustion-regime slice cuts hanging first leg at ~1000ms', async () => {
		// Total 3,000 / per-provider 2,000 / 3 legs. Boundary reserve
		// accepted (2000): 3000 <= 2000×3 → EXHAUSTION regime, slice =
		// min(2000, 3000, max(750, floor(3000/3))) = 1,000ms. If the
		// boundary were rejected (fallback 750, or a `<` clamp):
		// 3000 > 750×3 → FUNDED, slice = min(2000, 3000 − 750×2) =
		// 1,500ms and nextLeg would start at ~1,500ms instead.
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
			{ totalTimeoutMs: 3000, perProviderTimeoutMs: 2000, reserveMs: 2000 },
		);
		expect(result).toBe('from-nextLeg');
		expect(calls).not.toContain('tailLeg');
		expect(nextStart).not.toBeNull();
		expect(nextStart).toBeGreaterThanOrEqual(900);
		expect(nextStart).toBeLessThanOrEqual(1400);
	}, 15000);

	test('reserveMs = exactly the effective perProviderTimeoutMs at its own 10x ceiling (80000) is accepted: exhaustion-regime slice cuts hanging first leg at ~1000ms', async () => {
		// Same arithmetic as the previous pin, but the effective
		// per-provider value is itself the 80,000 boundary:
		// reserve 80,000 <= effective 80,000 → accepted → EXHAUSTION
		// (3000 <= 80000×3), slice = min(80000, 3000, max(750,
		// floor(3000/3))) = 1,000ms. Rejected on either clamp → the
		// 750 fallback gives the FUNDED 1,500ms slice instead.
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
			{ totalTimeoutMs: 3000, perProviderTimeoutMs: 80000, reserveMs: 80000 },
		);
		expect(result).toBe('from-nextLeg');
		expect(calls).not.toContain('tailLeg');
		expect(nextStart).not.toBeNull();
		expect(nextStart).toBeGreaterThanOrEqual(900);
		expect(nextStart).toBeLessThanOrEqual(1400);
	}, 15000);
});
