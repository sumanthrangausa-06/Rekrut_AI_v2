/**
 * #1715 O3 — detectFraudSignals must not coerce missing anti-cheat data
 * to a perfect 100.
 *
 * Verified at origin/dev 14c55ab79 (services/omniscore.js:744):
 *   const antiCheat = a.anti_cheat_score || 100; return antiCheat < 50;
 * `||` rewrites BOTH absence (null → 100, "perfect integrity") and a
 * genuine measured 0 (0 → 100), so the worst real integrity score was
 * suppressed from the suspicious_assessment fraud flag.
 *
 * Honest behaviour: missing stays missing (?? null) and absence raises
 * no flag; a measured score below 50 — including 0 — flags.
 * Outcome for null is unchanged (no flag before or after); the flag for
 * a genuine 0 is the deliberate behaviour change this fix exists for.
 *
 * Runs the real calculateScore → detectFraudSignals path (the function
 * is not exported), mocking only the DB pool, in the
 * honest-null-omniscore.test.js pattern.
 */

const mockState = { assessments: [] };

const mockClientQuery = jest.fn();
jest.mock('../../../lib/db', () => ({
	query: jest.fn(async () => ({ rows: [] })),
	connect: jest.fn(async () => ({
		query: (...a) => mockClientQuery(...a),
		release: jest.fn(),
	})),
}));

const pool = require('../../../lib/db');
const { calculateScore } = require('../../../services/omniscore');

function wireMocks() {
	mockClientQuery.mockImplementation(async (sql) => {
		if (String(sql).includes('FROM skill_assessments')) return { rows: mockState.assessments };
		return { rows: [] };
	});
	pool.query.mockImplementation(async (sql) => {
		if (String(sql).includes('COUNT(*) FILTER')) return { rows: [{ percentile: '50.0' }] };
		return { rows: [] };
	});
	pool.connect.mockImplementation(async () => ({
		query: (...a) => mockClientQuery(...a),
		release: jest.fn(),
	}));
}

beforeEach(() => {
	jest.clearAllMocks();
	mockState.assessments = [];
	wireMocks();
});

const assessment = (anti_cheat_score) => ({
	score: 80,
	max_score: 100,
	passed: true,
	completed_at: new Date(),
	created_at: new Date(),
	anti_cheat_score,
});

const hasSuspicious = (score) =>
	score.fraud_signals.some((s) => s.type === 'suspicious_assessment');

describe('#1715 O3 — anti-cheat fraud flag honest-null', () => {
	test('a genuine measured 0 flags as suspicious (not suppressed by a fake 100)', async () => {
		mockState.assessments = [assessment(0)];
		const score = await calculateScore(42);
		expect(hasSuspicious(score)).toBe(true);
	});

	test('a measured 30 flags as suspicious (control)', async () => {
		mockState.assessments = [assessment(30)];
		const score = await calculateScore(42);
		expect(hasSuspicious(score)).toBe(true);
	});

	test('NULL anti_cheat_score (never computed) raises NO flag from absence', async () => {
		mockState.assessments = [assessment(null)];
		const score = await calculateScore(42);
		expect(hasSuspicious(score)).toBe(false);
	});

	test('a measured 90 raises no flag (control)', async () => {
		mockState.assessments = [assessment(90)];
		const score = await calculateScore(42);
		expect(hasSuspicious(score)).toBe(false);
	});
});
