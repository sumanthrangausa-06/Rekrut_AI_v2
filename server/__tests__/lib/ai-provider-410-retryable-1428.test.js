/**
 * #1428 — lib/ai-provider.js: 410 Gone is not in RETRYABLE_STATUS.
 *
 * Follow-up to #1424 / PR #1427, which fixed the identical defect in
 * lib/qp-provider.js: a retired-model 410 from a cascade leg was
 * non-retryable, so the sequential cascade threw instead of falling
 * through to the next leg. 410 is the same dead-model signal class as
 * the already-retryable 404.
 *
 * Scope: lib/ai-provider.js only. qp-provider is already fixed.
 *
 * DIVERGENCE FOUND AT RED PHASE (flagged to Lead + reviewer-of-record):
 * ai-provider's isRetryable() differs from qp-provider's at the tail —
 * qp returns false by default, ai-provider returns TRUE by default
 * ("Default: treat unknown errors as retryable so the fallback chain
 * always continues"). So in ai-provider no status returns false from
 * isRetryable(), and a 410 already falls through via that default.
 * Pinning "422 returns false" would require changing the default —
 * a scope expansion beyond the approved one-line parity fix, NOT done
 * here. Instead (c) pins the scope guard on the SET itself: 422 must
 * not be added, and the set must end up exactly at parity with
 * qp-provider's set. (a)/(b) are regression pins (they pass pre-fix
 * via the default-true fallback); the red pins are (c)-set and (d).
 *
 * Only lib/db is stubbed. Real SDK constructors run (no network).
 * These unit tests do NOT satisfy the E2E-on-dev gate; they pin the
 * retry classification only. Quinn runs the E2E gate separately.
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
beforeEach(() => {
	savedEnv = { ...process.env };
	jest.spyOn(console, 'log').mockImplementation(() => {});
	jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	for (const k of ENV_KEYS) delete process.env[k];
	for (const k of ENV_KEYS) if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
	jest.restoreAllMocks();
	jest.resetModules();
});

describe('#1428 ai-provider 410 handling (parity with qp-provider #1424 fix)', () => {
	test('HTTP 410 (Gone — retired model) via err.status is retryable so the cascade reaches later providers', () => {
		const svc = loadProvider({});
		const err = new Error('410 status code (no body)');
		err.status = 410;
		expect(svc.isRetryable(err)).toBe(true);
	});

	test('HTTP 410 via err.statusCode is retryable', () => {
		const svc = loadProvider({});
		const err = new Error('410 status code (no body)');
		err.statusCode = 410;
		expect(svc.isRetryable(err)).toBe(true);
	});

	test('scope guard: RETRYABLE_STATUS is exactly the qp-parity set — 410 added, 422 not added', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../../lib/ai-provider.js'), 'utf8');
		const m = src.match(/RETRYABLE_STATUS = new Set\(\[([^\]]*)\]\)/);
		expect(m).not.toBeNull();
		const statuses = m[1].split(',').map((s) => Number(s.trim()));
		expect(statuses).toEqual([400, 401, 402, 404, 410, 429, 500, 502, 503, 504]);
		expect(statuses).not.toContain(422);
	});

	test('source contains 410 in the RETRYABLE_STATUS set', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../../lib/ai-provider.js'), 'utf8');
		expect(src).toMatch(/RETRYABLE_STATUS = new Set\(\[[^\]]*\b410\b[^\]]*\]\)/);
	});
});
