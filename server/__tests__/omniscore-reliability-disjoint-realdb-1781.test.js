/**
 * #1781 — pinning test (HL-003): a contradictory interview row
 * (status='no_show'/'cancelled' AND outcome='passed') must not be
 * counted as BOTH attended and no-show by calcReliabilitySignals.
 *
 * Filed from the delta re-review of PR #1778 (Finding 5): attended and
 * no-show read different columns, and the two filters in
 * services/omniscore.js calcReliabilitySignals were independent —
 * `completed` matched `outcome === 'passed'` while `noShows` matched
 * `status IN ('no_show','cancelled')`, so one contradictory row
 * incremented both: attendance credit AND the −10 no-show penalty.
 * Scout measured the pre-fix behaviour directly (issue #1781, comment
 * 6377762177): one contradictory row + 1 application → raw 90.
 *
 * The contradictory row IS storable: both values are individually
 * lawful under chk_scheduled_interviews_status (no_show/cancelled)
 * and chk_scheduled_interviews_outcome (passed). It arises from real
 * writers: routes/recruiter.js PUT /interviews/:id uses
 * COALESCE passthrough for status and outcome independently (a
 * status-only update preserves a prior outcome='passed'), and
 * routes/interviews.js PUT /reschedule's cancel branch sets
 * status='cancelled' with no status guard and no outcome clearing.
 *
 * Fix (Lead checkpoint on #1781, comment 6378154700 — status wins):
 * the attended/passed set and the no-show set are disjoint — a
 * no_show/cancelled row never counts as attended, whatever its
 * outcome says. A contradictory row therefore measures exactly like
 * a clean no-show: with 1 application (f = 1) and 1 interview,
 * raw = 0*60 + 40*1 − 10 = 30 (Scout's clean no-show baseline).
 *
 * This suite follows the omniscore-reliability-realdb-1776.test.js
 * pattern: fresh throwaway Postgres built by `node migrate.js` from
 * empty, rows inserted via SQL in the app's real shapes, the real
 * calculateScore() runs, and the persisted omni_scores row is read
 * back.
 *
 * Example:
 *   DATABASE_URL='postgresql://postgres@127.0.0.1:55481/nova1781' \
 *   OMNISCORE1781_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55481/nova1781' \
 *     npx jest server/__tests__/omniscore-reliability-disjoint-realdb-1781.test.js --forceExit
 */
jest.unmock('../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.OMNISCORE1781_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const C_ID = 17811;
const J_ID = 17811;
const U_NOSHOW = 178101;
const U_CANCELLED = 178102;
const U_MIXED = 178103;
const ALL_USERS = [U_NOSHOW, U_CANCELLED, U_MIXED];

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

async function seedUser(q, userId) {
	await q('DELETE FROM omni_scores WHERE user_id = $1', [userId]);
	await q('DELETE FROM score_snapshots WHERE user_id = $1', [userId]);
	await q('DELETE FROM scheduled_interviews WHERE candidate_id = $1', [userId]);
	await q('DELETE FROM job_applications WHERE candidate_id = $1', [userId]);
	await q('DELETE FROM users WHERE id = $1', [userId]);
	await q(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, 'Nova 1781', 'candidate')`, [
		userId,
		`nova1781-${userId}@test.local`,
	]);
	// The row calculateScore() UPDATEs (getOrCreateScore's honest seed shape).
	await q(
		'INSERT INTO omni_scores (user_id, total_score, score_tier, version) VALUES ($1, NULL, NULL, 2)',
		[userId],
	);
	// Exactly 1 application in every scenario (f = 1, 0 withdrawn).
	await q(
		`INSERT INTO job_applications (candidate_id, status, is_auto_applied, applied_via)
		 VALUES ($1, 'applied', false, 'manual')`,
		[userId],
	);
}

async function addInterview(q, userId, status, outcome) {
	await q(
		`INSERT INTO scheduled_interviews (company_id, job_id, candidate_id, scheduled_at, status, outcome)
		 VALUES ($1, $2, $3, NOW(), $4, $5)`,
		[C_ID, J_ID, userId, status, outcome],
	);
}

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	for (const u of ALL_USERS) await seedUser(q, u);
	await q('DELETE FROM jobs WHERE id = $1', [J_ID]);
	await q('DELETE FROM companies WHERE id = $1', [C_ID]);
	await q(`INSERT INTO companies (id, name) VALUES ($1, 'Nova 1781 Co')`, [C_ID]);
	await q(`INSERT INTO jobs (id, title, company_id) VALUES ($1, 'Reliability Role', $2)`, [
		J_ID,
		C_ID,
	]);
	// Interviews are inserted only now: their company/job parents exist.
	// Contradictory no-show: status says the candidate never came,
	// outcome says they passed. Status must win.
	await addInterview(q, U_NOSHOW, 'no_show', 'passed');
	// Contradictory cancellation: same shape via the cancel branch.
	await addInterview(q, U_CANCELLED, 'cancelled', 'passed');
	// Mixed: one genuinely attended interview + one contradictory row.
	await addInterview(q, U_MIXED, 'completed', 'passed');
	await addInterview(q, U_MIXED, 'no_show', 'passed');
}

describeIfDb('#1781 reliability disjoint sets — real DB (contradictory row)', () => {
	let calculateScore;

	beforeAll(async () => {
		// server/test/setup.js replaces DATABASE_URL with a dummy; the lane
		// pattern restores the real one before the service (and lib/db) load.
		process.env.DATABASE_URL = DB_URL;
		await cleanAndSeed();
		({ calculateScore } = require('../../services/omniscore'));
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('the contradictory shape is storable: status no_show + outcome passed inserts cleanly', async () => {
		const res = await seedPool.query(
			'SELECT status, outcome FROM scheduled_interviews WHERE candidate_id = $1',
			[U_NOSHOW],
		);
		expect(res.rows).toEqual([{ status: 'no_show', outcome: 'passed' }]);
	});

	test('contradictory no_show/passed row: no attendance credit, penalty only — raw 30, persisted', async () => {
		const score = await calculateScore(U_NOSHOW);
		const rel = score.factors.reliability_signals;
		expect(rel.hasData).toBe(true);
		// Status wins: attendance is 0%, not 100% (pre-fix bug: 100%).
		expect(rel.details.join(' ')).toMatch(/Interview attendance 0%/);
		expect(rel.details.join(' ')).toMatch(/1 no-shows \(-10\)/);
		// 0*60 + 40*1 − 10 = 30 — exactly the clean no-show baseline.
		// Pre-fix this was 90 (attendance credit AND penalty).
		expect(rel.raw).toBe(30);
		expect(score.behavior).toBe(30);

		const res = await seedPool.query(
			'SELECT factor_scores, behavior_score FROM omni_scores WHERE user_id = $1',
			[U_NOSHOW],
		);
		const factors =
			typeof res.rows[0].factor_scores === 'string'
				? JSON.parse(res.rows[0].factor_scores)
				: res.rows[0].factor_scores;
		expect(factors.reliability_signals).toBe(30);
		expect(res.rows[0].behavior_score).toBe(30);
	});

	test('contradictory cancelled/passed row: no credit, but NO penalty since #1780 — raw 40', async () => {
		const score = await calculateScore(U_CANCELLED);
		const rel = score.factors.reliability_signals;
		// Disjoint treatment stands (#1781): status wins, no attendance
		// credit. Penalty treatment changed (#1780 interim (b)): a
		// cancelled row is actor-blind (no cancelled_by column; most
		// cancellation writers are recruiter/reschedule), so it no
		// longer deducts 10. raw = 0*60 + 40*1 - 0 = 40 (was 30).
		expect(rel.details.join(' ')).toMatch(/Interview attendance 0%/);
		expect(rel.details.join(' ')).not.toMatch(/no-shows\(-|no-shows \(-\d+\)/);
		expect(rel.raw).toBe(40);
	});

	test('attended + contradictory row: contradictory row adds a penalty, never attendance — raw 60', async () => {
		const score = await calculateScore(U_MIXED);
		const rel = score.factors.reliability_signals;
		// scheduled 2, attended 1 (the completed row only), no-shows 1:
		// 60*0.5 + 40*1 − 10 = 60. Pre-fix: attended 2/2 → raw 90.
		expect(rel.details.join(' ')).toMatch(/Interview attendance 50%/);
		expect(rel.details.join(' ')).toMatch(/1 no-shows \(-10\)/);
		expect(rel.raw).toBe(60);
	});
});
