/**
 * #1777 — OmniScore total renormalisation audit (parent #1761, panel
 * comment 6374505039, companion (2); STOP 1 comment 6376270386).
 *
 * Defect: computeFactors summed every factor's raw over the FULL weight
 * sum (1.0) regardless of hasData. Two consequences:
 *  (a) calcMarketDemand's fallback floor (`matchCount × 20 + 20`) gave a
 *      candidate with zero skills and zero matches raw 20 with
 *      hasData=false — phantom points in the headline total;
 *  (b) every other no-data factor's raw is 0, but its weight stayed in
 *      the denominator, so a candidate measured on one factor alone was
 *      diluted by the seven unmeasured weights (reliability-only raw 100
 *      totalled ~361 instead of the 850 that factor alone implies).
 *
 * Fix (the #1596 compatScore / #1731 measured-only pattern already in
 * services/omniscore.js — no second mechanism): the total is the
 * weighted renormalisation over MEASURED factors only; no measured
 * factor → total stays null (#1192/#1538 unchanged). Market demand is
 * measured-only: the silent +20 floor is removed. Fully-measured
 * candidates are unchanged (renormalising over weight sum 1.0 is the
 * identity). Ships as SCORING_SEMANTICS_VERSION v4-total-renormalised.
 *
 * Mocked-pool suite in the pattern of omniscore-reliability-1776 /
 * omniscore-factor-null-1538. Mocked rows use REAL shapes only (HL-003):
 * interview rows carry status/outcome in the storable vocabularies
 * (chk_scheduled_interviews_status / _outcome); the persisted-row
 * assertions that matter most are ALSO pinned on a real DB in
 * omniscore-total-renormalisation-realdb-1777.test.js.
 */

const mockState = { skills: [], education: [], experience: [], interviews: [], applications: [], practice: [], matches: [], activity: [], projects: [] };
const mockCaptured = { updateParams: null };

const mockClientQuery = jest.fn(async (sql) => {
	if (sql.includes('candidate_skills')) return { rows: mockState.skills };
	if (sql.includes('FROM education')) return { rows: mockState.education };
	if (sql.includes('work_experience')) return { rows: mockState.experience };
	if (sql.includes('scheduled_interviews')) return { rows: mockState.interviews };
	if (sql.includes('job_applications')) return { rows: mockState.applications };
	if (sql.includes('practice_sessions')) return { rows: mockState.practice };
	if (sql.includes('match_results')) return { rows: mockState.matches };
	if (sql.includes('activity_log')) return { rows: mockState.activity };
	if (sql.includes('portfolio_projects')) return { rows: mockState.projects };
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
const { calculateScore, getScoreBreakdown, getScoreExplainer, calcMarketDemand } = omniscore;

const USER = 991777;

const emptyData = () => ({
	profile: null,
	skills: [],
	experience: [],
	education: [],
	assessments: [],
	practice: [],
	interviews: [],
	applications: [],
	projects: [],
	docs: [],
	matches: [],
	activity: [],
});

function restoreMocks() {
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
		if (sql.includes('candidate_skills')) return { rows: mockState.skills };
		if (sql.includes('FROM education')) return { rows: mockState.education };
		if (sql.includes('work_experience')) return { rows: mockState.experience };
		if (sql.includes('scheduled_interviews')) return { rows: mockState.interviews };
		if (sql.includes('job_applications')) return { rows: mockState.applications };
		if (sql.includes('practice_sessions')) return { rows: mockState.practice };
		if (sql.includes('match_results')) return { rows: mockState.matches };
		if (sql.includes('activity_log')) return { rows: mockState.activity };
		if (sql.includes('portfolio_projects')) return { rows: mockState.projects };
		return { rows: [] };
	});
}

beforeEach(() => {
	mockState.skills = [];
	mockState.education = [];
	mockState.experience = [];
	mockState.interviews = [];
	mockState.applications = [];
	mockState.practice = [];
	mockState.matches = [];
	mockState.activity = [];
	mockState.projects = [];
	mockCaptured.updateParams = null;
	jest.clearAllMocks();
	restoreMocks();
});

describe('#1777 calcMarketDemand — measured-only, no silent +20 floor', () => {
	test('no matches and no skills: raw 0 with hasData=false (was phantom 20)', () => {
		const result = calcMarketDemand(emptyData());
		expect(result.hasData).toBe(false);
		expect(result.raw).toBe(0);
	});

	test('skills present but none in-demand: measured 0, hasData=true', () => {
		const result = calcMarketDemand({ ...emptyData(), skills: [{ category: 'cooking' }] });
		expect(result.hasData).toBe(true);
		expect(result.raw).toBe(0);
	});

	test('one in-demand skill category: raw 20 (was 40 with the floor)', () => {
		const result = calcMarketDemand({ ...emptyData(), skills: [{ category: 'AI' }] });
		expect(result.hasData).toBe(true);
		expect(result.raw).toBe(20);
	});

	test('two in-demand skill categories: raw 40', () => {
		const result = calcMarketDemand({
			...emptyData(),
			skills: [{ category: 'AI' }, { category: 'cloud computing' }],
		});
		expect(result.raw).toBe(40);
	});

	test('matches branch unchanged: one good match of one = raw 100', () => {
		const result = calcMarketDemand({ ...emptyData(), matches: [{ match_level: 'good' }] });
		expect(result.hasData).toBe(true);
		expect(result.raw).toBe(100);
	});
});

describe('#1777 calculateScore — total renormalised over measured factors only', () => {
	test('Quinn gate scenario: exactly one measured factor — total is that factor alone', async () => {
		// 1 application, nothing else: reliability is the sole measured
		// factor, follow-through-only raw 100 (#1776). Renormalised over
		// measured weight 0.10 alone: 300 + 1.0 × 550 = 850.
		// Pre-fix: 300 + (0.10×100 + 0.05×20 phantom market)/100 × 550 ≈ 361.
		mockState.applications = [{ status: 'applied' }];
		const score = await calculateScore(USER);
		expect(score.factors.reliability_signals.hasData).toBe(true);
		expect(score.factors.reliability_signals.raw).toBe(100);
		for (const [key, f] of Object.entries(score.factors)) {
			if (key !== 'reliability_signals') expect(f.hasData).toBe(false);
		}
		expect(score.total_score).toBe(850);
		// Persisted: total 850, reliability 100, every other factor null.
		expect(mockCaptured.updateParams[0]).toBe(850);
		const persisted = JSON.parse(mockCaptured.updateParams[6]);
		expect(persisted.reliability_signals).toBe(100);
		for (const [key, v] of Object.entries(persisted)) {
			if (key !== 'reliability_signals') expect(v).toBeNull();
		}
	});

	test('mixed measured/no-data: total equals the renormalised-over-measured value', async () => {
		// Measured: reliability 100 (1 app, follow-through only, w 0.10) and
		// education 25 (Bachelor 20 + 1 field of study 5, w 0.10).
		// Renormalised: (0.10×100 + 0.10×25) / 0.20 = 62.5 →
		// total = round(300 + 0.625 × 550) = 644. The six no-data factors
		// (including market_demand) contribute nothing — neither points
		// nor weight.
		mockState.applications = [{ status: 'applied' }];
		mockState.education = [{ degree: 'Bachelor', field_of_study: 'Computer Science', gpa: null }];
		const score = await calculateScore(USER);
		expect(score.factors.education_credentials.raw).toBe(25);
		expect(score.factors.reliability_signals.raw).toBe(100);
		expect(score.total_score).toBe(644);
	});

	test('adding a no-data factor never moves the total', async () => {
		// Baseline: reliability-only candidate.
		mockState.applications = [{ status: 'applied' }];
		const base = await calculateScore(USER);
		// Add input that yields only a NO-DATA factor: a practice row with
		// no numeric score (fetchCandidateData's real shape allows score
		// NULL rows; calcInterviewPerformance counts only numeric scores,
		// and 'technical' is not a soft-skill category) — interview and
		// soft skills both stay hasData=false.
		mockState.practice = [{ category: 'technical', score: null }];
		const withNoData = await calculateScore(USER);
		expect(withNoData.factors.interview_performance.hasData).toBe(false);
		expect(withNoData.factors.soft_skills.hasData).toBe(false);
		expect(withNoData.total_score).toBe(base.total_score);
	});

	test('zero-input candidate: total stays null (#1192/#1538 unchanged)', async () => {
		const score = await calculateScore(USER);
		expect(score.total_score).toBeNull();
		expect(score.tier).toBeNull();
		expect(mockCaptured.updateParams[0]).toBeNull();
	});

	test('fully-measured candidate: total unchanged (renormalisation over 1.0 is the identity)', async () => {
		// All 8 factors measured with integer raws:
		// verified 5 (1 project × 5), interview 40 (practice 8/10 × 5),
		// experience 0 (record exists, no dates — measured 0),
		// education 25, reliability 100 (follow-through only),
		// soft 48 (communication practice 8 × 6), market 100 (1/1 good
		// matches), growth 10 (1 active week).
		// Old formula: 300 + (0.25×5 + 0.20×40 + 0.15×0 + 0.10×25 +
		// 0.10×100 + 0.10×48 + 0.05×100 + 0.05×10)/100 × 550
		// = 300 + 32.05/100 × 550 = 476 (rounded).
		mockState.projects = [{ id: 1 }];
		mockState.practice = [{ category: 'communication', score: 8 }];
		mockState.experience = [
			{ title: 'Dev', start_date: null, end_date: null, is_current: false, achievements: [] },
		];
		mockState.education = [{ degree: 'Bachelor', field_of_study: 'Computer Science', gpa: null }];
		mockState.applications = [{ status: 'applied' }];
		mockState.matches = [{ match_level: 'good' }];
		mockState.activity = [{ created_at: new Date().toISOString() }];
		const score = await calculateScore(USER);
		for (const f of Object.values(score.factors)) expect(f.hasData).toBe(true);
		expect(score.factors.experience_quality.raw).toBe(0); // measured 0, not no-data
		expect(score.total_score).toBe(476);
	});

	test('scoring-semantics version bump is named and returned', async () => {
		expect(omniscore.SCORING_SEMANTICS_VERSION).toBe('v5-interview-performance-vocab');
		const score = await calculateScore(USER);
		expect(score.scoring_semantics_version).toBe('v5-interview-performance-vocab');
	});
});

describe('#1777 breakdown/explainer — contributions use the renormalised weight', () => {
	test('breakdown: sole measured factor carries the full 550, no-data factors 0', async () => {
		mockState.applications = [{ status: 'applied' }];
		const { current, breakdown } = await getScoreBreakdown(USER);
		expect(current.total_score).toBe(850);
		expect(breakdown.reliability_signals.weighted_contribution).toBe(550);
		expect(breakdown.reliability_signals.has_data).toBe(true);
		for (const [key, f] of Object.entries(breakdown)) {
			if (key === 'reliability_signals') continue;
			expect(f.has_data).toBe(false);
			expect(f.weighted_contribution).toBe(0);
		}
		const sum = Object.values(breakdown).reduce((s, f) => s + f.weighted_contribution, 0);
		expect(sum).toBe(current.total_score - 300);
	});

	test('explainer: sole measured factor impact is the full contribution, others Insufficient data', async () => {
		mockState.applications = [{ status: 'applied' }];
		const out = await getScoreExplainer(USER);
		const rel = out.factors.find((f) => f.name === 'Reliability Signals');
		expect(rel.impact).toBe(550);
		for (const f of out.factors) {
			if (f.name === 'Reliability Signals') continue;
			expect(f.grade).toBe('Insufficient data');
			expect(f.impact).toBe(0);
		}
	});
});
