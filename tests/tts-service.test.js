/**
 * Task 3 (#323) — tts-service outputFormat extension.
 *
 * The voice agent publishes TTS audio to LiveKit via AudioSource, which needs
 * raw PCM — not mp3. synthesize() gains an optional outputFormat; the default
 * preserves the existing mp3 behavior for all current callers.
 */

const CARTESIA_URL = 'https://api.cartesia.ai/tts/bytes';

describe('synthesize outputFormat', () => {
	const OLD_KEY = process.env.CARTESIA_API_KEY;
	let synthesize;

	beforeEach(() => {
		jest.resetModules();
		process.env.CARTESIA_API_KEY = 'test-key';
		global.fetch = jest.fn(async () => ({
			ok: true,
			arrayBuffer: async () => new ArrayBuffer(8),
		}));
		synthesize = require('../services/tts-service').synthesize;
	});

	afterEach(() => {
		if (OLD_KEY === undefined) delete process.env.CARTESIA_API_KEY;
		else process.env.CARTESIA_API_KEY = OLD_KEY;
		delete global.fetch;
	});

	test('default output_format stays mp3 (existing callers unchanged)', async () => {
		await synthesize({ text: 'hello' });

		const [, init] = global.fetch.mock.calls[0];
		const body = JSON.parse(init.body);
		expect(body.output_format).toEqual({
			container: 'mp3',
			encoding: 'mp3',
			sample_rate: 44100,
		});
	});

	test('outputFormat override is passed through (raw PCM for LiveKit)', async () => {
		await synthesize({
			text: 'hello',
			outputFormat: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 24000 },
		});

		const [, init] = global.fetch.mock.calls[0];
		const body = JSON.parse(init.body);
		expect(body.output_format).toEqual({
			container: 'raw',
			encoding: 'pcm_s16le',
			sample_rate: 24000,
		});
		expect(body.transcript).toBe('hello');
	});
});
