/**
 * #1776 — OmniScore reliability factor: measured-only raw (panel ruling
 * on #1761, Option D; AC-2 main text per Lead's STOP 1 ruling).
 *
 * calcReliabilitySignals previously built raw 85 from a 50-pt neutral
 * base + default 50% attendance + default follow-through, and the
 * explainer graded that 85 "Excellent" with no hasData gate. This suite
 * pins the service-level surfaces the calculator feeds:
 *  - calculateScore: apps-only candidate persists reliability as the
 *    follow-through-only renormalised 100 (never 85), behaviour compat
 *    follows it (#1596 measured-only), and the factor carries its
 *    coverage note; a zero-input candidate persists reliability null
 *    (#1538), behaviour null, and no attendance detail string exists.
 *  - getScoreExplainer: hasData=false => "Insufficient data" with no
 *    grade/verdict; partial reliability coverage => coverage note in the
 *    plain text, never an unqualified "exceptional" verdict.
 *  - the named scoring-semantics version bump is exported and returned.
 *
 * Mocked-pool suite in the pattern of omniscore-factor-null-1538.test.js.
 */

const mockState = { applications: [], interviews: [] };
const mockCaptured = { updateParams: null };

const mockClientQuery = jest.fn(async (sql) => {
	if (sql.includes('scheduled_interviews')) return { rows: mockState.interviews };
	if (sql.includes('job_applications')) return { rows: mockState.applications };
	return { rows: [] };
});

jest.mock('../../lib/db', () => ({
	connect: jest.fn(async () => ({ query: (...a) => mockClientQuery(...a), release: jest.fn() })),
	query: jest.fn(async (sql, params = []) => {
		if (sql.includes('UPDATE omni_scores')) {
			mockCaptured.updateParams = params;
			return { rows: [] };
		}
		if (sql.includes('COUNT(*) FILTER')) return { rows: [{ percentile: '50' }] };
		if (sql.includes('PERCENTILE_CONT')) {
			return { rows: [{ avg_score: null, top_score: null, median_score: null }] };
		}
		return { rows: [] };
	}),
}));

const pool = require('../../lib/db');
const omniscore = require('../../services/omniscore');
const { calculateScore, getScoreExplainer } = omniscore;

const USER = 991776;

beforeEach(() => {
	mockState.applications = [];
	mockState.interviews = [];
	mockCaptured.updateParams = null;
	jest.clearAllMocks();
	pool.query.mockImplementation(async (sql, params = []) => {
		if (sql.includes('UPDATE omni_scores')) {
			mockCaptured.updateParams = params;
			return { rows: [] };
		}
		if (sql.includes('COUNT(*) FILTER')) return { rows: [{ percentile: '50' }] };
		if (sql.includes('PERCENTILE_CONT')) {
			return { rows: [{ avg_score: null, top_score: null, median_score: null }] };
		}
		return { rows: [] };
	});
	pool.connect.mockImplementation(async () => ({
		query: (...a) => mockClientQuery(...a),
		release: jest.fn(),
	}));
	mockClientQuery.mockImplementation(async (sql) => {
		if (sql.includes('scheduled_interviews')) return { rows: mockState.interviews };
		if (sql.includes('job_applications')) return { rows: mockState.applications };
		return { rows: [] };
	});
});

describe('#1776 calculateScore — reliability measured-only', () => {
	test('zero-input candidate: reliability persists null, behaviour null, no attendance detail', async () => {
		const score = await calculateScore(USER);
		expect(score.factors.reliability_signals.hasData).toBe(false);
		expect(score.factors.reliability_signals.raw).toBe(0);
		expect(score.factors.reliability_signals.details.join(' ')).not.toMatch(/attendance/i);
		expect(score.behavior).toBeNull();
		const factors = JSON.parse(mockCaptured.updateParams[6]);
		expect(factors.reliability_signals).toBeNull();
	});

	test('apps-only candidate: reliability 100 follow-through-only with coverage note, never 85', async () => {
		mockState.applications = [{ status: 'applied' }];
		const score = await calculateScore(USER);
		expect(score.factors.reliability_signals.hasData).toBe(true);
		expect(score.factors.reliability_signals.raw).toBe(100);
		expect(score.factors.reliability_signals.coverageNote).toBe(
			'based on application follow-through only; attendance: insufficient data',
		);
		// #1596 measured-only compat: behaviour is the measured reliability alone.
		expect(score.behavior).toBe(100);
		const factors = JSON.parse(mockCaptured.updateParams[6]);
		expect(factors.reliability_signals).toBe(100);
	});

	test('Quinn gate scenario: 1 app + attended + no-show (real shapes) persists reliability 60', async () => {
		// Quinn journey gate on PR #1778 (2026-10-23) FAILED this leg at 70:
		// the no-show row the app actually writes is status 'no_show' with
		// outcome NULL, but the calculator counted no-shows from outcome
		// only — a vocabulary chk_scheduled_interviews_outcome forbids, so
		// the penalty could never fire on real data.
		mockState.applications = [{ status: 'applied' }];
		mockState.interviews = [
			{ status: 'completed', outcome: 'passed', feedback: null },
			{ status: 'no_show', outcome: null, feedback: null },
		];
		const score = await calculateScore(USER);
		// a = 1/2, f = 1: 60*0.5 + 40*1 - 10 penalty = 60
		expect(score.factors.reliability_signals.raw).toBe(60);
		expect(score.factors.reliability_signals.coverageNote).toBeNull();
		expect(score.behavior).toBe(60);
		const factors = JSON.parse(mockCaptured.updateParams[6]);
		expect(factors.reliability_signals).toBe(60);
	});

	test('scoring-semantics version bump is named and returned', async () => {
		// #1776 introduced v3-reliability-measured-only; #1777 supersedes
		// it with v4-total-renormalised (total renormalisation + market
		// floor removal, same file). The current version is pinned here;
		// #1777's own suite pins the v4 semantics.
		expect(omniscore.SCORING_SEMANTICS_VERSION).toBe('v4-total-renormalised');
		const score = await calculateScore(USER);
		expect(score.scoring_semantics_version).toBe('v4-total-renormalised');
	});
});

describe('#1776 getScoreExplainer — hasData gate + coverage note', () => {
	const reliabilityEntry = (out) => out.factors.find((f) => f.name === 'Reliability Signals');

	test('no-data candidate: reliability is "Insufficient data", no grade, no verdict', async () => {
		const out = await getScoreExplainer(USER);
		const rel = reliabilityEntry(out);
		expect(rel.grade).toBe('Insufficient data');
		expect(rel.plain_text).toBe('Insufficient data');
		expect(rel.has_data).toBe(false);
		expect(rel.action).toBeNull();
	});

	test('apps-only candidate: coverage note qualifies the verdict — never unqualified exceptional', async () => {
		mockState.applications = [{ status: 'applied' }];
		const out = await getScoreExplainer(USER);
		const rel = reliabilityEntry(out);
		expect(rel.raw_score).toBe(100);
		expect(rel.coverage_note).toBe(
			'based on application follow-through only; attendance: insufficient data',
		);
		expect(rel.plain_text).toContain(
			'based on application follow-through only; attendance: insufficient data',
		);
	});
});
