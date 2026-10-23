/**
 * #1596 — OmniScore compat columns must follow the #1538 honesty rule.
 *
 * STOP 1 root cause (verified on dev ed167388d): services/omniscore.js
 * calculateScore() computed the legacy compat columns unconditionally
 * from factor raws, ignoring each factor's hasData flag:
 *   interview_score = round(interview_performance.raw)
 *   technical_score = round(verified_skills.raw)
 *   resume_score    = round((experience_quality.raw + education_credentials.raw) / 2)
 *   behavior_score  = round((reliability_signals.raw + soft_skills.raw) / 2)
 * while total_score / score_tier / peer_percentile / factor_scores JSON
 * already honoured hasData (#1192 / #1538). calcReliabilitySignals builds
 * raw 85 from neutral defaults (50 base + 15 default-attendance + 20
 * follow-through) and calcSoftSkills raw is 0 with hasData=false, so the
 * #1588 journey baseline observed behavior_score 43 for a candidate whose
 * total_score was honestly NULL.
 *
 * Mixed-case rule — FOR PARENT/PANEL ADJUDICATION (HL-004: the issue
 * requires a discussed team position, not a solo call). PROPOSED rule,
 * implemented in this branch so the panel adjudicates working code:
 * a compat column is the average of its MEASURED source factors only;
 * it is NULL when no source factor has data. Precedent: this FOLLOWS
 * #1538 (a no-data factor persists as null, never its default raw) for
 * single-source columns exactly, and FOLLOWS the #1731 Lane 2/3 panel
 * rule for composites (renormalise over measured components only;
 * neither measured -> NULL) for the two-source columns — it departs
 * from neither. It is also the only reading consistent with the issue's
 * own repro: the observed 43 IS a mixed case (reliability measured 85
 * via 1 application, soft_skills unmeasured 0), so averaging an
 * unmeasured raw in would preserve the filed fabrication (and halve a
 * real resume 10 into 5).
 *
 * Real-DB suite: runs the real calculateScore() against a fresh
 * migrate.js-built Postgres; persisted omni_scores rows are read back.
 *
 * Example:
 *   DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/rekrut_1596_test' \
 *   OMNISCORE1596_INTEGRATION_DB_URL='postgresql://postgres:postgres@127.0.0.1:5432/rekrut_1596_test' \
 *     npx jest server/__tests__/omniscore-compat-null-1596.test.js --forceExit
 */
jest.unmock('../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.OMNISCORE1596_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const U_NODATA = 159601;
const U_ONEAPP = 159602;
const U_EXPONLY = 159603;
const U_FULL = 159604;
const ALL_USERS = [U_NODATA, U_ONEAPP, U_EXPONLY, U_FULL];

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	for (const u of ALL_USERS) {
		await q('DELETE FROM omni_scores WHERE user_id = $1', [u]);
		await q('DELETE FROM score_snapshots WHERE user_id = $1', [u]);
		await q('DELETE FROM job_applications WHERE candidate_id = $1', [u]);
		await q('DELETE FROM work_experience WHERE user_id = $1', [u]);
		await q('DELETE FROM education WHERE user_id = $1', [u]);
		await q('DELETE FROM candidate_skills WHERE user_id = $1', [u]);
		await q('DELETE FROM practice_sessions WHERE user_id = $1', [u]);
		await q('DELETE FROM users WHERE id = $1', [u]);
		await q(
			`INSERT INTO users (id, email, name, role) VALUES ($1, $2, 'Compat 1596', 'candidate')`,
			[u, `compat1596-${u}@test.local`],
		);
		// The row calculateScore() UPDATEs (getOrCreateScore's honest seed shape).
		await q('INSERT INTO omni_scores (user_id, total_score, score_tier, version) VALUES ($1, NULL, NULL, 2)', [
			u,
		]);
	}
	// U_ONEAPP: exactly one application, nothing else — the #1588 repro.
	// reliability_signals hasData=true (applications > 0), raw = 50 + 15 + 20 = 85;
	// soft_skills hasData=false, raw 0.
	await q(
		`INSERT INTO job_applications (candidate_id, status, is_auto_applied, applied_via)
		 VALUES ($1, 'applied', false, 'manual')`,
		[U_ONEAPP],
	);
	// U_EXPONLY: one 2-year experience record (raw 10 per #1538 arithmetic),
	// no education — the mixed resume case.
	await q(
		`INSERT INTO work_experience (user_id, company_name, title, start_date, end_date, is_current, achievements)
		 VALUES ($1, 'Acme', 'Dev', '2020-01-01', '2022-01-01', false, '[]'::jsonb)`,
		[U_EXPONLY],
	);
	// U_FULL: every compat source measured — the unchanged control.
	await q(
		`INSERT INTO work_experience (user_id, company_name, title, start_date, end_date, is_current, achievements)
		 VALUES ($1, 'Acme', 'Dev', '2020-01-01', '2022-01-01', false, '[]'::jsonb)`,
		[U_FULL],
	);
	await q(
		`INSERT INTO education (user_id, institution, degree, field_of_study)
		 VALUES ($1, 'State University', 'Bachelor of Science', 'Computer Science')`,
		[U_FULL],
	);
	await q(
		`INSERT INTO candidate_skills (user_id, skill_name, category, level, is_verified)
		 VALUES ($1, 'JavaScript', 'technical', 3, true)`,
		[U_FULL],
	);
	await q(
		`INSERT INTO practice_sessions (user_id, question_id, question, category, response_text, score)
		 VALUES ($1, 'q1', 'Tell me about a conflict', 'communication', 'answer', 8)`,
		[U_FULL],
	);
	await q(
		`INSERT INTO job_applications (candidate_id, status, is_auto_applied, applied_via)
		 VALUES ($1, 'applied', false, 'manual')`,
		[U_FULL],
	);
}

async function persistedRow(userId) {
	const res = await seedPool.query(
		'SELECT total_score, interview_score, technical_score, resume_score, behavior_score FROM omni_scores WHERE user_id = $1',
		[userId],
	);
	return res.rows[0];
}

describeIfDb('#1596 OmniScore compat columns — honest nulls (real DB)', () => {
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

	test('no-data candidate: total NULL and every compat column NULL (persisted + returned)', async () => {
		const score = await calculateScore(U_NODATA);
		expect(score.total_score).toBeNull();
		expect(score.interview).toBeNull();
		expect(score.technical).toBeNull();
		expect(score.resume).toBeNull();
		expect(score.behavior).toBeNull();
		const row = await persistedRow(U_NODATA);
		expect(row.total_score).toBeNull();
		expect(row.interview_score).toBeNull();
		expect(row.technical_score).toBeNull();
		expect(row.resume_score).toBeNull();
		expect(row.behavior_score).toBeNull();
	});

	test('one-application candidate (#1588 repro): behavior is the measured 85, never the fabricated 43', async () => {
		const score = await calculateScore(U_ONEAPP);
		// reliability_signals is the only measured behavior source (raw 85);
		// soft_skills has no data, so it must not halve the value to 43.
		expect(score.factors.reliability_signals.hasData).toBe(true);
		expect(score.factors.soft_skills.hasData).toBe(false);
		expect(score.behavior).toBe(85);
		// The other compat columns have no measured source at all.
		expect(score.interview).toBeNull();
		expect(score.technical).toBeNull();
		expect(score.resume).toBeNull();
		const row = await persistedRow(U_ONEAPP);
		expect(row.behavior_score).toBe(85);
		expect(row.interview_score).toBeNull();
		expect(row.technical_score).toBeNull();
		expect(row.resume_score).toBeNull();
		expect(typeof row.total_score).toBe('number');
	});

	test('mixed resume (experience only): resume_score is the measured raw alone, not halved by an unmeasured 0', async () => {
		const score = await calculateScore(U_EXPONLY);
		expect(score.factors.experience_quality.hasData).toBe(true);
		expect(score.factors.experience_quality.raw).toBe(10);
		expect(score.factors.education_credentials.hasData).toBe(false);
		expect(score.resume).toBe(10);
		const row = await persistedRow(U_EXPONLY);
		expect(row.resume_score).toBe(10);
	});

	test('fully-measured control candidate: compat columns unchanged from the measured averages', async () => {
		const score = await calculateScore(U_FULL);
		expect(score.factors.verified_skills.raw).toBe(8);
		expect(score.factors.interview_performance.raw).toBe(40);
		expect(score.factors.experience_quality.raw).toBe(10);
		expect(score.factors.education_credentials.raw).toBe(25);
		expect(score.factors.reliability_signals.raw).toBe(85);
		expect(score.factors.soft_skills.raw).toBe(48);
		expect(score.technical).toBe(8);
		expect(score.interview).toBe(40);
		expect(score.resume).toBe(18); // round((10 + 25) / 2)
		expect(score.behavior).toBe(67); // round((85 + 48) / 2)
		const row = await persistedRow(U_FULL);
		expect(row.technical_score).toBe(8);
		expect(row.interview_score).toBe(40);
		expect(row.resume_score).toBe(18);
		expect(row.behavior_score).toBe(67);
	});
});
