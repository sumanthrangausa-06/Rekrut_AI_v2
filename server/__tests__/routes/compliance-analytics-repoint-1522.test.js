/**
 * #1522 (Story A of #1152): Analytics repoint R6+R8 — bias/fairness readers
 * move from the never-written `omniscore_results` table to live `omni_scores`.
 *
 * Rex scale decision (2026-10-20, §3.2/§4): totals are 300–850; anything used
 * as an index/spread/histogram axis is normalised ONCE at the SQL boundary:
 *   (total_score - 300) / 5.5 AS overall_score_norm
 * Gap threshold stays > 10 on normalised averages; buckets stay
 * FLOOR(norm/10)*10; fairnessScore stays 100-(max-min) on normalised
 * averages. A naive raw swap (total_score into the old formulas) is the
 * forbidden failure mode — on native totals fairness would run to -450.
 *
 * Factor averages: technical <- technical_score, behavioral <-
 * behavior_score, experience <- factor_scores->>'experience_quality'
 * (Nova's STOP 1 pick on #1522: field kept via the JSONB factor).
 *
 * Harness follows the #1517 suite: the REAL route + REAL BiasDetection
 * service run; only the pool boundary is mocked. The mock routes on the
 * LIVE table name, so on pre-repoint code (queries against
 * omniscore_results) every read falls through to [] and the data-path
 * tests fail — that is the red state. SQL strings are captured so the
 * conversion idiom itself is pinned, not just downstream arithmetic.
 * The HL-003 dev E2E (real DB, seeded total 612 -> norm 56.7) is Quinn's
 * gate after independent review; it is not replaced by this suite.
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

// scenario: 'empty' (no scored candidates) | 'data'
let scenario = 'empty';
const seenSql = [];
const fairnessInserts = [];
const biasInserts = [];

// Demographic averages AS THE DB RETURNS THEM after the SQL-boundary
// conversion — i.e. already normalised 0-100 values.
const DATA_DEMOGRAPHICS = [
	{ gender: 'female', ethnicity: 'group-a', total: '2', avg_score: '80' },
	{ gender: 'male', ethnicity: 'group-a', total: '2', avg_score: '70' },
];
const DATA_FAIRNESS_DIST = [
	{ bucket: 70, count: '2', avg_score: '75' },
	{ bucket: 80, count: '2', avg_score: '80' },
];
// Two gender groups, normalised averages 75 vs 60 -> gap 15 > 10 must flag.
const DATA_PARITY = [
	{ gender: 'female', ethnicity: 'group-a', age_range: '25-34', total_candidates: '2', avg_score: '75', median_score: '75', min_score: '70', max_score: '80', score_stddev: '5' },
	{ gender: 'male', ethnicity: 'group-a', age_range: '25-34', total_candidates: '2', avg_score: '60', median_score: '60', min_score: '55', max_score: '65', score_stddev: '5' },
];
const DATA_SCORE_DIST = [
	{ score_bucket: 50, candidate_count: '2', avg_technical: '70', avg_behavioral: '72', avg_experience: '71' },
	{ score_bucket: 60, candidate_count: '2', avg_technical: '74', avg_behavioral: '76', avg_experience: '73' },
];

function installPoolMock() {
	pool.query.mockImplementation(async (sql, params) => {
		seenSql.push(sql);
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
		if (s.includes('percentile_cont')) return { rows: scenario === 'data' ? DATA_PARITY : [] };
		if (s.includes('group by score_bucket')) return { rows: scenario === 'data' ? DATA_SCORE_DIST : [] };
		if (s.includes('group by bucket')) return { rows: scenario === 'data' ? DATA_FAIRNESS_DIST : [] };
		// demographics query JOINs omni_scores (checked last: the two
		// distribution queries above also name the table but route earlier)
		if (s.includes('omni_scores')) return { rows: scenario === 'data' ? DATA_DEMOGRAPHICS : [] };
		return { rows: [] };
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	scenario = 'empty';
	seenSql.length = 0;
	fairnessInserts.length = 0;
	biasInserts.length = 0;
	installPoolMock();
});

const norm = (sql) => sql.toLowerCase().replace(/\s+/g, ' ');
const sqlMatching = (frag) => seenSql.map(norm).filter((s) => s.includes(frag));

describe('#1522 conversion idiom — SQL boundary (Rex §3.2)', () => {
	test('conversion anchor: total 612 normalises to 56.7', () => {
		expect((612 - 300) / 5.5).toBeCloseTo(56.7, 1);
	});

	test('demographic parity reads omni_scores via overall_score_norm, NULL totals excluded', async () => {
		scenario = 'data';
		await BiasDetection.analyzeDemographicParity();
		const [sql] = sqlMatching('percentile_cont');
		expect(sql).toBeDefined();
		expect(sql).toContain('omni_scores');
		expect(sql).not.toContain('omniscore_results');
		expect(sql).not.toContain('os.overall_score');
		expect(sql).toContain('(os.total_score - 300) / 5.5');
		expect(sql).toContain('os.total_score is not null');
		// every aggregate rides the normalised expression, not the raw total
		expect(sql).toContain('avg((os.total_score - 300) / 5.5)');
		expect(sql).toContain('stddev((os.total_score - 300) / 5.5)');
	});

	test('score distribution buckets the normalised score and maps factor columns honestly', async () => {
		scenario = 'data';
		await BiasDetection.analyzeScoreDistribution();
		const [sql] = sqlMatching('group by score_bucket');
		expect(sql).toBeDefined();
		expect(sql).toContain('omni_scores');
		expect(sql).not.toContain('omniscore_results');
		expect(sql).toContain('floor(((total_score - 300) / 5.5) / 10) * 10');
		expect(sql).toContain('total_score is not null');
		expect(sql).toContain('avg(technical_score)');
		expect(sql).toContain('avg(behavior_score)');
		expect(sql).toContain("avg((factor_scores->>'experience_quality')::numeric)");
		expect(sql).not.toContain('avg(behavioral_score)');
		expect(sql).not.toContain('avg(experience_score)');
	});

	test('fairness audit queries convert at the boundary on omni_scores', async () => {
		scenario = 'data';
		await request(makeApp()).post('/api/compliance/fairness/audit');
		const [distSql] = sqlMatching('group by bucket');
		expect(distSql).toBeDefined();
		expect(distSql).toContain('omni_scores');
		expect(distSql).not.toContain('omniscore_results');
		expect(distSql).toContain('floor(((total_score - 300) / 5.5) / 10) * 10');
		const [demoSql] = sqlMatching('candidate_demographics');
		expect(demoSql).toBeDefined();
		expect(demoSql).toContain('omni_scores');
		expect(demoSql).not.toContain('omniscore_results');
		expect(demoSql).toContain('avg((os.total_score - 300) / 5.5)');
		expect(demoSql).toContain('os.total_score is not null');
	});
});

describe('#1522 behaviour — normalised semantics preserved, #1517 guards intact', () => {
	test('fairness audit, zero scored candidates: #1517 guard fires — no INSERT, score null', async () => {
		const res = await request(makeApp()).post('/api/compliance/fairness/audit');
		expect(res.status).toBe(200);
		expect(fairnessInserts).toHaveLength(0);
		expect(res.body.insufficient_data).toBe(true);
		expect(res.body.fairnessScore).toBeNull();
	});

	test('fairness audit, known spread: fairnessScore = 100-(80-70) = 90 on normalised averages', async () => {
		scenario = 'data';
		const res = await request(makeApp()).post('/api/compliance/fairness/audit');
		expect(res.status).toBe(200);
		expect(fairnessInserts).toHaveLength(1);
		expect(fairnessInserts[0][5]).toBe(90);
		expect(res.body.fairnessScore).toBe(90);
		expect(res.body.insufficient_data).toBeUndefined();
	});

	test('bias report, zero scored candidates: #1517 guard fires — no INSERT, insufficient-data', async () => {
		const report = await BiasDetection.generateReport();
		expect(biasInserts).toHaveLength(0);
		expect(report.insufficient_data).toBe(true);
		expect(report.reportId).toBeNull();
		expect(report.distributionAnalysis.total_candidates).toBe(0);
	});

	test('demographic parity: normalised gap 75 vs 60 (>10) flags significant_score_gap', async () => {
		scenario = 'data';
		const { flaggedPatterns } = await BiasDetection.analyzeDemographicParity();
		expect(flaggedPatterns).toHaveLength(1);
		expect(flaggedPatterns[0].issue).toBe('significant_score_gap');
		expect(flaggedPatterns[0].gap).toBeCloseTo(15);
	});

	test('score distribution: totals and factor averages read back from omni_scores rows', async () => {
		scenario = 'data';
		const result = await BiasDetection.analyzeScoreDistribution();
		expect(result.total_candidates).toBe(4);
		expect(result.distribution[0].avg_experience).toBe('71');
		expect(result.distribution[0].avg_behavioral).toBe('72');
	});
});
