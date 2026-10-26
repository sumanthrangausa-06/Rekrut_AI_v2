/**
 * #1484 — lib/qp-provider.js must resolve groq/cerebras/polsia/openai/deepgram
 * keys through getAiKey (AI_KEYS_JSON first, discrete env fallback), exactly
 * like lib/ai-provider.js. Before this fix only the NIM leg (#1424) used
 * getAiKey; every other leg read process.env.<VAR> directly, so on
 * environments where keys live only inside AI_KEYS_JSON (Render 20-var
 * limit) the QP cascade silently lost those legs — the QP-500 staging
 * diagnosis root cause.
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

describe('#1484 qp-provider groq/cerebras/deepgram via AI_KEYS_JSON only', () => {
	test('groq available when the key exists ONLY in AI_KEYS_JSON', () => {
		const svc = loadProvider({ AI_KEYS_JSON: JSON.stringify({ groq: tk('groqjson') }) });
		expect(svc.groqAvailable).toBe(true);
		expect(svc.clients.groq).toBeDefined();
		expect(svc.groqApiKey).toBe(tk('groqjson'));
	});
	test('cerebras available when the key exists ONLY in AI_KEYS_JSON', () => {
		const svc = loadProvider({ AI_KEYS_JSON: JSON.stringify({ cerebras: tk('cerebrasjson') }) });
		expect(svc.cerebrasAvailable).toBe(true);
		expect(svc.clients.cerebras).toBeDefined();
	});
	test('deepgram available when the key exists ONLY in AI_KEYS_JSON', () => {
		const svc = loadProvider({ AI_KEYS_JSON: JSON.stringify({ deepgram: tk('dgjson') }) });
		expect(svc.deepgramAvailable).toBe(true);
		expect(svc.deepgramApiKey).toBe(tk('dgjson'));
	});
	test('all three legs together from one AI_KEYS_JSON (staging shape)', () => {
		const svc = loadProvider({
			AI_KEYS_JSON: JSON.stringify({ groq: tk('g'), cerebras: tk('c'), deepgram: tk('d') }),
		});
		expect(svc.groqAvailable).toBe(true);
		expect(svc.cerebrasAvailable).toBe(true);
		expect(svc.deepgramAvailable).toBe(true);
	});
});

describe('#1484 qp-provider polsia/openai via AI_KEYS_JSON only', () => {
	test('polsia (anthropic) client built when the key exists ONLY in AI_KEYS_JSON', () => {
		const svc = loadProvider({ AI_KEYS_JSON: JSON.stringify({ polsia: tk('polsiajson') }) });
		expect(svc.clients.anthropic).toBeDefined();
	});
	test('openai client built when the key exists ONLY in AI_KEYS_JSON (base URL discrete)', () => {
		const svc = loadProvider({
			AI_KEYS_JSON: JSON.stringify({ openai: tk('openaijson') }),
			OPENAI_BASE_URL: 'https://example.invalid/v1',
		});
		expect(svc.clients.openai).toBeDefined();
		expect(svc.openaiApiKey).toBe(tk('openaijson'));
	});
});

describe('#1484 qp-provider discrete fallback + precedence (no regression)', () => {
	test('discrete-only env still enables groq/cerebras/deepgram', () => {
		const svc = loadProvider({
			GROQ_API_KEY: tk('groqenv'),
			CEREBRAS_API_KEY: tk('cerebrasenv'),
			DEEPGRAM_API_KEY: tk('dgenv'),
		});
		expect(svc.groqAvailable).toBe(true);
		expect(svc.groqApiKey).toBe(tk('groqenv'));
		expect(svc.cerebrasAvailable).toBe(true);
		expect(svc.deepgramAvailable).toBe(true);
		expect(svc.deepgramApiKey).toBe(tk('dgenv'));
	});
	test('AI_KEYS_JSON takes precedence over the discrete var (ai-provider semantics)', () => {
		const svc = loadProvider({
			AI_KEYS_JSON: JSON.stringify({ groq: tk('groqjson'), deepgram: tk('dgjson') }),
			GROQ_API_KEY: tk('groqenv'),
			DEEPGRAM_API_KEY: tk('dgenv'),
		});
		expect(svc.groqApiKey).toBe(tk('groqjson'));
		expect(svc.deepgramApiKey).toBe(tk('dgjson'));
	});
	test('malformed AI_KEYS_JSON falls back to the discrete var', () => {
		const svc = loadProvider({ AI_KEYS_JSON: '{not json', GROQ_API_KEY: tk('groqenv') });
		expect(svc.groqAvailable).toBe(true);
		expect(svc.groqApiKey).toBe(tk('groqenv'));
	});
	test('no keys anywhere: every leg stays unavailable (fail-closed)', () => {
		const svc = loadProvider({});
		expect(svc.groqAvailable).toBe(false);
		expect(svc.cerebrasAvailable).toBe(false);
		expect(svc.deepgramAvailable).toBe(false);
		expect(svc.clients.groq).toBeUndefined();
		expect(svc.clients.cerebras).toBeUndefined();
		expect(svc.clients.anthropic).toBeUndefined();
		expect(svc.clients.openai).toBeUndefined();
	});
});
