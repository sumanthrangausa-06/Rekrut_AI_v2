/**
 * #1517: Fairness audit + bias report must not persist fabricated results
 * from the never-written omniscore_results table.
 *
 * Root cause (Scout #1152 audit, verified first-hand on dev f6dad77):
 * - POST /fairness/audit: demographics query always returns [] (source
 *   table has zero writers), so fairnessScore defaults to 100 and is
 *   INSERTed into fairness_audits with issues_found hardcoded 0.
 * - BiasDetection.generateReport(): INSERTs into bias_reports with zero
 *   flagged patterns / zero recommendations when total_candidates = 0 —
 *   indistinguishable from a genuinely clean audit.
 *
 * Desired behaviour (STOP 1 on #1517):
 * - Zero scored candidates -> NO persisted row, explicit insufficient-data
 *   result (fairnessScore null, issues_found null, never 100 / fake 0).
 * - Real data -> behaviour identical in shape to today.
 *
 * The DB mock below drives the REAL route + REAL BiasDetection service;
 * only the pool boundary is mocked, and INSERTs are recorded so the test
 * asserts on persisted state, not just the response.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((req, _res, next) => {
		req.user = { id: 1, role: 'recruiter', company_id: 10 };
		return next();
	}),
}));

jest.mock('../../../lib/db', () => ({ query: jest.fn() }));

const mockAuditLog = jest.fn(async () => {});
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: { log: (...args) => mockAuditLog(...args), query: jest.fn(async () => []), exportLogs: jest.fn(async () => []) },
	logEvent: jest.fn(async () => ({})),
	getAuditTrail: jest.fn(async () => ({ rows: [] })),
	getCandidateDecisions: jest.fn(async () => []),
	verifyChain: jest.fn(async () => ({})),
	exportForRegulator: jest.fn(async () => ({})),
	EVENT_TYPES: { AI_DECISION: 'ai_decision', STATUS_CHANGE: 'status_change' },
	ENTITY_TYPES: { CANDIDATE: 'candidate', JOB: 'job' },
}));

jest.mock('../../../services/scoreExplainer', () => ({
	explainOmniScore: jest.fn(),
	explainDecision: jest.fn(),
	explainDecisionForJob: jest.fn(),
}));

jest.mock('../../../services/euComplianceService', () => ({}));

const pool = require('../../../lib/db');
const BiasDetection = require('../../../services/biasDetection');
const complianceRoutes = require('../../../routes/compliance');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/compliance', complianceRoutes);
	return app;
}

// scenario: 'empty' (omniscore_results has no rows — its real state) | 'data'
let scenario = 'empty';
const fairnessInserts = [];
const biasInserts = [];

const DATA_DEMOGRAPHICS = [
	{ gender: 'female', ethnicity: 'group-a', total: '2', avg_score: '80' },
	{ gender: 'male', ethnicity: 'group-a', total: '2', avg_score: '70' },
];
const DATA_DISTRIBUTION = [
	{ bucket: 70, count: '2', avg_score: '75' },
	{ bucket: 80, count: '2', avg_score: '80' },
];
const DATA_PARITY = [
	{
		gender: 'female',
		ethnicity: 'group-a',
		age_range: '25-34',
		total_candidates: '4',
		avg_score: '75',
		median_score: '75',
		min_score: '70',
		max_score: '80',
		score_stddev: '5',
	},
];
const DATA_SCORE_DIST = [
	{ score_bucket: 70, candidate_count: '4', avg_technical: '70', avg_behavioral: '72', avg_experience: '71' },
];

function installPoolMock() {
	pool.query.mockImplementation(async (sql, params) => {
		const s = sql.toLowerCase();
		if (s.includes('insert into fairness_audits')) {
			fairnessInserts.push(params);
			return { rows: [{ id: 99 }] };
		}
		if (s.includes('insert into bias_reports')) {
			biasInserts.push(params);
			return { rows: [{ id: 77 }] };
		}
		if (s.includes('from score_appeals')) return { rows: [] };
		if (s.includes('from omniscore_results') && s.includes('group by bucket')) {
			return { rows: scenario === 'data' ? DATA_DISTRIBUTION : [] };
		}
		if (s.includes('from omniscore_results') && s.includes('group by score_bucket')) {
			return { rows: scenario === 'data' ? DATA_SCORE_DIST : [] };
		}
		if (s.includes('from candidate_profiles') && s.includes('percentile_cont')) {
			return { rows: scenario === 'data' ? DATA_PARITY : [] };
		}
		if (s.includes('from candidate_profiles')) {
			return { rows: scenario === 'data' ? DATA_DEMOGRAPHICS : [] };
		}
		return { rows: [] };
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	scenario = 'empty';
	fairnessInserts.length = 0;
	biasInserts.length = 0;
	installPoolMock();
});

describe('POST /api/compliance/fairness/audit — #1517 honest-empty', () => {
	test('zero scored candidates: persists NO fairness_audits row and returns insufficient-data, never 100', async () => {
		const res = await request(makeApp()).post('/api/compliance/fairness/audit');
		expect(res.status).toBe(200);
		expect(fairnessInserts).toHaveLength(0);
		expect(res.body.success).toBe(true);
		expect(res.body.insufficient_data).toBe(true);
		expect(res.body.auditId).toBeNull();
		expect(res.body.fairnessScore).toBeNull();
		expect(res.body.issues_found).toBeNull();
	});

	test('real data: persists the audit with the computed score, shape unchanged', async () => {
		scenario = 'data';
		const res = await request(makeApp()).post('/api/compliance/fairness/audit');
		expect(res.status).toBe(200);
		expect(fairnessInserts).toHaveLength(1);
		// fairnessScore = 100 - (80 - 70) = 90, issues_found param stays 0 on a real audit
		expect(fairnessInserts[0][5]).toBe(90);
		expect(fairnessInserts[0][6]).toBe(0);
		expect(res.body.auditId).toBe(99);
		expect(res.body.fairnessScore).toBe(90);
		expect(res.body.insufficient_data).toBeUndefined();
	});
});

describe('BiasDetection.generateReport / POST /bias/analyze — #1517 honest-empty', () => {
	test('zero candidates: generateReport persists NO bias_reports row and flags insufficient-data', async () => {
		const report = await BiasDetection.generateReport();
		expect(biasInserts).toHaveLength(0);
		expect(report.insufficient_data).toBe(true);
		expect(report.reportId).toBeNull();
		expect(report.distributionAnalysis.total_candidates).toBe(0);
	});

	test('zero candidates: POST /bias/analyze returns insufficient-data and persists nothing', async () => {
		const res = await request(makeApp()).post('/api/compliance/bias/analyze');
		expect(res.status).toBe(200);
		expect(biasInserts).toHaveLength(0);
		expect(res.body.success).toBe(true);
		expect(res.body.insufficient_data).toBe(true);
		expect(res.body.report.reportId).toBeNull();
	});

	test('real data: report persists and returns its id, shape unchanged', async () => {
		scenario = 'data';
		const res = await request(makeApp()).post('/api/compliance/bias/analyze');
		expect(res.status).toBe(200);
		expect(biasInserts).toHaveLength(1);
		expect(res.body.report.reportId).toBe(77);
		expect(res.body.insufficient_data).toBeUndefined();
		expect(mockAuditLog).toHaveBeenCalled();
	});
});
