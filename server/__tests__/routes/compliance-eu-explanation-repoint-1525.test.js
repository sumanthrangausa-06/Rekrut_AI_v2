/**
 * #1525 (Story D of #1152): EU explanation repoint R4 —
 * EuComplianceService.explainDecisionForJob moves from the
 * never-written `omniscore_results` table to live `omni_scores`,
 * with SPLIT semantics (Lead+Lex disposition on #1525, adopting
 * Rex's scale decision 2026-10-20 §4 R4 / §5.1 / §5.4):
 *
 *  1. Headline ONLY from omni_scores.total_score pass-through,
 *     labelled score_scale '300-850'; the match score is never
 *     written/served under the headline key — it stays under its
 *     own name (overall_match_score).
 *  2. Persist NOTHING when neither a non-NULL total nor a match
 *     exists — no overall_score: 0 row, ever. Match-only: headline
 *     null/absent, match under its own name.
 *  3. weights_hash bumped to 'v3-omni-scores-split'; stale-hash
 *     rows are regenerated/overwritten, fresh-hash rows served.
 *  4. Guards key on NULL/presence (total_score IS NOT NULL;
 *     factor_scores.experience_quality present), never
 *     !== undefined against a {} default.
 *  5. The 0.4/0.3/0.2 weights and contribution formula strings
 *     are dropped. Factors pass through 0-100: technical <-
 *     technical_score, behavioral <- behavior_score (composite),
 *     experience <- factor_scores.experience_quality.
 *
 * Harness follows #1523/#1524: the REAL route + REAL service run;
 * only the pool boundary is mocked. The mock emulates a real
 * database: omniscore_results is empty (never written), while
 * omni_scores returns the seeded live row — so pre-repoint code
 * falls back to the match score or 0 and fails these pins. The
 * HL-003 dev E2E (real DB, real HTTP) is Quinn's gate after
 * independent review; it is not replaced here.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((req, _res, next) => {
		req.user = { id: 1, role: 'admin' };
		return next();
	}),
}));

jest.mock('../../../lib/db', () => ({ query: jest.fn() }));

jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: {
		log: jest.fn(async () => {}),
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

// NOTE: euComplianceService is NOT mocked — the real service is the
// unit under test.

const pool = require('../../../lib/db');
const complianceRoutes = require('../../../routes/compliance');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/compliance', complianceRoutes);
	return app;
}

// Scenarios:
//  'known-total'      omni total 612 + factors, match 88
//  'match-only'       omni row, total NULL (factors present), match 88
//  'no-data'          no omni row, no match row
//  'no-experience'    omni total 612, factor_scores {} (no experience_quality), no match
//  'stale-cache'      cached row under old hash + known-total sources
//  'fresh-cache'      cached row under new hash + known-total sources
let scenario = 'known-total';
let upserts = [];
let omniQueries = 0;

const OMNI = {
	'known-total': {
		total_score: 612,
		technical_score: 80,
		behavior_score: 70,
		factor_scores: { experience_quality: 65 },
	},
	'match-only': {
		total_score: null,
		technical_score: 80,
		behavior_score: 70,
		factor_scores: { experience_quality: 65 },
	},
	'no-experience': {
		total_score: 612,
		technical_score: 80,
		behavior_score: 70,
		factor_scores: {},
	},
	'stale-cache': {
		total_score: 612,
		technical_score: 80,
		behavior_score: 70,
		factor_scores: { experience_quality: 65 },
	},
	'fresh-cache': {
		total_score: 612,
		technical_score: 80,
		behavior_score: 70,
		factor_scores: { experience_quality: 65 },
	},
};

const MATCH = {
	'known-total': { overall_match_score: 88, skills_matched: ['node'], skills_missing: [] },
	'match-only': { overall_match_score: 88, skills_matched: ['node'], skills_missing: [] },
	'stale-cache': { overall_match_score: 88, skills_matched: ['node'], skills_missing: [] },
	'fresh-cache': { overall_match_score: 88, skills_matched: ['node'], skills_missing: [] },
};

function installPoolMock() {
	pool.query.mockImplementation(async (sql, params) => {
		const s = sql.toLowerCase();
		if (s.includes('from ai_decision_explanations')) {
			if (scenario === 'stale-cache') {
				return {
					rows: [
						{
							user_id: 7,
							job_id: 99,
							overall_score: '88.00',
							factor_breakdowns: { overall_score: 88 },
							weights_hash: 'v2-match-results',
						},
					],
				};
			}
		if (scenario === 'fresh-cache') {
				return {
					rows: [
						{
							user_id: 7,
							job_id: 99,
							overall_score: '612.00',
							factor_breakdowns: { overall_score: 612, score_scale: '300-850' },
							weights_hash: 'v3-omni-scores-split',
						},
					],
				};
			}
			return { rows: [] };
		}
		if (s.includes('insert into ai_decision_explanations')) {
			upserts.push(params);
			return {
				rows: [
					{
						user_id: params[0],
						job_id: params[1],
						application_id: params[2],
						overall_score: params[3],
						factor_breakdowns: params[4],
						weights_hash: params[5],
					},
				],
			};
		}
		if (s.includes('from omniscore_results')) {
			// The dead table: exists, never written.
			return { rows: [] };
		}
		if (s.includes('from omni_scores')) {
			omniQueries += 1;
			const row = OMNI[scenario];
			return { rows: row ? [row] : [] };
		}
		if (s.includes('from score_components')) {
			return { rows: [] };
		}
		if (s.includes('from jobs')) {
			return { rows: [{ title: 'Backend Engineer', requirements: 'node' }] };
		}
		if (s.includes('from match_results')) {
			const m = MATCH[scenario];
			return { rows: m ? [m] : [] };
		}
		return { rows: [] };
	});
}

function payloadOf(explanation) {
	const fb = explanation.factor_breakdowns;
	return typeof fb === 'string' ? JSON.parse(fb) : fb;
}

describe('#1525 explainDecisionForJob repoint (R4 split)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		upserts = [];
		omniQueries = 0;
		installPoolMock();
	});

	test('headline is the omni total pass-through (612), labelled 300-850; match stays under its own name', async () => {
		scenario = 'known-total';
		const res = await request(makeApp()).get('/api/compliance/explain/job/99/candidate/7');
		expect(res.status).toBe(200);
		expect(upserts).toHaveLength(1);
		const [, , , overallScore, payloadJson, hash] = upserts[0];
		expect(Number(overallScore)).toBe(612);
		const payload = JSON.parse(payloadJson);
		expect(payload.overall_score).toBe(612);
		expect(payload.score_scale).toBe('300-850');
		expect(payload.overall_match_score).toBe(88);
		expect(hash).toBe('v3-omni-scores-split');
		expect(Number(res.body.explanation.overall_score)).toBe(612);
	});

	test('factors pass through with honest sources and NO weights/contribution formula', async () => {
		scenario = 'known-total';
		const res = await request(makeApp()).get('/api/compliance/explain/job/99/candidate/7');
		expect(res.status).toBe(200);
		const payload = payloadOf(res.body.explanation);
		const byFactor = Object.fromEntries(payload.factor_breakdowns.map((f) => [f.factor, f]));
		expect(byFactor['Technical Skills'].score).toBe(80);
		expect(byFactor['Behavioral Fit'].score).toBe(70);
		expect(byFactor['Experience Match'].score).toBe(65);
		for (const f of payload.factor_breakdowns) {
			expect(f).not.toHaveProperty('weight');
			expect(f).not.toHaveProperty('contribution');
		}
	});

	test('match-only (total NULL): headline is null, match under its own name, no OmniScore factors rendered', async () => {
		scenario = 'match-only';
		const res = await request(makeApp()).get('/api/compliance/explain/job/99/candidate/7');
		expect(res.status).toBe(200);
		expect(upserts).toHaveLength(1);
		const [, , , overallScore, payloadJson] = upserts[0];
		expect(overallScore == null).toBe(true);
		const payload = JSON.parse(payloadJson);
		expect(payload.overall_score == null).toBe(true);
		expect(payload.overall_match_score).toBe(88);
		expect(payload.factor_breakdowns).toEqual([]);
	});

	test('no-data: persists NOTHING and returns honest insufficient-data (never overall_score 0)', async () => {
		scenario = 'no-data';
		const res = await request(makeApp()).get('/api/compliance/explain/job/99/candidate/7');
		expect(res.status).toBe(200);
		expect(upserts).toHaveLength(0);
		const explanation = res.body.explanation;
		expect(explanation.overall_score == null).toBe(true);
		expect(explanation.insufficient_data).toBe(true);
	});

	test('experience factor omitted when factor_scores.experience_quality is absent', async () => {
		scenario = 'no-experience';
		const res = await request(makeApp()).get('/api/compliance/explain/job/99/candidate/7');
		expect(res.status).toBe(200);
		const payload = payloadOf(res.body.explanation);
		const names = payload.factor_breakdowns.map((f) => f.factor);
		expect(names).toContain('Technical Skills');
		expect(names).not.toContain('Experience Match');
	});

	test('stale-hash cached row is regenerated and overwritten, never served', async () => {
		scenario = 'stale-cache';
		const res = await request(makeApp()).get('/api/compliance/explain/job/99/candidate/7');
		expect(res.status).toBe(200);
		expect(upserts).toHaveLength(1);
		expect(upserts[0][5]).toBe('v3-omni-scores-split');
		expect(Number(res.body.explanation.overall_score)).toBe(612);
	});

	test('fresh-hash cached row is served as-is (no regeneration, no upsert)', async () => {
		scenario = 'fresh-cache';
		const res = await request(makeApp()).get('/api/compliance/explain/job/99/candidate/7');
		expect(res.status).toBe(200);
		expect(upserts).toHaveLength(0);
		expect(omniQueries).toBe(0);
		expect(Number(res.body.explanation.overall_score)).toBe(612);
		expect(res.body.explanation.weights_hash).toBe('v3-omni-scores-split');
	});
});
