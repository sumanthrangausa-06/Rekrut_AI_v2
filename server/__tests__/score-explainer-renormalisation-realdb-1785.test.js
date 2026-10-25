/**
 * #1785 — scoreExplainer factor_breakdown renormalisation on a REAL
 * database (HL-003 pin).
 *
 * Defect (PR #1784 review F1): services/scoreExplainer.js decomposed
 * contributions with NOMINAL FACTOR_WEIGHTS, while the persisted total
 * (v4, #1777) is renormalised over measured factors only — so for a
 * partially-measured candidate the explainer's contributions did not
 * sum to its own overall_score (sole-measured reliability candidate:
 * headline 850, shown contribution 55).
 *
 * This suite follows the omniscore-total-renormalisation-realdb-1777
 * pattern: fresh throwaway Postgres built by `node migrate.js` from
 * empty, omni_scores rows inserted via SQL in the exact shape the v4
 * engine persists (#1538 number-or-null factor_scores), the REAL
 * explainOmniScore() runs against the real lib/db pool, and the
 * returned decomposition is asserted against the stored headline.
 *
 * Example:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55439/nova1785 \
 *     node migrate.js   # in a fresh throwaway DB
 *   SCORE_EXPLAINER1785_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55439/nova1785' \
 *     npx jest server/__tests__/score-explainer-renormalisation-realdb-1785.test.js --forceExit
 */
jest.unmock('../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.SCORE_EXPLAINER1785_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const U_SOLE = 178501;
const U_MIXED = 178502;
const U_FULL = 178503;

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

const NULL_FACTORS = {
	verified_skills: null,
	interview_performance: null,
	experience_quality: null,
	education_credentials: null,
	reliability_signals: null,
	soft_skills: null,
	market_demand: null,
	growth_trajectory: null,
};

async function seedUser(q, userId, row) {
	await q('DELETE FROM omni_scores WHERE user_id = $1', [userId]);
	await q('DELETE FROM users WHERE id = $1', [userId]);
	await q(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, $3, 'candidate')`, [
		userId,
		`nova1785-${userId}@test.local`,
		'Nova 1785',
	]);
	await q(
		`INSERT INTO omni_scores (user_id, total_score, technical_score, behavior_score, factor_scores, version)
		 VALUES ($1, $2, $3, $4, $5, 2)`,
		[userId, row.total, row.technical, row.behavior, JSON.stringify(row.factors)],
	);
}

async function seed() {
	const q = (sql, params) => seedPool.query(sql, params);
	// Sole measured: reliability 100 only -> v4 total 850, behavior
	// compat (measured sources only, #1596) = 100.
	await seedUser(q, U_SOLE, {
		total: 850,
		technical: null,
		behavior: 100,
		factors: { ...NULL_FACTORS, reliability_signals: 100 },
	});
	// Mixed: reliability 100 + education 25 -> v4 total 644.
	await seedUser(q, U_MIXED, {
		total: 644,
		technical: null,
		behavior: 100,
		factors: { ...NULL_FACTORS, reliability_signals: 100, education_credentials: 25 },
	});
	// Fully measured: the #1523 SCORED_ROW fixture — nominal
	// contributions 110+66+66+33+50+44+11+11 = 391, total 691.
	await seedUser(q, U_FULL, {
		total: 691,
		technical: 80,
		behavior: 85,
		factors: {
			verified_skills: 80,
			interview_performance: 60,
			experience_quality: 80,
			education_credentials: 60,
			reliability_signals: 90,
			soft_skills: 80,
			market_demand: 40,
			growth_trajectory: 40,
		},
	});
}

const byKey = (explanation, key) => explanation.factor_breakdown.find((f) => f.factor === key);
const contributionSum = (explanation) =>
	explanation.factor_breakdown.reduce((sum, f) => sum + (f.contribution || 0), 0);

describeIfDb('#1785 scoreExplainer renormalisation — real DB', () => {
	let explainOmniScore;

	beforeAll(async () => {
		// server/test/setup.js replaces DATABASE_URL with a dummy; the lane
		// pattern restores the real one before the service (and lib/db) load.
		process.env.DATABASE_URL = DB_URL;
		await seed();
		({ explainOmniScore } = require('../../services/scoreExplainer'));
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('sole-measured persisted row: reliability contribution is the full 550, sums to the stored 850', async () => {
		const explanation = await explainOmniScore(U_SOLE);
		expect(explanation.overall_score).toBe(850);
		expect(byKey(explanation, 'reliability_signals')).toMatchObject({
			score: 100,
			weight: 0.1,
			effective_weight: 1,
			contribution: 550,
		});
		for (const f of explanation.factor_breakdown) {
			if (f.factor === 'reliability_signals') continue;
			expect(f.score).toBeNull();
			expect(f.contribution).toBeNull();
			expect(f.effective_weight).toBe(0);
		}
		expect(contributionSum(explanation)).toBe(explanation.overall_score - 300);
	});

	test('mixed-measured persisted row: contributions sum to the stored 644', async () => {
		const explanation = await explainOmniScore(U_MIXED);
		expect(explanation.overall_score).toBe(644);
		expect(byKey(explanation, 'reliability_signals')).toMatchObject({
			effective_weight: 0.5,
			contribution: 275,
		});
		expect(byKey(explanation, 'education_credentials')).toMatchObject({
			effective_weight: 0.5,
			contribution: 69,
		});
		expect(contributionSum(explanation)).toBe(explanation.overall_score - 300);
	});

	test('fully-measured persisted row: renormalisation is the identity, contributions sum to 691', async () => {
		const explanation = await explainOmniScore(U_FULL);
		expect(explanation.overall_score).toBe(691);
		for (const f of explanation.factor_breakdown) {
			expect(f.effective_weight).toBeCloseTo(f.weight, 10);
		}
		expect(byKey(explanation, 'verified_skills').contribution).toBe(110);
		expect(contributionSum(explanation)).toBe(391);
		expect(contributionSum(explanation)).toBe(explanation.overall_score - 300);
	});
});
