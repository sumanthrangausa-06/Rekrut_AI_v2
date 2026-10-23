/**
 * #1715 O2 — applyDocumentScoresToOmniScore must not fabricate a total.
 *
 * Verified at origin/dev 14c55ab79 (services/document-verification.js:1070):
 * a fresh omni_scores row was inserted as `VALUES ($1, 300 + $2, $2)`.
 * 300 is SCORE_RANGES.MIN — the floor of a *computed* 8-factor OmniScore —
 * but this writer computes no such score; it applies one measured document
 * delta. The OmniScore contract (#1192, services/omniscore.js) is explicit:
 * getOrCreateScore seeds total_score NULL ("never the 300 starter literal")
 * and calculateScore persists NULL when it has not computed a total.
 *
 * Honest fix: a fresh row created by document verification carries
 * total_score NULL (no computed total yet) and resume_score = the real
 * measured impact. The ON CONFLICT delta path is unchanged (in Postgres
 * NULL + delta stays NULL; a real total gains the delta).
 *
 * The fake DB below evaluates the INSERT's total_score expression
 * faithfully for the forms this writer can take (300 + $n, NULL, $n), so
 * the test pins the stored value, not the SQL spelling alone.
 */

process.env.OPENAI_API_KEY = 'test-key-not-real';

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

const { applyDocumentScoresToOmniScore } = require('../../../services/document-verification');

beforeAll(() => {
	jest.spyOn(console, 'log').mockImplementation(() => {});
	jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'warn').mockImplementation(() => {});
});

let impacts;
let omniRow;
let omniInsertSql;
let historyNewScore;

function evalTotalExpression(sql, params) {
	const q = String(sql);
	if (/300\s*\+/.test(q)) return 300 + params[1];
	if (/VALUES\s*\(\s*\$1\s*,\s*NULL\s*,/i.test(q)) return null;
	if (/VALUES\s*\(\s*\$1\s*,\s*\$2\s*,/i.test(q)) return params[1];
	throw new Error(`fake DB: unrecognised total_score expression in: ${q}`);
}

function fakeQuery(sql, params = []) {
	const q = String(sql);
	if (q.includes('SELECT * FROM document_score_impacts')) {
		const rows = impacts.filter(
			(r) =>
				r.user_id === params[0] &&
				r.applied_to_omniscore === false &&
				r.verification_status === 'verified' &&
				r.authenticity_score !== null,
		);
		return { rows };
	}
	if (q.includes('INSERT INTO omni_scores')) {
		omniInsertSql = q;
		omniRow = {
			user_id: params[0],
			total_score: evalTotalExpression(q, params),
			resume_score: params[1],
		};
		return { rows: [omniRow] };
	}
	if (q.includes('SET applied_to_omniscore = true')) {
		for (const row of impacts) {
			if (row.user_id === params[0] && row.verification_status === 'verified') {
				row.applied_to_omniscore = true;
			}
		}
		return { rows: [] };
	}
	if (q.includes('INSERT INTO score_history')) {
		historyNewScore = params[2];
		return { rows: [] };
	}
	return { rows: [] };
}

beforeEach(() => {
	jest.clearAllMocks();
	omniRow = null;
	omniInsertSql = null;
	historyNewScore = undefined;
	impacts = [
		{
			document_id: 2,
			user_id: 7,
			score_impact: 30,
			authenticity_score: 85,
			verification_status: 'verified',
			applied_to_omniscore: false,
		},
	];
	mockClientQuery.mockImplementation(async (sql, params) => fakeQuery(sql, params));
	mockPoolQuery.mockResolvedValue({ rows: [] });
});

describe('#1715 O2 — document verification never seeds a fabricated OmniScore total', () => {
	test('fresh row: total_score is NULL, resume_score carries the real impact', async () => {
		const result = await applyDocumentScoresToOmniScore(7);

		expect(result.score_change).toBe(30);
		expect(omniRow).not.toBeNull();
		expect(omniRow.total_score).toBeNull();
		expect(omniRow.resume_score).toBe(30);
		expect(result.new_score).toBeNull();
		expect(historyNewScore).toBeNull();
	});

	test('the INSERT contains no fabricated 300 base', async () => {
		await applyDocumentScoresToOmniScore(7);
		expect(omniInsertSql).not.toMatch(/300\s*\+/);
	});

	test('guard: the ON CONFLICT delta on an existing stored total is preserved', async () => {
		await applyDocumentScoresToOmniScore(7);
		expect(omniInsertSql).toContain('omni_scores.total_score + $2');
	});
});
