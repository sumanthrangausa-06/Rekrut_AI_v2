/**
 * #1777 — OmniScore total renormalisation on a REAL database (HL-003 pin).
 *
 * The mocked suite (omniscore-total-renormalisation-1777.test.js) pins
 * the formula; this suite pins the PERSISTED outcome on the real schema,
 * following the omniscore-reliability-realdb-1776 /
 * omniscore-compat-null-1596 pattern: fresh throwaway Postgres built by
 * `node migrate.js` from empty, rows inserted via SQL in the app's real
 * shapes, the real calculateScore() runs, and the persisted omni_scores
 * row is read back.
 *
 * Scenario (the Quinn journey gate for this story): a candidate whose
 * ONLY measured factor is reliability — exactly 1 job application
 * (follow-through 1.0, #1776 renormalised raw 100), no interviews, no
 * skills, no matches, nothing else. Pre-fix total: ~361 (reliability
 * diluted by the seven unmeasured weights + market_demand's phantom
 * fallback 20). Post-fix: the total is derived from that factor alone —
 * 300 + 1.0 × 550 = 850 — persisted, with every other factor persisted
 * null (#1538) including market_demand.
 *
 * Example:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55433/postgres \
 *     node migrate.js   # in a fresh throwaway DB
 *   OMNISCORE1777_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/nova1777' \
 *     npx jest server/__tests__/omniscore-total-renormalisation-realdb-1777.test.js --forceExit
 */
jest.unmock('../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.OMNISCORE1777_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const U_SOLO = 177701;
const U_EMPTY = 177702;

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

async function cleanUser(q, userId) {
	await q('DELETE FROM omni_scores WHERE user_id = $1', [userId]);
	await q('DELETE FROM score_snapshots WHERE user_id = $1', [userId]);
	await q('DELETE FROM job_applications WHERE candidate_id = $1', [userId]);
	await q('DELETE FROM users WHERE id = $1', [userId]);
}

async function seed() {
	const q = (sql, params) => seedPool.query(sql, params);
	for (const u of [U_SOLO, U_EMPTY]) {
		await cleanUser(q, u);
		await q(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, $3, 'candidate')`, [
			u,
			`nova1777-${u}@test.local`,
			'Nova 1777',
		]);
		// The row calculateScore() UPDATEs (getOrCreateScore's honest seed).
		await q(
			'INSERT INTO omni_scores (user_id, total_score, score_tier, version) VALUES ($1, NULL, NULL, 2)',
			[u],
		);
	}
	// Solo candidate: exactly 1 application, the app's real row shape
	// (same columns the #1776 real-DB seed used).
	await q(
		`INSERT INTO job_applications (candidate_id, status, is_auto_applied, applied_via)
		 VALUES ($1, 'applied', false, 'manual')`,
		[U_SOLO],
	);
}

describeIfDb('#1777 total renormalisation — real DB (Quinn gate scenario)', () => {
	let calculateScore;

	beforeAll(async () => {
		// server/test/setup.js replaces DATABASE_URL with a dummy; the lane
		// pattern restores the real one before the service (and lib/db) load.
		process.env.DATABASE_URL = DB_URL;
		await seed();
		({ calculateScore } = require('../../services/omniscore'));
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('one measured factor: persisted total is that factor alone (850), all other factors null', async () => {
		const score = await calculateScore(U_SOLO);
		expect(score.scoring_semantics_version).toBe('v5-interview-performance-vocab');
		expect(score.factors.reliability_signals.hasData).toBe(true);
		expect(score.factors.reliability_signals.raw).toBe(100);
		for (const [key, f] of Object.entries(score.factors)) {
			if (key !== 'reliability_signals') expect(f.hasData).toBe(false);
		}
		// Market demand in particular: no matches, no skills — no phantom 20.
		expect(score.factors.market_demand.raw).toBe(0);
		expect(score.total_score).toBe(850);

		const res = await seedPool.query(
			'SELECT total_score, factor_scores, behavior_score FROM omni_scores WHERE user_id = $1',
			[U_SOLO],
		);
		expect(res.rows[0].total_score).toBe(850);
		const factors =
			typeof res.rows[0].factor_scores === 'string'
				? JSON.parse(res.rows[0].factor_scores)
				: res.rows[0].factor_scores;
		expect(factors.reliability_signals).toBe(100);
		for (const [key, v] of Object.entries(factors)) {
			if (key !== 'reliability_signals') expect(v).toBeNull();
		}
		expect(res.rows[0].behavior_score).toBe(100);
	});

	test('zero-input candidate on the real DB: persisted total stays null', async () => {
		const score = await calculateScore(U_EMPTY);
		expect(score.total_score).toBeNull();
		const res = await seedPool.query(
			'SELECT total_score, factor_scores FROM omni_scores WHERE user_id = $1',
			[U_EMPTY],
		);
		expect(res.rows[0].total_score).toBeNull();
		const factors =
			typeof res.rows[0].factor_scores === 'string'
				? JSON.parse(res.rows[0].factor_scores)
				: res.rows[0].factor_scores;
		for (const v of Object.values(factors)) expect(v).toBeNull();
	});
});
