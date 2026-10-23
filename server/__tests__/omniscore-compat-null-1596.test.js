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
 * Mixed-case rule (documented in STOP 1, derived from the issue's own
 * repro arithmetic — the observed 43 IS a mixed case: reliability had
 * data via 1 application, soft_skills had none): a compat column is the
 * average of its MEASURED source factors only; it is NULL when no source
 * factor has data. Averaging an unmeasured raw in would halve a real 85
 * into a fabricated 43 (or a real 10 into a fabricated 5).
 *
 * #1776 UPDATE (panel ruling on #1761, Option D): calcReliabilitySignals
 * is measured-only now (no neutral base, no default rates). The one-app
 * expectations below therefore use the follow-through-only renormalised
 * raw 100 instead of the old neutral-default 85; the #1596 rule itself
 * (compat columns average MEASURED sources only, null when none) is
 * unchanged, and the no-data / mixed-resume cases pass as before.
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
	// #1776 (panel ruling on #1761, Option D): reliability_signals is
	// measured-only now — hasData=true (applications > 0) with the
	// follow-through-only renormalised raw 100 (was 85 = 50 neutral base +
	// 15 default-attendance + 20 follow-through under the old semantics);
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

	test('one-application candidate (#1588 repro): behavior is the measured reliability alone, never the fabricated 43', async () => {
		const score = await calculateScore(U_ONEAPP);
		// reliability_signals is the only measured behavior source — under
		// #1776 measured-only semantics its raw is the follow-through-only
		// renormalised 100 (the old neutral-default raw was 85); soft_skills
		// has no data, so it must not halve the value to 43 (or 50).
		expect(score.factors.reliability_signals.hasData).toBe(true);
		expect(score.factors.reliability_signals.raw).toBe(100);
		expect(score.factors.reliability_signals.coverageNote).toBe(
			'based on application follow-through only; attendance: insufficient data',
		);
		expect(score.factors.soft_skills.hasData).toBe(false);
		expect(score.behavior).toBe(100);
		// The other compat columns have no measured source at all.
		expect(score.interview).toBeNull();
		expect(score.technical).toBeNull();
		expect(score.resume).toBeNull();
		const row = await persistedRow(U_ONEAPP);
		expect(row.behavior_score).toBe(100);
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

	test('fully-measured control candidate: compat columns are the measured averages (reliability per #1776)', async () => {
		const score = await calculateScore(U_FULL);
		expect(score.factors.verified_skills.raw).toBe(8);
		expect(score.factors.interview_performance.raw).toBe(40);
		expect(score.factors.experience_quality.raw).toBe(10);
		expect(score.factors.education_credentials.raw).toBe(25);
		// #1776: U_FULL's reliability is follow-through-only (1 application,
		// 0 interviews) => renormalised 100 (old neutral-default raw was 85).
		expect(score.factors.reliability_signals.raw).toBe(100);
		expect(score.factors.soft_skills.raw).toBe(48);
		expect(score.technical).toBe(8);
		expect(score.interview).toBe(40);
		expect(score.resume).toBe(18); // round((10 + 25) / 2)
		expect(score.behavior).toBe(74); // round((100 + 48) / 2)
		const row = await persistedRow(U_FULL);
		expect(row.technical_score).toBe(8);
		expect(row.interview_score).toBe(40);
		expect(row.resume_score).toBe(18);
		expect(row.behavior_score).toBe(74);
	});
});
