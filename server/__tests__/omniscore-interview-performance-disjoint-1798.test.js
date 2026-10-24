/**
 * #1798 — calcInterviewPerformance + calcSoftSkills disjointness pin
 * on a REAL database.
 *
 * Filed from the independent ecc/code-reviewer HIGH follow-up on
 * PR #1795 (#1781): calcReliabilitySignals was made disjoint
 * (status wins), but calcInterviewPerformance still filtered
 * `status === 'completed' || outcome === 'passed'` with no guard,
 * so a contradictory row (status 'no_show'/'cancelled' +
 * outcome 'passed') earned full credit — raw 50 with 5/5 feedback,
 * or the +10 count fallback with hasData=true without feedback.
 * calcSoftSkills counted feedback from ANY interview row
 * regardless of status.
 *
 * Accepted fix (status wins, same as #1781): exclude
 * status IN ('no_show','cancelled') from the credited set in
 * calcInterviewPerformance, and skip those rows in the
 * calcSoftSkills feedback loop.
 *
 * This suite follows the omniscore-interview-performance-realdb-1782
 * / omniscore-reliability-disjoint-realdb-1781 pattern: fresh
 * throwaway Postgres built by `node migrate.js` from empty, rows
 * inserted via SQL in the app's real shapes, the real
 * calculateScore() runs, and the persisted omni_scores row is read
 * back.
 *
 * Example:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55433/nova1798 \
 *   OMNISCORE1798_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/nova1798' \
 *     npx jest server/__tests__/omniscore-interview-performance-disjoint-1798.test.js --forceExit
 */
jest.unmock('../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.OMNISCORE1798_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const C_ID = 17981;
const J_ID = 17981;
const U_NOSHOW_FB = 179801; // no_show + passed, feedback 5/5 (rating + communication)
const U_CANCELLED_FB = 179802; // cancelled + passed, feedback 5/5
const U_NOSHOW_NOFB = 179803; // no_show + passed, no feedback (count-fallback shape)
const U_PASSED = 179804; // completed + passed, feedback 4 (control)
const U_FAILED = 179805; // completed + failed, feedback 4 (attended control)
const U_MIXED = 179806; // completed (fb 2) + no_show/passed (fb 5) — only completed may count
const ALL_USERS = [U_NOSHOW_FB, U_CANCELLED_FB, U_NOSHOW_NOFB, U_PASSED, U_FAILED, U_MIXED];

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	for (const u of ALL_USERS) {
		await q('DELETE FROM omni_scores WHERE user_id = $1', [u]);
		await q('DELETE FROM score_snapshots WHERE user_id = $1', [u]);
		await q('DELETE FROM scheduled_interviews WHERE candidate_id = $1', [u]);
	}
	await q('DELETE FROM jobs WHERE id = $1', [J_ID]);
	await q('DELETE FROM companies WHERE id = $1', [C_ID]);
	for (const u of ALL_USERS) await q('DELETE FROM users WHERE id = $1', [u]);

	await q(`INSERT INTO companies (id, name) VALUES ($1, 'Nova 1798 Co')`, [C_ID]);
	await q(`INSERT INTO jobs (id, title, company_id) VALUES ($1, 'Interview Role', $2)`, [
		J_ID,
		C_ID,
	]);
	for (const u of ALL_USERS) {
		await q(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, 'Nova 1798', 'candidate')`, [
			u,
			`nova1798-${u}@test.local`,
		]);
		await q(
			'INSERT INTO omni_scores (user_id, total_score, score_tier, version) VALUES ($1, NULL, NULL, 2)',
			[u],
		);
	}
	const ins = async (userId, status, outcome, feedback) => {
		if (feedback) {
			await q(
				`INSERT INTO scheduled_interviews (company_id, job_id, candidate_id, scheduled_at, status, outcome, feedback)
				 VALUES ($1, $2, $3, NOW(), $4, $5, $6::jsonb)`,
				[C_ID, J_ID, userId, status, outcome, JSON.stringify(feedback)],
			);
		} else {
			await q(
				`INSERT INTO scheduled_interviews (company_id, job_id, candidate_id, scheduled_at, status, outcome)
				 VALUES ($1, $2, $3, NOW(), $4, $5)`,
				[C_ID, J_ID, userId, status, outcome],
			);
		}
	};
	// Contradictory rows: status says never attended, outcome says passed, feedback is perfect.
	await ins(U_NOSHOW_FB, 'no_show', 'passed', { rating: 5, overall_score: 5, communication: 5 });
	await ins(U_CANCELLED_FB, 'cancelled', 'passed', { rating: 5, overall_score: 5, communication: 5 });
	await ins(U_NOSHOW_NOFB, 'no_show', 'passed', null);
	// Legitimate attended controls.
	await ins(U_PASSED, 'completed', 'passed', { rating: 4, communication: 4 });
	await ins(U_FAILED, 'completed', 'failed', { rating: 4, communication: 4 });
	// Mixed: genuine attended interview (fb 2) + contradictory row (fb 5).
	await ins(U_MIXED, 'completed', 'passed', { rating: 2, communication: 2 });
	await ins(U_MIXED, 'no_show', 'passed', { rating: 5, overall_score: 5, communication: 5 });
}

async function persistedFactors(userId) {
	const res = await seedPool.query(
		'SELECT factor_scores, interview_score FROM omni_scores WHERE user_id = $1',
		[userId],
	);
	const factors =
		typeof res.rows[0].factor_scores === 'string'
			? JSON.parse(res.rows[0].factor_scores)
			: res.rows[0].factor_scores;
	return { factors, interviewScore: res.rows[0].interview_score };
}

describeIfDb('#1798 interview_performance + soft_skills disjoint — real DB', () => {
	let calculateScore;

	beforeAll(async () => {
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
			[U_NOSHOW_FB],
		);
		expect(res.rows).toEqual([{ status: 'no_show', outcome: 'passed' }]);
	});

	test('no_show+passed with 5/5 feedback: NO interview credit, NO soft-skills credit, hasData false, persisted null', async () => {
		const score = await calculateScore(U_NOSHOW_FB);
		expect(score.factors.interview_performance.hasData).toBe(false);
		expect(score.factors.interview_performance.raw).toBe(0);
		expect(score.factors.soft_skills.hasData).toBe(false);
		expect(score.factors.soft_skills.raw).toBe(0);
		const persisted = await persistedFactors(U_NOSHOW_FB);
		expect(persisted.factors.interview_performance).toBeNull();
		expect(persisted.factors.soft_skills).toBeNull();
		expect(persisted.interviewScore).toBeNull();
	});

	test('cancelled+passed with 5/5 feedback: NO interview credit, NO soft-skills credit, hasData false, persisted null', async () => {
		const score = await calculateScore(U_CANCELLED_FB);
		expect(score.factors.interview_performance.hasData).toBe(false);
		expect(score.factors.interview_performance.raw).toBe(0);
		expect(score.factors.soft_skills.hasData).toBe(false);
		expect(score.factors.soft_skills.raw).toBe(0);
		const persisted = await persistedFactors(U_CANCELLED_FB);
		expect(persisted.factors.interview_performance).toBeNull();
		expect(persisted.factors.soft_skills).toBeNull();
	});

	test('no_show+passed without feedback: no count fallback, hasData false, persisted null', async () => {
		const score = await calculateScore(U_NOSHOW_NOFB);
		expect(score.factors.interview_performance.hasData).toBe(false);
		expect(score.factors.interview_performance.raw).toBe(0);
		expect(score.factors.interview_performance.details.join(' ')).toMatch(/No completed interviews yet/);
		const persisted = await persistedFactors(U_NOSHOW_NOFB);
		expect(persisted.factors.interview_performance).toBeNull();
	});

	test("control — completed+passed with feedback 4: interview raw 40, soft raw 32 (unchanged)", async () => {
		const score = await calculateScore(U_PASSED);
		expect(score.factors.interview_performance.hasData).toBe(true);
		expect(score.factors.interview_performance.raw).toBe(40);
		expect(score.factors.soft_skills.hasData).toBe(true);
		// soft: communication 4 -> min(40, 4*8) = 32
		expect(score.factors.soft_skills.raw).toBe(32);
		const persisted = await persistedFactors(U_PASSED);
		expect(persisted.factors.interview_performance).toBe(40);
		expect(persisted.factors.soft_skills).toBe(32);
	});

	test("control — completed+failed with feedback 4: interview raw 40, soft raw 32 (attended still credits)", async () => {
		const score = await calculateScore(U_FAILED);
		expect(score.factors.interview_performance.hasData).toBe(true);
		expect(score.factors.interview_performance.raw).toBe(40);
		expect(score.factors.soft_skills.hasData).toBe(true);
		expect(score.factors.soft_skills.raw).toBe(32);
	});

	test('mixed attended (fb 2) + contradictory (fb 5): only the attended row counts — interview raw 20, soft raw 16', async () => {
		const score = await calculateScore(U_MIXED);
		expect(score.factors.interview_performance.hasData).toBe(true);
		// Only rating 2 counts: 2*10 = 20 (pre-fix avg 3.5 -> 35)
		expect(score.factors.interview_performance.raw).toBe(20);
		expect(score.factors.soft_skills.hasData).toBe(true);
		// Only communication 2 counts: min(40, 2*8) = 16 (pre-fix avg 3.5 -> 28)
		expect(score.factors.soft_skills.raw).toBe(16);
	});
});
