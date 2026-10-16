/**
 * #1192 — honest-null OmniScore contract (service layer).
 *
 * A candidate with ZERO score inputs must read null everywhere — never the
 * computed floor (352), never the starter literal (300). The persisted-row
 * trap: after a breakdown call, the profile's LEFT JOIN on omni_scores must
 * not serve a fabricated numeric total either.
 * A candidate WITH genuine inputs computes exactly as before (regression).
 */

// ─── Stateful in-memory omni_scores mock ────────────────────────────────────
const mockState = { omniRow: null, snapshots: [], skills: [], deletedAt: null };
const mockClientQuery = jest.fn(async (sql) => {
	if (sql.includes('candidate_skills')) return { rows: mockState.skills };
	return { rows: [] };
});

jest.mock('../../lib/db', () => ({
	connect: jest.fn(async () => ({ query: (...a) => mockClientQuery(...a), release: jest.fn() })),
	query: jest.fn(async (sql, params = []) => {
		if (sql.includes('FROM omni_scores os')) {
			// heal-script scan: omni rows joined to their user tombstone
			return { rows: mockState.omniRow ? [{ id: EMPTY_USER, deleted_at: mockState.deletedAt }] : [] };
		}
		if (sql.includes('INSERT INTO omni_scores')) {
			// Old shape: VALUES ($1, $2, 'new', 2) — new shape inserts NULLs.
			const total = sql.includes('$2') ? params[1] : null;
			mockState.omniRow = { user_id: params[0], total_score: total, score_tier: 'new' };
			return { rows: [mockState.omniRow] };
		}
		if (sql.includes('SELECT * FROM omni_scores')) {
			return { rows: mockState.omniRow ? [mockState.omniRow] : [] };
		}
		if (sql.includes('SELECT last_checkin_at FROM omni_scores')) {
			return { rows: mockState.omniRow ? [mockState.omniRow] : [] };
		}
		if (sql.includes('UPDATE omni_scores') && sql.includes('total_score = $1')) {
			if (mockState.omniRow) {
				mockState.omniRow = {
					...mockState.omniRow,
					total_score: params[0],
					score_tier: params[5],
					peer_percentile: params[7],
				};
			}
			return { rows: [] };
		}
		if (sql.includes('INSERT INTO score_snapshots')) {
			mockState.snapshots.push({ total_score: params[1] });
			return { rows: [] };
		}
		if (sql.includes('COUNT(*) FILTER')) return { rows: [{ percentile: '50' }] };
		return { rows: [] };
	}),
}));

const pool = require('../../lib/db');
const { calculateScore, getScoreBreakdown, getOrCreateScore } = require('../../services/omniscore');

const EMPTY_USER = 999001;

beforeEach(() => {
	mockState.omniRow = null;
	mockState.snapshots = [];
	mockState.skills = [];
	mockState.deletedAt = null;
	jest.clearAllMocks();
	// clearAllMocks wipes the factory implementations above — restore them.
	pool.query.mockImplementation(async (sql, params = []) => {
		if (sql.includes('FROM omni_scores os')) {
			return { rows: mockState.omniRow ? [{ id: EMPTY_USER, deleted_at: mockState.deletedAt }] : [] };
		}
		if (sql.includes('INSERT INTO omni_scores')) {
			const total = sql.includes('$2') ? params[1] : null;
			mockState.omniRow = { user_id: params[0], total_score: total, score_tier: 'new' };
			return { rows: [mockState.omniRow] };
		}
		if (sql.includes('SELECT * FROM omni_scores') || sql.includes('SELECT last_checkin_at')) {
			return { rows: mockState.omniRow ? [mockState.omniRow] : [] };
		}
		if (sql.includes('UPDATE omni_scores') && sql.includes('total_score = $1')) {
			if (mockState.omniRow) {
				mockState.omniRow = {
					...mockState.omniRow,
					total_score: params[0],
					score_tier: params[5],
					peer_percentile: params[7],
				};
			}
			return { rows: [] };
		}
		if (sql.includes('INSERT INTO score_snapshots')) {
			mockState.snapshots.push({ total_score: params[1] });
			return { rows: [] };
		}
		if (sql.includes('COUNT(*) FILTER')) return { rows: [{ percentile: '50' }] };
		return { rows: [] };
	});
	mockClientQuery.mockImplementation(async (sql) => {
		if (sql.includes('candidate_skills')) return { rows: mockState.skills };
		return { rows: [] };
	});
	pool.connect.mockImplementation(async () => ({
		query: (...a) => mockClientQuery(...a),
		release: jest.fn(),
	}));
});

describe('#1192 OmniScore — zero-input candidate', () => {
	test('calculateScore returns null total/tier/tier_label/peer_percentile', async () => {
		const score = await calculateScore(EMPTY_USER);
		expect(score.total_score).toBeNull();
		expect(score.tier).toBeNull();
		expect(score.tier_label).toBeNull();
		expect(score.peer_percentile).toBeNull();
		for (const f of Object.values(score.factors)) expect(f.hasData).toBe(false);
	});

	test('getScoreBreakdown current.* are null for a zero-input candidate', async () => {
		const { current, breakdown } = await getScoreBreakdown(EMPTY_USER);
		expect(current.total_score).toBeNull();
		expect(current.tier).toBeNull();
		expect(current.tier_label).toBeNull();
		expect(current.peer_percentile).toBeNull();
		for (const f of Object.values(breakdown)) expect(f.has_data).toBe(false);
	});

	test('breakdown → profile sequence: no fabricated numeric total is persisted or served', async () => {
		await getOrCreateScore(EMPTY_USER);
		await getScoreBreakdown(EMPTY_USER);
		// The profile payload is a LEFT JOIN on omni_scores (routes/candidate.js /profile).
		const profileRow = (await pool.query('SELECT * FROM omni_scores WHERE user_id = $1', [
			EMPTY_USER,
		])).rows[0];
		expect(profileRow?.total_score ?? null).toBeNull();
		// No snapshot may carry a fabricated numeric total either.
		for (const s of mockState.snapshots) expect(s.total_score).toBeNull();
	});

	test('getOrCreateScore does not seed the 300 starter literal', async () => {
		const row = await getOrCreateScore(EMPTY_USER);
		expect(row.total_score).toBeNull();
	});
});

describe('#1192 OmniScore — with-inputs regression (unchanged computation)', () => {
	test('one verified in-demand skill computes exactly the pre-fix total', async () => {
		mockState.skills = [
			{
				skill_name: 'JavaScript',
				category: 'software engineering',
				level: 'expert',
				is_verified: true,
				years_experience: 3,
				created_at: new Date(),
			},
		];
		const score = await calculateScore(EMPTY_USER);
		// verified_skills raw 8, reliability raw 85 (neutral, hasData=false),
		// market_demand raw 40, growth raw 10 →
		// round(300 + (0.25*8 + 0.10*85 + 0.05*40 + 0.05*10)/100*550) = 372
		expect(score.total_score).toBe(372);
		expect(score.tier).toBe('needs_work');
		expect(score.tier_label).toBe('Needs Work');
		expect(typeof score.peer_percentile).toBe('number');
	});
});

describe('#1192 legacy persisted omni rows — heal script (engine-arbitrated recompute)', () => {
	// Code-review gate delta: rows written BEFORE the fix (seeded 300 /
	// floor-computed 352) are served verbatim by direct-read payloads until
	// healed. The engines arbitrate — no value heuristics in the script.
	const loadHeal = () => require('../../scripts/recompute-honest-null-scores').recomputeHonestNullScores;
	const storedRead = async () =>
		(await pool.query('SELECT * FROM omni_scores WHERE user_id = $1', [EMPTY_USER])).rows[0];
	const SKILL = {
		skill_name: 'JavaScript',
		category: 'software engineering',
		level: 'expert',
		is_verified: true,
		years_experience: 3,
		created_at: new Date(),
	};

	test('dry-run is the default posture: counts only, nothing written', async () => {
		mockState.omniRow = { user_id: EMPTY_USER, total_score: 352, score_tier: 'new' };
		const report = await loadHeal()({ live: false });
		expect(report.omni).toEqual({ scanned: 1, would_null: 1, would_keep_number: 0, skipped: 0 });
		expect(mockState.omniRow.total_score).toBe(352);
	});

	test('live heal: legacy 352 with zero inputs → first stored read after heal is null', async () => {
		mockState.omniRow = { user_id: EMPTY_USER, total_score: 352, score_tier: 'new' };
		expect((await storedRead()).total_score).toBe(352); // the defect, pre-heal
		const report = await loadHeal()({ live: true });
		expect(report.omni.would_null).toBe(1);
		expect((await storedRead()).total_score).toBeNull();
	});

	test('live heal: a genuine row keeps its exact engine number (372, not erased)', async () => {
		mockState.skills = [SKILL];
		mockState.omniRow = { user_id: EMPTY_USER, total_score: 372, score_tier: 'needs_work' };
		const report = await loadHeal()({ live: true });
		expect(report.omni.would_keep_number).toBe(1);
		expect((await storedRead()).total_score).toBe(372);
	});

	test('tombstoned user (deleted_at set) is skipped and never recomputed', async () => {
		mockState.omniRow = { user_id: EMPTY_USER, total_score: 352, score_tier: 'new' };
		mockState.deletedAt = new Date();
		const report = await loadHeal()({ live: true });
		expect(report.omni.skipped).toBe(1);
		expect(report.omni.would_null).toBe(0);
		expect(mockState.omniRow.total_score).toBe(352);
	});
});
