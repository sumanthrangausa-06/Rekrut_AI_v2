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
// row — the reviewer's exact reproduction. Only verified_skills (50 -> 69)
// and soft_skills (60 -> 33) are present; the other six factors have no
// data. Reachable on real rows: services/document-verification.js writes
// omni_scores rows with total_score + resume_score only.
const PARTIAL_ROW = {
	...SCORED_ROW,
	total_score: 500,
	factor_scores: { verified_skills: 50, soft_skills: 60 },
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
// 'partial-factors' | 'empty-factors'
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
		// stay null — never 0.
		expect(factorByKey(explanation, 'verified_skills')).toMatchObject({
			score: 50,
			contribution: 69,
		});
		expect(factorByKey(explanation, 'soft_skills')).toMatchObject({
			score: 60,
			contribution: 33,
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
