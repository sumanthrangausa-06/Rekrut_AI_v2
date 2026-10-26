/**
 * #1445 — NO_PROXY must be honoured by every proxy agent the providers build.
 *
 * Measured at STOP 1 (lane probe, local counting proxy + origin):
 *  - undici 8.10.0 `ProxyAgent` (the #1419 global dispatcher) IGNORES
 *    NO_PROXY: a fetch to a listed host was counted through the proxy.
 *    undici's own `EnvHttpProxyAgent` (already in the tree) HONOURS it:
 *    listed host → direct (0 proxy hits), unlisted host → proxied.
 *  - https-proxy-agent 7.0.6 / agent-base 7 have NO noProxy support at all
 *    (source grep: zero hits); an SDK request to a listed host still
 *    CONNECTs through the proxy.
 *
 * Pins:
 *  (1) shouldBypassProxy matcher conventions (proxy-from-env / WHATWG):
 *      exact host, leading-dot + bare-domain suffix (subdomains), `*`,
 *      optional :port, case-insensitive, comma/whitespace list, lowercase
 *      no_proxy honoured, NO_PROXY unset → never bypass.
 *  (2) Global dispatcher (ai-provider): with HTTPS_PROXY + NO_PROXY set, a
 *      real undici fetch to a listed host goes DIRECT (proxy not hit) and
 *      to an unlisted host goes THROUGH the proxy (proxy hit).
 *  (3) SDK agents (ai-provider, qp-provider, polsia-ai): the httpAgent a
 *      client carries connects DIRECT to a listed host (proxy not hit,
 *      origin body served) and CONNECTs through the proxy for an unlisted
 *      host (proxy hit).
 *
 * Only lib/db is stubbed for the providers and lib/r2FrameStore for
 * polsia-ai (not the layers under test; #1419 harness pattern). Real SDK
 * constructors, real agents, real local origin/proxy servers run. These
 * unit pins do NOT satisfy the Quinn E2E-on-dev closure gate for #1445.
 */
const http = require('node:http');
const { fetch: undiciFetch, getGlobalDispatcher, setGlobalDispatcher } = require('undici');

jest.mock('../../../lib/db', () => ({
	query: jest.fn(async () => ({ rows: [] })),
}));
jest.mock('../../../lib/r2FrameStore', () => ({
	uploadEncryptedFrameForVision: jest.fn(async () => null),
}));

const ENV_KEYS = [
	'HTTPS_PROXY',
	'https_proxy',
	'HTTP_PROXY',
	'http_proxy',
	'NO_PROXY',
	'no_proxy',
	'AI_KEYS_JSON',
	'NIM_API_KEY',
	'NVIDIA_NIM_API_KEY',
	'OPENAI_BASE_URL',
	'OPENAI_API_KEY',
	'POLSIA_API_KEY',
	'POLSIA_API_URL',
	'GROQ_API_KEY',
	'CEREBRAS_API_KEY',
];

const KEY_ENV = {
	AI_KEYS_JSON: JSON.stringify({ openai: 'test-openai-key', groq: 'test-groq-key' }),
	NIM_API_KEY: 'test-nim-key',
	POLSIA_API_KEY: 'test-polsia-key',
	OPENAI_API_KEY: 'test-openai-key',
	OPENAI_BASE_URL: 'https://example.test/v1',
	GROQ_API_KEY: 'test-groq-key',
	CEREBRAS_API_KEY: 'test-cerebras-key',
};

let savedEnv;
let originalDispatcher;
let originServer;
let proxyServer;
let originPort;
let proxyPort;
let proxyHits = 0;

function loadModule(rel, env) {
	jest.resetModules();
	for (const k of ENV_KEYS) delete process.env[k];
	Object.assign(process.env, env);
	return require(rel);
}

function requestViaAgent(agent, url) {
	return new Promise((resolve) => {
		const req = http.request(url, { agent }, (res) => {
			let body = '';
			res.on('data', (c) => (body += c));
			res.on('end', () => resolve({ status: res.statusCode, body }));
		});
		req.on('error', (err) => resolve({ status: 0, body: String(err && err.message) }));
		req.end();
	});
}

beforeAll(async () => {
	originalDispatcher = getGlobalDispatcher();
	originServer = http.createServer((req, res) => {
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('hello-origin');
	});
	proxyServer = http.createServer((req, res) => {
		proxyHits++;
		try {
			const u = new URL(req.url);
			const fwd = http.request(
				{ host: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: req.headers },
				(pr) => {
					res.writeHead(pr.statusCode, pr.headers);
					pr.pipe(res);
				},
			);
			fwd.on('error', () => {
				if (!res.headersSent) res.writeHead(502);
				res.end('proxy-forward-error');
			});
			req.pipe(fwd);
		} catch (_e) {
			res.writeHead(502);
			res.end('proxy-parse-error');
		}
	});
	// CONNECT (HttpsProxyAgent tunnelling): count it, then refuse — the hit
	// alone proves the request was proxied instead of bypassed.
	proxyServer.on('connect', (_req, sock) => {
		proxyHits++;
		sock.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
	});
	await new Promise((r) => originServer.listen(0, '127.0.0.1', r));
	await new Promise((r) => proxyServer.listen(0, '127.0.0.1', r));
	originPort = originServer.address().port;
	proxyPort = proxyServer.address().port;
});

afterAll(async () => {
	setGlobalDispatcher(originalDispatcher);
	await new Promise((r) => originServer.close(r));
	await new Promise((r) => proxyServer.close(r));
});

beforeEach(() => {
	savedEnv = { ...process.env };
	jest.spyOn(console, 'warn').mockImplementation(() => {});
	jest.spyOn(console, 'log').mockImplementation(() => {});
	proxyHits = 0;
});

afterEach(() => {
	setGlobalDispatcher(originalDispatcher);
	for (const k of ENV_KEYS) delete process.env[k];
	for (const k of ENV_KEYS) if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
	jest.restoreAllMocks();
	jest.resetModules();
});

describe('#1445 shouldBypassProxy matcher conventions', () => {
	// Required lazily inside each test: on current dev lib/proxy-env does
	// not exist, which is itself part of the red evidence.
	const load = () => require('../../../lib/proxy-env');

	test('exact host, case-insensitive, comma/whitespace list', () => {
		const { shouldBypassProxy } = load();
		process.env.NO_PROXY = 'LOCALHOST, internal.test  other.test';
		delete process.env.no_proxy;
		expect(shouldBypassProxy('localhost', 443)).toBe(true);
		expect(shouldBypassProxy('Internal.Test', 443)).toBe(true);
		expect(shouldBypassProxy('other.test', 80)).toBe(true);
		expect(shouldBypassProxy('api.openai.com', 443)).toBe(false);
	});

	test('leading-dot and bare entries match subdomains, not lookalikes', () => {
		const { shouldBypassProxy } = load();
		delete process.env.no_proxy;
		process.env.NO_PROXY = '.corp.test,bare.test';
		expect(shouldBypassProxy('a.corp.test', 443)).toBe(true);
		expect(shouldBypassProxy('corp.test', 443)).toBe(true);
		expect(shouldBypassProxy('deep.a.bare.test', 443)).toBe(true);
		expect(shouldBypassProxy('notcorp.test', 443)).toBe(false);
		expect(shouldBypassProxy('corp.test.evil.test', 443)).toBe(false);
	});

	test('"*" bypasses everything', () => {
		const { shouldBypassProxy } = load();
		delete process.env.no_proxy;
		process.env.NO_PROXY = '*';
		expect(shouldBypassProxy('anything.example', 443)).toBe(true);
	});

	test('entry with :port matches only that port', () => {
		const { shouldBypassProxy } = load();
		delete process.env.no_proxy;
		process.env.NO_PROXY = `svc.test:8443`;
		expect(shouldBypassProxy('svc.test', 8443)).toBe(true);
		expect(shouldBypassProxy('svc.test', 443)).toBe(false);
	});

	test('lowercase no_proxy honoured; unset → never bypass', () => {
		const { shouldBypassProxy } = load();
		delete process.env.NO_PROXY;
		process.env.no_proxy = 'lower.test';
		expect(shouldBypassProxy('lower.test', 443)).toBe(true);
		delete process.env.no_proxy;
		expect(shouldBypassProxy('lower.test', 443)).toBe(false);
	});
});

describe('#1445 global dispatcher honours NO_PROXY (ai-provider)', () => {
	const env = () => ({
		...KEY_ENV,
		HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
		NO_PROXY: '127.0.0.1',
	});

	test('dispatcher is NO_PROXY-aware (EnvHttpProxyAgent), not a bare ProxyAgent', () => {
		loadModule('../../../lib/ai-provider', env());
		const d = getGlobalDispatcher();
		expect(d).not.toBe(originalDispatcher);
		expect(d.constructor.name).toBe('EnvHttpProxyAgent');
	});

	test('fetch to a NO_PROXY-listed host goes direct (proxy not hit)', async () => {
		loadModule('../../../lib/ai-provider', env());
		const res = await undiciFetch(`http://127.0.0.1:${originPort}/listed`);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('hello-origin');
		expect(proxyHits).toBe(0);
	});

	test('fetch to an unlisted host still goes through the proxy', async () => {
		loadModule('../../../lib/ai-provider', env());
		const res = await undiciFetch(`http://unlisted.test:${originPort}/unlisted`);
		await res.text();
		expect(proxyHits).toBeGreaterThanOrEqual(1);
	});
});

describe('#1445 SDK proxy agents honour NO_PROXY', () => {
	const env = () => ({
		...KEY_ENV,
		HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
		NO_PROXY: '127.0.0.1',
	});

	test('ai-provider client agent: listed host direct, unlisted host proxied', async () => {
		const svc = loadModule('../../../lib/ai-provider', env());
		const agent = svc.clients.anthropic.httpAgent;
		expect(agent).toBeTruthy();
		const listed = await requestViaAgent(agent, `http://127.0.0.1:${originPort}/listed`);
		expect(listed.status).toBe(200);
		expect(listed.body).toBe('hello-origin');
		expect(proxyHits).toBe(0);
		await requestViaAgent(agent, `http://unlisted.test:${originPort}/unlisted`);
		expect(proxyHits).toBeGreaterThanOrEqual(1);
	});

	test('qp-provider client agent: listed host bypasses the proxy', async () => {
		const svc = loadModule('../../../lib/qp-provider', env());
		const agent = svc.clients.anthropic.httpAgent;
		expect(agent).toBeTruthy();
		const listed = await requestViaAgent(agent, `http://127.0.0.1:${originPort}/listed`);
		expect(listed.status).toBe(200);
		expect(proxyHits).toBe(0);
	});

	test('polsia-ai client agent: listed host bypasses the proxy', async () => {
		const polsia = loadModule('../../../lib/polsia-ai', env());
		const agent = polsia.anthropic?.httpAgent;
		expect(agent).toBeTruthy();
		const listed = await requestViaAgent(agent, `http://127.0.0.1:${originPort}/listed`);
		expect(listed.status).toBe(200);
		expect(proxyHits).toBe(0);
	});
});
