/**
 * #1523 (Story B of #1152): Score explanation repoint R1 — explainOmniScore
 * moves from the never-written `omniscore_results` table to live
 * `omni_scores`, and the fabricated 40/30/30 formula is DROPPED.
 *
 * Rex scale decision (2026-10-20, §4 R1 / §5.2): PASS-THROUGH, no
 * conversion of the headline. total_score is native 300–850; factors are
 * native 0–100 (technical <- technical_score, behavioral <- behavior_score
 * — a composite of reliability + soft skills, labelled as such — and
 * experience <- factor_scores.experience_quality). The replacement for the
 * formula is the engine's real 8-factor breakdown from factor_scores with
 * FACTOR_WEIGHTS (.25/.20/.15/.10/.10/.10/.05/.05); a factor's contribution
 * to the total is weight × raw/100 × 550 total-scale points.
 *
 * No-data = missing omni_scores row OR total_score IS NULL (#1192) → an
 * honest insufficient-data response, never a throw/500.
 *
 * Extended by #1785: factor_breakdown contributions are renormalised
 * over MEASURED factors only (non-NULL factor_scores entries), matching
 * the v4 total in services/omniscore.js — see the #1785 describe block
 * at the end of this file and the real-DB pin in
 * score-explainer-renormalisation-realdb-1785.test.js.
 *
 * Harness follows the #1522 suite: the REAL route + REAL ScoreExplainer
 * service run; only the pool boundary is mocked. The mock routes on the
 * LIVE table name, so on pre-repoint code (queries against
 * omniscore_results) the score read falls through to [] and the old code
 * throws — that is the red state. The normalised anchor (total 612 ->
 * 56.7, Rex §3.2) is pinned on the payload's labelled
 * overall_score_normalized field. The HL-003 dev E2E (real DB, real HTTP)
 * is Quinn's gate after independent review; it is not replaced here.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((req, _res, next) => {
		req.user = { id: 7, role: 'candidate' };
		return next();
	}),
}));

jest.mock('../../../lib/db', () => ({ query: jest.fn() }));

const mockAuditLog = jest.fn(async () => {});
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: {
		log: (...args) => mockAuditLog(...args),
		query: jest.fn(async () => []),
		exportLogs: jest.fn(async () => []),
	},
	logEvent: jest.fn(async () => ({})),
	getAuditTrail: jest.fn(async () => ({ rows: [] })),
	getCandidateDecisions: jest.fn(async () => []),
	verifyChain: jest.fn(async () => ({})),
	exportForRegulator: jest.fn(async () => ({})),
	EVENT_TYPES: { AI_DECISION: 'ai_decision', STATUS_CHANGE: 'status_change' },
	ENTITY_TYPES: { CANDIDATE: 'candidate', JOB: 'job' },
}));

jest.mock('../../../services/euComplianceService', () => ({}));

const pool = require('../../../lib/db');
const { explainOmniScore } = require('../../../services/scoreExplainer');
const complianceRoutes = require('../../../routes/compliance');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/compliance', complianceRoutes);
	return app;
}

// A row exactly as the live engine persists it (services/omniscore.js
// calculateScore): factor contributions 110+66+66+33+50+44+11+11 = 391,
// so total = 300 + 391 = 691; technical_score = verified_skills raw;
// behavior_score = avg(reliability_signals, soft_skills) = avg(90, 80) = 85.
const SCORED_ROW = {
	total_score: 691,
	technical_score: 80,
	behavior_score: 85,
	score_tier: 'good',
	last_updated: new Date('2026-10-19T00:00:00Z'),
	factor_scores: {
		verified_skills: 80,
		interview_performance: 60,
		experience_quality: 80,
		education_credentials: 60,
		reliability_signals: 90,
		soft_skills: 80,
		market_demand: 40,
		growth_trajectory: 40,
	},
};
// Rex §3.2 anchor fixture: a known total of 612 normalises to 56.7.
const ANCHOR_ROW = { ...SCORED_ROW, total_score: 612 };
const NULL_TOTAL_ROW = { ...SCORED_ROW, total_score: null };
// Review BLOCK on PR #1531 (comment 6307320338): a partial factor_scores
// row — the reviewer's exact reproduction. Only verified_skills and
// soft_skills are present; the other six factors have no data.
// Reachable on real rows: services/document-verification.js writes
// omni_scores rows with total_score + resume_score only.
// #1785 renormalised contributions (measured weight = .25 + .10 = .35):
// verified 50 -> round(50/100 x (.25/.35) x 550) = 196; soft 60 ->
// round(60/100 x (.10/.35) x 550) = 94. (Pre-#1785 nominal: 69 / 33.)
const PARTIAL_ROW = {
	...SCORED_ROW,
	total_score: 500,
	factor_scores: { verified_skills: 50, soft_skills: 60 },
};
// #1785 sole-measured row, exactly as the v4 engine persists it (#1538
// number-or-null): reliability_signals 100 is the ONLY measured factor,
// so the renormalised total is that factor alone — 300 + 1.0 x 550 =
// 850 — and its explainer contribution must be the full 550 (pre-fix
// nominal: 55, a 495-point unexplained gap; PR #1784 review F1).
// behavior_score is the #1596 compat average over measured sources = 100.
const SOLE_MEASURED_ROW = {
	total_score: 850,
	technical_score: null,
	behavior_score: 100,
	score_tier: 'exceptional',
	last_updated: new Date('2026-10-19T00:00:00Z'),
	factor_scores: {
		verified_skills: null,
		interview_performance: null,
		experience_quality: null,
		education_credentials: null,
		reliability_signals: 100,
		soft_skills: null,
		market_demand: null,
		growth_trajectory: null,
	},
};
// #1785 mixed-measured row: reliability 100 (w .10) + education 25
// (w .10), measured weight .20, total = round(300 + (0.10x100 +
// 0.10x25)/0.20 /100 x 550) = 644 (the #1777 mixed fixture, persisted).
const MIXED_MEASURED_ROW = {
	...SOLE_MEASURED_ROW,
	total_score: 644,
	score_tier: 'fair',
	factor_scores: {
		...SOLE_MEASURED_ROW.factor_scores,
		reliability_signals: 100,
		education_credentials: 25,
	},
};
// Same block, empty factor_scores: no factor data at all, total present.
const EMPTY_FACTORS_ROW = { ...SCORED_ROW, total_score: 350, factor_scores: {} };

const HISTORY_ROWS = [
	{
		previous_score: 650,
		new_score: 691,
		change_amount: 41,
		change_reason: 'coding_assessment',
		component_type: 'technical',
		created_at: new Date('2026-10-18T00:00:00Z'),
	},
];
const COMPONENT_ROWS = [
	{
		component_type: 'technical',
		source_type: 'coding_assessment',
		points_earned: '25',
		weight: '1.00',
		created_at: new Date('2026-10-18T00:00:00Z'),
		metadata: {},
	},
];

// scenario: 'scored' | 'anchor' | 'null-total' | 'missing' |
// 'partial-factors' | 'empty-factors' | 'sole-measured' | 'mixed-measured'
let scenario = 'scored';
const seenSql = [];

function installPoolMock() {
	pool.query.mockImplementation(async (sql) => {
		seenSql.push(sql);
		const s = sql.toLowerCase();
		if (s.includes('from omni_scores')) {
			if (scenario === 'missing') return { rows: [] };
			if (scenario === 'null-total') return { rows: [NULL_TOTAL_ROW] };
			if (scenario === 'anchor') return { rows: [ANCHOR_ROW] };
			if (scenario === 'partial-factors') return { rows: [PARTIAL_ROW] };
			if (scenario === 'empty-factors') return { rows: [EMPTY_FACTORS_ROW] };
			if (scenario === 'sole-measured') return { rows: [SOLE_MEASURED_ROW] };
			if (scenario === 'mixed-measured') return { rows: [MIXED_MEASURED_ROW] };
			return { rows: [SCORED_ROW] };
		}
		if (s.includes('from score_components')) return { rows: COMPONENT_ROWS };
		if (s.includes('from score_history')) return { rows: HISTORY_ROWS };
		// Pre-repoint code reads omniscore_results: no route above matches
		// it, so it lands here with [] — the red state.
		return { rows: [] };
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	scenario = 'scored';
	seenSql.length = 0;
	installPoolMock();
});

const factorByKey = (explanation, key) =>
	explanation.factor_breakdown.find((f) => f.factor === key);

describe('#1523 explainOmniScore — pass-through headline + factors (Rex §4 R1)', () => {
	test('reads omni_scores, never the dead omniscore_results table', async () => {
		await explainOmniScore(7);
		expect(seenSql.some((s) => s.toLowerCase().includes('from omni_scores'))).toBe(true);
		expect(seenSql.some((s) => s.toLowerCase().includes('omniscore_results'))).toBe(false);
	});

	test('headline is total_score pass-through on the 300–850 scale', async () => {
		const explanation = await explainOmniScore(7);
		expect(explanation.overall_score).toBe(691);
		expect(explanation.score_scale).toBe('300-850');
		expect(explanation.insufficient_data).toBe(false);
	});

	test('known total 612 passes through and normalises to 56.7 (Rex §3.2 anchor)', async () => {
		scenario = 'anchor';
		const explanation = await explainOmniScore(7);
		expect(explanation.overall_score).toBe(612);
		expect(explanation.overall_score_normalized).toBe(56.7);
	});

	test('3-group breakdown maps the live columns/factor with honest labels', async () => {
		const explanation = await explainOmniScore(7);
		const { technical, behavioral, experience } = explanation.score_breakdown;
		expect(technical.score).toBe(80); // omni_scores.technical_score
		expect(behavioral.score).toBe(85); // omni_scores.behavior_score
		expect(behavioral.label).toMatch(/composite/i); // NOT an assessment score (Rex §5.4)
		expect(experience.score).toBe(80); // factor_scores.experience_quality
		expect(experience.label).toMatch(/experience quality/i);
	});

	test('recent_changes pass through from score_history (already total-scale)', async () => {
		const explanation = await explainOmniScore(7);
		expect(explanation.recent_changes).toHaveLength(1);
		expect(explanation.recent_changes[0]).toMatchObject({
			previous: 650,
			new: 691,
			change: 41,
			reason: 'coding_assessment',
			component: 'technical',
		});
	});
});

describe('#1523 8-factor breakdown replaces the fabricated 40/30/30 formula', () => {
	test('factor_breakdown carries all 8 engine factors with FACTOR_WEIGHTS', async () => {
		const explanation = await explainOmniScore(7);
		expect(explanation.factor_breakdown).toHaveLength(8);
		expect(factorByKey(explanation, 'verified_skills')).toMatchObject({
			label: 'Verified Skills',
			score: 80,
			weight: 0.25,
			contribution: 110, // 0.25 × 80/100 × 550
		});
		expect(factorByKey(explanation, 'interview_performance')).toMatchObject({
			score: 60,
			weight: 0.2,
			contribution: 66,
		});
		expect(factorByKey(explanation, 'experience_quality')).toMatchObject({
			score: 80,
			weight: 0.15,
			contribution: 66,
		});
		expect(factorByKey(explanation, 'growth_trajectory')).toMatchObject({
			score: 40,
			weight: 0.05,
			contribution: 11,
		});
		const weightSum = explanation.factor_breakdown.reduce((sum, f) => sum + f.weight, 0);
		expect(weightSum).toBeCloseTo(1, 10);
	});

	test('3-group weights are the true engine weights, not 40/30/30', async () => {
		const explanation = await explainOmniScore(7);
		expect(explanation.score_breakdown.technical.weight).toBe(0.25);
		expect(explanation.score_breakdown.technical.contribution).toBe(110);
		expect(explanation.score_breakdown.experience.weight).toBe(0.15);
		expect(explanation.score_breakdown.experience.contribution).toBe(66);
		// behavioral composite = reliability .10 + soft skills .10 exactly
		expect(explanation.score_breakdown.behavioral.weight).toBe(0.2);
		expect(explanation.score_breakdown.behavioral.contribution).toBe(94); // 50 + 44
	});

	test('how_calculated describes the real 8-factor engine formula', async () => {
		const explanation = await explainOmniScore(7);
		const how = JSON.stringify(explanation.how_calculated);
		expect(how).not.toMatch(/40%|30%/);
		expect(explanation.how_calculated.formula).toMatch(/300/);
		expect(explanation.how_calculated.formula).toMatch(/550/);
		expect(explanation.how_calculated.formula).toMatch(/8 factors/);
		expect(explanation.how_calculated.breakdown.join(' ')).toMatch(/Verified Skills/);
	});
});

describe('#1523 no-data honesty — insufficient data, never a 500', () => {
	test('NULL total_score returns insufficient_data instead of throwing', async () => {
		scenario = 'null-total';
		const explanation = await explainOmniScore(7);
		expect(explanation.insufficient_data).toBe(true);
		expect(explanation.overall_score).toBeNull();
		expect(explanation.factor_breakdown).toEqual([]);
	});

	test('missing omni_scores row returns insufficient_data instead of throwing', async () => {
		scenario = 'missing';
		const explanation = await explainOmniScore(7);
		expect(explanation.insufficient_data).toBe(true);
		expect(explanation.overall_score).toBeNull();
	});

	test('route: scored user gets 200 with the pass-through explanation', async () => {
		const res = await request(makeApp()).get('/api/compliance/explain/omniscore/7');
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.explanation.overall_score).toBe(691);
		expect(res.body.explanation.factor_breakdown).toHaveLength(8);
	});

	test('route: NULL-total user gets 200 insufficient_data, NOT 500', async () => {
		scenario = 'null-total';
		const res = await request(makeApp()).get('/api/compliance/explain/omniscore/7');
		expect(res.status).toBe(200);
		expect(res.body.explanation.insufficient_data).toBe(true);
		expect(res.body.explanation.overall_score).toBeNull();
	});

	test('route: user with no score row gets 200 insufficient_data, NOT 500', async () => {
		scenario = 'missing';
		const res = await request(makeApp()).get('/api/compliance/explain/omniscore/7');
		expect(res.status).toBe(200);
		expect(res.body.explanation.insufficient_data).toBe(true);
	});
});

describe('#1523 partial/empty factor_scores — no fabricated decomposition (PR #1531 BLOCK 6307320338)', () => {
	test('partial factor_scores: no 0-substituted false equality, honest stored-total explanation', async () => {
		scenario = 'partial-factors';
		const explanation = await explainOmniScore(7);
		// The total exists, so this is NOT the insufficient-data path.
		expect(explanation.insufficient_data).toBe(false);
		expect(explanation.overall_score).toBe(500);
		// Present factors keep their real contributions; missing factors
		// stay null — never 0. #1785: contributions are renormalised over
		// the measured set (.25 + .10 = .35), not nominal — verified 50 ->
		// round(.50 x .25/.35 x 550) = 196, soft 60 -> round(.60 x .10/.35
		// x 550) = 94 (pre-#1785 nominal pins were 69 / 33).
		expect(factorByKey(explanation, 'verified_skills')).toMatchObject({
			score: 50,
			contribution: 196,
		});
		expect(factorByKey(explanation, 'soft_skills')).toMatchObject({
			score: 60,
			contribution: 94,
		});
		expect(factorByKey(explanation, 'interview_performance')).toMatchObject({
			score: null,
			contribution: null,
		});
		// The block: current code renders
		// "500 = 300 + 69 + 0 + 0 + 0 + 0 + 33 + 0 + 0" (RHS = 402).
		// No equality form may be rendered while any contribution is null.
		const calculation = explanation.how_calculated.calculation;
		expect(calculation).not.toMatch(/=\s*300\s*\+/);
		expect(calculation).not.toMatch(/500\s*=/);
		// Honest replacement: the total is the stored OmniScore and a
		// full decomposition is unavailable because factor data is missing.
		expect(calculation).toMatch(/500/);
		expect(calculation).toMatch(/stored OmniScore/);
		expect(calculation).toMatch(/missing/);
		// The per-factor breakdown lines stay honest on the same payload.
		expect(explanation.how_calculated.breakdown.join(' ')).toMatch(
			/no data — no contribution/,
		);
	});

	test('empty factor_scores: no 0-substituted false equality, honest stored-total explanation', async () => {
		scenario = 'empty-factors';
		const explanation = await explainOmniScore(7);
		expect(explanation.insufficient_data).toBe(false);
		expect(explanation.overall_score).toBe(350);
		expect(explanation.factor_breakdown).toHaveLength(8);
		for (const factor of explanation.factor_breakdown) {
			expect(factor.score).toBeNull();
			expect(factor.contribution).toBeNull();
		}
		const calculation = explanation.how_calculated.calculation;
		expect(calculation).not.toMatch(/=\s*300\s*\+/);
		expect(calculation).not.toMatch(/350\s*=/);
		expect(calculation).toMatch(/350/);
		expect(calculation).toMatch(/stored OmniScore/);
		expect(calculation).toMatch(/missing/);
	});

	test('route: partial factor_scores user gets 200 with no false equality', async () => {
		scenario = 'partial-factors';
		const res = await request(makeApp()).get('/api/compliance/explain/omniscore/7');
		expect(res.status).toBe(200);
		expect(res.body.explanation.insufficient_data).toBe(false);
		expect(res.body.explanation.overall_score).toBe(500);
		expect(res.body.explanation.how_calculated.calculation).not.toMatch(/=\s*300\s*\+/);
		expect(res.body.explanation.how_calculated.calculation).toMatch(/stored OmniScore/);
	});
});

describe('#1785 factor_breakdown — contributions renormalised over measured factors only (v4)', () => {
	const contributionSum = (explanation) =>
		explanation.factor_breakdown.reduce((sum, f) => sum + (f.contribution || 0), 0);

	test('sole-measured candidate: reliability contribution is the full 550 and sums to the 850 headline', async () => {
		scenario = 'sole-measured';
		const explanation = await explainOmniScore(7);
		expect(explanation.overall_score).toBe(850);
		// Nominal weight stays reported as-is; the EFFECTIVE weight of
		// the only measured factor is 1.0, so its contribution is the
		// full 550 — pre-fix this was 55 (nominal .10), leaving a
		// 495-point unexplained gap against the headline (PR #1784 F1).
		expect(factorByKey(explanation, 'reliability_signals')).toMatchObject({
			score: 100,
			weight: 0.1,
			effective_weight: 1,
			contribution: 550,
		});
		for (const f of explanation.factor_breakdown) {
			if (f.factor === 'reliability_signals') continue;
			expect(f.score).toBeNull();
			expect(f.contribution).toBeNull(); // honest: no contribution, never nominal/0 faked
			expect(f.effective_weight).toBe(0);
		}
		expect(contributionSum(explanation)).toBe(explanation.overall_score - 300);
	});

	test('sole-measured: 3-group score_breakdown uses the same renormalisation', async () => {
		scenario = 'sole-measured';
		const explanation = await explainOmniScore(7);
		// behavioral composite is backed by reliability alone here:
		// score 100 x effective (1 + 0) x 550 = 550.
		expect(explanation.score_breakdown.behavioral.score).toBe(100);
		expect(explanation.score_breakdown.behavioral.contribution).toBe(550);
		// Groups with no measured backing factor: no contribution.
		expect(explanation.score_breakdown.technical.score).toBeNull();
		expect(explanation.score_breakdown.technical.contribution).toBeNull();
		expect(explanation.score_breakdown.experience.score).toBeNull();
		expect(explanation.score_breakdown.experience.contribution).toBeNull();
	});

	test('mixed-measured candidate: contributions sum to the renormalised 644 headline', async () => {
		scenario = 'mixed-measured';
		const explanation = await explainOmniScore(7);
		expect(explanation.overall_score).toBe(644);
		// Measured weight .10 + .10 = .20 -> each effective weight .5.
		expect(factorByKey(explanation, 'reliability_signals')).toMatchObject({
			score: 100,
			effective_weight: 0.5,
			contribution: 275, // 1.00 x .5 x 550
		});
		expect(factorByKey(explanation, 'education_credentials')).toMatchObject({
			score: 25,
			effective_weight: 0.5,
			contribution: 69, // round(.25 x .5 x 550) = round(68.75)
		});
		for (const f of explanation.factor_breakdown) {
			if (f.factor === 'reliability_signals' || f.factor === 'education_credentials') continue;
			expect(f.contribution).toBeNull();
			expect(f.effective_weight).toBe(0);
		}
		expect(contributionSum(explanation)).toBe(explanation.overall_score - 300); // 275 + 69 = 344
	});

	test('fully-measured candidate: renormalisation is the identity (existing nominal pins hold)', async () => {
		const explanation = await explainOmniScore(7);
		for (const f of explanation.factor_breakdown) {
			expect(f.effective_weight).toBeCloseTo(f.weight, 10);
		}
		expect(contributionSum(explanation)).toBe(explanation.overall_score - 300); // 391 = 691 - 300
	});

	test('route: sole-measured user gets 200 with contributions summing to the headline', async () => {
		scenario = 'sole-measured';
		const res = await request(makeApp()).get('/api/compliance/explain/omniscore/7');
		expect(res.status).toBe(200);
		expect(res.body.explanation.overall_score).toBe(850);
		expect(contributionSum(res.body.explanation)).toBe(550);
	});
});
