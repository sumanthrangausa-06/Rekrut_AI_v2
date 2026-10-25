/**
 * #1776 — Quinn journey-gate failure pin (HL-003): reliability no-show
 * penalty on a REAL database.
 *
 * Quinn's gate on PR #1778 (2026-10-23, head 66fc601) FAILED Leg 2: a
 * candidate with 1 application, 1 attended interview and 1 no-show
 * scored reliability 70 instead of 60, persisted. Root cause:
 * calcReliabilitySignals counted no-shows from
 * `outcome IN ('no_show','cancelled')`, but on real data those values
 * live in `status` — chk_scheduled_interviews_status allows
 * scheduled/confirmed/completed/cancelled/no_show/rescheduled
 * (migrations/047_p2_schema_hardening.js adds in_progress instead of
 * rescheduled; both agree no_show/cancelled/completed are STATUS),
 * while chk_scheduled_interviews_outcome (migrations/
 * p2_schema_hardening.sql:2820) allows only passed/failed/
 * pending_review/no_decision/NULL. Quinn proved it three ways: the
 * recruiter PUT with outcome 'no_show' 500s, and direct INSERTs of
 * outcome 'no_show'/'cancelled' fail PG 23514. The mocked suites mocked
 * rows as { outcome: 'no_show' } — a shape the DB can never store.
 *
 * This suite follows the omniscore-compat-null-1596.test.js pattern:
 * fresh throwaway Postgres built by `node migrate.js` from empty, rows
 * inserted via SQL in the app's real shapes (attended: status
 * 'completed' + outcome 'passed', as routes/recruiter.js PUT
 * /interviews/:id writes; no-show: status 'no_show' + outcome NULL),
 * the real calculateScore() runs, and the persisted omni_scores row is
 * read back. Expected: a = 1/2, f = 1/1 =>
 * 60*0.5 + 40*1 - 10 (1 no-show x 10, cap 20) = 60.
 *
 * Example:
 *   DATABASE_URL='postgresql://postgres@127.0.0.1:55494/nova1776' \
 *   OMNISCORE1776_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55494/nova1776' \
 *     npx jest server/__tests__/omniscore-reliability-realdb-1776.test.js --forceExit
 */
jest.unmock('../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.OMNISCORE1776_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const U_QUINN = 177601;
const C_QUINN = 17761;
const J_QUINN = 17761;

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	await q('DELETE FROM omni_scores WHERE user_id = $1', [U_QUINN]);
	await q('DELETE FROM score_snapshots WHERE user_id = $1', [U_QUINN]);
	await q('DELETE FROM scheduled_interviews WHERE candidate_id = $1', [U_QUINN]);
	await q('DELETE FROM job_applications WHERE candidate_id = $1', [U_QUINN]);
	await q('DELETE FROM jobs WHERE id = $1', [J_QUINN]);
	await q('DELETE FROM companies WHERE id = $1', [C_QUINN]);
	await q('DELETE FROM users WHERE id = $1', [U_QUINN]);
	// scheduled_interviews.company_id / job_id are NOT NULL on the
	// migrated schema — seed the parent rows the API path would have.
	await q(`INSERT INTO companies (id, name) VALUES ($1, 'Quinn 1776 Co')`, [C_QUINN]);
	await q(`INSERT INTO jobs (id, title, company_id) VALUES ($1, 'Reliability Role', $2)`, [
		J_QUINN,
		C_QUINN,
	]);
	await q(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, 'Quinn 1776', 'candidate')`, [
		U_QUINN,
		`quinn1776-${U_QUINN}@test.local`,
	]);
	// The row calculateScore() UPDATEs (getOrCreateScore's honest seed shape).
	await q(
		'INSERT INTO omni_scores (user_id, total_score, score_tier, version) VALUES ($1, NULL, NULL, 2)',
		[U_QUINN],
	);
	// Quinn's exact scenario: exactly 1 application (f = 1, 0 withdrawn).
	await q(
		`INSERT INTO job_applications (candidate_id, status, is_auto_applied, applied_via)
		 VALUES ($1, 'applied', false, 'manual')`,
		[U_QUINN],
	);
	// Interview 1 — attended, as the recruiter PUT wrote it.
	await q(
		`INSERT INTO scheduled_interviews (company_id, job_id, candidate_id, scheduled_at, status, outcome)
		 VALUES ($1, $2, $3, NOW(), 'completed', 'passed')`,
		[C_QUINN, J_QUINN, U_QUINN],
	);
	// Interview 2 — no-show, the app's own representation (outcome NULL).
	await q(
		`INSERT INTO scheduled_interviews (company_id, job_id, candidate_id, scheduled_at, status, outcome)
		 VALUES ($1, $2, $3, NOW(), 'no_show', NULL)`,
		[C_QUINN, J_QUINN, U_QUINN],
	);
}

describeIfDb('#1776 reliability no-show penalty — real DB (Quinn gate scenario)', () => {
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

	test('the calculator vocabulary is the storable vocabulary: outcome no_show/cancelled are rejected by the CHECK', async () => {
		await expect(
			seedPool.query(
				`INSERT INTO scheduled_interviews (company_id, job_id, candidate_id, scheduled_at, status, outcome)
				 VALUES ($1, $2, $3, NOW(), 'scheduled', 'no_show')`,
				[C_QUINN, J_QUINN, U_QUINN],
			),
		).rejects.toThrow(/chk_scheduled_interviews_outcome|check constraint/i);
		await expect(
			seedPool.query(
				`INSERT INTO scheduled_interviews (company_id, job_id, candidate_id, scheduled_at, status, outcome)
				 VALUES ($1, $2, $3, NOW(), 'scheduled', 'cancelled')`,
				[C_QUINN, J_QUINN, U_QUINN],
			),
		).rejects.toThrow(/chk_scheduled_interviews_outcome|check constraint/i);
	});

	test('attended + no-show candidate: reliability raw is 60, returned and persisted', async () => {
		const score = await calculateScore(U_QUINN);
		expect(score.factors.reliability_signals.hasData).toBe(true);
		expect(score.factors.reliability_signals.coverage).toEqual({
			attendance: true,
			followThrough: true,
		});
		expect(score.factors.reliability_signals.coverageNote).toBeNull();
		expect(score.factors.reliability_signals.details.join(' ')).toMatch(
			/1 no-shows \(-10\)/,
		);
		// 60*0.5 + 40*1 - 10 = 60 (the gate failed at 70 pre-fix)
		expect(score.factors.reliability_signals.raw).toBe(60);
		// behaviour compat: reliability is the only measured source.
		expect(score.behavior).toBe(60);

		const res = await seedPool.query(
			'SELECT factor_scores, behavior_score FROM omni_scores WHERE user_id = $1',
			[U_QUINN],
		);
		const factors =
			typeof res.rows[0].factor_scores === 'string'
				? JSON.parse(res.rows[0].factor_scores)
				: res.rows[0].factor_scores;
		expect(factors.reliability_signals).toBe(60);
		expect(res.rows[0].behavior_score).toBe(60);
	});
});
