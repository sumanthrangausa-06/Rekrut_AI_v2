/**
 * #1419 — raw fetch() AI paths must honour HTTPS_PROXY.
 *
 * lib/ai-provider.js had exactly 17 raw global-fetch call sites (TTS/ASR/
 * embeddings/reranking/verify paths, grep-counted at STOP 1) with no proxy
 * handling: the #1406 fix only gave the SDK clients an httpAgent, and global
 * fetch does not use httpAgent. lib/polsia-ai.js has 0 raw fetch sites; its
 * gap is two un-proxied SDK constructions (new Anthropic :10, new OpenAI :19).
 *
 * Chosen mechanism (STOP 1 on #1419, precedent #1414/#1418): ONE shared
 * undici ProxyAgent installed as the global dispatcher inside ai-provider's
 * existing guarded proxy block when HTTPS_PROXY is valid — per-call
 * `dispatcher:` was measured broken in this runtime (UND_ERR_INVALID_ARG
 * from npm-undici/internal-undici skew), and 17 per-site edits is the drift
 * pattern that produced this follow-up family. polsia-ai's SDK clients get
 * the mirrored guarded HttpsProxyAgent (#1414 pattern).
 *
 * Pins:
 *  (a) valid HTTPS_PROXY → global dispatcher is a ProxyAgent for that proxy
 *      AND a real global fetch is counted through a local proxy server;
 *      polsia-ai's Anthropic client carries an HttpsProxyAgent.
 *  (b) proxy env absent → dispatcher object is IDENTICAL to before the
 *      module loaded (no behaviour change), SDK clients carry no agent.
 *  (c) malformed proxy (incl. credential-embedded) → module loads,
 *      dispatcher unchanged, no agent, #1418 fixed warning that never
 *      contains the URL or credentials.
 *
 * Only lib/db is stubbed for ai-provider (its constructor fire-and-forgets a
 * persisted-state load) and lib/r2FrameStore for polsia-ai (not the layer
 * under test; follows the #1372 suite pattern). Real SDK constructors, the
 * real undici dispatcher, and real local HTTP origin/proxy servers run.
 * These unit pins do NOT satisfy the E2E-on-dev (Quinn) gate for #1419.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
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
	'AI_KEYS_JSON',
	'NIM_API_KEY',
	'NVIDIA_NIM_API_KEY',
	'OPENAI_BASE_URL',
	'OPENAI_API_KEY',
	'POLSIA_API_KEY',
	'POLSIA_API_URL',
	'GROQ_API_KEY',
];

const KEY_ENV = {
	AI_KEYS_JSON: JSON.stringify({ openai: 'test-openai-key', groq: 'test-groq-key' }),
	NIM_API_KEY: 'test-nim-key',
	POLSIA_API_KEY: 'test-polsia-key',
	OPENAI_API_KEY: 'test-openai-key',
};

let savedEnv;
let warnSpy;
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

function dispatcherProxyUri(dispatcher) {
	const sym = Object.getOwnPropertySymbols(dispatcher).find(
		(s) => s.description === 'proxy agent options',
	);
	if (!sym) return null;
	const v = dispatcher[sym];
	return typeof v === 'string' ? v : v?.uri || JSON.stringify(v);
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
				res.writeHead(502);
				res.end('proxy-forward-error');
			});
			req.pipe(fwd);
		} catch (_e) {
			res.writeHead(502);
			res.end('proxy-parse-error');
		}
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
	warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
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

describe('#1419 raw-fetch proxy (shared global dispatcher)', () => {
	test('(a) valid HTTPS_PROXY: global dispatcher is a ProxyAgent for that proxy', () => {
		loadModule('../../../lib/ai-provider', {
			...KEY_ENV,
			HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
		});
		const d = getGlobalDispatcher();
		expect(d).not.toBe(originalDispatcher);
		expect(d.constructor.name).toBe('ProxyAgent');
		expect(dispatcherProxyUri(d)).toContain(`127.0.0.1:${proxyPort}`);
	});

	test('(a) valid HTTPS_PROXY: a real fetch is counted through the proxy', async () => {
		loadModule('../../../lib/ai-provider', {
			...KEY_ENV,
			HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
		});
		// undici's own fetch — it dispatches through the same global
		// dispatcher the production global fetch uses in a real process.
		// (Jest's sandbox global fetch is a different realm's fetch and does
		// not observe dispatcher installs; the plain-node global-fetch proof
		// is recorded in this lane's run evidence instead.)
		const res = await undiciFetch(`http://127.0.0.1:${originPort}/tts-probe`);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('hello-origin');
		expect(proxyHits).toBeGreaterThanOrEqual(1);
	});

	test('(a) valid HTTPS_PROXY: polsia-ai Anthropic client carries an HttpsProxyAgent', () => {
		const polsia = loadModule('../../../lib/polsia-ai', {
			...KEY_ENV,
			HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
		});
		const agent = polsia.anthropic?.httpAgent;
		expect(agent?.constructor?.name).toBe('HttpsProxyAgent');
		expect(String(agent.proxy)).toContain(`127.0.0.1:${proxyPort}`);
		// The OpenAI client is not exported; pin its construction in source so
		// the spread cannot silently drop out (behavioural pin above covers
		// the exported Anthropic twin built from the same agentOpts).
		const src = fs.readFileSync(path.join(__dirname, '../../../lib/polsia-ai.js'), 'utf8');
		expect(src.match(/\.\.\.agentOpts/g)?.length).toBeGreaterThanOrEqual(2);
	});

	test('(b) no proxy env: dispatcher identical to pre-load, clients carry no agent', () => {
		const svc = loadModule('../../../lib/ai-provider', { ...KEY_ENV });
		expect(getGlobalDispatcher()).toBe(originalDispatcher);
		for (const name of ['anthropic', 'openai', 'nim', 'groq']) {
			expect(svc.clients[name]).toBeDefined();
			expect(svc.clients[name].httpAgent).toBeFalsy();
		}
	});

	test('(b) no proxy env: a real fetch goes direct (proxy not hit)', async () => {
		loadModule('../../../lib/ai-provider', { ...KEY_ENV });
		const res = await undiciFetch(`http://127.0.0.1:${originPort}/direct-probe`);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('hello-origin');
		expect(proxyHits).toBe(0);
	});

	test('(c) malformed HTTPS_PROXY: loads, dispatcher unchanged, no agent', () => {
		const svc = loadModule('../../../lib/ai-provider', {
			...KEY_ENV,
			HTTPS_PROXY: '::bad url::',
		});
		expect(getGlobalDispatcher()).toBe(originalDispatcher);
		for (const name of ['anthropic', 'openai', 'nim', 'groq']) {
			expect(svc.clients[name]).toBeDefined();
			expect(svc.clients[name].httpAgent).toBeFalsy();
		}
	});

	test('(c) malformed proxy warning never includes the URL or embedded credentials', () => {
		loadModule('../../../lib/ai-provider', {
			...KEY_ENV,
			HTTPS_PROXY: 'http://proxyuser:secretpass@::bad',
		});
		expect(getGlobalDispatcher()).toBe(originalDispatcher);
		const warned = warnSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
		expect(warned.length).toBeGreaterThan(0);
		expect(warned).not.toContain('secretpass');
		expect(warned).not.toContain('proxyuser');
		expect(warned).not.toContain('::bad');
	});
});
