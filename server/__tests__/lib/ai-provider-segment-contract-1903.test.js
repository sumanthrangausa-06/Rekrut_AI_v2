/**
 * #1903 (S-D01) — Segment contract in the ASR cascade (Architecture §3.2, ADR-D04).
 *
 * AC-1: with `requireSegments: true`, a segment-capable leg's win returns
 *   { text, confidence, duration, segments: [{ start_s, end_s, text }] },
 *   segments in order, segment text concatenating to the full text.
 * AC-2: with `requireSegments: true`, a segment-less leg (Cartesia `{text}`,
 *   a verbose_json with no segments, Deepgram with no utterances) counts as
 *   failed FOR THIS CALL and the cascade continues; if no leg yields
 *   segments, transcribeAudio returns null (honest failure, as today).
 * AC-3 († regression pins): no flag → byte-for-byte today's behaviour.
 *
 * Technique (#1628 family): only lib/db is stubbed and the network
 * (global fetch) is mocked with real-shaped provider payloads. The real
 * transcribeAudio + real execute() cascade + real leg methods run —
 * normalization happens at the real _result unwrap boundary, so nothing
 * the behaviour lives in is mocked away.
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(async () => ({ rows: [] })),
	connect: jest.fn(async () => ({
		query: jest.fn(async () => ({ rows: [] })),
		release: jest.fn(),
	})),
}));

const svc = require('../../../lib/ai-provider');

const WHISPER_PAYLOAD = {
	task: 'transcribe',
	language: 'english',
	duration: 5.5,
	text: 'Hello world. How are you?',
	segments: [
		{ id: 0, seek: 0, start: 0.0, end: 2.5, text: 'Hello world.', tokens: [1], avg_logprob: -0.2 },
		{ id: 1, seek: 250, start: 2.5, end: 5.5, text: ' How are you?', tokens: [2], avg_logprob: -0.1 },
	],
};

const GROQ_PAYLOAD = {
	task: 'transcribe',
	language: 'english',
	duration: 3.0,
	text: 'Groq first part. Groq second part.',
	segments: [
		{ id: 0, seek: 0, start: 0.0, end: 1.5, text: 'Groq first part.', tokens: [1] },
		{ id: 1, seek: 150, start: 1.5, end: 3.0, text: ' Groq second part.', tokens: [2] },
	],
};

const DEEPGRAM_PAYLOAD = {
	results: {
		channels: [
			{
				alternatives: [{ transcript: 'Deepgram opens here. Then it continues.', confidence: 0.91 }],
				detected_language: 'en',
			},
		],
		utterances: [
			{ start: 0.0, end: 2.0, transcript: 'Deepgram opens here.' },
			{ start: 2.0, end: 4.25, transcript: 'Then it continues.' },
		],
	},
	metadata: { duration: 4.25 },
};

const TEXT_ONLY_PAYLOAD = { task: 'transcribe', language: 'english', duration: 2.0, text: 'No segments in this result.' };
const CARTESIA_PAYLOAD = { text: 'Cartesia only text.' };

function installFetch(byLeg) {
	global.fetch = jest.fn(async (url) => {
		const u = String(url);
		let leg = null;
		if (u.includes('api.openai.com')) leg = 'openai';
		else if (u.includes('api.groq.com')) leg = 'groq';
		else if (u.includes('api.deepgram.com')) leg = 'deepgram';
		else if (u.includes('api.cartesia.ai')) leg = 'cartesia';
		const entry = leg && byLeg[leg];
		if (!entry) {
			return { ok: false, status: 500, text: async () => 'no mock for leg', json: async () => ({}) };
		}
		if (entry.error) {
			return { ok: false, status: entry.error, text: async () => 'provider error', json: async () => ({}) };
		}
		return { ok: true, status: 200, text: async () => '', json: async () => entry.payload };
	});
}

function fetchLegsCalled() {
	return global.fetch.mock.calls.map((c) => String(c[0]));
}

beforeAll(() => {
	// Make every ASR leg "configured" so the real chain includes them;
	// self-hosted stays unavailable (no whisper.cpp binary in the test env);
	// its exact return shape ({ text, segments: [] }) is exercised through
	// the Groq leg in the empty-segments pin below. NIM legs are not in the
	// ASR default chain on pristine dev (pre-existing); their verbose_json
	// shape is the OpenAI/Groq shape pinned by the AC-1 tests.
	svc.clients.openai = svc.clients.openai || {};
	svc.openaiApiKey = 'test-key';
	svc.openaiBaseUrl = 'https://api.openai.com/v1';
	svc.groqAvailable = true;
	svc.groqApiKey = 'test-key';
	svc.deepgramAvailable = true;
	svc.deepgramApiKey = 'test-key';
	svc.cartesiaAvailable = true;
	svc.cartesiaApiKey = 'test-key';
	svc.selfHostedSTTAvailable = false;
	svc._lastVerification = null;
});

beforeEach(() => {
	svc.failures = {};
});

afterAll(() => {
	delete global.fetch;
});

describe('#1903 S-D01 segment contract', () => {
	test('AC-1: Whisper verbose_json win returns normalized segments that concatenate to the text', async () => {
		installFetch({ openai: { payload: WHISPER_PAYLOAD } });
		const out = await svc.transcribeAudio(Buffer.from('audio'), 'a.mp4', 'audio/mp4', {
			requireSegments: true,
		});
		expect(out).not.toBeNull();
		expect(Object.keys(out).sort()).toEqual(['confidence', 'duration', 'segments', 'text']);
		expect(out.text).toBe('Hello world. How are you?');
		expect(out.duration).toBe(5.5);
		expect(out.confidence).toBeNull(); // verbose_json carries no confidence — honest null, never invented
		expect(out.segments).toEqual([
			{ start_s: 0, end_s: 2.5, text: 'Hello world.' },
			{ start_s: 2.5, end_s: 5.5, text: ' How are you?' },
		]);
		expect(out.segments.map((s) => s.text).join('')).toBe(out.text);
	});

	test('AC-1: Deepgram utterances win returns normalized segments that concatenate to the text', async () => {
		installFetch({
			openai: { error: 500 },
			groq: { error: 500 },
			deepgram: { payload: DEEPGRAM_PAYLOAD },
		});
		const out = await svc.transcribeAudio(Buffer.from('audio'), 'a.mp4', 'audio/mp4', {
			requireSegments: true,
		});
		expect(out).not.toBeNull();
		expect(out.text).toBe('Deepgram opens here. Then it continues.');
		expect(out.confidence).toBe(0.91);
		expect(out.duration).toBe(4.25);
		expect(out.segments).toHaveLength(2);
		for (const s of out.segments) {
			expect(Object.keys(s).sort()).toEqual(['end_s', 'start_s', 'text']);
		}
		expect(out.segments.map((s) => [s.start_s, s.end_s])).toEqual([
			[0, 2],
			[2, 4.25],
		]);
		expect(out.segments.map((s) => s.text.trim())).toEqual([
			'Deepgram opens here.',
			'Then it continues.',
		]);
		expect(out.segments.map((s) => s.text).join('')).toBe(out.text);
	});

	test('AC-2: a segment-less first leg is skipped and the next segment-capable leg wins', async () => {
		installFetch({ openai: { payload: TEXT_ONLY_PAYLOAD }, groq: { payload: GROQ_PAYLOAD } });
		const out = await svc.transcribeAudio(Buffer.from('audio'), 'a.mp4', 'audio/mp4', {
			requireSegments: true,
		});
		expect(out).not.toBeNull();
		expect(out.text).toBe('Groq first part. Groq second part.');
		expect(out.segments.map((s) => s.text).join('')).toBe(out.text);
		expect(fetchLegsCalled().some((u) => u.includes('api.groq.com'))).toBe(true);
		// Segment-less is not a provider-health failure: no circuit is opened.
		expect(svc.isCircuitOpen('openai_whisper', 'asr')).toBe(false);
	});

	test('AC-2: when no leg yields segments (Cartesia last resort included), the call returns null', async () => {
		installFetch({
			openai: { payload: TEXT_ONLY_PAYLOAD },
			groq: { payload: { text: 'groq text only' } },
			deepgram: { error: 500 },
			cartesia: { payload: CARTESIA_PAYLOAD },
		});
		const out = await svc.transcribeAudio(Buffer.from('audio'), 'a.mp4', 'audio/mp4', {
			requireSegments: true,
		});
		expect(out).toBeNull();
		// The cascade really reached Cartesia and rejected its segment-less result.
		expect(fetchLegsCalled().some((u) => u.includes('api.cartesia.ai'))).toBe(true);
	});

	test('AC-1: segments that do not account for the full text make the leg segment-less (words would be lost)', async () => {
		installFetch({
			openai: {
				payload: {
					text: 'Hello world',
					duration: 2.0,
					segments: [{ id: 0, start: 0.0, end: 1.0, text: ' world' }],
				},
			},
			groq: { payload: GROQ_PAYLOAD },
		});
		const out = await svc.transcribeAudio(Buffer.from('audio'), 'a.mp4', 'audio/mp4', {
			requireSegments: true,
		});
		expect(out.text).toBe('Groq first part. Groq second part.');
	});

	test('AC-1: whitespace-only mismatch is normalized so segment texts concatenate exactly to the text', async () => {
		installFetch({
			openai: {
				payload: {
					text: 'Hello  world',
					duration: 2.0,
					segments: [
						{ id: 0, start: 0.0, end: 1.0, text: 'Hello' },
						{ id: 1, start: 1.0, end: 2.0, text: ' world' },
					],
				},
			},
		});
		const out = await svc.transcribeAudio(Buffer.from('audio'), 'a.mp4', 'audio/mp4', {
			requireSegments: true,
		});
		expect(out.text).toBe('Hello world');
		expect(out.segments.map((s) => s.text).join('')).toBe(out.text);
	});

	test('AC-1: corrupt segment timing (non-numeric start) makes the leg segment-less', async () => {
		installFetch({
			openai: {
				payload: {
					text: 'Hello',
					duration: 1.0,
					segments: [{ id: 0, start: 'abc', end: 1.0, text: 'Hello' }],
				},
			},
			groq: { payload: GROQ_PAYLOAD },
		});
		const out = await svc.transcribeAudio(Buffer.from('audio'), 'a.mp4', 'audio/mp4', {
			requireSegments: true,
		});
		expect(out.text).toBe('Groq first part. Groq second part.');
	});

	test('AC-2: empty-segments and word-less-segment legs are skipped (self-hosted return shape)', async () => {
		installFetch({
			openai: { payload: TEXT_ONLY_PAYLOAD },
			groq: { payload: { text: 'shape only', language: 'en', duration: 0, segments: [] } },
			deepgram: { payload: DEEPGRAM_PAYLOAD },
		});
		const out = await svc.transcribeAudio(Buffer.from('audio'), 'a.mp4', 'audio/mp4', {
			requireSegments: true,
		});
		expect(out.text).toBe('Deepgram opens here. Then it continues.');
	});

	test('AC-1: a measured confidence of 0 is preserved (never nulled or invented)', async () => {
		const dgZero = JSON.parse(JSON.stringify(DEEPGRAM_PAYLOAD));
		dgZero.results.channels[0].alternatives[0].confidence = 0;
		installFetch({
			openai: { error: 500 },
			groq: { error: 500 },
			deepgram: { payload: dgZero },
		});
		const out = await svc.transcribeAudio(Buffer.from('audio'), 'a.mp4', 'audio/mp4', {
			requireSegments: true,
		});
		expect(out.confidence).toBe(0);
	});

	test('AC-2: a leg whose segments are all word-less text counts as segment-less', async () => {
		installFetch({
			openai: { payload: TEXT_ONLY_PAYLOAD },
			groq: {
				payload: {
					text: 'Some text',
					duration: 2.0,
					segments: [
						{ id: 0, start: 0.0, end: 1.0, text: '' },
						{ id: 1, start: 1.0, end: 2.0, text: ' ' },
					],
				},
			},
			deepgram: { payload: DEEPGRAM_PAYLOAD },
		});
		const out = await svc.transcribeAudio(Buffer.from('audio'), 'a.mp4', 'audio/mp4', {
			requireSegments: true,
		});
		expect(out.text).toBe('Deepgram opens here. Then it continues.');
	});

	test('AC-1: negative or end-before-start segment timing makes the leg segment-less', async () => {
		for (const badSeg of [
			{ id: 0, start: -1.0, end: 1.0, text: 'Hello' },
			{ id: 0, start: 2.0, end: 1.0, text: 'Hello' },
		]) {
			svc.failures = {};
			installFetch({
				openai: { payload: { text: 'Hello', duration: 1.0, segments: [badSeg] } },
				groq: { payload: GROQ_PAYLOAD },
			});
			const out = await svc.transcribeAudio(Buffer.from('audio'), 'a.mp4', 'audio/mp4', {
				requireSegments: true,
			});
			expect(out.text).toBe('Groq first part. Groq second part.');
		}
	});

	test('AC-1: trailing-space-only mismatch is normalized so concatenation is exact', async () => {
		installFetch({
			openai: {
				payload: {
					text: 'Hello world ',
					duration: 2.0,
					segments: [
						{ id: 0, start: 0.0, end: 1.0, text: 'Hello' },
						{ id: 1, start: 1.0, end: 2.0, text: ' world' },
					],
				},
			},
		});
		const out = await svc.transcribeAudio(Buffer.from('audio'), 'a.mp4', 'audio/mp4', {
			requireSegments: true,
		});
		expect(out.segments.map((s) => s.text).join('')).toBe(out.text);
	});

	test('† AC-3: without the flag, the Whisper result passes through byte-for-byte', async () => {
		installFetch({ openai: { payload: WHISPER_PAYLOAD } });
		const out = await svc.transcribeAudio(Buffer.from('audio'), 'a.mp4', 'audio/mp4', {});
		expect(out).toEqual(WHISPER_PAYLOAD);
	});

	test('† AC-3: without the flag, a segment-less Cartesia result is still returned as today', async () => {
		installFetch({
			openai: { error: 500 },
			groq: { error: 500 },
			deepgram: { error: 500 },
			cartesia: { payload: CARTESIA_PAYLOAD },
		});
		const out = await svc.transcribeAudio(Buffer.from('audio'), 'a.mp4', 'audio/mp4', {});
		expect(out).toEqual(CARTESIA_PAYLOAD);
	});
});
