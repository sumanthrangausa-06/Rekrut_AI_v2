/**
 * #1391 — Founder ruling (2026-11-02): recruiter CV analysis follows the
 * candidate's own Public-profile switch (Settings -> Privacy,
 * user_settings.privacy->>'profile_visible'; migration 060 /
 * routes/settings.js DEFAULT_PRIVACY — there is NO
 * candidate_profiles.profile_visible column).
 *
 *   switch ON  -> any recruiter may view/analyse the candidate
 *   switch OFF -> 404 for everyone EXCEPT the recruiter(s) of jobs the
 *                 candidate actually applied to, scoped to THAT job only
 *   missing user_settings row / missing-or-null key -> fail closed
 *   denial     -> HTTP 404 (not 403), audit-logged, NO screening record
 *
 * HL-003 user-journey E2E (Quinn): real HTTP against the REAL routers
 * (routes/screening.js, routes/ai-screener.js, routes/recruiter.js),
 * real auth, real AuditLogger, on a fresh-install Postgres built ONLY
 * by `node migrate.js`. The ONLY stub is the screener library boundary
 * (lib/recruiter-screener) — the AI provider leg — exactly as the
 * existing mocked screening suites stub lib/polsia-ai one level down.
 * The gate behaviour (allow / deny / 404 / no-record / audit row) is
 * exercised over real HTTP with the real DB, never mocked.
 *
 * Journey (the ruling's 3 cases, as a recruiter would call them):
 *   1. public candidate analysable by a recruiter they never applied to
 *   2. private candidate NOT analysable by a non-applicant recruiter
 *      (404, denial logged, no screening record, screener never called)
 *   3. private candidate analysable by the recruiter of a job they
 *      applied to — for that job only, 404 for the same recruiter's
 *      other job
 * Plus: fail-closed no-settings candidate, and the same gate on the two
 * sibling plain-by-id analysis endpoints found in the STOP 1 survey
 * (ai-screener POST /jobs/:jobId/screen/:candidateId — the endpoint the
 * recruiter UI actually calls — and recruiter POST
 * /jobs/:id/analyze-candidate).
 *
 * Rig (this run): PostgreSQL 18 at 127.0.0.1:55442; DB `rekrut_1391`
 * created empty and built only by migrate.js (exit 0). Fixture ids
 * derive from a per-run RUN_BASE so the suite is re-runnable.
 *
 * Example:
 *   SCREENING1391_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55442/rekrut_1391' \
 *     npx jest server/__tests__/routes/screening-profile-visible-gate-1391-realdb.test.js --runInBand --forceExit
 */
jest.unmock('../../../lib/db');

jest.mock('../../../lib/recruiter-screener', () => ({
	screenCandidate: jest.fn(async () => ({
		fit_score: 82,
		recommendation: 'interview',
		recommendation_reason: 'stub screener (AI boundary)',
		fit_breakdown: { skills_match: 90 },
		matched_skills: ['React'],
		missing_skills: [],
		strengths: ['stub'],
		concerns: [],
		red_flags: [],
		screening_questions: ['Tell me about React.'],
		interview_focus_areas: [],
		estimated_success_probability: 75,
	})),
	screenCandidatesBatch: jest.fn(async () => []),
	generateTailoredInterviewQuestions: jest.fn(async () => [
		{ question: 'Stub question?', category: 'technical', purpose: 'probe' },
	]),
	compareCandidates: jest.fn(async () => ({
		recommended: 'candidate1',
		comparison: { skills: { winner: 'candidate1', reason: 'stub' } },
		summary: 'Stub comparison.',
		interview_both: false,
	})),
	calculateBasicFitScore: jest.fn(() => ({ fit_score: 50, recommendation: 'more_info' })),
}));

// The recruiter analyze-candidate endpoint's AI boundary is
// services/job-optimizer (not the screener lib) — stubbed the same way,
// only that boundary.
jest.mock('../../../services/job-optimizer', () => ({
	analyzeCandidateFit: jest.fn(async () => ({
		fit_score: 80,
		summary: 'stub optimizer (AI boundary)',
	})),
}));

const { Pool } = require('pg');

const DB_URL = process.env.SCREENING1391_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(180000);

const RUN_BASE = 3000000 + Math.floor(Math.random() * 9000) * 100;
const CO = RUN_BASE + 1;
const R = RUN_BASE + 2; // recruiter (company CO)
const C_PUB = RUN_BASE + 3; // profile_visible = true
const C_PUB2 = RUN_BASE + 4; // profile_visible = true (compare partner)
const C_PRIV = RUN_BASE + 5; // profile_visible = false; applied to J1 only
const C_NONE = RUN_BASE + 6; // no user_settings row at all (fail closed)
const J1 = RUN_BASE + 11; // job the private candidate applied to
const J2 = RUN_BASE + 12; // same recruiter's other job (no application)
const APP1 = RUN_BASE + 21; // C_PRIV -> J1 application

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;
const screener = require('../../../lib/recruiter-screener');

describeIfDb('#1391 profile-visible gate — real DB (recruiter journey)', () => {
	let request;
	let app;
	let token;

	const post = (path, body) =>
		request(app).post(path).set('Authorization', `Bearer ${token}`).send(body);

	async function count(sql, params) {
		const { rows } = await seedPool.query(sql, params);
		return parseInt(rows[0].c, 10);
	}
	const screeningRows = (cand, job) =>
		count(
			'SELECT COUNT(*)::int AS c FROM job_application_screenings WHERE candidate_id = $1 AND job_id = $2',
			[cand, job],
		);
	const aiScreeningRows = (cand, job) =>
		count('SELECT COUNT(*)::int AS c FROM ai_screenings WHERE candidate_id = $1 AND job_id = $2', [
			cand,
			job,
		]);
	const applicationRows = (cand, job) =>
		count(
			'SELECT COUNT(*)::int AS c FROM job_applications WHERE candidate_id = $1 AND job_id = $2',
			[cand, job],
		);
	const denialLogs = (cand) =>
		count(
			"SELECT COUNT(*)::int AS c FROM audit_logs WHERE action_type = 'screening_visibility_denied' AND target_id = $1",
			[cand],
		);

	beforeAll(async () => {
		Object.assign(process.env, { DATABASE_URL: DB_URL });

		// Clean any prior run with these ids (children first).
		await seedPool.query('DELETE FROM job_application_screenings WHERE candidate_id = ANY($1)', [
			[C_PUB, C_PUB2, C_PRIV, C_NONE],
		]);
		await seedPool.query('DELETE FROM ai_screenings WHERE candidate_id = ANY($1)', [
			[C_PUB, C_PUB2, C_PRIV, C_NONE],
		]);
		await seedPool.query('DELETE FROM job_applications WHERE candidate_id = ANY($1)', [
			[C_PUB, C_PUB2, C_PRIV, C_NONE],
		]);
		await seedPool.query('DELETE FROM audit_logs WHERE user_id = $1', [R]);
		await seedPool.query('DELETE FROM jobs WHERE id = ANY($1)', [[J1, J2]]);
		await seedPool.query('DELETE FROM users WHERE id = ANY($1)', [
			[R, C_PUB, C_PUB2, C_PRIV, C_NONE],
		]);
		await seedPool.query('DELETE FROM companies WHERE id = $1', [CO]);

		await seedPool.query('INSERT INTO companies (id, name) VALUES ($1, $2)', [CO, 'Gate Co 1391']);
		await seedPool.query(
			`INSERT INTO users (id, email, password_hash, name, role, company_id)
			 VALUES ($1, $2, 'x', 'Recruiter 1391', 'recruiter', $3)`,
			[R, `rec${RUN_BASE}@test.local`, CO],
		);
		const candSeed = async (id, label, privacy) => {
			await seedPool.query(
				`INSERT INTO users (id, email, password_hash, name, role)
				 VALUES ($1, $2, 'x', $3, 'candidate')`,
				[id, `cand${id}@test.local`, label],
			);
			await seedPool.query(
				`INSERT INTO candidate_profiles (user_id, headline, years_experience)
				 VALUES ($1, 'Engineer', 5)`,
				[id],
			);
			if (privacy !== null) {
				await seedPool.query(`INSERT INTO user_settings (user_id, privacy) VALUES ($1, $2)`, [
					id,
					JSON.stringify({
						profile_visible: privacy,
						allow_messages: true,
						share_analytics: false,
					}),
				]);
			}
		};
		await candSeed(C_PUB, 'Public Candidate', true);
		await candSeed(C_PUB2, 'Public Candidate Two', true);
		await candSeed(C_PRIV, 'Private Candidate', false);
		await candSeed(C_NONE, 'No Settings Candidate', null);

		for (const [jid, title] of [
			[J1, 'Applied Job'],
			[J2, 'Other Job'],
		]) {
			await seedPool.query(
				`INSERT INTO jobs (id, user_id, company_id, title, description, status, skills_required)
				 VALUES ($1, $2, $3, $4, 'desc', 'active', '["React"]'::jsonb)`,
				[jid, R, CO, title],
			);
		}
		await seedPool.query(
			`INSERT INTO job_applications (id, candidate_id, job_id, company_id, status)
			 VALUES ($1, $2, $3, $4, 'applied')`,
			[APP1, C_PRIV, J1, CO],
		);

		const express = require('express');
		request = require('supertest');
		const { generateToken } = require('../../../lib/auth');
		token = generateToken({ id: R, email: `rec${RUN_BASE}@test.local`, role: 'recruiter' });
		app = express();
		app.use(express.json({ limit: '10mb' }));
		app.use('/api/screening', require('../../../routes/screening'));
		app.use('/api', require('../../../routes/ai-screener'));
		app.use('/api/recruiter', require('../../../routes/recruiter'));
	}, 60000);

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	beforeEach(() => {
		jest.clearAllMocks();
	});

	// ── Case 2 (denials first, so "no record" is proven on a clean slate)
	test('2a. private + non-applicant: POST /analyze -> 404, no screening record, denial logged, screener never called', async () => {
		const res = await post('/api/screening/analyze', { candidate_id: C_PRIV, job_id: J2 });
		expect(res.status).toBe(404);
		expect(await screeningRows(C_PRIV, J2)).toBe(0);
		expect(await denialLogs(C_PRIV)).toBeGreaterThanOrEqual(1);
		expect(screener.screenCandidate).not.toHaveBeenCalled();
	});

	test('2b. private + non-applicant: POST /questions -> 404, question generator never called', async () => {
		const res = await post('/api/screening/questions', { candidate_id: C_PRIV, job_id: J2 });
		expect(res.status).toBe(404);
		expect(screener.generateTailoredInterviewQuestions).not.toHaveBeenCalled();
	});

	test('2c. private + non-applicant: POST /compare (private vs public) -> 404, compare never called', async () => {
		const res = await post('/api/screening/compare', {
			candidate1_id: C_PRIV,
			candidate2_id: C_PUB,
			job_id: J2,
		});
		expect(res.status).toBe(404);
		expect(screener.compareCandidates).not.toHaveBeenCalled();
	});

	test('2d. fail closed: candidate with NO user_settings row + non-applicant -> 404 on /analyze, no record', async () => {
		const res = await post('/api/screening/analyze', { candidate_id: C_NONE, job_id: J1 });
		expect(res.status).toBe(404);
		expect(await screeningRows(C_NONE, J1)).toBe(0);
		expect(screener.screenCandidate).not.toHaveBeenCalled();
	});

	test('2e. private + non-applicant: ai-screener POST /jobs/:jobId/screen/:candidateId -> 404, no application auto-created, no ai_screenings row', async () => {
		const res = await post(`/api/jobs/${J2}/screen/${C_PRIV}`, {});
		expect(res.status).toBe(404);
		expect(await applicationRows(C_PRIV, J2)).toBe(0);
		expect(await aiScreeningRows(C_PRIV, J2)).toBe(0);
		expect(screener.screenCandidate).not.toHaveBeenCalled();
	});

	test('2f. private + non-applicant: recruiter POST /jobs/:id/analyze-candidate -> 404', async () => {
		const res = await post(`/api/recruiter/jobs/${J2}/analyze-candidate`, { candidate_id: C_PRIV });
		expect(res.status).toBe(404);
	});

	// ── Case 1: public candidate, non-applicant recruiter ──────────────
	test('1a. public + non-applicant: POST /analyze -> 200 and a screening record IS stored', async () => {
		const res = await post('/api/screening/analyze', { candidate_id: C_PUB, job_id: J2 });
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(await screeningRows(C_PUB, J2)).toBe(1);
		expect(screener.screenCandidate).toHaveBeenCalledTimes(1);
	});

	test('1b. public + non-applicant: POST /questions -> 200', async () => {
		const res = await post('/api/screening/questions', { candidate_id: C_PUB, job_id: J2 });
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	test('1c. public pair + non-applicant: POST /compare -> 200', async () => {
		const res = await post('/api/screening/compare', {
			candidate1_id: C_PUB,
			candidate2_id: C_PUB2,
			job_id: J2,
		});
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	test('1d. public + non-applicant: recruiter POST /jobs/:id/analyze-candidate -> 200', async () => {
		const res = await post(`/api/recruiter/jobs/${J2}/analyze-candidate`, { candidate_id: C_PUB });
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	// ── Case 3: private candidate, applicant exception scoped to the job
	test('3a. private + applicant job: POST /analyze for the applied job -> 200, record linked to the application', async () => {
		const res = await post('/api/screening/analyze', { candidate_id: C_PRIV, job_id: J1 });
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		const { rows } = await seedPool.query(
			'SELECT application_id FROM job_application_screenings WHERE candidate_id = $1 AND job_id = $2',
			[C_PRIV, J1],
		);
		expect(rows.length).toBe(1);
		expect(rows[0].application_id).toBe(APP1);
	});

	test('3b. private + applicant job: POST /questions for the applied job -> 200', async () => {
		const res = await post('/api/screening/questions', { candidate_id: C_PRIV, job_id: J1 });
		expect(res.status).toBe(200);
	});

	test("3c. private candidate STILL 404 for the same recruiter's other job after the applied-job access (scope is per-job)", async () => {
		const res = await post('/api/screening/analyze', { candidate_id: C_PRIV, job_id: J2 });
		expect(res.status).toBe(404);
		expect(await screeningRows(C_PRIV, J2)).toBe(0);
	});
});
