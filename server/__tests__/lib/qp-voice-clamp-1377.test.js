/**
 * #1377 — analyzeVoiceQuality clamp in lib/qp-ai.js.
 *
 * qp-ai already guards `score != null` before clamping (a null dimension
 * score is safe there), but a non-numeric score ("N/A") still degrades to
 * NaN through Math.min/Math.max — a corrupt score, not "insufficient
 * data". Missing/non-numeric must be null; real scores still clamp to
 * 1-10 (numeric strings coerced, #1372 pattern).
 *
 * Only OpenAI (the input condition) is mocked; the real lib/qp-ai.js
 * logic runs. Regression pin only — NOT the E2E-on-dev gate.
 */
process.env.OPENAI_API_KEY = 'test-key-for-1377';

jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({})));
jest.mock('openai', () =>
	jest.fn().mockImplementation(() => ({
		chat: {
			completions: {
				create: (...args) => global.__qpOpenAiCreate(...args),
			},
		},
	})),
);
jest.mock('../../../lib/qp-provider', () => ({
	chatCompletion: jest.fn(),
	visionAnalysis: jest.fn(),
	transcribeAudio: jest.fn(),
}));
jest.mock('../../../lib/r2FrameStore', () => ({
	uploadEncryptedFrameForVision: jest.fn().mockResolvedValue(null),
}));

const qpAi = require('../../../lib/qp-ai');

const TRANSCRIPTION =
	'I led the migration, broke it into small pieces, communicated daily, and delivered early with measurable results for our customers.';

const VOICE_WITH_NULLS = JSON.stringify({
	voice_confidence: { score: null, feedback: 'No signal' },
	vocal_variety: { score: 7, feedback: 'Varied delivery' },
	pacing_rhythm: { score: 'N/A', feedback: 'No signal' },
	articulation: { score: 12, feedback: 'Very clear' },
	energy: { score: '8', feedback: 'Energetic' },
	overall_voice_score: 'N/A',
	voice_summary: 'Mixed evidence.',
	voice_tips: ['Tip one'],
});

describe('#1377 lib/qp-ai.js — voice clamp', () => {
	beforeEach(() => {
		global.__qpOpenAiCreate = jest.fn().mockResolvedValue({
			choices: [{ message: { content: VOICE_WITH_NULLS } }],
		});
	});

	test('null / non-numeric voice scores become null, never 1 or NaN', async () => {
		const result = await qpAi.analyzeVoiceQuality(TRANSCRIPTION, 60);
		expect(result).not.toBeNull();
		expect(result.voice_confidence.score).toBeNull();
		expect(result.pacing_rhythm.score).toBeNull();
		expect(result.overall_voice_score).toBeNull();
	});

	test('positive control: real voice scores still clamp to 1-10, numeric strings coerced', async () => {
		const result = await qpAi.analyzeVoiceQuality(TRANSCRIPTION, 60);
		expect(result.vocal_variety.score).toBe(7);
		expect(result.articulation.score).toBe(10);
		expect(result.energy.score).toBe(8);
	});
});
