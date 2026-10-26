/**
 * #1569 — document verification must never fabricate an authenticity score.
 *
 * services/document-verification.js calculateAuthenticityScore returned
 * `analysis.authenticity_score || 50` (and the same for confidence), and its
 * catch returned authenticity_score 50. A failed AI fraud analysis — or a
 * genuine measured 0, the most suspicious possible result — was persisted
 * as a mid-range 50, defeating the <40 fraud threshold in verifyDocument
 * and feeding OmniScore via calculateScoreImpact /
 * applyDocumentScoresToOmniScore. detectVisualTampering had the same
 * `confidence || 50` defect.
 *
 * Fixed behaviour:
 *  - Analysis failure/absence -> authenticity_score: null,
 *    confidence_score: null, analysis_unavailable: true.
 *  - A real measured 0 is preserved as 0 (never upgraded).
 *  - Real scores are returned unchanged.
 *  - verifyDocument with an unavailable score takes an honest pending
 *    path: NULL persisted, status pending_review (human review), never
 *    'verified', no verified credential, score impact 0 (excluded from
 *    OmniScore until a real score exists).
 *
 * Mocking note: only the AI provider layer (openai) and the DB pool are
 * mocked — every function under test runs its real code.
 */

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-1569';

const mockCreate = jest.fn();
jest.mock('openai', () =>
	jest.fn().mockImplementation(() => ({
		chat: { completions: { create: (...args) => mockCreate(...args) } },
	})),
);

const mockClientQuery = jest.fn();
const mockPoolQuery = jest.fn();
const mockClient = { query: (...args) => mockClientQuery(...args), release: jest.fn() };
jest.mock('../../../lib/db', () => ({
	query: (...args) => mockPoolQuery(...args),
	connect: async () => mockClient,
}));

const {
	calculateAuthenticityScore,
	detectVisualTampering,
	verifyDocument,
} = require('../../../services/document-verification');

const aiJson = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }] });

beforeAll(() => {
	jest.spyOn(console, 'log').mockImplementation(() => {});
	jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
	jest.clearAllMocks();
});

describe('#1569 calculateAuthenticityScore honesty', () => {
	test('AI failure returns null scores + analysis_unavailable, never 50', async () => {
		mockCreate.mockRejectedValue(new Error('provider down'));

		const result = await calculateAuthenticityScore({}, 'resume', 'https://x/doc.png');

		expect(result.authenticity_score).toBeNull();
		expect(result.confidence_score).toBeNull();
		expect(result.analysis_unavailable).toBe(true);
		expect(result.fraud_flags).toContain('analysis_failed');
	});

	test('AI response missing the score fields returns null + analysis_unavailable', async () => {
		mockCreate.mockResolvedValue(aiJson({ reasoning: 'no scores here' }));

		const result = await calculateAuthenticityScore({}, 'resume', 'https://x/doc.png');

		expect(result.authenticity_score).toBeNull();
		expect(result.confidence_score).toBeNull();
		expect(result.analysis_unavailable).toBe(true);
	});

	test('a real measured 0 is preserved as 0, not upgraded to 50', async () => {
		mockCreate.mockResolvedValue(
			aiJson({ authenticity_score: 0, confidence: 0, fraud_flags: ['forged'] }),
		);

		const result = await calculateAuthenticityScore({}, 'resume', 'https://x/doc.png');

		expect(result.authenticity_score).toBe(0);
		expect(result.confidence_score).toBe(0);
		expect(result.analysis_unavailable).toBeFalsy();
	});

	test('real authenticity score with missing confidence: score kept, confidence null, not unavailable', async () => {
		mockCreate.mockResolvedValue(aiJson({ authenticity_score: 82, fraud_flags: [] }));

		const result = await calculateAuthenticityScore({}, 'resume', 'https://x/doc.png');

		expect(result.authenticity_score).toBe(82);
		expect(result.confidence_score).toBeNull();
		expect(result.analysis_unavailable).toBe(false);
	});

	test('off-scale score (150) is not a valid measurement: null + analysis_unavailable', async () => {
		mockCreate.mockResolvedValue(
			aiJson({ authenticity_score: 150, confidence: 90, fraud_flags: [] }),
		);

		const result = await calculateAuthenticityScore({}, 'resume', 'https://x/doc.png');

		expect(result.authenticity_score).toBeNull();
		expect(result.analysis_unavailable).toBe(true);
	});

	test('real scores are returned unchanged', async () => {
		mockCreate.mockResolvedValue(
			aiJson({ authenticity_score: 82, confidence: 74, fraud_flags: [] }),
		);

		const result = await calculateAuthenticityScore({}, 'resume', 'https://x/doc.png');

		expect(result.authenticity_score).toBe(82);
		expect(result.confidence_score).toBe(74);
		expect(result.analysis_unavailable).toBeFalsy();
	});
});

describe('#1569 detectVisualTampering confidence honesty', () => {
	test('a real confidence of 0 is preserved, not upgraded to 50', async () => {
		mockCreate.mockResolvedValue(
			aiJson({ tamper_detected: false, flagged_areas: [], confidence: 0, reasoning: '' }),
		);

		const result = await detectVisualTampering('https://x/doc.png', 'resume');

		expect(result.confidence).toBe(0);
	});

	test('missing confidence returns null, not 50', async () => {
		mockCreate.mockResolvedValue(
			aiJson({ tamper_detected: false, flagged_areas: [], reasoning: '' }),
		);

		const result = await detectVisualTampering('https://x/doc.png', 'resume');

		expect(result.confidence).toBeNull();
	});
});

describe('#1569 verifyDocument unavailable path', () => {
	const captured = { update: null, impacts: null, reviewQueue: false, credential: false };

	function wireClient() {
		mockClientQuery.mockImplementation(async (sql, params) => {
			const q = String(sql);
			if (q.includes('SELECT * FROM verification_documents')) {
				return {
					rows: [
						{ id: 1, user_id: 7, document_type: 'resume', file_url: 'https://x/doc.png' },
					],
				};
			}
			if (q.includes('UPDATE verification_documents')) {
				captured.update = params;
				return { rows: [] };
			}
			if (q.includes('INSERT INTO document_verifications')) return { rows: [{ id: 99 }] };
			if (q.includes('INSERT INTO document_review_queue')) {
				captured.reviewQueue = true;
				return { rows: [] };
			}
			if (q.includes('INSERT INTO document_score_impacts')) {
				captured.impacts = params;
				return { rows: [] };
			}
			if (q.includes('INSERT INTO verified_credentials')) {
				captured.credential = true;
				return { rows: [] };
			}
			return { rows: [] };
		});
		mockPoolQuery.mockResolvedValue({ rows: [] });
		global.fetch = jest.fn().mockRejectedValue(new Error('no network in test'));
	}

	function wireAi(authenticityImpl) {
		mockCreate.mockImplementation(async (args) => {
			const text = JSON.stringify(args.messages);
			if (text.includes('Extract all text')) {
				return aiJson({ raw_text: 'Jane Doe', structured_data: {}, dates: [], names: [], companies: [] });
			}
			if (text.includes('visual signs of tampering')) {
				return aiJson({ tamper_detected: false, flagged_areas: [], confidence: 80, reasoning: '' });
			}
			if (text.includes('for authenticity')) return authenticityImpl();
			throw new Error('unexpected AI call');
		});
	}

	beforeEach(() => {
		captured.update = null;
		captured.impacts = null;
		captured.reviewQueue = false;
		captured.credential = false;
		wireClient();
	});

	test('authenticity analysis failure: NULL persisted, pending_review, no OmniScore impact, no credential', async () => {
		wireAi(() => {
			throw new Error('authenticity provider down');
		});

		const result = await verifyDocument(1, 7);

		expect(result.authenticity_score).toBeNull();
		expect(result.analysis_unavailable).toBe(true);
		expect(result.fraud_risk).not.toBe('low');
		// UPDATE verification_documents params: [text, data, authenticity_score, flags, status, id]
		expect(captured.update[2]).toBeNull();
		expect(captured.update[4]).toBe('pending_review');
		// INSERT document_score_impacts params: [user, doc, type, impact, score, status]
		expect(captured.impacts[3]).toBe(0);
		expect(captured.impacts[4]).toBeNull();
		expect(captured.impacts[5]).toBe('pending_review');
		expect(captured.reviewQueue).toBe(true);
		expect(captured.credential).toBe(false);
	});

	test('real high score still verifies exactly as before', async () => {
		wireAi(() => aiJson({ authenticity_score: 85, confidence: 90, fraud_flags: [] }));

		const result = await verifyDocument(1, 7);

		expect(result.authenticity_score).toBe(85);
		expect(result.fraud_risk).toBe('low');
		expect(captured.update[2]).toBe(85);
		expect(captured.update[4]).toBe('verified');
		expect(captured.impacts[3]).toBeGreaterThan(0);
	});
});
