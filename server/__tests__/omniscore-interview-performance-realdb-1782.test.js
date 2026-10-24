/**
 * #1782 — calcInterviewPerformance vocabulary pin on a REAL database.
 *
 * Filed from the delta re-review of PR #1778 (Finding 6a): the factor
 * filtered `outcome === 'completed' || outcome === 'passed'`, but
 * chk_scheduled_interviews_outcome permits only
 * passed/failed/pending_review/no_decision/NULL — 'completed' is a
 * STATUS value (chk_scheduled_interviews_status), so that branch is
 * dead on real data and the factor counted only outcome='passed' rows.
 * A candidate whose interview was attended and concluded with
 * outcome 'failed' (the recruiter PUT /interviews/:id shape:
 * status 'completed' + outcome 'failed' + feedback) got
 * interview_performance raw 0 / hasData=false and a persisted null —
 * as if the interview had never happened. Same vocabulary class as
 * the #1776 Quinn catch on calcReliabilitySignals; the fix mirrors
 * that factor's attended definition: status 'completed' OR
 * outcome 'passed'.
 *
 * This suite follows the omniscore-reliability-realdb-1776 pattern:
 * fresh throwaway Postgres built by `node migrate.js` from empty,
 * rows inserted via SQL in the app's real shapes, the real
 * calculateScore() runs, and the persisted omni_scores row is read
 * back.
 *
 * Example:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55495/nova1782 \
 *   OMNISCORE1782_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55495/nova1782' \
 *     npx jest server/__tests__/omniscore-interview-performance-realdb-1782.test.js --forceExit
 */
jest.unmock('../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.OMNISCORE1782_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const C_ID = 17821;
const J_ID = 17821;
const U_FAILED = 178201; // status completed + outcome failed + feedback rating 4
const U_PENDING = 178202; // status completed + outcome pending_review, no feedback
const U_PASSED = 178203; // status completed + outcome passed + feedback rating 4 (control)
const ALL_USERS = [U_FAILED, U_PENDING, U_PASSED];

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

	// scheduled_interviews.company_id / job_id are NOT NULL on the
	// migrated schema — seed the parent rows the API path would have.
	await q(`INSERT INTO companies (id, name) VALUES ($1, 'Nova 1782 Co')`, [C_ID]);
	await q(`INSERT INTO jobs (id, title, company_id) VALUES ($1, 'Interview Role', $2)`, [
		J_ID,
		C_ID,
	]);
	for (const u of ALL_USERS) {
		await q(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, 'Nova 1782', 'candidate')`, [
			u,
			`nova1782-${u}@test.local`,
		]);
		// The row calculateScore() UPDATEs (getOrCreateScore's honest seed shape).
		await q(
			'INSERT INTO omni_scores (user_id, total_score, score_tier, version) VALUES ($1, NULL, NULL, 2)',
			[u],
		);
	}
	// Attended, concluded 'failed' — the recruiter feedback shape
	// (routes/recruiter.js PUT /interviews/:id writes status and
	// outcome separately; feedback is jsonb with a 1-5 rating).
	await q(
		`INSERT INTO scheduled_interviews (company_id, job_id, candidate_id, scheduled_at, status, outcome, feedback)
		 VALUES ($1, $2, $3, NOW(), 'completed', 'failed', '{"rating": 4}'::jsonb)`,
		[C_ID, J_ID, U_FAILED],
	);
	// Attended, awaiting a decision — no feedback, no evaluations:
	// only the completed-count fallback can measure this interview.
	await q(
		`INSERT INTO scheduled_interviews (company_id, job_id, candidate_id, scheduled_at, status, outcome)
		 VALUES ($1, $2, $3, NOW(), 'completed', 'pending_review')`,
		[C_ID, J_ID, U_PENDING],
	);
	// Control: the one shape the pre-fix filter already counted.
	await q(
		`INSERT INTO scheduled_interviews (company_id, job_id, candidate_id, scheduled_at, status, outcome, feedback)
		 VALUES ($1, $2, $3, NOW(), 'completed', 'passed', '{"rating": 4}'::jsonb)`,
		[C_ID, J_ID, U_PASSED],
	);
}

async function persistedFactor(userId) {
	const res = await seedPool.query(
		'SELECT factor_scores, interview_score FROM omni_scores WHERE user_id = $1',
		[userId],
	);
	const factors =
		typeof res.rows[0].factor_scores === 'string'
			? JSON.parse(res.rows[0].factor_scores)
			: res.rows[0].factor_scores;
	return { factor: factors.interview_performance, interviewScore: res.rows[0].interview_score };
}

describeIfDb('#1782 interview_performance vocabulary — real DB', () => {
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

	test("the calculator's old vocabulary is unstorable: outcome 'completed' is rejected by the CHECK", async () => {
		await expect(
			seedPool.query(
				`INSERT INTO scheduled_interviews (company_id, job_id, candidate_id, scheduled_at, status, outcome)
				 VALUES ($1, $2, $3, NOW(), 'scheduled', 'completed')`,
				[C_ID, J_ID, U_FAILED],
			),
		).rejects.toThrow(/chk_scheduled_interviews_outcome|check constraint/i);
	});

	test("status 'completed' + outcome 'failed' with feedback rating 4: raw 40, hasData, persisted", async () => {
		const score = await calculateScore(U_FAILED);
		// feedback path: avg 4/5 -> 4*10 = 40 of the 50-point interview half
		expect(score.factors.interview_performance.hasData).toBe(true);
		expect(score.factors.interview_performance.raw).toBe(40);
		expect(score.factors.interview_performance.details.join(' ')).toMatch(
			/1 interview feedbacks, avg 4\.0\/5/,
		);
		const persisted = await persistedFactor(U_FAILED);
		expect(persisted.factor).toBe(40);
		expect(persisted.interviewScore).toBe(40);
	});

	test("status 'completed' + outcome 'pending_review' without feedback: count fallback raw 10, hasData, persisted", async () => {
		const score = await calculateScore(U_PENDING);
		// count fallback: 1 completed interview * 10 = 10
		expect(score.factors.interview_performance.hasData).toBe(true);
		expect(score.factors.interview_performance.raw).toBe(10);
		expect(score.factors.interview_performance.details.join(' ')).toMatch(
			/1 completed interviews \(\+10\)/,
		);
		const persisted = await persistedFactor(U_PENDING);
		expect(persisted.factor).toBe(10);
		expect(persisted.interviewScore).toBe(10);
	});

	test("control — status 'completed' + outcome 'passed' with feedback rating 4: raw 40 (unchanged)", async () => {
		const score = await calculateScore(U_PASSED);
		expect(score.factors.interview_performance.hasData).toBe(true);
		expect(score.factors.interview_performance.raw).toBe(40);
		const persisted = await persistedFactor(U_PASSED);
		expect(persisted.factor).toBe(40);
		expect(persisted.interviewScore).toBe(40);
	});
});
