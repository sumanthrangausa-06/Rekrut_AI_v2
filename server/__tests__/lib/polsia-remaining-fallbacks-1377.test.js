/**
 * #1377 — remaining default-score fallback sites in lib/polsia-ai.js.
 *
 * Site 1: generateJobMatchScore's prompt fed `omniscore || 300` to the
 * model — a candidate with no OmniScore was presented as a mid-range 300.
 * The prompt must state the score is not yet calculated instead.
 * Site 4: analyzeVoiceQuality clamped dimension scores with
 * Math.max(1, Math.min(10, score)) and no null check — a null dimension
 * score became Math.min(10, null) = 0, clamped up to a minted 1; a
 * non-numeric score became NaN. Missing/non-numeric must stay null;
 * real scores still clamp to 1-10 (numeric strings coerced, #1372 pattern).
 *
 * Only the AI provider (the input condition) is mocked; the real
 * lib/polsia-ai.js logic runs. Regression pins only — these do NOT
 * satisfy the E2E-on-dev gate.
 */
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({})));
jest.mock('openai', () =>
	jest.fn().mockImplementation(() => ({
		chat: {
			completions: {
				create: jest.fn().mockRejectedValue(new Error('openai disabled in tests')),
			},
		},
	})),
);
jest.mock('../../../lib/ai-provider', () => ({
	chatCompletion: jest.fn(),
	visionAnalysis: jest.fn(),
	transcribeAudio: jest.fn(),
}));
jest.mock('../../../lib/r2FrameStore', () => ({
	uploadEncryptedFrameForVision: jest.fn().mockResolvedValue(null),
}));

const aiProvider = require('../../../lib/ai-provider');
const polsiaAi = require('../../../lib/polsia-ai');

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

const MATCH_OK = JSON.stringify({
	match_score: 72,
	match_level: 'good',
	matching_skills: ['Node.js'],
	missing_skills: [],
	strengths: ['Relevant experience'],
	gaps: [],
	recommendation: 'Good fit',
});

function promptFor(feature) {
	const call = aiProvider.chatCompletion.mock.calls.find(([, o]) => o && o.feature === feature);
	expect(call).toBeDefined();
	return call[0].map((m) => m.content).join('\n');
}

describe('#1377 lib/polsia-ai.js — remaining fallbacks', () => {
	beforeEach(() => jest.clearAllMocks());

	test('site 1: missing OmniScore is told to the model as not calculated, never 300', async () => {
		aiProvider.chatCompletion.mockResolvedValue(MATCH_OK);
		const result = await polsiaAi.generateJobMatchScore(
			{ skills: [{ skill_name: 'Node.js' }], years_experience: 3, location: 'Remote', titles: ['Engineer'] },
			{ title: 'Backend Engineer', company: 'Acme', requirements: 'Node.js', location: 'Remote', description: 'Build APIs' },
		);
		expect(result.match_score).toBe(72);
		const prompt = promptFor('job_match_score');
		expect(prompt).not.toContain('300');
		expect(prompt).toMatch(/not yet calculated|not calculated|insufficient data/i);
	});

	test('site 1 (positive control): a real OmniScore reaches the prompt unchanged', async () => {
		aiProvider.chatCompletion.mockResolvedValue(MATCH_OK);
		await polsiaAi.generateJobMatchScore(
			{ skills: [], omniscore: 640, titles: [] },
			{ title: 'Backend Engineer', company: 'Acme' },
		);
		expect(promptFor('job_match_score')).toContain('640');
	});

	test('site 4: null / non-numeric voice dimension scores stay null, never 1 or NaN', async () => {
		aiProvider.chatCompletion.mockResolvedValue(VOICE_WITH_NULLS);
		const result = await polsiaAi.analyzeVoiceQuality(TRANSCRIPTION, 60);
		expect(result).not.toBeNull();
		expect(result.voice_confidence.score).toBeNull();
		expect(result.pacing_rhythm.score).toBeNull();
		expect(result.overall_voice_score).toBeNull();
	});

	test('site 4 (positive control): real voice scores still clamp to 1-10, numeric strings coerced', async () => {
		aiProvider.chatCompletion.mockResolvedValue(VOICE_WITH_NULLS);
		const result = await polsiaAi.analyzeVoiceQuality(TRANSCRIPTION, 60);
		expect(result.vocal_variety.score).toBe(7);
		expect(result.articulation.score).toBe(10);
		expect(result.energy.score).toBe(8);
	});
});
