/**
 * #1538 — OmniScore writer must persist JSON null for factors without data.
 *
 * STOP 1 (issue #1538, comment 6309941518) ruling: Option C. calculateScore()
 * flattened every factor with Math.round(v.raw), dropping hasData, so a
 * no-data factor (e.g. experience_quality with zero experience records,
 * raw 0) was persisted as a measured 0 in BOTH written JSONB payloads:
 * the omni_scores UPDATE (factor_scores = $7) and the score_snapshots
 * INSERT (factor_scores = $3). After the fix, a shared persistence-mapping
 * helper writes `hasData ? Math.round(v.raw) : null` at both sites: all 8
 * keys stay present, no-data factors are null, measured factors keep their
 * rounded number (so a genuine measured 0 stays distinguishable from null).
 *
 * Mocked-pool writer suite in the pattern of honest-null-omniscore.test.js:
 * pool.query captures the exact params handed to both writes.
 */

const mockState = { skills: [], experience: [], education: [] };
const captured = { updateParams: null, snapshotParams: [] };

const mockClientQuery = jest.fn(async (sql) => {
	if (sql.includes('candidate_skills')) return { rows: mockState.skills };
	if (sql.includes('work_experience')) return { rows: mockState.experience };
	if (sql.includes('FROM education')) return { rows: mockState.education };
	return { rows: [] };
});

jest.mock('../../lib/db', () => ({
	connect: jest.fn(async () => ({ query: (...a) => mockClientQuery(...a), release: jest.fn() })),
	query: jest.fn(async (sql, params = []) => {
		if (sql.includes('UPDATE omni_scores')) {
			captured.updateParams = params;
			return { rows: [] };
		}
		if (sql.includes('INSERT INTO score_snapshots')) {
			captured.snapshotParams.push(params);
			return { rows: [] };
		}
		if (sql.includes('COUNT(*) FILTER')) return { rows: [{ percentile: '63.6' }] };
		return { rows: [] };
	}),
}));

const pool = require('../../lib/db');
const { calculateScore } = require('../../services/omniscore');

const USER = 999538;
const FACTOR_KEYS = [
	'verified_skills',
	'interview_performance',
	'experience_quality',
	'education_credentials',
	'reliability_signals',
	'soft_skills',
	'market_demand',
	'growth_trajectory',
];

function restoreMocks() {
	pool.query.mockImplementation(async (sql, params = []) => {
		if (sql.includes('UPDATE omni_scores')) {
			captured.updateParams = params;
			return { rows: [] };
		}
		if (sql.includes('INSERT INTO score_snapshots')) {
			captured.snapshotParams.push(params);
			return { rows: [] };
		}
		if (sql.includes('COUNT(*) FILTER')) return { rows: [{ percentile: '63.6' }] };
		return { rows: [] };
	});
	mockClientQuery.mockImplementation(async (sql) => {
		if (sql.includes('candidate_skills')) return { rows: mockState.skills };
		if (sql.includes('work_experience')) return { rows: mockState.experience };
		if (sql.includes('FROM education')) return { rows: mockState.education };
		return { rows: [] };
	});
	pool.connect.mockImplementation(async () => ({
		query: (...a) => mockClientQuery(...a),
		release: jest.fn(),
	}));
}

beforeEach(() => {
	mockState.skills = [];
	mockState.experience = [];
	mockState.education = [];
	captured.updateParams = null;
	captured.snapshotParams = [];
	jest.clearAllMocks();
	restoreMocks();
});

describe('#1538 persisted factor_scores — mixed candidate (experience present, education absent)', () => {
	// 2020-01-01 → 2022-01-01 = 731 days ≈ 2.001 years → yearPts ≈ 10.007,
	// no current-role / progression / achievement points → raw ≈ 10.007,
	// persisted measured value must be the rounded number 10.
	const EXP = {
		company_name: 'Acme',
		title: 'Dev',
		start_date: '2020-01-01',
		end_date: '2022-01-01',
		is_current: false,
		achievements: [],
	};

	test('UPDATE payload: data factor is the rounded number, no-data factors are null', async () => {
		mockState.experience = [EXP];
		await calculateScore(USER);
		expect(captured.updateParams).not.toBeNull();
		const factors = JSON.parse(captured.updateParams[6]);
		expect(Object.keys(factors).sort()).toEqual([...FACTOR_KEYS].sort());
		expect(factors.experience_quality).toBe(10);
		expect(factors.education_credentials).toBeNull();
		expect(factors.verified_skills).toBeNull();
		// reliability_signals computes a neutral raw of 85 with zero inputs —
		// hasData=false, so it must persist null, not the default-driven 85.
		expect(factors.reliability_signals).toBeNull();
		// A candidate with data keeps a numeric total.
		expect(typeof captured.updateParams[0]).toBe('number');
	});

	test('snapshot INSERT payload: same null mapping as the UPDATE (both write sites)', async () => {
		mockState.experience = [EXP];
		await calculateScore(USER);
		expect(captured.snapshotParams).toHaveLength(1);
		const factors = JSON.parse(captured.snapshotParams[0][2]);
		expect(Object.keys(factors).sort()).toEqual([...FACTOR_KEYS].sort());
		expect(factors.experience_quality).toBe(10);
		expect(factors.education_credentials).toBeNull();
		expect(factors.verified_skills).toBeNull();
		expect(factors.reliability_signals).toBeNull();
	});

	test('return value still preserves hasData (the :932 live-recompute shape is untouched)', async () => {
		mockState.experience = [EXP];
		const score = await calculateScore(USER);
		expect(score.factors.experience_quality.hasData).toBe(true);
		expect(score.factors.experience_quality.raw).toBe(10);
		expect(score.factors.education_credentials.hasData).toBe(false);
	});
});

describe('#1538 persisted factor_scores — all-no-data candidate', () => {
	test('UPDATE payload: all 8 keys present, every value null, total_score NULL', async () => {
		const score = await calculateScore(USER);
		expect(score.total_score).toBeNull();
		expect(captured.updateParams).not.toBeNull();
		expect(captured.updateParams[0]).toBeNull();
		const factors = JSON.parse(captured.updateParams[6]);
		expect(Object.keys(factors).sort()).toEqual([...FACTOR_KEYS].sort());
		for (const key of FACTOR_KEYS) expect(factors[key]).toBeNull();
		// Existing honesty behaviour, unchanged: no snapshot is written for a
		// no-data candidate (a snapshot would re-create the fabricated verdict).
		expect(captured.snapshotParams).toHaveLength(0);
	});
});
