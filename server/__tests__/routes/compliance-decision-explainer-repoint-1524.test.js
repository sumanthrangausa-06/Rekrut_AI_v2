/**
 * #1524 (Story C of #1152): Decision explanation repoint R3 —
 * explainDecision moves from the never-written `omniscore_results`
 * table to live `omni_scores`, and the Low-OmniScore threshold is
 * converted from the dead 0–100 assumption to the native scale.
 *
 * Rex scale decision (2026-10-20, §4 R3 / §3.3 / §5.3): PASS-THROUGH.
 * JOIN omni_scores ON user_id = candidate_id, total_score AS
 * overall_score (native 300–850), technical_score, behavior_score AS
 * behavioral_score; experience_score selection dropped. #1458
 * NULL-honesty preserved verbatim: current_omniscore is the parsed
 * total or null (insufficient data), never NaN/0.
 *
 * BEHAVIOUR CHANGE (§5.3): omniscore_at_apply has always carried
 * 300–850 values, so the old `< 60` branch could never fire. The
 * threshold becomes `< 630` (300 + 60 × 5.5) and the factor starts
 * firing for rejected applications below 630. The match-score `< 70`
 * check is a DIFFERENT score (match scale) and is not touched.
 *
 * Harness follows the #1523 suite: the REAL route + REAL
 * ScoreExplainer service run; only the pool boundary is mocked. The
 * mock emulates a real database: a query against the dead
 * omniscore_results table LEFT JOINs to NULL score fields (the table
 * is empty), while a query against omni_scores returns the seeded
 * live row — so on pre-repoint code current_omniscore reads null
 * instead of the seeded total. That makes the pre-repoint code red
 * on the score read, the SQL shape, and the never-firing threshold
 * (verified: 6 of 9 tests fail on origin/dev code; the 3 that pass
 * are the NULL-honesty and no-factor regression guards). The HL-003 dev E2E (real DB, real HTTP) is
 * Quinn's gate after independent review; it is not replaced here.
 */
const express = require('express');
const request = require('supertest');

const mockUser = { id: 1, role: 'admin' };
jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((req, _res, next) => {
		req.user = { ...mockUser };
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
const { explainDecision } = require('../../../services/scoreExplainer');
const complianceRoutes = require('../../../routes/compliance');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/compliance', complianceRoutes);
	return app;
}

// scenario: 'low' (at_apply 500, current 500) | 'high' (at_apply 700,
// current 700) | 'null-total' (row exists, total NULL) | 'missing'
// (no omni_scores row) | 'low-with-match' (low + a 65 match row)
let scenario = 'low';
const seenSql = [];

const AT_APPLY = { low: 500, 'low-with-match': 500, high: 700, 'null-total': 500, missing: 500 };
const CURRENT = { low: 500, 'low-with-match': 500, high: 700 };

function installPoolMock() {
	pool.query.mockImplementation(async (sql) => {
		seenSql.push(sql);
		const s = sql.toLowerCase();
		if (s.includes('from job_applications')) {
			// Route authorisation guard (routes/compliance.js S-097).
			if (s.includes('candidate_id, company_id')) {
				return { rows: [{ candidate_id: 7, company_id: 42 }] };
			}
			const base = {
				id: 1,
				candidate_id: 7,
				job_id: 99,
				company_id: 42,
				status: 'rejected',
				updated_at: new Date('2026-10-19T00:00:00Z'),
				recruiter_notes: 'internal note',
				omniscore_at_apply: AT_APPLY[scenario],
				job_title: 'Backend Engineer',
				candidate_name: 'Casey Candidate',
				candidate_email: 'casey@example.com',
			};
			// A query still bound to the dead table LEFT JOINs to NULLs
			// on a real database — the pre-repoint red state.
			if (!/join omni_scores\s/.test(s)) {
				return {
					rows: [
						{
							...base,
							overall_score: null,
							technical_score: null,
							behavioral_score: null,
							experience_score: null,
						},
					],
				};
			}
			if (scenario === 'missing') {
				return {
					rows: [
						{ ...base, overall_score: null, technical_score: null, behavioral_score: null },
					],
				};
			}
			if (scenario === 'null-total') {
				return {
					rows: [
						{ ...base, overall_score: null, technical_score: 80, behavioral_score: 70 },
					],
				};
			}
			return {
				rows: [
					{
						...base,
						overall_score: CURRENT[scenario],
						technical_score: 80,
						behavioral_score: 70,
					},
				],
			};
		}
		if (s.includes('from match_results')) {
			if (scenario === 'low-with-match') {
				return {
					rows: [{ overall_match_score: 65, skills_missing: ['Kubernetes'] }],
				};
			}
			return { rows: [] };
		}
		return { rows: [] };
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	scenario = 'low';
	seenSql.length = 0;
	installPoolMock();
});

const lowFactor = (explanation) =>
	explanation.factors.find((f) => f.factor === 'Low OmniScore');

describe('#1524 explainDecision — repoint to omni_scores (Rex §4 R3)', () => {
	test('reads omni_scores, never the dead omniscore_results table, and drops experience_score', async () => {
		await explainDecision(1);
		const appSql = seenSql.find((q) => q.toLowerCase().includes('from job_applications ja'));
		expect(appSql).toBeDefined();
		expect(/join omni_scores\s/i.test(appSql)).toBe(true);
		expect(appSql.toLowerCase().includes('omniscore_results')).toBe(false);
		expect(appSql.toLowerCase().includes('experience_score')).toBe(false);
		expect(appSql.toLowerCase().includes('total_score as overall_score')).toBe(true);
		expect(appSql.toLowerCase().includes('behavior_score as behavioral_score')).toBe(true);
	});

	test('current_omniscore is the native 300–850 total, pass-through', async () => {
		const explanation = await explainDecision(1);
		expect(explanation.current_omniscore).toBe(500);
		expect(explanation.omniscore_at_apply).toBe(500);
	});

	test('NULL total (row exists, no data) → current_omniscore null, never 0/NaN (#1458 honesty)', async () => {
		scenario = 'null-total';
		const explanation = await explainDecision(1);
		expect(explanation.current_omniscore).toBeNull();
	});

	test('missing omni_scores row → current_omniscore null, never 0/NaN (#1458 honesty)', async () => {
		scenario = 'missing';
		const explanation = await explainDecision(1);
		expect(explanation.current_omniscore).toBeNull();
	});
});

describe('#1524 threshold behaviour change — <60 (dead) → <630 (Rex §3.3/§5.3)', () => {
	test('rejected application with omniscore_at_apply 500 now produces the Low OmniScore factor citing 630', async () => {
		const explanation = await explainDecision(1);
		const factor = lowFactor(explanation);
		expect(factor).toBeDefined();
		expect(factor.value).toBe(500);
		expect(factor.impact).toBe('negative');
		expect(factor.explanation).toContain('630');
		expect(factor.explanation).not.toContain('threshold of 60');
	});

	test('rejected application with omniscore_at_apply 700 does NOT produce the Low OmniScore factor', async () => {
		scenario = 'high';
		const explanation = await explainDecision(1);
		expect(lowFactor(explanation)).toBeUndefined();
		expect(explanation.current_omniscore).toBe(700);
	});

	test('match-score <70 check is untouched: a 65 match still yields the Low Job Match Score factor', async () => {
		scenario = 'low-with-match';
		const explanation = await explainDecision(1);
		expect(explanation.factors.find((f) => f.factor === 'Low Job Match Score')).toBeDefined();
		expect(lowFactor(explanation)).toBeDefined();
	});
});

describe('#1524 route — GET /explain/decision/:applicationId (admin, full record)', () => {
	test('serves the Low OmniScore factor over real HTTP for at_apply 500', async () => {
		const res = await request(makeApp()).get('/api/compliance/explain/decision/1');
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(lowFactor(res.body.explanation)).toBeDefined();
		expect(res.body.explanation.current_omniscore).toBe(500);
	});

	test('serves no Low OmniScore factor over real HTTP for at_apply 700', async () => {
		scenario = 'high';
		const res = await request(makeApp()).get('/api/compliance/explain/decision/1');
		expect(res.status).toBe(200);
		expect(lowFactor(res.body.explanation)).toBeUndefined();
	});
});
