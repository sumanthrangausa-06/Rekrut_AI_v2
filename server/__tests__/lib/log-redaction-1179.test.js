/**
 * #1179 — Log-content redaction sweep (follow-up to GAP-J #1129).
 *
 * Canary contract (STOP 1 on #1179, privacy-engineer + security-reviewer
 * lenses): transcript text must never reach a log in any form (no
 * substring / prefix / truncation) — counts only; email addresses are
 * logged masked only (provider / messageId / status kept); storage
 * object keys are never interpolated into retention purge logs.
 *
 * Method: a unique CANARY string is placed in the transcript / email /
 * object key and asserted ABSENT from every emitted console line, while
 * the operational content (char counts, masked address, messageId,
 * provider) is asserted PRESENT and behaviour (return values) unchanged.
 * Pattern follows server/__tests__/lib/gap-j-file-storage-redaction.test.js.
 *
 * The euComplianceService test is a regression PIN: those sites were
 * already fixed under GAP-J review F-5, so it is expected GREEN on
 * pristine code. Every other test here is red-first.
 *
 * These unit tests do NOT satisfy the E2E-on-dev gate (HL-003) — that
 * is Lead/Quinn's gate after merge.
 */

// ─── DB: delegating mock (default = empty result, like the setup fallback).
// The eu describe installs a routing handler via mockDbHandler.
let mockDbHandler = async () => ({ rows: [], rowCount: 0 });
jest.mock('../../../lib/db', () => ({
	query: jest.fn((...args) => mockDbHandler(...args)),
	connect: jest.fn(async () => ({ query: jest.fn(async () => ({ rows: [] })), release: jest.fn() })),
}));

// ─── euComplianceService boundaries (pattern: retention-s3-recording-purge).
jest.mock('../../../lib/file-storage', () => ({
	deleteStorageObject: jest.fn(),
	deleteFile: jest.fn(),
}));
jest.mock('../../../lib/sessionRecordingStore', () => ({
	deleteRecordingObjectVerified: jest.fn(),
}));
jest.mock('../../../lib/biometricAudit', () => ({
	logAccess: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../services/auditLogService', () => ({
	logEvent: jest.fn().mockResolvedValue({}),
	EVENT_TYPES: { STATUS_CHANGE: 'status_change' },
}));
jest.mock('../../services/livekit', () => ({
	decryptStoragePath: jest.fn(),
}));

// ─── self-hosted-audio boundaries: fake whisper.cpp process + binary
// presence, hermetic (no files created in the repo tree). The fake spawn
// writes the whisper JSON output file exactly like whisper.cpp does.
jest.mock('node:child_process', () => {
	const { EventEmitter } = require('node:events');
	const realFs = jest.requireActual('node:fs');
	return {
		execFileSync: jest.fn(() => Buffer.from('')),
		spawn: jest.fn((command, args) => {
			const proc = new EventEmitter();
			proc.stdout = new EventEmitter();
			proc.stderr = new EventEmitter();
			proc.stdin = { write: jest.fn(), end: jest.fn() };
			proc.kill = jest.fn();
			const ofIdx = Array.isArray(args) ? args.indexOf('-of') : -1;
			const outBase = ofIdx >= 0 ? args[ofIdx + 1] : null;
			process.nextTick(() => {
				if (outBase) {
					realFs.writeFileSync(
						`${outBase}.json`,
						JSON.stringify({ transcription: [{ text: CANARY_TRANSCRIPT }] }),
					);
				}
				proc.emit('close', 0);
			});
			return proc;
		}),
	};
});
jest.mock('node:fs', () => {
	const actual = jest.requireActual('node:fs');
	return {
		...actual,
		existsSync: (p) => {
			const s = String(p);
			if (s.includes('whisper-cli') || s.includes('ggml-tiny.en.bin')) return true;
			if (s.includes('piper')) return false;
			return actual.existsSync(p);
		},
	};
});

const realFs = jest.requireActual('node:fs');
const path = require('node:path');

const CANARY_TRANSCRIPT =
	'CANARY-TRANSCRIPT-1179 the candidate described their secret project in detail';
const CANARY_EMAIL = 'canary1179.secret.person@canary-domain-1179.example';
const MASKED_CANARY_EMAIL = 'c***@canary-domain-1179.example';
const CANARY_KEY = 'r2/canary1179-secret-candidate-cv-filename.pdf';

let spies = [];
function captureConsole() {
	spies = ['log', 'warn', 'error', 'info'].map((m) =>
		jest.spyOn(console, m).mockImplementation(() => {}),
	);
	return () =>
		spies
			.flatMap((s) => s.mock.calls)
			.map((args) => args.map(String).join(' '))
			.join('\n');
}
function releaseConsole() {
	for (const s of spies) s.mockRestore();
	spies = [];
}

const PROVIDER_ENV_KEYS = [
	'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy',
	'AI_KEYS_JSON', 'NIM_API_KEY', 'NVIDIA_NIM_API_KEY', 'OPENAI_BASE_URL',
	'OPENAI_API_KEY', 'POLSIA_API_KEY', 'GROQ_API_KEY', 'DEEPGRAM_API_KEY',
	'CARTESIA_API_KEY',
];
let savedEnv;
beforeEach(() => {
	savedEnv = { ...process.env };
});
afterEach(() => {
	releaseConsole();
	for (const k of PROVIDER_ENV_KEYS) delete process.env[k];
	for (const k of PROVIDER_ENV_KEYS) if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
	jest.resetModules();
	mockDbHandler = async () => ({ rows: [], rowCount: 0 });
});

function loadModule(relPath, env) {
	jest.resetModules();
	for (const k of PROVIDER_ENV_KEYS) delete process.env[k];
	Object.assign(process.env, env);
	return require(relPath);
}

const jsonResponse = (body, { ok = true, status = 200 } = {}) => ({
	ok,
	status,
	json: async () => body,
	text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

// ─── Transcript: lib/ai-provider.js STT success logs ─────────────────────
describe('#1179 ai-provider STT logs are counts-only', () => {
	const ENV = {
		AI_KEYS_JSON: JSON.stringify({
			deepgram: 'test-dg-key',
			groq: 'test-groq-key',
			cartesia: 'test-cartesia-key',
		}),
	};

	test('Deepgram STT: canary transcript absent, char count + confidence present, result unchanged', async () => {
		const out = captureConsole();
		const svc = loadModule('../../../lib/ai-provider', ENV);
		svc.deepgramApiKey = 'test-dg-key';
		global.fetch = jest.fn(async () =>
			jsonResponse({
				results: {
					channels: [
						{
							alternatives: [{ transcript: CANARY_TRANSCRIPT, confidence: 0.987 }],
							detected_language: 'en',
						},
					],
					utterances: [],
				},
				metadata: { duration: 2 },
			}),
		);
		const result = await svc._deepgramSTT(Buffer.from('audio'), 'a.webm', 'audio/webm', {});
		expect(result.text).toBe(CANARY_TRANSCRIPT);
		const logs = out();
		expect(logs).toContain('[ai-provider] Deepgram STT');
		expect(logs).not.toContain(CANARY_TRANSCRIPT);
		expect(logs).not.toContain(CANARY_TRANSCRIPT.slice(0, 40));
		expect(logs).toContain(`${CANARY_TRANSCRIPT.length} chars`);
		expect(logs).toContain('98.7%');
	});

	test('Groq Whisper: canary transcript absent, char count present, result unchanged', async () => {
		const out = captureConsole();
		const svc = loadModule('../../../lib/ai-provider', ENV);
		svc.groqApiKey = 'test-groq-key';
		global.fetch = jest.fn(async () => jsonResponse({ text: CANARY_TRANSCRIPT }));
		const result = await svc._groqWhisper(Buffer.from('audio'), 'a.webm', 'audio/webm', {});
		expect(result.text).toBe(CANARY_TRANSCRIPT);
		const logs = out();
		expect(logs).toContain('[ai-provider] Groq Whisper');
		expect(logs).not.toContain(CANARY_TRANSCRIPT);
		expect(logs).not.toContain(CANARY_TRANSCRIPT.slice(0, 40));
		expect(logs).toContain(`${CANARY_TRANSCRIPT.length} chars`);
	});

	test('Cartesia STT: canary transcript absent, char count present, result unchanged', async () => {
		const out = captureConsole();
		const svc = loadModule('../../../lib/ai-provider', ENV);
		svc.cartesiaApiKey = 'test-cartesia-key';
		global.fetch = jest.fn(async () => jsonResponse({ text: CANARY_TRANSCRIPT }));
		const result = await svc._cartesiaSTT(Buffer.from('audio'), 'a.wav', 'audio/wav', {});
		expect(result.text).toBe(CANARY_TRANSCRIPT);
		const logs = out();
		expect(logs).toContain('[ai-provider] Cartesia STT');
		expect(logs).not.toContain(CANARY_TRANSCRIPT);
		expect(logs).not.toContain(CANARY_TRANSCRIPT.slice(0, 40));
		expect(logs).toContain(`${CANARY_TRANSCRIPT.length} chars`);
	});
});

// ─── Transcript: lib/qp-provider.js STT success logs ─────────────────────
describe('#1179 qp-provider STT logs are counts-only', () => {
	const ENV = {
		AI_KEYS_JSON: JSON.stringify({ deepgram: 'test-dg-key', groq: 'test-groq-key' }),
	};

	test('Deepgram STT: canary transcript absent, char count + confidence present, result unchanged', async () => {
		const out = captureConsole();
		const svc = loadModule('../../../lib/qp-provider', ENV);
		svc.deepgramApiKey = 'test-dg-key';
		global.fetch = jest.fn(async () =>
			jsonResponse({
				results: {
					channels: [
						{
							alternatives: [{ transcript: CANARY_TRANSCRIPT, confidence: 0.987 }],
							detected_language: 'en',
						},
					],
					utterances: [],
				},
				metadata: { duration: 2 },
			}),
		);
		const result = await svc._deepgramSTT(Buffer.from('audio'), 'a.webm', 'audio/webm', {});
		expect(result.text).toBe(CANARY_TRANSCRIPT);
		const logs = out();
		expect(logs).not.toContain(CANARY_TRANSCRIPT);
		expect(logs).not.toContain(CANARY_TRANSCRIPT.slice(0, 40));
		expect(logs).toContain(`${CANARY_TRANSCRIPT.length} chars`);
		expect(logs).toContain('98.7%');
	});

	test('Groq Whisper: canary transcript absent, char count present, result unchanged', async () => {
		const out = captureConsole();
		const svc = loadModule('../../../lib/qp-provider', ENV);
		svc.groqApiKey = 'test-groq-key';
		global.fetch = jest.fn(async () => jsonResponse({ text: CANARY_TRANSCRIPT }));
		const result = await svc._groqWhisper(Buffer.from('audio'), 'a.webm', 'audio/webm', {});
		expect(result.text).toBe(CANARY_TRANSCRIPT);
		const logs = out();
		expect(logs).not.toContain(CANARY_TRANSCRIPT);
		expect(logs).not.toContain(CANARY_TRANSCRIPT.slice(0, 40));
		expect(logs).toContain(`${CANARY_TRANSCRIPT.length} chars`);
	});
});

// ─── Transcript: lib/self-hosted-audio.js non-suppressed branch ──────────
describe('#1179 self-hosted-audio STT log is counts-only in BOTH branches', () => {
	test('default (non-suppressed) transcribe(): canary absent, counts present, result unchanged', async () => {
		const out = captureConsole();
		jest.resetModules();
		const sha = require('../../../lib/self-hosted-audio');
		sha.initialize();
		expect(sha.isSTTAvailable()).toBe(true);
		const result = await sha.transcribe(Buffer.from('fake-audio'), 'a.wav', 'audio/wav');
		expect(result.text).toBe(CANARY_TRANSCRIPT);
		const logs = out();
		expect(logs).toContain('[self-hosted-audio] STT OK');
		expect(logs).not.toContain(CANARY_TRANSCRIPT);
		expect(logs).not.toContain(CANARY_TRANSCRIPT.slice(0, 40));
		expect(logs).toContain(`${CANARY_TRANSCRIPT.length} chars`);
	});

	test('suppressed branch stays counts-only (already-safe pin)', async () => {
		const out = captureConsole();
		jest.resetModules();
		const sha = require('../../../lib/self-hosted-audio');
		sha.initialize();
		const result = await sha.transcribe(Buffer.from('fake-audio'), 'a.wav', 'audio/wav', {
			suppressTranscriptLog: true,
		});
		expect(result.text).toBe(CANARY_TRANSCRIPT);
		const logs = out();
		expect(logs).not.toContain(CANARY_TRANSCRIPT);
		expect(logs).toContain('transcript logging suppressed');
	});
});

// ─── Transcript: lib/qp-ai.js hallucination log (source pin) ─────────────
// Behavioural coverage of this call site needs the full Quick-Practice
// session harness (browser transcription race + video pipeline); the
// route-level hallucination path IS covered behaviourally in
// server/__tests__/routes/interview-sessions-log-redaction-1179.test.js.
describe('#1179 qp-ai hallucination log (source pin)', () => {
	test('no log line interpolates the transcript text; the filtered log reports a char count', () => {
		const src = realFs.readFileSync(path.join(__dirname, '../../../lib/qp-ai.js'), 'utf8');
		expect(src).not.toMatch(/Filtered Whisper hallucination:[^`]*\$\{\s*whisperText\s*\}/);
		expect(src).toMatch(/Filtered Whisper hallucination: \$\{whisperText\.length\} chars/);
	});
});

// ─── Emails: lib/email-service.js ────────────────────────────────────────
describe('#1179 email-service logs mask the recipient address', () => {
	function loadEmailService() {
		jest.resetModules();
		process.env.BREVO_API_KEY = 'test-brevo-key';
		process.env.EMAIL_RETRY_ATTEMPTS = '1';
		process.env.EMAIL_RETRY_DELAY = '10';
		delete process.env.SMTP_USER;
		delete process.env.SMTP_PASS;
		delete process.env.EMAIL_USER;
		delete process.env.EMAIL_PASS;
		// requireActual: server/test/setup.js replaces the send functions
		// with stubs; the real module is the unit under test. Its own
		// dependencies (lib/db, distributed-rate-limiter) stay mocked.
		return jest.requireActual('../../../lib/email-service');
	}

	test('maskEmailForLog masks the local part and keeps the domain', () => {
		const emailService = loadEmailService();
		expect(typeof emailService.maskEmailForLog).toBe('function');
		const masked = emailService.maskEmailForLog(CANARY_EMAIL);
		expect(masked).toBe(MASKED_CANARY_EMAIL);
		expect(masked).not.toContain('canary1179.secret.person');
		expect(emailService.maskEmailForLog('not-an-email')).not.toContain('not-an-email');
		expect(emailService.maskEmailForLog(undefined)).not.toContain('undefined');
	});

	test('failed templated send (Brevo attempt + SMTP fallback + failure log): canary address absent, masked present', async () => {
		const out = captureConsole();
		const emailService = loadEmailService();
		global.fetch = jest.fn(async () =>
			jsonResponse('brevo-down', { ok: false, status: 500 }),
		);
		const result = await emailService.sendTemplatedEmail({
			to: CANARY_EMAIL,
			templateName: 'password_reset',
			templateData: { name: 'Canary', reset_link: 'https://example.test/reset', expires_in: '15 minutes' },
		});
		expect(result.success).toBe(false);
		const logs = out();
		expect(logs).not.toContain(CANARY_EMAIL);
		expect(logs).not.toContain('canary1179.secret.person');
		expect(logs).toContain(MASKED_CANARY_EMAIL);
		expect(logs).toContain('Brevo API send attempt');
		expect(logs).toContain('SMTP fallback failed for');
		expect(logs).toContain('Failed to send email to');
	});

	test('successful templated send: log keeps provider + messageId, address masked', async () => {
		const out = captureConsole();
		const emailService = loadEmailService();
		global.fetch = jest.fn(async () => jsonResponse({ messageId: 'msg-1179-ok' }));
		const result = await emailService.sendTemplatedEmail({
			to: CANARY_EMAIL,
			templateName: 'password_reset',
			templateData: { name: 'Canary', reset_link: 'https://example.test/reset', expires_in: '15 minutes' },
		});
		expect(result.success).toBe(true);
		expect(result.messageId).toBe('msg-1179-ok');
		const logs = out();
		expect(logs).not.toContain(CANARY_EMAIL);
		expect(logs).toContain(`Email sent to ${MASKED_CANARY_EMAIL} via brevo-api: msg-1179-ok`);
	});

	test('custom email success + failure logs mask the address', async () => {
		const out = captureConsole();
		const emailService = loadEmailService();
		global.fetch = jest.fn(async () => jsonResponse({ messageId: 'msg-1179-custom' }));
		const okRes = await emailService.sendCustomEmail({
			to: CANARY_EMAIL,
			subject: 'Hello',
			body: 'Body text',
		});
		expect(okRes.success).toBe(true);

		global.fetch = jest.fn(async () => jsonResponse('brevo-down', { ok: false, status: 500 }));
		const failRes = await emailService.sendCustomEmail({
			to: CANARY_EMAIL,
			subject: 'Hello',
			body: 'Body text',
		});
		expect(failRes.success).toBe(false);

		const logs = out();
		expect(logs).not.toContain(CANARY_EMAIL);
		expect(logs).not.toContain('canary1179.secret.person');
		expect(logs).toContain(`Custom email sent to ${MASKED_CANARY_EMAIL} via brevo-api: msg-1179-custom`);
		expect(logs).toContain('Failed to send custom email to');
	});
});

// ─── Object keys: services/euComplianceService.js (regression PIN) ──────
// Already fixed under GAP-J review F-5 — expected GREEN on pristine.
describe('#1179 euComplianceService purge logs never contain the object key (pin)', () => {
	test('soft-failed purge of a canary key logs type + reason only', async () => {
		const out = captureConsole();
		jest.resetModules();
		const { deleteStorageObject } = require('../../../lib/file-storage');
		deleteStorageObject.mockResolvedValue({ deleted: false, reason: 'provider_not_configured' });
		mockDbHandler = async (sql) => {
			if (sql.includes('FROM recording_objects')) {
				return {
					rows: [
						{
							object_key: CANARY_KEY,
							object_type: 'recording',
							expires_at: new Date(Date.now() - 1000),
							candidate_id: 7,
							interview_id: 55,
						},
					],
					rowCount: 1,
				};
			}
			if (sql.includes('FROM interview_sessions')) {
				return { rows: [{ candidate_id: 7, company_id: null }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		};
		const EuComplianceService = require('../../../services/euComplianceService');
		const result = await EuComplianceService.purgeRecordingObjects({ dryRun: false });
		expect(deleteStorageObject).toHaveBeenCalledWith(CANARY_KEY);
		expect(result.errors).toBe(1);
		const logs = out();
		expect(logs).toContain('storage delete soft-failed for recording object');
		expect(logs).not.toContain(CANARY_KEY);
		expect(logs).not.toContain('canary1179-secret-candidate-cv-filename');
	});
});
