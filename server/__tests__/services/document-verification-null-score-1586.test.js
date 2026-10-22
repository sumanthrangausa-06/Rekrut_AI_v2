/**
 * #1586 — follow-ups from the #1569 security review of
 * services/document-verification.js:
 *
 * 1. resolveDocumentReview flipped a NULL-score document's impact row to
 *    `verified` on human approval with no `authenticity_score IS NULL`
 *    check, and applyDocumentScoresToOmniScore selected `verified` rows
 *    with no NULL check either. A later unrelated apply call could then
 *    seed `INSERT … 300 + $impact` — a 300-point omni_scores baseline
 *    for a user with no score, from a never-measured document.
 *    Fix: NULL-score rows are excluded at BOTH gates (the flip UPDATE
 *    and the apply SELECT / mark-applied UPDATE).
 *
 * 2. detectVisualTampering's catch path returned `confidence: 0` —
 *    asserting "no tamper, 0 confidence" when analysis never ran.
 *    Fix: catch returns `confidence: null` (unmeasured).
 *
 * Mocking note: only the AI provider (openai) and the DB pool are
 * mocked. The fake DB below simulates the exact Postgres semantics of
 * the predicates under test: an `authenticity_score IS NOT NULL`
 * predicate in the SQL filters NULL-score rows; without it, it does
 * not. Every service function runs its real code and its real SQL.
 */

process.env.OPENAI_API_KEY = 'test-key-1586';

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
	detectVisualTampering,
	resolveDocumentReview,
	applyDocumentScoresToOmniScore,
} = require('../../../services/document-verification');

beforeAll(() => {
	jest.spyOn(console, 'log').mockImplementation(() => {});
	jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'warn').mockImplementation(() => {});
});

// --- Fake document_score_impacts table with Postgres predicate semantics ---
let impacts;
let omniInserts;

function fakeQuery(sql, params = []) {
	const q = String(sql);
	const excludesNull = /authenticity_score\s+IS\s+NOT\s+NULL/i.test(q);

	if (q.includes('UPDATE document_review_queue')) {
		return { rows: [{ document_id: params[3], user_id: 7, review_status: params[0] }] };
	}
	if (q.includes("SET verification_status = 'verified'") && q.includes('document_score_impacts')) {
		for (const row of impacts) {
			if (row.document_id === params[0] && (!excludesNull || row.authenticity_score !== null)) {
				row.verification_status = 'verified';
			}
		}
		return { rows: [] };
	}
	if (q.includes("SET verification_status = 'rejected'")) return { rows: [] };
	if (q.includes('SELECT * FROM document_score_impacts')) {
		const rows = impacts.filter(
			(r) =>
				r.user_id === params[0] &&
				r.applied_to_omniscore === false &&
				r.verification_status === 'verified' &&
				(!excludesNull || r.authenticity_score !== null),
		);
		return { rows };
	}
	if (q.includes('INSERT INTO omni_scores')) {
		omniInserts.push(params);
		return { rows: [{ user_id: params[0], total_score: 300 + params[1] }] };
	}
	if (q.includes('SET applied_to_omniscore = true')) {
		for (const row of impacts) {
			if (
				row.user_id === params[0] &&
				row.applied_to_omniscore === false &&
				row.verification_status === 'verified' &&
				(!excludesNull || row.authenticity_score !== null)
			) {
				row.applied_to_omniscore = true;
			}
		}
		return { rows: [] };
	}
	return { rows: [] };
}

beforeEach(() => {
	jest.clearAllMocks();
	omniInserts = [];
	impacts = [
		// Never-measured document: score NULL, impact 0 (per #1569).
		{ document_id: 1, user_id: 7, score_impact: 0, authenticity_score: null, verification_status: 'pending_review', applied_to_omniscore: false },
		// Genuinely measured document (control).
		{ document_id: 2, user_id: 7, score_impact: 30, authenticity_score: 85, verification_status: 'pending_review', applied_to_omniscore: false },
	];
	mockClientQuery.mockImplementation(async (sql, params) => fakeQuery(sql, params));
	mockPoolQuery.mockResolvedValue({ rows: [] });
});

describe('#1586 item 1 — NULL-score rows never reach OmniScore', () => {
	test('human approval of a NULL-score doc does NOT flip it and does NOT seed omni_scores', async () => {
		await resolveDocumentReview(1, 99, 'approved', 'looks fine');

		const nullRow = impacts.find((r) => r.document_id === 1);
		expect(nullRow.verification_status).not.toBe('verified');
		expect(omniInserts).toHaveLength(0);
	});

	test('a pre-existing verified NULL-score row is NOT swept up by an unrelated apply call', async () => {
		impacts.find((r) => r.document_id === 1).verification_status = 'verified';

		const result = await applyDocumentScoresToOmniScore(7);

		expect(result.score_change).toBe(0);
		expect(omniInserts).toHaveLength(0);
		expect(impacts.find((r) => r.document_id === 1).applied_to_omniscore).toBe(false);
	});

	test('control: human approval of a genuinely scored doc still flips + applies', async () => {
		await resolveDocumentReview(2, 99, 'approved', 'verified by hand');

		const scored = impacts.find((r) => r.document_id === 2);
		expect(scored.verification_status).toBe('verified');
		expect(scored.applied_to_omniscore).toBe(true);
		expect(omniInserts).toHaveLength(1);
		expect(omniInserts[0][1]).toBe(30);
	});
});

describe('#1586 item 2 — detectVisualTampering failure honesty', () => {
	test('provider failure returns confidence null, never 0', async () => {
		mockCreate.mockRejectedValue(new Error('provider down'));

		const result = await detectVisualTampering('https://x/doc.png', 'resume');

		expect(result.confidence).toBeNull();
		expect(result.tamper_detected).toBe(false);
		expect(result.flagged_areas[0].type).toBe('visual_analysis_failed');
	});
});
