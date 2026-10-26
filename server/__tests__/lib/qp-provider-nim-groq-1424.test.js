/**
 * #1424 — lib/qp-provider.js NIM + Groq follow-up to #1414.
 *
 * Defects pinned:
 *  - NIM gated on legacy NVIDIA_NIM_API_KEY (never set in live env) instead of
 *    ai-provider's resolution: getAiKey('nvidia','NIM_API_KEY') =
 *    AI_KEYS_JSON.nvidia first, else NIM_API_KEY. ai-provider does NOT read
 *    NVIDIA_NIM_API_KEY at all, so legacy-only must NOT enable NIM here either.
 *  - groq_llama_8b (llama-3.1-8b-instant) absent from live Groq models list
 *    (verified 2026-10-18, GET api.groq.com/openai/v1/models, HTTP 200,
 *    11 models). No verified like-for-like replacement → REMOVED, fail-closed,
 *    exactly as #1414 removed groq_llama_70b.
 *
 * Only lib/db is stubbed. Real SDK constructors run (no network).
 * These unit tests do NOT satisfy the E2E-on-dev gate; they pin construction.
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
	return require('../../../lib/qp-provider');
}
beforeEach(() => { savedEnv = { ...process.env }; });
afterEach(() => {
	for (const k of ENV_KEYS) delete process.env[k];
	for (const k of ENV_KEYS) if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
	jest.resetModules();
});
const tk = (s) => ['test', s, 'key'].join('-');

describe('#1424 qp-provider NIM key resolution (mirrors ai-provider)', () => {
	test('NIM attempted when only NIM_API_KEY is set', () => {
		const svc = loadProvider({ NIM_API_KEY: tk('nim') });
		expect(svc.nimAvailable).toBe(true);
		expect(svc.clients.nim).toBeDefined();
		expect(svc.nimApiKey).toBe(tk('nim'));
	});
	test('NIM attempted via AI_KEYS_JSON nvidia key (takes precedence)', () => {
		const svc = loadProvider({ AI_KEYS_JSON: JSON.stringify({ nvidia: tk('nimjson') }), NIM_API_KEY: tk('nimenv') });
		expect(svc.nimAvailable).toBe(true);
		expect(svc.clients.nim).toBeDefined();
		expect(svc.nimApiKey).toBe(tk('nimjson'));
	});
	test('NIM not attempted when neither NIM_API_KEY nor AI_KEYS_JSON.nvidia is set', () => {
		const svc = loadProvider({});
		expect(svc.nimAvailable).toBe(false);
		expect(svc.clients.nim).toBeUndefined();
	});
	test('legacy NVIDIA_NIM_API_KEY alone does NOT enable NIM (matches ai-provider, which never reads it)', () => {
		const svc = loadProvider({ NVIDIA_NIM_API_KEY: tk('legacy') });
		expect(svc.nimAvailable).toBe(false);
		expect(svc.clients.nim).toBeUndefined();
	});
	test('NIM provider availability follows the NIM client for nim_* keys', () => {
		const svc = loadProvider({ NIM_API_KEY: tk('nim') });
		expect(svc.isProviderAvailable('nim_llama_8b')).toBe(true);
		const svc2 = loadProvider({});
		expect(svc2.isProviderAvailable('nim_llama_8b')).toBe(false);
	});
});

describe('#1424 qp-provider NIM 410 handling (consequence of enabling the NIM leg)', () => {
	test('HTTP 410 (Gone — retired NIM model) is retryable so the cascade reaches later providers', () => {
		const svc = loadProvider({ NIM_API_KEY: tk('nim'), GROQ_API_KEY: tk('groq') });
		const err = new Error('410 status code (no body)');
		err.status = 410;
		expect(svc.isRetryable(err)).toBe(true);
	});
});

describe('#1424 qp-provider groq_llama_8b removal (live-verified absent)', () => {
	test('groq_llama_8b is gone from all llm chains', () => {
		const svc = loadProvider({ GROQ_API_KEY: tk('groq') });
		for (const variant of ['default', 'quality', 'efficient', 'reasoning']) {
			expect(svc.getChain('llm', variant)).not.toContain('groq_llama_8b');
		}
		// efficient chain (its former home) is not left empty
		expect(svc.getChain('llm', 'efficient').length).toBeGreaterThan(0);
	});
	test('stale model id and key are gone from source', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../../lib/qp-provider.js'), 'utf8');
		expect(src).not.toContain('llama-3.1-8b-instant');
		expect(src).not.toContain('groq_llama_8b');
		// NIM's distinct model of the same base name must remain untouched
		expect(src).toContain('meta/llama-3.1-8b-instruct');
	});
	test('groq_gpt_oss (verified-live id) remains in the cascade', () => {
		const svc = loadProvider({ GROQ_API_KEY: tk('groq') });
		expect(svc.getChain('llm', 'default')).toContain('groq_gpt_oss');
		expect(svc._getModelName('groq_gpt_oss')).toBe('openai/gpt-oss-120b');
	});
});
