/**
 * #1801 — OmniScore rescheduled-family disjointness pin on a REAL
 * database.
 *
 * Filed from the independent ecc/code-reviewer MEDIUM finding on
 * PR #1800 (#1798): the #1781/#1798 "status wins" guard excludes
 * no_show/cancelled, but 'rescheduled'/'reschedule_requested' were
 * excluded NOWHERE, so a single row with status in the rescheduled
 * family + outcome 'passed' + 5/5 feedback earned, via the deliberate
 * #1776 'outcome passed = attended' arm:
 *   calcInterviewPerformance raw 50, calcSoftSkills raw 40,
 *   calcReliabilitySignals raw 100
 * for an interview that has not happened.
 *
 * Panel position (Lead, issue #1801, 2026-10-24): a rescheduled-family
 * row has not happened; outcome 'passed' on it is a recruiter-PUT
 * COALESCE-passthrough artefact (routes/recruiter.js:2434 — one call
 * can set status='rescheduled' + outcome='passed' + feedback, and a
 * completed+passed row can later be moved to 'rescheduled' by a
 * status-only PUT preserving outcome/feedback). Fix: ONE shared
 * credited-interview predicate excluding {no_show, cancelled,
 * rescheduled, reschedule_requested} and requiring
 * (status==='completed' || outcome==='passed'), used by all three
 * calculators. Reliability: the row earns no attendance credit and no
 * no-show/cancel penalty, and it is outside the attendance
 * denominator too — pending and UNMEASURED until it resolves (panel
 * position, comment 6381682759; a measured 0% attendance for a
 * recruiter-rescheduled interview would be a penalty in effect and
 * contradicts #1776's measured-only doctrine). NOTE: this suite's
 * first draft pinned denominator-inclusion; Lead amended those three
 * reliability pins to the panel semantics before inclusion (the
 * perf/soft/two-step pins are as drafted).
 *
 * This suite follows the omniscore-interview-performance-disjoint-1798
 * / omniscore-reliability-disjoint-realdb-1781 pattern: fresh
 * throwaway Postgres built by `node migrate.js` from empty, rows
 * inserted via SQL in the app's real shapes, the real
 * calculateScore() runs, and the persisted omni_scores row is read
 * back.
 *
 * Example:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55433/nova1801 \
 *   OMNISCORE1801_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/nova1801' \
 *     npx jest server/__tests__/omniscore-rescheduled-credit-realdb-1801.test.js --forceExit
 */
jest.unmock('../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.OMNISCORE1801_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const C_ID = 18011;
const J_ID = 18011;
const U_RESCHED_FB = 180101; // rescheduled + passed, feedback 5/5
const U_RESCHEDREQ_FB = 180102; // reschedule_requested + passed, feedback 5/5
const U_RESCHED_NOFB = 180103; // rescheduled + passed, no feedback (count-fallback shape)
const U_PASSED = 180104; // completed + passed, feedback 4 (control, all three factors)
const U_TWOSTEP = 180105; // completed+passed fb 4, later PUT to rescheduled alone
const U_MIXED = 180106; // completed (fb 2) + rescheduled/passed (fb 5)
const U_RESCHED_APP = 180107; // reschedule_requested + passed fb 5 + 1 application (reliability shape)
const ALL_USERS = [
	U_RESCHED_FB,
	U_RESCHEDREQ_FB,
	U_RESCHED_NOFB,
	U_PASSED,
	U_TWOSTEP,
	U_MIXED,
	U_RESCHED_APP,
];

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	for (const u of ALL_USERS) {
		await q('DELETE FROM omni_scores WHERE user_id = $1', [u]);
		await q('DELETE FROM score_snapshots WHERE user_id = $1', [u]);
		await q('DELETE FROM scheduled_interviews WHERE candidate_id = $1', [u]);
		await q('DELETE FROM job_applications WHERE candidate_id = $1', [u]);
	}
	await q('DELETE FROM jobs WHERE id = $1', [J_ID]);
	await q('DELETE FROM companies WHERE id = $1', [C_ID]);
	for (const u of ALL_USERS) await q('DELETE FROM users WHERE id = $1', [u]);

	await q(`INSERT INTO companies (id, name) VALUES ($1, 'Nova 1801 Co')`, [C_ID]);
	await q(`INSERT INTO jobs (id, title, company_id) VALUES ($1, 'Interview Role', $2)`, [
		J_ID,
		C_ID,
	]);
	for (const u of ALL_USERS) {
		await q(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, 'Nova 1801', 'candidate')`, [
			u,
			`nova1801-${u}@test.local`,
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
	// Rescheduled-family rows: the interview has not happened, yet the
	// outcome says 'passed' and the feedback is perfect.
	await ins(U_RESCHED_FB, 'rescheduled', 'passed', {
		rating: 5,
		overall_score: 5,
		communication: 5,
	});
	await ins(U_RESCHEDREQ_FB, 'reschedule_requested', 'passed', {
		rating: 5,
		overall_score: 5,
		communication: 5,
	});
	await ins(U_RESCHED_NOFB, 'rescheduled', 'passed', null);
	// Legitimate attended control.
	await ins(U_PASSED, 'completed', 'passed', { rating: 4, communication: 4 });
	// Two-step control: starts as a genuinely attended row; the test
	// later moves ONLY its status to 'rescheduled' (the recruiter PUT
	// status-only shape, outcome/feedback preserved).
	await ins(U_TWOSTEP, 'completed', 'passed', { rating: 4, communication: 4 });
	// Mixed: genuine attended interview (fb 2) + rescheduled row (fb 5).
	await ins(U_MIXED, 'completed', 'passed', { rating: 2, communication: 2 });
	await ins(U_MIXED, 'rescheduled', 'passed', {
		rating: 5,
		overall_score: 5,
		communication: 5,
	});
	// Reliability shape: reschedule_requested + passed + exactly 1
	// application (f = 1, 0 withdrawn).
	await ins(U_RESCHED_APP, 'reschedule_requested', 'passed', {
		rating: 5,
		overall_score: 5,
		communication: 5,
	});
	await q(
		`INSERT INTO job_applications (candidate_id, status, is_auto_applied, applied_via)
		 VALUES ($1, 'applied', false, 'manual')`,
		[U_RESCHED_APP],
	);
}

async function persistedFactors(userId) {
	const res = await seedPool.query(
		'SELECT factor_scores, interview_score, behavior_score FROM omni_scores WHERE user_id = $1',
		[userId],
	);
	const factors =
		typeof res.rows[0].factor_scores === 'string'
			? JSON.parse(res.rows[0].factor_scores)
			: res.rows[0].factor_scores;
	return {
		factors,
		interviewScore: res.rows[0].interview_score,
		behaviorScore: res.rows[0].behavior_score,
	};
}

describeIfDb('#1801 rescheduled-family earns no credit — real DB', () => {
	let calculateScore;

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		await cleanAndSeed();
		({ calculateScore } = require('../../services/omniscore'));
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('the rescheduled shapes are storable: rescheduled / reschedule_requested + outcome passed insert cleanly', async () => {
		const res = await seedPool.query(
			'SELECT candidate_id, status, outcome FROM scheduled_interviews WHERE candidate_id = ANY($1) ORDER BY candidate_id',
			[[U_RESCHED_FB, U_RESCHEDREQ_FB]],
		);
		expect(res.rows).toEqual([
			{ candidate_id: U_RESCHED_FB, status: 'rescheduled', outcome: 'passed' },
			{ candidate_id: U_RESCHEDREQ_FB, status: 'reschedule_requested', outcome: 'passed' },
		]);
	});

	test('rescheduled+passed with 5/5 feedback: NO performance credit, NO soft-skills credit, persisted null', async () => {
		const score = await calculateScore(U_RESCHED_FB);
		expect(score.factors.interview_performance.hasData).toBe(false);
		expect(score.factors.interview_performance.raw).toBe(0);
		expect(score.factors.soft_skills.hasData).toBe(false);
		expect(score.factors.soft_skills.raw).toBe(0);
		const persisted = await persistedFactors(U_RESCHED_FB);
		expect(persisted.factors.interview_performance).toBeNull();
		expect(persisted.factors.soft_skills).toBeNull();
		expect(persisted.interviewScore).toBeNull();
	});

	test('reschedule_requested+passed with 5/5 feedback: NO performance credit, NO soft-skills credit, persisted null', async () => {
		const score = await calculateScore(U_RESCHEDREQ_FB);
		expect(score.factors.interview_performance.hasData).toBe(false);
		expect(score.factors.interview_performance.raw).toBe(0);
		expect(score.factors.soft_skills.hasData).toBe(false);
		expect(score.factors.soft_skills.raw).toBe(0);
		const persisted = await persistedFactors(U_RESCHEDREQ_FB);
		expect(persisted.factors.interview_performance).toBeNull();
		expect(persisted.factors.soft_skills).toBeNull();
	});

	test('rescheduled+passed without feedback: no count fallback, hasData false, persisted null', async () => {
		const score = await calculateScore(U_RESCHED_NOFB);
		expect(score.factors.interview_performance.hasData).toBe(false);
		expect(score.factors.interview_performance.raw).toBe(0);
		expect(score.factors.interview_performance.details.join(' ')).toMatch(
			/No completed interviews yet/,
		);
		const persisted = await persistedFactors(U_RESCHED_NOFB);
		expect(persisted.factors.interview_performance).toBeNull();
	});

	test('reliability — rescheduled+passed single row: attendance UNMEASURED, no credit, no penalty, persisted null (pre-fix raw 100)', async () => {
		const score = await calculateScore(U_RESCHED_FB);
		const rel = score.factors.reliability_signals;
		// The row is pending: it is in neither the credited set nor the
		// resolved denominator, so attendance is not measured at all.
		expect(rel.coverage.attendance).toBe(false);
		expect(rel.hasData).toBe(false);
		expect(rel.raw).toBe(0);
		expect(rel.details.join(' ')).not.toMatch(/attendance/i);
		expect(rel.details.join(' ')).not.toMatch(/no-shows/);
		expect(score.behavior).toBeNull();
		const persisted = await persistedFactors(U_RESCHED_FB);
		expect(persisted.factors.reliability_signals).toBeNull();
		expect(persisted.behaviorScore).toBeNull();
	});

	test('reliability — reschedule_requested+passed + 1 application: follow-through only (raw 100, attendance unmeasured, coverage note), no penalty', async () => {
		const score = await calculateScore(U_RESCHED_APP);
		const rel = score.factors.reliability_signals;
		// Attendance unmeasured; f = 1 renormalises alone to 100 — the
		// same raw as pre-fix, so the distinguishing pins are coverage,
		// the coverage note, and the absence of any attendance detail
		// (pre-fix: attendance measured 100%, coverage both true, note null).
		expect(rel.raw).toBe(100);
		expect(rel.coverage).toEqual({ attendance: false, followThrough: true });
		expect(rel.coverageNote).toBe(
			'based on application follow-through only; attendance: insufficient data',
		);
		expect(rel.details.join(' ')).not.toMatch(/Interview attendance/);
		expect(rel.details.join(' ')).not.toMatch(/no-shows/);
		// And the same row earns no performance/soft-skills credit either.
		expect(score.factors.interview_performance.raw).toBe(0);
		expect(score.factors.interview_performance.hasData).toBe(false);
		expect(score.factors.soft_skills.raw).toBe(0);
		expect(score.factors.soft_skills.hasData).toBe(false);
		const persisted = await persistedFactors(U_RESCHED_APP);
		expect(persisted.factors.reliability_signals).toBe(100);
		expect(persisted.factors.interview_performance).toBeNull();
		expect(persisted.factors.soft_skills).toBeNull();
	});

	test("control — completed+passed with feedback 4: performance 40, soft 32, reliability 100 (unchanged)", async () => {
		const score = await calculateScore(U_PASSED);
		expect(score.factors.interview_performance.hasData).toBe(true);
		expect(score.factors.interview_performance.raw).toBe(40);
		expect(score.factors.soft_skills.hasData).toBe(true);
		expect(score.factors.soft_skills.raw).toBe(32);
		expect(score.factors.reliability_signals.raw).toBe(100);
		expect(score.factors.reliability_signals.details.join(' ')).toMatch(
			/Interview attendance 100%/,
		);
		const persisted = await persistedFactors(U_PASSED);
		expect(persisted.factors.interview_performance).toBe(40);
		expect(persisted.factors.soft_skills).toBe(32);
		expect(persisted.factors.reliability_signals).toBe(100);
	});

	test('mixed attended (fb 2) + rescheduled (fb 5): only the attended row counts — performance 20, soft 16, reliability 100', async () => {
		const score = await calculateScore(U_MIXED);
		expect(score.factors.interview_performance.hasData).toBe(true);
		// Only rating 2 counts: 2*10 = 20 (pre-fix avg 3.5 -> 35)
		expect(score.factors.interview_performance.raw).toBe(20);
		expect(score.factors.soft_skills.hasData).toBe(true);
		// Only communication 2 counts: min(40, 2*8) = 16 (pre-fix avg 3.5 -> 28)
		expect(score.factors.soft_skills.raw).toBe(16);
		// Reliability: resolved denominator 1 (rescheduled excluded),
		// credited 1 -> attendance 100%, no penalty.
		expect(score.factors.reliability_signals.details.join(' ')).toMatch(
			/Interview attendance 100%/,
		);
		expect(score.factors.reliability_signals.details.join(' ')).not.toMatch(
			/no-shows/,
		);
		expect(score.factors.reliability_signals.raw).toBe(100);
	});

	test('status-only control — completed+passed row later moved to rescheduled alone loses all credit', async () => {
		// Step 1: the row as attended credits identically to the control.
		const before = await calculateScore(U_TWOSTEP);
		expect(before.factors.interview_performance.raw).toBe(40);
		expect(before.factors.soft_skills.raw).toBe(32);
		expect(before.factors.reliability_signals.raw).toBe(100);

		// Step 2: status-only update (recruiter PUT passthrough shape) —
		// outcome 'passed' and the 4/5 feedback are preserved untouched.
		await seedPool.query(
			`UPDATE scheduled_interviews SET status = 'rescheduled' WHERE candidate_id = $1`,
			[U_TWOSTEP],
		);
		const stored = await seedPool.query(
			'SELECT status, outcome FROM scheduled_interviews WHERE candidate_id = $1',
			[U_TWOSTEP],
		);
		expect(stored.rows).toEqual([{ status: 'rescheduled', outcome: 'passed' }]);

		// Step 3: re-score — the row now earns nothing anywhere.
		const after = await calculateScore(U_TWOSTEP);
		expect(after.factors.interview_performance.hasData).toBe(false);
		expect(after.factors.interview_performance.raw).toBe(0);
		expect(after.factors.soft_skills.hasData).toBe(false);
		expect(after.factors.soft_skills.raw).toBe(0);
		expect(after.factors.reliability_signals.hasData).toBe(false);
		expect(after.factors.reliability_signals.details.join(' ')).not.toMatch(
			/Interview attendance/,
		);
		expect(after.factors.reliability_signals.details.join(' ')).not.toMatch(
			/no-shows/,
		);
		expect(after.factors.reliability_signals.raw).toBe(0);
		const persisted = await persistedFactors(U_TWOSTEP);
		expect(persisted.factors.interview_performance).toBeNull();
		expect(persisted.factors.soft_skills).toBeNull();
		expect(persisted.factors.reliability_signals).toBeNull();
	});
});
