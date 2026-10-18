/**
 * #1364 — lib/qp-ai.js internal fallbacks must never fabricate scores.
 *
 * PR #1367 made the submit-video ROUTE reject `_content_failed` analyses.
 * This suite pins the LIB layer beneath it: on partial/total AI failure,
 * analyzeVideoInterviewResponse must return truthful shapes —
 *   - failed sections are null/unscored (never 0, never a default 5),
 *   - overall_score is null when content analysis failed (never derived
 *     from the surviving speech/presentation sections alone),
 *   - the locally-computed speech metric may survive as the communication
 *     SUB-score only (it is a deterministic heuristic from the real
 *     transcript, not an AI result),
 *   - the coaching call must not be fed a placeholder {score: 5},
 *   - the vision text-fallback must not mint visual scores from speech.
 *
 * Only the AI provider (the input condition) and the encrypted frame
 * store are mocked; the real lib/qp-ai.js logic runs throughout.
 * These are regression pins; they do NOT satisfy the Quinn E2E-on-dev gate.
 */
const fs = require('node:fs');
const path = require('node:path');

jest.mock('@anthropic-ai/sdk', () =>
	jest.fn().mockImplementation(() => ({})),
);
jest.mock('openai', () =>
	jest.fn().mockImplementation(() => ({
		chat: {
			completions: {
				create: jest.fn().mockRejectedValue(new Error('openai disabled in tests')),
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

const aiProvider = require('../../../lib/qp-provider');
const frameStore = require('../../../lib/r2FrameStore');
const qpAi = require('../../../lib/qp-ai');

const QUESTION = 'Tell me about a time you dealt with a difficult team member.';
const KEY_POINTS = ['Content quality', 'Structure', 'Clarity'];
const TRANSCRIPTION =
	'In my previous role I led a migration that was failing. I broke the work into small pieces, communicated with the team every day, and delivered the project early with measurable results for our customers and stakeholders.';
const FRAMES = ['data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD'];

const CONTENT_OK = JSON.stringify({
	score: 7,
	strengths: ['Clear structure'],
	improvements: ['Add metrics'],
	covered_points: ['Structure'],
	missed_points: [],
	detailed_feedback: 'Solid answer.',
});
const COACHING_OK = JSON.stringify({
	improved_response: 'A better version.',
	specific_tips: ['Tip one'],
	body_language_tips: [],
	common_mistake: 'Too vague',
	practice_prompt: 'Practice this',
});
const TEXT_FALLBACK_VISION = JSON.stringify({
	eye_contact: { score: 9, rating: 9, feedback: 'inferred eye contact feedback' },
	facial_expressions: { score: 8, feedback: 9 },
	body_language: { score: 9, feedback: 'inferred body feedback' },
	professional_appearance: { score: 8, feedback: 'inferred appearance feedback' },
	overall_presentation: 9,
	overall_score: 9,
	score: 9,
	presentation_score: 9,
	total_score: 9,
	rating: 9,
	summary: 'inferred summary',
	timestamped_notes: [{ frame: 1, note: 'opening note', score: 9, rating: 9 }],
});
const REAL_VISION = JSON.stringify({
	eye_contact: { score: 8, feedback: 'seen eye contact' },
	facial_expressions: { score: 8, feedback: 'seen facial' },
	body_language: { score: 8, feedback: 'seen body' },
	professional_appearance: { score: 8, feedback: 'seen appearance' },
	overall_presentation: 8,
	summary: 'seen summary',
	timestamped_notes: [],
});

function speechScore() {
	return qpAi.analyzeSpeechPatterns(TRANSCRIPTION, 60).communication_score;
}

/**
 * Route the mocked provider by the feature the lib says it is calling.
 * behaviour: { content: 'ok'|'reject', textVision: 'ok'|'reject' }
 */
function setupProvider({ content = 'ok', textVision = 'reject' } = {}) {
	aiProvider.chatCompletion.mockImplementation(async (_messages, options = {}) => {
		if (options.feature === 'response_analysis') {
			if (content === 'reject') throw new Error('all providers failed (test)');
			return CONTENT_OK;
		}
		if (options.feature === 'coaching') return COACHING_OK;
		if (options.feature === 'video_presentation') {
			if (textVision === 'reject') throw new Error('text fallback failed (test)');
			return TEXT_FALLBACK_VISION;
		}
		throw new Error(`unexpected feature ${options.feature}`);
	});
}

function coachingCallMessages() {
	const call = aiProvider.chatCompletion.mock.calls.find(
		([, options]) => options && options.feature === 'coaching',
	);
	expect(call).toBeDefined();
	return JSON.stringify(call[0]);
}

describe('#1364 lib/qp-ai.js — no fabricated scores on AI failure', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		frameStore.uploadEncryptedFrameForVision.mockResolvedValue(null);
		aiProvider.visionAnalysis.mockRejectedValue(new Error('vision failed (test)'));
		jest.spyOn(console, 'log').mockImplementation(() => {});
		jest.spyOn(console, 'warn').mockImplementation(() => {});
		jest.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => jest.restoreAllMocks());

	test('total content failure: overall is null (not the speech score), content is unscored, speech survives only as communication sub-score', async () => {
		setupProvider({ content: 'reject' });

		const result = await qpAi.analyzeVideoInterviewResponse(
			QUESTION,
			TRANSCRIPTION,
			[],
			60,
			KEY_POINTS,
			{},
		);

		expect(result._content_failed).toBe(true);
		expect(result.overall_score).toBeNull();
		expect(result.content.score).toBeNull();
		expect(result.content._failed).toBe(true);
		// Honest local metric: real, deterministic, and ONLY a sub-score.
		expect(result.communication.score).toBe(speechScore());
		expect(result.presentation.score).toBeNull();
	});

	test('content failure with REAL vision present: overall is still null, real presentation sub-score is kept', async () => {
		setupProvider({ content: 'reject' });
		frameStore.uploadEncryptedFrameForVision.mockResolvedValue('https://frames.test/f.jpg');
		aiProvider.visionAnalysis.mockResolvedValue(REAL_VISION);

		const result = await qpAi.analyzeVideoInterviewResponse(
			QUESTION,
			TRANSCRIPTION,
			FRAMES,
			60,
			KEY_POINTS,
			{ candidateId: 42 },
		);

		expect(result._content_failed).toBe(true);
		expect(result.overall_score).toBeNull();
		expect(result.content.score).toBeNull();
		expect(result.presentation.score).toBe(8);
		expect(result.communication.score).toBe(speechScore());
	});

	test('coaching is never fed a placeholder score of 5; success-path overall is the real weighted score', async () => {
		setupProvider({ content: 'ok' });

		const result = await qpAi.analyzeVideoInterviewResponse(
			QUESTION,
			TRANSCRIPTION,
			[],
			60,
			KEY_POINTS,
			{},
		);

		const messages = coachingCallMessages().replace(/\\/g, '');
		expect(messages).not.toContain('"score":5');
		expect(messages).not.toContain('"score": 5');
		expect(messages).toContain('"score":null');

		expect(result._content_failed).toBe(false);
		const expectedOverall =
			Math.round(((7 * 0.45 + speechScore() * 0.25) / 0.7) * 10) / 10;
		expect(result.overall_score).toBe(expectedOverall);
		expect(result.content.score).toBe(7);
	});

	test('vision text-fallback (speech-inferred): coaching text is kept but every visual score is null', async () => {
		setupProvider({ textVision: 'ok' });

		const result = await qpAi.analyzeVideoPresentation(FRAMES, {
			transcription: TRANSCRIPTION,
			durationSeconds: 60,
			question: QUESTION,
		});

		expect(result.eye_contact.score).toBeNull();
		expect(result.facial_expressions.score).toBeNull();
		expect(result.body_language.score).toBeNull();
		expect(result.professional_appearance.score).toBeNull();
		expect(result.overall_presentation).toBeNull();
		// The coaching words themselves are honest coaching, not scores.
		expect(result.eye_contact.feedback).toBe('inferred eye contact feedback');
		// Reviewer Finding 2 (+ re-review residual): the result is built
		// from a whitelist, so no sibling/alias/generic score field survives.
		expect(result.eye_contact.rating).toBeUndefined();
		expect(result.overall_score).toBeUndefined();
		expect(result.score).toBeUndefined();
		expect(result.presentation_score).toBeUndefined();
		expect(result.total_score).toBeUndefined();
		expect(result.rating).toBeUndefined();
		// Re-review F2 residual: leaf values are rebuilt too — a non-string
		// feedback becomes '', and notes keep only {frame, note}.
		expect(result.facial_expressions.feedback).toBe('');
		expect(result.timestamped_notes).toEqual([{ frame: 1, note: 'opening note' }]);
		// Reviewer Finding 3: the summary itself carries the disclosure.
		expect(result.summary).toMatch(/^Vision unavailable/);
		expect(result._inferred_from_speech).toBe(true);
	});

	test('text fallback with a non-string summary: summary falls back to the disclosure only, never coerced gibberish (final re-review LOW)', async () => {
		aiProvider.chatCompletion.mockImplementation(async (_messages, options = {}) => {
			if (options.feature === 'video_presentation') {
				return JSON.stringify({
					eye_contact: { score: 9, feedback: 'eye fb' },
					facial_expressions: { score: 8, feedback: 'face fb' },
					body_language: { score: 9, feedback: 'body fb' },
					professional_appearance: { score: 8, feedback: 'app fb' },
					overall_presentation: 9,
					summary: 9,
					timestamped_notes: [],
				});
			}
			throw new Error(`unexpected feature ${options.feature}`);
		});

		const result = await qpAi.analyzeVideoPresentation(FRAMES, {
			transcription: TRANSCRIPTION,
			durationSeconds: 60,
			question: QUESTION,
		});

		expect(result.summary).toBe(
			'Vision unavailable — this coaching is inferred from your speech patterns, not from your video.',
		);
		expect(result.eye_contact.score).toBeNull();
	});

	test('text fallback through the full assembly: presentation is unscored + flagged, overall reweights to real sections only', async () => {
		setupProvider({ content: 'ok', textVision: 'ok' });

		const result = await qpAi.analyzeVideoInterviewResponse(
			QUESTION,
			TRANSCRIPTION,
			FRAMES,
			60,
			KEY_POINTS,
			{},
		);

		expect(result._content_failed).toBe(false);
		expect(result.presentation.score).toBeNull();
		expect(result.presentation._inferred_from_speech).toBe(true);
		expect(result.presentation.summary).toMatch(/^Vision unavailable/);
		const expectedOverall =
			Math.round(((7 * 0.45 + speechScore() * 0.25) / 0.7) * 10) / 10;
		expect(result.overall_score).toBe(expectedOverall);
	});

	test.each([[null], ['N/A']])(
		'content analysis returning a non-numeric score (%p) is a flagged failure: _content_failed true, overall null, content unscored (reviewer Finding 1)',
		async (badScore) => {
			aiProvider.chatCompletion.mockImplementation(async (_messages, options = {}) => {
				if (options.feature === 'response_analysis') {
					return JSON.stringify({
						score: badScore,
						strengths: [],
						improvements: [],
						covered_points: [],
						missed_points: [],
						detailed_feedback: 'unscored',
					});
				}
				if (options.feature === 'coaching') return COACHING_OK;
				throw new Error('no vision in this test');
			});

			const result = await qpAi.analyzeVideoInterviewResponse(
				QUESTION,
				TRANSCRIPTION,
				[],
				60,
				KEY_POINTS,
				{},
			);

			expect(result._content_failed).toBe(true);
			expect(result.overall_score).toBeNull();
			expect(result.content.score).toBeNull();
		},
	);

	test('empty transcript: the local speech heuristic mints no score from no data (reviewer Finding 4)', () => {
		expect(qpAi.analyzeSpeechPatterns('', 60).communication_score).toBeNull();
		expect(qpAi.analyzeSpeechPatterns('   ', 60).communication_score).toBeNull();
	});

	test('assembly-crash fallback shape (source guard): the crash block returns null scores, never 0 or a || 5 default', () => {
		// The assembly try/catch is a last-resort catch for unexpected
		// TypeErrors; its return shape cannot be driven through the public
		// API with plain-JSON provider results, so its shape is pinned
		// directly — the same source-guard pattern as the route guards.
		const src = fs.readFileSync(path.join(__dirname, '../../../lib/qp-ai.js'), 'utf8');
		const crashBlock = src.slice(src.indexOf('Result assembly crashed'));
		expect(crashBlock).toContain('overall_score: null');
		expect(crashBlock).not.toContain('overall_score: 0');
		expect(crashBlock).not.toContain('score: speechFallback.communication_score || 5');
	});

	test('source guard: no || 5 score fallback and no {score: 5} placeholder remain in lib/qp-ai.js', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../../lib/qp-ai.js'), 'utf8');
		expect(src).not.toMatch(/communication_score \|\| 5/);
		expect(src).not.toMatch(/\{\s*score: 5,/);
	});
});
