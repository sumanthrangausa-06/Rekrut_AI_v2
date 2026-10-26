/**
 * #1486 — lib/qp-provider.js openai leg must gate on the key alone,
 * mirroring lib/ai-provider.js. Before this fix the QP leg required
 * `process.env.OPENAI_BASE_URL && openaiKey`, so in an env with a key
 * but no OPENAI_BASE_URL set (OPENAI_BASE_URL is optional everywhere
 * else — the SDK and the raw-fetch fallbacks default to
 * api.openai.com) the QP cascade silently lost its entire openai leg
 * while ai-provider kept it.
 *
 * Only lib/db is stubbed. Real SDK constructors run (no network).
 * These unit tests do NOT satisfy the E2E-on-dev gate; they pin construction.
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
	return require('../../../lib/qp-provider');
}
beforeEach(() => { savedEnv = { ...process.env }; });
afterEach(() => {
	for (const k of ENV_KEYS) delete process.env[k];
	for (const k of ENV_KEYS) if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
	jest.resetModules();
});
const tk = (s) => ['test', s, 'key'].join('-');

describe('#1486 qp-provider openai leg gates on key alone', () => {
	test('(a) openai key ONLY in AI_KEYS_JSON, OPENAI_BASE_URL unset -> client built', () => {
		const svc = loadProvider({ AI_KEYS_JSON: JSON.stringify({ openai: tk('openaijson') }) });
		expect(svc.clients.openai).toBeDefined();
		expect(svc.openaiApiKey).toBe(tk('openaijson'));
		expect(svc.openaiBaseUrl).toBeFalsy();
		expect(svc.isProviderAvailable('openai')).toBe(true);
		expect(svc.isProviderAvailable('openai_tts')).toBe(true);
		// SDK defaults to api.openai.com when no baseURL is passed.
		expect(svc.clients.openai.baseURL).toBe('https://api.openai.com/v1');
	});
	test('(b) openai key ONLY discrete (OPENAI_API_KEY), no base URL -> client built', () => {
		const svc = loadProvider({ OPENAI_API_KEY: tk('openaienv') });
		expect(svc.clients.openai).toBeDefined();
		expect(svc.openaiApiKey).toBe(tk('openaienv'));
		expect(svc.openaiBaseUrl).toBeFalsy();
		expect(svc.isProviderAvailable('openai')).toBe(true);
	});
	test('(c) key in AI_KEYS_JSON + OPENAI_BASE_URL set -> client built with that base URL', () => {
		const svc = loadProvider({
			AI_KEYS_JSON: JSON.stringify({ openai: tk('openaijson') }),
			OPENAI_BASE_URL: 'https://example.invalid/v1',
		});
		expect(svc.clients.openai).toBeDefined();
		expect(svc.openaiApiKey).toBe(tk('openaijson'));
		expect(svc.openaiBaseUrl).toBe('https://example.invalid/v1');
		expect(svc.clients.openai.baseURL).toBe('https://example.invalid/v1');
	});
	test('(d) OPENAI_BASE_URL set, NO key anywhere -> no client (fail-closed)', () => {
		const svc = loadProvider({ OPENAI_BASE_URL: 'https://example.invalid/v1' });
		expect(svc.clients.openai).toBeUndefined();
		expect(svc.openaiApiKey).toBeFalsy();
		expect(svc.isProviderAvailable('openai')).toBe(false);
	});
});
