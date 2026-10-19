/**
 * #1406 — lib/ai-provider.js cascade must be reachable where egress needs a proxy.
 *
 * Defects pinned (STOP 1 on #1406, grounded in lib/ai-provider.js _initClients):
 *  - SDK clients (openai / @anthropic-ai/sdk) were constructed with no
 *    httpAgent, so they ignore HTTPS_PROXY and every cascade attempt fails
 *    with "Connection error" on hosts whose egress requires a proxy
 *    (re-proved by the #1386 lane + Quinn gate: 5/5 providers failed from
 *    Node while curl/direct-HTTPS through the proxy succeeded).
 *  - NIM key read as NVIDIA_NIM_API_KEY while the env carries NIM_API_KEY,
 *    so NIM was never attempted.
 *  - The OpenAI client was gated on OPENAI_BASE_URL being set, despite an
 *    `openai` key in AI_KEYS_JSON.
 *  - The Groq model id llama-3.3-70b-versatile is stale (404 model_not_found).
 *
 * Only lib/db is stubbed (the singleton constructor fire-and-forgets a
 * persisted-state load). The REAL SDK constructors run — client construction
 * is local and makes no network calls. These unit tests do NOT satisfy the
 * E2E-on-dev gate for #1406 (one real provider call through the cascade on a
 * fresh-install dev build); they pin the construction behaviour only.
 */
const fs = require('node:fs');
const path = require('node:path');
const { NoProxyHttpsProxyAgent } = require('../../../lib/proxy-env');

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

function loadProvider(env) {
	jest.resetModules();
	for (const k of ENV_KEYS) delete process.env[k];
	Object.assign(process.env, env);
	return require('../../../lib/ai-provider');
}

beforeEach(() => {
	savedEnv = { ...process.env };
});

afterEach(() => {
	for (const k of ENV_KEYS) delete process.env[k];
	for (const k of ENV_KEYS) if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
	jest.resetModules();
});

const PROXY_ENV = {
	HTTPS_PROXY: 'http://127.0.0.1:18080',
	AI_KEYS_JSON: JSON.stringify({ openai: 'test-openai-key', groq: 'test-groq-key' }),
	NIM_API_KEY: 'test-nim-key',
	POLSIA_API_KEY: 'test-polsia-key',
};

describe('#1406 cascade client construction', () => {
	test('with HTTPS_PROXY set, SDK clients carry an HttpsProxyAgent', () => {
		const svc = loadProvider(PROXY_ENV);
		for (const name of ['anthropic', 'openai', 'nim', 'groq']) {
			expect(svc.clients[name]).toBeDefined();
			const agent = svc.clients[name].httpAgent;
			// NB: not toBeInstanceOf — jest.resetModules() gives lib/ai-provider a
			// fresh copy of https-proxy-agent, so identity differs while the class
			// (and the proxy it points at) is the same.
			// #1445: the agent is the NO_PROXY-aware subclass of HttpsProxyAgent
			expect(agent?.constructor?.name).toBe(NoProxyHttpsProxyAgent.name);
			expect(String(agent.proxy)).toContain('127.0.0.1:18080');
		}
	});

	test('with no proxy env, SDK clients carry no agent (Render path unchanged)', () => {
		const { HTTPS_PROXY, ...noProxy } = PROXY_ENV;
		const svc = loadProvider(noProxy);
		for (const name of ['anthropic', 'openai', 'nim', 'groq']) {
			expect(svc.clients[name]).toBeDefined();
			expect(svc.clients[name].httpAgent).toBeFalsy();
		}
	});

	test('NIM client is constructed from NIM_API_KEY (env name the deployment carries)', () => {
		const svc = loadProvider(PROXY_ENV);
		expect(svc.nimAvailable).toBe(true);
		expect(svc.clients.nim).toBeDefined();
	});

	test('OpenAI client is constructed from the AI_KEYS_JSON key with OPENAI_BASE_URL unset', () => {
		const svc = loadProvider(PROXY_ENV);
		expect(process.env.OPENAI_BASE_URL).toBeUndefined();
		expect(svc.clients.openai).toBeDefined();
	});

	test('stale Groq model id is gone from the cascade', () => {
		const svc = loadProvider(PROXY_ENV);
		for (const variant of ['default', 'quality', 'efficient', 'reasoning']) {
			expect(svc.getChain('llm', variant)).not.toContain('groq_llama_70b');
		}
		const src = fs.readFileSync(path.join(__dirname, '../../../lib/ai-provider.js'), 'utf8');
		expect(src).not.toContain('llama-3.3-70b-versatile');
	});
});
