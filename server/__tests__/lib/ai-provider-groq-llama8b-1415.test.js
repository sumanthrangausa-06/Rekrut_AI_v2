/**
 * #1415 — groq_llama_8b / llama-3.1-8b-instant is stale (real 404 in auto-verify).
 *
 * Live probe 2026-10-18 (GET https://api.groq.com/openai/v1/models, app Groq
 * key via AI_KEYS_JSON, status 200, 11 ids) showed:
 *  - llama-3.1-8b-instant ABSENT
 *  - no instant-class successor at all (no instant model, no 8B Llama, no
 *    llama-3.1 or llama-3.3 chat model)
 *  - openai/gpt-oss-120b (groq_gpt_oss) and whisper-large-v3-turbo live
 * Decision (posted on #1415 before coding): fail-closed REMOVAL, mirroring
 * #1406's removal of groq_llama_70b. Scope: lib/ai-provider.js only.
 *
 * Only lib/db is stubbed. These unit tests do NOT satisfy the E2E-on-dev gate;
 * they pin the removal only.
 */
const fs = require('node:fs');
const path = require('node:path');

jest.mock('../../../lib/db', () => ({
	query: jest.fn(async () => ({ rows: [] })),
}));

const ENV_KEYS = [
	'HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy','AI_KEYS_JSON',
	'NIM_API_KEY','NVIDIA_NIM_API_KEY','OPENAI_BASE_URL','OPENAI_API_KEY',
	'POLSIA_API_KEY','GROQ_API_KEY',
];
let savedEnv;
function loadProvider(env) {
	jest.resetModules();
	for (const k of ENV_KEYS) delete process.env[k];
	Object.assign(process.env, env);
	return require('../../../lib/ai-provider');
}
beforeEach(() => { savedEnv = { ...process.env }; jest.spyOn(console,'log').mockImplementation(()=>{}); jest.spyOn(console,'warn').mockImplementation(()=>{}); });
afterEach(() => {
	for (const k of ENV_KEYS) delete process.env[k];
	for (const k of ENV_KEYS) if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
	jest.restoreAllMocks(); jest.resetModules();
});
const KEY_ENV = {
	AI_KEYS_JSON: JSON.stringify({ openai: 'test-openai-key', groq: 'test-groq-key' }),
	NIM_API_KEY: 'test-nim-key',
	POLSIA_API_KEY: 'test-polsia-key',
};

describe('#1415 stale groq_llama_8b removal', () => {
	test('stale model id is gone from source', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../../lib/ai-provider.js'), 'utf8');
		expect(src).not.toContain('llama-3.1-8b-instant');
		expect(src).not.toContain('groq_llama_8b');
	});
	test('no LLM chain variant contains groq_llama_8b', () => {
		const svc = loadProvider(KEY_ENV);
		for (const variant of ['default','quality','efficient','reasoning']) {
			expect(svc.getChain('llm', variant)).not.toContain('groq_llama_8b');
		}
	});
	test('efficient chain remains populated after removal', () => {
		const svc = loadProvider(KEY_ENV);
		const eff = svc.getChain('llm', 'efficient');
		expect(eff.length).toBeGreaterThanOrEqual(5);
		expect(eff).toContain('cerebras_llama_8b');
		expect(eff).toContain('nim_llama_8b');
	});
	test('groq availability / model name no longer resolve for the removed key, live groq keys still do', () => {
		const svc = loadProvider(KEY_ENV);
		expect(svc.isProviderAvailable('groq_llama_8b')).toBe(false);
		expect(svc.isProviderAvailable('groq_gpt_oss')).toBe(true);
		expect(svc._getModelName('groq_gpt_oss')).toBe('openai/gpt-oss-120b');
		expect(svc._getModelName('groq_whisper')).toBe('whisper-large-v3-turbo');
		// removed key falls through to identity, not to a stale model id
		expect(svc._getModelName('groq_llama_8b')).toBe('groq_llama_8b');
	});
});
