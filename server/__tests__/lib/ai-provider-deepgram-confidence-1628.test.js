/**
 * #1628 — Deepgram STT's measured confidence never reaches consumers.
 *
 * _deepgramSTT (lib/ai-provider.js AND its identical copy in
 * lib/qp-provider.js) extracts Deepgram's per-result confidence but
 * returns it only as `_confidence`. Consumers read `.confidence`
 * (server/routes/recordings.js routes whisperResult.confidence through
 * the #1619 recordedConfidence sanitizer into interview_transcripts),
 * so a Deepgram transcription's real measurement was recorded NULL.
 *
 * Fix pinned: both provider copies return `confidence` (the measured
 * value) alongside the retained `_confidence`. A payload with no
 * confidence yields 0, which the route-boundary sanitizer nulls —
 * honest, never fabricated.
 *
 * Technique: only the network (global fetch) is mocked — it returns a
 * canned Deepgram payload. _deepgramSTT itself is the real code.
 * RED on pristine dev: result.confidence is undefined.
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(async () => ({ rows: [] })),
	connect: jest.fn(async () => ({ query: jest.fn(async () => ({ rows: [] })), release: jest.fn() })),
}));

function dgPayload(confidence) {
	const alt = { transcript: 'hello world this is a test' };
	if (confidence !== undefined) alt.confidence = confidence;
	return {
		results: {
			channels: [{ alternatives: [alt], detected_language: 'en' }],
			utterances: [],
		},
		metadata: { duration: 3.2 },
	};
}

function mockFetch(payload) {
	global.fetch = jest.fn(async () => ({
		ok: true,
		json: async () => payload,
		text: async () => '',
	}));
}

const providers = [
	['lib/ai-provider', '../../../lib/ai-provider'],
	['lib/qp-provider', '../../../lib/qp-provider'],
];

for (const [label, path] of providers) {
	describe(`#1628 ${label} _deepgramSTT confidence shape`, () => {
		let svc;
		beforeAll(() => {
			svc = require(path);
		});
		afterAll(() => {
			delete global.fetch;
		});

		test('measured confidence is exposed as .confidence', async () => {
			mockFetch(dgPayload(0.93));
			const out = await svc._deepgramSTT(Buffer.from('audio'), 'a.webm', 'audio/webm', {});
			expect(out.text).toContain('hello world');
			expect(out.confidence).toBe(0.93);
			expect(out._confidence).toBe(0.93);
		});

		test('payload without confidence yields 0 (route sanitizer nulls it)', async () => {
			mockFetch(dgPayload(undefined));
			const out = await svc._deepgramSTT(Buffer.from('audio'), 'a.webm', 'audio/webm', {});
			expect(out.confidence).toBe(0);
		});
	});
}
