/**
 * #1372 — lib/polsia-ai.js must never fabricate scores on AI failure.
 *
 * Follow-up to #1364 / PR #1368, which applied this standard to
 * lib/qp-ai.js; the #1364 specialist review flagged this parallel copy.
 * On AI failure, scores are null ("insufficient data"), never a default
 * number; sub-scores that genuinely succeeded survive as sub-scores only.
 * Polsia-only fallbacks are pinned too: generateSessionFeedback's
 * length-heuristic fallback and generateJobMatchScore's midpoint fallback.
 *
 * Only the AI provider (the input condition) and the encrypted frame
 * store are mocked; the real lib/polsia-ai.js logic runs throughout.
 * These are regression pins; they do NOT satisfy the E2E-on-dev gate.
 */
const fs = require('node:fs');
const path = require('node:path');

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
const frameStore = require('../../../lib/r2FrameStore');
const polsiaAi = require('../../../lib/polsia-ai');

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
	return polsiaAi.analyzeSpeechPatterns(TRANSCRIPTION, 60).communication_score;
}

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

describe('#1372 lib/polsia-ai.js — no fabricated scores on AI failure', () => {
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

		const result = await polsiaAi.analyzeVideoInterviewResponse(
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
		expect(result.communication.score).toBe(speechScore());
		expect(result.presentation.score).toBeNull();
	});

	test('content failure with REAL vision present: overall is still null, real presentation sub-score is kept', async () => {
		setupProvider({ content: 'reject' });
		frameStore.uploadEncryptedFrameForVision.mockResolvedValue('https://frames.test/f.jpg');
		aiProvider.visionAnalysis.mockResolvedValue(REAL_VISION);

		const result = await polsiaAi.analyzeVideoInterviewResponse(
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

		const result = await polsiaAi.analyzeVideoInterviewResponse(
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

		const result = await polsiaAi.analyzeVideoPresentation(FRAMES, {
			transcription: TRANSCRIPTION,
			durationSeconds: 60,
			question: QUESTION,
		});

		expect(result.eye_contact.score).toBeNull();
		expect(result.facial_expressions.score).toBeNull();
		expect(result.body_language.score).toBeNull();
		expect(result.professional_appearance.score).toBeNull();
		expect(result.overall_presentation).toBeNull();
		expect(result.eye_contact.feedback).toBe('inferred eye contact feedback');
		expect(result.eye_contact.rating).toBeUndefined();
		expect(result.overall_score).toBeUndefined();
		expect(result.score).toBeUndefined();
		expect(result.presentation_score).toBeUndefined();
		expect(result.total_score).toBeUndefined();
		expect(result.rating).toBeUndefined();
		expect(result.facial_expressions.feedback).toBe('');
		expect(result.timestamped_notes).toEqual([{ frame: 1, note: 'opening note' }]);
		expect(result._inferred_from_speech).toBe(true);
		expect(result.summary).toMatch(/^Vision unavailable/);
	});

	test('text fallback through the full assembly: presentation is unscored + flagged, overall reweights to real sections only', async () => {
		setupProvider({ content: 'ok', textVision: 'ok' });

		const result = await polsiaAi.analyzeVideoInterviewResponse(
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
		'content analysis returning a non-numeric score (%p) is a flagged failure: _content_failed true, overall null, content unscored',
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

			const result = await polsiaAi.analyzeVideoInterviewResponse(
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

	test('empty transcript: the local speech heuristic mints no score from no data', () => {
		expect(polsiaAi.analyzeSpeechPatterns('', 60).communication_score).toBeNull();
		expect(polsiaAi.analyzeSpeechPatterns('   ', 60).communication_score).toBeNull();
	});

	test('generateSessionFeedback parse failure: length heuristic must not mint scores — overall and every sub-score are null, real metrics survive', async () => {
		aiProvider.chatCompletion.mockImplementation(async (_messages, options = {}) => {
			if (options.feature === 'session_feedback') return 'this is not json at all';
			throw new Error('provider down (test)');
		});
		const conversation = [
			{ role: 'interviewer', text: 'Tell me about yourself.' },
			{
				role: 'candidate',
				text: 'I led a migration project and delivered it early with strong measurable results for the whole team involved.',
			},
			{ role: 'interviewer', text: 'Tell me about a conflict.' },
			{
				role: 'candidate',
				text: 'I resolved a conflict by listening to both sides and proposing a compromise that satisfied everyone on the project.',
			},
		];

		const result = await polsiaAi.generateSessionFeedback(conversation, 'Engineer', {});

		expect(result.overall_score).toBeNull();
		expect(result.content.score).toBeNull();
		expect(result.communication.score).toBeNull();
		expect(result.star_method_usage.score).toBeNull();
		expect(result.communication_quality.score).toBeNull();
		expect(result.technical_depth.score).toBeNull();
		expect(result.content.star_method_usage.score).toBeNull();
		expect(result.content.technical_depth.score).toBeNull();
		// Real, locally measured metrics are not scores — they survive.
		expect(result.communication.word_count).toBeGreaterThan(0);
		expect(result.summary).toMatch(/temporarily unavailable/i);
	});

	test.each([
		['7', 7],
		['N/A', null],
		[null, null],
	])(
		'generateSessionFeedback success path: overall_score %p normalizes to %p (specialist BLOCK fix)',
		async (rawOverall, expected) => {
			aiProvider.chatCompletion.mockImplementation(async (_messages, options = {}) => {
				if (options.feature === 'session_feedback') {
					return JSON.stringify({
						overall_score: rawOverall,
						summary: 'Scored feedback.',
						content: { score: 7, strengths: [], improvements: [] },
						communication: { score: 7 },
					});
				}
				throw new Error('provider down (test)');
			});
			const conversation = [
				{ role: 'interviewer', text: 'Tell me about yourself.' },
				{ role: 'candidate', text: 'I led a migration and delivered it early.' },
			];

			const result = await polsiaAi.generateSessionFeedback(conversation, 'Engineer', {});

			expect(result.overall_score).toBe(expected);
			if (expected != null) expect(typeof result.overall_score).toBe('number');
		},
	);

	test('generateJobMatchScore parse failure: no fabricated midpoint — match_score is null', async () => {
		aiProvider.chatCompletion.mockImplementation(async () => 'no json in this response');

		const result = await polsiaAi.generateJobMatchScore(
			{ skills: [{ skill_name: 'Node.js' }], years_experience: 3 },
			{ title: 'Engineer', company: 'Acme', requirements: 'Node.js' },
			{},
		);

		expect(result.match_score).toBeNull();
		expect(result.match_level).toBeNull();
	});

	test('generateOverallFeedback parse failure: honest average of REAL input scores only; null when no real score exists', async () => {
		aiProvider.chatCompletion.mockImplementation(async () => 'no json in this response');

		const withReal = await polsiaAi.generateOverallFeedback(
			[
				{ score: 8, detailed_feedback: 'a' },
				{ score: 6, detailed_feedback: 'b' },
			],
			{},
		);
		expect(withReal.overall_score).toBe(7);

		const noReal = await polsiaAi.generateOverallFeedback(
			[
				{ score: null, detailed_feedback: 'a' },
				{ detailed_feedback: 'b' },
			],
			{},
		);
		expect(noReal.overall_score).toBeNull();
	});

	test('assembly-crash fallback shape (source guard): the crash block returns null scores, never 0 or a || 5 default', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../../lib/polsia-ai.js'), 'utf8');
		const crashBlock = src.slice(src.indexOf('Result assembly crashed'));
		expect(crashBlock).toContain('overall_score: null');
		expect(crashBlock).not.toContain('overall_score: 0');
		expect(crashBlock).not.toContain('score: speechFallback.communication_score || 5');
	});

	test('source guard: no || 5 score fallback and no {score: 5} placeholder remain in lib/polsia-ai.js', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../../lib/polsia-ai.js'), 'utf8');
		expect(src).not.toMatch(/communication_score \|\| 5/);
		expect(src).not.toMatch(/\{\s*score: 5,/);
		expect(src).not.toMatch(/match_score: 50/);
	});
});
