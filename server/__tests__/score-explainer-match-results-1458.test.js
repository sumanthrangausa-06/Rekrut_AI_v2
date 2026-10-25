/**
 * #1458 — explainDecision + ForJob readers re-sourced from match_results.
 *
 * The phantom candidate_job_matches table (no migration creates it, nothing
 * writes it) 500'd every authorised call to both explain endpoints on a fresh
 * install. The fix selects only real, written match_results columns:
 *   - explainDecision: weighted_score AS overall_match_score + missing_skills AS skills_missing
 *   - ForJob sibling (scoreExplainer.explainDecisionForJob) was retired
 *     in #1527 (R2 dead-code removal, zero callers); its tests went with it.
 *     The EuComplianceService.explainDecisionForJob tests below are a
 *     different, live function and remain.
 * Cached ai_decision_explanations rows move to weights_hash 'v3-omni-scores-split'
 * and the eu cache read only serves rows carrying the effective hash.
 *
 * DB-layer mock (no real DB): routes SQL text to canned result sets.
 */
const queries = [];

jest.mock('../../lib/db', () => ({
	query: jest.fn(async (sql, params) => {
		queries.push({ sql, params });
		const text = sql;
		// ai_decision_explanations upsert (scoreExplainer form)
		if (
			text.includes('INSERT INTO ai_decision_explanations') &&
			text.includes('VALUES ($1, $2, $3, $4, $5,')
		) {
			return { rows: [] };
		}
		return { rows: [] };
	}),
}));

jest.mock('../../services/auditLogService', () => ({
	logEvent: jest.fn(async () => ({})),
	EVENT_TYPES: { AI_DECISION: 'ai_decision' },
	ENTITY_TYPES: { CANDIDATE: 'candidate', JOB: 'job' },
}));

const pool = require('../../lib/db');
const { explainDecision } = require('../../services/scoreExplainer'); // #1527: explainDecisionForJob retired (R2, zero callers)
const EuComplianceService = require('../../services/euComplianceService');

const APP_ROW = {
	id: 1,
	candidate_id: 1,
	job_id: 1,
	company_id: 1,
	status: 'rejected',
	omniscore_at_apply: 55,
	recruiter_notes: 'INTERNAL-NOTE',
	updated_at: new Date('2026-01-05T00:00:00Z'),
	candidate_name: 'Casey Candidate',
	candidate_email: 'cand@example.test',
	job_title: 'Platform Engineer',
	overall_score: null, // no omniscore_results row on a fresh install
};

const MATCH_ROW = {
	overall_match_score: '55.00', // pg DECIMAL arrives as string
	skills_missing: ['Kubernetes', 'Go'], // pg JSONB arrives parsed
};

function routeMock({ appRow = APP_ROW, matchRows = [MATCH_ROW], cachedRows = [] } = {}) {
	pool.query.mockImplementation(async (sql) => {
		queries.push({ sql });
		if (sql.includes('FROM job_applications')) return { rows: [appRow] };
		if (sql.includes('FROM match_results')) return { rows: matchRows };
		if (sql.includes('FROM candidate_job_matches')) return { rows: [] }; // phantom never resolves
		if (sql.includes('FROM ai_decision_explanations WHERE user_id')) return { rows: cachedRows };
		if (sql.includes('FROM omniscore_results')) return { rows: [] };
		if (sql.includes('FROM score_components')) return { rows: [] };
		if (sql.includes('FROM jobs WHERE id')) return { rows: [{ title: 'Platform Engineer' }] };
		if (sql.includes('INSERT INTO ai_decision_explanations')) return { rows: [{ id: 7 }] };
		return { rows: [] };
	});
}

beforeEach(() => {
	queries.length = 0;
	pool.query.mockReset();
});

describe('#1458 explainDecision sources match data from match_results', () => {
	test('Q2 selects only real match_results columns (no phantom table, no match_explanation)', async () => {
		routeMock();
		const out = await explainDecision(1);
		const q2 = queries.find((q) => /FROM match_results|FROM candidate_job_matches/.test(q.sql));
		expect(q2).toBeDefined();
		expect(q2.sql).toContain('FROM match_results');
		expect(q2.sql).not.toContain('candidate_job_matches');
		expect(q2.sql).not.toContain('match_explanation');
		expect(q2.sql).not.toContain('cultural_match_score');
		// both match factors render from the real values
		const factors = out.factors.map((f) => f.factor);
		expect(factors).toEqual(
			expect.arrayContaining(['Low Job Match Score', 'Missing Required Skills']),
		);
		const missing = out.factors.find((f) => f.factor === 'Missing Required Skills');
		expect(missing.explanation).toBe('Candidate lacks: Kubernetes, Go');
		const low = out.factors.find((f) => f.factor === 'Low Job Match Score');
		expect(String(low.value)).toContain('55');
	});

	test('missing_skills arriving as a JSON string is normalised to an array', async () => {
		routeMock({ matchRows: [{ overall_match_score: '40.00', skills_missing: '["Rust"]' }] });
		const out = await explainDecision(1);
		const missing = out.factors.find((f) => f.factor === 'Missing Required Skills');
		expect(missing).toBeDefined();
		expect(missing.explanation).toBe('Candidate lacks: Rust');
	});

	test('no match_results row -> 200-equivalent with no fabricated match factors', async () => {
		routeMock({ matchRows: [] });
		const out = await explainDecision(1);
		const factors = out.factors.map((f) => f.factor);
		expect(factors).not.toContain('Low Job Match Score');
		expect(factors).not.toContain('Missing Required Skills');
		// the only rejected-branch factor left is the honest omniscore one
		expect(factors).toEqual(['Low OmniScore']);
	});

	test('current_omniscore is null (not NaN) when no omniscore_results row exists', async () => {
		routeMock();
		const out = await explainDecision(1);
		expect(out.current_omniscore).toBeNull();
	});

	test('non-rejected application carries no match factors', async () => {
		routeMock({ appRow: { ...APP_ROW, status: 'applied', omniscore_at_apply: 55 } });
		const out = await explainDecision(1);
		expect(out.factors).toEqual([]);
	});
});

describe('#1458 euComplianceService cache never serves old-shape rows', () => {
	const STALE = {
		user_id: 1,
		job_id: 1,
		overall_score: '42.00',
		weights_hash: 'default-v1',
		factor_breakdowns: {
			factor_breakdowns: [{ factor: 'Cultural Fit', weight: 0.1, score: 42, explanation: 'STALE' }],
		},
	};

	function euMock({ cachedRows = [] } = {}) {
		pool.query.mockImplementation(async (sql, params) => {
			queries.push({ sql, params });
			if (sql.includes('FROM ai_decision_explanations WHERE user_id')) return { rows: cachedRows };
			if (sql.includes('FROM omniscore_results')) return { rows: [] };
			if (sql.includes('FROM score_components')) return { rows: [] };
			if (sql.includes('FROM jobs WHERE id')) return { rows: [{ title: 'Platform Engineer' }] };
			if (sql.includes('FROM match_results'))
				return {
					rows: [
						{
							overall_match_score: '55.00',
							skills_matched: ['JavaScript'],
							skills_missing: ['Go'],
						},
					],
				};
			if (sql.includes('FROM candidate_job_matches')) return { rows: [] };
			if (sql.includes('INSERT INTO ai_decision_explanations')) {
				// return the regenerated row as the upsert would
				return {
					rows: [
						{
							user_id: params[0],
							job_id: params[1],
							weights_hash: params[5],
							factor_breakdowns: JSON.parse(params[4]),
						},
					],
				};
			}
			return { rows: [] };
		});
	}

	test('stale default-v1 row is regenerated, not served', async () => {
		euMock({ cachedRows: [STALE] });
		const out = await EuComplianceService.explainDecisionForJob({ userId: 1, jobId: 1 });
		// must not be the stale row
		expect(out.weights_hash).not.toBe('default-v1');
		expect(out.weights_hash).toBe('v3-omni-scores-split');
		const data = out.factor_breakdowns;
		expect(data.factor_breakdowns.map((f) => f.factor)).not.toContain('Cultural Fit');
		expect(JSON.stringify(data)).not.toContain('STALE');
		// the upsert overwrote the stale row
		const upsert = queries.find((q) => q.sql.includes('INSERT INTO ai_decision_explanations'));
		expect(upsert).toBeDefined();
		expect(upsert.params[5]).toBe('v3-omni-scores-split');
	});

	test('current-hash row is still served from cache (no rebuild)', async () => {
		const fresh = { ...STALE, weights_hash: 'v3-omni-scores-split' };
		euMock({ cachedRows: [fresh] });
		const out = await EuComplianceService.explainDecisionForJob({ userId: 1, jobId: 1 });
		expect(out).toBe(fresh);
		expect(queries.some((q) => q.sql.includes('FROM omniscore_results'))).toBe(false);
	});

	test('eu build selects real match_results columns only', async () => {
		euMock();
		await EuComplianceService.explainDecisionForJob({ userId: 1, jobId: 1 });
		const mq = queries.find((q) => /FROM match_results|FROM candidate_job_matches/.test(q.sql));
		expect(mq.sql).toContain('FROM match_results');
		expect(mq.sql).not.toContain('candidate_job_matches');
		expect(mq.sql).not.toContain('match_explanation');
		expect(mq.sql).not.toContain('cultural_match_score');
		expect(mq.sql).not.toContain('experience_match_score');
	});
});
