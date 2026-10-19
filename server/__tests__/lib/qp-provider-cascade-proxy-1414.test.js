/**
 * #1414 — lib/qp-provider.js (Quick Practice's OWN cascade, forked from
 * ai-provider.js) carries the same proxy-blind pattern #1406 fixed in
 * lib/ai-provider.js (PR #1413).
 *
 * Defects pinned (STOP 1 on #1414, grounded in lib/qp-provider.js _initClients):
 *  - SDK clients (openai / @anthropic-ai/sdk) were constructed with no
 *    httpAgent, so they ignore HTTPS_PROXY and every QP cascade attempt
 *    fails with "Connection error" before a request is sent, on hosts whose
 *    egress requires a proxy.
 *  - The Groq model id llama-3.3-70b-versatile is stale — verified live
 *    this run: absent from GET https://api.groq.com/openai/v1/models
 *    (HTTP 200, 11 models) with the repo env GROQ_API_KEY, matching the
 *    404 model_not_found proved in the #1406 run. No like-for-like
 *    verified replacement exists in that list, so the entries are REMOVED,
 *    exactly as #1406 removed them from ai-provider.js.
 *
 * qp-provider reads DIRECT env keys: POLSIA_API_KEY, OPENAI_API_KEY
 * (+OPENAI_BASE_URL), GROQ_API_KEY, CEREBRAS_API_KEY. NIM is the exception
 * since #1424: it mirrors ai-provider via getAiKey('nvidia','NIM_API_KEY')
 * (AI_KEYS_JSON first, then NIM_API_KEY; the legacy NVIDIA_NIM_API_KEY name
 * is no longer read — see qp-provider-nim-groq-1424.test.js).
 *
 * Only lib/db is stubbed (the singleton constructor fire-and-forgets a
 * persisted-state load). The REAL SDK constructors run — client
 * construction is local and makes no network calls. These unit tests do
 * NOT satisfy the E2E-on-dev gate for #1414; they pin construction only.
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

beforeEach(() => {
	savedEnv = { ...process.env };
});

afterEach(() => {
	for (const k of ENV_KEYS) delete process.env[k];
	for (const k of ENV_KEYS) if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
	jest.resetModules();
});

const tk = (s) => ['test', s, 'key'].join('-');
const PROXY_ENV = {
	HTTPS_PROXY: 'http://127.0.0.1:18080',
	POLSIA_API_KEY: tk('polsia'),
	OPENAI_BASE_URL: 'https://example.test/v1',
	OPENAI_API_KEY: tk('openai'),
	NIM_API_KEY: tk('nim'),
	GROQ_API_KEY: tk('groq'),
	CEREBRAS_API_KEY: tk('cerebras'),
};

const CLIENT_NAMES = ['anthropic', 'openai', 'nim', 'groq', 'cerebras'];

describe('#1414 qp-provider cascade client construction', () => {
	test('with HTTPS_PROXY set, SDK clients carry an HttpsProxyAgent', () => {
		const svc = loadProvider(PROXY_ENV);
		for (const name of CLIENT_NAMES) {
			expect(svc.clients[name]).toBeDefined();
			const agent = svc.clients[name].httpAgent;
			// NB: not toBeInstanceOf — jest.resetModules() gives lib/qp-provider
			// a fresh copy of https-proxy-agent, so identity differs while the
			// class (and the proxy it points at) is the same. (Same note as #1406.)
			// #1445: the agent is the NO_PROXY-aware subclass of HttpsProxyAgent
			expect(agent?.constructor?.name).toBe(NoProxyHttpsProxyAgent.name);
			expect(String(agent.proxy)).toContain('127.0.0.1:18080');
		}
	});

	test('with no proxy env, SDK clients carry no agent (Render path unchanged)', () => {
		const { HTTPS_PROXY, ...noProxy } = PROXY_ENV;
		const svc = loadProvider(noProxy);
		for (const name of CLIENT_NAMES) {
			expect(svc.clients[name]).toBeDefined();
			expect(svc.clients[name].httpAgent).toBeFalsy();
		}
	});

	test('stale Groq model id is gone from the qp cascade', () => {
		const svc = loadProvider(PROXY_ENV);
		for (const variant of ['default', 'quality', 'efficient', 'reasoning']) {
			expect(svc.getChain('llm', variant)).not.toContain('groq_llama_70b');
		}
		const src = fs.readFileSync(path.join(__dirname, '../../../lib/qp-provider.js'), 'utf8');
		expect(src).not.toContain('llama-3.3-70b-versatile');
		expect(src).not.toContain('groq_llama_70b');
	});
});

/**
 * #1414 follow-up (reviewer MEDIUM on PR #1423) — malformed HTTPS_PROXY must
 * not crash qp-provider at startup. _initClients() runs from the singleton
 * constructor, so an unguarded `new HttpsProxyAgent(proxyUrl)` throws
 * ERR_INVALID_URL at module load for every importer (lib/qp-ai.js,
 * routes/quick-practice.js). Mirrors the #1418 guard merged into
 * lib/ai-provider.js by PR #1421: try/catch, fall back to no agent (direct
 * egress, the pre-#1406 behaviour), fixed warning string that NEVER
 * includes the proxy URL (which can embed credentials).
 */
describe('#1414 qp-provider malformed proxy guard', () => {
	let warnSpy;
	let logSpy;
	let errorSpy;

	beforeEach(() => {
		warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
		logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
		errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	const allLogged = () =>
		[warnSpy, logSpy, errorSpy]
			.flatMap((spy) => spy.mock.calls)
			.map((args) => args.map(String).join(' '))
			.join('\n');

	test('malformed HTTPS_PROXY: module loads, clients construct with no agent', () => {
		const svc = loadProvider({ ...PROXY_ENV, HTTPS_PROXY: '::bad url::' });
		for (const name of CLIENT_NAMES) {
			expect(svc.clients[name]).toBeDefined();
			expect(svc.clients[name].httpAgent).toBeFalsy();
		}
	});

	test('malformed https_proxy (lowercase): module loads, clients construct with no agent', () => {
		const { HTTPS_PROXY, ...rest } = PROXY_ENV;
		const svc = loadProvider({ ...rest, https_proxy: '::bad url::' });
		for (const name of CLIENT_NAMES) {
			expect(svc.clients[name]).toBeDefined();
			expect(svc.clients[name].httpAgent).toBeFalsy();
		}
	});

	test('credential-bearing malformed proxy: fixed warning logged, no credential string in any log channel', () => {
		const malformed = 'http://proxyuser:secretpass@::bad';
		const svc = loadProvider({ ...PROXY_ENV, HTTPS_PROXY: malformed });
		for (const name of CLIENT_NAMES) {
			expect(svc.clients[name]).toBeDefined();
			expect(svc.clients[name].httpAgent).toBeFalsy();
		}
		const warned = warnSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
		expect(warned).toMatch(/Ignoring invalid HTTPS_PROXY/);
		const logged = allLogged();
		expect(logged).not.toContain(malformed);
		expect(logged).not.toContain('secretpass');
		expect(logged).not.toContain('proxyuser');
	});
});
