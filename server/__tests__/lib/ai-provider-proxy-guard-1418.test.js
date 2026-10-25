/**
 * #1418 — malformed HTTPS_PROXY must not crash ai-provider at startup.
 *
 * lib/ai-provider.js _initClients() (added by #1406 / PR #1413) constructed
 * `new HttpsProxyAgent(proxyUrl)` unguarded; it runs from the constructor at
 * singleton load, and `new HttpsProxyAgent('::bad url::')` throws
 * ERR_INVALID_URL — so a typo'd operator env took down every importer.
 *
 * Pins:
 *  - malformed HTTPS_PROXY (and https_proxy) → module loads, clients
 *    construct with NO agent (direct egress, the pre-#1406 behaviour)
 *  - a warning is logged on the fallback path, and the logged text NEVER
 *    contains the proxy URL or credentials embedded in it
 *  - no-proxy behaviour unchanged (no agent)
 *  - valid-proxy behaviour unchanged (agent attached)
 *
 * Only lib/db is stubbed (the singleton constructor fire-and-forgets a
 * persisted-state load). The REAL SDK constructors run. These unit tests do
 * NOT satisfy the E2E-on-dev gate for #1418 (real server booted three ways
 * against a fresh-install DB); they pin the construction behaviour only.
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(async () => ({ rows: [] })),
}));

const ENV_KEYS = [
	'HTTPS_PROXY',
	'https_proxy',
	'HTTP_PROXY',
	'http_proxy',
	'AI_KEYS_JSON',
	'NIM_API_KEY',
	'NVIDIA_NIM_API_KEY',
	'OPENAI_BASE_URL',
	'OPENAI_API_KEY',
	'POLSIA_API_KEY',
	'GROQ_API_KEY',
];

let savedEnv;
let warnSpy;

function loadProvider(env) {
	jest.resetModules();
	for (const k of ENV_KEYS) delete process.env[k];
	Object.assign(process.env, env);
	return require('../../../lib/ai-provider');
}

const KEY_ENV = {
	AI_KEYS_JSON: JSON.stringify({ openai: 'test-openai-key', groq: 'test-groq-key' }),
	NIM_API_KEY: 'test-nim-key',
	POLSIA_API_KEY: 'test-polsia-key',
};
const CLIENT_NAMES = ['anthropic', 'openai', 'nim', 'groq'];

beforeEach(() => {
	savedEnv = { ...process.env };
	warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
	jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
	for (const k of ENV_KEYS) delete process.env[k];
	for (const k of ENV_KEYS) if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
	jest.restoreAllMocks();
	jest.resetModules();
});

describe('#1418 malformed proxy guard', () => {
	test('malformed HTTPS_PROXY: module loads, clients construct with no agent', () => {
		const svc = loadProvider({ ...KEY_ENV, HTTPS_PROXY: '::bad url::' });
		for (const name of CLIENT_NAMES) {
			expect(svc.clients[name]).toBeDefined();
			expect(svc.clients[name].httpAgent).toBeFalsy();
		}
	});

	test('malformed https_proxy (lowercase): module loads, clients construct with no agent', () => {
		const svc = loadProvider({ ...KEY_ENV, https_proxy: '::bad url::' });
		for (const name of CLIENT_NAMES) {
			expect(svc.clients[name]).toBeDefined();
			expect(svc.clients[name].httpAgent).toBeFalsy();
		}
	});

	test('fallback warning never includes the proxy URL or embedded credentials', () => {
		const malformed = 'http://proxyuser:secretpass@::bad';
		loadProvider({ ...KEY_ENV, HTTPS_PROXY: malformed });
		const warned = warnSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
		expect(warned.length).toBeGreaterThan(0);
		expect(warned).not.toContain(malformed);
		expect(warned).not.toContain('secretpass');
		expect(warned).not.toContain('proxyuser');
	});

	test('no proxy env: no agent, no fallback warning (unchanged)', () => {
		const svc = loadProvider({ ...KEY_ENV });
		for (const name of CLIENT_NAMES) {
			expect(svc.clients[name]).toBeDefined();
			expect(svc.clients[name].httpAgent).toBeFalsy();
		}
		const warned = warnSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
		expect(warned).not.toMatch(/proxy/i);
	});

	test('valid proxy: agent attached to SDK clients (unchanged)', () => {
		const svc = loadProvider({ ...KEY_ENV, HTTPS_PROXY: 'http://127.0.0.1:18080' });
		for (const name of CLIENT_NAMES) {
			expect(svc.clients[name]).toBeDefined();
			const agent = svc.clients[name].httpAgent;
			expect(agent?.constructor?.name).toBe('HttpsProxyAgent');
			expect(String(agent.proxy)).toContain('127.0.0.1:18080');
		}
	});
});
